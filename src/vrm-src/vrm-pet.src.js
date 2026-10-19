/**
 * VRM 桌宠渲染器（three.js + @pixiv/three-vrm）
 * 由 esbuild 打包为 src/vendor/vrm-pet.bundle.js（全局变量 VrmPet），运行时无需联网。
 * 所有动画均为程序化生成：待机呼吸/摇摆、眨眼、放下 T-pose 手臂、悬停开心 + 弹跳 + 挥手、头部/视线跟随鼠标、点击反馈。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const damp = THREE.MathUtils.damp;
const clamp = THREE.MathUtils.clamp;

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {ArrayBuffer} opts.buffer       VRM 文件内容
 * @param {number} [opts.fov]
 * @param {number} [opts.fit]             取景：1 = 全身，<1 = 只取上半身（0.6 约到大腿）
 * @param {string} [opts.baseUrl]
 */
export async function create(opts) {
  const { canvas, buffer } = opts;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true, // 允许随时 readPixels 做透明像素点击穿透检测
    powerPreference: 'low-power',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opts.fov || 24, 1, 0.1, 50);

  const key = new THREE.DirectionalLight(0xffffff, Math.PI * 0.95);
  key.position.set(0.6, 1.2, 1.4).normalize();
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffd9e8, Math.PI * 0.25);
  fill.position.set(-1, 0.2, 0.6).normalize();
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  // 加载 VRM
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await new Promise((resolve, reject) =>
    loader.parse(buffer, opts.baseUrl || '', resolve, reject));
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('文件不是有效的 VRM 模型');

  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  if (VRMUtils.combineSkeletons) VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm); // VRM0.x 模型转为面朝 +Z
  scene.add(vrm.scene);
  vrm.scene.traverse((o) => { o.frustumCulled = false; });

  // 视线目标
  const lookTarget = new THREE.Object3D();
  scene.add(lookTarget);
  if (vrm.lookAt) vrm.lookAt.target = lookTarget;

  const H = vrm.humanoid;
  const bone = (n) => H.getNormalizedBoneNode(n);
  const B = {
    hips: bone('hips'), spine: bone('spine'), chest: bone('chest'), upperChest: bone('upperChest'),
    neck: bone('neck'), head: bone('head'),
    lUA: bone('leftUpperArm'), rUA: bone('rightUpperArm'),
    lLA: bone('leftLowerArm'), rLA: bone('rightLowerArm'),
    lH: bone('leftHand'), rH: bone('rightHand'),
    lS: bone('leftShoulder'), rS: bone('rightShoulder'),
    lUL: bone('leftUpperLeg'), rUL: bone('rightUpperLeg'),
  };

  // 取景：用包围盒定位相机
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const fit = opts.fit || 1;
  const viewH = size.y * fit * 1.1;
  const topY = box.max.y + size.y * 0.06; // 留出挥手的头顶空间
  const camTargetY = topY - viewH / 2;
  const state = { aspect: 1 };
  function layoutCamera() {
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const distH = (viewH / 2) / Math.tan(vFov / 2);
    const viewW = size.x * 0.62; // 手臂放下后身体宽度约占 62% 的 T-pose 宽度
    const distW = (viewW / 2) / Math.tan(vFov / 2) / camera.aspect;
    const dist = Math.max(distH, distW);
    camera.position.set(center.x, camTargetY, center.z + dist);
    camera.lookAt(center.x, camTargetY, center.z);
  }
  function resize() {
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1.5), 2); // 至少 1.5 倍超采样，边缘更平滑
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    layoutCamera();
    canvasRect = null;
  }
  let canvasRect = null; // 缓存 canvas 在视口中的位置（resize 时失效）
  window.addEventListener('resize', () => { canvasRect = null; });
  resize();

  // 眨眼 / 表情
  const em = vrm.expressionManager;
  const hasExpr = (n) => !!(em && em.getExpression(n));
  const setExpr = (n, v) => { if (hasExpr(n)) em.setValue(n, v); };

  const S = {
    t: 0,
    hover: 0,          // 0..1 平滑
    hoverTarget: 0,
    drag: 0, dragTarget: 0,
    pulse: 0,          // 点击脉冲 1->0
    bounce: 0, bounceV: 0, // 弹跳弹簧
    blinkAt: 1.5, blinkT: -1,
    lookX: 0, lookY: 0, lookTX: 0, lookTY: 0,
    cursor: null,      // 鼠标位置（窗口 CSS 像素），null = 未知
    wave: 0,
  };

  const isV0 = String(vrm.meta && vrm.meta.metaVersion) === '0';
  const F = isV0 ? -1 : 1;
  const WAVE_Z = 0.75; // 挥手时上臂比水平线低 ~43°，前臂竖起：横向占用更少
  function rot(n, x, y, z) { if (n) n.rotation.set(F * x, y, F * z); }
  const restY = B.hips ? B.hips.position.y : 0;
  
  function bounceKick(v) { S.bounceV = Math.max(S.bounceV, v); }

  const LOOK_PX = 300; // 鼠标偏离头部 300px 视为最大转动
  const _hp = new THREE.Vector3(), _hs = new THREE.Vector3();
  /** 把头部骨骼的世界坐标投影到窗口 CSS 像素坐标 */
  function headScreen() {
    if (!canvasRect) canvasRect = canvas.getBoundingClientRect();
    const r = canvasRect;
    (B.head || vrm.scene).getWorldPosition(_hs);
    _hs.project(camera);
    return { x: r.left + (_hs.x + 1) / 2 * r.width, y: r.top + (1 - _hs.y) / 2 * r.height };
  }
  function updateLookFromCursor() {
    if (!S.cursor) return;
    const hp = headScreen();
    S.lookTX = clamp((S.cursor.x - hp.x) / LOOK_PX, -1, 1);
    S.lookTY = clamp((hp.y - S.cursor.y) / LOOK_PX, -1, 1); // 正 = 鼠标在头部上方
  }

  function animate(dt) {
    S.t += dt;
    updateLookFromCursor();
    const t = S.t;
    S.hover = damp(S.hover, S.hoverTarget, 8, dt);
    S.drag = damp(S.drag, S.dragTarget, 10, dt);
    S.pulse = Math.max(0, S.pulse - dt * 1.8);
    S.lookX = damp(S.lookX, S.lookTX, 6, dt);
    S.lookY = damp(S.lookY, S.lookTY, 6, dt);
    S.wave = damp(S.wave, S.hoverTarget ? 1 : 0, 6, dt);

    // 弹跳弹簧（位置 S.bounce，单位：米）
    const k = 180, c = 11;
    const acc = -k * S.bounce - c * S.bounceV;
    S.bounceV += acc * dt;
    S.bounce += S.bounceV * dt;
    if (S.bounce < 0) { S.bounce = 0; if (S.bounceV < 0) S.bounceV = -S.bounceV * 0.25; }

    const breath = Math.sin(t * 1.7);
    const sway = Math.sin(t * 0.7);
    const h = S.hover;

    // 身体：呼吸 + 摇摆 + 弹跳
    // 所有旋转按 VRM1 约定书写（模型面朝 +Z，角色左手在 +X）；VRM0 模型的归一化骨骼坐标系绕 Y 转了 180°，由 rot() 自动镜像 x/z。
    if (B.hips) {
      B.hips.position.y = restY + S.bounce + Math.sin(t * 1.7) * 0.003 + h * Math.abs(Math.sin(t * 5)) * 0.012;
      rot(B.hips, 0, Math.sin(t * 0.45) * 0.04 + S.lookX * 0.12, sway * 0.025 + Math.sin(t * 5) * 0.03 * h);
    }
    rot(B.spine, breath * 0.012 + S.drag * 0.05, 0, -sway * 0.02);
    rot(B.chest, breath * 0.02, 0, 0);
    rot(B.upperChest, breath * 0.012, 0, 0);

    // 头部：跟随鼠标 + 轻微点头
    // VRM1 约定下绕 X 轴正向旋转 = 低头（Rx(θ)·(0,0,1) = (0,-sinθ,cosθ)），故鼠标在上方（lookY>0）时取负 → 抬头
    const hx = -S.lookY * 0.28 + Math.sin(t * 1.1) * 0.015 - S.pulse * 0.1 + h * 0.06;
    const hy = S.lookX * 0.55 + Math.sin(t * 0.6) * 0.03;
    const hz = -S.lookX * 0.05 + Math.sin(t * 0.8) * 0.02 + h * Math.sin(t * 4) * 0.04;
    rot(B.neck, hx * 0.4, hy * 0.4, hz * 0.4);
    rot(B.head, hx * 0.6, hy * 0.6, hz * 0.6);

    // 手臂放下（T-pose → 自然下垂）。VRM1：左臂 z 取负为下垂，右臂取正
    const armDown = 1.22 + breath * 0.012;
    rot(B.lUA, 0.05, 0, -(armDown + Math.sin(t * 1.3) * 0.02 + h * 0.04));
    rot(B.lLA, 0, 0, -(0.12 + h * 0.1));
    rot(B.lS, 0, 0, -breath * 0.01);
    rot(B.rS, 0, 0, breath * 0.01);
    // 右手：悬停时挥手
    const w = S.wave;
    rot(B.rUA, 0.05 * (1 - w) - 0.25 * w, -0.35 * w, (armDown - (armDown - WAVE_Z) * w) + Math.sin(t * 1.3 + 1) * 0.02 * (1 - w));
    rot(B.rLA, 0, 0, 0.12 * (1 - w) - (1.45 + Math.sin(t * 9) * 0.4) * w);
    rot(B.rH, 0, 0, -Math.sin(t * 9) * 0.25 * w);

    // 腿稍微并拢
    rot(B.lUL, 0, 0, -0.02);
    rot(B.rUL, 0, 0, 0.02);

    // 表情 / 眨眼
    S.blinkAt -= dt;
    if (S.blinkAt <= 0 && S.blinkT < 0) { S.blinkT = 0; S.blinkAt = 2.2 + Math.random() * 3.5; if (Math.random() < 0.18) S.blinkAt = 0.35; }
    let blink = 0;
    if (S.blinkT >= 0) {
      S.blinkT += dt;
      const p = S.blinkT / 0.16;
      blink = p < 1 ? Math.sin(p * Math.PI) : 0;
      if (p >= 1) S.blinkT = -1;
    }
    const happy = clamp(h * 0.9 + S.pulse * 0.6, 0, 1);
    setExpr('happy', happy);
    setExpr('blink', blink * (1 - happy));

    // 视线
    // 视线：以头部世界坐标为基准，向镜头方向 0.9m，按鼠标方向偏移
    if (B.head) B.head.getWorldPosition(_hp); else _hp.set(center.x, box.max.y - size.y * 0.08, center.z);
    lookTarget.position.set(_hp.x + S.lookX * 0.6, _hp.y + S.lookY * 0.45, _hp.z + 0.9);

    vrm.update(dt);
  }

  // 渲染循环：待机 ~30fps，悬停/拖拽时 60fps
  let raf = 0, last = 0, running = true;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!running || document.hidden) return;
    const interval = (S.hoverTarget || S.dragTarget || S.pulse > 0 || Math.abs(S.bounceV) > 0.01) ? 0 : 1000 / 30;
    if (now - last < interval) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    animate(dt);
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);
  // 先渲染一帧避免空白
  animate(0.016); renderer.render(scene, camera);

  const gl = renderer.getContext();
  const px = new Uint8Array(4 * 25);
  return {
    meta: vrm.meta,
    renderer, scene, camera, vrm, state: S,
    resize,
    /** 是否点在了角色的不透明像素上（clientX/Y 为视口坐标） */
    hitTest(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;
      const sx = canvas.width / r.width, sy = canvas.height / r.height;
      const x = Math.floor((clientX - r.left) * sx), y = Math.floor(canvas.height - (clientY - r.top) * sy);
      const x0 = clamp(x - 2, 0, canvas.width - 5), y0 = clamp(y - 2, 0, canvas.height - 5);
      gl.readPixels(x0, y0, 5, 5, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 3; i < px.length; i += 4) if (px[i] > 24) return true;
      return false;
    },
    setHover(on) { S.hoverTarget = on ? 1 : 0; if (on) bounceKick(1.6); },
    setDragging(on) { S.dragTarget = on ? 1 : 0; },
    /** 鼠标位置：相对窗口左上角的 CSS 像素（y 向下），每帧按头部实际屏幕位置换算视线 */
    setCursor(x, y) { S.cursor = { x, y }; },
    /** 兼容旧接口：nx, ny ∈ [-1,1]，y 向下为正 */
    setLook(nx, ny) { S.cursor = null; S.lookTX = clamp(nx, -1, 1); S.lookTY = clamp(-ny, -1, 1); },
    /** 调试：头部在窗口中的屏幕坐标 */
    headScreen,
    click() { S.pulse = 1; bounceKick(1.3); },
    pause() { running = false; },
    resume() { running = true; },
    dispose() {
      cancelAnimationFrame(raf);
      VRMUtils.deepDispose(vrm.scene);
      renderer.dispose();
    },
  };
}
