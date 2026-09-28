import { useState, type FormEvent } from "react";
import { message } from "./api.js";
export function Login({
  onLogin,
  initialError,
}: {
  onLogin: (email: string, password: string) => Promise<void>;
  initialError: string;
}) {
  const [email, setEmail] = useState("alice@acme.test");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onLogin(email, password);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">s</span> support
        </div>
        <p className="eyebrow">A shared place to help</p>
        <h1>
          Every conversation.
          <br />
          One clear inbox.
        </h1>
        <p>
          Keep customers and your team in the same conversation, from the first
          question to the final reply.
        </p>
        <div className="story-note">
          <span className="status-dot" /> Live conversations · Shared ownership
        </div>
      </section>
      <section className="login-panel">
        <form onSubmit={submit}>
          <p className="eyebrow">Your workspace</p>
          <h2>Welcome back</h2>
          <p className="muted">Sign in to pick up the conversation.</p>
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <aside className="demo-accounts">
            <strong>Local demo accounts</strong>
            <button
              type="button"
              className="text-button"
              onClick={() => setEmail("alice@acme.test")}
            >
              Customer — alice@acme.test
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setEmail("agent@acme.test")}
            >
              Agent — agent@acme.test
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setEmail("admin@acme.test")}
            >
              Admin — admin@acme.test
            </button>
            <small>
              Use the demo password configured when starting the app.
            </small>
          </aside>
        </form>
      </section>
    </main>
  );
}
