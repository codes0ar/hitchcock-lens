@echo off
chcp 65001 >nul
title Android SDK Platform Tools 安装器

echo ========================================
echo  Android SDK Platform Tools 安装器
echo ========================================
echo.

curl --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 未找到 curl 命令
    echo 请使用 PowerShell 版本: setup-android-env.ps1
    pause
    exit /b 1
)

set "INSTALL_DIR=%USERPROFILE%\android-sdk"
set "ZIP_PATH=%TEMP%\platform-tools.zip"
set "URL=https://dl.google.com/android/repository/platform-tools-latest-windows.zip"

echo [INFO] 创建安装目录...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

echo [INFO] 正在下载 Platform Tools...
curl -L -o "%ZIP_PATH%" "%URL%"
if %errorlevel% neq 0 (
    echo [ERROR] 下载失败
    pause
    exit /b 1
)

echo [INFO] 正在解压...
powershell -Command "Expand-Archive -Path '%ZIP_PATH%' -DestinationPath '%INSTALL_DIR%' -Force"
del "%ZIP_PATH%"

if exist "%INSTALL_DIR%\platform-tools\adb.exe" (
    echo [OK] adb 已安装: %INSTALL_DIR%\platform-tools\adb.exe
) else (
    echo [ERROR] 解压后未找到 adb.exe
    pause
    exit /b 1
)

echo [INFO] 添加到环境变量...
setx PATH "%PATH%;%INSTALL_DIR%\platform-tools" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] 已添加到 PATH
) else (
    echo [WARN] 请手动将以下路径添加到 PATH:
    echo        %INSTALL_DIR%\platform-tools
)

echo.
echo ========================================
echo  安装完成！
echo ========================================
echo.
echo 下一步：安装 Android 模拟器
echo   推荐: MuMu 模拟器 https://mumu.163.com/
echo   备选: 雷电模拟器 https://www.ldmnq.com/
echo.
pause
