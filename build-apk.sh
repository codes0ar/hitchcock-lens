#!/usr/bin/env bash
# =============================================================================
# 希区柯克摄像APP - 一键打包脚本
# 在 WSL2 Ubuntu 中运行，自动完成 Bundle 生成 + APK 构建 + 复制到 Windows
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# 配置
# -----------------------------------------------------------------------------
PROJECT_DIR="/home/ic/ai/kimi/hitchcock_lens/hitchcock-apk"
WINDOWS_OUT_DIR="/mnt/d/prj/ai/kimi/hitchcock_lens"
APK_SOURCE="${PROJECT_DIR}/android/app/build/outputs/apk/debug/app-debug.apk"
APK_TARGET="${WINDOWS_OUT_DIR}/app-debug.apk"
BUNDLE_FILE="${PROJECT_DIR}/android/app/src/main/assets/index.android.bundle"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# -----------------------------------------------------------------------------
# 辅助函数
# -----------------------------------------------------------------------------
log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

die() { log_error "$1"; exit 1; }

# -----------------------------------------------------------------------------
# 环境检查
# -----------------------------------------------------------------------------
log_info "═══════════════════════════════════════════════════════"
log_info "  希区柯克摄像APP - 一键打包"
log_info "═══════════════════════════════════════════════════════"
echo

log_info "检查环境..."

# 检查 Node.js（优先使用 nvm 中的 Node 22+）
NVM_NODE_PATH="${HOME}/.nvm/versions/node/v22.22.2/bin"
if [ -d "${NVM_NODE_PATH}" ]; then
    export PATH="${NVM_NODE_PATH}:${PATH}"
    log_info "已切换至 nvm Node 22"
fi

if ! command -v node &>/dev/null; then
    die "Node.js 未安装"
fi
NODE_VERSION=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
    log_warn "Node.js ${NODE_VERSION} 版本过低，建议升级到 Node 20+"
    log_warn "检测到 nvm 中的 Node 22 可用，请手动执行："
    log_warn '  export NVM_DIR="\$HOME/.nvm"'
    log_warn '  [ -s "\$NVM_DIR/nvm.sh" ] && . "\$NVM_DIR/nvm.sh"'
    log_warn '  nvm use 22'
fi
log_ok "Node.js: ${NODE_VERSION}"

# 检查 JDK
if [ -f "${HOME}/jdk17/bin/java" ]; then
    JAVA_HOME="${HOME}/jdk17"
    export JAVA_HOME
    export PATH="${JAVA_HOME}/bin:${PATH}"
    log_ok "JDK: ${JAVA_HOME}"
else
    die "JDK 17 未找到 (~/jdk17)"
fi

# 检查 Android SDK
if [ -d "${HOME}/android-sdk" ]; then
    ANDROID_HOME="${HOME}/android-sdk"
    export ANDROID_HOME
    export PATH="${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/cmdline-tools/latest/bin:${PATH}"
    log_ok "Android SDK: ${ANDROID_HOME}"
else
    die "Android SDK 未找到 (~/android-sdk)"
fi

# 检查 Gradle
if [ -d "${HOME}/gradle" ]; then
    GRADLE_HOME="${HOME}/gradle"
    export PATH="${GRADLE_HOME}/bin:${PATH}"
    GRADLE_VERSION=$(gradle --version 2>/dev/null | grep "Gradle" | head -1 || echo "unknown")
    log_ok "Gradle: ${GRADLE_VERSION}"
else
    log_warn "Gradle 未在 PATH 中，将使用项目 wrapper"
fi

# 检查项目目录
if [ ! -d "${PROJECT_DIR}" ]; then
    die "项目目录不存在: ${PROJECT_DIR}"
fi
log_ok "项目目录: ${PROJECT_DIR}"

echo

# -----------------------------------------------------------------------------
# 1. 进入项目并安装依赖
# -----------------------------------------------------------------------------
log_info "Step 1/4: 安装 npm 依赖..."
cd "${PROJECT_DIR}" || die "无法进入项目目录"

