import { postgres } from "./db/database.js";
import { migrate } from "./db/migrate.js";
import { seedDemo } from "./db/seed.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const command = process.argv[2];
if (!["migrate", "seed", "init"].includes(command))
  throw new Error("Usage: cli <migrate|seed|init>");
const db = postgres(process.env.DATABASE_URL);
try {
  if (command !== "seed") {
    await migrate(db);
    console.log("Migrations applied");
  }
  if (
    command === "seed" ||
    (command === "init" && process.env.DEMO_SEED === "true")
  ) {
    if (!process.env.DEMO_PASSWORD)
      throw new Error("DEMO_PASSWORD is required for demo seeding");
    await seedDemo(db, process.env.DEMO_PASSWORD);
    console.log("Demo accounts ready (existing accounts were preserved)");
  }
} finally {
  await db.close();
}
