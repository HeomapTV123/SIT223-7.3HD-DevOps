import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { emailConfiguration, installEmailConfiguration } from '../scripts/configure-monitoring.mjs';
import { metricSum, monitoringSnapshot, phaseSatisfied, waitForMonitoring } from '../scripts/check-monitoring.mjs';

const emailEnv = () => ({ SMTP_SMARTHOST: 'smtp.example.org:587', SMTP_USERNAME: 'sender@example.org',
  SMTP_PASSWORD: 'test-only-placeholder', SMTP_FROM: '', ALERT_EMAIL_TO: 'receiver@example.org' });

test('email configuration requires TLS and sends outage and recovery without embedding the password', () => {
  const env = emailEnv();
  const config = emailConfiguration(env);
  assert.equal(config.global.smtp_require_tls, true);
  assert.equal(config.global.smtp_from, env.SMTP_USERNAME);
  assert.equal(config.global.smtp_auth_password_file, '/etc/alertmanager/private/smtp-password');
  assert.equal(JSON.stringify(config).includes(env.SMTP_PASSWORD), false);
  assert.ok(config.receivers.every((receiver) => receiver.email_configs[0].send_resolved));
  assert.deepEqual(config.route.routes, [{ receiver: 'availability-email', matchers: ['alertname="TaskboardDown"'] }]);
  assert.equal(emailConfiguration({ ...env, SMTP_FROM: 'alias@example.org' }).global.smtp_from, 'alias@example.org');
});

test('invalid SMTP settings fail without including credentials in errors', () => {
  const invalid = [
    { SMTP_SMARTHOST: '' }, { SMTP_SMARTHOST: 'smtp.example.org:465' }, { SMTP_SMARTHOST: 'smtp.example.org:0' },
    { SMTP_SMARTHOST: 'smtp.example.org:65536' }, { SMTP_SMARTHOST: 'host\n:587' },
    { SMTP_USERNAME: undefined }, { SMTP_PASSWORD: '' }, { SMTP_PASSWORD: 'private\nvalue' },
    { ALERT_EMAIL_TO: 'one@example.org,two@example.org' }, { ALERT_EMAIL_TO: 'bad-address' },
    { SMTP_FROM: '{{private}}@example.org' },
  ];
  for (const change of invalid) {
    const env = { ...emailEnv(), ...change };
    assert.throws(() => emailConfiguration(env), (error) => !error.message.includes('test-only-placeholder') && !error.message.includes('private'));
  }
});

test('private config installation rotates the password and leaves existing config intact after invalid input',
  { skip: process.platform === 'win32' ? 'Linux permissions are verified in the Docker test target.' : false }, (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'taskboard-email-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = emailEnv();
  installEmailConfiguration(directory, env);
  assert.equal(readFileSync(join(directory, 'smtp-password'), 'utf8'), env.SMTP_PASSWORD);
  assert.equal(statSync(join(directory, 'smtp-password')).mode & 0o777, 0o400);
  const oldConfig = readFileSync(join(directory, 'alertmanager.yml'), 'utf8');
  assert.throws(() => installEmailConfiguration(directory, { ...env, ALERT_EMAIL_TO: '' }));
  assert.equal(readFileSync(join(directory, 'alertmanager.yml'), 'utf8'), oldConfig);
  installEmailConfiguration(directory, { ...env, SMTP_PASSWORD: 'replacement-test-placeholder' });
  assert.equal(readFileSync(join(directory, 'smtp-password'), 'utf8'), 'replacement-test-placeholder');
  assert.deepEqual(readdirSync(directory).sort(), ['alertmanager.yml', 'smtp-password']);
});

async function fixture(t) {
  const state = { up: 1, requests: 0, failed: 0, startedAt: 12345, phase: 'healthy',
    silence: false, failPath: '', badResponse: false, badRules: false };
  const alert = () => ({ labels: { alertname: 'TaskboardDown', environment: 'production' },
    state: state.phase, status: { state: state.silence ? 'suppressed' : 'active',
      silencedBy: state.silence ? ['test-silence'] : [], inhibitedBy: [] } });
  const query = () => ({ status: 'success', data: { result: [{ value: [Date.now() / 1000, String(state.up)] }] } });
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === state.failPath) { response.writeHead(503).end('unavailable'); return; }
    let result;
    switch (path) {
      case '/api/v1/targets': result = { status: 'success', data: { activeTargets: [{ labels: { job: 'taskboard-production' }, health: state.up ? 'up' : 'down', lastScrape: new Date().toISOString(), lastError: state.up ? '' : 'connection refused' }] } }; break;
      case '/api/v1/rules': result = { status: 'success', data: { groups: [{ rules: ['TaskboardDown', 'TaskboardHighErrorRate', 'TaskboardHighMemory'].map((name) => ({ name, health: state.badRules ? 'err' : 'ok' })) }] } }; break;
      case '/api/v1/alerts': result = { status: 'success', data: { alerts: state.phase === 'healthy' ? [] : [alert()] } }; break;
      case '/api/v1/alertmanagers': result = { status: 'success', data: { activeAlertmanagers: [{ url: 'http://alertmanager:9093/api/v2/alerts' }] } }; break;
      case '/api/v1/query': case '/api/datasources/proxy/uid/taskboard-prometheus/api/v1/query': result = query(); break;
      case '/api/v2/alerts': result = state.phase === 'firing' ? [alert()] : []; break;
      case '/metrics': response.end([
        '# HELP example ignored comment',
        `process_start_time_seconds ${state.startedAt}`,
        `alertmanager_notification_requests_total{receiver_name="availability-email",integration="email"} ${state.requests}`,
        `alertmanager_notification_requests_failed_total{integration="email",receiver_name="availability-email"} ${state.failed}`,
        'alertmanager_notification_requests_total{integration="email",receiver_name="production-email"} 100',
      ].join('\n')); return;
      case '/api/health': result = { database: 'ok' }; break;
      case '/api/dashboards/uid/taskboard-production': result = { dashboard: { uid: 'taskboard-production' } }; break;
      default: response.writeHead(404).end(); return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(state.badResponse ? { status: 'error' } : result));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { state, options: { prometheusUrl: url, alertmanagerUrl: url, grafanaUrl: url, timeoutMs: 100, intervalMs: 1 } };
}

