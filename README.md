# Realtime Support Platform

A shared support inbox built with TypeScript, Express, PostgreSQL, Redis, Socket.IO, and React. Customers open requests and chat with support; agents take ownership, reply, and resolve conversations. Each workspace has its own customers and team.

## How it works

Messages go through HTTP and are committed to PostgreSQL before a Socket.IO notification is sent. Redis carries notifications between app instances. After a disconnect, the client fetches messages after its last sequence number; a 15-second refresh also catches missed notifications.

A message's client-generated ID makes retries safe. Ticket updates use a version check so two agents cannot silently overwrite each other. Customer ownership and workspace membership are checked on both API requests and outgoing socket notifications.

The [design note](docs/design.md) covers the tradeoffs and limits.

## Project structure

- `server/` — authentication, ticket operations, HTTP and socket handlers
- `server/db/` — SQL migrations and demo accounts
- `web/` — customer portal and agent inbox
- `tests/` — database, API, socket, and browser tests

## Build

Requires Docker Compose:

```sh
cp .env.example .env
docker compose up --build --wait
```

Open **http://localhost:8080**. The local demo password is `demo-support-password`.

| Account           | Role                             |
| ----------------- | -------------------------------- |
| `alice@acme.test` | Customer                         |
| `agent@acme.test` | Agent                            |
| `admin@acme.test` | Admin                            |
| `bob@acme.test`   | Another customer                 |
| `eve@orbit.test`  | Customer in a separate workspace |

Use two browser profiles to try a live conversation. Data stays in the PostgreSQL volume after `docker compose down`. Seeding preserves existing accounts, including their passwords.

Compose binds to localhost. For a public demo, put it behind HTTPS, set `APP_ORIGIN` to that origin, and choose private demo credentials before the first seed. Secure cookies are enabled automatically for HTTPS.

## Tests

With Node.js 24+:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Local tests use PGlite unless `TEST_DATABASE_URL` points to PostgreSQL. The two-server test also requires `REDIS_URL`:

```sh
TEST_DATABASE_URL=postgres://user:password@localhost/support_test \
REDIS_URL=redis://localhost:6379 npm run test:integration
```

Tests truncate their database; use a dedicated test database. `npm run test:browser` tests the running Compose app after `npx playwright install chromium`.

[CI](https://github.com/Parkryan0128/realtime-support-platform/actions/workflows/ci.yml) runs the full suite against PostgreSQL 16 and Redis, builds the Docker image, and checks customer/agent conversations in Chromium. Browser reports and screenshots are attached to each run.

## Contact

Ryan Park — [Email](mailto:parkryan0128@gmail.com) · [LinkedIn](https://www.linkedin.com/in/parkryan0128)
