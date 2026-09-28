import { useEffect, useRef } from "react";
import type { Request } from "./api.js";
import type { Me, Workspace } from "../server/contracts.js";
import { date, label } from "./format.js";
import { useConversation } from "./useConversation.js";
import { TicketControls } from "./TicketControls.js";
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
  const {
    ticket,
    messages,
    agents,
    draft,
    setDraft,
    busy,
    retry,
    error,
    send,
    update,
  } = useConversation({
    path: `${base}/${id}`,
    workspace,
    request,
    tick,
    refresh,
  });
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);
  if (!ticket)
    return (
      <section className="empty">
        {error ? <p role="alert">{error}</p> : "Loading conversation…"}
      </section>
    );
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
        <TicketControls
          ticket={ticket}
          workspace={workspace}
          userId={me.user.id}
          agents={agents}
          busy={busy}
          onUpdate={update}
        />
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
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {ticket.status === "RESOLVED" && !retry ? (
          <p className="resolved-note">
            This conversation is resolved. An agent can reopen it if you need
            more help.
          </p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
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
