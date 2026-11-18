import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000;

const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const errorBox = document.querySelector('[data-role="error"]');
const updated = document.querySelector('[data-role="updated"]');
const panel = document.querySelector('[data-testid="incident-panel"]');
const panelAck = document.querySelector('[data-testid="panel-ack"]');
const panelAcked = document.querySelector('[data-role="panel-acked"]');
const field = (name) => panel.querySelector(`[data-role="panel-${name}"]`);

/** Incident ids this viewer acked, so a refresh never drops the mark. */
const acked = new Set();
/** Latest data per incident id. */
const incidents = new Map();
/** Rows on screen, by incident id. Rows are kept, not rebuilt, so a refresh never swaps a row under the pointer. */
const rows = new Map();
/** The incident the panel shows. Ack only ever acks this one: the panel names it, and it does not move. */
let selectedId = null;
let acking = false;

// R5: the viewer's own zone and locale. Locale order decides dd/mm vs mm/dd (en-GB, de-DE, fr-FR… put the day first).
const timeFormat = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const localTime = (iso) => timeFormat.format(new Date(iso));

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function markAcked(row) {
  row.classList.add('is-acked');
  if (!row.querySelector('[data-testid="acked"]')) row.append(el('span', { 'data-testid': 'acked', class: 'acked' }, '✓ acked'));
}

// R2 (product, after step 1): the row has no Ack. Picking a row opens its incident panel.
function buildRow(i) {
  const row = el('li', { 'data-testid': 'incident-row', 'data-id': i.id, class: `row ${i.severity}`, tabindex: '0', role: 'button', 'aria-label': `Open ${i.id}` });
  row.append(
    el('span', { class: 'id' }, i.id),
    el('span', { class: 'sev' }, i.severity),
    el('span', { class: 'what' }, `${i.service} · ${i.region} · ${i.summary}`),
    el('time', { datetime: i.openedAt, title: i.openedAt }, localTime(i.openedAt)),
  );
  if (acked.has(i.id)) markAcked(row);
  row.addEventListener('click', () => openPanel(i.id));
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPanel(i.id);
    }
  });
  return row;
}

function openPanel(id) {
  selectedId = id;
  for (const [rid, row] of rows) row.classList.toggle('is-selected', rid === id);
  renderPanel();
  panel.hidden = false;
}

function closePanel() {
  selectedId = null;
  for (const row of rows.values()) row.classList.remove('is-selected');
  panel.hidden = true;
}

function renderPanel() {
  const i = incidents.get(selectedId);
  if (!i) return;
  field('id').textContent = i.id;
  field('sev').textContent = i.severity;
  field('sev').className = `panel-sev ${i.severity}`;
  field('service').textContent = i.service;
  field('region').textContent = i.region;
  field('summary').textContent = i.summary;
  const time = field('time');
  time.setAttribute('datetime', i.openedAt);
  time.title = i.openedAt;
  time.textContent = localTime(i.openedAt);
  const isAcked = acked.has(i.id);
  panelAck.hidden = isAcked;
  panelAcked.hidden = !isAcked;
  panelAck.disabled = acking;
  panelAck.textContent = acking ? 'Acking…' : `Ack ${i.id}`;
}

panelAck.addEventListener('click', async () => {
  const id = selectedId; // the incident the panel names
  if (!id || acking || acked.has(id)) return;
  acking = true;
  renderPanel();
  try {
    await ack(id);
    acked.add(id);
    const row = rows.get(id);
    if (row) markAcked(row);
    showError('');
  } catch (err) {
    showError(`Ack failed for ${id}: ${err.message}`);
  } finally {
    acking = false;
    if (selectedId === id) renderPanel();
  }
});
field('close').addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !panel.hidden) closePanel();
});

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

// R1: newest first; new rows go in at the top, existing rows stay the same DOM nodes.
function render(page) {
  // Rows are never taken off: an answer without an incident does not mean it is over tonight.
  for (const i of page) incidents.set(i.id, i);
  const sorted = [...incidents.values()].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  sorted.forEach((i, index) => {
    let row = rows.get(i.id);
    if (!row) {
      row = buildRow(i);
      row.classList.toggle('is-selected', i.id === selectedId);
      rows.set(i.id, row);
    } else {
      const time = row.querySelector('time');
      if (time.getAttribute('datetime') !== i.openedAt) {
        time.setAttribute('datetime', i.openedAt);
        time.title = i.openedAt;
        time.textContent = localTime(i.openedAt);
      }
    }
    if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null);
  });
  list.hidden = sorted.length === 0;
  empty.hidden = sorted.length !== 0;
  if (selectedId) renderPanel();
}

async function refresh() {
  try {
    const page = await fetchIncidents();
    render(page.incidents);
    updated.textContent = `· updated ${localTime(page.updatedAt)}`;
    loader.remove(); // R3: gone once incidents load
    if (!errorBox.textContent.startsWith('Ack failed')) showError('');
  } catch (err) {
    showError(`Could not load incidents: ${err.message}`);
  }
}

// R4: refresh every 2 s while open; one request at a time.
async function loop() {
  await refresh();
  setTimeout(loop, REFRESH_MS);
}
loop();
