import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/store.js';

function memoryStore(t) {
  const store = createStore();
  t.after(() => store.close());
  return store;
}

describe('SQLite task storage', () => {
  test('empty database is healthy and reports zero counts', (t) => {
    const store = memoryStore(t);
    assert.equal(store.healthy(), true);
    assert.deepEqual(store.list(), []);
    assert.deepEqual(store.stats(), { total: 0, open: 0, inProgress: 0, done: 0, overdue: 0 });
  });

  test('create, retrieve, edit, complete and delete a task', (t) => {
    const store = memoryStore(t);
    const task = store.create({ title: 'Write tests', priority: 'high' });
    assert.equal(task.id, 1);
    assert.equal(store.get(task.id).title, 'Write tests');
    const updated = store.update(task.id, { title: 'Review tests', status: 'done' });
    assert.equal(updated.title, 'Review tests');
    assert.equal(updated.priority, 'high');
    assert.equal(updated.status, 'done');
    assert.equal(updated.createdAt, task.createdAt);
    store.remove(task.id);
    assert.throws(() => store.get(task.id), { status: 404 });
  });

  test('filters combine status, priority and case-insensitive text search', (t) => {
    const store = memoryStore(t);
    store.create({ title: 'Write report', description: 'Jenkins evidence', status: 'in_progress', priority: 'high' });
    store.create({ title: 'Record demo', status: 'done', priority: 'low' });
    store.create({ title: 'Review report', priority: 'high' });
    assert.equal(store.list(new URLSearchParams({ q: 'JENKINS', status: 'in_progress', priority: 'high' })).length, 1);
    assert.equal(store.list(new URLSearchParams({ q: 'report' })).length, 2);
    assert.equal(store.list(new URLSearchParams({ status: 'done' })).length, 1);
    assert.equal(store.list(new URLSearchParams({ priority: 'low' })).length, 1);
    assert.equal(store.list()[0].title, 'Review report');
  });

  test('overdue counts exclude completed tasks and tasks due today', (t) => {
    const store = memoryStore(t);
    store.create({ title: 'Overdue', dueDate: '2026-09-21' });
    store.create({ title: 'Today', dueDate: '2026-09-22', status: 'in_progress' });
    store.create({ title: 'Done', dueDate: '2026-09-20', status: 'done' });
    assert.deepEqual(store.stats('2026-09-22'), { total: 3, open: 1, inProgress: 1, done: 1, overdue: 1 });
  });

  test('task data persists when the SQLite database is reopened', (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'taskboard-test-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'tasks.db');
    const first = createStore(path);
    first.create({ title: 'Keep this task' });
    first.close();
    const second = createStore(path);
    try { assert.equal(second.get(1).title, 'Keep this task'); }
    finally { second.close(); }
  });

  test('SQL-looking input is stored as data and cannot remove the table', (t) => {
    const store = memoryStore(t);
    const title = "'); DROP TABLE tasks; --";
    assert.equal(store.create({ title }).title, title);
    assert.equal(store.list(new URLSearchParams({ q: title })).length, 1);
    assert.equal(store.healthy(), true);
    assert.equal(store.create({ title: 'Still working' }).id, 2);
  });

  test('invalid updates leave stored task data unchanged', (t) => {
    const store = memoryStore(t);
    store.create({ title: 'Keep title' });
    assert.throws(() => store.update(1, { title: '' }), { status: 400 });
    assert.equal(store.get(1).title, 'Keep title');
    assert.throws(() => store.update(999, { status: 'done' }), { status: 404 });
    assert.throws(() => store.remove(999), { status: 404 });
  });
});
