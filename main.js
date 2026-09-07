// cc-notify-center 主进程
// 职责:HTTP 接收 CC Stop hook 的通知 POST → 持久化 JSONL → 广播给渲染层
//      托盘常驻、Alt+Q 全局热键、窗口位置记忆、单实例锁
// 闭环语义:条目离开列表即闭环(手动点击/被同会话新通知顶替/全部清理),记录到 done.jsonl 供统计
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 39129;
const DATA_DIR = path.join(__dirname, 'data');
const NOTIFY_FILE = path.join(DATA_DIR, 'notifications.jsonl'); // 全量流水(统计用,只追加)
const DONE_FILE = path.join(DATA_DIR, 'done.jsonl');            // 闭环记录:{"id","session_id","closed_at","reason"}
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');          // 窗口位置记忆
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');            // 任务记录:[{id,type,title,content,created_at}]

let mainWindow = null;
let tray = null;
let notifications = []; // [{id, ts, project, prompt, session_id}]
let doneSet = new Set();
let tasks = [];         // 任务记录:今日(today)在前,长期(longterm)在后
let saveTimer = null;

// ---------- 任务记录 ----------
function loadTasks() {
  try {
    tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
    if (!Array.isArray(tasks)) tasks = [];
  } catch { tasks = []; }
}

function saveTasks() {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 1));
}

// ---------- 持久化 ----------
function loadDone() {
  try {
    const text = fs.readFileSync(DONE_FILE, 'utf8');
    text.split('\n').filter(Boolean).forEach((line) => {
      try { doneSet.add(JSON.parse(line).id); } catch { /* 坏行跳过 */ }
    });
  } catch { /* 首次运行无文件 */ }
}

function loadNotifications() {
  try {
    const text = fs.readFileSync(NOTIFY_FILE, 'utf8');
    notifications = text.split('\n').filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter((n) => n && n.id && !doneSet.has(n.id));
  } catch { /* 首次运行无文件 */ }
}

function appendNotification(n) {
  fs.appendFileSync(NOTIFY_FILE, JSON.stringify(n) + '\n');
}

// 闭环记录:reason = 'click' | 'replace' | 'clear'
function appendDone(id, sessionId, reason) {
  const rec = { id, session_id: sessionId || '', closed_at: new Date().toISOString(), reason: reason || 'click' };
  fs.appendFileSync(DONE_FILE, JSON.stringify(rec) + '\n');
  doneSet.add(id);
  return rec;
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return null; }
}

function saveConfig() {
  if (!mainWindow) return;
  const b = mainWindow.getBounds();
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* 首次无文件 */ }
  cfg.x = b.x; cfg.y = b.y; cfg.width = b.width; cfg.height = b.height;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg));
}

function queueSaveConfig() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveConfig, 500);
}

