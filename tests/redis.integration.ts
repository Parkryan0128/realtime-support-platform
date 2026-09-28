import {
  afterAll,
  beforeAll,
  beforeEach,
  afterEach,
  expect,
  test,
} from "vitest";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { testDatabase, clearDatabase } from "./database.js";
import type { Database } from "../server/db/database.js";
import { createRuntime } from "../server/runtime.js";
import { seedDemo, demo } from "../server/db/seed.js";
import { randomUUID } from "node:crypto";
import { redisProxy } from "./redis-proxy.js";

let db: Database;
let first: Awaited<ReturnType<typeof createRuntime>>;
let second: typeof first;
let socket: Socket;
let url: string;
let proxy: Awaited<ReturnType<typeof redisProxy>>;
beforeAll(async () => {
  if (!process.env.REDIS_URL)
    throw new Error("Set REDIS_URL to run the two-server integration test");
  db = await testDatabase();
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await clearDatabase(db);
  await seedDemo(db, "demo-support-password");
  proxy = await redisProxy(process.env.REDIS_URL!);
  first = await createRuntime({
    db,
    origin: "http://localhost:8080",
    redisUrl: proxy.url,
  });
  second = await createRuntime({
    db,
    origin: "http://localhost:8080",
    redisUrl: proxy.url,
  });
  await first.listen();
  url = await second.listen();
});
afterEach(async () => {
  socket?.disconnect();
  await first?.close();
  await second?.close();
  await proxy?.stop();
});

test("HTTP writes and cursor recovery still work when Redis connections are severed", async () => {
  const session = await first.auth.login(
    "alice@acme.test",
    "demo-support-password",
  );
  const ticket = await first.tickets.create(demo.alice, demo.acme, {
    subject: "Redis outage",
    priority: "NORMAL",
    body: "First",
  });
  await proxy.stop();
  const path = `/api/workspaces/${demo.acme}/tickets/${ticket.id}/messages`;
  const input = { clientId: randomUUID(), body: "Saved during the outage" };
  const saved = await request(first.app)
    .post(path)
    .set("Cookie", `support_session=${session.token}`)
    .set("X-CSRF-Token", session.csrf)
    .send(input)
    .expect(201);
  const replay = await request(first.app)
    .post(path)
    .set("Cookie", `support_session=${session.token}`)
    .set("X-CSRF-Token", session.csrf)
    .send(input)
    .expect(201);
  expect(replay.body.id).toBe(saved.body.id);
  const history = await request(second.app)
    .get(path + "?after=1")
    .set("Cookie", `support_session=${session.token}`)
    .expect(200);
  expect(history.body.messages.map((m: { body: string }) => m.body)).toEqual([
    input.body,
  ]);
  expect(history.body.nextCursor).toBe(2);
});
test("a write on server A reaches a permitted client connected to server B through Redis", async () => {
  await watchOnSecondServer();
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

async function watchOnSecondServer() {
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
}

test("Redis reconnection restores cross-server notifications without restarting either app", async () => {
  await watchOnSecondServer();
  const ticket = await first.tickets.create(demo.alice, demo.acme, {
    subject: "Recovery",
    priority: "NORMAL",
    body: "First message",
  });
  const customer = await first.auth.login(
    "alice@acme.test",
    "demo-support-password",
  );
  const session = {
    Cookie: `support_session=${customer.token}`,
    "X-CSRF-Token": customer.csrf,
  };
  await proxy.stop();
  const path = `/api/workspaces/${demo.acme}/tickets/${ticket.id}/messages`;
  await request(first.app)
    .post(path)
    .set(session)
    .send({ clientId: randomUUID(), body: "During outage" })
    .expect(201);
  expect(
    (
      await request(second.app)
        .get(path + "?after=1")
        .set(session)
        .expect(200)
    ).body.messages,
  ).toHaveLength(1);
  const received: string[] = [];
  socket.on("ticket:changed", (change: { ticketId: string }) =>
    received.push(change.ticketId),
  );
  await proxy.restart();
  const retry = { clientId: randomUUID(), body: "After recovery" };
  await expect
    .poll(
      async () => {
        await request(first.app)
          .post(path)
          .set(session)
          .send(retry)
          .expect(201);
        return received;
      },
      { timeout: 10000, interval: 200 },
    )
    .toContain(ticket.id);
  const history = await request(second.app).get(path).set(session).expect(200);
  expect(history.body.messages.map((m: { body: string }) => m.body)).toEqual([
    "First message",
    "During outage",
    "After recovery",
  ]);
});
