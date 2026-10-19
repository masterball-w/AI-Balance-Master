/**
 * AI余额管理大师 - 主进程
 * 双窗口：桌宠（透明置顶） + 管理器；JSON 数据持久化；托盘常驻；
 * 官方余额接口在主进程用 Node fetch 获取（避开 CORS）；API Key 用 safeStorage 加密保存。
 */
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, safeStorage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { fetchBalance, listProviders, PROVIDERS, FetchError } = require('./lib/providers');
const D = require('./lib/data');

let petWindow = null;
let managerWindow = null;
let tray = null;
let isQuitting = false;

// 自动化截图/测试用：可通过环境变量隔离用户数据目录（不影响正常使用）
if (process.env.AITIME_USER_DATA) app.setPath('userData', process.env.AITIME_USER_DATA);

const dataFile = () => path.join(app.getPath('userData'), 'ai-balances.json');
const keyFile = () => path.join(app.getPath('userData'), 'ai-keys.json');
const log = (...a) => console.log('[main]', ...a); // 注意：绝不要把 Key 传给 log

const DEFAULT_MODEL = path.join(__dirname, 'src', 'models', 'Victoria_Rubin.vrm');
const PET_SIZE = { width: 320, height: 660 };

/* ---------------- 像素猫娘托盘图标（运行时生成 PNG，零外部资源） ---------------- */
function crc32(buf) {
  if (!crc32.table) {
    crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32.table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crc32.table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
/** 16x16 像素画：粉色猫娘头 */
function makeCatIcon(scale = 2) {
  const PAL = {
    P: [255, 175, 198, 255], // 毛色粉
    D: [235, 120, 158, 255], // 描边深粉
    W: [255, 255, 255, 255],
    B: [70, 55, 95, 255],    // 眼
    R: [255, 130, 155, 200], // 腮红
    M: [230, 95, 125, 255],  // 嘴
    N: [255, 160, 175, 255], // 嘴内亮色
    '.': [0, 0, 0, 0],
  };
  const ART = [
    '................',
    '..DD........DD..',
    '.DPPD......DPPD.',
    '.DPPPDDDDDDPPPD.',
    '.DPPPPPPPPPPPPD.',
    'DPPPPPPPPPPPPPPD',
    'DPWWPPPPPPPPWWPD',
    'DPWBPPPPPPPPWBPD',
    'DPPPPPPPPPPPPPPD',
    'DPPRPPPPPPPPRPPD',
    'DPPPPPMNMPPPPPPD',
    '.DPPPPPPPPPPPPD.',
    '.DPPPPPPPPPPPPD.',
    '..DPPPPPPPPPPD..',
    '...DDPPPPPPDD...',
    '.....DDDDDD.....',
  ];
  const size = 16;
  const raw = [];
  for (let y = 0; y < size; y++) {
    raw.push(0);
    for (let x = 0; x < size; x++) raw.push(...(PAL[ART[y][x]] || [0, 0, 0, 0]));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.from(raw))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  const img = nativeImage.createFromBuffer(png);
  return scale === 1 ? img : img.resize({ width: size * scale, height: size * scale });
}

/* ---------------- 数据读写 + 迁移 ---------------- */
let cache = null; // 内存中的权威数据（含 fetch 结果，不含密钥）

function backupFile(suffix) {
  try {
    const dir = path.dirname(dataFile());
    let target = path.join(dir, `ai-balances.${suffix}.json`);
    if (fs.existsSync(target)) target = path.join(dir, `ai-balances.${suffix}-${Date.now()}.json`); // 不覆盖已有备份
    fs.copyFileSync(dataFile(), target);
    return target;
  } catch (e) {
    console.error('backup failed:', e.message);
    return null;
  }
}

function loadData() {
  if (cache) return cache;
  let raw = null;
  try { raw = fs.readFileSync(dataFile(), 'utf-8'); } catch { /* 不存在 */ }
  if (raw && raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const { data, action } = D.migrate(raw);
  if (action === 'migrated-v1') {
    const b = backupFile('backup-v1');
    log(`检测到旧版（含示例假数据）数据文件，已备份到 ${b}，并重新生成「未获取」的干净默认数据`);
  } else if (action === 'corrupt') {
    const b = backupFile('corrupt');
    log(`数据文件损坏，已备份到 ${b}，并重新生成默认数据`);
  }
  cache = data;
  if (action !== 'ok') saveData(cache);
  return cache;
}
function saveData(data) {
  cache = data;
  try {
    fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
    const tmp = dataFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, dataFile());
  } catch (e) {
    console.error('saveData failed:', e.message);
  }
}

/* ---------------- API Key：safeStorage 加密 ---------------- */
function readKeys() {
  try { return JSON.parse(fs.readFileSync(keyFile(), 'utf-8')) || {}; } catch { return {}; }
}
function writeKeys(obj) {
  fs.mkdirSync(path.dirname(keyFile()), { recursive: true });
  fs.writeFileSync(keyFile(), JSON.stringify(obj), { encoding: 'utf-8', mode: 0o600 });
}
/** 系统是否提供「真正」的加密存储（Windows DPAPI / macOS Keychain / Linux libsecret）。basic_text 只是明文级别的混淆，视为不可用。 */
function encryptionUsable() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
      const be = safeStorage.getSelectedStorageBackend();
      if ((be === 'basic_text' || be === 'unknown') && process.env.AITIME_ALLOW_WEAK_KEYSTORE !== '1') return false;
    }
    return true;
  } catch { return false; }
}
function setKey(id, key) {
  if (!encryptionUsable()) {
    return { ok: false, error: '当前系统没有可用的加密存储（safeStorage），为安全起见不会以明文保存 API Key。Windows 上通常可用；Linux 需先安装并解锁 gnome-keyring / kwallet。' };
  }
  const trimmed = String(key || '').trim();
  if (!trimmed) return { ok: false, error: 'Key 不能为空' };
  const keys = readKeys();
  keys[id] = safeStorage.encryptString(trimmed).toString('base64');
  writeKeys(keys);
  return { ok: true };
}
function getKey(id) {
  const enc = readKeys()[id];
  if (!enc) return null;
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return null; }
}
function clearKey(id) {
  const keys = readKeys();
  if (id in keys) { delete keys[id]; writeKeys(keys); }
}
const keyIdSet = () => new Set(Object.keys(readKeys()));