// 路径规范化:Windows 路径大小写不敏感、斜杠方向可能不同(D:\ vs d:/)
// 同一项目的不同会话可能传不同写法的路径——统一后再比较,否则顶替失效、配色不一致
function normalizeProject(p) {
  return (p || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

// ---------- 统计(渲染层空状态展示) ----------
function getStats() {
  const stats = { today_items: 0, today_sessions: 0, week_items: 0, has_closed: false };
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = (now.getDay() + 6) % 7; // 周一 = 0
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
    const todaySessions = new Set();
    let total = 0;
    const text = fs.readFileSync(DONE_FILE, 'utf8');
    text.split('\n').filter(Boolean).forEach((line) => {
      try {
        const r = JSON.parse(line);
        total++;
        const t = new Date(r.closed_at);
        if (t >= startOfDay) {
          stats.today_items++;
          if (r.session_id) todaySessions.add(r.session_id);
        }
        if (t >= startOfWeek) stats.week_items++;
      } catch { /* 坏行跳过 */ }
    });
    stats.today_sessions = todaySessions.size;
    stats.has_closed = total > 0;
  } catch { /* 无文件 */ }
  return stats;
}

// ---------- HTTP 接收(hook 的 POST) ----------
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/notify') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const n = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ts: data.ts || new Date().toISOString(),
          project: data.project || '(未知项目)',
          prompt: data.prompt || '(no prompt)',
          session_id: data.session_id || '',
        };
        // 同一项目 + 同一会话:旧条目闭环('replace'),新条目顶替
        const replacedIds = [];
        notifications = notifications.filter((x) => {
          if (n.session_id && x.session_id === n.session_id && normalizeProject(x.project) === normalizeProject(n.project)) {
            appendDone(x.id, x.session_id, 'replace');
            replacedIds.push(x.id);
            return false;
          }
          return true;
        });
        appendNotification(n);
        notifications.push(n);
        updateTray();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('notification', n, replacedIds);
        }
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      } catch {
        res.writeHead(400);
        res.end('bad json');
      }
    });
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
  } else if (req.method === 'GET' && req.url === '/api/state') {
    // 调试/自检接口
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ unread: notifications, stats: getStats(), tasks, trash_count: tasks.filter((t) => t.deleted_at).length }));
  } else if (req.method === 'GET' && req.url === '/debug/dom') {
    // 调试:读取渲染层实时 DOM 中的通知条目(诊断"顶替未生效"用)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(
        "[...document.querySelectorAll('#list .item')].map(e => ({id: e.dataset.id, session: (e.dataset.session||'').slice(0,8), prompt: e.querySelector('.prompt') ? e.querySelector('.prompt').textContent.slice(0,20) : ''}))"
      ).then((items) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(items));
      }).catch((err) => {
        res.writeHead(500);
        res.end(String(err));
      });
    } else {
      res.writeHead(503);
      res.end('no window');
    }
  } else if (req.method === 'GET' && new URL(req.url, 'http://x').pathname === '/debug/win') {
    // 调试:窗口边界 + 全部显示器信息 + 当前匹配屏(多屏贴靠诊断用)
    // 可选 ?snap=<mode> 程序化触发贴靠并返回落点(多屏回归验证用)
    const url = new URL(req.url, 'http://x');
    const snapMode = url.searchParams.get('snap');
    let snapped = null;
    if (snapMode) snapped = doSnap(snapMode);
    const displays = screen.getAllDisplays().map((d) => ({
      id: d.id,
      primary: d.id === screen.getPrimaryDisplay().id,
      bounds: d.bounds,
      workArea: d.workArea,
    }));
    const b = mainWindow.getBounds();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      bounds: b,
      snapped: snapped,
      matchedDisplay: screen.getDisplayMatching(b).id,
      displays,
    }));
  } else if (req.method === 'POST' && req.url === '/debug/win') {
    // 调试:程序化移动/缩放窗口 {x,y,width,height}
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const b = JSON.parse(body);
        mainWindow.setBounds(b);
        res.writeHead(200);
        res.end('ok');
      } catch {
        res.writeHead(400);
        res.end('bad json');
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

// ---------- IPC(渲染层请求) ----------
ipcMain.on('mark-done', (_e, id) => {
  const hit = notifications.find((n) => n.id === id);
  appendDone(id, hit ? hit.session_id : '', 'click');
  notifications = notifications.filter((n) => n.id !== id);
  updateTray();
});

ipcMain.on('clear-all', () => {
  notifications.forEach((n) => appendDone(n.id, n.session_id, 'clear'));
  notifications = [];
  updateTray();
});

ipcMain.handle('get-notifications', () => notifications);
ipcMain.handle('get-stats', () => getStats());

// ---------- 窗口贴靠(6 种落位,由悬浮菜单选择;相对浮窗当前所在屏幕) ----------
function doSnap(mode) {
  if (!mainWindow) return null;
  // 多屏:按浮窗当前所在屏幕计算(取与窗口重叠面积最大的显示器),而非主屏
  const display = screen.getDisplayMatching(mainWindow.getBounds());
  const wa = display.workArea; // 排除任务栏的工作区
  const halfW = Math.floor(wa.width / 2);
  const halfH = Math.floor(wa.height / 2);
  const map = {
    left: { x: wa.x, y: wa.y, width: halfW, height: wa.height },
    right: { x: wa.x + halfW, y: wa.y, width: wa.width - halfW, height: wa.height },
    top: { x: wa.x, y: wa.y, width: wa.width, height: halfH },
    bottom: { x: wa.x, y: wa.y + halfH, width: wa.width, height: wa.height - halfH },
    tl: { x: wa.x, y: wa.y, width: halfW, height: halfH },
    tr: { x: wa.x + halfW, y: wa.y, width: wa.width - halfW, height: halfH },
    bl: { x: wa.x, y: wa.y + halfH, width: halfW, height: wa.height - halfH },
    br: { x: wa.x + halfW, y: wa.y + halfH, width: wa.width - halfW, height: wa.height - halfH },
  };
  if (map[mode]) {
    mainWindow.setBounds(map[mode]);
    queueSaveConfig();
  }
  return map[mode] || null;
}

ipcMain.on('snap-window', (_e, mode) => doSnap(mode));

// ---------- 置顶开关 ----------
ipcMain.handle('get-always-top', () => (mainWindow ? mainWindow.isAlwaysOnTop() : true));
ipcMain.handle('toggle-always-top', () => {
  const next = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(next, next ? 'floating' : 'normal');
  // 持久化(与位置字段合并写入)
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* 首次无文件 */ }
  cfg.always_on_top = next;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg));
  return next;
});

// ---------- 任务记录 IPC ----------
ipcMain.handle('tasks:get', () => tasks.filter((t) => !t.deleted_at));

