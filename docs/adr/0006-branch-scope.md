# ADR 0006: Branch-scoped data access

## Status

Proposed

## Decision

Server data access uses a fresh database-loaded scope for each call. Every query
that returns branch data must require the relevant permission and filter by
both organization and branch. No assignment means an empty scope, and
user/branch/role assignments are included only when all three share the same
organization.

Login is the only exception to the branch-scoped data-access layer because it
must authenticate before a user scope exists. Other server data access must go
through this layer.

Login and registration are the only pre-session flows, and both live in
`src/server/auth`.

PostgreSQL row-level security (RLS) is deferred to the Phase 1 gate.

| Decision | Chosen | Rejected |
|---|---|---|
| where branch access is read. | Chosen: database on every request. | Rejected: session token, because a removed user keeps access until expiry. |
| what happens when access is denied. | Chosen: throw ForbiddenError. | Rejected: return an empty list, because it hides the bug. |
| how organization is enforced. | Chosen: filter on organization and branch together. | Rejected: branch alone, because a wrong branch id from another organization would pass. |
| how unscoped queries are stopped. | Chosen: import rule plus structural tests now, row-level security in the Phase 1 gate. | Rejected: lint alone, because lint can't see what a query filters on. |