function viewData() { return D.sanitizeForRenderer(loadData(), keyIdSet()); }
function broadcastData() {
  const v = viewData();
  for (const w of [petWindow, managerWindow]) {
    if (w && !w.isDestroyed()) w.webContents.send('data-changed', v);
  }
}

/* ---------------- 余额获取 ---------------- */
const inflight = new Set();

async function refreshOne(id) {
  const data = loadData();
  const p = data.platforms.find((x) => x.id === id);
  if (!p) return { ok: false, error: '平台不存在' };
  if (!p.provider) return { ok: false, error: '该平台没有可用的官方余额接口，请手动填写' };
  if (inflight.has(id)) return { ok: false, error: '正在获取中…' };
  inflight.add(id);
  const now = new Date().toISOString();
  const prev = p.fetch && p.fetch.status === 'ok' ? p.fetch : null;
  try {
    const key = getKey(id);
    if (!key) throw new FetchError('nokey', '尚未配置 API Key');
    const r = await fetchBalance(p.provider, key);
    p.fetch = { status: 'ok', balance: r.balance, unit: r.unit, details: r.details, lastFetched: now, error: null };
  } catch (e) {
    const msg = e instanceof FetchError ? e.message : '获取失败（未知错误）';
    p.fetch = {
      status: e && e.code === 'nokey' ? 'never' : 'error',
      // 保留上一次「真实获取成功」的数值，仅用于参考，界面会标注为过期
      balance: prev ? prev.balance : null, unit: prev ? prev.unit : null, details: prev ? prev.details : [],
      lastFetched: prev ? prev.lastFetched : null, lastAttempt: now, error: msg,
    };
    log(`刷新失败 [${p.name}] ${e && e.code ? e.code : 'error'}`); // 不记录 Key 与响应内容
  } finally {
    inflight.delete(id);
  }
  saveData(data);
  broadcastData();
  return { ok: p.fetch.status === 'ok', error: p.fetch.error };
}

async function refreshAll() {
  const data = loadData();
  const ids = data.platforms.filter((p) => p.provider && keyIdSet().has(p.id)).map((p) => p.id);
  const results = await Promise.all(ids.map((id) => refreshOne(id)));
  return { total: ids.length, ok: results.filter((r) => r.ok).length };
}

let autoTimer = null;
function setupAutoRefresh() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  const min = loadData().settings.autoRefreshMinutes;
  if (min > 0) autoTimer = setInterval(() => { refreshAll().catch(() => {}); }, min * 60000);
}

/* ---------------- 窗口 ---------------- */
function ensureOnScreen(pos, size) {
  try {
    const displays = screen.getAllDisplays();
    const visible = displays.some((d) => {
      const wa = d.workArea;
      return pos.x + size.width > wa.x + 20 && pos.x < wa.x + wa.width - 20 &&
        pos.y + size.height > wa.y + 20 && pos.y < wa.y + wa.height - 20;
    });
    return visible ? pos : null;
  } catch {
    return null;
  }
}

