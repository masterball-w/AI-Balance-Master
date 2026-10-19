// 重新打包 VRM 桌宠渲染器：three.js + @pixiv/three-vrm → src/vendor/vrm-pet.bundle.js
// 仅在修改 src/vrm-src/vrm-pet.src.js 后需要运行（npm run build:vrm）；仓库已提交打包产物，普通用户无需执行。
const path = require('path');
const esbuild = require('esbuild');
const root = path.join(__dirname, '..');
esbuild.build({
  entryPoints: [path.join(root, 'src/vrm-src/vrm-pet.src.js')],
  outfile: path.join(root, 'src/vendor/vrm-pet.bundle.js'),
  bundle: true, minify: true, format: 'iife', globalName: 'VrmPet', target: 'chrome130', legalComments: 'eof',
}).then(() => console.log('✔ built src/vendor/vrm-pet.bundle.js')).catch(() => process.exit(1));
