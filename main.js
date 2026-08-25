// DeepSeek Harness 桌面封装（跨平台: macOS / Windows）
// - 无边框窗口(macOS) / 标准窗口(Windows)
// - 纯壳型: 只展示本机 dsh 服务, 改界面/插件无需重新封装
// - 启动时确保 dsh 服务运行 (detached 后台进程, 关 app 服务保留)
// - 补齐浏览器常用能力: Ctrl/Cmd+F 搜索 / 缩放 / 开发者工具 / 右键复制链接·保存图片
// - 记住上次窗口位置和大小
'use strict';

const { app, BrowserWindow, Menu, clipboard, ipcMain, shell, screen } = require('electron');
const { spawn, exec } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const URL = 'http://127.0.0.1:3080/';
const THEME_BG = '#2C2C2E';

// ---------- 跨平台路径/Node ----------
// DSH 服务代码目录: 默认 ~/deepseek-harness, 可用环境变量 DSH_DIR 覆盖
const DSH_DIR = process.env.DSH_DIR || path.join(os.homedir(), 'deepseek-harness');

// Node: 环境变量 NODE_BIN 优先; macOS 默认 Homebrew, 不存在则用 PATH 里的 node; Windows 用 PATH 里的 node
function resolveNode() {
  if (process.env.NODE_BIN) return process.env.NODE_BIN;
  if (process.platform === 'win32') return 'node';
  const homebrew = '/opt/homebrew/bin/node';
  return fs.existsSync(homebrew) ? homebrew : 'node';
}
const NODE_BIN = resolveNode();
const PRELOAD = path.join(__dirname, 'preload.js');

// 应用图标: Windows/Linux 窗口与任务栏用 icon.ico; macOS 无边框窗口不需要
// (打包成 .app 时由 electron-packager 的 --icon 换成 icon.icns)
const APP_ICON = path.join(__dirname, 'assets', 'icon.ico');

// ---------- 单实例锁 ----------
// 重复双击/启动时聚焦已有窗口, 而不是再开一个实例
// (之前没有锁, 连开几次会叠出多个 DSH 进程, 任务栏还容易显示成 Electron)
const gotSingleInstanceLock = app.requestSingleInstanceLock();
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// 应用显示名: 任务栏/跳转列表显示 "DeepSeek Harness" 而不是 Electron;
// 同时固定 userData 目录, 窗口状态文件位置保持不变 (%APPDATA%\dsh-desktop)
app.setName('DeepSeek Harness');
app.setPath('userData', path.join(app.getPath('appData'), 'dsh-desktop'));

// ---------- 窗口状态记忆（记住上次的位置和大小, 自动适配平台目录） ----------
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (s && typeof s.width === 'number' && s.width >= 800 && s.height >= 600 &&
        s.x !== undefined && s.y !== undefined) {
      const displays = screen.getAllDisplays();
      const visible = displays.some((d) => {
        const r = d.bounds;
        return s.x < r.x + r.width && s.x + s.width > r.x &&
               s.y < r.y + r.height && s.y + s.height > r.y;
      });
      if (visible) return s;
    }
  } catch (e) {}
  return null;
}

let __winSaveTimer = null;
function saveWindowState(win, immediate) {
  if (!win || win.isDestroyed()) return;
  const doWrite = () => {
    try {
      const b = win.getBounds();
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(b));
    } catch (e) {}
  };
  if (immediate) {
    clearTimeout(__winSaveTimer);
    doWrite();
  } else {
    clearTimeout(__winSaveTimer);
    __winSaveTimer = setTimeout(doWrite, 400);
  }
}

