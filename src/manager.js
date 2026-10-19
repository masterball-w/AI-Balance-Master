/**
 * AI余额管理大师 · 管理器渲染进程
 * 原则：任何未知值显示「未获取」，绝不展示编造的数字。
 */
const $ = (id) => document.getElementById(id);
const { NA, isNum, fmtNum, fmtTime, balanceInfo, fetchStatus, quotaKnown } = Shared;

/* ---------------- 平台模板库（仅品牌色/套餐名/单位等模板信息，不含任何余额或额度数字） ---------------- */
const TEMPLATES = [
  { name: 'ChatGPT',          vendor: 'OpenAI',       plan: 'Plus',        color: '#10a37f', unit: 'USD', note: '订阅制 · 无公开余额接口' },
  { name: 'Cursor',           vendor: 'Anysphere',    plan: 'Pro',         color: '#4b4b52', unit: 'USD', note: '订阅制 · 无公开余额接口' },
  { name: 'Grok',             vendor: 'xAI',          plan: 'SuperGrok',   color: '#0f1419', unit: 'USD', note: '订阅制 · 无公开余额接口' },
  { name: 'Gemini',           vendor: 'Google',       plan: 'AI Pro',      color: '#4285f4', unit: 'CNY', note: '订阅制 · 无公开余额接口' },
  { name: 'Claude Code',      vendor: 'Anthropic',    plan: 'Pro',         color: '#d97757', unit: 'USD', note: '订阅制 · 无公开余额接口' },
  { name: 'GLM Coding Plan',  vendor: '智谱 AI',      plan: 'Pro',         color: '#3b5bff', unit: 'CNY', note: '订阅制 · 无公开余额接口' },
  { name: 'DeepSeek',         vendor: '深度求索',     plan: 'API 按量计费', color: '#4d6bfe', unit: 'CNY', note: '填入 API Key 后可自动获取', provider: 'deepseek' },
  { name: 'Kimi API（国内站）', vendor: '月之暗面',    plan: 'API 按量计费', color: '#1f2937', unit: 'CNY', note: '填入 API Key 后可自动获取', provider: 'moonshot-cn' },
  { name: 'Kimi API（国际站）', vendor: 'Moonshot AI', plan: 'API 按量计费', color: '#1f2937', unit: 'USD', note: '填入 API Key 后可自动获取', provider: 'moonshot-ai' },
  { name: '硅基流动',          vendor: 'SiliconFlow',  plan: 'API 按量计费', color: '#7c3aed', unit: 'CNY', note: '填入 API Key 后可自动获取', provider: 'siliconflow' },
  { name: 'OpenRouter',       vendor: 'OpenRouter',   plan: 'Credits',     color: '#6467f2', unit: 'USD', note: '需 Management Key 才能自动获取', provider: 'openrouter' },
  { name: 'LongCat',          vendor: '美团',         plan: 'Coding 套餐',  color: '#ffc400', unit: 'CNY', note: '订阅制 · 无公开余额接口' },
  { name: 'Trae',             vendor: '字节跳动',     plan: 'Pro',         color: '#00c2ff', unit: 'USD', note: '订阅制 · 无公开余额接口' },
  { name: 'Qoder',            vendor: '阿里巴巴',     plan: 'Pro',         color: '#ff6a00', unit: 'CNY', note: '订阅制 · 无公开余额接口' },
  { name: 'OpenCode',         vendor: 'OpenCode',     plan: 'Zen',         color: '#8b5cf6', unit: 'credits', note: '手动填写' },
  { name: 'Cline',            vendor: 'Cline',        plan: 'Credits',     color: '#ff5c39', unit: 'credits', note: '手动填写' },
  { name: 'GitHub Copilot',   vendor: 'GitHub',       plan: 'Pro',         color: '#24292e', unit: 'USD', note: '订阅制 · 无公开余额接口' },
  { name: '通义千问',          vendor: '阿里巴巴',     plan: '会员',        color: '#615ced', unit: 'CNY', note: '订阅制 · 无公开余额接口' },
  { name: '豆包',              vendor: '字节跳动',     plan: '会员',        color: '#00d3ff', unit: 'CNY', note: '订阅制 · 无公开余额接口' },
  { name: 'Windsurf',         vendor: 'Codeium',      plan: 'Pro',         color: '#22c55e', unit: 'USD', note: '订阅制 · 无公开余额接口' },
  { name: '纳米 AI',           vendor: '360',          plan: '会员',        color: '#051628', unit: 'CNY', note: '订阅制 · 无公开余额接口' },
];

