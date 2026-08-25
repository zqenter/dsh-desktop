// preload: 在页面渲染前注入窗口样式, 避免加载后跳动
'use strict';

// 暴露给页面的壳能力 (搜索等)
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dshShell', {
  find: (text, forward) => ipcRenderer.send('dsh-find', { text, forward }),
  stopFind: () => ipcRenderer.send('dsh-find-stop'),
});

// 拖拽区 + 侧边栏安全距离 (仅这两项, 保持界面原样)
const WINDOW_CSS = `
  /* 顶部 34px 可拖动窗口 */
  body::before {
    content: '';
    position: fixed;
    top: 0; left: 0; right: 0;
    height: 34px;
    -webkit-app-region: drag;
    z-index: 2147483646;
    pointer-events: none;
  }
  /* 红绿灯区域不可拖拽 */
  body::after {
    content: '';
    position: fixed;
    top: 0; left: 0;
    width: 72px; height: 34px;
    -webkit-app-region: no-drag;
    z-index: 2147483647;
  }
  /* 左侧边栏顶部安全距离: 给左上红绿灯让位 */
  div[class$="_sidebarCol"] {
    padding-top: 12px !important;
  }
  /* 标题栏内的交互元素排除出拖拽区, 保证可点击
     (后台任务按钮等都在标题栏顶部, 会被拖拽区拦截) */
  header[class*="PHT0ZW_header"] button,
  header[class*="PHT0ZW_header"] a,
  header[class*="PHT0ZW_header"] input,
  header[class*="PHT0ZW_header"] select,
  header[class*="PHT0ZW_header"] [role="button"] {
    -webkit-app-region: no-drag;
  }
`;

function injectWindowCss() {
  try {
    const style = document.createElement('style');
    style.textContent = WINDOW_CSS;
    (document.head || document.documentElement).appendChild(style);
  } catch (e) { /* ignore */ }
}

if (document.documentElement) {
  injectWindowCss();
} else {
  document.addEventListener('DOMContentLoaded', injectWindowCss);
}
