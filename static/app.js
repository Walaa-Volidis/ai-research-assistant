const form = document.getElementById('form');
const submit = document.getElementById('submit');
const statusEl = document.getElementById('status');
const statusLine = document.getElementById('status-line');
const timerEl = document.getElementById('timer');
const errorEl = document.getElementById('error');
const errorBody = document.getElementById('error-body');
const results = document.getElementById('results');

let timer = null;
let lastReport = null;

// Model output is untrusted text, so everything goes through here before touching innerHTML.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const PHASES = [
  [0, 'Searching academic sources…'],
  [12, 'Reading results…'],
  [35, 'Cross-checking citations…'],
  [60, 'Structuring the report…'],
];

function startTimer() {
  const t0 = Date.now();
  timer = setInterval(() => {
    const secs = Math.floor((Date.now() - t0) / 1000);
    timerEl.textContent = `${secs}s`;
    for (let i = PHASES.length - 1; i >= 0; i--) {
      if (secs >= PHASES[i][0]) { statusLine.textContent = PHASES[i][1]; break; }
    }
  }, 250);
}

function stopTimer() {
  clearInterval(timer);
  timer = null;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const payload = {
    topic: document.getElementById('topic').value.trim(),
    questions: document.getElementById('questions').value.trim(),
    time_frame: document.getElementById('time_frame').value.trim(),
  };
  if (!payload.topic) return;

  submit.disabled = true;
  errorEl.hidden = true;
  results.hidden = true;
  results.innerHTML = '';
  statusEl.hidden = false;
  timerEl.textContent = '0s';
  startTimer();

  try {
    const res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    lastReport = data;
    render(data);
  } catch (err) {
    errorBody.textContent = err.message;
    errorEl.hidden = false;
  } finally {
    stopTimer();
    statusEl.hidden = true;
    submit.disabled = false;
  }
});

function section(title, count, inner) {
  return `
    <section class="section">
      <div class="section-head">
        <h3>${esc(title)}</h3>
        <span class="count">${count}</span>
      </div>
      ${inner || '<p class="empty">Nothing returned for this section.</p>'}
    </section>`;
}

function paperCard(p) {
  const meta = [];
  if (p.authors && p.authors.length) meta.push(esc(p.authors.join(', ')));
  if (p.year) meta.push(esc(p.year));
  if (p.venue) meta.push(esc(p.venue));

  const title = p.url
    ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a>`
    : esc(p.title);

  return `
    <article class="card">
      <h4>${title}</h4>
      ${meta.length ? `<p class="meta">${meta.map((m) => `<span>${m}</span>`).join('')}</p>` : ''}
      ${p.relevance ? `<p class="body">${esc(p.relevance)}</p>` : ''}
    </article>`;
}

function formulaCard(f, i) {
  return `
    <article class="card">
      <h4>${esc(f.name)}</h4>
      <div class="formula" data-latex="${esc(f.latex)}" id="tex-${i}">
        <code>${esc(f.latex)}</code>
      </div>
      ${f.description ? `<p class="body">${esc(f.description)}</p>` : ''}
      ${f.reference ? `<p class="meta"><span>${esc(f.reference)}</span></p>` : ''}
    </article>`;
}

function trendCard(t) {
  const refs = (t.references || [])
    .map((r) => `<span class="ref" title="${esc(r)}">${esc(r)}</span>`)
    .join('');
  return `
    <article class="card">
      <h4>${esc(t.title)}</h4>
      ${t.description ? `<p class="body">${esc(t.description)}</p>` : ''}
      ${refs ? `<div class="refs">${refs}</div>` : ''}
    </article>`;
}

function render(r) {
  const chips = [];
  if (r.time_frame) chips.push(r.time_frame);
  chips.push(`${(r.papers || []).length} papers`);

  const questions = (r.research_questions || [])
    .map((q) => `<li>${esc(q)}</li>`)
    .join('');

  results.innerHTML = `
    <div class="report-head">
      <h2>${esc(r.topic)}</h2>
      <div class="chips">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
      ${questions ? `<ol class="questions">${questions}</ol>` : ''}
    </div>
    ${section('Papers', (r.papers || []).length, (r.papers || []).map(paperCard).join(''))}
    ${section('Formulas', (r.formulas || []).length, (r.formulas || []).map(formulaCard).join(''))}
    ${section('Trends', (r.trends || []).length, (r.trends || []).map(trendCard).join(''))}
    <div class="actions"><button id="download" type="button">Download JSON</button></div>
  `;
  results.hidden = false;

  typeset();
  document.getElementById('download').addEventListener('click', download);
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// KaTeX comes from a CDN; if it failed to load, the raw LaTeX already in the
// element stays visible rather than the formula section rendering empty.
function typeset() {
  if (typeof katex === 'undefined') return;
  document.querySelectorAll('.formula').forEach((el) => {
    try {
      katex.render(el.dataset.latex, el, { displayMode: true, throwOnError: true });
    } catch {
      /* leave the <code> fallback in place */
    }
  });
}

function download() {
  const blob = new Blob([JSON.stringify(lastReport, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'report.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
