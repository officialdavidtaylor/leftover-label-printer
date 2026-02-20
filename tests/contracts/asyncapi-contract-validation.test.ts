import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const asyncApiPath = path.resolve(fileDir, '../../contracts/asyncapi.yaml');
const policyDocPath = path.resolve(fileDir, '../../docs/asyncapi-versioning-policy.md');

describe('asyncapi-contract-validation', () => {
  it('declares AsyncAPI metadata and topic routes', () => {
    const specText = fs.readFileSync(asyncApiPath, 'utf8');

    expect(specText).toContain('asyncapi: 2.6.0');
    expect(specText).toContain('version: 0.2.0');
    expect(specText).toContain('printers/{id}/jobs:');
    expect(specText).toContain('printers/{id}/status:');
  });

  it('requires command/outcome payload fields and outcome enums', () => {
    const specText = fs.readFileSync(asyncApiPath, 'utf8');

    expect(specText).toContain('PrintJobCommandPayload:');
    expect(specText).toContain('PrintJobOutcomePayload:');
    expect(specText).toContain('- schemaVersion');
    expect(specText).toContain('- type');
    expect(specText).toContain('- eventId');
    expect(specText).toContain('- traceId');
    expect(specText).toContain('- jobId');
    expect(specText).toContain('- printerId');
    expect(specText).toContain('- objectUrl');
    expect(specText).toContain('- issuedAt');
    expect(specText).toContain('- outcome');
    expect(specText).toContain('- occurredAt');
    expect(specText).toContain('enum:');
    expect(specText).toContain('- printed');
    expect(specText).toContain('- failed');
  });

  it('declares semver strategy for MQTT contract and schemaVersion usage', () => {
    const specText = fs.readFileSync(asyncApiPath, 'utf8');

    expect(specText).toContain('x-versioning-policy:');
    expect(specText).toContain('scheme: semver');
    expect(specText).toContain('messageSchemaVersionField: schemaVersion');
    expect(specText).toContain('currentMajor: 1');
    expect(specText).toContain('minimum_deprecation_window_days: 90');
  });
});

describe('asyncapi-policy-documentation', () => {
  it('publishes MQTT schema versioning and deprecation guidance for teams', () => {
    const policyDoc = fs.readFileSync(policyDocPath, 'utf8');

    expect(policyDoc).toContain('semantic versioning');
    expect(policyDoc).toContain('schemaVersion');
    expect(policyDoc).toContain('contracts/asyncapi.yaml');
    expect(policyDoc).toContain('90 days');
  });
});
