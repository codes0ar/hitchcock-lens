# Hitchcock Dolly Zoom Camera - APK Build Guide

## Quick Start

```bash
cd hitchcock-apk
chmod +x build.sh
./build.sh
```

## Prerequisites

| Tool | Version | Install Command |
|------|---------|----------------|
| Node.js | >= 18 | [nodejs.org](https://nodejs.org/) or `nvm install 20` |
| Java JDK | 17 | `apt install openjdk-17-jdk` / `brew install openjdk@17` |
| Android SDK | API 35 | See below |

## Android SDK Setup

### Option 1: Android Studio (Recommended)
Download from [developer.android.com/studio](https://developer.android.com/studio)

### Option 2: Command Line Tools Only
```bash
mkdir -p ~/android-sdk/cmdline-tools
curl -O https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip
unzip commandlinetools-linux-*.zip -d ~/android-sdk/cmdline-tools/
mv ~/android-sdk/cmdline-tools/cmdline-tools ~/android-sdk/cmdline-tools/latest

export ANDROID_HOME=$HOME/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

Add to `~/.bashrc` or `~/.zshrc`:
```bash
export ANDROID_HOME=$HOME/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
```

## Build Options

### Debug APK (Fast, for testing)
```bash
./build.sh
# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

### Release APK
```bash
# Generate signing key (one-time)
keytool -genkey -v -keystore my-release-key.jks -alias my-key-alias \
  -keyalg RSA -keysize 2048 -validity 10000

# Build
./build.sh --release

# Sign the APK
jarsigner -verbose -sigalg SHA1withRSA -digestalg SHA1 \
  -keystore my-release-key.jks \
  android/app/build/outputs/apk/release/app-release-unsigned.apk my-key-alias

# Align with zipalign
zipalign -v 4 app-release-unsigned.apk app-release.apk
```

## Install on Device

```bash
# Enable USB debugging on your Android device
adb devices  # Should show your device

# Install
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `ANDROID_HOME not set` | Set environment variable pointing to Android SDK |
| Gradle download timeout | Edit `android/gradle/wrapper/gradle-wrapper.properties`, use mirror: `https://mirrors.cloud.tencent.com/gradle/gradle-8.12-bin.zip` |
| `expo-face-detector` build error | The config plugin has been removed from app.json. Face detection uses camera frame analysis instead. |
| npm install slow | Use mirror: `npm config set registry https://registry.npmmirror.com` |
| Build memory error | Add `org.gradle.jvmargs=-Xmx4096m` to `android/gradle.properties` |

## Alternative: Expo EAS Build (Cloud)

No local Android SDK needed:

```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview
```

Configure `eas.json`:
```json
{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "preview": {
      "android": { "buildType": "apk" }
    },
    "release": {
      "android": { "buildType": "apk" }
    }
  }
}
```
