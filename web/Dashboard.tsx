import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { message, aborted, type Request } from "./api.js";
import type { TicketChange } from "../server/contracts.js";
import {
  statuses,
  label,
  date,
  type Me,
  type Workspace,
  type Page,
} from "./model.js";
import { NewTicket } from "./NewTicket.js";
import { Conversation } from "./Conversation.js";
export function Dashboard({
  me,
  workspace,
  request,
  onWorkspace,
}: {
  me: Me;
  workspace: Workspace;
  request: Request;
  onWorkspace: (id: string) => void;
}) {
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  const [live, setLive] = useState(false);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [list, setList] = useState<Page>({
    items: [],
    hasMore: false,
    page: 0,
  });
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const base = `/workspaces/${workspace.id}/tickets`;
  useEffect(() => {
    const socket = io({
      transports: ["websocket"],
      auth: { csrfToken: me.csrfToken },
    });
    let active = true;
    socket.on("connect", async () => {
      try {
        const ack = await socket
          .timeout(5000)
          .emitWithAck("workspace:watch", { workspaceId: workspace.id });
        if (active) {
          setLive(ack.ok);
          refresh();
        }
      } catch {
        if (active) setLive(false);
      }
    });
    socket.on("disconnect", () => setLive(false));
    socket.on("connect_error", () => setLive(false));
    socket.on("ticket:changed", (change: TicketChange) => {
      if (change.workspaceId === workspace.id) refresh();
    });
    const timer = setInterval(refresh, 15000);
    return () => {
      active = false;
      clearInterval(timer);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [me.csrfToken, workspace.id, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), q: query });
    if (filter) params.set("status", filter);
    request<Page>(`${base}?${params}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setList(result);
        setLoaded(true);
        setError("");
        setSelected((previous) => previous ?? result.items[0]?.id ?? null);
      })
      .catch((error) => {
        if (!aborted(error)) setError(message(error));
      });
    return () => controller.abort();
  }, [request, base, page, query, filter, tick]);
  return (
    <main className="workspace">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">
            {workspace.role === "CUSTOMER"
              ? "Customer portal"
              : "Team workspace"}
          </p>
          <h1>{workspace.name}</h1>
        </div>
        <div className="workspace-tools">
          <span className={`connection ${live ? "online" : ""}`} role="status">
            <span className="status-dot" />
            {live ? "Live" : "Syncing every 15s"}
          </span>
          {me.workspaces.length > 1 && (
            <select
              aria-label="Workspace"
              value={workspace.id}
              onChange={(e) => onWorkspace(e.target.value)}
            >
              {me.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <span className="role">{label(workspace.role)}</span>
        </div>
      </div>
      <div className="inbox">
        <section className="ticket-list" aria-label="Tickets">
          <div className="list-heading">
            <h2>
              {workspace.role === "CUSTOMER"
                ? "Your requests"
                : "Conversations"}
            </h2>
            {workspace.role === "CUSTOMER" && (
              <button
                className="primary small"
                onClick={() => setCreating(true)}
              >
                New request
              </button>
            )}
          </div>
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(search);
              setPage(0);
            }}
          >
            <input
              aria-label="Search tickets"
              placeholder="Search conversations"
              maxLength={160}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="quiet" type="submit">
              Search
            </button>
          </form>
          <div className="filters" aria-label="Ticket status filter">
            {["", ...statuses].map((status) => (
              <button
                key={status}
                aria-pressed={filter === status}
                onClick={() => {
                  setFilter(status);
                  setPage(0);
                }}
              >
                {status ? label(status) : "All"}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <div className="ticket-scroll">
            {list.items.map((ticket) => (
              <button
                key={ticket.id}
                className={`ticket-card ${selected === ticket.id && !creating ? "selected" : ""}`}
                aria-pressed={selected === ticket.id && !creating}
                onClick={() => {
                  setSelected(ticket.id);
                  setCreating(false);
                }}
              >
                <span className="ticket-meta">
                  <strong>{ticket.customer_name}</strong>
                  <time>{date(ticket.updated_at)}</time>
                </span>
                <span className="ticket-subject">{ticket.subject}</span>
                <span className="ticket-bottom">
                  <span className={`badge ${ticket.status.toLowerCase()}`}>
                    {label(ticket.status)}
                  </span>
                  <span>{ticket.assignee_name ?? "Unassigned"}</span>
                </span>
              </button>
            ))}
            {list.items.length === 0 && (
              <div className="list-empty">
                {loaded
                  ? "No conversations here yet."
                  : "Loading conversations…"}
              </div>
            )}
          </div>
          <div className="pagination">
            <button
              className="quiet"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <span>Page {page + 1}</span>
            <button
              className="quiet"
              disabled={!list.hasMore}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </section>
        {creating ? (
          <NewTicket
            request={request}
            base={base}
            onCancel={() => setCreating(false)}
            onCreated={(ticket) => {
              setSelected(ticket.id);
              setCreating(false);
              setFilter("");
              setQuery("");
              setSearch("");
              setPage(0);
              refresh();
            }}
          />
        ) : selected ? (
          <Conversation
            key={selected}
            id={selected}
            base={base}
            workspace={workspace}
            me={me}
            request={request}
            tick={tick}
            refresh={refresh}
          />
        ) : (
          <section className="empty">
            <div className="empty-icon">↗</div>
            <h2>Room for a good conversation</h2>
            <p>
              {workspace.role === "CUSTOMER"
                ? "Start a request and your support team will take it from here."
                : "Select a conversation to see its history and reply."}
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