/* ---------------- 状态 ---------------- */
let data = { platforms: [], settings: {} };
let providers = [];
let filter = 'all';
let keyword = '';
let editingId = null; // null = 新增
const busy = new Set(); // 正在刷新的平台 id

/* ---------------- 工具 ---------------- */
const pad = (n) => String(n).padStart(2, '0');
const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function daysLeft(dateStr) {
  if (!dateStr) return Infinity;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const t = new Date(dateStr + 'T00:00:00');
  if (isNaN(t)) return Infinity;
  return Math.round((t - now) / 86400000);
}
function fmtDate(s) { if (!s) return NA; const [, m, d] = s.split('-'); return `${Number(m)}/${Number(d)}`; }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function quotaCountdown(resetAt) {
  if (!resetAt) return '';
  const diff = new Date(resetAt).getTime() - Date.now();
  if (isNaN(diff)) return '';
  if (diff <= 0) return '已重置';
  const mins = Math.ceil(diff / 60000);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}时${m}分后重置` : `${m}分钟后重置`;
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const providerLabel = (id) => (providers.find((p) => p.id === id) || {}).label || id;
const currencySymbol = (u) => (u === 'CNY' ? '¥' : u === 'USD' ? '$' : '');

/** 提交给主进程前去掉仅供显示的字段（fetch 结果/hasKey 以主进程为准） */
function payload() {
  return {
    platforms: data.platforms.map(({ fetch, hasKey, ...rest }) => rest),
    settings: { autoRefreshMinutes: data.settings.autoRefreshMinutes },
  };
}
async function persist() { await window.api.saveData(payload()); }

/* ---------------- 渲染：统计 ---------------- */
function renderStats() {
  const list = data.platforms;
  $('stat-total').textContent = list.length;
  $('stat-expiring').textContent = list.filter((p) => { const d = daysLeft(p.expiryDate); return d !== Infinity && d <= 7; }).length;
  $('stat-renew').textContent = list.filter((p) => p.autoRenew === true).length;

  const sums = {};
  for (const p of list) {
    const b = balanceInfo(p);
    if (b.kind !== 'none' && b.unit) sums[b.unit] = (sums[b.unit] || 0) + b.value;
  }
  const parts = Object.entries(sums).map(([u, v]) => `${currencySymbol(u)}${fmtNum(Math.round(v * 100) / 100)}${currencySymbol(u) ? '' : ' ' + u}`);
  $('stat-balance').textContent = parts.length ? parts.join(' · ') : NA;
}

/* ---------------- 渲染：卡片 ---------------- */
function cardHtml(p) {
  const d = daysLeft(p.expiryDate);
  const hasExpiry = !!p.expiryDate && d !== Infinity;

  // 到期徽章
  let daysBadge;
  if (hasExpiry) {
    const cls = d <= 3 ? 'badge-days-danger' : d <= 7 ? 'badge-days-warn' : 'badge-days-ok';
    const txt = d < 0 ? `逾期${-d}天` : d === 0 ? '今天到期' : `剩${d}天`;
    daysBadge = `<span class="badge ${cls}">${txt}</span>`;
  } else {
    daysBadge = `<span class="badge badge-days-none">到期日 ${NA}</span>`;
  }

  // 余额
  const b = balanceInfo(p);
  let balanceHtml;
  if (b.kind === 'none') {
    balanceHtml = `<div class="bal-num bal-na">${NA}</div>`;
  } else {
    const tag = b.kind === 'api' ? '<span class="src-tag src-api">官方接口</span>' : b.kind === 'stale' ? '<span class="src-tag src-stale">上次获取 · 已过期</span>' : '<span class="src-tag src-manual">手动填写</span>';
    balanceHtml = `<div class="bal-num">${escapeHtml(fmtNum(b.value))}</div><div class="bal-unit">${escapeHtml(b.unit)}</div>${tag}`;
  }
  const noteHtml = p.balanceNote ? `<span class="bal-note">${escapeHtml(p.balanceNote)}</span>` : '';

  // 余额明细（接口返回的拆分项）
  const f = p.fetch;
  const detailHtml = f && f.status === 'ok' && f.details && f.details.length
    ? `<div class="bal-details">${f.details.map((x) => `<span>${escapeHtml(x.label)} <b>${escapeHtml(x.value)}</b></span>`).join('')}</div>` : '';

  // 5h 限额
  let quotaHtml;
  if (quotaKnown(p)) {
    const total = Number(p.quota.total), used = Number(p.quota.used) || 0;
    const pct = Math.max(0, Math.min(100, Math.round((used / total) * 100)));
    const usedPct = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok';
    quotaHtml = `
      <div class="block">
        <div class="block-title"><span>⚡ 5 小时限额 <em class="src-tag src-manual">手动填写</em></span><span class="val">${used} / ${total}（剩 ${Math.max(0, total - used)}）</span></div>
        <div class="progress quota ${usedPct}"><i style="width:${pct}%"></i></div>
        <div class="sub-line"><span>${escapeHtml(quotaCountdown(p.quota.resetAt) || '重置时间 ' + NA)}</span><span>已用 <b>${pct}%</b></span></div>
      </div>`;
  } else {
    quotaHtml = `<div class="block block-na"><div class="block-title"><span>⚡ 5 小时限额</span><span class="val na">${NA}</span></div></div>`;
  }

  // 订阅周期
  let cycleHtml;
  if (hasExpiry) {
    const sub = p.subscribeDate ? new Date(p.subscribeDate + 'T00:00:00') : null;
    const exp = new Date(p.expiryDate + 'T00:00:00');
    const start = sub && !isNaN(sub) ? sub : new Date(exp.getTime() - 30 * 86400000);
    const totalMs = exp - start;
    const passed = Date.now() - start.getTime();
    const pct = totalMs > 0 ? Math.max(0, Math.min(100, Math.round((passed / totalMs) * 100))) : 100;
    const cls = d <= 3 ? 'danger' : d <= 7 ? 'warn' : 'ok';
    const renew = p.autoRenew === true ? '🔄 将自动续订' : p.autoRenew === false ? '⚠ 不再续订' : `续订状态 ${NA}`;
    cycleHtml = `
      <div class="block">
        <div class="block-title"><span>📅 订阅周期</span><span class="val">${p.subscribeDate ? fmtDate(p.subscribeDate) : NA} → ${fmtDate(p.expiryDate)}</span></div>
        <div class="progress ${cls}"><i style="width:${pct}%"></i></div>
        <div class="sub-line"><span>${renew}</span><span>${p.subscribeDate ? `周期 <b>${pct}%</b>` : '起始日 ' + NA}</span></div>
      </div>`;
  } else {
    cycleHtml = `<div class="block block-na"><div class="block-title"><span>📅 到期 / 续订</span><span class="val na">${NA}</span></div></div>`;
  }

  // 获取状态行
  const st = fetchStatus(p);
  let statusHtml = '';
  if (p.provider) {
    const when = f && f.status === 'ok' ? `上次获取 ${fmtTime(f.lastFetched)}` : f && f.lastFetched ? `上次成功 ${fmtTime(f.lastFetched)}` : '';
    const err = f && f.status === 'error' ? `<div class="fetch-err">⚠ ${escapeHtml(f.error || '获取失败')}</div>` : '';
    const needKey = !p.hasKey ? `<div class="fetch-hint">尚未配置 API Key，点「编辑」填写后即可自动获取</div>` : '';
    statusHtml = `
      <div class="fetch-row">
        <span class="status-pill st-${st.key}">${st.text}</span>
        <span class="fetch-src">${escapeHtml(providerLabel(p.provider))}</span>
        <span class="fetch-time">${when}</span>
      </div>${err}${needKey}`;
  } else {
    statusHtml = `<div class="fetch-row"><span class="status-pill st-${st.key}">${st.text}</span><span class="fetch-src">无公开余额接口 · 手动记录</span></div>`;
  }

  const notesHtml = p.notes ? `<div class="card-notes">📝 ${escapeHtml(p.notes)}</div>` : '';
  const initial = (p.name || '?').trim().charAt(0).toUpperCase();
  const badge = hasExpiry && p.autoRenew === true ? '<span class="badge badge-renew">续订</span>' : hasExpiry && p.autoRenew === false ? '<span class="badge badge-norenew">不续订</span>' : '';
  const refreshBtn = p.provider
    ? `<button class="mini-btn" data-act="refresh" data-id="${p.id}" ${busy.has(p.id) || !p.hasKey ? 'disabled' : ''}>${busy.has(p.id) ? '⏳ 获取中…' : '🔄 刷新'}</button>` : '';

  return `
  <div class="card" style="--pc:${escapeHtml(p.color || '#ff8fab')}">
    <div class="card-head">
      <div class="card-logo">${escapeHtml(initial)}</div>
      <div class="card-title">
        <div class="card-name">${escapeHtml(p.name || '未命名')} ${daysBadge}</div>
        <div class="card-sub">${escapeHtml(p.vendor || '')}${p.vendor && p.plan ? ' · ' : ''}${escapeHtml(p.plan || '')}</div>
      </div>
      ${badge}
    </div>
    <div class="card-balance">${balanceHtml}${noteHtml}</div>
    ${detailHtml}
    ${quotaHtml}
    ${cycleHtml}
    ${statusHtml}
    ${notesHtml}
    <div class="card-foot">
      ${refreshBtn}
      <button class="mini-btn" data-act="edit" data-id="${p.id}">✏️ 编辑</button>
      <button class="mini-btn danger" data-act="del" data-id="${p.id}">🗑 删除</button>
    </div>
  </div>`;
}

function visiblePlatforms() {
  let list = [...data.platforms];
  if (filter === 'expiring') list = list.filter((p) => { const d = daysLeft(p.expiryDate); return d !== Infinity && d <= 7; });
  else if (filter === 'renew') list = list.filter((p) => p.autoRenew === true);
  else if (filter === 'norenew') list = list.filter((p) => p.expiryDate && p.autoRenew === false);
  if (keyword) {
    const k = keyword.toLowerCase();
    list = list.filter((p) => [p.name, p.vendor, p.plan, p.notes].some((v) => (v || '').toLowerCase().includes(k)));
  }
  // 排序：已知到期日从近到远；其余按「有真实数据的在前」，再保持原顺序
  const hasData = (p) => (balanceInfo(p).kind !== 'none' || quotaKnown(p) || p.provider) ? 0 : 1;
  list.sort((a, b) => {
    const da = daysLeft(a.expiryDate), db = daysLeft(b.expiryDate);
    if (da !== db) return da === Infinity ? 1 : db === Infinity ? -1 : da - db;
    return hasData(a) - hasData(b);
  });
  return list;
}

function renderGrid() {
  const list = visiblePlatforms();
  $('grid').innerHTML = list.map(cardHtml).join('');
  $('empty-state').style.display = data.platforms.length ? 'none' : 'block';
  if (data.platforms.length && !list.length) {
    $('grid').innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:50px 0;color:#c9a3b8;">没有符合筛选条件的平台</div>';
  }
}

function renderToolbar() {
  const sel = $('auto-refresh');
  if (document.activeElement !== sel) sel.value = String((data.settings && data.settings.autoRefreshMinutes) || 0);
  const refreshable = data.platforms.filter((p) => p.provider && p.hasKey).length;
  $('btn-refresh-all').disabled = busy.has('*') || refreshable === 0;
  $('btn-refresh-all').textContent = busy.has('*') ? '⏳ 获取中…' : '🔄 全部刷新';
  $('btn-refresh-all').title = refreshable ? `刷新 ${refreshable} 个已配置 Key 的平台` : '还没有平台配置 API Key';
}

function renderAll() { renderStats(); renderGrid(); renderToolbar(); }

/* ---------------- 模态框 ---------------- */
function initProviderSelect() {
  const sel = $('f-provider');
  sel.innerHTML = '<option value="">— 不使用接口，手动填写 —</option>' +
    providers.map((p) => `<option value="${p.id}">${escapeHtml(p.label)}</option>`).join('');
  sel.addEventListener('change', updateProviderUi);
}
function updateProviderUi() {
  const id = $('f-provider').value;
  $('key-fields').style.display = id ? '' : 'none';
  const p = providers.find((x) => x.id === id);
  $('key-hint').textContent = p ? `（${p.keyHint}）` : '';
  const cur = editingId ? data.platforms.find((x) => x.id === editingId) : null;
  const has = !!(cur && cur.hasKey && cur.provider === id);
  $('f-apikey').placeholder = has ? '已配置（留空 = 保持不变，输入新 Key 覆盖）' : '粘贴 API Key';
  $('btn-key-clear').style.display = has ? '' : 'none';
  $('key-status').textContent = has ? '✅ 已配置 Key（出于安全，不会回显）' : '';
  $('key-status').className = 'key-status' + (has ? ' ok' : '');
}

function initTemplates() {
  const sel = $('f-template');
  TEMPLATES.forEach((t, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${t.name}（${t.vendor} · ${t.plan}）`;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    const i = Number(sel.value);
    if (i < 0) return;
    const t = TEMPLATES[i];
    $('f-name').value = t.name;
    $('f-vendor').value = t.vendor;
    $('f-plan').value = t.plan;
    $('f-color').value = t.color;
    $('f-unit').value = t.unit;
    $('f-balance-note').value = t.note || '';
    $('f-provider').value = t.provider || '';
    updateProviderUi();
  });
}