ipcMain.handle('tasks:add', (_e, { type, title, content }) => {
  const t = {
    id: `t${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: type === 'longterm' ? 'longterm' : 'today',
    title: String(title || '').trim() || '(无标题)',
    content: String(content || ''),
    created_at: new Date().toISOString(),
  };
  tasks.push(t);
  saveTasks();
  return t;
});

ipcMain.handle('tasks:update', (_e, { id, title, content }) => {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  if (title !== undefined) t.title = String(title).trim() || '(无标题)';
  if (content !== undefined) t.content = String(content);
  saveTasks();
  return t;
});

// 删除进回收站:只打 deleted_at 标记,不物理删(可恢复)
ipcMain.handle('tasks:delete', (_e, id) => {
  const t = tasks.find((x) => x.id === id);
  if (!t) return false;
  t.deleted_at = new Date().toISOString();
  saveTasks();
  return true;
});

ipcMain.handle('tasks:restore', (_e, id) => {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  delete t.deleted_at;
  saveTasks();
  return t;
});

ipcMain.handle('tasks:get-trash', () => {
  return tasks
    .filter((t) => t.deleted_at)
    .sort((a, b) => b.deleted_at.localeCompare(a.deleted_at)); // 最近删除在前
});

// 彻底删除:物理移除,不可恢复(渲染层有 confirm 前置)
ipcMain.handle('tasks:purge', (_e, id) => {
  tasks = tasks.filter((x) => x.id !== id);
  saveTasks();
  return true;
});

// 拖拽落点:渲染层把两个区的最终 DOM 顺序发来([{id,type}],今日区在前),主进程照此重排+改类型
// 每个区内保证:未完成在前、已完成沉底(completed_at 有值视为已完成)
ipcMain.handle('tasks:reorder', (_e, order) => {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const buckets = {
    today: { active: [], done: [] },
    longterm: { active: [], done: [] },
  };
  for (const o of order || []) {
    const t = byId.get(o.id);
    if (!t) continue;
    t.type = o.type === 'longterm' ? 'longterm' : 'today';
    (t.completed_at ? buckets[t.type].done : buckets[t.type].active).push(t);
    byId.delete(o.id);
  }
  const next = [
    ...buckets.today.active, ...buckets.today.done,
    ...buckets.longterm.active, ...buckets.longterm.done,
  ];
  for (const t of byId.values()) next.push(t); // 兜底:不在 DOM 中的(已删除等)排最后
  tasks = next;
  saveTasks();
  return true;
});

// 完成/恢复:completed_at 时间戳即完成状态
ipcMain.handle('tasks:set-complete', (_e, { id, completed }) => {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  if (completed) {
    if (!t.completed_at) t.completed_at = new Date().toISOString();
  } else {
    delete t.completed_at;
  }
  saveTasks();
  return t;
});

// ---------- 托盘 ----------
function createTray() {
  const icon = nativeImageEmpty();
  tray = new Tray(icon);
  updateTray();
  tray.on('click', toggleWindow);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示/隐藏', click: toggleWindow },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));
}

function nativeImageEmpty() {
  const { nativeImage } = require('electron');
  return nativeImage.createEmpty();
}

function updateTray() {
  if (!tray) return;
  const unread = notifications.length;
  tray.setToolTip(`Claude Code 通知浮窗 — ${unread} 条未处理`);
}

// ---------- 窗口 ----------
function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createWindow() {
  const cfg = loadConfig() || {};
  // 双栏布局最低宽度:旧配置(单栏 460)或缺失时用新默认值
  if (!cfg.width || cfg.width < 780) cfg.width = 880;
  if (!cfg.height || cfg.height < 560) cfg.height = 620;
  // 置顶状态记忆(默认置顶,兼容旧配置)
  const alwaysTop = cfg.always_on_top !== false;
  mainWindow = new BrowserWindow({
    width: cfg.width,
    height: cfg.height,
    x: cfg.x,
    y: cfg.y,
    minWidth: 720,
    minHeight: 480,
    frame: false,
    resizable: true,
    alwaysOnTop: alwaysTop,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.setAlwaysOnTop(alwaysTop, alwaysTop ? 'floating' : 'normal');
  mainWindow.loadFile('renderer.html');

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('moved', queueSaveConfig);
  mainWindow.on('resized', queueSaveConfig);
}

// ---------- 生命周期 ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    loadDone();
    loadNotifications();
    loadTasks();

    const ok = globalShortcut.register('Alt+Q', toggleWindow);
    if (!ok) console.warn('[cc-notify-center] Alt+Q 热键注册失败(可能被其他程序占用)');

    createWindow();
    createTray();
    updateTray();

    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[cc-notify-center] 监听 http://127.0.0.1:${PORT}/notify`);
    });
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    server.close();
  });
}
