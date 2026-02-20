# Critical Indexes And Idempotency

## Index Contracts

### print_jobs

1. `print_jobs_state_acceptedAt_desc` on `{ state: 1, acceptedAt: -1 }`
   - Supports status-oriented queue queries.
2. `print_jobs_printerId_acceptedAt_desc` on `{ printerId: 1, acceptedAt: -1 }`
   - Supports printer-specific diagnostics and history queries.
3. `print_jobs_idempotencyKey_unique` on `{ idempotencyKey: 1 }` (unique)
   - Enforces deterministic submission deduplication.

### job_events

1. `job_events_jobId_occurredAt_asc` on `{ jobId: 1, occurredAt: 1 }`
   - Supports chronological event timeline reads for job status views.
2. `job_events_eventId_unique` on `{ eventId: 1 }` (unique)
   - Supports duplicate event suppression.

## Idempotency Semantics

1. Scope: **global by `idempotencyKey`** for accepted print jobs.
2. First submission with a new key creates a new accepted job.
3. Duplicate submission with an existing key returns the previously accepted job and does not create a new one.
4. Race condition handling: if the insert path hits a duplicate key due to concurrency, the service re-reads and returns the existing job.

## API Behavior

`POST /v1/print-jobs` continues returning `202` with `PrintJobAcceptedResponse`.
For duplicate submissions, `jobId` is stable and equals the previously accepted job.