function initColorPresets() {
  const presets = ['#ff8fab', '#e64980', '#10a37f', '#4285f4', '#d97757', '#8b5cf6', '#ff6a00', '#ffc400', '#4b4b52', '#0f1419'];
  const box = $('color-presets');
  presets.forEach((c) => {
    const dot = document.createElement('span');
    dot.className = 'color-dot';
    dot.style.background = c;
    dot.title = c;
    dot.addEventListener('click', () => { $('f-color').value = c; });
    box.appendChild(dot);
  });
}

const toLocalInput = (iso) => {
  const r = new Date(iso);
  return isNaN(r) ? '' : `${toDateStr(r)}T${pad(r.getHours())}:${pad(r.getMinutes())}`;
};

function openModal(platform) {
  editingId = platform ? platform.id : null;
  $('modal-title').textContent = platform ? `编辑 · ${platform.name}` : '添加平台';
  $('f-template').value = '-1';

  $('f-name').value = platform?.name || '';
  $('f-vendor').value = platform?.vendor || '';
  $('f-plan').value = platform?.plan || '';
  $('f-color').value = platform?.color || '#ff8fab';
  $('f-balance').value = platform && isNum(platform.balance) ? platform.balance : '';
  $('f-unit').value = platform?.unit || '';
  $('f-balance-note').value = platform?.balanceNote || '';
  $('f-notes').value = platform?.notes || '';
  $('f-provider').value = platform?.provider || '';
  $('f-apikey').value = '';

  const hasQuota = quotaKnown(platform || {});
  $('f-quota-enabled').checked = hasQuota;
  $('quota-fields').style.display = hasQuota ? '' : 'none';
  $('f-quota-total').value = hasQuota ? platform.quota.total : '';
  $('f-quota-used').value = hasQuota && isNum(platform.quota.used) ? platform.quota.used : '';
  $('f-quota-reset').value = hasQuota && platform.quota.resetAt ? toLocalInput(platform.quota.resetAt) : '';

  $('f-subscribe-date').value = platform?.subscribeDate || '';
  $('f-expiry-date').value = platform?.expiryDate || '';
  $('f-auto-renew').value = platform?.autoRenew === true ? '1' : platform?.autoRenew === false ? '0' : '';

  updateProviderUi();
  $('modal-mask').style.display = 'flex';
  setTimeout(() => $('f-name').focus(), 60);
}
function closeModal() { $('modal-mask').style.display = 'none'; $('f-apikey').value = ''; }

