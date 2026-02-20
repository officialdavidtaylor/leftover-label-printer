# RBAC Authorization Matrix (MVP)

This matrix defines default-deny authorization behavior for backend protected routes.

## Canonical Inputs

1. Roles are read from JWT `roles` claim only.
2. Supported MVP roles: `user`, `sysadmin`.
3. Unknown roles do not grant any permission.

## Route Matrix

| OpenAPI operationId | Endpoint | `user` | `sysadmin` | Ownership rule |
| --- | --- | --- | --- | --- |
| `createPrintJob` | `POST /v1/print-jobs` | allow | allow | caller creates own job |
| `getPrintJob` | `GET /v1/print-jobs/{jobId}` | allow (own only) | allow (cross-user) | `user` must match job owner |

## Enforcement Rules

1. Default deny: every protected route requires explicit allow by role and operation.
2. Ownership guard: `user` is restricted to resources where `subjectUserId === resourceOwnerUserId`.
3. Privileged override: `sysadmin` can access cross-user print-job reads for platform management.
4. Unauthorized shape: authenticated but unauthorized access returns HTTP `403` using `ErrorResponse`.

## Logging Requirements

On deny decisions, emit structured logs with:

1. Role set
2. Operation/route
3. Decision reason (`missing_role`, `operation_not_allowed`, `ownership_mismatch`)
4. `traceId`
