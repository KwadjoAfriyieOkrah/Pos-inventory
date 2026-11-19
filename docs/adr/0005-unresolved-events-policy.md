# ADR 0005: Unresolved events policy

## Status

Proposed
Acceptance date: pending client sign-off.

## Decision

1. A sale recorded during an outage is never reversed automatically when a later sync or login event is rejected.
2. Each rejected event goes to an unresolved queue with: original timestamp, terminal, cashier, rejection reason, amount, and item count. Nothing in the queue is ever deleted.
3. The owner resolves each item within 24 hours by choosing accept, correct, or refund. A refund is a new record; the original remains.
4. If the owner is the subject of the rejection, or is unavailable for more than 24 hours, a second reviewer named in the branch settings resolves it. The second reviewer is a placeholder until the client names one.
5. Unresolved items are shown on the owner dashboard as a count and a total in GH₵, and appear in the printed end-of-day summary.
6. Sale approval and login authority are separate decisions. A rejected login flags the sales it covered for review; it does not void them.

## Open client questions

- the name of the second reviewer
- the escalation time if both reviewers are unavailable
- whether a printed end-of-day summary is required by law or only by the client
