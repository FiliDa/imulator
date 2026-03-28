const $ = (id) => document.getElementById(id);
const tokenKey = 'admin_token';
const getToken = () => localStorage.getItem(tokenKey) || $('token').value.trim();
const setToken = (t) => localStorage.setItem(tokenKey, t);
if ($('token')) {
  $('token').value = localStorage.getItem(tokenKey) || '';
  $('saveToken') && ($('saveToken').onclick = () => setToken($('token').value.trim()));
}

// Theme toggle
const themeKey = 'ui_theme';
function applyTheme(v){
  document.documentElement.style.setProperty('--bg', v==='light' ? '#f3f4f6' : '#0f1216');
  document.documentElement.style.setProperty('--panel', v==='light' ? '#ffffff' : '#151a21');
  document.documentElement.style.setProperty('--text', v==='light' ? '#0b0f14' : '#e6edf3');
  document.documentElement.style.setProperty('--muted', v==='light' ? '#4b5563' : '#9aa7b0');
  document.documentElement.style.setProperty('--border', v==='light' ? '#e5e7eb' : '#1f2937');
}
applyTheme(localStorage.getItem(themeKey) || 'dark');
if ($('toggleTheme')) {
  $('toggleTheme').onclick = () => {
    const cur = localStorage.getItem(themeKey) || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    localStorage.setItem(themeKey, next); applyTheme(next);
  };
}

const authHeaders = () => ({ 'x-admin-token': getToken() });
const j = (r) => r.json();
const pretty = (obj) => JSON.stringify(obj, null, 2);

function setLoading(btn, on, label) {
  if (!btn) return;
  btn.disabled = !!on;
  if (label !== undefined) btn.textContent = on ? label : btn.getAttribute('data-label') || btn.textContent;
  if (!on && btn.getAttribute('data-label')) btn.textContent = btn.getAttribute('data-label');
  if (on && !btn.getAttribute('data-label')) btn.setAttribute('data-label', btn.textContent);
}

// Tabs: inner segmented groups (e.g., Tests)
document.addEventListener('click', (evt) => {
  const tab = evt.target.closest('.seg-btn');
  if (!tab) return;
  const group = tab.closest('.seg');
  const panels = group?.nextElementSibling && group.nextElementSibling.classList.contains('panels') ? group.nextElementSibling : null;
  if (!panels) return;
  const tabsEls = group.querySelectorAll('.seg-btn');
  const panelsEls = panels.querySelectorAll('.panel');
  tabsEls.forEach(t => t.classList.remove('active'));
  panelsEls.forEach(p => p.classList.remove('active'));
  tab.classList.add('active');
  const target = tab.getAttribute('data-tab');
  const el = document.getElementById(target);
  if (el) el.classList.add('active');
});

// Sidebar navigation (delegated)
document.addEventListener('click', (evt) => {
  const btn = evt.target.closest('.nav-btn');
  if (!btn) return;
  const target = btn.getAttribute('data-target');
  const allBtns = document.querySelectorAll('#sidebarNav .nav-btn');
  allBtns.forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const panels = document.querySelectorAll('.content > .panel');
  panels.forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(target);
  if (!panel) { console.warn('[admin] panel not found', target); return; }
  panel.classList.add('active');
});

// Self-test: simulate user interactions (optional via ?selftest=1)
function runSelfTest() {
  if (!location.search.includes('selftest=1')) return;
  console.log('[admin selftest] start');
  const mainTabs = Array.from(document.querySelectorAll('#sidebarNav .nav-btn'));
  let i = 0;
  function nextMain() {
    if (i >= mainTabs.length) return nextTests();
    mainTabs[i].click();
    const id = mainTabs[i].getAttribute('data-target');
    const panel = document.getElementById(id);
    if (!panel || !panel.classList.contains('active')) console.warn('[admin selftest] panel not active', id);
    i++; setTimeout(nextMain, 250);
  }
  function nextTests() {
    const testsTabs = Array.from(document.querySelectorAll('#testsSeg .seg-btn'));
    let j = 0;
    function step() {
      if (j >= testsTabs.length) { console.log('[admin selftest] done'); toast('Self-test ok', 'success'); return; }
      testsTabs[j].click();
      const id = testsTabs[j].getAttribute('data-tab');
      const panel = document.getElementById(id);
      if (!panel || !panel.classList.contains('active')) console.warn('[admin selftest] test panel not active', id);
      j++; setTimeout(step, 250);
    }
    step();
  }
  nextMain();
}
runSelfTest();

