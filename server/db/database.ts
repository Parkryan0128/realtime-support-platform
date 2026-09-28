import pg from "pg";

export interface Queryable {
  query<T extends object = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<T[]>;
}

export interface Database extends Queryable {
  transaction<T>(work: (connection: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function postgres(url: string): Database {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 5000,
  });
  pool.on("error", (error) =>
    console.error("Idle database connection failed", error.message),
  );
  const connection = (client: pg.Pool | pg.PoolClient): Queryable => ({
    async query<T extends object>(sql: string, values: unknown[] = []) {
      return (await client.query(sql, values)).rows as T[];
    },
  });
  return {
    ...connection(pool),
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '5s'");
        const result = await work(connection(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
