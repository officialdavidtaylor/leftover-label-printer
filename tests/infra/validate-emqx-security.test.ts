import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(fileDir, '../../infra/scripts/validate-emqx-security.sh');

function withTmpDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emqx-security-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, 'utf8');
}

describe('validate-emqx-security', () => {
  it('passes local mode with defaults', () => {
    withTmpDir((dir) => {
      const envPath = path.join(dir, '.env');
      writeFile(envPath, 'EMQX_DEPLOYMENT_ENV=local\nEMQX_REQUIRE_TLS=false\nEMQX_ENABLE_PLAIN_MQTT=true\n');

      const run = spawnSync('/bin/sh', [scriptPath, envPath], { encoding: 'utf8' });
      expect(run.status).toBe(0);
      expect(run.stdout).toMatch(/guardrails passed/);
    });
  });

  it('fails non-local mode when TLS is disabled', () => {
    withTmpDir((dir) => {
      const envPath = path.join(dir, '.env');
      writeFile(envPath, 'EMQX_DEPLOYMENT_ENV=staging\nEMQX_REQUIRE_TLS=false\nEMQX_ENABLE_PLAIN_MQTT=false\n');

      const run = spawnSync('/bin/sh', [scriptPath, envPath], { encoding: 'utf8' });
      expect(run.status).toBe(1);
      expect(run.stderr).toMatch(/EMQX_REQUIRE_TLS must be true/);
    });
  });

  it('fails when TLS is enabled but cert files are missing', () => {
    withTmpDir((dir) => {
      const certDir = path.join(dir, 'certs');
      fs.mkdirSync(certDir, { recursive: true });

      const envPath = path.join(dir, '.env');
      writeFile(
        envPath,
        `EMQX_DEPLOYMENT_ENV=staging
EMQX_REQUIRE_TLS=true
EMQX_ENABLE_PLAIN_MQTT=false
EMQX_TLS_CERT_DIR=${certDir}
EMQX_TLS_CA_CERT_FILE=ca.crt
EMQX_TLS_CERT_FILE=server.crt
EMQX_TLS_KEY_FILE=server.key
`
      );

      const run = spawnSync('/bin/sh', [scriptPath, envPath], { encoding: 'utf8' });
      expect(run.status).toBe(1);
      expect(run.stderr).toMatch(/missing TLS file/);
    });
  });

  it('passes when non-local mode has TLS-only and cert files present', () => {
    withTmpDir((dir) => {
      const certDir = path.join(dir, 'certs');
      fs.mkdirSync(certDir, { recursive: true });
      writeFile(path.join(certDir, 'ca.crt'), 'ca');
      writeFile(path.join(certDir, 'server.crt'), 'cert');
      writeFile(path.join(certDir, 'server.key'), 'key');

      const envPath = path.join(dir, '.env');
      writeFile(
        envPath,
        `EMQX_DEPLOYMENT_ENV=production
EMQX_REQUIRE_TLS=true
EMQX_ENABLE_PLAIN_MQTT=false
EMQX_TLS_CERT_DIR=${certDir}
EMQX_TLS_CA_CERT_FILE=ca.crt
EMQX_TLS_CERT_FILE=server.crt
EMQX_TLS_KEY_FILE=server.key
`
      );

      const run = spawnSync('/bin/sh', [scriptPath, envPath], { encoding: 'utf8' });
      expect(run.status).toBe(0);
      expect(run.stdout).toMatch(/guardrails passed for production/);
    });
  });
});
