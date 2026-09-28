import express from "express";
import helmet from "helmet";
import { z } from "zod";
import type { Database } from "./db/database.js";
import { Auth, membership } from "./auth.js";
import { ApiError, errors, forbidden } from "./errors.js";
import type { Agent } from "./contracts.js";

export interface AppOptions {
  db: Database;
  origin: string;
  secureCookies?: boolean;
  sessionTtlMs?: number;
}
const id = z.string().uuid();
export function createApp(options: AppOptions) {
  const { db, origin, secureCookies = false } = options;
  const app = express();
  const auth = new Auth(db, options.sessionTtlMs);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "script-src": ["'self'"],
          "connect-src": ["'self'", origin.replace(/^http/, "ws")],
          "upgrade-insecure-requests": null,
        },
      },
    }),
  );
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", (req, _res, next) => {
    if (req.get("Origin") && req.get("Origin") !== origin) throw forbidden();
    if (
      ["POST", "PATCH", "PUT"].includes(req.method) &&
      !req.is("application/json")
    )
      throw new ApiError(415, "JSON_REQUIRED", "Use application/json");
    next();
  });
  app.get("/api/health", async (_req, res) => {
    await db.query("SELECT 1");
    res.json({ status: "ok" });
  });
  const attempts = new Map<string, { count: number; expires: number }>();
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: secureCookies,
    path: "/",
  };
  app.post("/api/auth/login", async (req, res) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    for (const [ip, value] of attempts)
      if (value.expires <= now) attempts.delete(ip);
    const attempt = attempts.get(key) ?? { count: 0, expires: now + 60000 };
    if (++attempt.count > 20 || attempts.size >= 10000)
      throw new ApiError(429, "RATE_LIMITED", "Try again in a minute");
    attempts.set(key, attempt);
    const body = z
      .object({
        email: z.string().email().max(254),
        password: z.string().min(1).max(256),
      })
      .strict()
      .parse(req.body);
    const session = await auth.login(body.email, body.password);
    res.cookie("support_session", session.token, {
      ...cookieOptions,
      maxAge: options.sessionTtlMs ?? 8 * 60 * 60 * 1000,
    });
    res.json({ csrfToken: session.csrf });
  });
  app.use("/api", auth.middleware());
  app.get("/api/me", async (_req, res) => {
    const session = res.locals.session;
    res.json({
      user: { id: session.user_id, email: session.email, name: session.name },
      csrfToken: session.csrf_token,
      workspaces: await auth.workspaces(session.user_id),
    });
  });
  app.post("/api/auth/logout", async (_req, res) => {
    await auth.logout(res.locals.session);
    res.clearCookie("support_session", cookieOptions).status(204).end();
  });
  app.get("/api/workspaces/:workspace/agents", async (req, res) => {
    const workspace = id.parse(req.params.workspace);
    const role = await membership(db, workspace, res.locals.session.user_id);
    if (role === "CUSTOMER") throw forbidden();
    res.json(
      await db.query<Agent>(
        `SELECT u.id,u.name,m.role FROM memberships m JOIN users u ON u.id=m.user_id
      WHERE m.workspace_id=$1 AND m.role IN ('AGENT','ADMIN') ORDER BY u.name`,
        [workspace],
      ),
    );
  });
  return {
    app,
    auth,
    finish() {
      app.use("/api", (_req, res) => {
        res.status(404).json({ code: "NOT_FOUND", message: "Route not found" });
      });
      app.use(errors);
    },
  };
}
