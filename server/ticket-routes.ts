import type { Express } from "express";
import { z } from "zod";
import { Tickets, createTicket, postMessage, updateTicket } from "./tickets.js";
import { statuses, type TicketChange } from "./contracts.js";

const uuid = z.string().uuid();
const routes = z.object({ workspace: uuid, ticket: uuid.optional() });
const numberParam = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(0).max(1_000_000));
const listQuery = z
  .object({
    page: numberParam.default(0),
    status: z.enum(statuses).optional(),
    q: z.string().max(160).default(""),
  })
  .strict();
const historyQuery = z.object({ after: numberParam.default(0) }).strict();
const ticketParams = routes.required();
export function ticketRoutes(
  app: Express,
  tickets: Tickets,
  changed: (change: TicketChange) => void = () => {},
) {
  const base = "/api/workspaces/:workspace/tickets";
  app.get(base, async (req, res) => {
    const { workspace } = routes.parse(req.params);
    const query = listQuery.parse(req.query);
    res.json(
      await tickets.list(
        res.locals.session.user_id,
        workspace,
        query.page,
        query.status,
        query.q,
      ),
    );
  });
  app.post(base, async (req, res) => {
    const { workspace } = routes.parse(req.params);
    const ticket = await tickets.create(
      res.locals.session.user_id,
      workspace,
      createTicket.parse(req.body),
    );
    changed({ workspaceId: workspace, ticketId: ticket.id });
    res.status(201).json(ticket);
  });
  app.get(base + "/:ticket", async (req, res) => {
    const { workspace, ticket } = ticketParams.parse(req.params);
    res.json(await tickets.get(res.locals.session.user_id, workspace, ticket));
  });
  app.patch(base + "/:ticket", async (req, res) => {
    const { workspace, ticket } = ticketParams.parse(req.params);
    const result = await tickets.update(
      res.locals.session.user_id,
      workspace,
      ticket,
      updateTicket.parse(req.body),
    );
    changed({ workspaceId: workspace, ticketId: ticket });
    res.json(result);
  });
  app.get(base + "/:ticket/messages", async (req, res) => {
    const { workspace, ticket } = ticketParams.parse(req.params);
    const { after } = historyQuery.parse(req.query);
    res.json(
      await tickets.messages(
        res.locals.session.user_id,
        workspace,
        ticket,
        after,
      ),
    );
  });
  app.post(base + "/:ticket/messages", async (req, res) => {
    const { workspace, ticket } = ticketParams.parse(req.params);
    const message = await tickets.send(
      res.locals.session.user_id,
      workspace,
      ticket,
      postMessage.parse(req.body),
    );
    changed({ workspaceId: workspace, ticketId: ticket });
    res.status(201).json(message);
  });
}
