import { hashPassword } from "../auth.js";
import type { Database } from "./database.js";
export const demo = {
  acme: "00000000-0000-4000-8000-000000000001",
  orbit: "00000000-0000-4000-8000-000000000002",
  admin: "10000000-0000-4000-8000-000000000001",
  agent: "10000000-0000-4000-8000-000000000002",
  alice: "10000000-0000-4000-8000-000000000003",
  bob: "10000000-0000-4000-8000-000000000004",
  outsider: "10000000-0000-4000-8000-000000000005",
  orbitAgent: "10000000-0000-4000-8000-000000000006",
};
export async function seedDemo(db: Database, password: string) {
  if (password.length < 12)
    throw new Error("Demo password must have at least 12 characters");
  const hash = await hashPassword(password);
  await db.transaction(async (tx) => {
    for (const [id, name] of [
      [demo.acme, "Acme"],
      [demo.orbit, "Orbit"],
    ]) {
      await tx.query(
        "INSERT INTO workspaces VALUES($1,$2) ON CONFLICT DO NOTHING",
        [id, name],
      );
    }
    const people = [
      [demo.admin, "admin@acme.test", "Ada", demo.acme, "ADMIN"],
      [demo.agent, "agent@acme.test", "Sam", demo.acme, "AGENT"],
      [demo.alice, "alice@acme.test", "Alice", demo.acme, "CUSTOMER"],
      [demo.bob, "bob@acme.test", "Bob", demo.acme, "CUSTOMER"],
      [demo.outsider, "eve@orbit.test", "Eve", demo.orbit, "CUSTOMER"],
      [demo.orbitAgent, "agent@orbit.test", "Oscar", demo.orbit, "AGENT"],
    ];
    for (const [id, email, name, workspace, role] of people) {
      await tx.query(
        "INSERT INTO users VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [id, email, name, hash],
      );
      await tx.query(
        "INSERT INTO memberships VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [workspace, id, role],
      );
    }
  });
}
