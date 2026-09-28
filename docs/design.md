# Design notes

## Writes and concurrency

PostgreSQL is the source of truth. Creating a ticket and its first message is one transaction. Each message writer locks its ticket row, checks access and resolution status, then advances a per-ticket sequence and inserts the message. This serializes writers within one conversation without serializing unrelated tickets.

`(ticket_id, sender_id, client_id)` is unique. Replaying the same ID and body returns the original message, even after resolution; changing the body returns a conflict. The UI retains the ID after an ambiguous network failure. This is write deduplication, not exactly-once network delivery. Ticket creation itself has no idempotency key.

Assignment, priority, and status edits carry the ticket's version. A stale version returns 409. Agents can claim or release their own assignments; admins can assign another workspace agent. Resolved tickets must be reopened before accepting new messages.

## Access and delivery

Passwords use scrypt. Sessions use random tokens in HttpOnly, SameSite cookies; only token hashes are stored. Mutations require a session CSRF token and reject foreign browser origins. Socket handshakes require the same credentials.

Queries constrain workspace and customer ownership. Composite foreign keys prevent cross-workspace ticket/message references. This is application authorization, not PostgreSQL row-level security. Membership is also rechecked before each outgoing socket notification; revoked sessions disconnect on their next notification or command.

Sockets carry invalidation hints, never message bodies. Each app checks its own connected viewers; the Redis adapter forwards change events to other instances. Clients fetch authorized history using a sequence cursor after reconnecting. A periodic HTTP refresh covers a missed publish even when the socket stays connected.

There is no transactional outbox. A crash between commit and publish can delay visibility until the next refresh. Redis outages do not erase messages or block HTTP writes; initial startup still requires Redis to be reachable. Only WebSocket transport is enabled, so a multi-instance proxy must support upgrades but needs no polling-session affinity.

## Scope

This is a seeded, multi-workspace demo. It has no signup, billing, invitation workflow, attachments, or email integration. The login throttle is per process, and notification authorization performs database reads per viewer. The 500-socket limit per instance is a guardrail, not a measured capacity claim. Large deployments would need bounded fan-out, distributed throttling, retention, and load testing.

The inbox uses offset pages of 50 tickets; concurrent updates can shift page boundaries. Message history uses a stable sequence cursor with pages of 100. Compose memory limits are local budgets, not benchmark results.