// ---------- 服务检测与启动 ----------
function checkServer() {
  return new Promise((resolve) => {
    const req = http.get(URL, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

function startServer() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (child, reason) => {
      if (settled) return;
      settled = true;
      if (!child) console.error('[dsh-desktop] 服务启动失败:', reason || '未知错误');
      resolve(child); // 成功返回 child(供 ensureServer 监听退出), 失败返回 null
    };
    let child;
    try {
      // --no-open: 服务由桌面版拉起时, 不再额外打开默认浏览器 (webui 就在本窗口里)
      child = spawn(NODE_BIN, ['apps/cli/lib/bin.js', 'web', '--no-open'], {
        cwd: DSH_DIR,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch (e) {
      done(null, e.message);
      return;
    }
    // spawn 是异步的: node 不存在 / DSH_DIR 无效会触发 'error' 事件,
    // 之前直接 resolve(true) 会让 ensureServer 白等 120 秒
    child.once('error', (err) => done(null, err.message));
    child.once('spawn', () => { child.unref(); done(child); });
    // 兜底: 10 秒内没有完成 spawn 按失败处理
    setTimeout(() => done(null, '启动超时'), 10000);
  });
}

async function ensureServer() {
  // 1) 服务已在跑 → 直接连
  if (await checkServer()) return true;
  // 2) 没在跑 → 自动后台启动服务 (detached, 关软件后服务保留)
  const child = await startServer();
  // 3) 启动本身失败 (node 不在 PATH / DSH_DIR 无效 / 入口缺失) → 不用再等
  if (!child) return false;
  // 4) 轮询等待端口就绪; 若服务进程提前退出(崩溃/端口被占)则快速失败
  let exited = false;
  child.once('exit', () => { exited = true; });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await checkServer()) return true;
    if (exited && i >= 4) return false; // 起来后 5 秒内就退出 = 起不来
  }
  return false;
}

// ---------- 页面内搜索 ----------
const FIND_BAR_JS = `
(() => {
  if (window.__dshFindBar) return;
  const bar = document.createElement('div');
  bar.innerHTML = '<input placeholder="查找…" style="flex:1;min-width:0;background:transparent;border:none;outline:none;color:inherit;font-size:13px"/>'
    + '<span data-count style="padding:0 6px;opacity:.7;font-size:12px"></span>'
    + '<button data-close style="background:none;border:none;color:inherit;cursor:pointer;font-size:14px;padding:0 4px">✕</button>';
  bar.style.cssText = 'position:fixed;top:8px;right:88px;z-index:2147483647;display:flex;align-items:center;gap:6px;'
    + 'background:#2C2C2E;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:6px 10px;'
    + 'box-shadow:0 4px 16px rgba(0,0,0,.4);font-family:system-ui,sans-serif;color:#fff;width:260px';
  document.body.appendChild(bar);
  const input = bar.querySelector('input');
  const close = bar.querySelector('[data-close]');
  const doFind = (forward) => {
    const text = input.value;
    if (!text) { window.dshShell && window.dshShell.stopFind(); document.querySelector('[data-count]').textContent = ''; return; }
    window.dshShell && window.dshShell.find(text, forward);
  };
  input.addEventListener('input', () => doFind(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doFind(!e.shiftKey); }
    if (e.key === 'Escape') { bar.remove(); window.__dshFindBar = false; window.dshShell && window.dshShell.stopFind(); }
  });
  close.addEventListener('click', () => { bar.remove(); window.__dshFindBar = false; window.dshShell && window.dshShell.stopFind(); });
  input.focus();
  window.__dshFindBar = true;
})()
`;

function setupFind(win) {
  win.webContents.executeJavaScript(FIND_BAR_JS).catch(() => {})
}

ipcMain.on('dsh-find', (event, { text, forward }) => {
  const wc = event.sender
  wc.findInPage(text, { forward })
})
ipcMain.on('dsh-find-stop', (event) => {
  event.sender.stopFindInPage('clearSelection')
})

// ---------- 主流程 ----------
// Windows: 固定 AppUserModelId, 任务栏/开始菜单才能正确显示应用图标并独立分组
// (不设置时 Electron 默认用 process.execPath, 图标会退回默认 Electron 图标)
if (process.platform === 'win32') {
  app.setAppUserModelId('com.deepseek.dsh-desktop');
}

app.whenReady().then(async () => {
  // 单实例: 拿不到锁说明已有实例在跑, 直接退出 (由 second-instance 把已有窗口拉起来)
  if (!gotSingleInstanceLock) {
    app.quit();
    return;
  }

  const savedWin = loadWindowState();
  const win = new BrowserWindow({
    width: savedWin ? savedWin.width : 1240,
    height: savedWin ? savedWin.height : 840,
    x: savedWin ? savedWin.x : undefined,
    y: savedWin ? savedWin.y : undefined,
    minWidth: 800,
    minHeight: 600,
    title: 'DeepSeek Harness',
    backgroundColor: THEME_BG,
    // Windows/Linux: 标准窗口 + 应用图标(窗口/任务栏不再显示默认 Electron 图标);
    // macOS: 无边框(隐藏标题栏, 保留红绿灯), 图标由打包时的 .icns 提供
    ...(process.platform !== 'darwin' ? { icon: APP_ICON } : {}),
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 12, y: 12 } } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: PRELOAD,
    },
  });

  // 窗口标题固定为应用名 (页面标题不再覆盖), 任务栏/Alt-Tab 显示稳定的 "DeepSeek Harness"
  win.on('page-title-updated', (e) => e.preventDefault());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('found-in-page', (_e, result) => {
    win.webContents.executeJavaScript(
      `(() => { const el = document.querySelector('[data-count]'); if (el) el.textContent = '${result.matches}'; })()`
    ).catch(() => {})
  });

  win.webContents.on('context-menu', (_event, params) => {
    const template = []
    if (params.linkURL) {
      template.push({ label: '复制链接地址', click: () => clipboard.writeText(params.linkURL) })
      template.push({ type: 'separator' })
    }
    if (params.mediaType === 'image') {
      template.push({
        label: '保存图片…',
        click: () => {
          const name = (params.srcURL.split('/').pop() || 'image') + '.png'
          win.webContents.downloadURL(params.srcURL)
          const ses = win.webContents.session
          const onWill = (_evt, item) => {
            item.setSavePath(path.join(app.getPath('downloads'), name))
            ses.removeListener('will-download', onWill)
          }
          ses.on('will-download', onWill)
        },
      })
      template.push({ type: 'separator' })
    }
    if (params.isEditable) {
      template.push({ label: '剪切', role: 'cut' })
      template.push({ label: '复制', role: 'copy' })
      template.push({ label: '粘贴', role: 'paste' })
      template.push({ type: 'separator' })
      template.push({ label: '全选', role: 'selectAll' })
    } else if (params.selectionText && params.selectionText.trim().length > 0) {
      template.push({ label: '复制', role: 'copy' })
      template.push({ type: 'separator' })
      template.push({ label: '全选', role: 'selectAll' })
    }
    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup({ window: win })
    }
  });

  // 快捷键: Ctrl/Cmd+F 搜索 / Ctrl/Cmd+= 缩放 / F12 开发者工具
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const mod = input.meta || input.control
    const key = input.key.toLowerCase()
    if (mod && key === 'f') {
      event.preventDefault()
      setupFind(win)
    } else if (mod && (key === '=' || key === '+')) {
      event.preventDefault()
      win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5)
    } else if (mod && key === '-') {
      event.preventDefault()
      win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5)
    } else if (mod && key === '0') {
      event.preventDefault()
      win.webContents.setZoomLevel(0)
    } else if (mod && key === 'r') {
      event.preventDefault()
      win.webContents.reload()
    } else if (input.key === 'F12' || (mod && input.key === 'I')) {
      event.preventDefault()
      win.webContents.toggleDevTools()
    }
  });

  const ok = await ensureServer();
  if (!ok) {
    // 启动失败页: 带上 DSH_DIR 与排查提示, 方便 Windows 上定位问题
    const hint = process.platform === 'win32'
      ? '请确认该目录已完成构建 (pnpm build:lib), 且 node 已加入 PATH'
      : '请确认该目录已完成构建 (pnpm build:lib), 且已安装 Node.js';
    win.loadURL('data:text/html;charset=utf-8,' +
      encodeURIComponent(`<html><body style="background:#2C2C2E;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;padding:24px;text-align:center"><div>dsh 服务未能启动<br><br>DSH_DIR: ${DSH_DIR}<br>${hint}</div></body></html>`));
    return;
  }

  win.on('resize', () => saveWindowState(win));
  win.on('move', () => saveWindowState(win));
  win.on('close', () => saveWindowState(win, true));

  // 页面加载后注入文件夹右键检测
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(FOLDER_MENU_JS).catch(() => {});
  });

  setupAppMenu(win);
  win.loadURL(URL);
});

