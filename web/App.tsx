import { useCallback, useEffect, useState } from "react";
import { api, HttpError, message, aborted, type Request } from "./api.js";
import type { Me } from "../server/contracts.js";
import { Login } from "./Login.js";
import { Dashboard } from "./Dashboard.js";
export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api<Me>("/me", { signal: controller.signal })
      .then(setMe)
      .catch((error) => {
        if (
          !aborted(error) &&
          !(error instanceof HttpError && error.status === 401)
        )
          setError(message(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  const request: Request = useCallback(
    async (path, options) => {
      try {
        return await api(path, { ...options, csrf: me?.csrfToken });
      } catch (error) {
        if (error instanceof HttpError && error.status === 401)
          setMe((current) => (current === me ? null : current));
        throw error;
      }
    },
    [me],
  );
  async function login(email: string, password: string) {
    await api("/auth/login", { method: "POST", body: { email, password } });
    setMe(await api<Me>("/me"));
    setError("");
  }
  async function logout() {
    try {
      await request("/auth/logout", { method: "POST", body: {} });
      setMe(null);
      setWorkspaceId("");
    } catch (error) {
      setError(message(error));
    }
  }
  if (loading) return <main className="loading">Loading your workspace…</main>;
  if (!me) return <Login onLogin={login} initialError={error} />;
  const workspace =
    me.workspaces.find((w) => w.id === workspaceId) ?? me.workspaces[0];
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Support home">
          <span className="brand-mark">s</span> support
          <span className="brand-light"> / inbox</span>
        </a>
        <div className="account">
          <span>
            {me.user.name}
            <small>{me.user.email}</small>
          </span>
          <button className="quiet" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {workspace ? (
        <Dashboard
          key={`${me.user.id}:${workspace.id}`}
          me={me}
          workspace={workspace}
          request={request}
          onWorkspace={setWorkspaceId}
        />
      ) : (
        <main className="empty">You do not belong to a workspace.</main>
      )}
    </div>
  );
}
