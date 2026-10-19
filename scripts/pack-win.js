// 打包 Windows x64 便携版：out/AI余额管理大师-win32-x64/ 并压缩为 out/AI-Balance-Master-v<版本>-win32-x64.zip
// 用法：npm run pack:win （国内网络可设置 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/）
// 注意：未做代码签名；可在 Linux/macOS 上交叉打包，无需 wine（仅便携 zip，不含安装器）。
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { packager } = require('@electron/packager');
const pkg = require('../package.json');
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'out');

const INCLUDE = new Set(['main.js', 'preload.js', 'package.json', 'lib', 'src', 'LICENSE', 'THIRD_PARTY_LICENSES.md', 'ASSETS_LICENSE.md']);

(async () => {
  const [appPath] = await packager({
    dir: root,
    out: outDir,
    name: pkg.productName,
    platform: 'win32',
    arch: 'x64',
    overwrite: true,
    asar: true,
    prune: false,
    // 只打包运行所需文件；剔除 node_modules / 文档 / 测试 / 脚本 / VRM 渲染器源码（已打成 src/vendor 的 bundle）
    ignore: (file) => {
      if (!file) return false;
      const rel = file.replace(/^\//, '');
      const top = rel.split('/')[0];
      if (!INCLUDE.has(top)) return true;
      if (rel.startsWith('src/vrm-src')) return true;
      return false;
    },
    download: process.env.ELECTRON_MIRROR ? { mirrorOptions: { mirror: process.env.ELECTRON_MIRROR } } : undefined,
  });
  const zip = path.join(outDir, `AI-Balance-Master-v${pkg.version}-win32-x64.zip`);
  fs.rmSync(zip, { force: true });
  const dirName = path.basename(appPath);
  const tryRun = (cmd, args) => { try { execFileSync(cmd, args, { cwd: outDir, stdio: 'inherit' }); return true; } catch { return false; } };
  const ok = tryRun('zip', ['-r', '-q', '-9', zip, dirName])
    || tryRun('python3', ['-m', 'zipfile', '-c', zip, dirName])
    || tryRun('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${dirName}' -DestinationPath '${zip}' -Force`]);
  if (!ok) throw new Error('压缩失败：需要 zip、python3 或 PowerShell 之一');
  console.log('✔ built', zip, (fs.statSync(zip).size / 1048576).toFixed(1) + ' MB');
})().catch((e) => { console.error(e); process.exit(1); });
