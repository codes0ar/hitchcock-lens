/**
 * App.tsx — 希区柯克变焦摄像APP入口组件
 *
 * 职责: 整合所有模块，管理全局状态（设置、权限），
 * 协调摄像头、人脸检测和变焦控制之间的数据流
 *
 * 数据流:
 *   [CameraView] ──定时捕获帧──→ [expo-face-detector]
 *                                           ↓
 *                              [useFaceDetection] → faceWidth
 *                                           ↓
 *                              [useZoomControl] → targetZoom
 *                                           ↓
 *                              setNormalizedZoom → [CameraView.zoom]
 *                                           ↓
 *                              displayZoom → [ZoomDisplay]
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  Alert,
} from 'react-native';

import type { AppSettings } from './src/types';
import { useCamera } from './src/hooks/useCamera';
import { useFaceDetection } from './src/hooks/useFaceDetection';
import { useZoomControl } from './src/hooks/useZoomControl';
import { CameraScreen } from './src/components/CameraScreen';

/** 默认应用设置 */
const DEFAULT_SETTINGS: AppSettings = {
  sensitivity: 0.15, // 默认灵敏度
  smoothness: 0.15, // 默认EMA平滑系数
};

/**
 * 应用根组件
 * 管理全局状态，协调各模块之间的数据传递
 */
export default function App(): JSX.Element {
  // === 全局设置状态 ===
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  // === 初始化摄像头管理Hook ===
  const {
    // Refs
    cameraRef,
    // 权限
    cameraPermission,
    requestAllPermissions,
    // 状态
    facing,
    flashMode,
    zoom,
    isTorchOn,
    recordingStatus,
    // 设备信息
    minZoomRatio,
    maxZoomRatio,
    // 控制函数
    toggleFacing,
    toggleFlash,
    setNormalizedZoom,
    getCurrentZoomRatio,
    startRecording,
    stopRecording,
    // 属性
    cameraType,
    cameraFlashMode,
  } = useCamera();

  // === 初始化人脸检测Hook（传入cameraRef用于定时捕获帧） ===
  const {
    lockStatus,
    primaryFaceWidth,
    confirmLock,
  } = useFaceDetection(cameraRef);

  // === 初始化Zoom控制Hook ===
  const {
    displayZoom,
    isLocked,
  } = useZoomControl({
    currentZoomRatio: getCurrentZoomRatio(),
    setNormalizedZoom,
    faceLockStatus: lockStatus,
    primaryFaceWidth,
    settings,
    maxZoomRatio,
    minZoomRatio,
  });

  // === 处理设置变更 ===
  const handleUpdateSettings = useCallback(
    (partial: Partial<AppSettings>) => {
      setSettings((prev) => ({ ...prev, ...partial }));
    },
    []
  );

  // === 处理录制切换 ===
  const handleToggleRecording = useCallback(async () => {
    if (recordingStatus === 'idle') {
      // 开始录制
      try {
        await startRecording();
      } catch (error) {
        console.error('[App] 开始录制失败:', error);
        Alert.alert('录制失败', '无法开始录制，请重试');
      }
    } else if (recordingStatus === 'recording') {
      // 停止录制
      try {
        const result = await stopRecording();
        console.log('[App] 录制完成:', result);
        // 可以在这里添加预览或分享逻辑
      } catch (error) {
        console.error('[App] 停止录制失败:', error);
        Alert.alert('保存失败', '视频保存时出错');
      }
    }
  }, [recordingStatus, startRecording, stopRecording]);

  // === 处理权限请求 ===
  const handleRequestPermission = useCallback(async () => {
    const granted = await requestAllPermissions();
    if (!granted) {
      Alert.alert(
        '权限被拒绝',
        '需要摄像头权限才能使用此应用，请在设置中开启。'
      );
    }
  }, [requestAllPermissions]);

  // === 监听人脸状态变化，自动确认锁定 ===
  useEffect(() => {
    // 当人脸从 detected 变为有有效宽度时，自动确认锁定
    if (lockStatus === 'detected' && primaryFaceWidth > 0 && !isLocked) {
      // 短暂延迟确保人脸稳定
      const timer = setTimeout(() => {
        confirmLock();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [lockStatus, primaryFaceWidth, isLocked, confirmLock]);

  // === 监听设置变化 ===
  useEffect(() => {
    console.log('[App] 设置已更新:', settings);
  }, [settings]);

  return (
    <CameraScreen
      // 摄像头
      cameraRef={cameraRef}
      facing={cameraType}
      flashMode={cameraFlashMode}
      zoom={zoom}
      cameraPermission={cameraPermission}
      // 人脸检测
      faceLockStatus={lockStatus}
      // 录像
      recordingStatus={recordingStatus}
      onToggleRecording={handleToggleRecording}
      // Zoom显示
      displayZoom={displayZoom}
      // 控制
      onToggleFacing={toggleFacing}
      onToggleFlash={toggleFlash}
      isTorchOn={isTorchOn}
      // 设置
      settings={settings}
      onUpdateSettings={handleUpdateSettings}
      // 权限
      onRequestPermission={handleRequestPermission}
    />
  );
}
