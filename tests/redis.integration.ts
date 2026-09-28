import { afterAll, beforeAll, expect, test } from "vitest";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { testDatabase, clearDatabase } from "./database.js";
import type { Database } from "../server/db/database.js";
import { createRuntime } from "../server/runtime.js";
import { seedDemo, demo } from "../server/db/seed.js";

let db: Database;
let first: Awaited<ReturnType<typeof createRuntime>>;
let second: typeof first;
let socket: Socket;
let url: string;
beforeAll(async () => {
  if (!process.env.REDIS_URL)
    throw new Error("Set REDIS_URL to run the two-server integration test");
  db = await testDatabase();
  await clearDatabase(db);
  await seedDemo(db, "demo-support-password");
  first = await createRuntime({
    db,
    origin: "http://localhost:8080",
    redisUrl: process.env.REDIS_URL,
  });
  second = await createRuntime({
    db,
    origin: "http://localhost:8080",
    redisUrl: process.env.REDIS_URL,
  });
  await first.listen();
  url = await second.listen();
});
afterAll(async () => {
  socket?.disconnect();
  await first?.close();
  await second?.close();
  await db?.close();
});
test("a write on server A reaches a permitted client connected to server B through Redis", async () => {
  const session = await first.auth.login(
    "agent@acme.test",
    "demo-support-password",
  );
  socket = io(url, {
    transports: ["websocket"],
    reconnection: false,
    extraHeaders: { Cookie: `support_session=${session.token}` },
    auth: { csrfToken: session.csrf },
  });
  await new Promise<void>((done, reject) => {
    socket.once("connect", done);
    socket.once("connect_error", reject);
  });
  expect(
    await socket
      .timeout(3000)
      .emitWithAck("workspace:watch", { workspaceId: demo.acme }),
  ).toEqual({ ok: true });
  const incoming = new Promise<{ ticketId: string }>((done, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Redis notification not delivered")),
      3000,
    );
    socket.once("ticket:changed", (change) => {
      clearTimeout(timer);
      done(change);
    });
  });
  const customer = await first.auth.login(
    "alice@acme.test",
    "demo-support-password",
  );
  const created = await request(first.app)
    .post(`/api/workspaces/${demo.acme}/tickets`)
    .set("Cookie", `support_session=${customer.token}`)
    .set("X-CSRF-Token", customer.csrf)
    .send({ subject: "Two nodes", body: "Hello" })
    .expect(201);
  expect((await incoming).ticketId).toBe(created.body.id);
  expect(
    (await second.tickets.messages(demo.agent, demo.acme, created.body.id, 0))
      .messages[0].body,
  ).toBe("Hello");
});
