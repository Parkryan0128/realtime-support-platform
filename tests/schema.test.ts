import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { testDatabase, clearDatabase } from "./database.js";
import { migrate } from "../server/db/migrate.js";
import type { Database } from "../server/db/database.js";
let db: Database;
beforeAll(async () => {
  db = await testDatabase();
});
beforeEach(async () => {
  await clearDatabase(db);
});
afterAll(async () => {
  await db.close();
});

test("migrations can be applied again without changing the schema", async () => {
  await migrate(db);
  expect(await db.query("SELECT name FROM schema_migrations")).toEqual([
    { name: "001_initial.sql" },
  ]);
});

test("database rejects a ticket assigned to a member of another workspace", async () => {
  const user = randomUUID(),
    one = randomUUID(),
    two = randomUUID();
  await db.query("INSERT INTO users VALUES ($1,$2,$3,$4)", [
    user,
    "user@test.local",
    "User",
    "hash",
  ]);
  await db.query("INSERT INTO workspaces VALUES ($1,$2),($3,$4)", [
    one,
    "One",
    two,
    "Two",
  ]);
  await db.query("INSERT INTO memberships VALUES ($1,$2,$3)", [
    one,
    user,
    "CUSTOMER",
  ]);
  await expect(
    db.query(
      "INSERT INTO tickets(id,workspace_id,customer_id,subject) VALUES($1,$2,$3,$4)",
      [randomUUID(), two, user, "Wrong workspace"],
    ),
  ).rejects.toThrow();
});

test("a failed transaction leaves no partially created workspace", async () => {
  const id = randomUUID();
  await expect(
    db.transaction(async (tx) => {
      await tx.query("INSERT INTO workspaces VALUES ($1,$2)", [id, "Rollback"]);
      throw new Error("fail after write");
    }),
  ).rejects.toThrow("fail after write");
  expect(
    await db.query("SELECT id FROM workspaces WHERE id=$1", [id]),
  ).toHaveLength(0);
});
