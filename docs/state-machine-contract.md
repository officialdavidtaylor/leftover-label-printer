# Print Job State Machine Contract

## States

`pending`, `processing`, `dispatched`, `printed`, `failed`

Implementation note: transition logic is modeled with an XState machine in `backend/src/print-jobs/state-machine-contract.ts`.

## Allowed Transitions

1. `pending -> processing` (source: `backend`)
2. `processing -> dispatched` (source: `backend`)
3. `processing -> failed` (source: `backend`)
4. `dispatched -> printed` (source: `agent`)
5. `dispatched -> failed` (source: `agent`)

No other transitions are accepted.

## Rejection Rules

1. Duplicate `eventId` is rejected as `duplicate_event`.
2. Any transition from terminal states (`printed`, `failed`) is rejected as `terminal_state_locked`.
3. Matrix violations are rejected as `invalid_transition`.
4. Source/authority violations are rejected as `authority_violation`.

## Audit And Logging Behavior

Rejected transitions emit `job_transition_rejected` with:
- `jobId`
- `eventId`
- `traceId`
- `source`
- `previousState`
- `targetState`
- `reason`
- `occurredAt`

Accepted transitions emit `job_transition_applied` with the same transition context.
