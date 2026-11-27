import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseRequirementsTxt,
  satisfiesConstraint,
  resolveSafeCwd,
  detectVenv,
  buildSafeEnv,
} from '../src/services/pythonEnvService.js';

test('parseRequirementsTxt parses standard constraints, extras, comments, and invalid lines', () => {
  const sample = `
# Core framework
Django==4.2.7
requests>=2.31.0 # HTTP library
uvicorn[standard]~=0.24.0
-r base.txt
   
invalid line with spaces ???
`;
  const { deps, invalidLines } = parseRequirementsTxt(sample);
  assert.equal(deps.length, 3);
  assert.equal(deps[0].name, 'Django');
  assert.equal(deps[0].constraint, '==4.2.7');
  assert.equal(deps[1].name, 'requests');
  assert.equal(deps[1].constraint, '>=2.31.0');
  assert.equal(deps[2].name, 'uvicorn');
  assert.equal(deps[2].extras, '[standard]');
  assert.equal(invalidLines.length, 1);
});

test('satisfiesConstraint detects matches and version conflicts', () => {
  assert.equal(satisfiesConstraint('4.2.7', '==4.2.7'), true);
  assert.equal(satisfiesConstraint('4.2.6', '==4.2.7'), false);
  assert.equal(satisfiesConstraint('2.32.0', '>=2.31.0'), true);
  assert.equal(satisfiesConstraint('2.30.0', '>=2.31.0'), false);
  assert.equal(satisfiesConstraint('1.0.0', 'latest'), true);
});

test('resolveSafeCwd allows navigating inside workspace and blocks parent escape', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ch_ws_test_'));
  try {
    fs.mkdirSync(path.join(tmpRoot, 'src', 'utils'), { recursive: true });
    const sub = resolveSafeCwd(tmpRoot, '', 'src/utils');
    assert.equal(sub.relCwd, 'src/utils');

    const back = resolveSafeCwd(tmpRoot, 'src/utils', '..');
    assert.equal(back.relCwd, 'src');

    assert.throws(() => resolveSafeCwd(tmpRoot, '', '../..'), /Access denied/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('detectVenv finds venv/.venv/env and buildSafeEnv injects VIRTUAL_ENV without leaking secrets', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ch_venv_test_'));
  try {
    const isWin = os.platform() === 'win32';
    const binDir = path.join(tmpRoot, '.venv', isWin ? 'Scripts' : 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const pyBin = path.join(binDir, isWin ? 'python.exe' : 'python');
    fs.writeFileSync(pyBin, '', 'utf8');

    const venv = detectVenv(tmpRoot);
    assert.equal(venv.exists, true);
    assert.equal(venv.name, '.venv');

    process.env.TEST_SECRET_TOKEN = 'super_secret_should_not_leak';
    const env = buildSafeEnv(tmpRoot, venv);
    assert.equal(env.VIRTUAL_ENV, path.join(tmpRoot, '.venv'));
    assert.equal(env.TEST_SECRET_TOKEN, undefined);
    delete process.env.TEST_SECRET_TOKEN;
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
