/**
 * AI余额管理大师 · 桌宠渲染进程
 * 交互：悬停展开动效+到期气泡 / 点击打开管理器 / 拖动移动 / 透明像素点击穿透 / 右键菜单；形象为 VRM 3D 模型（失败则回退 SVG 猫娘）
 */
const petStage = document.getElementById('pet-stage');
const bubbleEl = document.getElementById('bubble');
const bubbleItems = document.getElementById('bubble-items');
const bubbleFooter = document.getElementById('bubble-footer');
const alertBadge = document.getElementById('alert-badge');
const particlesEl = document.getElementById('particles');

let data = { platforms: [] };
let hovering = false;
let bubbleTimer = null;      // 气泡自动收起（防 hover 状态卡死的兜底）
let passState = null;        // 鼠标穿透状态缓存，避免 IPC 洪水
let particlesSpawned = false;

/* ---------------- 日期 / 额度工具 ---------------- */
function daysLeft(dateStr) {
  if (!dateStr) return Infinity;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  if (isNaN(target)) return Infinity;
  return Math.round((target - now) / 86400000);
}
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${Number(m)}月${Number(d)}日`;
}
function quotaCountdown(resetAt) {
  if (!resetAt) return '';
  const diff = new Date(resetAt).getTime() - Date.now();
  if (isNaN(diff)) return '';
  if (diff <= 0) return '已重置';
  const mins = Math.ceil(diff / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}时${m}分后重置`;
  return `${m}分钟后重置`;
}

/* ---------------- 渲染气泡 ---------------- */
/**
 * 选出气泡里展示的最多 3 个平台：
 * 已知到期日的按剩余天数从近到远排在前面；不足 3 个时，用已有真实数据（接口/手动余额）的平台补齐。
 * 没有任何数据的平台不凑数。
 */
function pickBubblePlatforms(list, topN = 3) {
  const known = list
    .filter((p) => p.expiryDate)
    .map((p) => ({ ...p, _days: daysLeft(p.expiryDate) }))
    .filter((p) => p._days !== Infinity)
    .sort((a, b) => a._days - b._days);
  const picked = known.slice(0, topN);
  if (picked.length < topN) {
    const ids = new Set(picked.map((p) => p.id));
    const withData = list
      .filter((p) => !ids.has(p.id) && (Shared.balanceInfo(p).kind !== 'none' || Shared.quotaKnown(p)))
      .map((p) => ({ ...p, _days: Infinity }));
    picked.push(...withData.slice(0, topN - picked.length));
  }
  return picked;
}

