# ADR 0004: Application database role for audit events

## Status

Accepted

## Decision

The append-only trigger on `audit_events` can be bypassed by the table owner.
Production must therefore connect the application as a role that has `INSERT`
and `SELECT` on `audit_events`, but no `UPDATE`, `DELETE`, `TRUNCATE`, or `ALTER`
privileges on that table.

This role split is a required step before the first deployment. This decision
does not create or configure the production database role.
