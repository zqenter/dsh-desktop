# DeepSeek Harness 桌面封装（跨平台）

DSH（DeepSeek Harness）的桌面窗口壳：**无边框窗口(macOS) / 标准窗口(Windows)**, 打开即连本机 dsh 服务(端口 3080), 支持搜索/缩放/右键菜单/记住窗口位置。

## 特性

**窗口与体验**

- 跨平台: macOS(无边框) + Windows(标准窗口)
- 记住上次窗口位置和大小（关闭/移动/缩放自动保存, 屏幕外自动回落）
- 页面内搜索 Ctrl/Cmd+F · 缩放 Ctrl/Cmd± · 开发者工具 F12

**工作区增强（桌面原生能力）**

- **右键文件夹** → 打开目标文件夹 / 在访达(资源管理器)中显示 / 复制路径
  （自动识别工作区里的文件夹路径, 标题栏/树形目录均可）
- 右键链接复制、图片保存、文本复制粘贴、全选

**应用菜单（macOS 菜单栏 / Windows 窗口菜单）**

- 打开 DSH 数据目录 (~/.dsh)
- 复制服务地址
- 重新加载页面 · 开发者工具
- **重启 DSH 服务**（一键重启, 配置改了不用手动找进程）
- 退出

**快捷键**

| 功能 | 快捷键 |
|---|---|
| 页面搜索 | Ctrl/Cmd + F |
| 重新加载 | Ctrl/Cmd + R |
| 放大 / 缩小 | Ctrl/Cmd + = / - |
| 重置缩放 | Ctrl/Cmd + 0 |
| 开发者工具 | F12 或 Ctrl/Cmd + I |


## 前置要求

| 依赖 | 说明 |
|---|---|
| **Node.js** | ≥ 22.19 (dsh 要求), Windows 需加入 PATH; macOS 用 Homebrew 装: `brew install node` |
| **deepseek-harness** | 克隆到 **用户主目录** `~/deepseek-harness` 并完成构建, 见下 |

```bash
# 克隆 dsh 服务端（放主目录）
git clone https://github.com/deepseek-ai/deepseek-harness.git ~/deepseek-harness
cd ~/deepseek-harness
pnpm install
pnpm build:lib
```

## macOS 运行

```bash
cd dsh-desktop
npm install
./start.command        # 或: npx electron .
```

## Windows 运行

```bat
cd dsh-desktop
npm install
start.bat              :: 或: npx electron .
```

## 环境变量（可选）

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_DIR` | `~/deepseek-harness` | dsh 服务代码目录 |
| `NODE_BIN` | macOS:`/opt/homebrew/bin/node`(不存在则用 PATH) / Windows:`node` | 启动服务用的 Node |

## 窗口状态

位置/大小保存在系统应用数据目录:
- macOS: `~/Library/Application Support/dsh-desktop/window-state.json`
- Windows: `%APPDATA%\dsh-desktop\window-state.json`

## 说明

- 关闭窗口后 dsh 服务进程保留（detached）, 下次打开秒连
- macOS 无边框窗口（隐藏标题栏）; Windows 标准窗口（保留最小化/关闭按钮）
