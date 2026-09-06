// cc-notify-center 渲染层
// 条目列表(最新在最下方)/ 项目配色 / 同项目同会话顶替 / hover 完整 prompt(保留换行)
// 点击条目=闭环消失 / 全部清理 / 空状态:烟花 + 激励语 + 统计 / 通知音效
const list = document.getElementById('list');
const tooltip = document.getElementById('tooltip');
const badge = document.getElementById('unread-badge');
const emptyPlain = document.getElementById('empty-plain');
const emptyState = document.getElementById('empty-state');
const praiseEl = document.getElementById('praise');
const statsEl = document.getElementById('stats');
const audio = new Audio('assets/notify.wav');

const PRAISES = [
  '全部闭环!今天的你又推进了不少 🎉',
  '通知清零——问题闭环,节奏到位!',
  '所有条目已处理,可以安心休息了 ✨',
  '闭环即成长,今天也是高效的一天!',
  '齐活!剩下的交给明天的你。',
];

// ---------- 工具 ----------
function fmtTime(iso) {
  const d = new Date(iso);
  const hms = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return hms;
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hms}`;
}

// 路径规范化:Windows 路径不区分大小写,斜杠方向也可能不同(D:\ vs d:/)
// 同一项目的不同会话可能传 D:\xxx 或 d:/xxx——统一小写+正斜杠,保证配色/顶替判断一致
function normalizeProject(p) {
  return (p || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

// 项目路径 → 色相(用归一化路径,同项目恒同色)
function projectHue(project) {
  const key = normalizeProject(project);
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return h;
}

// 显示用路径:盘符统一大写、斜杠统一反斜杠(其余字符保持原始,如项目名大小写)
// 同一项目的不同会话可能传 d:\ 或 D:/——显示也要一致
function displayProject(p) {
  return (p || '').replace(/^[a-zA-Z]:/, (m) => m.toUpperCase()).replace(/\//g, '\\');
}

function updateBadge() {
  const n = list.querySelectorAll('.item:not(.removing)').length;
  badge.textContent = String(n);
  badge.classList.toggle('hidden', n === 0);
}

// 空状态:有闭环历史 → 烟花+激励+统计;纯首次 → "暂无通知"
async function updateEmpty() {
  const hasItems = list.querySelectorAll('.item:not(.removing)').length > 0;
  if (hasItems) {
    emptyPlain.classList.add('hidden');
    emptyState.classList.add('hidden');
    return;
  }
  const stats = await window.api.getStats();
  if (stats.has_closed) {
    praiseEl.textContent = PRAISES[Math.floor(Math.random() * PRAISES.length)];
    statsEl.innerHTML =
      `<div class="stat-line">今天已闭环 ${stats.today_items} 个问题</div>` +
      `<div class="stat-line">本周已闭环 ${stats.week_items} 个问题</div>`;
    emptyPlain.classList.add('hidden');
    emptyState.classList.remove('hidden');
  } else {
    emptyPlain.classList.remove('hidden');
    emptyState.classList.add('hidden');
  }
}

// ---------- 手绘烟花 SVG ----------
function makeFirework(cx, cy, petals, len, colors) {
  let out = '';
  for (let i = 0; i < petals; i++) {
    const angle = (Math.PI * 2 * i) / petals + (Math.random() - 0.5) * 0.35;
    const bend = (Math.random() - 0.5) * 20;
    const tipX = cx + Math.cos(angle) * len;
    const tipY = cy + Math.sin(angle) * len;
    const midX = cx + Math.cos(angle) * len * 0.55 + bend * Math.sin(angle);
    const midY = cy + Math.sin(angle) * len * 0.55 - bend * Math.cos(angle);
    const color = colors[i % colors.length];
    out += `<path d="M${cx.toFixed(1)} ${cy.toFixed(1)} Q${midX.toFixed(1)} ${midY.toFixed(1)} ${tipX.toFixed(1)} ${tipY.toFixed(1)}" stroke="${color}" stroke-width="${(1.2 + Math.random() * 1.2).toFixed(1)}" fill="none" stroke-linecap="round"/>`;
    out += `<circle cx="${tipX.toFixed(1)}" cy="${tipY.toFixed(1)}" r="${(1.5 + Math.random() * 2).toFixed(1)}" fill="${color}" opacity="${(0.5 + Math.random() * 0.5).toFixed(2)}"/>`;
  }
  out += `<circle cx="${cx}" cy="${cy}" r="3" fill="#ffd76e"/>`;
  return `<g class="fw">${out}</g>`;
}

function initFireworks() {
  document.getElementById('fireworks').innerHTML = [
    makeFirework(95, 175, 9, 46, ['#ff8fb3', '#ffb36e', '#ffd76e', '#ff8fb3']),
    makeFirework(340, 70, 11, 52, ['#7ec8ff', '#a78bff', '#7ec8ff', '#9ff0c8']),
    makeFirework(300, 195, 7, 34, ['#9ff0c8', '#ffe88a', '#9ff0c8', '#ffb36e']),
  ].join('');
}

// ---------- hover tooltip(仅截断时显示,保留换行) ----------
function positionTooltip(x, y) {
  const r = tooltip.getBoundingClientRect();
  let tx = x + 14;
  let ty = y + 14;
  if (tx + r.width > window.innerWidth) tx = Math.max(4, x - r.width - 14);
  if (ty + r.height > window.innerHeight) ty = Math.max(4, y - r.height - 14);
  tooltip.style.left = tx + 'px';
  tooltip.style.top = ty + 'px';
}

function hideTooltip() { tooltip.classList.remove('visible'); }

// tooltip 可交互:鼠标可移入 tooltip 滚动查看全文,不消失
let hideTimer = null;
function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideTooltip, 250); // 留时间让鼠标移到 tooltip 上
}
function cancelHide() { clearTimeout(hideTimer); }

function bindPromptHover(promptEl, fullText) {
  promptEl.addEventListener('mouseenter', (e) => {
    if (promptEl.scrollWidth > promptEl.clientWidth + 4) {
      cancelHide();
      tooltip.textContent = fullText;
      tooltip.classList.add('visible');
      positionTooltip(e.clientX, e.clientY);
    }
  });
  promptEl.addEventListener('mousemove', (e) => {
    if (tooltip.classList.contains('visible')) positionTooltip(e.clientX, e.clientY);
  });
  promptEl.addEventListener('mouseleave', scheduleHide);
}

// tooltip 自身接管鼠标(滚动查看全文);移出后延迟隐藏
tooltip.addEventListener('mouseenter', cancelHide);
tooltip.addEventListener('mouseleave', scheduleHide);

// ---------- 条目 ----------
function removeItem(el, id) {
  el.classList.add('removing');
  setTimeout(() => {
    el.remove();
    updateBadge();
    updateEmpty();
    window.api.markDone(id); // 闭环:持久化标记(数据不物理删,统计仍可用)
  }, 220);
}

function addItem(n, replacedIds) {
  emptyPlain.classList.add('hidden');
  emptyState.classList.add('hidden');

  const pkey = normalizeProject(n.project);

  // 同一项目 + 同一会话顶替:移除旧条目(闭环由主进程记录;比较用归一化路径)
  if (n.session_id) {
    [...list.querySelectorAll('.item')].forEach((el) => {
      if (el.dataset.session === n.session_id && el.dataset.project === pkey) el.remove();
    });
  }
  if (replacedIds && replacedIds.length) {
    const ids = new Set(replacedIds);
    [...list.querySelectorAll('.item')].forEach((el) => {
      if (ids.has(el.dataset.id)) el.remove();
    });
  }

  const hue = projectHue(pkey);
  const color = `hsl(${hue} 65% 62%)`;

  const el = document.createElement('div');
  el.className = 'item';
  el.dataset.id = n.id;
  el.dataset.project = pkey;
  el.dataset.session = n.session_id || '';
  el.style.setProperty('--pcolor', color);

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = fmtTime(n.ts);
  time.title = new Date(n.ts).toLocaleString();

  const project = document.createElement('span');
  project.className = 'project';
  project.textContent = displayProject(n.project);
  project.title = displayProject(n.project);

  const promptEl = document.createElement('span');
  promptEl.className = 'prompt';
  promptEl.textContent = n.prompt;

  const btn = document.createElement('button');
  btn.className = 'done-btn';
  btn.textContent = '已处理';

  el.append(time, project, promptEl, btn);
  bindPromptHover(promptEl, n.prompt);

  // 闭环只能通过"已处理"按钮(用户反馈:点条目常误删)
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeItem(el, n.id);
  });

  list.append(el); // 最新的在最下方
  updateBadge();
  return el;
}

// ---------- 初始化 ----------
initFireworks();
window.api.getNotifications().then((items) => {
  items.forEach(addItem); // 数组为时间正序,append 即最新在下方
  updateBadge();
  updateEmpty();
});

window.api.onNotification((n, replacedIds) => {
  addItem(n, replacedIds);
  audio.play().catch(() => {}); // 需求:保留 Windows 系统弹窗音效
});

// ---------- 底部 ----------
document.getElementById('clear-all-btn').addEventListener('click', () => {
  const items = [...list.querySelectorAll('.item')];
  items.forEach((el) => el.classList.add('removing'));
  setTimeout(() => {
    items.forEach((el) => el.remove());
    updateBadge();
    updateEmpty();
    window.api.clearAll();
  }, 220);
});

// 隐藏按钮 → 关窗(主进程拦截为 hide)
document.getElementById('hide-btn').addEventListener('click', () => {
  window.close();
});

// ================= 任务记录面板 =================
const todayZone = document.getElementById('today-zone');
const longtermZone = document.getElementById('longterm-zone');
todayZone.dataset.empty = '今日暂无任务';
longtermZone.dataset.empty = '长期暂无任务';

let dragEl = null; // 正在拖拽的 .task-item

// ---------- 任务条目 ----------
// 区内归一化:已完成的条目永远沉底(完成/恢复/拖拽后都调用,保证不变式)
function normalizeZone(zone) {
  if (!zone) return;
  [...zone.querySelectorAll('.task-item.done')].forEach((el) => zone.append(el));
}

function renderTask(t) {
  const el = document.createElement('div');
  el.className = 'task-item';
  el.dataset.id = t.id;
  el.dataset.type = t.type;

  const row = document.createElement('div');
  row.className = 'task-row';

  const chev = document.createElement('button');
  chev.className = 'task-chev';
  chev.textContent = '▸';
  chev.title = '展开编辑';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'task-title';
  titleSpan.textContent = t.title;

  // 条目右侧直接删除(进回收站,可恢复,无需确认)
  const delRow = document.createElement('button');
  delRow.className = 'task-del-x';
  delRow.textContent = '✕';
  delRow.title = '删除(进回收站)';
  delRow.addEventListener('click', async (e) => {
    e.stopPropagation();
    el.remove();
    await window.api.deleteTask(t.id);
  });

  // 完成/恢复按钮:默认隐藏,悬浮条目变绿;完成后条目划线变暗沉底
  const doneBtn = document.createElement('button');
  doneBtn.className = 'task-done-btn';

  function applyDoneState() {
    const done = !!t.completed_at;
    el.classList.toggle('done', done);
    doneBtn.textContent = done ? '恢复' : '完成';
    doneBtn.title = done ? '恢复为未完成' : '标记已完成';
    row.draggable = !done; // 已完成条目锁定在底部,不可拖拽
  }

  doneBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const updated = await window.api.setComplete({ id: t.id, completed: !t.completed_at });
    if (!updated) return;
    t.completed_at = updated.completed_at;
    applyDoneState();
    normalizeZone(el.parentElement); // 完成即沉底
    persistOrderFromDOM();
  });

  row.append(chev, titleSpan, doneBtn, delRow);
  applyDoneState();

  // 展开编辑区
  const editor = document.createElement('div');
  editor.className = 'task-editor hidden';
  const titleInput = document.createElement('input');
  titleInput.className = 'task-edit-title';
  titleInput.value = t.title;
  const contentArea = document.createElement('textarea');
  contentArea.className = 'task-edit-content';
  contentArea.rows = 4;
  contentArea.value = t.content || '';
  const actions = document.createElement('div');
  actions.className = 'task-edit-actions';
  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = 'Ctrl+Enter 保存 · Esc 收起';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'task-save';
  saveBtn.textContent = '保存';
  actions.append(hint, saveBtn);
  editor.append(titleInput, contentArea, actions);

  function expand() {
    editor.classList.remove('hidden');
    chev.textContent = '▾';
    titleInput.focus();
  }
  function collapse() {
    editor.classList.add('hidden');
    chev.textContent = '▸';
  }
  function saveEdit() {
    const newTitle = titleInput.value.trim();
    if (!newTitle) return;
    t.title = newTitle;
    t.content = contentArea.value;
    window.api.updateTask({ id: t.id, title: t.title, content: t.content });
    titleSpan.textContent = t.title;
    collapse();
  }

  chev.addEventListener('click', () => {
    if (editor.classList.contains('hidden')) expand(); else collapse();
  });
  saveBtn.addEventListener('click', saveEdit);
  [titleInput, contentArea].forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); saveEdit(); }
      else if (e.key === 'Escape') { e.preventDefault(); collapse(); }
    });
  });

  // 悬浮显示标题+内容全部(需求 4;始终显示,内容为空则显示占位)
  titleSpan.addEventListener('mouseenter', (e) => {
    cancelHide();
    tooltip.innerHTML =
      `<div class="tt-title"></div>` +
      `<div class="tt-body${(t.content || '').trim() ? '' : ' empty'}"></div>`;
    tooltip.querySelector('.tt-title').textContent = t.title;
    tooltip.querySelector('.tt-body').textContent =
      (t.content || '').trim() || '(无具体内容)';
    tooltip.classList.add('visible');
    positionTooltip(e.clientX, e.clientY);
  });
  titleSpan.addEventListener('mousemove', (e) => {
    if (tooltip.classList.contains('visible')) positionTooltip(e.clientX, e.clientY);
  });
  titleSpan.addEventListener('mouseleave', scheduleHide);

  // ---------- 拖拽 ----------
  row.addEventListener('dragstart', (e) => {
    dragEl = el;
    el.classList.add('dragging');
    hideTooltip();
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', t.id); } catch { /* ignore */ }
  });
  row.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    clearDropMarks();
    dragEl = null;
  });

  el.append(row, editor);
  return el;
}

// ---------- 拖放落点与顺序持久化 ----------
function clearDropMarks() {
  document.querySelectorAll('.drop-above, .drop-below').forEach((n) => n.classList.remove('drop-above', 'drop-below'));
  document.querySelectorAll('.task-zone.drag-over').forEach((n) => n.classList.remove('drag-over'));
}

function zoneDragOver(e) {
  if (!dragEl) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDropMarks();
  e.currentTarget.classList.add('drag-over');
  // 找落点条目并标记上/下插入位置
  const items = [...e.currentTarget.querySelectorAll('.task-item:not(.dragging)')];
  for (const it of items) {
    const r = it.getBoundingClientRect();
    if (e.clientY < r.bottom) {
      it.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-above' : 'drop-below');
      break;
    }
  }
}

function zoneDrop(e) {
  if (!dragEl) return;
  e.preventDefault();
  const zone = e.currentTarget;
  const items = [...zone.querySelectorAll('.task-item:not(.dragging)')];
  let ref = null;
  let before = false;
  for (const it of items) {
    const r = it.getBoundingClientRect();
    if (e.clientY < r.bottom) {
      ref = it;
      before = e.clientY < r.top + r.height / 2;
      break;
    }
  }
  zone.insertBefore(dragEl, before ? ref : ref ? ref.nextSibling : null);
  dragEl.classList.remove('dragging');
  dragEl = null;
  clearDropMarks();
  persistOrderFromDOM();
}

function persistOrderFromDOM() {
  const order = [];
  [...todayZone.querySelectorAll('.task-item')].forEach((el) => order.push({ id: el.dataset.id, type: 'today' }));
  [...longtermZone.querySelectorAll('.task-item')].forEach((el) => order.push({ id: el.dataset.id, type: 'longterm' }));
  window.api.reorderTasks(order);
}

[todayZone, longtermZone].forEach((zone) => {
  zone.addEventListener('dragover', zoneDragOver);
  zone.addEventListener('drop', zoneDrop);
  zone.addEventListener('dragleave', (e) => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
  });
});

// ---------- 新增任务 ----------
const addForm = document.getElementById('add-task-form');
const newTitle = document.getElementById('new-task-title');
const newContent = document.getElementById('new-task-content');

function openAddForm() {
  addForm.classList.remove('hidden');
  newTitle.value = '';
  newContent.value = '';
  newTitle.focus();
}
function closeAddForm() { addForm.classList.add('hidden'); }

function saveNewTask() {
  const title = newTitle.value.trim();
  if (!title) { newTitle.focus(); return; }
  const type = addForm.querySelector('input[name="zone"]:checked').value;
  window.api.addTask({ type, title, content: newContent.value }).then((t) => {
    (t.type === 'longterm' ? longtermZone : todayZone).append(renderTask(t));
  });
  closeAddForm();
}

document.getElementById('add-task-btn').addEventListener('click', openAddForm);
document.getElementById('new-task-save').addEventListener('click', saveNewTask);
document.getElementById('new-task-cancel').addEventListener('click', closeAddForm);
[newTitle, newContent].forEach((input) => {
  input.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); saveNewTask(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeAddForm(); }
  });
});

// ---------- 初始化任务 ----------
window.api.getTasks().then((list) => {
  list.forEach((t) => {
    (t.type === 'longterm' ? longtermZone : todayZone).append(renderTask(t));
  });
  normalizeZone(todayZone);   // 已完成沉底
  normalizeZone(longtermZone);
});

// ---------- 回收站 ----------
const trashModal = document.getElementById('trash-modal');
const trashList = document.getElementById('trash-list');

function fmtDateTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function renderTrash() {
  const list = await window.api.getTrash();
  trashList.textContent = '';
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'trash-empty';
    empty.textContent = '回收站是空的';
    trashList.append(empty);
    return;
  }
  list.forEach((t) => {
    const entry = document.createElement('div');
    entry.className = 'trash-entry';

    const info = document.createElement('div');
    info.className = 'trash-info';
    const tt = document.createElement('div');
    tt.className = 'trash-title';
    // 语义标签:完成后才删除 = 完成(绿);直接删除 = 废弃(灰)
    const tag = document.createElement('span');
    tag.className = 'trash-tag ' + (t.completed_at ? 'done' : 'discard');
    tag.textContent = t.completed_at ? '完成' : '废弃';
    const ttText = document.createElement('span');
    ttText.className = 'trash-title-text';
    ttText.textContent = t.title;
    tt.append(tag, ttText);
    info.append(tt);
    if ((t.content || '').trim()) {
      const cc = document.createElement('div');
      cc.className = 'trash-content';
      cc.textContent = t.content;
      info.append(cc);
    }
    const meta = document.createElement('div');
    meta.className = 'trash-meta';
    meta.textContent = `删除于 ${fmtDateTime(t.deleted_at)}`;
    info.append(meta);

    // 悬浮显示标题+内容全部(与任务条目一致)
    info.addEventListener('mouseenter', (e) => {
      cancelHide();
      tooltip.innerHTML =
        `<div class="tt-title"></div>` +
        `<div class="tt-body${(t.content || '').trim() ? '' : ' empty'}"></div>`;
      tooltip.querySelector('.tt-title').textContent = t.title;
      tooltip.querySelector('.tt-body').textContent =
        (t.content || '').trim() || '(无具体内容)';
      tooltip.classList.add('visible');
      positionTooltip(e.clientX, e.clientY);
    });
    info.addEventListener('mousemove', (e) => {
      if (tooltip.classList.contains('visible')) positionTooltip(e.clientX, e.clientY);
    });
    info.addEventListener('mouseleave', scheduleHide);

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'trash-restore';
    restoreBtn.textContent = '恢复';
    restoreBtn.addEventListener('click', async () => {
      const restored = await window.api.restoreTask(t.id);
      if (restored) {
        const zone = restored.type === 'longterm' ? longtermZone : todayZone;
        zone.append(renderTask(restored));
        normalizeZone(zone); // 已完成的恢复后同样沉底
      }
      renderTrash(); // 重新渲染(处理空态占位)
    });

    const purgeBtn = document.createElement('button');
    purgeBtn.className = 'trash-purge';
    purgeBtn.textContent = '彻底删除';
    purgeBtn.addEventListener('click', async () => {
      if (!confirm('彻底删除后不可恢复,确定?')) return;
      await window.api.purgeTask(t.id);
      renderTrash();
    });

    const ops = document.createElement('div');
    ops.className = 'trash-ops';
    ops.append(restoreBtn, purgeBtn);

    entry.append(info, ops);
    trashList.append(entry);
  });
}

document.getElementById('trash-btn').addEventListener('click', () => {
  trashModal.classList.remove('hidden');
  renderTrash();
});
document.getElementById('trash-close').addEventListener('click', () => trashModal.classList.add('hidden'));
trashModal.addEventListener('click', (e) => {
  if (e.target === trashModal) trashModal.classList.add('hidden'); // 点背景关闭
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !trashModal.classList.contains('hidden')) {
    trashModal.classList.add('hidden');
  }
});

// ---------- 窗口贴靠(单按钮悬浮展开,Windows 11 风格) ----------
const snapWrap = document.getElementById('snap-wrap');
const snapFlyout = document.getElementById('snap-flyout');
let snapHideTimer = null;
function showSnapFlyout() { clearTimeout(snapHideTimer); snapFlyout.classList.remove('hidden'); }
function scheduleHideSnap() {
  clearTimeout(snapHideTimer);
  snapHideTimer = setTimeout(() => snapFlyout.classList.add('hidden'), 250);
}
snapWrap.addEventListener('mouseenter', showSnapFlyout);
snapWrap.addEventListener('mouseleave', scheduleHideSnap);
snapFlyout.querySelectorAll('.snap-opt').forEach((btn) => {
  btn.addEventListener('click', () => {
    window.api.snapWindow(btn.dataset.snap);
    snapFlyout.classList.add('hidden');
  });
});

// ---------- 置顶开关 ----------
const pinBtn = document.getElementById('pin-btn');
function setPinState(on) {
  pinBtn.classList.toggle('pinned', on);
  pinBtn.title = on ? '取消置顶(浮窗不再压住其它窗口)' : '置顶(浮窗压住其它窗口)';
}
window.api.getAlwaysTop().then(setPinState);
pinBtn.addEventListener('click', async () => {
  setPinState(await window.api.toggleAlwaysTop());
});
