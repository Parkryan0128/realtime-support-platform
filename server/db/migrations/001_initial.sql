CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  password_hash text NOT NULL
);
CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80)
);
CREATE TABLE memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('CUSTOMER', 'AGENT', 'ADMIN')),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE tickets (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  customer_id uuid NOT NULL,
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 160),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PENDING', 'RESOLVED')),
  assignee_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  next_sequence integer NOT NULL DEFAULT 0 CHECK (next_sequence >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, customer_id) REFERENCES memberships(workspace_id, user_id),
  FOREIGN KEY (workspace_id, assignee_id) REFERENCES memberships(workspace_id, user_id)
);
CREATE INDEX tickets_inbox ON tickets(workspace_id, updated_at DESC, id DESC);
CREATE INDEX tickets_customer ON tickets(workspace_id, customer_id, updated_at DESC);
CREATE TABLE messages (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  ticket_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  client_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, sequence),
  UNIQUE (ticket_id, sender_id, client_id),
  FOREIGN KEY (workspace_id, ticket_id) REFERENCES tickets(workspace_id, id),
  FOREIGN KEY (workspace_id, sender_id) REFERENCES memberships(workspace_id, user_id)
);
