// 渲染层安全桥
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onNotification: (cb) => ipcRenderer.on('notification', (_e, n, replacedIds) => cb(n, replacedIds)),
  getNotifications: () => ipcRenderer.invoke('get-notifications'),
  getStats: () => ipcRenderer.invoke('get-stats'),
  markDone: (id) => ipcRenderer.send('mark-done', id),
  clearAll: () => ipcRenderer.send('clear-all'),
  // 任务记录
  getTasks: () => ipcRenderer.invoke('tasks:get'),
  addTask: (t) => ipcRenderer.invoke('tasks:add', t),
  updateTask: (t) => ipcRenderer.invoke('tasks:update', t),
  setComplete: (p) => ipcRenderer.invoke('tasks:set-complete', p),
  duplicateTask: (id) => ipcRenderer.invoke('tasks:duplicate', id),
  deleteTask: (id) => ipcRenderer.invoke('tasks:delete', id),
  restoreTask: (id) => ipcRenderer.invoke('tasks:restore', id),
  getTrash: () => ipcRenderer.invoke('tasks:get-trash'),
  purgeTask: (id) => ipcRenderer.invoke('tasks:purge', id),
  reorderTasks: (order) => ipcRenderer.invoke('tasks:reorder', order),
  snapWindow: (mode) => ipcRenderer.send('snap-window', mode),
  chooseSound: () => ipcRenderer.invoke('sound:choose'),
  importSound: (p) => ipcRenderer.invoke('sound:import', p),
  readSoundFile: (p) => ipcRenderer.invoke('sound:read', p),
  saveSoundClip: (payload) => ipcRenderer.invoke('sound:save-clip', payload),
  getAlwaysTop: () => ipcRenderer.invoke('get-always-top'),
  toggleAlwaysTop: () => ipcRenderer.invoke('toggle-always-top'),
});
