# SPEC.md — 希区柯克变焦摄像APP (Hitchcock Dolly Zoom Camera)

## 1. 项目概述
开发一个移动端摄像APP。用户手持手机从远处接近被摄人物时，APP通过实时人脸检测+动态变焦控制，保持人物面部在画面中的像素大小不变，同时背景产生经典的希区柯克拉伸（Dolly Zoom）视觉效果。

## 2. 技术栈
- **框架**: React Native + Expo SDK 52
- **核心依赖**:
  - `expo-camera` ~16.0 — 摄像头预览、录像、zoom控制
  - `expo-face-detector` ~13.0 — 实时人脸检测
  - `expo-av` ~14.0 — 视频播放（预览录制结果）
  - `expo-media-library` ~17.0 — 保存视频到相册
- **控制算法**: 比例控制器 + 平滑滤波（EMA）

## 3. 核心算法设计

### 3.1 希区柯克效果原理
```
用户靠近被摄体（物理距离D减小）
  → 人脸在画面中变大（像素尺寸P增大）
  → APP自动缩小zoom（Z减小）
  → 人脸像素尺寸P回到目标值
  → 结果：人脸大小不变，背景视角变宽（透视拉伸）
```

### 3.2 控制循环（每帧执行）
```
Input:  facePixelSize — 当前人脸检测到的像素宽度
        targetFaceSize — 用户设定/初始捕获的目标人脸像素宽度
        currentZoom — 当前摄像头zoom值

Error = targetFaceSize / facePixelSize  // >1表示人脸太小需zoom in, <1需zoom out
correctedZoom = currentZoom * Error * SMOOTHING_FACTOR
outputZoom = clamp(correctedZoom, MIN_ZOOM, MAX_ZOOM)

Apply outputZoom to camera
```

### 3.3 平滑参数
- `SMOOTHING_FACTOR = 0.15` — EMA平滑系数，防止抖动
- `MIN_ZOOM = 1.0` — 最小zoom（广角端）
- `MAX_ZOOM = 10.0` — 最大zoom（长焦端，设备依赖）

## 4. 模块设计

### Module A: 摄像头管理 (CameraManager)
- 职责: 摄像头初始化、预览流、zoom控制、录像开始/停止
- 接口:
  - `initialize(): Promise<void>`
  - `setZoom(zoom: number): void`
  - `startRecording(): Promise<void>`
  - `stopRecording(): Promise<VideoUri>`
- 使用 `expo-camera` CameraView 组件

### Module B: 人脸检测器 (FaceDetector)
- 职责: 从摄像头帧中实时检测人脸，返回人脸边界框
- 接口:
  - `detect(frame): Promise<Face[]>`
  - `Face = { bounds: { x, y, width, height }, faceID }`
- 使用 `expo-face-detector` 或 CameraView 内置 face detection

### Module C: 变焦控制器 (ZoomController)
- 职责: 核心控制算法，根据人脸尺寸偏差计算目标zoom
- 接口:
  - `setTargetFaceSize(pixelWidth: number): void`
  - `update(facePixelSize: number, currentZoom: number): number` // 返回目标zoom
- 内部状态: `targetSize`, `lastZoom`, `emaFactor`

### Module D: UI层 (AppUI)
- 职责: 用户界面、状态显示、交互
- 组件:
  - `CameraScreen` — 主摄像界面（全屏预览 + 叠加UI）
  - `RecordButton` — 录制按钮（点击开始/停止）
  - `FaceLockIndicator` — 人脸锁定状态指示器
  - `ZoomLevelDisplay` — 当前zoom倍数显示
  - `SettingsPanel` — 设置面板（灵敏度、平滑度调节）

### Module E: 视频存储 (VideoStorage)
- 职责: 录制视频保存到相册、列表展示
- 接口:
  - `saveVideo(uri: string): Promise<void>`
  - `getSavedVideos(): Promise<Video[]>`
- 使用 `expo-media-library`

## 5. 数据流
```
[Camera Preview Stream]
       ↓
[FaceDetector] → 人脸边界框(width) → [ZoomController]
       ↑                                    ↓
[CameraManager] ←—— targetZoom ———————┘
       ↓
[UI Layer] ←—— 状态更新（zoom值、人脸锁定状态、录制状态）
       ↓
[VideoStorage] ←—— 录制完成时保存视频
```

## 6. UI布局
```
┌─────────────────────────────┐
│  [手电筒]          [翻转镜头] │  ← Top Bar
│                             │
│    ┌─────────────────┐      │
│    │   ◉ 人脸锁定     │      │  ← Face Lock Indicator (center)
│    └─────────────────┘      │
│                             │
│           [⏺]               │  ← Record Button (bottom center)
│     1.0x              ⚙️    │  ← Zoom Display + Settings
└─────────────────────────────┘
```

## 7. 项目结构
```
project/
├── App.tsx                    # 入口，状态管理
├── src/
│   ├── components/
│   │   ├── CameraScreen.tsx   # 主摄像界面
│   │   ├── RecordButton.tsx   # 录制按钮
│   │   ├── FaceLockIndicator.tsx
│   │   ├── ZoomDisplay.tsx
│   │   └── SettingsPanel.tsx
│   ├── hooks/
│   │   ├── useCamera.ts       # 摄像头管理hook
│   │   ├── useFaceDetection.ts # 人脸检测hook
│   │   └── useZoomControl.ts  # 变焦控制hook
│   ├── utils/
│   │   └── ZoomController.ts  # 控制算法类
│   └── types/
│       └── index.ts           # TypeScript类型定义
├── package.json
└── app.json                   # Expo配置
```

## 8. 测试要求
- 人脸锁定精度: 人脸像素大小变化不超过 ±5%
- 控制延迟: 从人脸大小变化到zoom调整的延迟 < 200ms
- 预览帧率: 保持 30fps 以上
- 录像质量: 1080p 30fps
