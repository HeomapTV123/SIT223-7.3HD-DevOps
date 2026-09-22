import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppError, validateTask, validateFilters, validateId } from './validation.js';

function toTask(row) {
  return {
    id: row.id, title: row.title, description: row.description,
    status: row.status, priority: row.priority, dueDate: row.due_date,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function createStore(filename = ':memory:') {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename, { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('open', 'in_progress', 'done')),
      priority TEXT NOT NULL CHECK(priority IN ('low', 'medium', 'high')),
      due_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);

  function get(id) {
    const numericId = validateId(String(id));
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(numericId);
    if (!row) throw new AppError(404, 'Task not found.');
    return toTask(row);
  }

  function create(input) {
    const task = validateTask(input);
    const timestamp = new Date().toISOString();
    const result = db.prepare(`INSERT INTO tasks
      (title, description, status, priority, due_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(task.title, task.description, task.status, task.priority, task.dueDate, timestamp, timestamp);
    return get(Number(result.lastInsertRowid));
  }

  function update(id, input) {
    const updates = validateTask(input, true);
    const task = { ...get(id), ...updates };
    db.prepare(`UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?,
      due_date = ?, updated_at = ? WHERE id = ?`)
      .run(task.title, task.description, task.status, task.priority, task.dueDate,
        new Date().toISOString(), task.id);
    return get(task.id);
  }

  function remove(id) {
    const task = get(id);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  }

  function list(params = new URLSearchParams()) {
    const filters = validateFilters(params);
    // All SQL is fixed. User input is bound as data, never joined into SQL text.
    const rows = db.prepare(`SELECT * FROM tasks
      WHERE (? IS NULL OR status = ?)
        AND (? IS NULL OR priority = ?)
        AND (? IS NULL OR instr(lower(title || ' ' || description), lower(?)) > 0)
      ORDER BY id DESC`)
      .all(filters.status ?? null, filters.status ?? null,
        filters.priority ?? null, filters.priority ?? null,
        filters.q ?? null, filters.q ?? null);
    return rows.map(toTask);
  }

  function stats(today = new Date().toISOString().slice(0, 10)) {
    const row = db.prepare(`SELECT count(*) AS total,
      coalesce(sum(status = 'open'), 0) AS open,
      coalesce(sum(status = 'in_progress'), 0) AS inProgress,
      coalesce(sum(status = 'done'), 0) AS done,
      coalesce(sum(status != 'done' AND due_date < ?), 0) AS overdue
      FROM tasks`).get(today);
    return { ...row };
  }

  return { get, create, update, remove, list, stats,
    healthy: () => db.prepare('SELECT count(*) AS count FROM tasks').get().count >= 0,
    close: () => db.close() };
}
