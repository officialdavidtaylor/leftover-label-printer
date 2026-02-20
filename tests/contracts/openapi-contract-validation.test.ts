import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import SwaggerParser from '@apidevtools/swagger-parser';
import { describe, expect, it } from 'vitest';

type OpenApiSpec = {
  openapi: string;
  info: {
    version: string;
  };
  paths: Record<string, unknown>;
  components: {
    securitySchemes: Record<string, unknown>;
    schemas: Record<string, unknown>;
  };
  security?: Array<Record<string, unknown>>;
  'x-versioning-policy'?: {
    scheme?: string;
    breakingChange?: {
      requiresMajorVersionBump?: boolean;
      minimumDeprecationWindowDays?: number;
      migrationGuideRequired?: boolean;
      owner?: string;
    };
  };
};

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const openApiPath = path.resolve(fileDir, '../../contracts/openapi.yaml');
const policyDocPath = path.resolve(fileDir, '../../docs/openapi-versioning-policy.md');

async function loadValidatedSpec(): Promise<OpenApiSpec> {
  const validated = await SwaggerParser.validate(openApiPath);
  return validated as OpenApiSpec;
}

describe('openapi-contract-validation', () => {
  it('parses as a valid OpenAPI 3.0.3 document', async () => {
    const spec = await loadValidatedSpec();

    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.version).toBe('0.1.0');
  });

  it('defines MVP operations and expected response status contracts', async () => {
    const spec = await loadValidatedSpec();

    expect(spec.paths['/v1/print-jobs']).toBeDefined();
    expect(spec.paths['/v1/print-jobs/{jobId}']).toBeDefined();

    const createOperation = spec.paths['/v1/print-jobs'] as {
      post?: {
        operationId?: string;
        responses?: Record<string, unknown>;
      };
    };
    const getOperation = spec.paths['/v1/print-jobs/{jobId}'] as {
      get?: {
        operationId?: string;
        responses?: Record<string, unknown>;
      };
    };

    expect(createOperation.post?.operationId).toBe('createPrintJob');
    expect(Object.keys(createOperation.post?.responses ?? {})).toEqual(
      expect.arrayContaining(['202', '400', '401', '403'])
    );

    expect(getOperation.get?.operationId).toBe('getPrintJob');
    expect(Object.keys(getOperation.get?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '401', '403', '404'])
    );
  });

  it('keeps state and error enums aligned with backend expectations', async () => {
    const spec = await loadValidatedSpec();
    const schemas = spec.components.schemas as Record<string, { enum?: string[] }>;
    const errorResponse = schemas.ErrorResponse as unknown as {
      properties?: {
        code?: {
          enum?: string[];
        };
      };
    };

    expect(schemas.PrintJobState.enum).toEqual([
      'pending',
      'processing',
      'dispatched',
      'printed',
      'failed',
    ]);

    expect(schemas.ErrorResponse.enum).toBeUndefined();
    expect(errorResponse.properties?.code?.enum).toEqual([
      'validation_error',
      'unauthorized',
      'forbidden',
      'not_found',
    ]);
  });

  it('requires global bearer auth and explicit semver/deprecation policy metadata', async () => {
    const spec = await loadValidatedSpec();

    expect(spec.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.components.securitySchemes.bearerAuth).toBeDefined();

    expect(spec['x-versioning-policy']).toEqual({
      scheme: 'semver',
      breakingChange: {
        requiresMajorVersionBump: true,
        minimumDeprecationWindowDays: 90,
        migrationGuideRequired: true,
        owner: 'api-team',
      },
    });
  });
});

describe('openapi-policy-documentation', () => {
  it('publishes semver and deprecation guidance for implementation teams', () => {
    const policyDoc = fs.readFileSync(policyDocPath, 'utf8');

    expect(policyDoc).toContain('semantic versioning');
    expect(policyDoc).toContain('90 days');
    expect(policyDoc).toContain('contracts/openapi.yaml');
  });
});
