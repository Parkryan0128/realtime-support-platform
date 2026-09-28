import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { z } from "zod";
import type { TicketChange } from "./contracts.js";

const channel = "support:ticket-changed:v1";
const event = z
  .object({
    source: z.string().uuid(),
    workspaceId: z.string().uuid(),
    ticketId: z.string().uuid(),
  })
  .strict();

export async function notifications(
  url: string,
  receive: (change: TicketChange) => void,
) {
  const source = randomUUID();
  const publisher = createClient({ url, disableOfflineQueue: true });
  const subscriber = publisher.duplicate();
  publisher.on("error", (error) =>
    console.error("Redis publisher:", error.message),
  );
  subscriber.on("error", (error) =>
    console.error("Redis subscriber:", error.message),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        await Promise.all([publisher.connect(), subscriber.connect()]);
        await subscriber.subscribe(channel, (payload) => {
          let input: unknown;
          try {
            input = JSON.parse(payload);
          } catch {
            return;
          }
          const parsed = event.safeParse(input);
          if (parsed.success && parsed.data.source !== source)
            receive({
              workspaceId: parsed.data.workspaceId,
              ticketId: parsed.data.ticketId,
            });
        });
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Redis connection timed out")),
          10000,
        );
      }),
    ]);
  } catch (error) {
    if (publisher.isOpen) publisher.destroy();
    if (subscriber.isOpen) subscriber.destroy();
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return {
    publish(change: TicketChange) {
      // A failed hint must not turn an already committed HTTP write into a failure.
      if (publisher.isReady)
        void publisher
          .publish(channel, JSON.stringify({ source, ...change }))
          .catch((error) =>
            console.error("Notification publish failed:", error.message),
          );
    },
    async close() {
      await Promise.all(
        [publisher, subscriber].map(async (client) => {
          if (client.isReady) await client.close();
          else if (client.isOpen) client.destroy();
        }),
      );
    },
  };
}
