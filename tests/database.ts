import { PGlite } from "@electric-sql/pglite";
import {
  postgres,
  type Database,
  type Queryable,
} from "../server/db/database.js";
import { migrate } from "../server/db/migrate.js";

export async function testDatabase(): Promise<Database> {
  let db: Database;
  if (process.env.TEST_DATABASE_URL) {
    db = postgres(process.env.TEST_DATABASE_URL);
  } else {
    const engine = new PGlite();
    const connection = (client: Pick<PGlite, "query">): Queryable => ({
      async query<T extends object>(sql: string, values: unknown[] = []) {
        return (await client.query<T>(sql, values)).rows;
      },
    });
    db = {
      ...connection(engine),
      transaction: (work) => engine.transaction((tx) => work(connection(tx))),
      close: () => engine.close(),
    };
  }
  await migrate(db);
  return db;
}

export async function clearDatabase(db: Database) {
  await db.query(
    "TRUNCATE messages, tickets, sessions, memberships, workspaces, users CASCADE",
  );
}
