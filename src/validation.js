export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const STATUSES = ['open', 'in_progress', 'done'];
export const PRIORITIES = ['low', 'medium', 'high'];
const FIELDS = ['title', 'description', 'status', 'priority', 'dueDate'];

function text(value, name, maxLength, required = false) {
  if (typeof value !== 'string') throw new AppError(400, `${name} must be text.`);
  const cleaned = value.trim();
  if ((required && !cleaned) || cleaned.length > maxLength) {
    throw new AppError(400, `${name} must contain ${required ? '1' : '0'} to ${maxLength} characters.`);
  }
  return cleaned;
}

function choice(value, options, name) {
  if (!options.includes(value)) throw new AppError(400, `Invalid ${name}.`);
  return value;
}

function dueDate(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(400, 'Due date must use YYYY-MM-DD.');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new AppError(400, 'Due date must be a real calendar date.');
  }
  return value;
}

export function validateTask(input, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'Provide a JSON object.');
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !FIELDS.includes(key))) throw new AppError(400, 'Unknown task field.');
  if (partial && keys.length === 0) throw new AppError(400, 'Provide at least one field to update.');
  const result = partial ? {} : { description: '', status: 'open', priority: 'medium', dueDate: null };
  if (!partial || Object.hasOwn(input, 'title')) result.title = text(input.title, 'Title', 120, true);
  if (Object.hasOwn(input, 'description')) result.description = text(input.description, 'Description', 1000);
  if (Object.hasOwn(input, 'status')) result.status = choice(input.status, STATUSES, 'status');
  if (Object.hasOwn(input, 'priority')) result.priority = choice(input.priority, PRIORITIES, 'priority');
  if (Object.hasOwn(input, 'dueDate')) result.dueDate = dueDate(input.dueDate);
  return result;
}

export function validateFilters(params) {
  const result = {};
  if (params.has('status')) result.status = choice(params.get('status'), STATUSES, 'status filter');
  if (params.has('priority')) result.priority = choice(params.get('priority'), PRIORITIES, 'priority filter');
  if (params.has('q')) result.q = text(params.get('q'), 'Search', 100);
  return result;
}

export function validateId(value) {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new AppError(400, 'Task ID must be a positive integer.');
  }
  return Number(value);
}
