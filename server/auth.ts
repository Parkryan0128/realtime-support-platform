import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { parseCookie } from "cookie";
import type { RequestHandler } from "express";
import type { Database, Queryable } from "./db/database.js";
import { ApiError, forbidden, notFound } from "./errors.js";

const derive = promisify(scrypt);
export type Role = "CUSTOMER" | "AGENT" | "ADMIN";
export interface Session {
  token_hash: string;
  user_id: string;
  email: string;
  name: string;
  csrf_token: string;
  expires_at: Date;
}
export const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await derive(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex || hex.length !== 128) return false;
  const key = (await derive(password, salt, 64)) as Buffer;
  return timingSafeEqual(key, Buffer.from(hex, "hex"));
}

export class Auth {
  private dummyHash = hashPassword(randomBytes(24).toString("hex"));
  constructor(
    private db: Database,
    private ttlMs = 8 * 60 * 60 * 1000,
  ) {}

  async login(email: string, password: string) {
    const [user] = await this.db.query<{ id: string; password_hash: string }>(
      "SELECT id,password_hash FROM users WHERE email=$1",
      [email.toLowerCase()],
    );
    const valid = await verifyPassword(
      password,
      user?.password_hash ?? (await this.dummyHash),
    );
    if (!user || !valid)
      throw new ApiError(
        401,
        "INVALID_CREDENTIALS",
        "Email or password is incorrect",
      );
    const token = randomBytes(32).toString("hex");
    const csrf = randomBytes(32).toString("hex");
    await this.db.query("INSERT INTO sessions VALUES ($1,$2,$3,$4)", [
      digest(token),
      user.id,
      csrf,
      new Date(Date.now() + this.ttlMs),
    ]);
    return { token, csrf };
  }

  async session(cookieHeader?: string): Promise<Session> {
    const token = parseCookie(cookieHeader ?? "").support_session;
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      throw new ApiError(401, "UNAUTHENTICATED", "Sign in to continue");
    const [session] = await this.db.query<Session>(
      `SELECT s.*,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE token_hash=$1 AND expires_at>now()`,
      [digest(token)],
    );
    if (!session) throw new ApiError(401, "UNAUTHENTICATED", "Session expired");
    return session;
  }

  async logout(session: Session) {
    await this.db.query("DELETE FROM sessions WHERE token_hash=$1", [
      session.token_hash,
    ]);
  }
  async workspaces(userId: string) {
    return this.db.query<{ id: string; name: string; role: Role }>(
      `SELECT w.id,w.name,m.role FROM workspaces w
      JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.name`,
      [userId],
    );
  }
  middleware(): RequestHandler {
    return async (request, response, next) => {
      const session = await this.session(request.headers.cookie);
      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        request.get("X-CSRF-Token") !== session.csrf_token
      )
        throw forbidden();
      response.locals.session = session;
      next();
    };
  }
}

export async function membership(
  db: Queryable,
  workspace: string,
  user: string,
): Promise<Role> {
  const [member] = await db.query<{ role: Role }>(
    "SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2",
    [workspace, user],
  );
  if (!member) throw notFound();
  return member.role;
}
