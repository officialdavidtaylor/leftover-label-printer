# Data Schemas

This document defines canonical Mongo collection contracts for the print workflow.

## Collections

1. `print_jobs`
   - Write model: mutable
   - Required fields: `jobId`, `idempotencyKey`, `state`, `printerId`, `templateId`, `payload`, `traceId`, `acceptedAt`, `createdAt`, `updatedAt`
   - Enum fields: `state` in `pending | processing | dispatched | printed | failed`
2. `job_events`
   - Write model: append-only
   - Required fields: `eventId`, `jobId`, `type`, `source`, `occurredAt`, `traceId`
   - Enum fields:
     - `type` in `pending | processing | dispatched | printed | failed`
     - `source` in `backend | agent`
   - Additional rules:
     - Agent events require `printerId` and `outcome`
     - Failed events require `errorCode` and `errorMessage`
3. `printers`
   - Write model: mutable
   - Required fields: `printerId`, `nodeId`, `status`, `capabilities`, `lastSeenAt`, `createdAt`, `updatedAt`
   - Enum fields: `status` in `online | offline | degraded | unknown`
4. `templates`
   - Write model: mutable
   - Required fields: `templateId`, `version`, `name`, `schemaVersion`, `renderEngine`, `status`, `config`, `createdAt`, `updatedAt`
   - Enum fields: `status` in `active | inactive | deprecated`

## Example Documents

### print_jobs

```json
{
  "jobId": "job-7f669920",
  "idempotencyKey": "idem-7f669920",
  "state": "pending",
  "printerId": "printer-east-1",
  "templateId": "label-default",
  "templateVersion": "v1",
  "payload": {
    "itemName": "Lemon Bars",
    "prepDate": "2026-02-20",
    "expirationDate": "2026-02-24"
  },
  "traceId": "trace-a9e6141a",
  "acceptedAt": "2026-02-20T15:00:00.000Z",
  "createdAt": "2026-02-20T15:00:00.000Z",
  "updatedAt": "2026-02-20T15:00:00.000Z"
}
```

### job_events

```json
{
  "eventId": "event-b6db3543",
  "jobId": "job-7f669920",
  "type": "pending",
  "source": "backend",
  "occurredAt": "2026-02-20T15:00:00.000Z",
  "traceId": "trace-a9e6141a"
}
```

### printers

```json
{
  "printerId": "printer-east-1",
  "nodeId": "node-east-1",
  "status": "online",
  "capabilities": {
    "model": "Brother QL-820NWB",
    "media": ["62mm"]
  },
  "metadata": {
    "location": "Prep Kitchen"
  },
  "lastSeenAt": "2026-02-20T14:59:10.000Z",
  "createdAt": "2026-02-01T00:00:00.000Z",
  "updatedAt": "2026-02-20T14:59:10.000Z"
}
```

### templates

```json
{
  "templateId": "label-default",
  "version": "v1",
  "name": "Default Leftover Label",
  "schemaVersion": "1.0.0",
  "renderEngine": "pdfkit",
  "status": "active",
  "config": {
    "pageSize": "62mmx100mm",
    "locale": "en-US"
  },
  "createdAt": "2026-02-01T00:00:00.000Z",
  "updatedAt": "2026-02-20T12:30:00.000Z"
}
```