async function submitForm(e) {
  e.preventDefault();
  const name = $('f-name').value.trim();
  if (!name) return;

  const balanceRaw = $('f-balance').value;
  const balance = balanceRaw === '' ? null : Number(balanceRaw);

  let quota = null;
  if ($('f-quota-enabled').checked) {
    const total = Number($('f-quota-total').value);
    if (total > 0) {
      const usedRaw = $('f-quota-used').value;
      quota = {
        total,
        used: usedRaw === '' ? 0 : Number(usedRaw),
        resetAt: $('f-quota-reset').value ? new Date($('f-quota-reset').value).toISOString() : null,
      };
    }
  }
  const ar = $('f-auto-renew').value;
  const provider = $('f-provider').value;
  const id = editingId || uid();

  const platform = {
    id, name,
    vendor: $('f-vendor').value.trim(),
    plan: $('f-plan').value.trim(),
    color: $('f-color').value,
    balance,
    unit: $('f-unit').value.trim(),
    balanceNote: $('f-balance-note').value.trim(),
    quota,
    subscribeDate: $('f-subscribe-date').value || null,
    expiryDate: $('f-expiry-date').value || null,
    autoRenew: ar === '1' ? true : ar === '0' ? false : null,
    notes: $('f-notes').value.trim(),
    provider,
  };

  if (editingId) {
    const idx = data.platforms.findIndex((p) => p.id === editingId);
    if (idx >= 0) data.platforms[idx] = { ...data.platforms[idx], ...platform };
  } else {
    data.platforms.push(platform);
  }
  await persist(); // 先让主进程拿到平台记录，再保存 Key

  const newKey = $('f-apikey').value.trim();
  let keyError = '';
  if (provider && newKey) {
    const r = await window.api.setKey(id, newKey);
    if (!r.ok) keyError = r.error || '保存 Key 失败';
  }
  $('f-apikey').value = '';
  closeModal();
  if (keyError) alert(`⚠ API Key 未保存：\n${keyError}`);
  else if (provider && newKey) refreshOne(id);
}