if [ ! -d "node_modules" ]; then
    log_warn "node_modules 不存在，执行 npm install..."
    npm install --prefer-offline || npm install
elif [ ! -f "node_modules/.package-lock.json" ] && [ ! -f "node_modules/.modules.yaml" ]; then
    log_warn "node_modules 可能不完整，执行 npm install..."
    npm install --prefer-offline || npm install
else
    log_ok "node_modules 已存在"
fi

# -----------------------------------------------------------------------------
# 2. 检查 Gradle 配置（确保 debug 构建也打包 JS Bundle）
# -----------------------------------------------------------------------------
log_info "Step 2/4: 检查 Gradle Bundle 配置..."

APP_BUILD_GRADLE="${PROJECT_DIR}/android/app/build.gradle"
if grep -q 'debuggableVariants = \[\]' "${APP_BUILD_GRADLE}" 2>/dev/null; then
    log_ok "Gradle 已配置为 debug 构建也打包 JS Bundle"
else
    log_warn "未检测到 debuggableVariants = [] 配置"
    log_warn "已自动修改 app/build.gradle 强制 debug 构建打包 JS Bundle"
    sed -i 's|// debuggableVariants = \["liteDebug", "prodDebug"\]|debuggableVariants = []|' "${APP_BUILD_GRADLE}"
fi

# -----------------------------------------------------------------------------
# 3. 清理之前的构建产物
# -----------------------------------------------------------------------------
log_info "Step 3/4: 清理旧构建产物..."
cd "${PROJECT_DIR}/android" || die "无法进入 android 目录"

if [ -f "gradlew" ]; then
    ./gradlew clean --quiet || log_warn "gradlew clean 失败，继续构建"
else
    log_warn "gradlew 不存在，尝试使用系统 gradle"
fi

log_ok "清理完成"

# -----------------------------------------------------------------------------
# 4. 构建 APK（Gradle 会自动调用 expo export:embed 生成 JS Bundle）
# -----------------------------------------------------------------------------
log_info "Step 4/4: 构建 Debug APK..."
log_info "  这可能需要 10-15 分钟，请耐心等待..."

if [ -f "gradlew" ]; then
    ./gradlew assembleDebug --no-daemon --console=plain || die "APK 构建失败"
else
    gradle assembleDebug --no-daemon --console=plain || die "APK 构建失败"
fi

if [ ! -f "${APK_SOURCE}" ]; then
    die "APK 未生成: ${APK_SOURCE}"
fi

# 验证 APK 中是否包含 JS Bundle
if command -v unzip &>/dev/null; then
    APK_HAS_BUNDLE=$(unzip -l "${APK_SOURCE}" | grep -c 'index.android.bundle' || true)
    if [ "$APK_HAS_BUNDLE" -eq 0 ]; then
        log_warn "APK 中未检测到 JS Bundle，运行后可能出现 'Unable to load script' 错误"
    else
        log_ok "APK 已包含 JS Bundle"
    fi
fi

APK_SIZE=$(du -h "${APK_SOURCE}" | cut -f1)
log_ok "APK 构建成功: ${APK_SIZE}"

# -----------------------------------------------------------------------------
# 5. 复制到 Windows 目录
# -----------------------------------------------------------------------------
log_info "复制 APK 到 Windows 目录..."

mkdir -p "${WINDOWS_OUT_DIR}"
cp -f "${APK_SOURCE}" "${APK_TARGET}" || die "复制 APK 失败"

log_ok "APK 已复制到: ${WINDOWS_OUT_DIR}"

# 同时生成 Windows 安装脚本
INSTALL_BAT="${WINDOWS_OUT_DIR}/install-apk.bat"
cat > "${INSTALL_BAT}" << 'EOF'
@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================
echo  希区柯克摄像APP - APK 安装工具
echo ============================================
echo.

