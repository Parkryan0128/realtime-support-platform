import { postgres } from "./db/database.js";
import { config } from "./config.js";
import { createRuntime } from "./runtime.js";

const settings = config();
const db = postgres(settings.databaseUrl);
try {
  const runtime = await createRuntime({
    db,
    origin: settings.origin,
    redisUrl: settings.redisUrl,
    secureCookies: settings.secureCookies,
    webDirectory: "dist/web",
  });
  await runtime.listen(settings.port, "0.0.0.0");
  console.log(`Support listening on port ${settings.port}`);
  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 10000).unref();
    try {
      await runtime.close();
      await db.close();
    } catch (error) {
      console.error("Shutdown failed:", error);
      process.exitCode = 1;
    } finally {
      clearTimeout(deadline);
    }
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
} catch (error) {
  await db.close();
  console.error("Startup failed:", error);
  process.exit(1);
}
