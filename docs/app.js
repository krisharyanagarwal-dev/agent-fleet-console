/* Agent Fleet Console — GitHub-powered dashboard */
const CONSOLE_REPO = 'krisharyanagarwal-dev/agent-fleet-console';
const ENGINE_REPO  = 'krisharyanagarwal-dev/openalice-fleet';
const ENGINE_BRANCH = 'github-console-integration';

let agents = [];
let tasks = [];
let etag = null;
let selectedAgent = null;
let pollTimer = null;

const AGENT_STORAGE_KEY = 'fleet-agents';
const AGENT_STORAGE_TS  = 'fleet-agents-ts';
const AGENT_TTL_MS = 10 * 60 * 1000; // cache agent list 10 min

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function escapeHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}); }
  catch { return iso; }
}

// ---------------- Agents ----------------
async function loadAgents() {
  const cached = localStorage.getItem(AGENT_STORAGE_KEY);
  const ts = +localStorage.getItem(AGENT_STORAGE_TS) || 0;
  if (cached && Date.now() - ts < AGENT_TTL_MS) {
    agents = JSON.parse(cached);
    renderAgents();
    return;
  }
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${ENGINE_REPO}/${ENGINE_BRANCH}/agents/index.json`);
    if (!res.ok) throw new Error(`agent index ${res.status}`);
    const index = await res.json();
    agents = Object.entries(index).map(([slug, info]) => ({
      slug, ...info
    }));
    localStorage.setItem(AGENT_STORAGE_KEY, JSON.stringify(agents));
    localStorage.setItem(AGENT_STORAGE_TS, String(Date.now()));
    renderAgents();
  } catch (e) {
    console.error('load agents', e);
    document.getElementById('agentGrid').innerHTML = `<div class="empty" style="text-align:left">Unable to load agent index from ${ENGINE_REPO}@${ENGINE_BRANCH}</div>`;
  }
}

function renderAgents() {
  const q = document.getElementById('agentSearch').value.toLowerCase();
  const grid = document.getElementById('agentGrid');
  const filtered = agents.filter(a => a.name.toLowerCase().includes(q) || a.slug.toLowerCase().includes(q));
  grid.innerHTML = filtered.map(a => {
    const sel = selectedAgent === a.slug ? ' selected' : '';
    return `
      <div class="agent-card${sel}" onclick="selectAgent('${escapeHtml(a.slug)}')">
        <div class="agent-name">${escapeHtml(a.name)}</div>
        <div class="agent-model">${escapeHtml(a.model || '—')}</div>
        <div class="agent-desc">${escapeHtml(a.desc || 'OpenCode subagent')}</div>
      </div>
    `;
  }).join('');
}

window.selectAgent = function(slug) {
  selectedAgent = slug;
  renderAgents();
  const agent = agents.find(a => a.slug === slug);
  if (agent) document.getElementById('taskAgent').value = slug;
};

// ---------------- Tasks (GitHub Issues) ----------------
async function loadTasks() {
  try {
    const headers = {};
    if (etag) headers['If-None-Match'] = etag;
    const res = await fetch(`https://api.github.com/repos/${CONSOLE_REPO}/issues?state=all&per_page=100&sort=created&direction=desc`, { headers });
    if (res.status === 304) return;
    etag = res.headers.get('etag');
    const issues = await res.json();
    // filter only agent tasks (title starts with "agent/")
    tasks = issues.filter(i => /^agent\//.test(i.title || '')).map(i => ({
      number: i.number,
      title: i.title,
      agent: (i.title.match(/^agent\/([^:]+):/) || [])[1] || 'unknown',
      body: i.body || '',
      state: i.state,
      created_at: i.created_at,
      updated_at: i.updated_at,
      html_url: i.html_url,
      comments: i.comments || 0,
    }));
    renderTasks();
  } catch (e) {
    console.error('load tasks', e);
  }
}

function renderTasks() {
  const feed = document.getElementById('feed');
  const count = document.getElementById('panelCount');
  count.textContent = `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
  if (tasks.length === 0) {
    feed.innerHTML = `<div class="empty"><span>No tasks yet</span><p class="hint">Create a task from an agent card to start. Every issue is a task; every comment is an agent result.</p></div>`;
    return;
  }
  feed.innerHTML = tasks.map(t => `
    <div class="task">
      <div class="task-header">
        <span class="task-id">#${t.number}</span>
        <span class="task-agent">${escapeHtml(t.agent)}</span>
      </div>
      <div class="task-title">${escapeHtml(t.title.replace(/^agent\/[^:]+:\s*/, ''))}</div>
      <div class="task-body">${escapeHtml(t.body.slice(0, 400))}${t.body.length > 400 ? '…' : ''}</div>
      <div class="task-meta">
        <span class="status ${t.state}">${t.state}</span>
        <span>created ${fmtDate(t.created_at)}</span>
        <span>${t.comments} comment${t.comments === 1 ? '' : 's'}</span>
      </div>
      <div class="task-result">${renderResultPlaceholder(t)}</div>
    </div>
  `).join('');
}

function renderResultPlaceholder(t) {
  // If there's a latest comment, show it. Otherwise empty.
  return `<div class="task-result empty-result">No agent result yet. The worker will post here when it completes.</div>`;
}

// ---------------- Dialog ----------------
const dialog = document.getElementById('taskDialog');
const form = document.getElementById('taskForm');
const agentSelect = document.getElementById('taskAgent');

function openDialog() {
  agentSelect.innerHTML = agents.map(a => `<option value="${escapeHtml(a.slug)}">${escapeHtml(a.name)} — ${escapeHtml(a.model || '—')}</option>`).join('');
  dialog.showModal();
}
function closeDialog() { dialog.close(); }
document.getElementById('newTaskBtn').onclick = openDialog;
document.getElementById('closeDialog').onclick = closeDialog;
document.getElementById('cancelDialog').onclick = closeDialog;
dialog.addEventListener('click', e => { if (e.target === dialog) closeDialog(); });

form.onsubmit = async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submitTask');
  const orig = btn.textContent;
  btn.textContent = 'Creating…'; btn.disabled = true;
  try {
    const subject = document.getElementById('taskSubject').value.trim();
    const prompt = document.getElementById('taskPrompt').value.trim();
    const agent = agentSelect.value;
    const title = `agent/${agent}: ${subject}`;
    const body = prompt;
    const url = `https://github.com/${CONSOLE_REPO}/issues/new`;
    const params = new URLSearchParams({ title, body, labels: `agent:${agent}` });
    // Open prefilled issue in new tab (no token needed in browser)
    window.open(`${url}?${params.toString()}`, '_blank');
    closeDialog();
    form.reset();
    // Poll for the new issue shortly
    setTimeout(loadTasks, 2500);
  } finally {
    btn.textContent = orig; btn.disabled = false;
  }
};

document.getElementById('agentSearch').oninput = renderAgents;
document.getElementById('refreshBtn').onclick = () => { etag = null; loadTasks(); };

// ---------------- Init ----------------
loadAgents();
loadTasks();
pollTimer = setInterval(loadTasks, 15000);
