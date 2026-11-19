# ADR 0008: Reserve then check

## Status

Proposed

## Decisions

### Reserve, commit, check, finalize

- **Chosen:** Create pending email and terminal reservations in a short transaction, commit them, perform the password check without a transaction or pooled connection, then finalize both reservations and write the audit event in a second short transaction.
- **Rejected:** Keep the reservation, password check, and failure recording in one transaction. A rollback after a password check could erase the failure row even though the guess was already used.

### Keep the configured limits

- **Chosen:** Preserve the existing email and terminal limits and prevent unreserved password checks.
- **Rejected:** Raise the limits to absorb the reservation-to-finalization gap. That weakens the rule instead of fixing the cause.

### Crashes after reservation

- **Chosen:** Count a pending reservation as a failure. A crash after reservation therefore counts as a failure; this is intended because the password check may already have run.

### Successful attempts

- **Chosen:** Exclude succeeded reservations from the window count. A successful login cannot lock a legitimate user, and it cannot be used to reset the count because prior pending or failed reservations remain counted.
