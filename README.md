# Hitchcock Dolly Zoom Camera（希区柯克变焦相机）

用手机拍出电影《迷魂记》(Vertigo) 经典的"希区柯克变焦"效果：
**拍摄者前后移动时，App 自动反向调节变焦，让画面中的人脸大小保持不变，背景产生强烈的透视拉伸。**

## 原理

人脸在画面中的尺寸 `s ≈ k · zoom / distance`。你向人脸走近（distance 变小）时，控制器同步缩小 zoom；远离时放大 zoom。锁定人脸目标尺寸后，闭环控制实时抵消距离变化——主体不动，背景压缩/拉伸。

## 功能

- 人脸实时检测（ML Kit，1280×720 检测帧，小脸/远脸也能识别）
- 点按中央锁定键捕获目标人脸尺寸，之后自动跟踪变焦
- 录制视频（含声音），黄框参考提示保持人脸居中
- 双指捏合手动缩放（无人脸时也可用）
- PID 增益面板：滑杆实时调 Kp/Ki/Kd，录制中生效
- 三种控制模式可切换对比（设置面板内循环切换）：
  - **纯 PID**（默认，实测最优）
  - PID + 卡尔曼输入平滑
  - PID + 卡尔曼平滑 + T_lag 扰动前馈
- 前置/后置切换、手电筒、横竖屏自适应（加速度计方向检测）
- Debug 悬浮窗：误差、PID 分量、zoom、检测帧率实时可见

## 控制算法要点（`src/utils/ZoomController.ts`）

- **对数误差** `e = ln(target/faceSize)`：变焦乘法问题转为加法，PID 增益与当前 zoom 倍数无关
- **几何前馈**：`desiredZoom = actualZoom · e^(adjustment)`，Kp=1 时一步静态补偿到位
- **执行器一阶滞后模型**（τ≈100ms）：用内部估计的真实镜头位置做反馈，避免"指令立即生效"假设导致的累积过冲
- **输出端 EMA 平滑**（τ=120ms）：抹平检测噪声造成的 zoom 指令阶梯——实测这是画面跳动的最大来源
- **输入变化率钳制**（±22%/样本）：人脸丢失后重新捕获时不连续跳变不会造成 zoom 猛冲
- **速率限制 1.0x/s**：实测 dolly 斜坡只需 ~0.15x/s，过宽的限速只会放大噪声

### 调优方法论（为什么这版好）

所有参数都经仿真 dolly 视频闭环 A/B 实测（手机拍摄屏幕上按双曲线规律缩放的人脸视频，`[Track]` 日志流式回传分析）：

| 方案 | 锁定后人脸尺寸误差 σ | 结论 |
|------|------------------|------|
| 纯 PID（Kp0.8/Ki0.02/Kd0.03） | **3.4px** | ✅ 默认 |
| + 卡尔曼输入平滑 | 11.1px | ❌ 滞后使误差 +17%，抖动未降 |
| + 卡尔曼 + T_lag 前馈 | ~45px | ❌ 负优化 |

关键教训：**10Hz 低带宽环路里，滞后比噪声更伤**。静态人脸诊断证明环路本质稳定，"震荡"实为检测噪声穿透过弱的输出平滑，对症才能下药。

## 技术栈

- React Native 0.76 / Expo SDK 52（bare workflow）
- [react-native-vision-camera](https://github.com/mrousavy/react-native-vision-camera) v4（帧处理器 + worklets）
- [react-native-vision-camera-face-detector](https://github.com/luicfrr/react-native-vision-camera-face-detector)（Google ML Kit 人脸检测）

## 目录结构

```
App.tsx                      # 入口：状态编排、控制模式切换
src/
  components/CameraScreen.tsx # 相机预览、检测框叠加、帧处理器、方向映射
  components/SettingsPanel.tsx# PID 增益与模式切换面板
  hooks/useFaceDetection.ts   # 人脸检测状态机（检测/锁定/丢失容忍）
  hooks/useZoomControl.ts     # 变焦控制 Hook（桥接检测与控制器）
  hooks/useCamera.ts          # 相机/录制/权限
  utils/ZoomController.ts     # 核心控制器（见上节）
```

## 构建

见 [BUILD_README.md](BUILD_README.md)。简而言之：

```bash
npm install
npm run build:debug        # 或 cd android && ./gradlew assembleDebug
```

WiFi ADB 安装：

```bash
adb connect <手机IP>:5555
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## 使用

1. 对准人脸，出现绿框后点按中央锁定键（黄圈锁）捕获目标尺寸
2. 前后移动手机（或让人脸远离/靠近），zoom 自动反向补偿
3. 点红色按钮开始/停止录制，黄框为录制起点的参考尺寸
4. 右下角 ⚙️ 打开 PID 面板，可实时调增益、切换控制模式对比

## 版本

当前 **v5.0**（versionCode 34）。调优历程：v4.7 纯 PID 基线 → v4.8 输出 EMA 平滑（抖动 -63%）→ v5.0 输入钳制 + 限速 1.0/s + 720p 检测帧。
