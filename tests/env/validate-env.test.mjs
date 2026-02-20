import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateEnv, validateEnvFiles } from '../../scripts/env/validate-env.mjs';

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const validatorPath = path.resolve(fileDir, '../../scripts/env/validate-env.mjs');

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-validate-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

test('validateEnv detects missing and blank required keys', () => {
  const required = 'REQUIRED_ONE\nREQUIRED_TWO\n';
  const envText = 'REQUIRED_ONE=1\nREQUIRED_TWO=\n';
  const missingKeys = validateEnv(required, envText);

  assert.deepEqual(missingKeys, ['REQUIRED_TWO']);
});

test('validateEnv allows blank values in --keys-only mode', () => {
  const required = 'REQUIRED_ONE\nREQUIRED_TWO\n';
  const envText = 'REQUIRED_ONE=1\nREQUIRED_TWO=\n';
  const missingKeys = validateEnv(required, envText, { keysOnly: true });

  assert.deepEqual(missingKeys, []);
});

test('validateEnvFiles passes with complete required values', () => {
  withTmpDir((dir) => {
    const requiredPath = path.join(dir, 'required.txt');
    const envPath = path.join(dir, 'pass.env');

    writeFile(requiredPath, 'REQUIRED_ONE\nREQUIRED_TWO\n');
    writeFile(envPath, 'REQUIRED_ONE=1\nREQUIRED_TWO=2\nOPTIONAL_THREE=\n');

    assert.deepEqual(validateEnvFiles(requiredPath, envPath), []);
  });
});

test('CLI exits 0 and prints success for valid env file', () => {
  withTmpDir((dir) => {
    const requiredPath = path.join(dir, 'required.txt');
    const envPath = path.join(dir, 'pass.env');

    writeFile(requiredPath, 'REQUIRED_ONE\nREQUIRED_TWO\n');
    writeFile(envPath, 'REQUIRED_ONE=1\nREQUIRED_TWO=2\n');

    const run = spawnSync(process.execPath, [validatorPath, requiredPath, envPath], {
      encoding: 'utf8',
    });

    assert.equal(run.status, 0);
    assert.match(run.stdout, /Validation passed:/);
  });
});

test('CLI exits 1 for missing required key', () => {
  withTmpDir((dir) => {
    const requiredPath = path.join(dir, 'required.txt');
    const envPath = path.join(dir, 'missing.env');

    writeFile(requiredPath, 'REQUIRED_ONE\nREQUIRED_TWO\n');
    writeFile(envPath, 'REQUIRED_ONE=1\n');

    const run = spawnSync(process.execPath, [validatorPath, requiredPath, envPath], {
      encoding: 'utf8',
    });

    assert.equal(run.status, 1);
    assert.match(run.stderr, /Missing required env keys: REQUIRED_TWO/);
  });
});

test('CLI exits 2 for invalid usage', () => {
  const run = spawnSync(process.execPath, [validatorPath], {
    encoding: 'utf8',
  });

  assert.equal(run.status, 2);
  assert.match(run.stderr, /usage: node scripts\/env\/validate-env\.mjs/);
});
