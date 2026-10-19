/**
 * 生成 README 截图（docs/screenshots/*.png|gif）并做交互自检。
 * 用法（Linux/xvfb 示例）：
 *   AITIME_USER_DATA=/tmp/aitime-shots xvfb-run -a -s "-screen 0 1600x1000x24" npx electron scripts/capture-docs.js
 * 说明：
 *  - 使用隔离的临时用户数据目录，全部为默认「未获取」状态；
 *  - 「获取失败」截图用一个明显无效的占位 Key 去请求官方接口，得到的是真实的 401 错误提示，不涉及任何真实 Key。
 */
const { app, BrowserWindow, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('no-zygote');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('use-gl', 'angle');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
process.env.AITIME_DEBUG = '1';
process.env.AITIME_ALLOW_WEAK_KEYSTORE = '1'; // 仅截图：Linux 无钥匙串时允许演示用的占位 Key；正式运行不会设置

const OUT = process.env.SHOT_DIR || path.join(__dirname, '..', 'docs', 'screenshots');
const RAW = path.join(OUT, '_raw');
fs.mkdirSync(RAW, { recursive: true });
require('../main.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (name) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith(name));
const js = (w, code) => w.webContents.executeJavaScript(code);
const save = async (w, file, rect) => {
  const img = await w.webContents.capturePage(rect);
  fs.writeFileSync(path.join(RAW, file), img.toPNG());
  const s = img.getSize();
  console.log('[shot]', file, `${s.width}x${s.height}`);
};
const check = (name, ok, extra = '') => console.log(`[check] ${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`);

app.whenReady().then(async () => {
  try {
    if (process.platform === 'linux' && safeStorage.setUsePlainTextEncryption) safeStorage.setUsePlainTextEncryption(true); // 仅截图环境：无钥匙串的 Linux
    const pet = await (async () => { for (let i = 0; i < 100; i++) { const w = find('pet.html'); if (w) return w; await sleep(100); } })();
    const mgr = find('manager.html');
    // 等 VRM 加载
    for (let i = 0; i < 150; i++) {
      if (await js(pet, "document.getElementById('pet-stage').classList.contains('vrm-ready') || document.getElementById('pet-stage').classList.contains('fallback')")) break;
      await sleep(200);
    }
    const mode = await js(pet, "document.getElementById('pet-stage').className");
    check('pet 渲染模式为 VRM（非 SVG 兜底）', /vrm-ready/.test(mode), `class="${mode}"`);
    await sleep(1500);

    // ---- 命中检测：找一个角色身上的点 & 一个透明点 ----
    const pts = await js(pet, `(() => {
      const r = petCanvas.getBoundingClientRect(); let body = null, empty = null;
      for (let y = r.top + 40; y < r.bottom && !body; y += 6) for (let x = r.left; x < r.right; x += 6) { if (vrmCtl.hitTest(x, y)) { body = [x, y]; break; } }
      for (let y = r.top + 40; y < r.bottom && !empty; y += 20) { if (!vrmCtl.hitTest(r.left + 4, y)) empty = [r.left + 4, y]; }
      return { body, empty, w: innerWidth, h: innerHeight, canvas: [r.width, r.height] };
    })()`);
    console.log('[info]', JSON.stringify(pts));
    check('命中检测：能在角色上命中、在透明区域不命中', !!pts.body && !!pts.empty);

    const move = async (x, y) => { pet.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) }); await sleep(120); };
    await move(pts.empty[0], pts.empty[1]);
    check('透明区域：鼠标穿透开启，未悬停', (await js(pet, 'passState')) === true && !(await js(pet, "petStage.classList.contains('hover')")));
    await move(pts.body[0], pts.body[1]);
    check('角色身上：穿透关闭，进入悬停并展开气泡', (await js(pet, 'passState')) === false && (await js(pet, "petStage.classList.contains('hover') && bubbleEl.classList.contains('show')")));

    // ---- 截图：悬停 + 气泡（GIF 帧） ----
    await sleep(900);
    await save(pet, 'pet-hover.png');
    for (let i = 0; i < 14; i++) { await save(pet, `frame-${String(i).padStart(2, '0')}.png`); await sleep(110); }
    // 离开 → 待机
    await move(pts.empty[0], pts.empty[1]);
    await sleep(1200);
    check('离开后气泡收起', !(await js(pet, "bubbleEl.classList.contains('show')")));
    await save(pet, 'pet-idle.png');

    // ---- 版式自检（仅用于检查窗口尺寸，不写入 README）：临时注入「3 个即将到期」的演示数据看气泡是否放得下 ----
    await js(pet, `(() => { const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
      data = { platforms: [
        { id: 'a', name: 'DEMO-A', color: '#10a37f', expiryDate: d(2), balance: null, quota: { total: 10, used: 3, resetAt: new Date(Date.now() + 3600e3).toISOString() }, autoRenew: true },
        { id: 'b', name: 'DEMO-B', color: '#4285f4', expiryDate: d(6), balance: 12.3, unit: 'CNY', quota: null },
        { id: 'c', name: 'DEMO-C', color: '#d97757', expiryDate: d(20), balance: null, quota: null } ], settings: {} };
      showBubble(); })()`);
    await sleep(700);
    await save(pet, '_layout-test-3items.png');
    const bh = await js(pet, "JSON.stringify(bubbleEl.getBoundingClientRect())");
    console.log('[info] bubble rect (3 items, demo)', bh);
    await js(pet, 'refresh(true)');
    await sleep(300);

    // ---- 管理器：默认「未获取」状态 ----
    mgr.setSize(1180, 860);
    mgr.show();
    await sleep(800);
    await save(mgr, 'manager-default.png');

    // ---- 管理器：真实 401 错误示例（占位 Key，官方接口返回 401） ----
    const id = await js(mgr, "data.platforms.find(p => p.provider === 'deepseek').id");
    const r = await js(mgr, `window.api.setKey(${JSON.stringify(id)}, 'sk-demo-invalid-placeholder-key')`);
    check('safeStorage 写入占位 Key（截图环境）', r.ok, r.ok ? '' : r.error);
    if (r.ok) {
      const rr = await js(mgr, `window.api.fetchOne(${JSON.stringify(id)})`);
      console.log('[info] fetchOne ->', JSON.stringify(rr));
      await sleep(600);
      const d = await js(mgr, 'JSON.stringify(data.platforms.find(p => p.provider === "deepseek").fetch)');
      console.log('[info] fetch state', d);
      check('渲染进程拿不到 Key（只有 hasKey）', !(await js(mgr, 'JSON.stringify(data)')).includes('sk-demo'));
      await save(mgr, 'manager-fetch-error.png');
      // 编辑弹窗
      await js(mgr, "openModal(data.platforms.find(p => p.provider === 'deepseek'))");
      await sleep(500);
      await save(mgr, 'manager-edit.png');
    }
  } catch (e) {
    console.log('[capture] ERROR', e && e.stack ? e.stack : e);
  }
  setTimeout(() => process.exit(0), 300);
});
