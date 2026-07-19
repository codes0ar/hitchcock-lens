# Hitchcock Lens — 希区柯克变焦摄像APP

[![Expo](https://img.shields.io/badge/Expo-52.0-000020?logo=expo)](https://expo.dev)
[![React Native](https://img.shields.io/badge/React%20Native-0.76-61DAFB?logo=react)](https://reactnative.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript)](https://www.typescriptlang.org)

移动端实时希区柯克变焦（Dolly Zoom）摄像应用。用户手持手机靠近被摄人物时，APP通过实时人脸检测 + 动态变焦控制自动保持人脸大小不变，产生经典的透视拉伸视觉效果。

<p align="center">
  <em>「用户靠近 → 人脸变大 → APP缩小zoom → 人脸回中 → 背景透视拉伸」</em>
</p>

## 效果原理

```
用户靠近被摄体（物理距离 D 减小）
  → 人脸在画面中变大（像素尺寸 P 增大）
  → APP 自动缩小 zoom（Z 减小）
  → 人脸像素尺寸 P 回到目标值
  → 结果：人脸大小不变，背景视角变宽（透视拉伸）
```

## 技术栈

| 层 | 技术 |
|---|---|
| **框架** | React Native + Expo SDK 52 |
| **摄像头** | `expo-camera` ~16.0 (CameraView) |
| **人脸检测** | `expo-face-detector` ~13.0 |
| **媒体存储** | `expo-media-library` ~17.0 |
| **语言** | TypeScript 5.3 |

## 核心算法

### 控制循环（每帧执行）

```
Error = targetFaceSize / facePixelSize
       // >1 → 人脸太小，需 zoom in
       // <1 → 人脸太大，需 zoom out

correctedZoom = currentZoom × Error
outputZoom = EMA(lastOutput, correctedZoom, smoothingFactor)
outputZoom = clamp(outputZoom, MIN_ZOOM, MAX_ZOOM)
```

### 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `smoothingFactor` | 0.15 | EMA 平滑系数，防抖 |
| `MIN_ZOOM` | 1.0 | 最小 zoom（广角端） |
| `MAX_ZOOM` | 10.0 | 最大 zoom（长焦端） |
| `DETECTION_INTERVAL` | 100ms | 人脸检测轮询间隔 |

## 项目结构

```
hitchcock-lens/
├── App.tsx                          # 应用入口，模块协调
├── src/
│   ├── components/
│   │   ├── CameraScreen.tsx         # 摄像头预览主界面
│   │   ├── FaceLockIndicator.tsx    # 人脸锁定指示器
│   │   ├── RecordButton.tsx         # 录制按钮
│   │   ├── SettingsPanel.tsx        # 设置面板
│   │   └── ZoomDisplay.tsx          # Zoom 数值显示
│   ├── hooks/
│   │   ├── useCamera.ts             # 摄像头管理 Hook
│   │   ├── useFaceDetection.ts      # 人脸检测 Hook
│   │   └── useZoomControl.ts        # 变焦控制 Hook
│   ├── utils/
│   │   └── ZoomController.ts        # 核心变焦控制算法
│   └── types/
│       └── index.ts                 # 类型定义
├── SPEC.md                          # 详细设计规格
├── BATTLE_PLAN.md                   # 构建计划
├── TEST_PLAN.md                     # 测试方案
└── README.md                        # 本文件
```

## 安装与运行

```bash
# 安装依赖
npm install

# 启动 Expo 开发服务器
npx expo start

# 直接构建 Android APK
npm run prebuild
npm run build:apk
```

## 数据流

```
[CameraView] ──定时捕获帧──→ [expo-face-detector]
                                    ↓
                         [useFaceDetection] → faceWidth
                                    ↓
                          [useZoomControl] → targetZoom
                                    ↓
                    setNormalizedZoom → [CameraView.zoom]
                                    ↓
                              displayZoom → [ZoomDisplay]
```

## 功能

- [x] 实时人脸检测 + 锁定
- [x] 自动希区柯克变焦控制
- [x] 前后摄像头切换
- [x] 手电筒控制
- [x] 视频录制 + 保存到相册
- [x] Zoom 数值实时显示
- [x] 灵敏度/平滑度可调

## 许可

MIT © [codes0ar](https://github.com/codes0ar)
