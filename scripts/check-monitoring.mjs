import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const productionJob = 'taskboard-production';
const requiredRules = ['TaskboardDown', 'TaskboardHighErrorRate', 'TaskboardHighMemory'];
const productionAlert = (alert) => alert.labels?.alertname === 'TaskboardDown'
  && alert.labels?.environment === 'production';
const metricLabels = { integration: 'email', receiver_name: 'availability-email' };

const isSpace = (character) => character === ' ' || character === '\t' || character === '\r';

function skipSpaces(line, offset) {
  while (isSpace(line[offset])) offset++;
  return offset;
}

function readLabelValue(line, offset) {
  if (line[offset] !== '"') throw new Error('Invalid metric label: expected a quoted value.');
  const characters = [];
  for (let index = offset + 1; index < line.length; index++) {
    const character = line[index];
    if (character === '"') return { value: characters.join(''), next: index + 1 };
    if (character !== '\\') {
      characters.push(character);
      continue;
    }
    // Prometheus label values support exactly these three escape sequences.
    const escaped = line[++index];
    if (escaped === 'n') characters.push('\n');
    else if (escaped === '\\' || escaped === '"') characters.push(escaped);
    else throw new Error('Invalid metric label escape.');
  }
  throw new Error('Unterminated metric label value.');
}

function readMetricLabels(line, offset) {
  const labels = new Map();
  let index = offset + 1;
  while (index < line.length) {
    index = skipSpaces(line, index);
    if (line[index] === '}') return { labels, next: index + 1 };
    const equals = line.indexOf('=', index);
    if (equals < 0) throw new Error('Invalid metric label assignment.');
    const name = line.slice(index, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || labels.has(name)) {
      throw new Error('Invalid or duplicate metric label name.');
    }
    const parsed = readLabelValue(line, skipSpaces(line, equals + 1));
    labels.set(name, parsed.value);
    index = skipSpaces(line, parsed.next);
    if (line[index] === '}') return { labels, next: index + 1 };
    if (line[index] !== ',') throw new Error('Invalid metric label separator.');
    index++;
  }
  throw new Error('Unterminated metric labels.');
}

