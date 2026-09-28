import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { Database } from "./database.js";

export async function migrate(
  db: Database,
  directory = "server/db/migrations",
) {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL)",
  );
  await db.transaction(async (tx) => {
    await tx.query("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
    for (const name of (await readdir(directory))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(`${directory}/${name}`, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const [existing] = await tx.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE name = $1",
        [name],
      );
      if (existing) {
        if (existing.checksum !== checksum)
          throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      // Migration files contain plain DDL, without procedural bodies or semicolons in literals.
      for (const statement of sql
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)) {
        await tx.query(statement);
      }
      await tx.query("INSERT INTO schema_migrations VALUES ($1, $2)", [
        name,
        checksum,
      ]);
    }
  });
}