// Health check on load
async function reloadHealth() {
  try {
    const d = await fetch('/health').then(j);
    $('health').textContent = `OK`;
    $('stModel').textContent = d.model;
    $('stCfg').textContent = String(d.configured);
    $('stUptime').textContent = `${d.uptimeSec}s`;
  } catch { $('health').textContent = 'Ошибка здоровья'; }
}
reloadHealth();
setInterval(reloadHealth, 2000);

// Config + Stats
async function reloadMeta() {
  try {
    const c = await fetch('/api/v1/admin/config', { headers: authHeaders() }).then(j);
    $('stModel').textContent = c.public?.openaiModel || '—';
    const s = await fetch('/api/v1/admin/stats', { headers: authHeaders() }).then(j);
    $('stCfg').textContent = String(s.configured);
    $('stUsers').textContent = String(s.usersCount);
    // Role badge detection: try admin-only endpoint
    try {
      const r = await fetch('/api/v1/admin/audit?limit=1', { headers: authHeaders() });
      $('roleBadge').textContent = r.ok ? 'роль: admin' : (r.status===403 ? 'роль: operator' : 'роль: —');
    } catch { $('roleBadge').textContent = 'роль: —'; }
  } catch (e) { console.error(e); }
}
$('reloadMeta') && ($('reloadMeta').onclick = reloadMeta);
reloadMeta();
setInterval(reloadMeta, 5000);

function toast(msg, type='info') {
  const c = $('toast');
  if (!c) return alert(msg);
  const d = document.createElement('div');
  d.className = 'toast ' + (type || 'info');
  d.textContent = msg;
  c.appendChild(d);
  setTimeout(() => { d.style.opacity = '0'; d.style.transform = 'translateY(6px)'; }, 2800);
  setTimeout(() => { try { c.removeChild(d); } catch {} }, 3400);
}

// Prompt controls
if ($('promptLoad')) {
  $('promptLoad').onclick = async () => {
    setLoading($('promptLoad'), true, 'Загрузка…'); $('promptText').value = '';
    try {
      const r = await fetch('/api/v1/admin/prompt', { headers: authHeaders() });
      if (!r.ok) return toast('Нет доступа', 'error');
      const d = await r.json();
      $('promptText').value = d.prompt || '';
      toast('Промпт загружен', 'success');
    } finally { setLoading($('promptLoad'), false); }
  };
}
if ($('promptApply')) {
  $('promptApply').onclick = async () => {
    setLoading($('promptApply'), true, 'Применяю…');
    try {
      const r = await fetch('/api/v1/admin/prompt/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ prompt: $('promptText').value })
      });
      if (!r.ok) return toast('Ошибка применения', 'error');
      reloadMeta();
      toast('Промпт применён', 'success');
    } finally { setLoading($('promptApply'), false); }
  };
}
if ($('promptSave')) {
  $('promptSave').onclick = async () => {
    setLoading($('promptSave'), true, 'Сохраняю…');
    try {
      const r = await fetch('/api/v1/admin/prompt', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ prompt: $('promptText').value })
      });
      if (!r.ok) return toast('Ошибка сохранения', 'error');
      reloadMeta();
      toast('Промпт сохранён', 'success');
    } finally { setLoading($('promptSave'), false); }
  };
}
if ($('promptReset')) {
  $('promptReset').onclick = async () => {
    setLoading($('promptReset'), true, 'Сбрасываю…');
    try {
      const r = await fetch('/api/v1/admin/prompt/reset', { method: 'POST', headers: authHeaders() });
      if (!r.ok) return toast('Ошибка сброса', 'error');
      const d = await r.json();
      $('promptText').value = d.prompt || '';
      reloadMeta();
      toast('Промпт сброшен', 'success');
    } finally { setLoading($('promptReset'), false); }
  };
}
if ($('promptReload')) {
  $('promptReload').onclick = async () => {
    setLoading($('promptReload'), true, 'Перечитываю…');
    try {
      const r = await fetch('/api/v1/admin/prompt/reload', { method: 'POST', headers: authHeaders() });
      if (!r.ok) return toast('Ошибка перечитывания', 'error');
      const d = await r.json();
      $('promptText').value = d.prompt || '';
      reloadMeta();
      toast('Промпт перечитан', 'success');
    } finally { setLoading($('promptReload'), false); }
  };
}

