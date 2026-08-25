# Windows: 为打包后的 DSH.exe 创建桌面快捷方式 (带应用图标)
# 用法: 先 npm run pack, 再 npm run shortcut
# 可手动指定 exe 路径: powershell -File scripts\create-desktop-shortcut.ps1 -ExePath "D:\...\DSH.exe"
param(
    [string]$ExePath = (Join-Path $PSScriptRoot '..\DSH-win32-x64\DSH.exe')
)

$ErrorActionPreference = 'Stop'
$exe = Resolve-Path $ExePath -ErrorAction SilentlyContinue
if (-not $exe) {
    Write-Error "未找到打包后的 DSH.exe: $ExePath`n请先在 dsh-desktop 目录运行: npm run pack"
    exit 1
}

$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'DeepSeek Harness.lnk'

$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk)
$s.TargetPath = $exe.Path
$s.WorkingDirectory = Split-Path $exe.Path
$s.IconLocation = "$($exe.Path),0"
$s.Description = 'DeepSeek Harness 桌面版 (自动连接/启动本机 dsh 服务)'
$s.Save()

Write-Host "已创建桌面快捷方式: $lnk"
