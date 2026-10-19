/**
 * 预加载脚本：向渲染进程暴露安全 IPC 接口
 * 注意：API Key 只能「写入」，渲染进程永远读不到（只会看到 hasKey 布尔值）。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 数据
  getData: () => ipcRenderer.invoke('data:get'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  onDataChanged: (cb) => ipcRenderer.on('data-changed', (_e, data) => cb(data)),

  // 余额获取（官方接口，在主进程执行）
  listProviders: () => ipcRenderer.invoke('providers:list'),
  setKey: (id, key) => ipcRenderer.invoke('key:set', id, key),
  clearKey: (id) => ipcRenderer.invoke('key:clear', id),
  fetchOne: (id) => ipcRenderer.invoke('fetch:one', id),
  fetchAll: () => ipcRenderer.invoke('fetch:all'),
  setAutoRefresh: (minutes) => ipcRenderer.invoke('settings:set-auto-refresh', minutes),

  // 桌宠窗口
  movePet: (dx, dy) => ipcRenderer.send('pet:move', dx, dy),
  setMousePass: (pass) => ipcRenderer.send('pet:mouse-pass', pass),
  petContextMenu: () => ipcRenderer.send('pet:context-menu'),
  getPetModel: (forceDefault) => ipcRenderer.invoke('pet:get-model', !!forceDefault),
  onCursor: (cb) => ipcRenderer.on('pet:cursor', (_e, p) => cb(p)),

  // 应用
  openManager: () => ipcRenderer.send('app:open-manager'),
  quitApp: () => ipcRenderer.send('app:quit'),
});
