const $ = (id) => document.getElementById(id);
const labels = { open: 'Open', in_progress: 'In progress', done: 'Done' };
let refreshNumber = 0;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed.');
  return data;
}

function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = false;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function resetForm() {
  $('task-form').reset();
  $('task-id').value = '';
  $('form-heading').textContent = 'Add a task';
  $('save-button').textContent = 'Add task';
  $('cancel-edit').hidden = true;
}

function edit(task) {
  $('task-id').value = task.id;
  for (const field of ['title', 'description', 'status', 'priority', 'dueDate']) {
    $(field).value = task[field] ?? '';
  }
  $('form-heading').textContent = 'Edit task';
  $('save-button').textContent = 'Save changes';
  $('cancel-edit').hidden = false;
  $('title').focus();
  $('task-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderTask(task) {
  const card = element('article', `task-card${task.status === 'done' ? ' completed' : ''}`);
  card.dataset.taskId = task.id;
  const top = element('div', 'task-top');
  const title = element('h3', '', task.title);
  top.append(title, element('span', `priority ${task.priority}`, `${task.priority[0].toUpperCase()}${task.priority.slice(1)} priority`));
  card.append(top);
  if (task.description) card.append(element('p', 'task-notes', task.description));
  const bottom = element('div', 'task-bottom');
  const meta = element('div', 'task-meta');
  const status = element('select', 'task-status');
  status.setAttribute('aria-label', `Status for ${task.title}`);
  for (const [value, label] of Object.entries(labels)) {
    const option = element('option', '', label);
    option.value = value;
    status.append(option);
  }
  status.value = task.status;
  status.addEventListener('change', async () => {
    status.disabled = true;
    try {
      await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: status.value }) });
      notice('Task status updated.');
      await refresh();
    } catch (error) { status.value = task.status; notice(error.message, true); }
    finally { status.disabled = false; }
  });
  meta.append(status, element('span', '', task.dueDate ? `Due ${task.dueDate}` : 'No due date'));
  const actions = element('div', 'task-actions');
  const editButton = element('button', '', 'Edit');
  editButton.type = 'button';
  editButton.addEventListener('click', () => edit(task));
  const deleteButton = element('button', 'delete', 'Delete');
  deleteButton.type = 'button';
  deleteButton.addEventListener('click', async () => {
    if (!confirm(`Delete "${task.title}"?`)) return;
    deleteButton.disabled = true;
    try {
      await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
      if ($('task-id').value === String(task.id)) resetForm();
      notice('Task deleted.');
      await refresh();
    } catch (error) { notice(error.message, true); }
    finally { deleteButton.disabled = false; }
  });
  actions.append(editButton, deleteButton);
  bottom.append(meta, actions);
  card.append(bottom);
  return card;
}

async function refresh() {
  const thisRefresh = ++refreshNumber;
  const params = new URLSearchParams();
  for (const [key, id] of [['q', 'search'], ['status', 'filter-status'], ['priority', 'filter-priority']]) {
    if ($(id).value) params.set(key, $(id).value);
  }
  const [{ tasks }, stats, info] = await Promise.all([
    api(`/api/tasks?${params}`), api('/api/stats'), api('/api/info'),
  ]);
  if (thisRefresh !== refreshNumber) return;
  $('task-list').replaceChildren(...tasks.map(renderTask));
  $('empty').hidden = tasks.length !== 0;
  $('empty-heading').textContent = params.size ? 'No matching tasks' : 'A fresh start';
  $('empty-description').textContent = params.size ? 'Try a different search or clear the filters.' : 'Add your first task using the form.';
  $('task-count').textContent = tasks.length;
  $('stat-open').textContent = stats.open;
  $('stat-progress').textContent = stats.inProgress;
  $('stat-done').textContent = stats.done;
  $('stat-overdue').textContent = stats.overdue;
  $('footer-count').textContent = `${stats.total} task${stats.total === 1 ? '' : 's'} in total`;
  $('environment').textContent = info.environment;
  $('version').textContent = info.version;
}

$('task-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = $('task-id').value;
  const task = Object.fromEntries(new FormData(event.target));
  task.dueDate = task.dueDate || null;
  $('save-button').disabled = true;
  try {
    await api(id ? `/api/tasks/${id}` : '/api/tasks', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(task) });
    resetForm();
    notice(id ? 'Changes saved.' : 'Task added.');
    await refresh();
  } catch (error) { notice(error.message, true); }
  finally { $('save-button').disabled = false; }
});

const refreshWithErrors = () => refresh().catch((error) => notice(error.message, true));
$('cancel-edit').addEventListener('click', resetForm);
$('refresh').addEventListener('click', refreshWithErrors);
$('search-form').addEventListener('submit', (event) => { event.preventDefault(); refreshWithErrors(); });
$('filter-status').addEventListener('change', refreshWithErrors);
$('filter-priority').addEventListener('change', refreshWithErrors);
$('search').addEventListener('search', refreshWithErrors);
$('today').textContent = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
refreshWithErrors();
