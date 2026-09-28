import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { Tickets } from "../server/tickets.js";
import { ticketRoutes } from "../server/ticket-routes.js";
import type { Database } from "../server/db/database.js";
import { seedDemo, demo } from "../server/db/seed.js";
import { testDatabase, clearDatabase } from "./database.js";

let db: Database;
let runtime: ReturnType<typeof createApp>;
let tickets: Tickets;
const base = `/api/workspaces/${demo.acme}/tickets`;
beforeAll(async () => {
  db = await testDatabase();
});
beforeEach(async () => {
  await clearDatabase(db);
  await seedDemo(db, "demo-support-password");
  runtime = createApp({ db, origin: "http://localhost:8080" });
  tickets = new Tickets(db);
  ticketRoutes(runtime.app, tickets);
  runtime.finish();
});
afterAll(async () => {
  await db.close();
});
async function login(email: string) {
  const result = await request(runtime.app)
    .post("/api/auth/login")
    .send({ email, password: "demo-support-password" })
    .expect(200);
  return {
    Cookie: result.headers["set-cookie"],
    "X-CSRF-Token": result.body.csrfToken as string,
  };
}
const create = () =>
  tickets.create(demo.alice, demo.acme, {
    subject: "Private conversation",
    priority: "NORMAL",
    body: "Private message",
  });

test("HTTP history and mutation routes reject other customers, foreign staff and nonexistent tickets", async () => {
  const ticket = await create();
  const path = `${base}/${ticket.id}`;
  for (const email of ["bob@acme.test", "agent@orbit.test"]) {
    const session = await login(email);
    await request(runtime.app).get(path).set(session).expect(404);
    await request(runtime.app).get(`${path}/messages`).set(session).expect(404);
    await request(runtime.app)
      .patch(path)
      .set(session)
      .send({ version: 1, status: "RESOLVED" })
      .expect(404);
    await request(runtime.app)
      .post(`${path}/messages`)
      .set(session)
      .send({ clientId: randomUUID(), body: "Intrusion" })
      .expect(404);
  }
  const alice = await login("alice@acme.test");
  await request(runtime.app)
    .patch(path)
    .set(alice)
    .send({ version: 1, status: "RESOLVED" })
    .expect(403);
  await request(runtime.app)
    .get(`${base}/${randomUUID()}`)
    .set(alice)
    .expect(404);
  const agent = await login("agent@acme.test");
  await request(runtime.app)
    .post(base)
    .set(agent)
    .send({ subject: "Spoofed customer", body: "No" })
    .expect(403);
  expect((await tickets.get(demo.alice, demo.acme, ticket.id)).version).toBe(1);
  expect(
    (await tickets.messages(demo.alice, demo.acme, ticket.id, 0)).messages,
  ).toHaveLength(1);
});

test("HTTP validation accepts documented limits and rejects oversized or invalid input without saving it", async () => {
  const session = await login("alice@acme.test");
  const created = await request(runtime.app)
    .post(base)
    .set(session)
    .send({
      subject: "s".repeat(160),
      body: "m".repeat(4000),
      priority: "HIGH",
    })
    .expect(201);
  const path = `${base}/${created.body.id}`;
  for (const body of [
    { subject: "s".repeat(161), body: "Message" },
    { subject: "Subject", body: "m".repeat(4001) },
    { subject: "Subject", body: "Message", priority: "URGENT" },
  ])
    await request(runtime.app).post(base).set(session).send(body).expect(400);
  await request(runtime.app)
    .post(`${path}/messages`)
    .set(session)
    .send({ clientId: randomUUID(), body: "m".repeat(4000) })
    .expect(201);
  await request(runtime.app)
    .post(`${path}/messages`)
    .set(session)
    .send({ clientId: randomUUID(), body: "m".repeat(4001) })
    .expect(400);
  await request(runtime.app)
    .post(`${path}/messages`)
    .set(session)
    .send({ clientId: "invalid", body: "Hello" })
    .expect(400);
  await request(runtime.app)
    .post(base)
    .set(session)
    .send({ subject: "Large", body: "x".repeat(33000) })
    .expect(413);
  await request(runtime.app).get(`${base}/invalid-id`).set(session).expect(400);
  expect((await tickets.list(demo.alice, demo.acme, 0)).items).toHaveLength(1);
  expect(
    (await tickets.messages(demo.alice, demo.acme, created.body.id, 0))
      .messages,
  ).toHaveLength(2);
});

test("HTTP writes require CSRF and stale or malformed ticket updates do not overwrite the winner", async () => {
  const alice = await login("alice@acme.test");
  const agent = await login("agent@acme.test");
  const ticket = await create();
  const path = `${base}/${ticket.id}`;
  await request(runtime.app)
    .post(base)
    .set("Cookie", alice.Cookie)
    .send({ subject: "Missing CSRF", body: "No" })
    .expect(403);
  await request(runtime.app)
    .post(`${path}/messages`)
    .set("Cookie", alice.Cookie)
    .send({ clientId: randomUUID(), body: "No" })
    .expect(403);
  await request(runtime.app)
    .patch(path)
    .set("Cookie", agent.Cookie)
    .send({ version: 1, status: "PENDING" })
    .expect(403);
  for (const body of [
    { version: 1 },
    { version: 0, status: "OPEN" },
    { version: 1, status: "UNKNOWN" },
    { version: 1, customer_id: demo.bob },
  ]) {
    await request(runtime.app).patch(path).set(agent).send(body).expect(400);
  }
  await request(runtime.app)
    .patch(path)
    .set(agent)
    .send({ version: 1, status: "PENDING", priority: "HIGH" })
    .expect(200);
  const stale = await request(runtime.app)
    .patch(path)
    .set(agent)
    .send({ version: 1, status: "RESOLVED" })
    .expect(409);
  expect(stale.body.code).toBe("VERSION_CONFLICT");
  expect(
    (await request(runtime.app).get(path).set(alice).expect(200)).body,
  ).toMatchObject({ version: 2, status: "PENDING", priority: "HIGH" });
  expect(
    (await tickets.messages(demo.alice, demo.acme, ticket.id, 0)).messages,
  ).toHaveLength(1);
});
