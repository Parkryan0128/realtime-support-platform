import { createServer } from "node:http";
import { resolve } from "node:path";
import express from "express";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { createApp, type AppOptions } from "./app.js";
import { membership } from "./auth.js";
import { ApiError, forbidden } from "./errors.js";
import type { TicketChange } from "./contracts.js";
import { Tickets } from "./tickets.js";
import { ticketRoutes } from "./ticket-routes.js";
import { notifications } from "./notifications.js";

const watch = z.object({ workspaceId: z.string().uuid() }).strict();
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
  const viewers = new Map<string, { cookie: string; workspaceId?: string }>();

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
  const redis = options.redisUrl
    ? await notifications(options.redisUrl, local)
    : undefined;
  function changed(change: TicketChange) {
    local(change);
    redis?.publish(change);
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
      await redis?.close();
    },
  };
}
