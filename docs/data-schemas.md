# Data Schemas

This document defines canonical Mongo collection contracts for the print workflow.

## Validation And Fixtures

1. Runtime schema validation in TypeScript is implemented with `zod` (`backend/src/data/schema-contracts.ts`).
2. Tests use faker-driven fixtures (`tests/backend/fixtures/schema-fixtures.ts`) instead of hardcoded sample objects.
3. Canonical literal document examples remain in this document and are treated as the source of truth for sample payloads.

## Collections

1. `print_jobs`
   - Write model: mutable
   - Required fields: `jobId`, `idempotencyKey`, `state`, `printerId`, `templateId`, `payload`, `traceId`, `acceptedAt`, `createdAt`, `updatedAt`
   - Optional artifact fields: `renderedPdf.bucket`, `renderedPdf.key`, `renderedPdf.contentType`, `renderedPdf.contentLength`, `renderedPdf.checksumSha256`, `renderedPdf.uploadedAt`, `renderedPdf.eTag`
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
  "updatedAt": "2026-02-20T15:00:00.000Z",
  "renderedPdf": {
    "bucket": "leftover-label-printer",
    "key": "rendered-pdfs/jobs/job-7f669920/printers/printer-east-1/templates/label-default/versions/v1/rendered.pdf",
    "contentType": "application/pdf",
    "contentLength": 20480,
    "checksumSha256": "d7d4ea8264f744c76c603f17fe29aebfb7fbc9d8d9f4f0f2ffad89c3f3f0ab40",
    "uploadedAt": "2026-02-20T15:00:02.000Z",
    "eTag": "\"adf14e0c5fd6332f8dbf31f95f9f08e9\""
  }
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
