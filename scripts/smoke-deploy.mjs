import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Run against a deployed service. Only the temporary task created here is deleted.
export async function smokeDeploy({ baseUrl, expectedVersion, expectedEnvironment = 'staging' } = {}) {
  const report = { status: 'FAILED', baseUrl, expectedVersion, expectedEnvironment,
    startedAt: new Date().toISOString(), checks: [] };
  let taskId;

  async function request(path, status = 200, options = {}) {
    const response = await fetch(new URL(path, baseUrl), {
      ...options, signal: AbortSignal.timeout(5000),
    });
    const body = await response.text();
    if (response.status !== status) throw new Error(`${options.method ?? 'GET'} ${path}: expected HTTP ${status}, received ${response.status}`);
    return body;
  }
  async function check(name, action) {
    try {
      await action();
      report.checks.push({ name, passed: true });
    } catch (error) {
      report.checks.push({ name, passed: false, error: error.message });
      throw error;
    }
  }
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

  try {
    requireValue(Boolean(baseUrl && expectedVersion && expectedEnvironment), 'URL, expected version and expected environment are required.');
    await check('health and release identity', async () => {
      const health = JSON.parse(await request('/health'));
      const info = JSON.parse(await request('/api/info'));
      requireValue(health.status === 'ok', 'Application is not healthy.');
      for (const identity of [health, info]) {
        requireValue(identity.version === expectedVersion, 'The deployed version does not match this build.');
        requireValue(identity.environment === expectedEnvironment, 'The deployment environment does not match.');
      }
      requireValue(info.name === 'Taskboard', 'Unexpected application identity.');
    });
    await check('browser assets', async () => {
      requireValue((await request('/')).includes('<title>Taskboard</title>'), 'Taskboard page was not served.');
      for (const path of ['/styles.css', '/app.js']) {
        requireValue((await request(path)).length > 0, `${path} is empty.`);
      }
    });
    const title = `CI smoke ${randomUUID()}`;
    await check('create task', async () => {
      const task = JSON.parse(await request('/api/tasks', 201, json('POST', { title, priority: 'low' })));
      requireValue(Number.isSafeInteger(task.id) && task.id > 0, 'Create did not return a valid task ID.');
      taskId = task.id;
      requireValue(task.title === title && task.status === 'open', 'Created task values do not match.');
    });
    await check('read and filter task', async () => {
      const task = JSON.parse(await request(`/api/tasks/${taskId}`));
      requireValue(task.title === title, 'Stored task does not match.');
      const list = JSON.parse(await request(`/api/tasks?q=${encodeURIComponent(title)}`));
      requireValue(list.tasks.some((item) => item.id === taskId), 'Created task is missing from the filtered list.');
    });
    await check('update task', async () => {
      const task = JSON.parse(await request(`/api/tasks/${taskId}`, 200, json('PATCH', { status: 'done' })));
      requireValue(task.status === 'done', 'Task update was not applied.');
    });
    await check('metrics endpoint', async () => {
      requireValue((await request('/metrics')).includes('taskboard_http_requests_total'), 'Application metrics are missing.');
    });
  } catch (error) {
    report.error = error.message;
  } finally {
    if (taskId !== undefined) {
      try {
        await check('delete temporary task', async () => {
          await request(`/api/tasks/${taskId}`, 204, { method: 'DELETE' });
          await request(`/api/tasks/${taskId}`, 404);
        });
      } catch (error) {
        report.error = [report.error, `Cleanup failed for task ${taskId}: ${error.message}`].filter(Boolean).join(' | ');
      }
    }
  }
  report.status = report.error ? 'FAILED' : 'PASSED';
  report.finishedAt = new Date().toISOString();
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await smokeDeploy({ baseUrl: process.argv[2], expectedVersion: process.argv[3], expectedEnvironment: process.argv[4] });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === 'PASSED' ? 0 : 1;
}
