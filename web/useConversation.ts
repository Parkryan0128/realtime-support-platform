import { useEffect, useRef, useState } from "react";
import { HttpError, message, aborted, type Request } from "./api.js";
import type {
  Agent,
  Message,
  Ticket,
  TicketPatch,
  Workspace,
  MessagePage,
} from "../server/contracts.js";

export function useConversation({
  path,
  workspace,
  request,
  tick,
  refresh,
}: {
  path: string;
  workspace: Workspace;
  request: Request;
  tick: number;
  refresh: () => void;
}) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const pending = useRef<{ clientId: string; body: string } | null>(null);
  const cursor = useRef(0);
  const writes = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    writes.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const current = await request<Ticket>(path, {
        signal: controller.signal,
      });
      let after = cursor.current;
      const collected: Message[] = [];
      let more = true;
      while (more) {
        const page = await request<MessagePage>(
          `${path}/messages?after=${after}`,
          {
            signal: controller.signal,
          },
        );
        collected.push(...page.messages);
        after = page.nextCursor;
        more = page.hasMore;
      }
      if (controller.signal.aborted) return;
      setTicket(current);
      setReadError("");
      if (collected.length)
        setMessages((previous) =>
          [
            ...new Map(
              [...previous, ...collected].map((m) => [m.sequence, m]),
            ).values(),
          ].sort((a, b) => a.sequence - b.sequence),
        );
      cursor.current = after;
    }
    void load().catch((error) => {
      if (!aborted(error)) setReadError(message(error));
    });
    return () => controller.abort();
  }, [request, path, tick]);
  useEffect(() => {
    if (workspace.role !== "ADMIN") return;
    const controller = new AbortController();
    request<Agent[]>(`/workspaces/${workspace.id}/agents`, {
      signal: controller.signal,
    })
      .then(setAgents)
      .catch((error) => {
        if (!aborted(error)) setError(message(error));
      });
    return () => controller.abort();
  }, [request, workspace.id, workspace.role]);
  async function update(patch: TicketPatch) {
    if (!ticket || busy) return;
    setBusy(true);
    setError("");
    try {
      const updated = await request<Ticket>(path, {
        method: "PATCH",
        signal: writes.current.signal,
        body: { version: ticket.version, ...patch },
      });
      if (writes.current.signal.aborted) return;
      setTicket(updated);
      refresh();
    } catch (error) {
      if (!aborted(error)) {
        setError(
          error instanceof HttpError && error.code === "VERSION_CONFLICT"
            ? "Another teammate changed this conversation. Refreshing it; try again."
            : message(error),
        );
        refresh();
      }
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (busy || !draft.trim()) return;
    pending.current ??= { clientId: crypto.randomUUID(), body: draft.trim() };
    setBusy(true);
    setError("");
    try {
      await request<Message>(`${path}/messages`, {
        method: "POST",
        signal: writes.current.signal,
        body: pending.current,
      });
      if (writes.current.signal.aborted) return;
      pending.current = null;
      setRetry(false);
      setDraft("");
      refresh();
    } catch (error) {
      if (!aborted(error)) {
        const rejected =
          error instanceof HttpError &&
          error.status >= 400 &&
          error.status < 500;
        if (rejected) pending.current = null;
        setRetry(!rejected);
        setError(
          rejected
            ? message(error)
            : `${message(error)}. Retry to confirm this same message.`,
        );
        refresh();
      }
    } finally {
      setBusy(false);
    }
  }
  return {
    ticket,
    messages,
    agents,
    draft,
    setDraft,
    busy,
    retry,
    error: error || readError,
    send,
    update,
  };
}
