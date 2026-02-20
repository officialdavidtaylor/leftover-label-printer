# Print Job State Machine

## States

1. `pending`: job accepted and persisted.
2. `processing`: backend preparing output (render/upload).
3. `dispatched`: command published to printer topic.
4. `printed`: terminal success.
5. `failed`: terminal failure.

## Allowed Transitions

1. `pending -> processing`
2. `processing -> dispatched`
3. `processing -> failed`
4. `dispatched -> printed`
5. `dispatched -> failed`

No other transition is allowed.

## Transition Authority

1. Backend controls `pending`, `processing`, `dispatched`.
2. Edge agent controls terminal outcome event (`printed` or `failed`).
3. Backend sets `printed` only after validating an AG-06 outcome event.

## Required Event Fields

All lifecycle events must include:

1. `eventId` (unique)
2. `jobId`
3. `occurredAt` (ISO-8601 timestamp)
4. `source` (`backend` or `agent`)
5. `traceId`

Agent terminal events must also include:

1. `printerId`
2. `outcome` (`printed` or `failed`)
3. `errorCode` and `errorMessage` when failed

## Guardrails

1. Duplicate events must be idempotently ignored by `eventId`.
2. Stale events must not roll back a terminal state.
3. Any rejected transition must generate an audit/log entry.