function renderBubble() {
  const list = data.platforms || [];
  const items = pickBubblePlatforms(list);
  bubbleItems.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'b-empty';
    empty.textContent = `余额 / 5h 限额 / 到期日：${Shared.NA}`;
    bubbleItems.appendChild(empty);
    bubbleFooter.innerHTML = '点我打开管理器，填写 API Key 或手动记录吧～';
    return;
  }

  for (const p of items) {
    const known = p._days !== Infinity;
    const urgent = known && p._days <= 3;
    const item = document.createElement('div');
    item.className = 'b-item' + (urgent ? ' urgent' : '');

    const daysCls = !known ? 'd-none' : p._days <= 3 ? 'd-danger' : p._days <= 7 ? 'd-warn' : 'd-ok';
    const daysText = !known ? Shared.NA : p._days < 0 ? `逾期${-p._days}天` : p._days === 0 ? '今天到期' : `${p._days}天`;

    const bal = Shared.balanceInfo(p);
    const metaBits = [];
    metaBits.push(`<span>⏳ ${known ? fmtDate(p.expiryDate) + ' 到期' : '到期日 <i class="b-na">' + Shared.NA + '</i>'}</span>`);
    metaBits.push(bal.kind === 'none'
      ? `<span>余额 <i class="b-na">${Shared.NA}</i></span>`
      : `<span class="b-balance">余额 ${escapeHtml(Shared.fmtNum(bal.value))}${escapeHtml(bal.unit ? ' ' + bal.unit : '')}${bal.kind === 'stale' ? '（上次）' : ''}</span>`);
    if (Shared.quotaKnown(p)) {
      const used = Number(p.quota.used) || 0, total = Number(p.quota.total);
      const pct = Math.max(0, Math.min(100, Math.round((used / total) * 100)));
      metaBits.push(`<span>5h限额 ${used}/${total}${quotaCountdown(p.quota.resetAt) ? ' · ' + quotaCountdown(p.quota.resetAt) : ''}</span>`);
      metaBits.push(`<div class="b-quota"><i style="width:${pct}%"></i></div>`);
    } else {
      metaBits.push(`<span>5h限额 <i class="b-na">${Shared.NA}</i></span>`);
    }
    if (p.fetch && p.fetch.status === 'error') metaBits.push(`<span class="b-fail">获取失败</span>`);
    if (p.autoRenew === true) metaBits.push(`<span style="color:#2b9e60;">自动续订</span>`);

    item.innerHTML = `
      <span class="b-dot" style="background:${escapeHtml(p.color || '#ff8fab')}"></span>
      <div class="b-main">
        <div class="b-name-row">
          <span class="b-name">${escapeHtml(p.name || '未命名')}</span>
          <span class="b-days ${daysCls}">${daysText}</span>
        </div>
        <div class="b-meta">${metaBits.join('')}</div>
      </div>`;
    bubbleItems.appendChild(item);
  }

  const first = items[0];
  if (first._days === Infinity) {
    bubbleFooter.innerHTML = `📝 还没有到期日期，点我去管理器补充，避免额度悄悄过期～`;
    return;
  }
  const minDays = first._days;
  if (minDays <= 3) {
    bubbleFooter.innerHTML = minDays < 0
      ? `❗ <strong>${escapeHtml(first.name)}</strong> 已逾期，余额可能被回收，尽快处理！`
      : `🚨 <strong>${escapeHtml(first.name)}</strong> ${minDays === 0 ? '今天' : minDays + ' 天内'}到期，尽快用完余额！`;
  } else if (minDays <= 7) {
    bubbleFooter.innerHTML = `⏳ 最近一周内有套餐到期，记得安排好用量哦～`;
  } else {
    bubbleFooter.innerHTML = `✨ 一切正常，最近到期还有 ${minDays} 天`;
  }
}

function renderBadge() {
  const urgent = (data.platforms || []).some((p) => {
    const d = daysLeft(p.expiryDate);
    return d !== Infinity && d <= 3;
  });
  alertBadge.classList.toggle('hidden', !urgent);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- 气泡显隐 ---------------- */
function showBubble() {
  renderBubble();
  bubbleEl.classList.add('show');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubbleEl.classList.remove('show'), 30000); // 兜底自动收起
}
function hideBubble() {
  clearTimeout(bubbleTimer);
  bubbleEl.classList.remove('show');
}

/* ---------------- 粒子 ---------------- */
function spawnParticles() {
  if (particlesSpawned) return;
  particlesSpawned = true;
  const symbols = ['💖', '✨', '💗', '⭐', '💫'];
  for (let i = 0; i < 6; i++) {
    const el = document.createElement('span');
    el.className = 'particle';
    el.textContent = symbols[i % symbols.length];
    el.style.left = `${18 + Math.random() * 64}%`;
    el.style.top = `${28 + Math.random() * 34}%`;
    el.style.animationDelay = `${i * 0.09}s`;
    el.style.fontSize = `${12 + Math.random() * 8}px`;
    particlesEl.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }
  setTimeout(() => { particlesSpawned = false; }, 1600);
}

/* ---------------- 悬停 / 穿透 / 拖动 / 点击 ---------------- */
let vrmCtl = null;           // VRM 控制器（加载失败则为 null，走 SVG 兜底）
const petCanvas = document.getElementById('pet-canvas');
let hoverOffTimer = null;

function setPass(pass) {
  if (passState === pass) return;
  passState = pass;
  window.api.setMousePass(pass);
}
function setHover(on) {
  if (on) { clearTimeout(hoverOffTimer); hoverOffTimer = null; }
  if (hovering === on) return;
  hovering = on;
  petStage.classList.toggle('hover', on);
  if (vrmCtl) vrmCtl.setHover(on);
  if (on) { if (!vrmCtl) spawnParticles(); showBubble(); }
  else hideBubble();
}
/** 离开角色后留 250ms 缓冲：从角色移向气泡会穿过透明像素，避免气泡闪退 */
function setHoverOffSoon() {
  if (!hovering || hoverOffTimer) return;
  hoverOffTimer = setTimeout(() => { hoverOffTimer = null; setHover(false); }, 250);
}

