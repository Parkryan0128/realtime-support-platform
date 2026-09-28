import type { Session } from "./auth.js";

declare global {
  namespace Express {
    interface Locals {
      session: Session;
    }
  }
}