/* ---------------- 刷新 ---------------- */
async function refreshOne(id) {
  if (busy.has(id)) return;
  busy.add(id); renderAll();
  try { await window.api.fetchOne(id); } finally { busy.delete(id); renderAll(); }
}
async function refreshAll() {
  if (busy.has('*')) return;
  busy.add('*'); renderAll();
  try { await window.api.fetchAll(); } finally { busy.delete('*'); renderAll(); }
}

/* ---------------- 事件 ---------------- */
$('btn-add').addEventListener('click', () => openModal(null));
$('btn-refresh-all').addEventListener('click', refreshAll);
$('auto-refresh').addEventListener('change', (e) => window.api.setAutoRefresh(Number(e.target.value)));
$('modal-close').addEventListener('click', closeModal);
$('btn-cancel').addEventListener('click', closeModal);
$('modal-mask').addEventListener('click', (e) => { if (e.target === $('modal-mask')) closeModal(); });
$('platform-form').addEventListener('submit', submitForm);
$('btn-key-clear').addEventListener('click', async () => {
  if (!editingId || !confirm('确定清除该平台已保存的 API Key 吗？')) return;
  await window.api.clearKey(editingId);
  const p = data.platforms.find((x) => x.id === editingId);
  if (p) p.hasKey = false;
  updateProviderUi();
});
$('f-quota-enabled').addEventListener('change', (e) => {
  $('quota-fields').style.display = e.target.checked ? '' : 'none';
});

$('search-input').addEventListener('input', (e) => { keyword = e.target.value.trim(); renderGrid(); });

document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    filter = btn.dataset.filter;
    renderGrid();
  });
});

$('grid').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const id = btn.dataset.id;
  const p = data.platforms.find((x) => x.id === id);
  if (!p) return;
  if (btn.dataset.act === 'edit') openModal(p);
  else if (btn.dataset.act === 'refresh') refreshOne(id);
  else if (btn.dataset.act === 'del') {
    if (confirm(`确定删除「${p.name}」吗？此操作不可撤销（已保存的 API Key 也会一并删除）。`)) {
      data.platforms = data.platforms.filter((x) => x.id !== id);
      await persist();
      renderAll();
    }
  }
});

/* ---------------- 数据 ---------------- */
window.api.onDataChanged((d) => { data = d; renderAll(); });

(async function init() {
  providers = await window.api.listProviders();
  initProviderSelect();
  initTemplates();
  initColorPresets();
  data = await window.api.getData();
  renderAll();
  // 每 60 秒刷新倒计时类文本
  setInterval(renderAll, 60000);
})();
