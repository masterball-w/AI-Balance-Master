/**
 * 视线/头部跟随方向自检（headless）。
 * 用法：AITIME_USER_DATA=$(mktemp -d) xvfb-run -a -s "-screen 0 1600x1000x24" npx electron scripts/check-gaze.js [额外 VRM 文件...]
 * 通过主进程同款 pet:cursor 通道（模拟全局鼠标位置换算为窗口相对坐标）喂入头部上/下/左/右、头与腰之间等位置，
 * 断言头部骨骼世界朝向与视线目标往正确方向移动；并覆盖窗口移动/缩放、页面重载（换模型）后的情况。
 */
const { app, BrowserWindow, screen } = require('electron');
const fs = require('fs');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('no-zygote');
app.commandLine.appendSwitch('use-gl', 'angle');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
require('../main.js');

const extra = process.argv.slice(2).filter((f) => f.endsWith('.vrm'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (n) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith(n));
const js = (w, c) => w.webContents.executeJavaScript(c);
let fails = 0;
const check = (name, ok, t = '') => { if (!ok) fails++; console.log(`[check] ${ok ? 'PASS' : 'FAIL'} ${name} ${t}`); };

async function waitReady(pet) {
  for (let i = 0; i < 200; i++) {
    if (await js(pet, "typeof vrmCtl !== 'undefined' && !!vrmCtl && document.getElementById('pet-stage').classList.contains('vrm-ready')").catch(() => false)) return;
    await sleep(150);
  }
  throw new Error('VRM 未加载');
}
// 头部屏幕坐标、头部世界朝向（骨骼局部 +Z）、视线目标相对头部的偏移；页面内连续采样 8 次取平均（抵消待机点头/摇摆）
const probe = (pet) => js(pet, `(async () => {
  const T = vrmCtl.vrm.humanoid.getNormalizedBoneNode('head');
  const V = T.position.constructor, Q = T.quaternion.constructor;
  const acc = { f: [0, 0, 0], lt: [0, 0, 0], hx: 0, hy: 0 };
  for (let i = 0; i < 8; i++) {
    const p = new V(); T.getWorldPosition(p);
    const q = new Q(); T.getWorldQuaternion(q);
    const f = new V(0, 0, 1).applyQuaternion(q);
    const lt = vrmCtl.vrm.lookAt.target.position;
    const hs = vrmCtl.headScreen();
    [f.x, f.y, f.z].forEach((v, j) => acc.f[j] += v / 8);
    [lt.x - p.x, lt.y - p.y, lt.z - p.z].forEach((v, j) => acc.lt[j] += v / 8);
    acc.hx += hs.x / 8; acc.hy += hs.y / 8;
    await new Promise((r) => setTimeout(r, 80));
  }
  return { hs: { x: acc.hx, y: acc.hy }, f: acc.f, lt: acc.lt, ver: String(vrmCtl.meta.metaVersion) };
})()`);

async function feed(pet, sx, sy) {
  const b = pet.getBounds();
  pet.webContents.send('pet:cursor', { x: sx - b.x, y: sy - b.y }); // 与 main.js startCursorTracking 相同换算
  await sleep(1200); // 阻尼收敛
  return probe(pet);
}

async function suite(pet, label) {
  await waitReady(pet); await sleep(800);
  const b = pet.getBounds();
  const n0 = await probe(pet);
  const hx = b.x + n0.hs.x, hy = b.y + n0.hs.y;
  const neutral = await feed(pet, hx, hy);
  const s = neutral.f[2] >= 0 ? 1 : -1; // VRM0/VRM1 骨骼局部 +Z 可能背向镜头，统一成“面向镜头为正”
  const F = (r) => r.f.map((v) => v * s);
  const N = F(neutral);
  const waist = b.y + b.height * 0.72; // 旧实现的竖直基准（腰部）
  const cases = [
    ['鼠标在头部正上方', hx, hy - 250, (f, r) => f[1] - N[1] > 0.03 && r.lt[1] > 0.05],
    ['鼠标在头部正下方（远）', hx, hy + 400, (f, r) => f[1] - N[1] < -0.03 && r.lt[1] < -0.05],
    ['鼠标在屏幕右侧（观众右手边）', hx + 300, hy, (f, r) => f[0] - N[0] > 0.05 && r.lt[0] > 0.05],
    ['鼠标在屏幕左侧', hx - 300, hy, (f, r) => f[0] - N[0] < -0.05 && r.lt[0] < -0.05],
  ];
  // 旧实现以腰部为基准：鼠标在头下方但在腰上方时会误判为“在上方”而抬头
  if (hy + 100 < waist) cases.splice(2, 0, ['鼠标在头部下方、腰部上方（旧 bug 区）', hx, hy + 100, (f, r) => f[1] - N[1] < -0.02 && r.lt[1] < -0.05]);
  else console.log(`[info] [${label}] 头部离腰部基准太近，跳过“头与腰之间”用例`);
  for (const [name, x, y, ok] of cases) {
    const r = await feed(pet, x, y);
    const f = F(r);
    check(`[${label}] ${name}`, ok(f, r), `head=(${r.hs.x.toFixed(0)},${r.hs.y.toFixed(0)}) fwdΔ=(${(f[0] - N[0]).toFixed(3)},${(f[1] - N[1]).toFixed(3)}) look=(${r.lt.map((v) => v.toFixed(2)).join(',')}) vrm${r.ver}`);
  }
  await feed(pet, hx, hy);
}

app.whenReady().then(async () => {
  try {
    let pet; for (let i = 0; i < 100 && !pet; i++) { pet = find('pet.html'); await sleep(100); }
    await suite(pet, '默认模型');
    const wa = screen.getPrimaryDisplay().workArea;
    pet.setBounds({ x: wa.x + 100, y: wa.y + 20, width: 320, height: 660 }); await sleep(500);
    await suite(pet, '移动窗口后');
    pet.setBounds({ x: wa.x + 700, y: wa.y + 200, width: 400, height: 760 }); await sleep(800);
    await suite(pet, '缩放窗口后');
    pet.webContents.reload(); await sleep(500);
    await suite(pet, '重载页面（换模型/恢复默认）后');
    for (const f of extra) {
      const b64 = fs.readFileSync(f).toString('base64');
      await js(pet, `(async () => { const s = atob(${JSON.stringify(b64)}); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
        vrmCtl.dispose(); vrmCtl = await VrmPet.create({ canvas: petCanvas, buffer: u.buffer, fit: 0.72 }); vrmCtl.resize(); })()`);
      await suite(pet, f.split('/').pop());
    }
  } catch (e) { fails++; console.error('[error]', e); }
  console.log(fails ? `[result] FAIL ${fails}` : '[result] ALL PASS');
  app.exit(fails ? 1 : 0);
});
