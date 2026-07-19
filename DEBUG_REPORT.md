# 希区柯克摄像APP - APK运行问题诊断报告

## 一、截图问题定位：Unable to load script

### 根因分析
截图显示红色致命错误：
> **Unable to load script. Make sure you're either running Metro (run 'npx react-native start') or that your bundle 'index.android.bundle' is packaged correctly for release.**

**根本原因：APK中未嵌入JavaScript Bundle。**

React Native 的 Debug 构建默认会尝试从 Metro 开发服务器加载 JS Bundle，而不是将 Bundle 打包进 APK。当你直接安装 APK 到手机上、且手机无法连接到你的开发机时，就会出现这个错误。

验证：`android/app/src/main/assets/` 目录为空，没有 `index.android.bundle` 文件。

### 解决方案（三选一）

#### 方案A：手动生成 Bundle 后重新构建 Debug APK（推荐）

```bash
# 1. 进入项目目录
cd ~/ai/kimi/hitchcock_lens/hitchcock-apk

# 2. 创建 assets 目录
mkdir -p android/app/src/main/assets

# 3. 生成 JS Bundle
npx react-native bundle \
  --platform android \
  --dev false \
  --entry-file index.js \
  --bundle-output android/app/src/main/assets/index.android.bundle \
  --assets-dest android/app/src/main/res/

# 4. 重新构建 Debug APK
cd android && ./gradlew assembleDebug
```

#### 方案B：直接构建 Release APK

Release 构建会强制嵌入 Bundle：

```bash
cd ~/ai/kimi/hitchcock_lens/hitchcock-apk/android
./gradlew assembleRelease
```

APK 输出位置：`android/app/build/outputs/apk/release/app-release-unsigned.apk`

> 注意：Release APK 需要签名才能安装。如需临时测试，可用 Debug 签名：
> ```bash
> # 已配置在 build.gradle 中，直接安装即可
> ```

#### 方案C：启动 Metro 后连接手机开发（仅调试）

```bash
# 1. 确保手机与电脑在同一局域网
# 2. 启动 Metro
cd ~/ai/kimi/hitchcock_lens/hitchcock-apk
npx react-native start

# 3. 在手机上打开APP，它会自动连接 Metro
# （需确保防火墙允许 8081 端口）
```

---

## 二、已修复的关键代码 Bug

以下 Bug 已在源码中修复，请确保在重新构建前代码已同步。

### Bug 1：`'worklet'` 指令导致 Hermes 运行时崩溃（致命）

**位置**：`src/utils/ZoomController.ts` 第 29 行

**问题**：`convertZoomToNormalized` 函数中使用了 `'worklet';` 指令。这是 Reanimated 库的专用指令，但项目中未安装 Reanimated。Hermes 引擎无法识别该指令，会导致应用启动后立即崩溃。

**修复**：已移除 `'worklet';` 指令。

### Bug 2：录像功能死锁（致命）

**位置**：`src/hooks/useCamera.ts`

**问题**：`startRecording` 中 `await cameraRef.current.recordAsync(...)` 会阻塞直到录制结束。但 `stopRecording` 是从同一个回调 `handleToggleRecording` 调用的，导致：
1. 用户点击录制 → `handleToggleRecording` 调用 `startRecording()`
2. `startRecording` 阻塞在 `await recordAsync()`
3. 用户再次点击停止 → `handleToggleRecording` 无法执行（被上一步阻塞）
4. **APP 卡死，录制按钮失效**

**修复**：已改为正确模式：
- `startRecording`：启动录制，将 `recordAsync` 返回的 Promise 存入 `recordingPromiseRef`
- `stopRecording`：先调用 `cameraRef.current.stopRecording()`（同步），再 `await recordingPromiseRef.current` 获取结果

### Bug 3：`stopRecording()` 被错误地 await

**位置**：`src/hooks/useCamera.ts` 第 195 行

**问题**：`expo-camera` v16 的 `stopRecording()` 是同步方法，返回 `void`。但代码做了 `await cameraRef.current.stopRecording()`，虽然不会直接崩溃，但语义错误。

**修复**：改为同步调用 `cameraRef.current.stopRecording()`，然后 await 存储的 Promise。

---

## 三、待关注的高风险问题（未修改代码）

### 问题 1：人脸检测临时文件堆积

**位置**：`src/hooks/useFaceDetection.ts` 第 106 行

**问题**：每 100ms 调用一次 `takePictureAsync`，每次都会生成一个临时图片文件。运行 1 分钟产生约 600 个文件，持续运行会快速填满手机存储。

**建议修复**：
```typescript
import * as FileSystem from 'expo-file-system';

// 在 performDetection 中，检测完成后删除临时文件：
if (photo?.uri) {
  FileSystem.deleteAsync(photo.uri, { idempotent: true }).catch(() => {});
}
```

