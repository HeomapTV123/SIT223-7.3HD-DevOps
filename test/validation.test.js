import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateTask, validateFilters, validateId } from '../src/validation.js';

describe('Task input validation', () => {
  test('new tasks trim titles and receive sensible defaults', () => {
    assert.deepEqual(validateTask({ title: '  Record demo  ' }), {
      title: 'Record demo', description: '', status: 'open', priority: 'medium', dueDate: null,
    });
  });

  test('partial updates keep only explicitly provided fields', () => {
    assert.deepEqual(validateTask({ status: 'done' }, true), { status: 'done' });
    assert.deepEqual(validateTask({ dueDate: '' }, true), { dueDate: null });
  });

  test('accepts real leap days and valid task fields', () => {
    const result = validateTask({ title: ' Test ', description: ' Notes ', priority: 'high', status: 'in_progress', dueDate: '2028-02-29' });
    assert.equal(result.dueDate, '2028-02-29');
    assert.equal(result.description, 'Notes');
  });

  for (const [description, input] of [
    ['a missing title', {}], ['a blank title', { title: '  ' }],
    ['an oversized title', { title: 'x'.repeat(121) }], ['a numeric title', { title: 123 }],
    ['non-text notes', { title: 'Test', description: 42 }],
    ['oversized notes', { title: 'Test', description: 'x'.repeat(1001) }],
    ['an invalid status', { title: 'Test', status: 'finished' }],
    ['an invalid priority', { title: 'Test', priority: 'urgent' }],
    ['a wrong date format', { title: 'Test', dueDate: '31/12/2026' }],
    ['a non-date value', { title: 'Test', dueDate: 42 }],
    ['an impossible day', { title: 'Test', dueDate: '2026-02-30' }],
    ['an impossible month', { title: 'Test', dueDate: '2026-13-01' }],
    ['unknown fields', { title: 'Test', admin: true }],
    ['an array body', []], ['a null body', null], ['a primitive body', 'Test'],
  ]) {
    test(`rejects ${description}`, () => {
      assert.throws(() => validateTask(input), { status: 400 });
    });
  }

  test('rejects empty updates and overlong or invalid filters', () => {
    assert.throws(() => validateTask({}, true), { status: 400 });
    assert.throws(() => validateFilters(new URLSearchParams({ q: 'a'.repeat(101) })), { status: 400 });
    assert.throws(() => validateFilters(new URLSearchParams({ status: 'bad' })), { status: 400 });
  });

  test('validates positive integer IDs and rejects unsafe numbers', () => {
    assert.equal(validateId('42'), 42);
    for (const value of ['0', '-1', '1.5', 'abc', '01', '9007199254740992']) {
      assert.throws(() => validateId(value), { status: 400 });
    }
  });
});