test('monitoring checks real HTTP APIs, production metrics, dashboard and datasource before passing', async (t) => {
  const { options } = await fixture(t);
  const result = await waitForMonitoring('ready', options);
  assert.equal(result.status, 'PASSED');
  assert.equal(result.email.succeeded, 0);
  assert.match(result.emailEvidence, /NOT_TESTED/);
  assert.equal(result.grafana.up, 1);
});

test('failed SMTP requests, pending alerts and silences cannot pass an outage demonstration', async (t) => {
  const { state, options } = await fixture(t);
  const baseline = await monitoringSnapshot(options);
  Object.assign(state, { up: 0, phase: 'pending', requests: 1, failed: 1 });
  assert.equal(phaseSatisfied('firing', await monitoringSnapshot(options), baseline), false);
  state.phase = 'firing';
  assert.equal(phaseSatisfied('firing', await monitoringSnapshot(options), baseline), false);
  Object.assign(state, { requests: 2, silence: true });
  assert.equal(phaseSatisfied('firing', await monitoringSnapshot(options), baseline), false);
  state.silence = false;
  const firing = await waitForMonitoring('firing', { ...options, baseline });
  assert.equal(firing.email.succeeded, 1);
  Object.assign(state, { up: 1, phase: 'healthy' });
  assert.equal(phaseSatisfied('resolved', await monitoringSnapshot(options), firing), false);
  state.requests++;
  const resolved = await waitForMonitoring('resolved', { ...options, baseline: firing });
  assert.equal(resolved.email.succeeded, 2);
  assert.match(resolved.emailEvidence, /SMTP server accepted/);
});

test('stale scrapes, missing targets, bad rules and a broken Grafana datasource cannot count as ready', async (t) => {
  const { options } = await fixture(t);
  const valid = await monitoringSnapshot(options);
  for (const change of [
    { targets: [] }, { targets: [{ ...valid.targets[0], lastScrape: '2000-01-01T00:00:00Z' }] },
    { rules: [] }, { grafana: { ...valid.grafana, up: null } }, { alertmanagerConnected: false },
  ]) assert.equal(phaseSatisfied('ready', { ...valid, ...change }), false);
});

test('an Alertmanager restart invalidates the delivery baseline', async (t) => {
  const { state, options } = await fixture(t);
  const baseline = await monitoringSnapshot(options);
  Object.assign(state, { startedAt: 12346, requests: 3, up: 0, phase: 'firing' });
  await assert.rejects(waitForMonitoring('firing', { ...options, baseline }), /restarted/);
});

test('monitoring timeout reports the last unhealthy snapshot', async (t) => {
  const { state, options } = await fixture(t);
  state.badRules = true;
  await assert.rejects(waitForMonitoring('ready', { ...options, timeoutMs: 5 }), (error) => {
    assert.match(error.message, /timed out/);
    assert.equal(error.snapshot.rules[0].health, 'err');
    return true;
  });
});

test('HTTP failures and malformed API responses fail the monitoring check', async (t) => {
  const { state, options } = await fixture(t);
  state.failPath = '/api/health';
  await assert.rejects(waitForMonitoring('ready', { ...options, timeoutMs: 5 }), /HTTP 503/);
  Object.assign(state, { failPath: '', badResponse: true });
  await assert.rejects(monitoringSnapshot(options), /malformed/);
});

test('invalid metrics and missing baselines cannot be used as email proof', async (t) => {
  const { state, options } = await fixture(t);
  for (const change of [{ startedAt: 0 }, { requests: 0, failed: 1 }]) {
    Object.assign(state, change);
    await assert.rejects(monitoringSnapshot(options), /delivery metrics are invalid/);
  }
  await assert.rejects(waitForMonitoring('unknown'), /Expected ready/);
  await assert.rejects(waitForMonitoring('firing'), /valid delivery baseline/);
  assert.throws(() => metricSum('counter -1', 'counter'), /Invalid counter/);
  assert.equal(metricSum('counter{label="a\\\"b"} 2\nother 10', 'counter', { label: 'a"b' }), 2);
});

async function runNode(args, env = {}) {
  const child = spawn(process.execPath, args, { env: { ...process.env, ...env } });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  return { code, stdout, stderr };
}

test('monitoring CLI emits usable JSON and returns a nonzero status for invalid execution', async (t) => {
  const { options } = await fixture(t);
  const result = await runNode(['scripts/check-monitoring.mjs', 'ready'], {
    PROMETHEUS_URL: options.prometheusUrl, ALERTMANAGER_URL: options.alertmanagerUrl, GRAFANA_URL: options.grafanaUrl,
  });
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).status, 'PASSED');
  const failed = await runNode(['scripts/check-monitoring.mjs', 'firing']);
  assert.equal(failed.code, 1);
  assert.equal(JSON.parse(failed.stdout).status, 'FAILED');
  const config = await runNode(['scripts/configure-monitoring.mjs', '/wrong-volume']);
  assert.equal(config.code, 1);
  assert.match(config.stderr, /private configuration volume/);
});
