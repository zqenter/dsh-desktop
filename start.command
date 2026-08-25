#!/bin/bash
# macOS: 启动 DSH 桌面版（需先按 README 装好 Node 并构建 deepseek-harness）
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
exec npx electron .
