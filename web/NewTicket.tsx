import { useEffect, useRef, useState, type FormEvent } from "react";
import { message, aborted, type Request } from "./api.js";
import { priorities, type Ticket } from "../server/contracts.js";
import { label } from "./format.js";

export function NewTicket({
  request,
  base,
  onCancel,
  onCreated,
}: {
  request: Request;
  base: string;
  onCancel: () => void;
  onCreated: (ticket: Ticket) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef(new AbortController());
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const ticket = await request<Ticket>(base, {
        method: "POST",
        signal: controller.current.signal,
        body: {
          subject: form.get("subject"),
          priority: form.get("priority"),
          body: form.get("body"),
        },
      });
      if (!controller.current.signal.aborted) onCreated(ticket);
    } catch (error) {
      if (!aborted(error)) setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="new-ticket">
      <p className="eyebrow">Let’s work through it</p>
      <h2>How can we help?</h2>
      <form onSubmit={submit}>
        <label>
          Subject
          <input name="subject" maxLength={160} required autoFocus />
        </label>
        <label>
          Priority
          <select name="priority" defaultValue="NORMAL">
            {priorities.map((priority) => (
              <option key={priority} value={priority}>
                {label(priority)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Describe the issue
          <textarea name="body" rows={7} maxLength={4000} required />
        </label>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            className="quiet"
            type="button"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Creating…" : "Create request"}
          </button>
        </div>
      </form>
    </section>
  );
}
