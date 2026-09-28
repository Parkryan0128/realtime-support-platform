import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";
import { testDatabase, clearDatabase } from "./database.js";
import { seedDemo, demo } from "../server/db/seed.js";
import type { Database } from "../server/db/database.js";
let db: Database;
let runtime: ReturnType<typeof createApp>;
beforeAll(async () => {
  db = await testDatabase();
});
beforeEach(async () => {
  await clearDatabase(db);
  await seedDemo(db, "demo-support-password");
  runtime = createApp({ db, origin: "http://localhost:8080" });
  runtime.finish();
});
afterAll(async () => {
  await db.close();
});
const login = (email = "alice@acme.test") =>
  request(runtime.app)
    .post("/api/auth/login")
    .send({ email, password: "demo-support-password" });

test("passwords are verified and authentication uses an HttpOnly cookie", async () => {
  await request(runtime.app)
    .post("/api/auth/login")
    .send({ email: "alice@acme.test", password: "wrong" })
    .expect(401);
  await login("unknown@acme.test").expect(401);
  const response = await login();
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.headers["set-cookie"][0]).toContain("HttpOnly");
  expect(response.headers["set-cookie"][0]).toContain("SameSite=Lax");
  const me = await request(runtime.app)
    .get("/api/me")
    .set("Cookie", response.headers["set-cookie"])
    .expect(200);
  expect(me.headers["cache-control"]).toBe("no-store");
  expect(me.body.workspaces).toEqual([
    { id: demo.acme, name: "Acme", role: "CUSTOMER" },
  ]);
});

test("logging out one session leaves another session active and their CSRF tokens are not interchangeable", async () => {
  const first = await login();
  const second = await login();
  expect(first.headers["set-cookie"][0]).not.toBe(
    second.headers["set-cookie"][0],
  );
  await request(runtime.app)
    .post("/api/auth/logout")
    .set("Cookie", first.headers["set-cookie"])
    .set("X-CSRF-Token", second.body.csrfToken)
    .send({})
    .expect(403);
  await request(runtime.app)
    .post("/api/auth/logout")
    .set("Cookie", first.headers["set-cookie"])
    .set("X-CSRF-Token", first.body.csrfToken)
    .send({})
    .expect(204);
  await request(runtime.app)
    .get("/api/me")
    .set("Cookie", first.headers["set-cookie"])
    .expect(401);
  await request(runtime.app)
    .get("/api/me")
    .set("Cookie", second.headers["set-cookie"])
    .expect(200);
});
test("anonymous and expired sessions cannot access data", async () => {
  await request(runtime.app).get("/api/me").expect(401);
  const response = await login();
  await db.query("UPDATE sessions SET expires_at=now()-interval '1 second'");
  await request(runtime.app)
    .get("/api/me")
    .set("Cookie", response.headers["set-cookie"])
    .expect(401);
});
test("logout requires CSRF and revokes the server-side session", async () => {
  const response = await login();
  const cookie = response.headers["set-cookie"];
  await request(runtime.app)
    .post("/api/auth/logout")
    .set("Cookie", cookie)
    .send({})
    .expect(403);
  await request(runtime.app)
    .post("/api/auth/logout")
    .set("Cookie", cookie)
    .set("X-CSRF-Token", response.body.csrfToken)
    .send({})
    .expect(204);
  await request(runtime.app).get("/api/me").set("Cookie", cookie).expect(401);
});
test("customer cannot list agents and a staff account cannot enter another workspace", async () => {
  const alice = await login();
  await request(runtime.app)
    .get(`/api/workspaces/${demo.acme}/agents`)
    .set("Cookie", alice.headers["set-cookie"])
    .expect(403);
  const agent = await login("agent@acme.test");
  await request(runtime.app)
    .get(`/api/workspaces/${demo.orbit}/agents`)
    .set("Cookie", agent.headers["set-cookie"])
    .expect(404);
});
test("cross-origin and form-based login attempts are rejected", async () => {
  await request(runtime.app)
    .post("/api/auth/login")
    .set("Origin", "https://attacker.test")
    .send({})
    .expect(403);
  await request(runtime.app)
    .post("/api/auth/login")
    .type("form")
    .send({ email: "alice@acme.test", password: "demo-support-password" })
    .expect(415);
});
test("malformed JSON and repeated login attempts are bounded", async () => {
  await request(runtime.app)
    .post("/api/auth/login")
    .type("json")
    .send("{")
    .expect(400);
  for (let i = 0; i < 20; i++)
    await request(runtime.app).post("/api/auth/login").send({}).expect(400);
  await request(runtime.app).post("/api/auth/login").send({}).expect(429);
});
