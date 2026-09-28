import {
  statuses,
  priorities,
  type Agent,
  type Ticket,
  type TicketPatch,
  type Workspace,
  type TicketStatus,
  type Priority,
} from "../server/contracts.js";
import { label } from "./format.js";

export function TicketControls({
  ticket,
  workspace,
  userId,
  agents,
  busy,
  onUpdate,
}: {
  ticket: Ticket;
  workspace: Workspace;
  userId: string;
  agents: Agent[];
  busy: boolean;
  onUpdate: (patch: TicketPatch) => Promise<void>;
}) {
  const staff = workspace.role !== "CUSTOMER";
  return (
    <div className="ticket-controls">
      {staff ? (
        <>
          <label>
            Status
            <select
              aria-label="Status"
              value={ticket.status}
              disabled={busy}
              onChange={(e) =>
                onUpdate({ status: e.target.value as TicketStatus })
              }
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
              onChange={(e) =>
                onUpdate({ priority: e.target.value as Priority })
              }
            >
              {priorities.map((p) => (
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
                  onUpdate({ assigneeId: e.target.value || null })
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
              {(!ticket.assignee_id || ticket.assignee_id === userId) && (
                <button
                  className="quiet small"
                  disabled={busy}
                  onClick={() =>
                    onUpdate({
                      assigneeId: ticket.assignee_id ? null : userId,
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
  );
}
