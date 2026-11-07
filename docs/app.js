/* Agent Fleet Console v3 — real-time chat UI for the GitHub-powered fleet */
const CONSOLE_REPO = 'krisharyanagarwal-dev/agent-fleet-console';
const ENGINE_REPO  = 'krisharyanagarwal-dev/openalice-fleet';
const ENGINE_BRANCH = 'github-console-integration';

let agents = [];
let currentAgent = null;
let currentTask = null;
let pollTimer = null;
let messagePollTimer = null;

const AGENT_STORAGE_KEY = 'fleet-agents-v3';
const AGENT_STORAGE_TS  = 'fleet-agents-v3-ts';
const AGENT_TTL_MS = 10 * 60 * 1000;

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }
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
    updateCounts();
    return;
  }
  let index = null;
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${ENGINE_REPO}/${ENGINE_BRANCH}/agents/index.json`, { cache: 'no-cache' });
    if (res.ok) index = await res.json();
  } catch { /* fall through */ }
  if (!index) {
    try {
      const res = await fetch(`https://api.github.com/repos/${ENGINE_REPO}/contents/agents?ref=${ENGINE_BRANCH}&per_page=1000`, { cache: 'no-cache' });
      if (res.ok) {
        const list = await res.json();
        index = {};
        for (const f of list) {
          if (f.name.endsWith('.md')) {
            const slug = f.name.replace(/\.md$/, '');
            index[slug] = { name: slug.replace(/-[a-z]/g, m => m[1].toUpperCase()), model: '—', pool: 'unknown', description: '' };
          }
        }
      }
    } catch (e) {
      console.error('load agents', e);
      $('#agentGrid').innerHTML = `<div class="empty">Unable to load agent index.</div>`;
      return;
    }
  }
  agents = Object.entries(index).map(([slug, info]) => ({
    slug, ...info
  }));
  localStorage.setItem(AGENT_STORAGE_KEY, JSON.stringify(agents));
  localStorage.setItem(AGENT_STORAGE_TS, String(Date.now()));
  renderAgents();
  updateCounts();
}

function providerFromPool(pool) {
  if (pool.includes('nvidia')) return 'NVIDIA';
  if (pool === 'google') return 'Google';
  if (pool === 'groq') return 'Groq';
  if (pool === 'openrouter') return 'OpenRouter';
  if (pool === 'cerebras') return 'Cerebras';
  return 'Other';
}
function providerColorClass(pool) {
  const p = providerFromPool(pool).toLowerCase();
  return `provider-${p}`;
}

function renderAgents() {
  const q = $('#agentSearch').value.toLowerCase();
  const activeFilter = $$('.chip.active')[0]?.dataset.filter || 'all';
  const grid = $('#agentGrid');
  const filtered = agents.filter(a => {
    const matchQ = a.name.toLowerCase().includes(q) || a.slug.toLowerCase().includes(q);
    const matchF = activeFilter === 'all' || providerFromPool(a.pool).toLowerCase() === activeFilter;
    return matchQ && matchF;
  });
  grid.innerHTML = filtered.map(a => {
    const sel = currentAgent === a.slug ? ' selected' : '';
    const provCls = providerColorClass(a.pool);
    return `
      <div class="agent-card${sel}" onclick="selectAgent('${escapeHtml(a.slug)}')">
        <div class="agent-name">${escapeHtml(a.name)}</div>
        <div class="agent-model ${provCls}">${escapeHtml(a.model)}</div>
        <div class="agent-provider">${escapeHtml(providerFromPool(a.pool))}</div>
        <div class="agent-desc">${escapeHtml(a.description || 'OpenCode subagent')}</div>
      </div>
    `;
  }).join('');
}

window.selectAgent = function(slug) {
  currentAgent = slug;
  const agent = agents.find(a => a.slug === slug);
  renderAgents();
  $('#panelTitle').textContent = agent ? agent.name : 'Select an Agent';
  $('#agentStatus').textContent = agent ? `Model: ${agent.model} · Pool: ${agent.pool}` : '—';
  $('#agentStatus').className = 'chip status-badge';
  const empty = $('#emptyState');
  const chat = $('#chatArea');
  const input = $('#inputArea');
  if (agent) {
    empty.style.display = 'none';
    chat.style.display = 'flex';
    input.style.display = 'block';
    $('#messageInput').focus();
    loadTaskForAgent(slug);
  } else {
    empty.style.display = 'flex';
    chat.style.display = 'none';
    input.style.display = 'none';
  }
};

function updateCounts() {
  $('#fleetStats').textContent = `${agents.length} agents`;
}

