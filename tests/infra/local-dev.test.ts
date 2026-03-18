import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseLocalDevConfig } from '../../infra/scripts/local-dev.ts';

describe('local-dev config', () => {
  it('parses defaults from infra env files and computes repo paths', () => {
    const config = parseLocalDevConfig(
      `KEYCLOAK_ADMIN_USERNAME=admin
KEYCLOAK_ADMIN_PASSWORD=changeme
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
EMQX_BACKEND_MQTT_USERNAME=backend
EMQX_AGENT_MQTT_USERNAME=printer-01
`,
      '/tmp/workspace/infra/.env'
    );

    expect(config.oidcIssuerUrl).toBe('http://localhost:9000/realms/leftover-label-printer');
    expect(config.keycloakBootstrapBaseUrl).toBe('http://127.0.0.1:9000');
    expect(config.devRoles).toEqual(['user']);
    expect(config.pwaClientId).toBe('leftover-label-printer-pwa');
    expect(config.frontendBaseUrl).toBe('http://localhost:3000');
    expect(config.printerId).toBe('printer-01');
    expect(config.minioBaseUrl).toBe('http://localhost:9002');
    expect(config.repoRoot).toBe(path.resolve('/tmp/workspace'));
    expect(config.artifactDir).toBe(path.resolve('/tmp/workspace/infra/dev-artifacts'));
  });

  it('rejects env files where the mock-agent username does not match the printer id', () => {
    expect(() =>
      parseLocalDevConfig(
        `KEYCLOAK_ADMIN_USERNAME=admin
KEYCLOAK_ADMIN_PASSWORD=changeme
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
EMQX_BACKEND_MQTT_USERNAME=backend
EMQX_AGENT_MQTT_USERNAME=printer-02
DEV_PRINTER_ID=printer-01
`,
        '/tmp/workspace/infra/.env'
      )
    ).toThrow('EMQX_AGENT_MQTT_USERNAME must match DEV_PRINTER_ID');
  });
});
