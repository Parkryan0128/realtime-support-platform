import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { testDatabase, clearDatabase } from "./database.js";
import { demo, seedDemo } from "../server/db/seed.js";
import { Tickets } from "../server/tickets.js";
import { createApp } from "../server/app.js";
import { ticketRoutes } from "../server/ticket-routes.js";
import type { Database } from "../server/db/database.js";
let db: Database, tickets: Tickets;
beforeAll(async () => {
  db = await testDatabase();
  tickets = new Tickets(db);
});
beforeEach(async () => {
  await clearDatabase(db);
  await seedDemo(db, "demo-support-password");
});
afterAll(async () => {
  await db.close();
});
const create = () =>
  tickets.create(demo.alice, demo.acme, {
    subject: "Cannot sign in",
    priority: "NORMAL",
    body: "Please help",
  });
const code = (value: string) => expect.objectContaining({ code: value });

test("ticket creation saves its first message in the same transaction", async () => {
  const ticket = await create();
  const history = await tickets.messages(demo.alice, demo.acme, ticket.id, 0);
  expect(ticket.status).toBe("OPEN");
  expect(ticket.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  expect(history.messages.map((m) => m.sequence)).toEqual([1]);
  expect(history.messages[0].body).toBe("Please help");
  expect(history.messages[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
});
test("customers and agents cannot access tickets across ownership or workspace boundaries", async () => {
  const t = await create();
  for (const [user, workspace] of [
    [demo.bob, demo.acme],
    [demo.outsider, demo.acme],
    [demo.agent, demo.orbit],
  ]) {
    await expect(tickets.get(user, workspace, t.id)).rejects.toEqual(
      code("NOT_FOUND"),
    );
    await expect(
      tickets.send(user, workspace, t.id, {
        clientId: randomUUID(),
        body: "Intrusion",
      }),
    ).rejects.toEqual(code("NOT_FOUND"));
  }
  expect((await tickets.list(demo.bob, demo.acme, 0)).items).toHaveLength(0);
});
test("parallel retries create exactly one message and one sequence number", async () => {
  const t = await create();
  const input = { clientId: randomUUID(), body: "One message" };
  const responses = await Promise.all(
    Array.from({ length: 20 }, () =>
      tickets.send(demo.alice, demo.acme, t.id, input),
    ),
  );
  expect(new Set(responses.map((m) => m.id)).size).toBe(1);
  expect(
    (await tickets.messages(demo.agent, demo.acme, t.id, 0)).messages.map(
      (m) => m.sequence,
    ),
  ).toEqual([1, 2]);
  await expect(
    tickets.send(demo.alice, demo.acme, t.id, { ...input, body: "Changed" }),
  ).rejects.toEqual(code("MESSAGE_CONFLICT"));
});
test("simultaneous messages have a gap-free per-ticket sequence", async () => {
  const t = await create();
  await Promise.all(
    Array.from({ length: 15 }, (_, i) =>
      tickets.send(demo.agent, demo.acme, t.id, {
        clientId: randomUUID(),
        body: `Reply ${i}`,
      }),
    ),
  );
  expect(
    (await tickets.messages(demo.alice, demo.acme, t.id, 1)).messages.map(
      (m) => m.sequence,
    ),
  ).toEqual(Array.from({ length: 15 }, (_, i) => i + 2));
});
test("optimistic versions prevent a lost assignment or status update", async () => {
  const t = await create();
  const results = await Promise.allSettled([
    tickets.update(demo.admin, demo.acme, t.id, {
      version: 1,
      assigneeId: demo.agent,
    }),
    tickets.update(demo.admin, demo.acme, t.id, {
      version: 1,
      status: "PENDING",
    }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    results.filter((r) => r.status === "rejected").map((r) => r.reason),
  ).toEqual([code("VERSION_CONFLICT")]);
});
test("only staff can update tickets, and only admins assign another agent", async () => {
  const t = await create();
  await expect(
    tickets.update(demo.alice, demo.acme, t.id, {
      version: 1,
      status: "RESOLVED",
    }),
  ).rejects.toEqual(code("FORBIDDEN"));
  await expect(
    tickets.update(demo.agent, demo.acme, t.id, {
      version: 1,
      assigneeId: demo.admin,
    }),
  ).rejects.toEqual(code("FORBIDDEN"));
  await expect(
    tickets.update(demo.admin, demo.acme, t.id, {
      version: 1,
      assigneeId: demo.orbitAgent,
    }),
  ).rejects.toEqual(code("INVALID_ASSIGNEE"));
  expect(
    (
      await tickets.update(demo.agent, demo.acme, t.id, {
        version: 1,
        assigneeId: demo.agent,
      })
    ).assignee_id,
  ).toBe(demo.agent);
});
test("resolved tickets reject new messages but allow retries and explicit reopening", async () => {
  const t = await create();
  const input = { clientId: randomUUID(), body: "Thank you" };
  const message = await tickets.send(demo.alice, demo.acme, t.id, input);
  await tickets.update(demo.agent, demo.acme, t.id, {
    version: 1,
    status: "RESOLVED",
  });
  expect((await tickets.send(demo.alice, demo.acme, t.id, input)).id).toBe(
    message.id,
  );
  await expect(
    tickets.send(demo.agent, demo.acme, t.id, {
      clientId: randomUUID(),
      body: "New",
    }),
  ).rejects.toEqual(code("TICKET_RESOLVED"));
  await expect(
    tickets.update(demo.agent, demo.acme, t.id, {
      version: 2,
      status: "PENDING",
    }),
  ).rejects.toEqual(code("INVALID_TRANSITION"));
  await tickets.update(demo.agent, demo.acme, t.id, {
    version: 2,
    status: "OPEN",
  });
  expect(
    (
      await tickets.send(demo.agent, demo.acme, t.id, {
        clientId: randomUUID(),
        body: "Reopened",
      })
    ).sequence,
  ).toBe(3);
});
test("reconnect cursors page through durable messages without gaps", async () => {
  const t = await create();
  for (let i = 0; i < 105; i++)
    await tickets.send(demo.agent, demo.acme, t.id, {
      clientId: randomUUID(),
      body: `Reply ${i}`,
    });
  const first = await tickets.messages(demo.alice, demo.acme, t.id, 0);
  const next = await tickets.messages(
    demo.alice,
    demo.acme,
    t.id,
    first.nextCursor,
  );
  expect(first.messages).toHaveLength(100);
  expect(first.hasMore).toBe(true);
  expect(next.messages.map((m) => m.sequence)).toEqual([
    101, 102, 103, 104, 105, 106,
  ]);
  expect(next.hasMore).toBe(false);
});
test("message/resolve races either save before resolution or reject without a partial write", async () => {
  const t = await create();
  const results = await Promise.allSettled([
    tickets.send(demo.alice, demo.acme, t.id, {
      clientId: randomUUID(),
      body: "Racing",
    }),
    tickets.update(demo.agent, demo.acme, t.id, {
      version: 1,
      status: "RESOLVED",
    }),
  ]);
  const history = await tickets.messages(demo.alice, demo.acme, t.id, 0);
  expect((await tickets.get(demo.agent, demo.acme, t.id)).status).toBe(
    "RESOLVED",
  );
  expect(history.messages).toHaveLength(
    results[0].status === "fulfilled" ? 2 : 1,
  );
});
test("HTTP validation rejects spoofed owners, blank messages and invalid cursors", async () => {
  const runtime = createApp({ db, origin: "http://localhost:8080" });
  ticketRoutes(runtime.app, tickets);
  runtime.finish();
  const login = await request(runtime.app)
    .post("/api/auth/login")
    .send({ email: "alice@acme.test", password: "demo-support-password" });
  const client = request(runtime.app);
  const cookie = login.headers["set-cookie"];
  const token = login.body.csrfToken;
  await client
    .post(`/api/workspaces/${demo.acme}/tickets`)
    .set("Cookie", cookie)
    .set("X-CSRF-Token", token)
    .send({ subject: "Test", body: "Hi", customer_id: demo.bob })
    .expect(400);
  const created = await client
    .post(`/api/workspaces/${demo.acme}/tickets`)
    .set("Cookie", cookie)
    .set("X-CSRF-Token", token)
    .send({ subject: "Test", body: "Hi" })
    .expect(201);
  const path = `/api/workspaces/${demo.acme}/tickets/${created.body.id}/messages`;
  await client
    .post(path)
    .set("Cookie", cookie)
    .set("X-CSRF-Token", token)
    .send({ clientId: randomUUID(), body: " " })
    .expect(400);
  await client
    .get(path + "?after=-1")
    .set("Cookie", cookie)
    .expect(400);
});

test("the inbox paginates, searches and filters without mixing customers or workspaces", async () => {
  const ids: string[] = [];
  for (let i = 0; i < 52; i++) {
    const ticket = await tickets.create(demo.alice, demo.acme, {
      subject: `Refund ${i}`,
      priority: "NORMAL",
      body: "Help",
    });
    ids.push(ticket.id);
    await db.query("UPDATE tickets SET updated_at=$1 WHERE id=$2", [
      new Date(Date.UTC(2025, 0, 1, 0, 0, i)),
      ticket.id,
    ]);
  }
  await tickets.create(demo.bob, demo.acme, {
    subject: "Refund private",
    priority: "NORMAL",
    body: "Bob only",
  });
  await tickets.create(demo.outsider, demo.orbit, {
    subject: "Refund elsewhere",
    priority: "NORMAL",
    body: "Orbit only",
  });
  const first = await tickets.list(demo.alice, demo.acme, 0);
  const second = await tickets.list(demo.alice, demo.acme, 1);
  expect(first.items.map((t) => t.id)).toEqual([...ids].reverse().slice(0, 50));
  expect(first.hasMore).toBe(true);
  expect(second.items.map((t) => t.id)).toEqual([...ids].reverse().slice(50));
  expect(second.hasMore).toBe(false);
  expect(await tickets.list(demo.alice, demo.acme, 2)).toMatchObject({
    items: [],
    hasMore: false,
  });
  await tickets.update(demo.agent, demo.acme, ids[0], {
    version: 1,
    status: "PENDING",
  });
  expect(
    (
      await tickets.list(demo.agent, demo.acme, 0, "PENDING", "rEFuND")
    ).items.map((t) => t.id),
  ).toEqual([ids[0]]);
  expect(
    (await tickets.list(demo.alice, demo.acme, 0, undefined, "private")).items,
  ).toEqual([]);
  expect(
    (await tickets.list(demo.agent, demo.acme, 0, undefined, "elsewhere"))
      .items,
  ).toEqual([]);
  expect(
    (await tickets.list(demo.agent, demo.acme, 0, undefined, "missing phrase"))
      .items,
  ).toEqual([]);
});

test("admins can reassign tickets while agents cannot take or release someone else's assignment", async () => {
  const ticket = await create();
  const assigned = await tickets.update(demo.admin, demo.acme, ticket.id, {
    version: 1,
    assigneeId: demo.admin,
    priority: "HIGH",
    status: "PENDING",
  });
  expect(assigned).toMatchObject({
    version: 2,
    assignee_id: demo.admin,
    priority: "HIGH",
    status: "PENDING",
  });
  for (const assigneeId of [demo.agent, null]) {
    await expect(
      tickets.update(demo.agent, demo.acme, ticket.id, {
        version: 2,
        assigneeId,
      }),
    ).rejects.toEqual(code("FORBIDDEN"));
  }
  expect((await tickets.get(demo.admin, demo.acme, ticket.id)).version).toBe(2);
  const reassigned = await tickets.update(demo.admin, demo.acme, ticket.id, {
    version: 2,
    assigneeId: demo.agent,
  });
  expect(reassigned).toMatchObject({
    version: 3,
    assignee_id: demo.agent,
    priority: "HIGH",
    status: "PENDING",
  });
  const released = await tickets.update(demo.agent, demo.acme, ticket.id, {
    version: 3,
    assigneeId: null,
  });
  expect(released).toMatchObject({ version: 4, assignee_id: null });
});

test("a failed message insert rolls back both ticket creation and sequence allocation", async () => {
  await db.query(
    "ALTER TABLE messages ADD CONSTRAINT reject_test_message CHECK (body <> 'forced failure')",
  );
  try {
    await expect(
      tickets.create(demo.alice, demo.acme, {
        subject: "Rollback",
        priority: "NORMAL",
        body: "forced failure",
      }),
    ).rejects.toMatchObject({ code: "23514" });
    expect(await db.query("SELECT id FROM tickets")).toEqual([]);
    expect(await db.query("SELECT id FROM messages")).toEqual([]);
    const ticket = await create();
    await expect(
      tickets.send(demo.alice, demo.acme, ticket.id, {
        clientId: randomUUID(),
        body: "forced failure",
      }),
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      (await tickets.get(demo.alice, demo.acme, ticket.id)).next_sequence,
    ).toBe(1);
    const saved = await tickets.send(demo.alice, demo.acme, ticket.id, {
      clientId: randomUUID(),
      body: "Retry after failure",
    });
    expect(saved.sequence).toBe(2);
    expect(
      (
        await tickets.messages(demo.alice, demo.acme, ticket.id, 0)
      ).messages.map((m) => m.sequence),
    ).toEqual([1, 2]);
  } finally {
    await db.query("ALTER TABLE messages DROP CONSTRAINT reject_test_message");
  }
});

test("message retry IDs are scoped to their sender and conversation", async () => {
  const first = await create();
  const second = await create();
  const input = { clientId: randomUUID(), body: "Shared client ID" };
  const messages = [
    await tickets.send(demo.alice, demo.acme, first.id, input),
    await tickets.send(demo.agent, demo.acme, first.id, input),
    await tickets.send(demo.alice, demo.acme, second.id, input),
  ];
  expect(new Set(messages.map((m) => m.id)).size).toBe(3);
  expect(messages.map((m) => m.sequence)).toEqual([2, 3, 2]);
  expect((await tickets.send(demo.alice, demo.acme, first.id, input)).id).toBe(
    messages[0].id,
  );
});
