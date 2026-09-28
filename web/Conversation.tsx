import { useEffect, useRef, useState, type FormEvent } from "react";
import { HttpError, message, aborted, type Request } from "./api.js";
import type { Message, Ticket } from "../server/contracts.js";
import {
  statuses,
  label,
  date,
  type Me,
  type Workspace,
  type History,
} from "./model.js";
export function Conversation({
  id,
  base,
  workspace,
  me,
  request,
  tick,
  refresh,
}: {
  id: string;
  base: string;
  workspace: Workspace;
  me: Me;
  request: Request;
  tick: number;
  refresh: () => void;
}) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const pending = useRef<{ clientId: string; body: string } | null>(null);
  const cursor = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const writes = useRef(new AbortController());
  const path = `${base}/${id}`;
  useEffect(() => () => writes.current.abort(), []);
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
        const page = await request<History>(`${path}/messages?after=${after}`, {
          signal: controller.signal,
        });
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
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);
  useEffect(() => {
    if (workspace.role !== "ADMIN") return;
    const controller = new AbortController();
    request<{ id: string; name: string }[]>(
      `/workspaces/${workspace.id}/agents`,
      { signal: controller.signal },
    )
      .then(setAgents)
      .catch((error) => {
        if (!aborted(error)) setError(message(error));
      });
    return () => controller.abort();
  }, [request, workspace.id, workspace.role]);
  async function update(patch: object) {
    if (!ticket || busy) return;
    setBusy(true);
    setError("");
    try {
      await request(path, {
        method: "PATCH",
        signal: writes.current.signal,
        body: { version: ticket.version, ...patch },
      });
      refresh();
    } catch (error) {
      if (!aborted(error)) {
        setError(
          error instanceof HttpError && error.code === "VERSION_CONFLICT"
            ? "Another teammate changed this conversation. The latest version has been loaded; try again."
            : message(error),
        );
        refresh();
      }
    } finally {
      setBusy(false);
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
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
  if (!ticket)
    return (
      <section className="empty">
        {error || readError ? (
          <p role="alert">{error || readError}</p>
        ) : (
          "Loading conversation…"
        )}
      </section>
    );
  const staff = workspace.role !== "CUSTOMER";
  return (
    <section className="conversation" aria-label="Conversation">
      <div className="conversation-heading">
        <div className="ticket-meta">
          <span className={`badge ${ticket.status.toLowerCase()}`}>
            {label(ticket.status)}
          </span>
          <span>#{ticket.id.slice(0, 8)}</span>
        </div>
        <h2>{ticket.subject}</h2>
        <p>
          {ticket.customer_name}
          <span className="separator">·</span>Opened {date(ticket.created_at)}
        </p>
        <div className="ticket-controls">
          {staff ? (
            <>
              <label>
                Status
                <select
                  aria-label="Status"
                  value={ticket.status}
                  disabled={busy}
                  onChange={(e) => update({ status: e.target.value })}
                >
                  {statuses.map((s) => (
                    <option
                      key={s}
                      value={s}
                      disabled={ticket.status === "RESOLVED" && s === "PENDING"}
                    >
                      {label(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <select
                  aria-label="Priority"
                  value={ticket.priority}
                  disabled={busy}
                  onChange={(e) => update({ priority: e.target.value })}
                >
                  {["LOW", "NORMAL", "HIGH"].map((p) => (
                    <option key={p} value={p}>
                      {label(p)}
                    </option>
                  ))}
                </select>
              </label>
              {workspace.role === "ADMIN" ? (
                <label>
                  Assigned to
                  <select
                    aria-label="Assigned to"
                    value={ticket.assignee_id ?? ""}
                    disabled={busy}
                    onChange={(e) =>
                      update({ assigneeId: e.target.value || null })
                    }
                  >
                    <option value="">Unassigned</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="assignment">
                  <span>{ticket.assignee_name ?? "Unassigned"}</span>
                  {(!ticket.assignee_id ||
                    ticket.assignee_id === me.user.id) && (
                    <button
                      className="quiet small"
                      disabled={busy}
                      onClick={() =>
                        update({
                          assigneeId: ticket.assignee_id ? null : me.user.id,
                        })
                      }
                    >
                      {ticket.assignee_id ? "Unassign me" : "Assign to me"}
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <span className="muted">
              {label(ticket.priority)} priority
              <span className="separator">·</span>
              {ticket.assignee_name
                ? `Assigned to ${ticket.assignee_name}`
                : "Waiting for an agent"}
            </span>
          )}
        </div>
      </div>
      <div
        className="thread"
        role="log"
        aria-label="Message history"
        aria-live="polite"
      >
        {messages.map((m) => (
          <article
            key={m.id}
            className={`message ${m.sender_id === me.user.id ? "mine" : ""}`}
          >
            <div className="avatar">{m.sender_name.slice(0, 1)}</div>
            <div className="message-content">
              <div className="message-heading">
                <strong>{m.sender_name}</strong>
                <time dateTime={m.created_at}>{date(m.created_at)}</time>
              </div>
              <p>{m.body}</p>
            </div>
          </article>
        ))}
        <div ref={end} />
      </div>
      <div className="reply-area">
        {(error || readError) && (
          <p role="alert" className="notice error">
            {error || readError}
          </p>
        )}
        {ticket.status === "RESOLVED" && !retry ? (
          <p className="resolved-note">
            This conversation is resolved. An agent can reopen it if you need
            more help.
          </p>
        ) : (
          <form onSubmit={send}>
            <label className="sr-only" htmlFor="reply">
              Reply
            </label>
            <textarea
              id="reply"
              placeholder="Write a reply…"
              rows={3}
              maxLength={4000}
              value={draft}
              readOnly={retry}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              required
            />
            <div className="reply-footer">
              <span>
                {retry
                  ? "Your draft is kept until delivery is confirmed."
                  : "Replies are visible to the customer and support team."}
              </span>
              <button className="primary" disabled={busy || !draft.trim()}>
                {busy ? "Sending…" : retry ? "Retry message" : "Send reply"}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