// Logs
async function reloadLogs() {
  const params = new URLSearchParams();
  const route = $('logsRoute').value.trim(); const limit = $('logsLimit').value; const since = $('logsSince').value.trim();
  if (route) params.set('route', route);
  if (limit) params.set('limit', limit);
  if (since) params.set('since', since);
  const q = $('logsQuery').value.trim(); if (q) params.set('q', q);
  $('logsOut').textContent = 'Загрузка логов…'; setLoading($('logsReload'), true, 'Загружаю…');
  const r = await fetch(`/api/v1/admin/logs?${params.toString()}`, { headers: authHeaders() });
  if (!r.ok) { $('logsOut').textContent = 'Ошибка доступа к логам'; setLoading($('logsReload'), false); return; }
  const d = await r.json();
  $('logsOut').textContent = pretty(d);
  setLoading($('logsReload'), false);
}
$('logsReload') && ($('logsReload').onclick = reloadLogs);
if ($('logsClear')) {
  $('logsClear').onclick = async () => {
    setLoading($('logsClear'), true, 'Очищаю…');
    try {
      const r = await fetch('/api/v1/admin/logs/clear', { method: 'POST', headers: authHeaders() });
      if (!r.ok) return toast('Ошибка очистки', 'error');
      $('logsOut').textContent = '—';
      toast('Логи очищены', 'success');
    } finally { setLoading($('logsClear'), false); }
  };
}
reloadLogs();
setInterval(reloadLogs, 5000);

if ($('logsExportJson')) {
  $('logsExportJson').onclick = () => {
    const q = $('logsQuery').value.trim(); const route = $('logsRoute').value.trim(); const limit = $('logsLimit').value; const since = $('logsSince').value.trim();
    const p = new URLSearchParams();
    if (q) p.set('q', q); if (route) p.set('route', route); if (limit) p.set('limit', limit); if (since) p.set('since', since);
    const url = `/api/v1/admin/logs/export?${p.toString()}&format=json`;
    window.open(url, '_blank');
  };
}
if ($('logsExportCsv')) {
  $('logsExportCsv').onclick = () => {
    const q = $('logsQuery').value.trim(); const route = $('logsRoute').value.trim(); const limit = $('logsLimit').value; const since = $('logsSince').value.trim();
    const p = new URLSearchParams();
    if (q) p.set('q', q); if (route) p.set('route', route); if (limit) p.set('limit', limit); if (since) p.set('since', since);
    const url = `/api/v1/admin/logs/export?${p.toString()}&format=csv`;
    window.open(url, '_blank');
  };
}

// Tests: Text
if ($('sendText')) {
  $('sendText').onclick = async () => {
    const body = { text: $('testText').value, context: $('testContextT').value };
    const plain = $('plainText').checked;
    const r = await fetch('/api/v1/analyze/text' + (plain ? '?plain=true' : ''), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': plain ? 'text/plain' : 'application/json' }, body: JSON.stringify(body)
    });
    const d = plain ? await r.text() : await r.json(); $('testTextOut').textContent = plain ? d : pretty(d);
  };
}

