#!/bin/bash
# ===================================================================
# Hitchcock Dolly Zoom Camera - 本地一键构建脚本
# 在您的机器上运行此脚本，5-10分钟内生成APK
# ===================================================================
set -e

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║     Hitchcock Dolly Zoom Camera - APK Builder               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# 检查环境
check_env() {
    echo "[1/6] 检查环境..."
    
    if ! command -v node &> /dev/null; then
        echo "❌ Node.js 未安装"
        echo "   安装: https://nodejs.org/ (建议 v20+)"
        exit 1
    fi
    echo "   ✓ Node.js $(node -v)"
    
    if ! command -v java &> /dev/null; then
        echo "❌ Java 未安装"
        echo "   安装: apt install openjdk-17-jdk (Ubuntu/Debian)"
        echo "         brew install openjdk@17 (macOS)"
        exit 1
    fi
    
    # 检查javac（JDK必需，JRE不够）
    if ! command -v javac &> /dev/null; then
        echo "❌ javac 未找到（只装了JRE，需要JDK）"
        echo "   安装: apt install openjdk-17-jdk"
        exit 1
    fi
    echo "   ✓ Java $(java -version 2>&1 | head -1 | cut -d'"' -f2)"
    echo "   ✓ javac $(javac -version 2>&1)"
}

# 安装依赖
install_deps() {
    echo ""
    echo "[2/6] 安装 npm 依赖..."
    if [ ! -d "node_modules" ]; then
        npm install
    else
        echo "   node_modules 已存在，跳过"
    fi
    echo "   ✓ 依赖就绪"
}

# 生成资源图标
generate_assets() {
    echo ""
    echo "[3/6] 生成应用图标..."
    mkdir -p assets
    if command -v python3 &> /dev/null && python3 -c "from PIL import Image" 2>/dev/null; then
        python3 -c "from PIL import Image; img=Image.new('RGB',(1024,1024),(20,20,20)); [img.save(f'assets/{n}') for n in ['icon.png','splash.png','adaptive-icon.png']]"
    elif command -v convert &> /dev/null; then
        convert -size 1024x1024 xc:black assets/icon.png
        cp assets/icon.png assets/splash.png
        cp assets/icon.png assets/adaptive-icon.png
    else
        echo "   ⚠ 没有图像工具，使用占位文件"
        touch assets/icon.png assets/splash.png assets/adaptive-icon.png
    fi
    echo "   ✓ 图标就绪"
}

# Expo Prebuild
run_prebuild() {
    echo ""
    echo "[4/6] 生成 Android 原生项目..."
    npx expo prebuild --platform android --clean
    echo "   ✓ Android 项目生成完成"
}

# 修复构建配置
fix_config() {
    echo ""
    echo "[5/6] 修复构建配置..."
    
    # 修复foojay插件（禁用自动JDK下载）
    FOOJAY_FILE="node_modules/@react-native/gradle-plugin/settings.gradle.kts"
    if [ -f "$FOOJAY_FILE" ]; then
        sed -i 's/plugins { id("org.gradle.toolchains.foojay-resolver-convention")/\/\/ plugins { id("org.gradle.toolchains.foojay-resolver-convention")/' "$FOOJAY_FILE"
    fi
    
    # 配置gradle.properties
    cat > android/gradle.properties << 'EOF'
org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=512m
org.gradle.parallel=true
org.gradle.caching=true
android.useAndroidX=true
reactNativeArchitectures=arm64-v8a
newArchEnabled=false
hermesEnabled=true
EOF
    
    echo "   ✓ 配置完成"
}

# 构建APK
build_apk() {
    echo ""
    echo "[6/6] 构建 APK..."
    echo "   这可能需要 5-15 分钟（首次构建）..."
    echo ""
    
    cd android
    ./gradlew assembleDebug --no-daemon --console=plain
    
    APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
    if [ -f "$APK_PATH" ]; then
        echo ""
        echo "╔═══════════════════════════════════════════════════════════════╗"
        echo "║                    ✅ APK 构建成功！                          ║"
        echo "╚═══════════════════════════════════════════════════════════════╝"
        echo ""
        ls -lh "$APK_PATH"
        echo ""
        echo "安装到设备:"
        echo "   adb install $APK_PATH"
        echo ""
    else
        echo "❌ APK 未找到"
        exit 1
    fi
}

# 主流程
main() {
    check_env
    install_deps
    generate_assets
    run_prebuild
    fix_config
    build_apk
}

main "$@"
