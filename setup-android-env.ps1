# =============================================================================
# Windows Android 测试环境一键安装脚本
# 自动下载 Android SDK Platform Tools + 配置 adb 环境变量
# =============================================================================

$ErrorActionPreference = "Stop"

$platformToolsUrl = "https://dl.google.com/android/repository/platform-tools-latest-windows.zip"
$installDir = "$env:USERPROFILE\android-sdk"
$zipPath = "$env:TEMP\platform-tools.zip"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Android SDK Platform Tools 安装器" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查是否有管理员权限（修改环境变量需要）
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $isAdmin) {
    Write-Host "[WARN] 当前未以管理员权限运行，环境变量可能无法自动设置" -ForegroundColor Yellow
    Write-Host "       如果安装失败，请右键 PowerShell 选择'以管理员身份运行'后重试" -ForegroundColor Yellow
    Write-Host ""
}

# 创建安装目录
if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    Write-Host "[OK] 创建目录: $installDir" -ForegroundColor Green
} else {
    Write-Host "[OK] 目录已存在: $installDir" -ForegroundColor Green
}

# 下载 Platform Tools
Write-Host "[INFO] 正在下载 Android SDK Platform Tools..." -ForegroundColor Blue
Write-Host "       来源: Google 官方" -ForegroundColor Gray

try {
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $platformToolsUrl -OutFile $zipPath -UseBasicParsing
    $ProgressPreference = 'Continue'
    Write-Host "[OK] 下载完成" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] 下载失败: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "请手动下载并解压到: $installDir" -ForegroundColor Yellow
    Write-Host "下载地址: $platformToolsUrl" -ForegroundColor Yellow
    Read-Host "按 Enter 退出"
    exit 1
}

# 解压
Write-Host "[INFO] 正在解压..." -ForegroundColor Blue
Expand-Archive -Path $zipPath -DestinationPath $installDir -Force
Remove-Item $zipPath

$adbPath = "$installDir\platform-tools\adb.exe"
if (Test-Path $adbPath) {
    Write-Host "[OK] 解压完成: $adbPath" -ForegroundColor Green
} else {
    Write-Host "[ERROR] 解压后未找到 adb.exe" -ForegroundColor Red
    Read-Host "按 Enter 退出"
    exit 1
}

# 添加到环境变量 PATH
Write-Host "[INFO] 正在配置环境变量..." -ForegroundColor Blue
$platformToolsBin = "$installDir\platform-tools"
$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")

if ($currentPath -notlike "*$platformToolsBin*") {
    try {
        [Environment]::SetEnvironmentVariable("PATH", "$currentPath;$platformToolsBin", "User")
        Write-Host "[OK] 已添加到用户 PATH" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] 无法自动设置环境变量，请手动添加以下路径到 PATH:" -ForegroundColor Yellow
        Write-Host "       $platformToolsBin" -ForegroundColor Yellow
    }
} else {
    Write-Host "[OK] 环境变量已存在" -ForegroundColor Green
}

# 验证
Write-Host "[INFO] 验证 adb..." -ForegroundColor Blue
$env:PATH = "$env:PATH;$platformToolsBin"
$adbVersion = & $adbPath version 2>$null | Select-Object -First 1
if ($adbVersion) {
    Write-Host "[OK] adb 可用: $adbVersion" -ForegroundColor Green
} else {
    Write-Host "[WARN] adb 验证失败，但文件已安装" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  安装完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "adb 位置: $adbPath" -ForegroundColor White
Write-Host ""
Write-Host "下一步：安装 Android 模拟器" -ForegroundColor Cyan
Write-Host "  推荐方案 A: MuMu 模拟器 (国内最稳定)" -ForegroundColor White
Write-Host "    下载: https://mumu.163.com/" -ForegroundColor White
Write-Host "  推荐方案 B: Android Studio Emulator (官方)" -ForegroundColor White
Write-Host "    下载: https://developer.android.com/studio" -ForegroundColor White
Write-Host ""
Write-Host "提示: 重新打开 PowerShell 或 CMD 后，adb 命令将全局可用" -ForegroundColor Gray
Write-Host ""
Read-Host "按 Enter 退出"
