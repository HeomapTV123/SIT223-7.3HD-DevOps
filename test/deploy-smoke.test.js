import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createApp } from '../src/app.js';
import { smokeDeploy } from '../scripts/smoke-deploy.mjs';

async function fixture(t, environment = 'staging') {
  const app = createApp({ environment, version: 'build-check', logger: () => {} });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
  });
  const options = { baseUrl: `http://127.0.0.1:${app.server.address().port}`, expectedVersion: 'build-check', expectedEnvironment: environment };
  const existing = app.store.create({ title: 'Preserve this user task' });
  return { ...app, options, existing };
}

test('deployment smoke checks pass and preserve existing tasks', async (t) => {
  const { options, store, existing } = await fixture(t);
  const result = await smokeDeploy(options);
  assert.equal(result.status, 'PASSED');
  assert.equal(result.checks.length, 7);
  assert.ok(result.checks.every((check) => check.passed));
  assert.deepEqual(store.list(), [existing]);
});

test('wrong build or environment blocks smoke checks before any task changes', async (t) => {
  const { options, store, existing } = await fixture(t);
  for (const mismatch of [{ expectedVersion: 'build-wrong' }, { expectedEnvironment: 'production' }]) {
    const result = await smokeDeploy({ ...options, ...mismatch });
    assert.equal(result.status, 'FAILED');
    assert.equal(result.checks.length, 1);
    assert.equal(result.checks[0].passed, false);
    assert.deepEqual(store.list(), [existing]);
  }
});

test('a failed deployed API check still cleans up its temporary task', async (t) => {
  const { options, store, existing } = await fixture(t);
  store.update = () => { throw new Error('Simulated deployment failure'); };
  const result = await smokeDeploy(options);
  assert.equal(result.status, 'FAILED');
  assert.match(result.error, /expected HTTP 200, received 500/);
  assert.deepEqual(result.checks.at(-1), { name: 'delete temporary task', passed: true });
  assert.deepEqual(store.list(), [existing]);
});

test('cleanup failure prevents a passing deployment result and identifies the leftover task', async (t) => {
  const { options, store, existing } = await fixture(t);
  store.remove = () => { throw new Error('Simulated cleanup failure'); };
  const result = await smokeDeploy(options);
  assert.equal(result.status, 'FAILED');
  assert.match(result.error, /Cleanup failed for task/);
  assert.equal(result.checks.at(-1).passed, false);
  assert.deepEqual(store.get(existing.id), existing);
});

test('smoke CLI writes JSON and returns a failing exit code for a wrong release', async (t) => {
  const { options } = await fixture(t);
  const child = spawn(process.execPath, ['scripts/smoke-deploy.mjs', options.baseUrl, 'wrong-release', 'staging']);
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(code, 1);
  assert.equal(JSON.parse(stdout).status, 'FAILED');
});

test('production smoke CLI validates release identity and preserves existing user tasks', async (t) => {
  const { options, store, existing } = await fixture(t, 'production');
  const wrongEnvironment = await smokeDeploy({ ...options, expectedEnvironment: 'staging' });
  assert.equal(wrongEnvironment.status, 'FAILED');
  assert.deepEqual(store.list(), [existing]);

  const child = spawn(process.execPath, ['scripts/smoke-deploy.mjs', options.baseUrl, options.expectedVersion, 'production']);
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  const report = JSON.parse(stdout);
  assert.equal(code, 0);
  assert.equal(report.status, 'PASSED');
  assert.equal(report.expectedEnvironment, 'production');
  assert.equal(report.expectedVersion, options.expectedVersion);
  assert.equal(report.checks.length, 7);
  assert.ok(report.checks.every((check) => check.passed));
  assert.deepEqual(store.list(), [existing]);
});
