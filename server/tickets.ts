import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Queryable } from "./db/database.js";
import { membership } from "./auth.js";
import { ApiError, forbidden, notFound } from "./errors.js";
import type { Message, Ticket, TicketStatus } from "./contracts.js";

export const createTicket = z
  .object({
    subject: z.string().trim().min(1).max(160),
    priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("NORMAL"),
    body: z.string().trim().min(1).max(4000),
  })
  .strict();
export const postMessage = z
  .object({
    clientId: z.string().uuid(),
    body: z.string().trim().min(1).max(4000),
  })
  .strict();
export const updateTicket = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(["OPEN", "PENDING", "RESOLVED"]).optional(),
    priority: z.enum(["LOW", "NORMAL", "HIGH"]).optional(),
    assigneeId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.status !== undefined ||
      value.priority !== undefined ||
      value.assigneeId !== undefined,
  );
const selectTicket = `SELECT t.*,c.name AS customer_name,a.name AS assignee_name FROM tickets t
  JOIN users c ON c.id=t.customer_id LEFT JOIN users a ON a.id=t.assignee_id`;
const selectMessage = `SELECT m.id,m.ticket_id,m.sender_id,u.name AS sender_name,m.client_id,m.sequence,m.body,m.created_at
  FROM messages m JOIN users u ON u.id=m.sender_id`;

export class Tickets {
  constructor(private db: Database) {}

  async access(
    tx: Queryable,
    user: string,
    workspace: string,
    ticketId: string,
    mode: "read" | "lock" = "read",
  ) {
    const role = await membership(tx, workspace, user);
    const [ticket] = await tx.query<Ticket>(
      `${selectTicket} WHERE t.workspace_id=$1 AND t.id=$2
      AND ($4<>'CUSTOMER' OR t.customer_id=$3) ${mode === "lock" ? "FOR UPDATE OF t" : ""}`,
      [workspace, ticketId, user, role],
    );
    if (!ticket) throw notFound();
    return { ticket, role };
  }

  async get(user: string, workspace: string, ticket: string) {
    return (await this.access(this.db, user, workspace, ticket)).ticket;
  }

  async list(
    user: string,
    workspace: string,
    page: number,
    status?: string,
    search = "",
  ) {
    const role = await membership(this.db, workspace, user);
    const rows = await this.db.query<Ticket>(
      `${selectTicket} WHERE t.workspace_id=$1 AND ($2<>'CUSTOMER' OR t.customer_id=$3)
      AND ($4::text IS NULL OR t.status=$4) AND position(lower($5) in lower(t.subject))>0
      ORDER BY t.updated_at DESC,t.id DESC LIMIT 51 OFFSET $6`,
      [workspace, role, user, status ?? null, search, page * 50],
    );
    return { items: rows.slice(0, 50), hasMore: rows.length > 50, page };
  }

  async create(
    user: string,
    workspace: string,
    input: z.infer<typeof createTicket>,
  ) {
    return this.db.transaction(async (tx) => {
      if ((await membership(tx, workspace, user)) !== "CUSTOMER")
        throw forbidden();
      const ticketId = randomUUID();
      await tx.query(
        "INSERT INTO tickets(id,workspace_id,customer_id,subject,priority,next_sequence) VALUES($1,$2,$3,$4,$5,1)",
        [ticketId, workspace, user, input.subject, input.priority],
      );
      await tx.query(
        "INSERT INTO messages(id,workspace_id,ticket_id,sender_id,client_id,sequence,body) VALUES($1,$2,$3,$4,$5,1,$6)",
        [randomUUID(), workspace, ticketId, user, randomUUID(), input.body],
      );
      return (await this.access(tx, user, workspace, ticketId)).ticket;
    });
  }

  async update(
    user: string,
    workspace: string,
    ticketId: string,
    input: z.infer<typeof updateTicket>,
  ) {
    return this.db.transaction(async (tx) => {
      const { ticket, role } = await this.access(
        tx,
        user,
        workspace,
        ticketId,
        "lock",
      );
      if (role === "CUSTOMER") throw forbidden();
      if (ticket.version !== input.version)
        throw new ApiError(
          409,
          "VERSION_CONFLICT",
          "Ticket changed; refresh before editing",
        );
      if (ticket.status === "RESOLVED" && input.status === "PENDING")
        throw new ApiError(
          409,
          "INVALID_TRANSITION",
          "Reopen this ticket before putting it on hold",
        );
      if (input.assigneeId !== undefined) {
        if (
          role === "AGENT" &&
          ((input.assigneeId !== null && input.assigneeId !== user) ||
            (ticket.assignee_id !== null && ticket.assignee_id !== user))
        )
          throw forbidden();
        if (input.assigneeId !== null) {
          const [assignee] = await tx.query(
            "SELECT user_id FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND role IN ('AGENT','ADMIN')",
            [workspace, input.assigneeId],
          );
          if (!assignee)
            throw new ApiError(
              400,
              "INVALID_ASSIGNEE",
              "Choose an agent in this workspace",
            );
        }
      }
      await tx.query(
        `UPDATE tickets SET status=$3,priority=$4,assignee_id=$5,version=version+1,updated_at=now()
        WHERE workspace_id=$1 AND id=$2`,
        [
          workspace,
          ticketId,
          input.status ?? ticket.status,
          input.priority ?? ticket.priority,
          input.assigneeId === undefined
            ? ticket.assignee_id
            : input.assigneeId,
        ],
      );
      return (await this.access(tx, user, workspace, ticketId)).ticket;
    });
  }

  async messages(
    user: string,
    workspace: string,
    ticket: string,
    after: number,
  ) {
    await this.access(this.db, user, workspace, ticket);
    const rows = await this.db.query<Message>(
      `${selectMessage} WHERE m.workspace_id=$1 AND m.ticket_id=$2 AND m.sequence>$3 ORDER BY m.sequence LIMIT 101`,
      [workspace, ticket, after],
    );
    const messages = rows.slice(0, 100);
    return {
      messages,
      hasMore: rows.length > 100,
      nextCursor: messages.at(-1)?.sequence ?? after,
    };
  }

  async send(
    user: string,
    workspace: string,
    ticketId: string,
    input: z.infer<typeof postMessage>,
  ) {
    return this.db.transaction(async (tx) => {
      const { ticket } = await this.access(
        tx,
        user,
        workspace,
        ticketId,
        "lock",
      );
      const [existing] = await tx.query<Message>(
        `${selectMessage} WHERE m.ticket_id=$1 AND m.sender_id=$2 AND m.client_id=$3`,
        [ticketId, user, input.clientId],
      );
      if (existing) {
        if (existing.body !== input.body)
          throw new ApiError(
            409,
            "MESSAGE_CONFLICT",
            "Message ID was already used with different content",
          );
        return existing;
      }
      if (ticket.status === "RESOLVED")
        throw new ApiError(
          409,
          "TICKET_RESOLVED",
          "Reopen this ticket before sending a message",
        );
      const sequence = ticket.next_sequence + 1;
      const messageId = randomUUID();
      await tx.query(
        "UPDATE tickets SET next_sequence=$2,updated_at=now() WHERE id=$1",
        [ticketId, sequence],
      );
      await tx.query(
        "INSERT INTO messages(id,workspace_id,ticket_id,sender_id,client_id,sequence,body) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          messageId,
          workspace,
          ticketId,
          user,
          input.clientId,
          sequence,
          input.body,
        ],
      );
      return (
        await tx.query<Message>(`${selectMessage} WHERE m.id=$1`, [messageId])
      )[0];
    });
  }
}
