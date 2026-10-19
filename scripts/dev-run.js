// 开发/CI 用：在无显示器环境（xvfb）里启动应用并打印日志。用法见 README「开发」一节。
const { app } = require('electron');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('no-zygote'); // 本沙箱环境需要；普通桌面无需
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('use-gl', 'angle');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
process.env.AITIME_DEBUG = '1';
require('../main.js');
setTimeout(() => app.quit(), Number(process.env.RUN_MS || 8000));
