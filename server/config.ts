import { z } from "zod";
export function config(env: NodeJS.ProcessEnv = process.env) {
  const origin = z.url().parse(env.APP_ORIGIN ?? "http://localhost:8080");
  if (new URL(origin).origin !== origin || !/^https?:/.test(origin))
    throw new Error(
      "APP_ORIGIN must be an http(s) origin without a trailing slash",
    );
  return {
    databaseUrl: z.string().min(1).parse(env.DATABASE_URL),
    redisUrl: z.url().parse(env.REDIS_URL),
    origin,
    port: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(env.PORT ?? 8080),
    secureCookies:
      z
        .enum(["true", "false"])
        .parse(env.SECURE_COOKIES ?? String(origin.startsWith("https:"))) ===
      "true",
  };
}