/** 鼠标是否落在「可交互」像素上：气泡 / 警告徽章 / 角色不透明像素（透明区域一律点击穿透） */
function isOnUI(e) {
  const t = e.target;
  if (!t || !t.closest) return false;
  if (t.closest('.bubble.show') || t.closest('#alert-badge:not(.hidden)')) return true;
  if (vrmCtl) return t === petCanvas && vrmCtl.hitTest(e.clientX, e.clientY);
  return !!t.closest('.pet-stage');
}

let dragging = false;
let lastX = 0, lastY = 0, movedDist = 0;

document.addEventListener('mousemove', (e) => {
  const onUI = dragging || isOnUI(e);
  setPass(!onUI);
  if (onUI) setHover(true);
  else setHoverOffSoon();

  if (dragging) {
    const dx = e.screenX - lastX;
    const dy = e.screenY - lastY;
    if (dx || dy) {
      window.api.movePet(dx, dy);
      movedDist += Math.abs(dx) + Math.abs(dy);
      lastX = e.screenX;
      lastY = e.screenY;
    }
  }
});

document.addEventListener('mouseleave', () => {
  setPass(true);
  setHover(false);
  endDrag();
});

function endDrag() {
  dragging = false;
  if (vrmCtl) vrmCtl.setDragging(false);
}

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (e.target.closest && e.target.closest('#alert-badge')) return;
  if (!isOnUI(e) || (e.target.closest && e.target.closest('.bubble'))) return;
  dragging = true;
  movedDist = 0;
  lastX = e.screenX;
  lastY = e.screenY;
  if (vrmCtl) vrmCtl.setDragging(true);
});
document.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  if (dragging && movedDist < 6) { // 视为点击
    if (vrmCtl) vrmCtl.click();
    window.api.openManager();
  }
  endDrag();
});

document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (isOnUI(e)) window.api.petContextMenu();
});
alertBadge.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  if (e.button === 0) showBubble();
});

/* ---------------- VRM 形象 ---------------- */
async function loadVrm(forceDefault) {
  if (typeof VrmPet === 'undefined') throw new Error('VRM 渲染库未加载');
  const buf = await window.api.getPetModel(forceDefault);
  if (!buf) throw new Error('读取模型文件失败');
  return VrmPet.create({ canvas: petCanvas, buffer: buf, fit: 0.72 });
}
async function initVrm() {
  try {
    try {
      vrmCtl = await loadVrm(false);
    } catch (err) {
      // 自定义模型失败 → 先退回内置默认 VRM，再不行才用 SVG 兜底
      console.error('[pet] 模型加载失败，尝试内置默认形象：', err && err.message ? err.message : err);
      vrmCtl = await loadVrm(true);
    }
    vrmCtl.resize();
    petStage.classList.add('vrm-ready');
    const m = vrmCtl.meta || {};
    console.log('[pet] VRM 已加载:', m.name || m.title || '(未命名)');
  } catch (err) {
    vrmCtl = null;
    console.error('[pet] VRM 加载失败，使用 SVG 猫娘兜底：', err && err.message ? err.message : err);
    petStage.classList.add('fallback');
  }
}
initVrm();
// 全局鼠标位置（相对窗口左上角，CSS 像素）→ 头部/视线跟随；只注册一次，避免重复监听
window.api.onCursor((p) => {
  if (!vrmCtl || !p) return;
  if (typeof p.x === 'number' && vrmCtl.setCursor) vrmCtl.setCursor(p.x, p.y);
  else if (typeof p.nx === 'number') vrmCtl.setLook(p.nx, p.ny);
});

/* ---------------- 数据加载 ---------------- */
async function refresh(render) {
  data = await window.api.getData();
  if (render) { renderBubble(); renderBadge(); }
  else renderBadge();
  if (bubbleEl.classList.contains('show')) renderBubble();
}

window.api.onDataChanged((d) => {
  data = d;
  renderBadge();
  if (bubbleEl.classList.contains('show')) renderBubble();
});

refresh(true);

// 每 30 秒刷新一次 5h 限额倒计时
setInterval(() => {
  if (bubbleEl.classList.contains('show')) renderBubble();
}, 30000);
