import { api } from './api.js';

const searchEl = document.getElementById('shows-search');
const newShowButton = document.getElementById('new-show-button');
const tableBodyEl = document.getElementById('shows-table-body');
const listViewEl = document.getElementById('shows-list-view');
const editorEl = document.getElementById('show-editor-view');
const editorTitleEl = document.getElementById('show-editor-title');
const formEl = document.getElementById('show-editor-form');
const messageEl = document.getElementById('show-editor-message');
const deleteButton = document.getElementById('delete-show-button');
const backButton = document.getElementById('back-to-shows-button');
const idField = document.getElementById('field-id');

let allShows = [];
let editingId = null; // null while creating a new show

function setMessage(text, isError) {
  messageEl.textContent = text;
  messageEl.classList.toggle('error', Boolean(isError));
}

function renderTable() {
  const query = searchEl.value.trim().toLowerCase();
  const filtered = allShows.filter(
    (s) => !query || s.title.toLowerCase().includes(query) || s.id.toLowerCase().includes(query)
  );
  tableBodyEl.innerHTML = '';
  for (const show of filtered) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${show.title}</td>
      <td class="mono">${show.id}</td>
      <td>${show.personas.join(', ')}</td>
      <td>${show.segments.join(', ')}</td>
      <td class="mono">${show.durationMinutes ? `${show.durationMinutes}m` : '—'}</td>
    `;
    tr.addEventListener('click', () => openEditor(show.id));
    tableBodyEl.appendChild(tr);
  }
}

async function loadShows() {
  const { shows } = await api('/api/shows');
  allShows = shows;
  renderTable();
}

function fillForm(fields) {
  formEl.elements['id'].value = fields.id ?? '';
  formEl.elements['title'].value = fields.title ?? '';
  document.getElementById('field-duration').value = fields.durationMinutes ?? '';
  formEl.elements['personas'].value = (fields.personas ?? []).join(', ');
  document.getElementById('field-segment-quiz').checked = (fields.segments ?? []).includes('quiz');
  document.getElementById('field-segment-weather').checked = (fields.segments ?? []).includes('weather');
  formEl.elements['repeatWindowDays'].value = fields.repeatWindowDays ?? '';
  document.getElementById('field-description').value = fields.description ?? '';
  document.getElementById('field-hosts').value = fields.hosts ?? '';
  document.getElementById('field-trackSelection').value = fields.trackSelectionText ?? '';
  document.getElementById('field-tone').value = fields.tone ?? '';
  document.getElementById('field-trackMoves').value = fields.trackMoves ?? '';
  document.getElementById('field-quiz').value = fields.quiz ?? '';
  document.getElementById('field-weather').value = fields.weather ?? '';
}

function showList() {
  editorEl.hidden = true;
  listViewEl.hidden = false;
}

function showEditor() {
  listViewEl.hidden = true;
  editorEl.hidden = false;
  window.scrollTo(0, 0);
}

async function openEditor(id) {
  editingId = id ?? null;
  setMessage('');
  showEditor();
  deleteButton.hidden = !id;
  idField.disabled = Boolean(id);
  if (id) {
    editorTitleEl.textContent = `Edit "${id}"`;
    const fields = await api(`/api/shows/${encodeURIComponent(id)}`);
    fillForm(fields);
  } else {
    editorTitleEl.textContent = 'New show';
    fillForm({});
  }
}

function readForm() {
  return {
    title: formEl.elements['title'].value.trim(),
    durationMinutes: document.getElementById('field-duration').value
      ? Number(document.getElementById('field-duration').value)
      : undefined,
    personas: formEl.elements['personas'].value.split(',').map((s) => s.trim()).filter(Boolean),
    segments: [
      document.getElementById('field-segment-quiz').checked && 'quiz',
      document.getElementById('field-segment-weather').checked && 'weather',
    ].filter(Boolean),
    repeatWindowDays: formEl.elements['repeatWindowDays'].value
      ? Number(formEl.elements['repeatWindowDays'].value)
      : undefined,
    description: document.getElementById('field-description').value,
    hosts: document.getElementById('field-hosts').value,
    trackSelectionText: document.getElementById('field-trackSelection').value,
    tone: document.getElementById('field-tone').value,
    trackMoves: document.getElementById('field-trackMoves').value,
    quiz: document.getElementById('field-quiz').value,
    weather: document.getElementById('field-weather').value,
  };
}

formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('Saving...');
  try {
    const fields = readForm();
    if (editingId) {
      await api(`/api/shows/${encodeURIComponent(editingId)}`, { method: 'PUT', body: fields });
    } else {
      const id = idField.value.trim();
      await api('/api/shows', { method: 'POST', body: { id, ...fields } });
    }
    setMessage('Saved.');
    await loadShows();
  } catch (err) {
    setMessage(err.message, true);
  }
});

deleteButton.addEventListener('click', async () => {
  if (!editingId) return;
  if (!confirm(`Delete show "${editingId}"? It will also be removed from the schedule. This cannot be undone.`)) return;
  try {
    await api(`/api/shows/${encodeURIComponent(editingId)}`, { method: 'DELETE' });
    showList();
    await loadShows();
  } catch (err) {
    setMessage(err.message, true);
  }
});

backButton.addEventListener('click', showList);

newShowButton.addEventListener('click', () => openEditor(null));
searchEl.addEventListener('input', renderTable);

export function startShowsView() {
  loadShows();
}
