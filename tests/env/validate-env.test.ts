import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validateEnv, validateEnvFiles } from '../../scripts/env/validate-env.ts';

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const validatorPath = path.resolve(fileDir, '../../scripts/env/validate-env.ts');

function withTmpDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-validate-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, 'utf8');
}

describe('validate-env', () => {
  it('detects missing and blank required keys', () => {
    const required = 'REQUIRED_ONE\nREQUIRED_TWO\n';
    const envText = 'REQUIRED_ONE=1\nREQUIRED_TWO=\n';
    const missingKeys = validateEnv(required, envText);

    expect(missingKeys).toEqual(['REQUIRED_TWO']);
  });

  it('allows blank values in --keys-only mode', () => {
    const required = 'REQUIRED_ONE\nREQUIRED_TWO\n';
    const envText = 'REQUIRED_ONE=1\nREQUIRED_TWO=\n';
    const missingKeys = validateEnv(required, envText, { keysOnly: true });

    expect(missingKeys).toEqual([]);
  });

  it('passes with complete required values', () => {
    withTmpDir((dir) => {
      const requiredPath = path.join(dir, 'required.txt');
      const envPath = path.join(dir, 'pass.env');

      writeFile(requiredPath, 'REQUIRED_ONE\nREQUIRED_TWO\n');
      writeFile(envPath, 'REQUIRED_ONE=1\nREQUIRED_TWO=2\nOPTIONAL_THREE=\n');

      expect(validateEnvFiles(requiredPath, envPath)).toEqual([]);
    });
  });

  it('CLI exits 0 and prints success for valid env file', () => {
    withTmpDir((dir) => {
      const requiredPath = path.join(dir, 'required.txt');
      const envPath = path.join(dir, 'pass.env');

      writeFile(requiredPath, 'REQUIRED_ONE\nREQUIRED_TWO\n');
      writeFile(envPath, 'REQUIRED_ONE=1\nREQUIRED_TWO=2\n');

      const run = spawnSync(
        process.execPath,
        ['--experimental-strip-types', validatorPath, requiredPath, envPath],
        { encoding: 'utf8' }
      );

      expect(run.status).toBe(0);
      expect(run.stdout).toMatch(/Validation passed:/);
    });
  });

  it('CLI exits 1 for missing required key', () => {
    withTmpDir((dir) => {
      const requiredPath = path.join(dir, 'required.txt');
      const envPath = path.join(dir, 'missing.env');

      writeFile(requiredPath, 'REQUIRED_ONE\nREQUIRED_TWO\n');
      writeFile(envPath, 'REQUIRED_ONE=1\n');

      const run = spawnSync(
        process.execPath,
        ['--experimental-strip-types', validatorPath, requiredPath, envPath],
        { encoding: 'utf8' }
      );

      expect(run.status).toBe(1);
      expect(run.stderr).toMatch(/Missing required env keys: REQUIRED_TWO/);
    });
  });

  it('CLI exits 2 for invalid usage', () => {
    const run = spawnSync(process.execPath, ['--experimental-strip-types', validatorPath], {
      encoding: 'utf8',
    });

    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(
      /usage: node --experimental-strip-types scripts\/env\/validate-env\.ts/
    );
  });
});
