import { createServer } from "node:http";
import { resolve } from "node:path";
import express from "express";
import { createClient } from "redis";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { createApp, type AppOptions } from "./app.js";
import { membership } from "./auth.js";
import { ApiError, forbidden } from "./errors.js";
import type { TicketChange } from "./contracts.js";
import { Tickets } from "./tickets.js";
import { ticketRoutes } from "./ticket-routes.js";

const watch = z.object({ workspaceId: z.string().uuid() }).strict();
const changeSchema = watch.extend({ ticketId: z.string().uuid() });
type Ack = (result: { ok: boolean; code?: string }) => void;

export async function createRuntime(
  options: AppOptions & { redisUrl?: string; webDirectory?: string },
) {
  const { app, auth, finish } = createApp(options);
  const tickets = new Tickets(options.db);
  const http = createServer(app);
  const io = new Server(http, {
    transports: ["websocket"],
    maxHttpBufferSize: 4096,
    serveClient: false,
  });
  // Kept outside socket.data: session cookies must never enter the Redis adapter.
  const viewers = new Map<string, { cookie: string; workspaceId?: string }>();
  const pub = options.redisUrl
    ? createClient({ url: options.redisUrl })
    : undefined;
  const sub = pub?.duplicate();
  if (pub && sub) {
    pub.on("error", (error) =>
      console.error("Redis publisher:", error.message),
    );
    sub.on("error", (error) =>
      console.error("Redis subscriber:", error.message),
    );
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([pub.connect(), sub.connect()]),
        new Promise<never>((_, reject) => {
          startupTimer = setTimeout(
            () => reject(new Error("Redis connection timed out")),
            10000,
          );
        }),
      ]);
      io.adapter(createAdapter(pub, sub));
    } catch (error) {
      if (pub.isOpen) pub.destroy();
      if (sub.isOpen) sub.destroy();
      await new Promise<void>((done) => io.close(() => done()));
      throw error;
    } finally {
      clearTimeout(startupTimer);
    }
  }

  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && origin !== options.origin) throw forbidden();
      if (viewers.size >= 500)
        throw new ApiError(503, "BUSY", "Try again later");
      const session = await auth.session(socket.handshake.headers.cookie);
      if (socket.handshake.auth.csrfToken !== session.csrf_token)
        throw forbidden();
      next();
    } catch (error) {
      next(new Error(error instanceof ApiError ? error.code : "UNAVAILABLE"));
    }
  });
  io.on("connection", (socket) => {
    const viewer = {
      cookie: socket.handshake.headers.cookie ?? "",
      workspaceId: undefined as string | undefined,
    };
    viewers.set(socket.id, viewer);
    let busy = false;
    let lastWatch = 0;
    socket.on("workspace:watch", async (input: unknown, ack: Ack) => {
      if (typeof ack !== "function") return;
      if (busy || Date.now() - lastWatch < 100)
        return ack({ ok: false, code: "RATE_LIMITED" });
      busy = true;
      lastWatch = Date.now();
      viewer.workspaceId = undefined;
      try {
        const { workspaceId } = watch.parse(input);
        const session = await auth.session(viewer.cookie);
        await membership(options.db, workspaceId, session.user_id);
        viewer.workspaceId = workspaceId;
        ack({ ok: true });
      } catch (error) {
        ack({
          ok: false,
          code: error instanceof ApiError ? error.code : "INVALID_REQUEST",
        });
        if (error instanceof ApiError && error.status === 401)
          socket.disconnect(true);
      } finally {
        busy = false;
      }
    });
    socket.on("disconnect", () => viewers.delete(socket.id));
  });

  async function notifySocket(socket: Socket, change: TicketChange) {
    const viewer = viewers.get(socket.id);
    if (!viewer || viewer.workspaceId !== change.workspaceId) return;
    try {
      const session = await auth.session(viewer.cookie);
      await tickets.get(session.user_id, change.workspaceId, change.ticketId);
      if (viewer.workspaceId === change.workspaceId && socket.connected)
        socket.emit("ticket:changed", change);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401) socket.disconnect(true);
        if ([401, 403, 404].includes(error.status)) return;
      }
      console.error("Notification lookup failed:", error);
    }
  }
  const pending = new Set<Promise<void>>();
  function local(change: TicketChange) {
    for (const socket of io.of("/").sockets.values()) {
      const job = notifySocket(socket, change);
      pending.add(job);
      void job.finally(() => pending.delete(job));
    }
  }
  io.on("ticket:changed", (input: unknown) => {
    const parsed = changeSchema.safeParse(input);
    if (parsed.success) local(parsed.data);
  });
  function changed(change: TicketChange) {
    local(change);
    // Notifications are hints. Committed messages remain available if Redis is down.
    if (pub?.isReady && sub?.isReady)
      io.serverSideEmit("ticket:changed", change);
  }
  ticketRoutes(app, tickets, changed);
  if (options.webDirectory)
    app.use(express.static(resolve(options.webDirectory)));
  finish();
  return {
    app,
    auth,
    tickets,
    io,
    changed,
    async listen(port = 0, host = "127.0.0.1") {
      await new Promise<void>((done, reject) => {
        http.once("error", reject);
        http.listen(port, host, () => {
          http.off("error", reject);
          done();
        });
      });
      const address = http.address();
      if (!address || typeof address === "string")
        throw new Error("Missing server address");
      return `http://${host}:${address.port}`;
    },
    async close() {
      await new Promise<void>((done) => io.close(() => done()));
      await Promise.allSettled(pending);
      await Promise.all([
        pub?.isOpen ? pub.close() : undefined,
        sub?.isOpen ? sub.close() : undefined,
      ]);
    },
  };
}