> 注意：需要安装 `expo-file-system`：`npx expo install expo-file-system`，然后重新 prebuild + build。

### 问题 2：国内安卓手机 Google Play Services 依赖

**位置**：`src/hooks/useFaceDetection.ts`

**问题**：`expo-face-detector` 在 Android 端依赖 Google ML Kit，需要设备有 Google Play Services。国内主流品牌手机（华为、小米部分机型、OPPO/vivo 等）可能未预装 GMS，导致人脸检测 **完全静默失败**（代码 catch 了所有错误）。

**排查方法**：
```bash
# 连接手机后查看 logcat
adb logcat -s "FaceDetector" "expo-face-detector"
```

**替代方案**（如确认是此问题）：
- 使用 `react-native-vision-camera` + `react-native-worklets-core` + 自定义 Frame Processor
- 或使用 `react-native-camera` 的 `onFacesDetected`（但已弃用）

### 问题 3：maxZoomRatio 硬编码为 10.0

**位置**：`src/hooks/useCamera.ts` 第 72 行

**问题**：`maxZoomRatio = 10.0` 是硬编码的，但不同设备的实际最大 zoom 不同（有些手机只有 5x，有些有 30x+）。`CameraView` 的 `zoom` prop 归一化到 `[0,1]` 后，如果 `maxZoomRatio` 与实际不符，会导致 zoom 行为异常。

**建议**：
```typescript
// 通过 CameraView 的 onCameraReady 回调获取实际 zoom 范围
// expo-camera v16 支持：
const [zoomRange, setZoomRange] = useState({ min: 1, max: 1 });

// 在 CameraView 上绑定：
<CameraView
  onCameraReady={(e) => {
    // e.zoom 可能包含实际范围
  }}
/>
```

> 注：expo-camera v16 的 zoom API 文档较新，建议查阅最新官方文档确认获取实际 zoom 范围的方式。

---

## 四、建议的完整重新构建流程

```bash
# 1. 进入项目目录
cd ~/ai/kimi/hitchcock_lens/hitchcock-apk

# 2. 确保依赖已安装
npm install

# 3. 生成 JS Bundle（解决 Unable to load script）
mkdir -p android/app/src/main/assets
npx react-native bundle \
  --platform android \
  --dev false \
  --entry-file index.js \
  --bundle-output android/app/src/main/assets/index.android.bundle \
  --assets-dest android/app/src/main/res/

# 4. 重新构建 Debug APK
cd android
./gradlew assembleDebug

# 5. 安装到手机
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

---

## 五、运行后排查清单

如果 APK 安装后能够正常启动（不再出现红色错误屏），请按以下顺序验证功能：

| 步骤 | 检查项 | 方法 |
|------|--------|------|
| 1 | 摄像头预览是否正常 | 打开APP，看是否有实时预览画面 |
| 2 | 权限弹窗是否正常 | 首次启动应弹出摄像头权限请求 |
| 3 | 人脸检测是否工作 | 对准人脸，看中央是否出现 "检测到人脸" 提示 |
| 4 | 人脸锁定是否正常 | 稳定对准人脸 0.5s 后应显示 "人脸已锁定" |
| 5 | 变焦是否平滑 | 前后移动手机，看 zoom 是否自动调整且画面平滑 |
| 6 | 录制功能是否正常 | 点击录制按钮，再点击停止，检查视频是否保存 |
| 7 | logcat 是否有异常 | `adb logcat -s "ReactNative" "ReactNativeJS" "AndroidRuntime"` |

### 快速 logcat 过滤命令

```bash
# 查看 JS 层错误
adb logcat -s "ReactNativeJS"

# 查看人脸检测相关日志
adb logcat | grep -i "face\|detector\|hitchcock\|zoom"

# 查看崩溃信息
adb logcat -s "AndroidRuntime"
```

---

## 六、总结

| 问题 | 严重程度 | 状态 |
|------|---------|------|
| JS Bundle 未嵌入 APK | 🔴 致命 | 需按方案A/B/C修复 |
| `'worklet'` 指令崩溃 | 🔴 致命 | 已修复 |
| 录像死锁 | 🔴 致命 | 已修复 |
| `stopRecording()` 错误 await | 🟡 严重 | 已修复 |
| 临时文件堆积 | 🟡 严重 | 待修复（需加 expo-file-system） |
| GMS 缺失导致人脸检测失败 | 🟡 严重 | 需真机验证 |
| maxZoomRatio 硬编码 | 🟢 一般 | 建议优化 |

**下一步最优先操作**：
1. 确认已拉取修复后的代码
2. 执行方案A生成 Bundle 并重新构建
3. 安装到手机验证是否还能启动
4. 如有新问题，抓取 `adb logcat` 日志继续分析
