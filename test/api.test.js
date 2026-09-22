import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

async function fixture(t) {
  const logs = [];
  const app = createApp({ environment: 'test', version: 'test-1', logger: (line) => logs.push(line) });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = (path, options = {}) => fetch(`${base}${path}`, options);
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { ...app, logs, base, request, json };
}

describe('HTTP API integration', () => {
  test('HTTP API supports the full task lifecycle using a real database', async (t) => {
    const { request, json } = await fixture(t);
    const created = await request('/api/tasks', json('POST', { title: 'Pipeline demo', priority: 'high' }));
    assert.equal(created.status, 201);
    assert.equal(created.headers.get('location'), '/api/tasks/1');
    assert.equal((await created.json()).status, 'open');
    assert.equal((await (await request('/api/tasks/1')).json()).title, 'Pipeline demo');
    const changed = await request('/api/tasks/1', json('PATCH', { status: 'done', description: 'Recorded' }));
    assert.equal((await changed.json()).status, 'done');
    const listed = await (await request('/api/tasks?status=done&priority=high&q=demo')).json();
    assert.equal(listed.tasks.length, 1);
    assert.equal((await (await request('/api/stats')).json()).done, 1);
    const removed = await request('/api/tasks/1', { method: 'DELETE' });
    assert.equal(removed.status, 204);
    assert.equal(await removed.text(), '');
    assert.equal((await request('/api/tasks/1')).status, 404);
  });

  test('health and version endpoints identify the environment and release', async (t) => {
    const { request } = await fixture(t);
    assert.deepEqual(await (await request('/health')).json(), { status: 'ok', environment: 'test', version: 'test-1' });
    assert.deepEqual(await (await request('/api/info')).json(), { name: 'Taskboard', environment: 'test', version: 'test-1' });
  });

  test('serves the UI with restrictive browser security headers', async (t) => {
    const { request } = await fixture(t);
    const page = await request('/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>Taskboard<\/title>/);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.match((await request('/styles.css')).headers.get('content-type'), /text\/css/);
    assert.match((await request('/app.js')).headers.get('content-type'), /text\/javascript/);
    assert.equal((await request('/src/store.js')).status, 404);
    assert.equal((await request('/data/tasks.db')).status, 404);
  });

  test('rejects malformed JSON, wrong content types, oversized bodies and invalid task IDs', async (t) => {
    const { request, json } = await fixture(t);
    assert.equal((await request('/api/tasks', json('POST', { title: '' }))).status, 400);
    assert.equal((await request('/api/tasks/abc')).status, 400);
    assert.equal((await request('/api/tasks', { method: 'POST', body: '{}' })).status, 415);
    assert.equal((await request('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status, 400);
    assert.equal((await request('/api/tasks', json('POST', { title: 'x'.repeat(9000) }))).status, 413);
  });

  test('rejects unsupported methods and unknown routes', async (t) => {
    const { request } = await fixture(t);
    const collection = await request('/api/tasks', { method: 'PUT' });
    assert.equal(collection.status, 405);
    assert.equal(collection.headers.get('allow'), 'GET, POST');
    assert.equal((await request('/api/tasks/1', { method: 'PUT' })).status, 405);
    assert.equal((await request('/missing')).status, 404);
  });

  test('rejects changes from other origins but allows the same local origin', async (t) => {
    const { request, json, base } = await fixture(t);
    const requestBody = json('POST', { title: 'Origin check' });
    assert.equal((await request('/api/tasks', { ...requestBody, headers: { ...requestBody.headers, Origin: 'https://other.example' } })).status, 403);
    assert.equal((await request('/api/tasks', { ...requestBody, headers: { ...requestBody.headers, Origin: 'null' } })).status, 403);
    assert.equal((await request('/api/tasks', { ...requestBody, headers: { ...requestBody.headers, Origin: base } })).status, 201);
  });

  test('metrics expose requests, duration, task counts and uptime without task IDs in labels', async (t) => {
    const { request, json } = await fixture(t);
    await (await request('/api/tasks', json('POST', { title: 'Metric test' }))).json();
    await (await request('/api/tasks/1')).json();
    const response = await request('/metrics');
    assert.match(response.headers.get('content-type'), /text\/plain/);
    const body = await response.text();
    assert.match(body, /taskboard_http_requests_total\{method="GET",route="\/api\/tasks\/:id",status="200"\} 1/);
    assert.match(body, /taskboard_tasks\{status="open"\} 1/);
    assert.match(body, /taskboard_http_request_duration_seconds_sum/);
    assert.match(body, /taskboard_uptime_seconds/);
    assert.doesNotMatch(body, /route="\/api\/tasks\/1"/);
  });

  test('unhealthy database readiness returns 503', async (t) => {
    const { request, store } = await fixture(t);
    store.healthy = () => false;
    assert.equal((await request('/health')).status, 503);
  });

  test('internal failures return a generic error without leaking details', async (t) => {
    const { request, store, logs } = await fixture(t);
    store.healthy = () => { throw new Error('Private database details'); };
    const response = await request('/health');
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Internal server error.' });
    assert.ok(logs.some((line) => line.includes('Internal application error')));
    assert.ok(logs.every((line) => !line.includes('Private database details')));
  });
});
