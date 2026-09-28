import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const acme = "00000000-0000-4000-8000-000000000001";
async function login(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_PASSWORD ?? "demo-support-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}
async function create(page: Page, body = "My tracking link is not working.") {
  const subject = `Delivery ${randomUUID().slice(0, 8)}`;
  await page.getByRole("button", { name: "New request" }).click();
  await page.getByLabel("Subject", { exact: true }).fill(subject);
  await page.getByLabel("Describe the issue").fill(body);
  await page
    .getByRole("button", { name: "Create request", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: subject })).toBeVisible();
  return subject;
}
async function reply(page: Page, body: string) {
  await page.getByLabel("Reply", { exact: true }).fill(body);
  await page.getByRole("button", { name: "Send reply", exact: true }).click();
  await expect(
    page.getByRole("log").getByText(body, { exact: true }),
  ).toBeVisible();
}

test("customer and agent exchange live replies, recover after disconnect, assign and resolve", async ({
  browser,
}, testInfo) => {
  const customerContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const agentContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const customer = await customerContext.newPage();
  const agent = await agentContext.newPage();
  try {
    await login(customer, "alice@acme.test");
    await login(agent, "agent@acme.test");
    await expect(agent.getByRole("status")).toHaveText("Live");
    const subject = await create(customer);
    await agent.getByRole("button", { name: new RegExp(subject) }).click();
    await expect(agent.getByRole("log")).toContainText(
      "My tracking link is not working.",
    );
    await agent.getByRole("button", { name: "Assign to me" }).click();
    await expect(
      agent.getByRole("button", { name: "Unassign me" }),
    ).toBeVisible();
    await reply(agent, "I will check the carrier for you.");
    await expect(customer.getByRole("log")).toContainText(
      "I will check the carrier for you.",
    );
    await customerContext.setOffline(true);
    await expect(customer.getByRole("status")).toHaveText("Syncing every 15s");
    await reply(agent, "Here is your replacement tracking link.");
    await customerContext.setOffline(false);
    await expect(customer.getByRole("status")).toHaveText("Live");
    await expect(customer.getByRole("log")).toContainText(
      "Here is your replacement tracking link.",
    );
    await reply(customer, "That works, thank you!");
    await expect(agent.getByRole("log")).toContainText(
      "That works, thank you!",
    );
    await agent.getByLabel("Status", { exact: true }).selectOption("RESOLVED");
    await expect(
      customer.getByText("This conversation is resolved.", { exact: false }),
    ).toBeVisible();
    await expect(customer.getByLabel("Reply", { exact: true })).toHaveCount(0);
    await agent.screenshot({
      path: testInfo.outputPath("agent-inbox.png"),
      fullPage: true,
    });
    await agent.getByLabel("Status", { exact: true }).selectOption("OPEN");
    await expect(customer.getByLabel("Reply", { exact: true })).toBeVisible();
  } finally {
    await customerContext.close();
    await agentContext.close();
  }
});

test("a delayed conversation response cannot replace a newly selected conversation", async ({
  page,
}) => {
  await login(page, "alice@acme.test");
  const first = await create(
    page,
    "Only the first conversation contains this sentence.",
  );
  const second = await create(page, "This belongs to the second conversation.");
  const list = await (
    await page.request.get(
      `/api/workspaces/${acme}/tickets?q=${encodeURIComponent(first)}`,
    )
  ).json();
  const path = `**/tickets/${list.items[0].id}`;
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted = false;
  await page.route(
    path,
    async (route) => {
      const response = await route.fetch();
      intercepted = true;
      await delayed;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  try {
    await page.getByRole("button", { name: new RegExp(first) }).click();
    await expect.poll(() => intercepted).toBe(true);
    await page.getByRole("button", { name: new RegExp(second) }).click();
    await expect(page.getByRole("heading", { name: second })).toBeVisible();
    release();
    await page.unrouteAll({ behavior: "wait" });
    await expect(page.getByRole("log")).toContainText(
      "This belongs to the second conversation.",
    );
    await expect(page.getByRole("log")).not.toContainText(
      "Only the first conversation",
    );
    await expect(page.getByRole("heading", { name: second })).toBeVisible();
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("a lost HTTP response can be retried without storing a second message", async ({
  page,
}) => {
  await login(page, "alice@acme.test");
  const subject = await create(page);
  await page.route(
    "**/messages",
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page
    .getByLabel("Reply", { exact: true })
    .fill("Please save this exactly once.");
  await page.getByRole("button", { name: "Send reply", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry message" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry message" }).click();
  await expect(
    page.getByRole("button", { name: "Send reply", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("log")
      .getByText("Please save this exactly once.", { exact: true }),
  ).toHaveCount(1);
  const list = await (
    await page.request.get(
      `/api/workspaces/${acme}/tickets?q=${encodeURIComponent(subject)}`,
    )
  ).json();
  const history = await (
    await page.request.get(
      `/api/workspaces/${acme}/tickets/${list.items[0].id}/messages`,
    )
  ).json();
  expect(
    history.messages.filter(
      (m: { body: string }) => m.body === "Please save this exactly once.",
    ),
  ).toHaveLength(1);
});

test("switching customer accounts never exposes the previous account's conversation", async ({
  page,
}) => {
  await login(page, "alice@acme.test");
  const subject = await create(page);
  const list = await (
    await page.request.get(
      `/api/workspaces/${acme}/tickets?q=${encodeURIComponent(subject)}`,
    )
  ).json();
  await page.getByRole("button", { name: "Sign out" }).click();
  await login(page, "bob@acme.test");
  await expect(
    page.getByRole("button", { name: new RegExp(subject) }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: subject })).toHaveCount(0);
  expect(
    (
      await page.request.get(
        `/api/workspaces/${acme}/tickets/${list.items[0].id}`,
      )
    ).status(),
  ).toBe(404);
  await page.getByRole("button", { name: "Sign out" }).click();
  await login(page, "eve@orbit.test");
  await expect(
    page.getByRole("heading", { name: "Orbit", exact: true }),
  ).toBeVisible();
  expect(
    (await page.request.get(`/api/workspaces/${acme}/tickets`)).status(),
  ).toBe(404);
});

test("mobile customers can create and read a conversation without horizontal overflow", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "bob@acme.test");
  await create(page);
  await reply(page, "A quick follow-up from my phone.");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("mobile-inbox.png"),
    fullPage: true,
  });
});