// ---------- 文件夹右键菜单 (页面检测到路径后调用) ----------
ipcMain.on('dsh-folder-menu', (event, folderPath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const isMac = process.platform === 'darwin';
  Menu.buildFromTemplate([
    { label: '打开目标文件夹', click: () => { shell.openPath(folderPath); } },
    { label: isMac ? '在访达中显示' : '在资源管理器中显示', click: () => shell.showItemInFolder(folderPath) },
    { type: 'separator' },
    { label: '复制路径', click: () => clipboard.writeText(folderPath) },
  ]).popup({ window: win });
});

// ---------- 打开本地路径 (网页端菜单调用) ----------
ipcMain.on('dsh-open-path', (_event, folderPath) => {
  if (typeof folderPath === 'string' && folderPath) shell.openPath(folderPath);
});

// ---------- 重启 DSH 服务 (杀掉 3080 端口的进程再启动) ----------
function killPort(port) {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32'
      ? 'netstat -ano | findstr :' + port
      : 'lsof -ti tcp:' + port;
    exec(cmd, (err, stdout) => {
      const pids = String(stdout || '').trim().split(/\s+/).filter(Boolean);
      for (const pid of pids) {
        try { process.kill(Number(pid), 'SIGTERM'); } catch (e) {}
      }
      resolve();
    });
  });
}
async function restartServer() {
  await killPort(3080);
  await new Promise((r) => setTimeout(r, 800));
  await startServer();
}

