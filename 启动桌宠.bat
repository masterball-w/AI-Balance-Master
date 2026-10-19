@echo off
chcp 65001 >nul
title AI余额管理大师
cd /d "%~dp0"
rem 清除 IDE 注入的 ELECTRON_RUN_AS_NODE，确保 Electron 以图形模式启动
set ELECTRON_RUN_AS_NODE=
if not exist node_modules (
  echo 首次运行，正在安装依赖（使用国内镜像，约 1 分钟）...
  set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
  call npm install --registry=https://registry.npmmirror.com
)
echo 正在启动 AI余额管理大师 ...
call npx electron .