function readMetricValue(line, offset, name) {
  if (!isSpace(line[offset])) throw new Error(`Invalid ${name} metric separator.`);
  const start = skipSpaces(line, offset);
  let end = start;
  while (end < line.length && !isSpace(line[end])) end++;
  const token = line.slice(start, end);
  const value = Number(token);
  // Non-finite, negative and malformed values cannot establish delivery evidence.
  if (!/^[\d.eE+-]+$/.test(token) || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${name} metric.`);
  }
  return value;
}

export function metricSum(text, name, wanted = {}) {
  let total = 0;
  const selectors = Object.entries(wanted);
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimStart();
    if (!line.startsWith(name)) continue;
    const boundary = line[name.length];
    if (boundary !== undefined && boundary !== '{' && !isSpace(boundary)) continue;
    // Each cursor advances only forward; malformed labels never trigger repeated regex searches.
    const { labels, next } = boundary === '{' ? readMetricLabels(line, name.length)
      : { labels: new Map(), next: name.length };
    if (!selectors.every(([key, value]) => labels.get(key) === value)) continue;
    total += readMetricValue(line, next, name);
  }
  if (!Number.isFinite(total)) throw new Error(`Invalid ${name} metric total.`);
  return total;
}

function queryValue(response) {
  const result = response?.data?.result;
  if (response?.status !== 'success' || result?.length !== 1) return null;
  const number = Number(result[0].value?.[1]);
  return Number.isFinite(number) ? number : null;
}

export async function monitoringSnapshot({
  prometheusUrl = 'https://prometheus:9090', alertmanagerUrl = 'https://alertmanager:9093',
  grafanaUrl = 'https://grafana:3000', fetchImpl = fetch, requestTimeoutMs = 5000,
} = {}) {
  const get = async (base, path, json = true) => {
    const endpoint = new URL(path, base);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
      throw new Error('Monitoring endpoints must use HTTPS without URL credentials.');
    }
    const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(requestTimeoutMs), redirect: 'error' });
    if (!response.ok) throw new Error(`Monitoring endpoint ${path} returned HTTP ${response.status}.`);
    return json ? response.json() : response.text();
  };
  const query = '/api/v1/query?query=up%7Bjob%3D%22taskboard-production%22%7D';
  const [targets, rules, promAlerts, managers, up, amAlerts, metrics, health, dashboard, grafanaQuery] = await Promise.all([
    get(prometheusUrl, '/api/v1/targets'), get(prometheusUrl, '/api/v1/rules?type=alert'),
    get(prometheusUrl, '/api/v1/alerts'), get(prometheusUrl, '/api/v1/alertmanagers'), get(prometheusUrl, query),
    get(alertmanagerUrl, '/api/v2/alerts'), get(alertmanagerUrl, '/metrics', false),
    get(grafanaUrl, '/api/health'), get(grafanaUrl, '/api/dashboards/uid/taskboard-production'),
    get(grafanaUrl, `/api/datasources/proxy/uid/taskboard-prometheus${query}`),
  ]);
  if ([targets, rules, promAlerts, managers].some((result) => result.status !== 'success') || !Array.isArray(amAlerts)) {
    throw new Error('A monitoring API returned an unsuccessful or malformed response.');
  }
  const selected = targets.data.activeTargets.filter((target) => target.labels.job === productionJob);
  const requests = metricSum(metrics, 'alertmanager_notification_requests_total', metricLabels);
  const failed = metricSum(metrics, 'alertmanager_notification_requests_failed_total', metricLabels);
  const startedAt = metricSum(metrics, 'process_start_time_seconds');
  if (!startedAt || failed > requests) throw new Error('Alertmanager delivery metrics are invalid.');
  return {
    checkedAt: new Date().toISOString(),
    targets: selected.map(({ health: targetHealth, lastScrape, lastError }) => ({ health: targetHealth, lastScrape, lastError })),
    up: queryValue(up),
    rules: rules.data.groups.flatMap((group) => group.rules).filter((rule) => requiredRules.includes(rule.name))
      .map(({ name, health: ruleHealth, lastError }) => ({ name, health: ruleHealth, lastError })),
    prometheusAlerts: promAlerts.data.alerts.filter(productionAlert),
    alertmanagerConnected: managers.data.activeAlertmanagers.some((manager) => manager.url === 'https://alertmanager:9093/api/v2/alerts'),
    alertmanagerAlerts: amAlerts.filter(productionAlert),
    email: { receiver: 'availability-email', requests, failed, succeeded: requests - failed, startedAt },
    grafana: { database: health.database, dashboardUid: dashboard.dashboard?.uid, up: queryValue(grafanaQuery) },
  };
}

export function phaseSatisfied(phase, snapshot, baseline) {
  const { targets, rules, grafana, email, prometheusAlerts, alertmanagerAlerts } = snapshot;
  const ready = snapshot.alertmanagerConnected && grafana.database === 'ok'
    && grafana.dashboardUid === productionJob && targets.length === 1
    && requiredRules.every((name) => rules.some((rule) => rule.name === name && rule.health === 'ok'))
    && Date.now() - Date.parse(targets[0].lastScrape) < 30000;
  if (!ready) return false;
  const healthy = snapshot.up === 1 && grafana.up === 1 && targets[0].health === 'up';
  if (phase === 'ready') return healthy && prometheusAlerts.length === 0 && alertmanagerAlerts.length === 0;
  if (email.startedAt !== baseline.email.startedAt) throw new Error('Alertmanager restarted during the email demonstration; rerun with a fresh baseline.');
  const delivered = email.succeeded > baseline.email.succeeded;
  if (phase === 'firing') {
    return snapshot.up === 0 && delivered && prometheusAlerts.some((alert) => alert.state === 'firing')
      && alertmanagerAlerts.some((alert) => alert.status?.state === 'active'
        && alert.status.silencedBy.length === 0 && alert.status.inhibitedBy.length === 0);
  }
  return healthy && delivered && prometheusAlerts.length === 0 && alertmanagerAlerts.length === 0;
}

export async function waitForMonitoring(phase, { baseline, timeoutMs = 180000, intervalMs = 2000, ...options } = {}) {
  if (!['ready', 'firing', 'resolved'].includes(phase)) throw new Error('Expected ready, firing or resolved monitoring phase.');
  if (phase !== 'ready' && (!baseline?.email || !Number.isFinite(baseline.email.succeeded)
    || !Number.isFinite(baseline.email.startedAt) || baseline.email.startedAt <= 0)) {
    throw new Error('A valid delivery baseline is required for the email demonstration.');
  }
  const deadline = Date.now() + timeoutMs;
  let lastError = 'Monitoring condition has not been reached.';
  let lastSnapshot;
  let consecutive = 0;
  do {
    try {
      lastSnapshot = await monitoringSnapshot(options);
    } catch (error) {
      lastError = error.message;
      consecutive = 0;
      await delay(intervalMs);
      continue;
    }
    // Two observations avoid treating an in-flight failed SMTP attempt as a completed success.
    consecutive = phaseSatisfied(phase, lastSnapshot, baseline) ? consecutive + 1 : 0;
    if (consecutive >= 2) return { status: 'PASSED', phase, ...lastSnapshot,
      emailEvidence: phase === 'ready' ? 'NOT_TESTED: no outage email was requested.'
        : 'SMTP server accepted a notification for the availability receiver. Verify receipt in the mailbox.' };
    lastError = `Waiting for ${phase} and its required checks${phase === 'ready' ? '' : ' and accepted email'}.`;
    await delay(intervalMs);
  } while (Date.now() < deadline);
  const error = new Error(`Monitoring ${phase} timed out: ${lastError}`);
  error.snapshot = lastSnapshot;
  throw error;
}

export function monitoringCommand(args, readReport = readFileSync) {
  if (args.length !== 1 || !['ready', 'firing', 'resolved'].includes(args[0])) {
    throw new Error('Usage: check-monitoring.mjs ready|firing|resolved (one phase argument only).');
  }
  const phase = args[0];
  let baseline;
  // These literal paths are supplied by Jenkins's read-only report mount, never by CLI input.
  if (phase === 'firing') baseline = JSON.parse(readReport('/reports/monitoring-ready.json', 'utf8'));
  if (phase === 'resolved') baseline = JSON.parse(readReport('/reports/alert-firing.json', 'utf8'));
  return { phase, baseline };
}

// Preserve JSON data while preventing API/error text from creating log lines or terminal commands.
export function reportJson(value) {
  return JSON.stringify(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g,
    (character) => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS certificate verification must remain enabled.');
    const { phase, baseline } = monitoringCommand(process.argv.slice(2));
    const result = await waitForMonitoring(phase, { baseline,
      prometheusUrl: process.env.PROMETHEUS_URL, alertmanagerUrl: process.env.ALERTMANAGER_URL,
      grafanaUrl: process.env.GRAFANA_URL });
    console.log(reportJson(result));
  } catch (error) {
    console.log(reportJson({ status: 'FAILED', reason: error.message, snapshot: error.snapshot }));
    process.exitCode = 1;
  }
}
