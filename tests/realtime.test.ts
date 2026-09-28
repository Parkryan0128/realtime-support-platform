import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  expect,
  test,
} from "vitest";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { testDatabase, clearDatabase } from "./database.js";
import type { Database } from "../server/db/database.js";
import { createRuntime } from "../server/runtime.js";
import { demo, seedDemo } from "../server/db/seed.js";

let db: Database;
let runtime: Awaited<ReturnType<typeof createRuntime>>;
let url: string;
const sockets: Socket[] = [];
const origin = "http://localhost:8080";
beforeAll(async () => {
  db = await testDatabase();
});
beforeEach(async () => {
  await clearDatabase(db);
  await seedDemo(db, "demo-support-password");
  runtime = await createRuntime({ db, origin });
  url = await runtime.listen();
});
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.disconnect());
  await runtime.close();
});
afterAll(async () => {
  await db.close();
});

async function login(email = "alice@acme.test") {
  const res = await request(runtime.app)
    .post("/api/auth/login")
    .send({ email, password: "demo-support-password" })
    .expect(200);
  return {
    cookie: res.headers["set-cookie"][0].split(";")[0],
    csrf: res.body.csrfToken as string,
  };
}
function connect(
  credentials: { cookie: string; csrf: string },
  socketOrigin = origin,
) {
  const socket = io(url, {
    transports: ["websocket"],
    reconnection: false,
    extraHeaders: { Cookie: credentials.cookie, Origin: socketOrigin },
    auth: { csrfToken: credentials.csrf },
  });
  sockets.push(socket);
  return socket;
}
function event<T>(socket: Socket, name: string): Promise<T> {
  return new Promise((done, reject) => {
    const timeout = setTimeout(() => {
      socket.off(name, receive);
      reject(new Error(`No ${name} event`));
    }, 3000);
    function receive(value: T) {
      clearTimeout(timeout);
      done(value);
    }
    socket.once(name, receive);
  });
}
async function watching(email = "alice@acme.test") {
  const credentials = await login(email);
  const socket = connect(credentials);
  await event(socket, "connect");
  expect(
    await socket
      .timeout(3000)
      .emitWithAck("workspace:watch", { workspaceId: demo.acme }),
  ).toEqual({ ok: true });
  return { socket, credentials };
}
async function create() {
  return runtime.tickets.create(demo.alice, demo.acme, {
    subject: "Delivery",
    priority: "NORMAL",
    body: "Where is it?",
  });
}

test("socket handshake rejects anonymous, forged CSRF and cross-origin connections", async () => {
  const valid = await login();
  for (const [credentials, source] of [
    [{ cookie: "", csrf: "" }, origin],
    [{ ...valid, csrf: "wrong" }, origin],
    [valid, "https://evil.test"],
  ] as const) {
    const socket = connect(credentials, source);
    const error = await event<Error>(socket, "connect_error");
    expect(error.message).toMatch(/UNAUTHENTICATED|FORBIDDEN/);
  }
});
test("subscriptions and outbound hints enforce tenant and customer ownership", async () => {
  const alice = await watching();
  const bob = await watching("bob@acme.test");
  const staff = await watching("agent@acme.test");
  const received: unknown[] = [];
  bob.socket.on("ticket:changed", (value) => received.push(value));
  const t = await create();
  const aliceEvent = event<{ ticketId: string }>(
    alice.socket,
    "ticket:changed",
  );
  const staffEvent = event(staff.socket, "ticket:changed");
  runtime.changed({ workspaceId: demo.acme, ticketId: t.id });
  expect((await aliceEvent).ticketId).toBe(t.id);
  await staffEvent;
  await new Promise((done) => setTimeout(done, 100));
  expect(received).toEqual([]);
  expect(
    await bob.socket
      .timeout(3000)
      .emitWithAck("workspace:watch", { workspaceId: demo.orbit }),
  ).toEqual({ ok: false, code: "NOT_FOUND" });
});
test("a revoked session is disconnected before another notification is delivered", async () => {
  const { socket, credentials } = await watching();
  const t = await create();
  await request(runtime.app)
    .post("/api/auth/logout")
    .set("Cookie", credentials.cookie)
    .set("X-CSRF-Token", credentials.csrf)
    .send({})
    .expect(204);
  const received: unknown[] = [];
  socket.on("ticket:changed", (value) => received.push(value));
  const disconnected = event(socket, "disconnect");
  runtime.changed({ workspaceId: demo.acme, ticketId: t.id });
  await disconnected;
  expect(received).toEqual([]);
});
test("reconnecting clients recover messages that were committed while offline", async () => {
  const { socket, credentials } = await watching();
  const t = await create();
  socket.disconnect();
  for (let i = 0; i < 3; i++) {
    await runtime.tickets.send(demo.agent, demo.acme, t.id, {
      clientId: randomUUID(),
      body: `Offline ${i}`,
    });
    runtime.changed({ workspaceId: demo.acme, ticketId: t.id });
  }
  const reconnected = connect(credentials);
  await event(reconnected, "connect");
  await reconnected
    .timeout(3000)
    .emitWithAck("workspace:watch", { workspaceId: demo.acme });
  const history = await request(runtime.app)
    .get(`/api/workspaces/${demo.acme}/tickets/${t.id}/messages?after=1`)
    .set("Cookie", credentials.cookie)
    .expect(200);
  expect(
    history.body.messages.map((m: { sequence: number }) => m.sequence),
  ).toEqual([2, 3, 4]);
});
