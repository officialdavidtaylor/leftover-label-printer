import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  authorizePrintJobOperation,
  buildForbiddenError,
} from '../../backend/src/auth/rbac-policy.ts';

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const openApiPath = path.resolve(fileDir, '../../contracts/openapi.yaml');

describe('rbac-policy', () => {
  it('allows user to read own print job', () => {
    const decision = authorizePrintJobOperation({
      operation: 'getPrintJob',
      subjectUserId: 'user-1',
      subjectRoles: ['user'],
      resourceOwnerUserId: 'user-1',
    });

    expect(decision).toEqual({ allowed: true });
  });

  it('denies user when reading another user job', () => {
    const decision = authorizePrintJobOperation({
      operation: 'getPrintJob',
      subjectUserId: 'user-1',
      subjectRoles: ['user'],
      resourceOwnerUserId: 'user-2',
    });

    expect(decision).toEqual({ allowed: false, reason: 'ownership_mismatch' });
  });

  it('allows sysadmin to read cross-user job', () => {
    const decision = authorizePrintJobOperation({
      operation: 'getPrintJob',
      subjectUserId: 'admin-1',
      subjectRoles: ['sysadmin'],
      resourceOwnerUserId: 'user-2',
    });

    expect(decision).toEqual({ allowed: true });
  });

  it('enforces default deny for missing or unknown roles', () => {
    const noRoleDecision = authorizePrintJobOperation({
      operation: 'getPrintJob',
      subjectUserId: 'user-1',
      subjectRoles: [],
      resourceOwnerUserId: 'user-1',
    });

    const unknownRoleDecision = authorizePrintJobOperation({
      operation: 'getPrintJob',
      subjectUserId: 'user-1',
      subjectRoles: ['operator'],
      resourceOwnerUserId: 'user-1',
    });

    expect(noRoleDecision).toEqual({ allowed: false, reason: 'missing_role' });
    expect(unknownRoleDecision).toEqual({ allowed: false, reason: 'missing_role' });
  });
});

describe('forbidden-error-contract', () => {
  it('returns deterministic 403 body shape', () => {
    const response = buildForbiddenError('trace-123');
    expect(response).toEqual({
      code: 'forbidden',
      message: 'Forbidden',
      traceId: 'trace-123',
    });
  });

  it('remains aligned with ErrorResponse requirements in OpenAPI', () => {
    const openApiText = fs.readFileSync(openApiPath, 'utf8');

    expect(openApiText).toContain("'403':");
    expect(openApiText).toContain("$ref: '#/components/schemas/ErrorResponse'");
    expect(openApiText).toContain('ErrorResponse:');
    expect(openApiText).toContain('- code');
    expect(openApiText).toContain('- message');
  });
});
