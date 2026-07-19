# 夜间自主工作状态报告 (STATUS_NIGHT.md)

生成时间：2026-07-18 01:20

## 一、阻塞项（无法自主完成验证）

**手机被 PIN/密码锁屏，无法解锁。**
- `adb shell dumpsys trust` → `deviceLocked=1, trusted=0`（无 Smart Lock，无信任代理）
- `screencap` 返回 0 字节（锁屏下系统禁止截屏）
- `mCurrentFocus=null`，`am start` 无法把 app 提到锁屏之上
- 你已就寝，我无法获取 PIN

**结论**：所有需要摄像头/录屏的自主验证（人脸检测、变焦演示、agent 核查视频）**今晚无法执行**，必须等你解锁手机。

---

## 二、已完成（代码与构建均已就绪）

### 代码改动（已 tsc 通过 + 构建成功，hc9 包）
1. **后摄 + picture 模式**：`useCamera` 默认 `facing='back'`；`CameraScreen` `mode="picture"`（绕开 expo-camera video 模式 `takePictureAsync` 的 `ERR_IMAGE_CAPTURE_FAILED` bug）。
2. **takePictureAsync 5s 超时**：`useFaceDetection` 用 `Promise.race` 防止挂起拖死检测循环。
3. **图像质量**：`quality:0.5, skipProcessing:false`（给 ML Kit 干净的正立图像）。
4. **人脸框叠加**：`useFaceDetection` 输出 `primaryFaceBounds` + `imageDimensions`；`CameraScreen` 用 cover 适配把图像坐标映射到预览坐标，画**绿色框**随人脸大小变化。
5. **变焦演示（今晚目标）**：`useZoomControl` 设 `target = primaryFaceWidth * 1.8` → 检测到人脸后主动 zoom in 放大人脸（距离固定、变焦改变人脸大小）。明天改回 `primaryFaceWidth` 即"距离变化时保持人脸大小不变"。

### 研究结论（独立 agent 调研，用于明天）
- **`takePictureAsync` 在 video 模式失败 = expo-camera 已知 bug**（`ExpoCameraView.kt` 在 VIDEO 模式漏绑 `ImageCapture` use case，expo/expo#47898，未修复，SDK 54 仍在）。
- **但 `takePictureAsync` 本质非实时**（1-2 FPS），**dolly-zoom 录像中实时检测必须迁移 `react-native-vision-camera`**。
- **vision-camera 的 face-detector 插件用 bundled ML Kit 16.1.7（GMS-free）**，与已验证可在华为工作的 `expo-face-detector` 同源 → 华为兼容性无虞。
- **推荐方案**：`react-native-vision-camera@4.5.0` + `react-native-vision-camera-face-detector@1.10.2`（v4，别用 v5 Nitro）。帧处理器与录像并行，CameraX 在 Mate 40 (LEVEL_3) 保证 `Preview+VideoCapture+ImageAnalysis` 并发。工作量 2-4 人天。
- **ML Kit 在华为（无 GMS）已验证可用**：`DynamiteModule: Selected local version`（bundled 模型），`GooglePlayServicesUtil` 警告但不致命。→ **不需要 HMS / MediaPipe 替换**。

---

## 三、你醒来后的操作（一条命令）

手机解锁、屏幕亮、保持 adb 无线连接（`192.168.2.28:5555`）后，在 WSL 里执行：

```bash
/tmp/opencode/demo-and-verify.sh
```

该脚本会自动：唤醒屏幕+保持常亮+授权 → 安装 hc9 包 → 启动 app → `screenrecord` 录 25s → 拉取视频到 `/tmp/opencode/demo-run/demo.mp4` → 抓取人脸/变焦日志 → 抽帧（若有 ffmpeg）→ 截图。

产物在 `/tmp/opencode/demo-run/`：
- `demo.mp4`：演示视频（应看到绿框随人脸、画面 zoom in 放大）
- `face-log.txt`：`检测到 N 张人脸` + `ZoomController` 日志
- `frame_*.png`：每 5s 抽帧（供 agent 核查）
- `final.png`：最终截图

### 验证三要素（你或我醒来后用 agent 核查）
1. 是否有人脸识别标记框（绿框）→ 看 `frame_*.png` / `demo.mp4`
2. 是否有变焦动作 → 看 `face-log.txt` 中 zoom 值递增、或视频画面放大
3. 变焦时识别框是否跟随人脸大小 → 视频中绿框随 zoom 变大

---

## 四、若人脸仍检测不到的排查

1. 看日志 `detectFacesImageByteBuffer.start` 次数（>0 表示 ML Kit 被调用）。
2. 看 `检测到 N 张人脸`：若 N=0 → 图像坐标/旋转问题（photo.width/height 可能与预览方向不一致），尝试 `skipProcessing:true` 对比，或检查 ML Kit bounds 旋转。
3. 若 `takePictureAsync` 仍慢（>5s 触发 capture timeout）→ phone 模式下华为静态抓拍慢，可降低 `quality` 或换 `skipProcessing:true`。
4. 人脸框位置不对 → cover 适配假设图像与预览同向；若 photo 是横向（sensor native），需交换 x/y 或加旋转矩阵。

---

## 五、明天的正式目标（vision-camera 迁移）

把今晚的"distance 固定 + zoom 改变人脸大小"改为 SPEC 的"distance 变化 + zoom 保持人脸大小不变"，且**录像中实时检测**。需要：
1. `npx expo install react-native-vision-camera@4.5.0 react-native-vision-camera-face-detector@1.10.2 react-native-worklets-core react-native-reanimated @shopify/react-native-skia`
2. `babel.config.js` 加 `react-native-worklets-core/plugin`（在 reanimated 前）。
3. 重写 `useCamera`/`CameraScreen`/`useFaceDetection`：`<Camera video frameProcessor={...}>`，帧处理器内 `useFaceDetector().detectFaces(frame)` → 驱动 zoom；`cam.current.startRecording()` 录像。
4. target 改回 `setTargetFaceSize(primaryFaceWidth)`（保持人脸大小不变）。
5. 真机验证 dolly-zoom 效果。

---

## 六、构建产物
- `app-debug.apk`（hc9，193MB，含人脸框+变焦演示）：`/mnt/d/prj/ai/kimi/hitchcock_lens/app-debug.apk`
- 演示脚本：`/tmp/opencode/demo-and-verify.sh`