// ---------- 页面注入: 右键文件夹检测 (title/data-path/aria-label 里的路径) ----------
const FOLDER_MENU_JS = `
(() => {
  if (window.__dshFolderHook) return;
  window.__dshFolderHook = true;
  const PATH_RE = /^(~|\/|[A-Za-z]:[\\/]|\\)/;
  document.addEventListener('contextmenu', (e) => {
    let el = e.target;
    for (let i = 0; el && i < 7; i++, el = el.parentElement) {
      const cand = el.getAttribute && (el.getAttribute('data-path') || el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('data-tooltip'));
      if (cand) {
        const p = String(cand).replace(/^[a-z]+:\s*/i, '').trim();
        if (PATH_RE.test(p) && p.length > 1) {
          e.preventDefault();
          window.dshShell && window.dshShell.showFolderMenu(p);
          return;
        }
      }
    }
  });
})()
`;

// ---------- 应用菜单 (macOS 菜单栏 / Windows 窗口菜单) ----------
function setupAppMenu(win) {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'DSH',
      submenu: [
        { label: '打开 DSH 数据目录 (~/.dsh)', click: () => { shell.openPath(path.join(os.homedir(), '.dsh')); } },
        { label: '复制服务地址', click: () => clipboard.writeText(URL) },
        { type: 'separator' },
        { label: '重新加载页面', role: 'reload' },
        { label: '开发者工具', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '重启 DSH 服务', click: () => { restartServer(); } },
        { type: 'separator' },
        isMac ? { role: 'quit', label: '退出 DeepSeek Harness' } : { role: 'quit', label: '退出' },
      ],
    },
    // 编辑菜单: macOS 上 ⌘C/⌘V/⌘X/⌘A/⌘Z 等编辑快捷键由菜单 role 分发,
    // 没有 Edit 菜单时这些组合键在无边框窗口里传不进页面。
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { type: 'separator' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
