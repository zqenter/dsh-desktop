@echo off
REM Windows: 启动 DSH 桌面版（需先按 README 装好 Node 并构建 deepseek-harness）
cd /d "%~dp0"
npx electron .
pause