// Tests: Text+Image
if ($('sendTextImage')) {
  $('sendTextImage').onclick = async () => {
    const fd = new FormData();
    fd.set('text', $('testTIText').value);
    fd.set('context', $('testContextTI').value);
    const files = $('testTIImages').files;
    for (let i = 0; i < files.length; i++) fd.append('images', files[i]);
    const plain = $('plainTI').checked;
    const r = await fetch('/api/v1/analyze/text-image' + (plain ? '?plain=true' : ''), { method: 'POST', headers: { 'Accept': plain ? 'text/plain' : 'application/json' }, body: fd });
    const d = plain ? await r.text() : await r.json(); $('testTIOut').textContent = plain ? d : pretty(d);
  };
}

// Tests: Image
if ($('sendImage')) {
  $('sendImage').onclick = async () => {
    const fd = new FormData();
    fd.set('context', $('testContextI').value);
    const files = $('testIImages').files;
    for (let i = 0; i < files.length; i++) fd.append('images', files[i]);
    const plain = $('plainI').checked;
    const r = await fetch('/api/v1/analyze/image' + (plain ? '?plain=true' : ''), { method: 'POST', headers: { 'Accept': plain ? 'text/plain' : 'application/json' }, body: fd });
    const d = plain ? await r.text() : await r.json(); $('testIOut').textContent = plain ? d : pretty(d);
  };
}

// (Qwen тесты удалены по запросу)

// Audit
async function reloadAudit() {
  try {
    $('auditOut').textContent = 'Загрузка аудита…'; setLoading($('auditReload'), true, 'Загружаю…');
    const limit = Math.max(1, Math.min(1000, Number($('auditLimit').value || 100)));
    const r = await fetch(`/api/v1/admin/audit?limit=${limit}`, { headers: authHeaders() });
    if (r.status === 403) { $('auditOut').textContent = 'Недостаточно прав (нужен админ)'; return; }
    if (!r.ok) { $('auditOut').textContent = 'Ошибка запроса'; return; }
    const d = await r.json(); $('auditOut').textContent = pretty(d);
  } catch { $('auditOut').textContent = 'Ошибка запроса'; }
  finally { setLoading($('auditReload'), false); }
}
$('auditReload') && ($('auditReload').onclick = reloadAudit);
reloadAudit();

// Daily stats
async function reloadDaily() {
  try {
    $('dailyOut').textContent = 'Загрузка статистики…'; setLoading($('dailyReload'), true, 'Загружаю…');
    const days = Math.max(1, Math.min(30, Number($('dailyDays').value || 7)));
    const r = await fetch(`/api/v1/admin/stats/daily?days=${days}`, { headers: authHeaders() });
    if (!r.ok) { $('dailyOut').textContent = 'Ошибка запроса'; return; }
    const d = await r.json(); $('dailyOut').textContent = pretty(d);
  } catch { $('dailyOut').textContent = 'Ошибка запроса'; }
  finally { setLoading($('dailyReload'), false); }
}
$('dailyReload') && ($('dailyReload').onclick = reloadDaily);
reloadDaily();

// Runtime config update
if ($('cfgApply')) {
  $('cfgApply').onclick = async () => {
    const body = {
      openaiApiKey: $('cfgKey').value,
      llmModel: $('cfgModel').value,
      corsOrigin: $('cfgCors').value,
      adminToken: $('cfgAdmin').value,
      operatorToken: $('cfgOperator').value,
    };
    setLoading($('cfgApply'), true, 'Применяю…');
    const r = await fetch('/api/v1/admin/config/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body)
    });
    if (!r.ok) { setLoading($('cfgApply'), false); return toast('Ошибка обновления конфига', 'error'); }
    const d = await r.json();
    if (body.adminToken) { setToken(body.adminToken); $('token').value = body.adminToken; }
    toast('Конфиг обновлён', 'success');
    reloadMeta();
    setLoading($('cfgApply'), false);
  };
}

// Prompt import/export
if ($('promptExport')) {
  $('promptExport').onclick = () => {
    const blob = new Blob([$('promptText').value || ''], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'prompt.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}
if ($('promptImport')) {
  $('promptImport').onclick = () => $('promptImportFile').click();
}
if ($('promptImportFile')) {
  $('promptImportFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const t = await file.text();
    $('promptText').value = t;
  };
}