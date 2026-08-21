import { api } from './api.js';

const scriptReviewEl = document.getElementById('script-review-prompt');
const saveScriptReviewButton = document.getElementById('save-script-review');
const scriptReviewMessageEl = document.getElementById('script-review-message');

const personasListEl = document.getElementById('personas-list');
const savePersonasButton = document.getElementById('save-personas');
const personasMessageEl = document.getElementById('personas-message');

let personas = {};

function setMessage(el, text, isError) {
  el.textContent = text;
  el.classList.toggle('error', Boolean(isError));
}

async function loadScriptReview() {
  const data = await api('/api/script-review');
  scriptReviewEl.value = data.systemPrompt ?? '';
}

saveScriptReviewButton.addEventListener('click', async () => {
  setMessage(scriptReviewMessageEl, 'Saving...');
  try {
    await api('/api/script-review', { method: 'PUT', body: { systemPrompt: scriptReviewEl.value } });
    setMessage(scriptReviewMessageEl, 'Saved. Applies to the next script generated, no restart needed.');
  } catch (err) {
    setMessage(scriptReviewMessageEl, err.message, true);
  }
});

function renderPersonas() {
  personasListEl.innerHTML = '';
  for (const [id, persona] of Object.entries(personas).sort(([a], [b]) => a.localeCompare(b))) {
    const row = document.createElement('div');
    row.className = 'persona-row';
    row.innerHTML = `
      <div class="persona-row-header">
        <strong>${id}</strong>
        <span class="voice-file">${persona.voiceFile ?? ''}</span>
      </div>
      <textarea rows="2" data-persona-id="${id}">${persona.systemPrompt ?? ''}</textarea>
    `;
    personasListEl.appendChild(row);
  }
}

async function loadPersonas() {
  const data = await api('/api/personas');
  personas = data.personas ?? {};
  renderPersonas();
}

savePersonasButton.addEventListener('click', async () => {
  setMessage(personasMessageEl, 'Saving...');
  const updated = {};
  for (const [id, persona] of Object.entries(personas)) {
    const textarea = personasListEl.querySelector(`textarea[data-persona-id="${CSS.escape(id)}"]`);
    updated[id] = { ...persona, systemPrompt: textarea ? textarea.value : persona.systemPrompt };
  }
  try {
    await api('/api/personas', { method: 'PUT', body: { personas: updated } });
    personas = updated;
    setMessage(personasMessageEl, 'Saved. Applies to the next script generated, no restart needed.');
  } catch (err) {
    setMessage(personasMessageEl, err.message, true);
  }
});

export function startPromptsView() {
  loadScriptReview();
  loadPersonas();
}
