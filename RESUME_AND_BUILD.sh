#!/bin/bash
# ===================================================================
# 全自动恢复环境并构建APK
# 从持久化目录恢复工具 → 安装SDK → 创建JDK → 构建APK
# ===================================================================
set -e

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  RESUME & BUILD - Hitchcock Dolly Zoom Camera APK          ║"
echo "╚═══════════════════════════════════════════════════════════════╝"

PERSISTENT="/mnt/agents/output/tools"

# ===== 步骤1: 恢复Gradle到/tmp =====
echo ""
echo "[1/8] Restoring Gradle → /tmp/gradle..."
rm -rf /tmp/gradle
cp -r $PERSISTENT/gradle /tmp/gradle
chmod +x /tmp/gradle/bin/*
/tmp/gradle/bin/gradle -v 2>&1 | head -1 && echo "  ✓ Gradle OK"

# ===== 步骤2: 恢复SDK cmdline-tools → /tmp =====
echo ""
echo "[2/8] Restoring SDK → /tmp/android-sdk..."
rm -rf /tmp/android-sdk
cp -r $PERSISTENT/android-sdk /tmp/android-sdk
chmod +x /tmp/android-sdk/cmdline-tools/latest/bin/*
export ANDROID_HOME=/tmp/android-sdk
export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$PATH
echo "  ✓ SDK cmdline-tools OK"

# ===== 步骤3: 安装SDK平台组件 =====
echo ""
echo "[3/8] Installing SDK platforms..."
yes 2>/dev/null | sdkmanager --licenses > /dev/null 2>&1
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" > /dev/null 2>&1
echo "  ✓ platform-tools: $(ls $ANDROID_HOME/platform-tools/adb 2>/dev/null && echo YES || echo NO)"
echo "  ✓ platform-35: $(ls $ANDROID_HOME/platforms/android-35/android.jar 2>/dev/null && echo YES || echo NO)"
echo "  ✓ build-tools-35: $(ls $ANDROID_HOME/build-tools/35.0.0/aapt 2>/dev/null && echo YES || echo NO)"

# ===== 步骤4: 创建JDK（组合方式）=====
echo ""
echo "[4/8] Creating JDK from system JRE + javac..."
# 下载JDK headless deb（断点续传）
DEB_FILE="/mnt/agents/output/jdk17_headless.deb"
DEB_URL="http://deb.debian.org/debian/pool/main/o/openjdk-17/openjdk-17-jdk-headless_17.0.19+10-1~deb12u2_amd64.deb"

if [ ! -f "$DEB_FILE" ] || [ $(stat -c%s "$DEB_FILE" 2>/dev/null) -lt 70000000 ]; then
    echo "  Downloading JDK deb..."
    curl -sL --continue-at - --max-time 3600 "$DEB_URL" -o "$DEB_FILE" 2>/dev/null &
    CURL_PID=$!
    
    # 等待下载足够提取javac（约10MB）
    for i in $(seq 1 120); do
        sleep 10
        SIZE=$(stat -c%s "$DEB_FILE" 2>/dev/null || echo 0)
        SIZE_MB=$((SIZE / 1024 / 1024))
        if [ $SIZE_MB -ge 10 ]; then
            echo "    Downloaded ${SIZE_MB}MB, extracting javac..."
            break
        fi
        echo "    [$i/120] Downloaded: ${SIZE_MB}MB"
    done
    
    # 等待或kill curl
    kill $CURL_PID 2>/dev/null
    wait $CURL_PID 2>/dev/null
fi

# 提取deb包
rm -rf /tmp/jdk17-extract /tmp/full-jdk
dpkg -x "$DEB_FILE" /tmp/jdk17-extract 2>/dev/null || true

# 创建组合JDK
mkdir -p /tmp/full-jdk
cp -r /tmp/jdk17-extract/usr/lib/jvm/java-17-openjdk-amd64/bin /tmp/full-jdk/ 2>/dev/null || true
cp /usr/lib/jvm/java-17-openjdk-amd64/bin/java /tmp/full-jdk/bin/ 2>/dev/null || true
ln -sf /usr/lib/jvm/java-17-openjdk-amd64/lib /tmp/full-jdk/lib
ln -sf /usr/lib/jvm/java-17-openjdk-amd64/conf /tmp/full-jdk/conf
cp /usr/lib/jvm/java-17-openjdk-amd64/release /tmp/full-jdk/ 2>/dev/null || true

export JAVA_HOME=/tmp/full-jdk
echo "  ✓ javac: $(/tmp/full-jdk/bin/javac -version 2>&1)"

# ===== 步骤5: 重建项目 =====
echo ""
echo "[5/8] Rebuilding project..."
cd /tmp
rm -rf hproj
mkdir hproj
cd hproj
echo "" | npx create-expo-app@latest . --template blank > /dev/null 2>&1
npm install expo-camera expo-face-detector expo-media-library --no-audit --no-fund > /dev/null 2>&1
cp /mnt/agents/output/hitchcock-apk/App.tsx .
cp /mnt/agents/output/hitchcock-apk/app.json .
cp /mnt/agents/output/hitchcock-apk/index.js .
python3 -c "
import os, shutil
for d in ['src/components', 'src/hooks', 'src/utils', 'src/types']:
    os.makedirs(d, exist_ok=True)
for f in [
    ('src/types/index.ts','src/types/index.ts'), ('src/utils/ZoomController.ts','src/utils/ZoomController.ts'),
    ('src/hooks/useCamera.ts','src/hooks/useCamera.ts'), ('src/hooks/useFaceDetection.ts','src/hooks/useFaceDetection.ts'),
    ('src/hooks/useZoomControl.ts','src/hooks/useZoomControl.ts'), ('src/components/CameraScreen.tsx','src/components/CameraScreen.tsx'),
    ('src/components/RecordButton.tsx','src/components/RecordButton.tsx'), ('src/components/FaceLockIndicator.tsx','src/components/FaceLockIndicator.tsx'),
    ('src/components/ZoomDisplay.tsx','src/components/ZoomDisplay.tsx'), ('src/components/SettingsPanel.tsx','src/components/SettingsPanel.tsx')]:
    shutil.copy2('/mnt/agents/output/hitchcock-apk/' + f[0], f[1])
"
python3 -c "from PIL import Image; img=Image.new('RGB',(1024,1024),(30,30,30)); [img.save(f'assets/{n}') for n in ['icon.png','splash.png','adaptive-icon.png']]"
echo "  ✓ Project ready"

# ===== 步骤6: Prebuild =====
echo ""
echo "[6/8] Expo prebuild..."
npx expo prebuild --platform android --clean > /dev/null 2>&1
echo "  ✓ Prebuild done"

# ===== 步骤7: Fix config =====
echo ""
echo "[7/8] Fixing build config..."
sed -i 's/plugins { id("org.gradle.toolchains.foojay-resolver-convention")/\/\/ plugins { id("org.gradle.toolchains.foojay-resolver-convention")/' \
  node_modules/@react-native/gradle-plugin/settings.gradle.kts 2>/dev/null
cat > android/gradle.properties << 'EOF'
org.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=512m
org.gradle.parallel=true
org.gradle.caching=true
org.gradle.vfs.watch=false
android.useAndroidX=true
android.enablePngCrunchInReleaseBuilds=true
reactNativeArchitectures=arm64-v8a
newArchEnabled=false
hermesEnabled=true
EOF
echo "  ✓ Config fixed"

# ===== 步骤8: 构建APK =====
echo ""
echo "[8/8] Building APK (this will take 10-20 minutes)..."
echo "      Build log: /mnt/agents/output/build-loop.log"
cd android
export GRADLE_USER_HOME=/tmp/gradle-cache
mkdir -p $GRADLE_USER_HOME

> /mnt/agents/output/build-loop.log
nohup /tmp/gradle/bin/gradle assembleDebug --no-daemon --console=plain --info \
  > /mnt/agents/output/build-loop.log 2>&1 &
BUILD_PID=$!

echo ""
echo "Build started (PID: $BUILD_PID)"
echo "Monitoring..."

# 监控构建
for i in $(seq 1 120); do
    sleep 30
    
    if grep -q "BUILD SUCCESS" /mnt/agents/output/build-loop.log 2>/dev/null; then
        echo ""
        echo "╔════════════════════════════════════════════════════════════╗"
        echo "║              ✅ BUILD SUCCESS! APK READY!                   ║"
        echo "╚════════════════════════════════════════════════════════════╝"
        APK=$(find /tmp/hproj/android/app/build/outputs -name "*.apk" 2>/dev/null | head -1)
        if [ -n "$APK" ]; then
            ls -lh "$APK"
            cp "$APK" /mnt/agents/output/hitchcock-dolly-zoom.apk
            echo ""
            echo "✅ APK saved: /mnt/agents/output/hitchcock-dolly-zoom.apk"
        fi
        exit 0
    fi
    
    if grep -q "BUILD FAILED" /mnt/agents/output/build-loop.log 2>/dev/null; then
        echo ""
        echo "❌ BUILD FAILED"
        tail -20 /mnt/agents/output/build-loop.log
        exit 1
    fi
    
    if ! ps aux | grep "gradle.*assembleDebug" | grep -v grep > /dev/null; then
        if ! grep -q "BUILD" /mnt/agents/output/build-loop.log 2>/dev/null; then
            echo ""
            echo "⚠️ Gradle process stopped unexpectedly"
            tail -20 /mnt/agents/output/build-loop.log
            exit 1
        fi
    fi
    
    TASK=$(grep "> Task :app:" /mnt/agents/output/build-loop.log 2>/dev/null | tail -1 | cut -c1-60)
    [ -n "$TASK" ] && echo "  [$i/120] $TASK" || echo "  [$i/120] Building..."
done

echo ""
echo "⏰ Monitoring timeout. Build may still be running."
echo "Check: tail -f /mnt/agents/output/build-loop.log"