function createPetWindow() {
  const size = { ...PET_SIZE };
  let pos = null;
  try {
    const sp = loadData().settings.petPosition;
    if (sp && typeof sp.x === 'number') {
      // 以窗口底边为锚点（窗口高度调整后，宠物脚下位置保持不变）
      const bottom = sp.y + (sp.height || size.height);
      pos = ensureOnScreen({ x: sp.x, y: bottom - size.height }, size);
    }
  } catch { /* ignore */ }
  if (!pos) {
    const wa = screen.getPrimaryDisplay().workArea;
    pos = { x: wa.x + wa.width - size.width - 24, y: wa.y + wa.height - size.height - 16 };
  }
  petWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  petWindow.setAlwaysOnTop(true, 'screen-saver');
  petWindow.loadFile(path.join(__dirname, 'src', 'pet.html'));
  petWindow.on('moved', savePetPosition);
  petWindow.on('closed', () => { petWindow = null; });
  petWindow.webContents.on('console-message', (_e, level, message) => {
    if (process.env.AITIME_DEBUG || level >= 2) console.log(`[pet:console:${level}]`, message);
  });
}
function savePetPosition() {
  if (!petWindow || petWindow.isDestroyed()) return;
  try {
    const data = loadData();
    data.settings.petPosition = petWindow.getBounds(); // x,y,width,height
    saveData(data);
  } catch { /* ignore */ }
}

function createManagerWindow() {
  managerWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 860,
    minHeight: 600,
    show: false,
    backgroundColor: '#fff5f8',
    icon: makeCatIcon(10),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  managerWindow.loadFile(path.join(__dirname, 'src', 'manager.html'));
  managerWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      managerWindow.hide();
    }
  });
  managerWindow.on('closed', () => { managerWindow = null; });
}

function showManager() {
  if (!managerWindow) createManagerWindow();
  if (managerWindow.isMinimized()) managerWindow.restore();
  managerWindow.show();
  managerWindow.focus();
}

function createTray() {
  tray = new Tray(makeCatIcon(2));
  tray.setToolTip('AI余额管理大师 - 双击打开管理器');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '📊 打开管理器', click: () => showManager() },
    { label: '🔄 刷新全部余额', click: () => { refreshAll().catch(() => {}); } },
    { label: '🎀 显示桌宠', click: () => { if (petWindow) petWindow.show(); } },
    { label: '💢 隐藏桌宠', click: () => { if (petWindow) petWindow.hide(); } },
    { type: 'separator' },
    { label: '❌ 退出', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => showManager());
}

