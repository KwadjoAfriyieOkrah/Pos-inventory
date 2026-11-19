# ADR 0007: Login admission control

## Status

Proposed

## Decisions

### One clock for the whole attempt

- **Chosen:** Capture one application-clock timestamp at the start of each login attempt and pass it to every rate-limit operation. This keeps pruning, counting, and failure recording consistent within the attempt.
- **Rejected:** Read the database clock independently for each operation. Mixing clocks can shift window boundaries and make one attempt observe inconsistent counts.

### Separate authentication pool with a connect timeout

- **Chosen:** Use a dedicated authentication pool with a bounded connection wait. This isolates sales and other application traffic from slow password verification and fails authentication quickly when its pool is full.
- **Rejected:** Use the shared application pool. Authentication attempts could queue behind one another and consume connections needed by other features.

### Per-terminal in-flight cap

- **Chosen:** Limit each terminal to five in-flight attempts, equal to the email failure limit. This preserves the property that at most five concurrent attempts from one terminal can record failures.
- **Rejected:** Set the cap to three. That would reject some requests before five failures could be recorded, breaking the exactly-five-failures property.

### Recording busy refusals

- **Chosen:** Do not write audit or failure rows for busy refusals. These refusals must remain possible when database resources are constrained.
- **Rejected:** Record each busy refusal. Writing the record requires a database connection, the resource under attack.

### Admission-cap storage

- **Chosen:** Keep the in-flight cap in a process-local map for the current single-process deployment. This avoids a shared-storage dependency while running one server process.
- **Rejected:** Treat the process-local map as a global limit in a multi-process deployment. Each process has independent state, so the aggregate cap would be incorrect.
- **Migration path:** Before deploying multiple server processes, replace the local map with a shared admission mechanism, such as a Redis atomic counter/semaphore or a PostgreSQL-backed atomic limiter, while retaining the same per-terminal limit.
