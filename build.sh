#!/bin/bash
set -e

echo "========================================"
echo "  Hitchcock Dolly Zoom Camera - APK Build Script"
echo "========================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check prerequisites
check_prereq() {
    echo "[1/6] Checking prerequisites..."
    
    if ! command -v node &> /dev/null; then
        echo -e "${RED}Error: Node.js not found. Install from https://nodejs.org/${NC}"
        exit 1
    fi
    echo "  Node.js: $(node -v)"
    
    if ! command -v java &> /dev/null; then
        echo -e "${RED}Error: Java not found. Install OpenJDK 17:${NC}"
        echo "  Ubuntu/Debian: sudo apt install openjdk-17-jdk"
        echo "  macOS: brew install openjdk@17"
        exit 1
    fi
    echo "  Java: $(java -version 2>&1 | head -1)"
    
    if [ -z "$ANDROID_HOME" ] && [ -z "$ANDROID_SDK_ROOT" ]; then
        echo -e "${YELLOW}Warning: ANDROID_HOME not set.${NC}"
        echo "  Set it to your Android SDK path, e.g.:"
        echo "  export ANDROID_HOME=$HOME/Android/Sdk"
        echo "  Or let this script install it..."
        
        # Auto-install Android SDK if not found
        if [ ! -d "$HOME/android-sdk" ]; then
            echo "  Installing Android SDK..."
            mkdir -p $HOME/android-sdk/cmdline-tools
            curl -L -o /tmp/cmdline-tools.zip "https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip"
            unzip -q /tmp/cmdline-tools.zip -d $HOME/android-sdk/cmdline-tools/
            mv $HOME/android-sdk/cmdline-tools/cmdline-tools $HOME/android-sdk/cmdline-tools/latest
            rm /tmp/cmdline-tools.zip
            export ANDROID_HOME=$HOME/android-sdk
            export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
            yes | sdkmanager --licenses
            sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
        fi
        export ANDROID_HOME=$HOME/android-sdk
    fi
    echo "  ANDROID_HOME: $ANDROID_HOME"
    echo ""
}

# Install dependencies
install_deps() {
    echo "[2/6] Installing dependencies..."
    if [ ! -d "node_modules" ]; then
        npm install
    else
        echo "  node_modules exists, skipping npm install"
        echo "  (run 'rm -rf node_modules && npm install' to force reinstall)"
    fi
    echo ""
}

# Setup assets
setup_assets() {
    echo "[3/6] Setting up assets..."
    mkdir -p assets
    
    # Generate simple icon using ImageMagick if available, otherwise create placeholder
    if command -v convert &> /dev/null; then
        convert -size 1024x1024 xc:black -pointsize 60 -fill white -gravity center \
            -annotate +0+0 "Hitchcock\nDolly Zoom" assets/icon.png
        cp assets/icon.png assets/splash.png
        cp assets/icon.png assets/adaptive-icon.png
    elif command -v python3 &> /dev/null; then
        python3 -c "
from PIL import Image, ImageDraw, ImageFont
img = Image.new('RGB', (1024, 1024), 'black')
draw = ImageDraw.Draw(img)
draw.text((512, 480), 'Hitchcock', fill='white', anchor='mm')
draw.text((512, 580), 'Dolly Zoom', fill='white', anchor='mm')
img.save('assets/icon.png')
img.save('assets/splash.png')
img.save('assets/adaptive-icon.png')
print('Icons generated with PIL')
"
    else
        echo -e "${YELLOW}  Warning: No image tool found. Create icon.png, splash.png, adaptive-icon.png manually in assets/ folder.${NC}"
    fi
    echo ""
}

# Prebuild Android project
prebuild() {
    echo "[4/6] Generating Android native project..."
    npx expo prebuild --platform android --clean
    echo ""
}

# Configure Gradle mirror for China users
configure_gradle() {
    echo "[5/6] Configuring Gradle..."
    
    # Use Tencent mirror for faster downloads in China
    GRADLE_MIRROR="https\://mirrors.cloud.tencent.com/gradle/"
    
    sed -i.bak "s|distributionUrl=.*|distributionUrl=${GRADLE_MIRROR}gradle-8.12-bin.zip|" \
        android/gradle/wrapper/gradle-wrapper.properties
    
    # Increase network timeout
    sed -i.bak 's/networkTimeout=.*/networkTimeout=300000/' \
        android/gradle/wrapper/gradle-wrapper.properties
    
    # Configure build.gradle for release signing
    if [ ! -f "android/app/my-release-key.jks" ]; then
        echo "  Generating debug signing key..."
        keytool -genkey -v -keystore android/app/my-release-key.jks \
            -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000 \
            -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US"
    fi
    echo ""
}

# Build APK
build_apk() {
    echo "[6/6] Building APK..."
    echo "  Build type: ${BUILD_TYPE:-debug}"
    echo ""
    
    cd android
    
    if [ "${BUILD_TYPE}" = "release" ]; then
        ./gradlew assembleRelease
        APK_PATH="app/build/outputs/apk/release/app-release-unsigned.apk"
        echo -e "${GREEN}Release APK (unsigned): $(pwd)/${APK_PATH}${NC}"
        echo "  Sign with: jarsigner -keystore app/my-release-key.jks ..."
    else
        ./gradlew assembleDebug
        APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
        echo -e "${GREEN}Debug APK: $(pwd)/${APK_PATH}${NC}"
    fi
    
    cd ..
    
    echo ""
    echo -e "${GREEN}========================================"
    echo "  Build Complete!"
    echo "========================================${NC}"
    echo ""
    echo "APK Location: android/${APK_PATH}"
    echo ""
    echo "Install on device:"
    echo "  adb install android/${APK_PATH}"
    echo ""
}

# Main
main() {
    # Parse arguments
    BUILD_TYPE="debug"
    while [[ $# -gt 0 ]]; do
        case $1 in
            --release)
                BUILD_TYPE="release"
                shift
                ;;
            --skip-deps)
                SKIP_DEPS=1
                shift
                ;;
            --help)
                echo "Usage: ./build.sh [options]"
                echo ""
                echo "Options:"
                echo "  --release     Build release APK (default: debug)"
                echo "  --skip-deps   Skip npm install if node_modules exists"
                echo "  --help        Show this help message"
                exit 0
                ;;
            *)
                echo "Unknown option: $1"
                exit 1
                ;;
        esac
    done
    
    check_prereq
    
    if [ -z "$SKIP_DEPS" ]; then
        install_deps
    fi
    
    setup_assets
    prebuild
    configure_gradle
    build_apk
}

main "$@"
