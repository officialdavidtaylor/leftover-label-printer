# Architecture

## Components

1. Frontend: React static PWA.
2. Backend: Node API and workers for job orchestration + PDF rendering.
3. Data store: MongoDB for jobs, events, printers, templates.
4. Object storage: S3-compatible private bucket for rendered PDFs.
5. Broker: self-hosted EMQX for device command and status messaging.
6. Edge agent: containerized Go service on Raspberry Pi with CUPS `lp`.

## Data Flow

1. User submits `POST /v1/print-jobs` from PWA.
2. Backend validates auth, payload, and target printer.
3. Backend writes job + initial event to MongoDB.
4. Backend renders PDF and uploads to object storage.
5. Backend publishes MQTT command on `printers/{printerId}/jobs`.
6. Edge agent receives command, downloads PDF, and calls `lp`.
7. Edge agent publishes terminal status (`printed` or `failed`) on `printers/{printerId}/status`.
8. Backend consumes status and applies state transition.

## Trust Boundaries

1. User device to backend API boundary (OIDC tokens required).
2. Backend to broker boundary (TLS + broker auth/ACL).
3. Backend to object storage boundary (scoped credentials).
4. Broker to edge boundary (device identity + topic ACL).
5. Edge local host boundary (printer access via local CUPS).

## Core Collections

1. `print_jobs`: canonical job state and routing metadata.
2. `job_events`: append-only lifecycle and audit-aligned events.
3. `printers`: edge node identity, status, capability metadata.
4. `templates`: template versions and rendering configuration.

## Reliability Strategy

1. Durable edge spool for offline/restart recovery.
2. Idempotency keys on job submission.
3. Deterministic state machine with guarded transitions.
4. QoS 1 message delivery with duplicate-safe consumers.
5. Trace IDs propagated across HTTP and MQTT.