:: 检查 adb
set "ADB=adb"
where adb >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] adb 未在 PATH 中，尝试查找常见位置...
    
    :: 常见 Android SDK 路径
    if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" (
        set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
    ) else if exist "%USERPROFILE%\android-sdk\platform-tools\adb.exe" (
        set "ADB=%USERPROFILE%\android-sdk\platform-tools\adb.exe"
    ) else if exist "C:\android-sdk\platform-tools\adb.exe" (
        set "ADB=C:\android-sdk\platform-tools\adb.exe"
    ) else if exist "D:\android-sdk\platform-tools\adb.exe" (
        set "ADB=D:\android-sdk\platform-tools\adb.exe"
    ) else (
        echo [ERROR] 未找到 adb.exe
        echo.
        echo 请确保 Android SDK Platform Tools 已安装并加入 PATH
        echo 下载地址: https://developer.android.com/studio/releases/platform-tools
        echo.
        pause
        exit /b 1
    )
)

echo [OK] 使用 adb: %ADB%
echo.

:: 检查设备连接
echo [INFO] 检查设备连接...
%ADB% devices
for /f "tokens=2" %%a in ('%ADB% devices ^| findstr /C:"device"') do (
    set "DEVICE=%%a"
)

if not defined DEVICE (
    echo [ERROR] 未检测到 Android 设备或模拟器
    echo.
    echo 请确保：
    echo   1. 手机已开启 USB 调试并连接电脑
    echo   2. 或 Android 模拟器正在运行
    echo.
    echo 如果使用手机，请确认已在手机上允许此电脑调试。
    echo.
    pause
    exit /b 1
)

echo [OK] 检测到设备
echo.

:: 安装 APK
set "APK=%~dp0app-debug.apk"
if not exist "%APK%" (
    echo [ERROR] 未找到 APK 文件: %APK%
    pause
    exit /b 1
)

echo [INFO] 正在安装 APK...
%ADB% install -r "%APK%"
if %errorlevel% neq 0 (
    echo [ERROR] 安装失败
    pause
    exit /b 1
)

echo [OK] 安装成功！
echo.
echo 请在设备上打开应用测试。

:: 启动 logcat 监控（可选）
echo.
set /p START_LOG="是否启动 logcat 监控? (y/n): "
if /i "%START_LOG%"=="y" (
    echo [INFO] 启动 logcat，按 Ctrl+C 停止...
    echo [INFO] 过滤标签: ReactNativeJS, AndroidRuntime, expo-camera
    %ADB% logcat -s "ReactNativeJS" "AndroidRuntime" "expo-camera" "expo-face-detector" "System.err"
)

pause
EOF

log_ok "Windows 安装脚本已生成: ${INSTALL_BAT}"

# 也生成一个启动模拟器 + 安装的组合脚本
START_BAT="${WINDOWS_OUT_DIR}/start-test.bat"
cat > "${START_BAT}" << 'EOF'
@echo off
chcp 65001 >nul
echo ============================================
echo  希区柯克摄像APP - 快速测试启动器
echo ============================================
echo.

:: 检查是否有 Android 模拟器在运行
adb devices | findstr "emulator" >nul
if %errorlevel% neq 0 (
    echo [INFO] 未检测到运行中的模拟器
    echo.
    echo 请先在 Windows 上启动 Android 模拟器，例如：
    echo   - MuMu 模拟器 (推荐，国内最稳定)
    echo   - Android Studio Emulator
    echo   - 或其他 Android 模拟器
    echo.
    echo MuMu 模拟器下载: https://mumu.163.com/
    echo.
    pause
    exit /b 1
)

echo [OK] 检测到模拟器，准备安装...
call "%~dp0install-apk.bat"
EOF

log_ok "快速测试启动器已生成: ${START_BAT}"

echo
log_info "═══════════════════════════════════════════════════════"
log_ok  "  打包完成！"
log_info "═══════════════════════════════════════════════════════"
echo
log_info "APK 文件: ${WINDOWS_OUT_DIR}/app-debug.apk"
log_info "安装脚本: ${WINDOWS_OUT_DIR}/install-apk.bat"
echo
log_info "Windows 下使用方式："
log_info "  1. 双击 install-apk.bat 安装到已连接的设备/模拟器"
log_info "  2. 或双击 start-test.bat（会自动检测模拟器）"
echo