/* ---------------- 桌宠形象（VRM） ---------------- */
function currentModelPath() {
  const custom = loadData().settings.petModelPath;
  if (custom && fs.existsSync(custom)) return custom;
  return DEFAULT_MODEL;
}
async function chooseModel() {
  const r = await dialog.showOpenDialog(petWindow || undefined, {
    title: '选择 VRM 形象文件（请确认你有权使用该模型）',
    filters: [{ name: 'VRM 模型', extensions: ['vrm'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return;
  const data = loadData();
  data.settings.petModelPath = r.filePaths[0];
  saveData(data);
  if (petWindow) petWindow.webContents.reload();
}
function resetModel() {
  const data = loadData();
  data.settings.petModelPath = null;
  saveData(data);
  if (petWindow) petWindow.webContents.reload();
}
function showModelCredits() {
  const custom = loadData().settings.petModelPath;
  const detail = custom
    ? `当前使用自定义模型：\n${custom}\n\n请自行确认该模型的授权允许你使用。\n\n内置默认形象：Victoria Rubin（VRoid Project / pixiv Inc.，CC0）。`
    : '模型：Victoria Rubin（β Ver AvatarSample_4）\n作者：VRoid Project（pixiv Inc.）\n许可：CC0 1.0（公有领域贡献）\n来源：https://vroid.pixiv.help/hc/en-us/articles/360014900233\n\n本项目对贴图做了缩小处理以减小体积。渲染：three.js（MIT）+ @pixiv/three-vrm（MIT）。';
  dialog.showMessageBox(petWindow || undefined, { type: 'info', title: '形象版权信息', message: '桌宠形象素材致谢', detail, buttons: ['好的'] });
}

function petContextMenu() {
  Menu.buildFromTemplate([
    { label: '📊 打开管理器', click: () => showManager() },
    { label: '🔄 刷新全部余额', click: () => { refreshAll().catch(() => {}); } },
    { label: '🎀 置顶桌宠', click: () => { if (petWindow) petWindow.setAlwaysOnTop(true, 'screen-saver'); } },
    { type: 'separator' },
    { label: '🖼 更换 VRM 形象…', click: () => { chooseModel().catch(() => {}); } },
    { label: '↩ 恢复默认形象', click: () => resetModel() },
    { label: 'ℹ️ 形象版权信息', click: () => showModelCredits() },
    { type: 'separator' },
    { label: '❌ 退出程序', click: () => { isQuitting = true; app.quit(); } },
  ]).popup({ window: petWindow });
}

/* 全局鼠标位置 → 桌宠头部/视线跟随（约 20Hz，仅在桌宠可见时发送） */
let cursorTimer = null;
function startCursorTracking() {
  let lx = null, ly = null;
  cursorTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return;
    const c = screen.getCursorScreenPoint();
    if (c.x === lx && c.y === ly) return;
    lx = c.x; ly = c.y;
    const b = petWindow.getBounds();
    const nx = (c.x - (b.x + b.width / 2)) / 420;
    const ny = (c.y - (b.y + b.height * 0.72)) / 420;
    petWindow.webContents.send('pet:cursor', { nx, ny });
  }, 50);
}

/* ---------------- IPC ---------------- */
ipcMain.handle('data:get', () => viewData());
ipcMain.handle('data:save', (e, incoming) => {
  if (!incoming || !Array.isArray(incoming.platforms)) return { ok: false };
  const cur = loadData();
  const next = D.mergeFromRenderer(cur, incoming, Object.keys(PROVIDERS));
  // 被删除的平台：同时清除其加密 Key
  const alive = new Set(next.platforms.map((p) => p.id));
  const keys = readKeys();
  let changed = false;
  for (const id of Object.keys(keys)) if (!alive.has(id)) { delete keys[id]; changed = true; }
  if (changed) writeKeys(keys);
  saveData(next);
  if (next.settings.autoRefreshMinutes !== cur.settings.autoRefreshMinutes) setupAutoRefresh();
  broadcastData();
  return { ok: true };
});
ipcMain.handle('providers:list', () => listProviders());
ipcMain.handle('key:set', (e, id, key) => {
  const r = setKey(String(id), key);
  if (r.ok) broadcastData();
  return r;
});
ipcMain.handle('key:clear', (e, id) => { clearKey(String(id)); broadcastData(); return { ok: true }; });
ipcMain.handle('fetch:one', (e, id) => refreshOne(String(id)));
ipcMain.handle('fetch:all', () => refreshAll());
ipcMain.handle('settings:set-auto-refresh', (e, minutes) => {
  const m = [0, 15, 30, 60].includes(minutes) ? minutes : 0;
  const data = loadData();
  data.settings.autoRefreshMinutes = m;
  saveData(data);
  setupAutoRefresh();
  broadcastData();
  return { ok: true };
});
ipcMain.handle('pet:get-model', (e, forceDefault) => {
  try {
    const buf = fs.readFileSync(forceDefault ? DEFAULT_MODEL : currentModelPath());
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch (e) {
    console.error('read model failed:', e.message);
    return null;
  }
});
ipcMain.on('pet:move', (e, dx, dy) => {
  if (!petWindow || petWindow.isDestroyed()) return;
  const b = petWindow.getBounds();
  petWindow.setPosition(Math.round(b.x + dx), Math.round(b.y + dy), false);
});
ipcMain.on('pet:mouse-pass', (e, pass) => {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.setIgnoreMouseEvents(!!pass, { forward: true });
});
ipcMain.on('app:open-manager', () => showManager());
ipcMain.on('app:quit', () => { isQuitting = true; app.quit(); });
ipcMain.on('pet:context-menu', () => petContextMenu());
ipcMain.on('dev:toggle', () => {
  const w = BrowserWindow.getFocusedWindow();
  if (w) w.webContents.toggleDevTools();
});

/* ---------------- 生命周期 ---------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showManager());

  app.whenReady().then(() => {
    app.setAppUserModelId('com.aitime.ai-balance-master');
    loadData(); // 触发迁移
    createPetWindow();
    createManagerWindow();
    createTray();
    startCursorTracking();
    setupAutoRefresh();
    if (loadData().settings.autoRefreshMinutes > 0) setTimeout(() => refreshAll().catch(() => {}), 5000);
    if (process.argv.includes('--show-manager')) showManager();
  });

  app.on('window-all-closed', () => {
    // 桌宠与管理器均关闭时仍驻留托盘；Windows 直接退出由托盘菜单控制
  });

  app.on('before-quit', () => {
    savePetPosition();
    isQuitting = true;
  });

  app.on('will-quit', () => {
    if (tray) tray.destroy();
    if (cursorTimer) clearInterval(cursorTimer);
  });

  // Windows 注销/关机时确保退出
  app.on('session-end', () => {
    isQuitting = true;
    app.exit(0);
  });
}