// ---------------- Tasks ----------------
async function loadTaskForAgent(slug) {
  try {
    const res = await fetch(`https://api.github.com/repos/${CONSOLE_REPO}/issues?state=all&per_page=100&sort=updated&direction=desc`, { cache: 'no-cache' });
    if (!res.ok) return;
    const issues = await res.json();
    const agentIssues = issues.filter(i => /^agent\//.test(i.title || ''));
    const match = agentIssues.find(i => {
      const m = i.title.match(/^agent\/([^:]+):/);
      return m && m[1] === slug;
    });
    if (match) {
      currentTask = { number: match.number, agent: slug, html_url: match.html_url, title: match.title, body: match.body || '', state: match.state };
      renderTask(match);
      startMessagePoll(match.number);
    } else {
      currentTask = null;
      $('#messages').innerHTML = `<div class="empty-state" style="height:auto;padding:1rem"><div class="empty-icon">📭</div><h3 style="font-size:1rem;margin-bottom:0.25rem">No tasks yet</h3><p style="font-size:0.8rem">Send a message to create the first task for ${slug}.</p></div>`;
    }
  } catch (e) { console.error('load task', e); }
}

async function fetchComments(issueNumber) {
  try {
    const res = await fetch(`https://api.github.com/repos/${CONSOLE_REPO}/issues/${issueNumber}/comments?per_page=50`, { cache: 'no-cache' });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

function renderTask(issue) {
  const messages = $('#messages');
  let html = `
    <div class="message me">
      <div class="message-content">${escapeHtml(issue.body)}</div>
      <div class="message-meta"><span>You</span><span>${fmtDate(issue.created_at)}</span></div>
    </div>
  `;
  if (issue.comments > 0) {
    fetchComments(issue.number).then(comments => {
      const agentComments = comments.filter(c => c.body && c.body.includes('Posted by OpenCode agent fleet worker'));
      if (agentComments.length > 0) {
        const latest = agentComments[agentComments.length - 1];
        const parts = latest.body.split('\n---\n');
        const resultBody = parts.length >= 3 ? parts[1] : latest.body;
        const statusCls = latest.body.includes('status:done') ? 'result-ok' : 'result-fail';
        const modelMatch = latest.body.match(/\*\*Model:\*\* ([^\n|]+)/);
        const model = modelMatch ? modelMatch[1].trim() : '—';
        const agentName = latest.body.match(/— (.+?) —/)?.[1] || 'Agent';
        messages.innerHTML = html + `
          <div class="message agent">
            <span class="result-tag ${statusCls}">✅ ${agentName} · ${model}</span>
            <div class="message-content">${escapeHtml(resultBody)}</div>
            <div class="message-meta"><span>Agent result</span><span>${fmtDate(latest.updated_at)}</span></div>
          </div>
        `;
      } else {
        messages.innerHTML = html;
      }
      messages.scrollTop = messages.scrollHeight;
    });
  } else {
    messages.innerHTML = html;
  }
  messages.scrollTop = messages.scrollHeight;
}

function startMessagePoll(issueNumber) {
  if (messagePollTimer) clearInterval(messagePollTimer);
  messagePollTimer = setInterval(async () => {
    try {
      const comments = await fetchComments(issueNumber);
      const agentComments = comments.filter(c => c.body && c.body.includes('Posted by OpenCode agent fleet worker'));
      if (agentComments.length > 0) {
        const latest = agentComments[agentComments.length - 1];
        const parts = latest.body.split('\n---\n');
        const resultBody = parts.length >= 3 ? parts[1] : latest.body;
        const statusCls = latest.body.includes('status:done') ? 'result-ok' : 'result-fail';
        const modelMatch = latest.body.match(/\*\*Model:\*\* ([^\n|]+)/);
        const model = modelMatch ? modelMatch[1].trim() : '—';
        const agentName = latest.body.match(/— (.+?) —/)?.[1] || 'Agent';
        const existing = $$('.message.agent').length > 0;
        if (!existing) {
          const messages = $('#messages');
          messages.innerHTML += `
            <div class="message agent">
              <span class="result-tag ${statusCls}">✅ ${agentName} · ${model}</span>
              <div class="message-content">${escapeHtml(resultBody)}</div>
              <div class="message-meta"><span>Agent result</span><span>${fmtDate(latest.updated_at)}</span></div>
            </div>
          `;
          messages.scrollTop = messages.scrollHeight;
        }
        clearInterval(messagePollTimer);
        messagePollTimer = null;
      }
    } catch { /* keep polling */ }
  }, 5000);
}

// ---------------- Dispatch ----------------
$('#chatForm').onsubmit = async (e) => {
  e.preventDefault();
  const input = $('#messageInput');
  const text = input.value.trim();
  if (!text || !currentAgent) return;
  const btn = $('#sendBtn');
  const orig = btn.textContent;
  btn.textContent = 'Creating issue…';
  btn.disabled = true;
  try {
    const title = `agent/${currentAgent}: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`;
    const body = text;
    const params = new URLSearchParams({ title, body, labels: `agent:${currentAgent}` });
    window.open(`https://github.com/${CONSOLE_REPO}/issues/new?${params.toString()}`, '_blank');
    input.value = '';
    setTimeout(() => pollForNewIssue(currentAgent, text), 3000);
  } finally {
    btn.textContent = orig;
    btn.disabled = false;
  }
};

async function pollForNewIssue(agent, prompt) {
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const res = await fetch(`https://api.github.com/repos/${CONSOLE_REPO}/issues?state=open&per_page=50&sort=created&direction=desc`, { cache: 'no-cache' });
      if (!res.ok) continue;
      const issues = await res.json();
      const match = issues.find(i => {
        const m = i.title.match(/^agent\/([^:]+):/);
        return m && m[1] === agent && i.body === prompt;
      });
      if (match) {
        currentTask = { number: match.number, agent, html_url: match.html_url, title: match.title, body: match.body, state: match.state };
        renderTask(match);
        startMessagePoll(match.number);
        return;
      }
    } catch { /* retry */ }
  }
}

// ---------------- UI wiring ----------------
$('#agentSearch').oninput = renderAgents;
$$('.chip').forEach(c => {
  c.onclick = () => {
    $$('.chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    renderAgents();
  };
});
$('#refreshBtn').onclick = () => {
  localStorage.removeItem(AGENT_STORAGE_KEY);
  loadAgents();
};

// ---------------- Init ----------------
loadAgents();
pollTimer = setInterval(() => {
  if (currentTask) loadTaskForAgent(currentTask.agent);
}, 15000);
