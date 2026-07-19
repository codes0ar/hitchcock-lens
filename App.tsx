/**
 * App.tsx — 希区柯克变焦摄像APP入口 (vision-camera 版)
 *
 * 数据流:
 *   [vision-camera Camera] ──帧处理器──→ [onFacesDetected] → primaryFaceWidth
 *     → [useZoomControl] → targetZoom → setNormalizedZoom → [Camera.zoom]
 *     → [Camera.startRecording] 录像中实时变焦 = dolly-zoom
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import type { AppSettings } from './src/types';
import { useCamera } from './src/hooks/useCamera';
import { useFaceDetection } from './src/hooks/useFaceDetection';
import { useZoomControl } from './src/hooks/useZoomControl';
import { CameraScreen } from './src/components/CameraScreen';

const DEFAULT_SETTINGS: AppSettings = {
  sensitivity: 0.15,
  smoothness: 0.25,
};

export default function App(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  const {
    cameraRef,
    device,
    hasPermission,
    requestAllPermissions,
    facing,
    zoom: _zoom,
    zoomFactor,
    isTorchOn,
    recordingStatus,
    minZoomRatio,
    maxZoomRatio,
    cameraReady,
    onCameraReady,
    toggleFacing,
    toggleFlash,
    setNormalizedZoom,
    getCurrentZoomRatio,
    startRecording,
    stopRecording,
  } = useCamera();

  const {
    lockStatus,
    primaryFaceWidth,
    primaryFaceBounds,
    onFacesDetected,
    confirmLock,
    unlock,
  } = useFaceDetection();

  const { displayZoom, isLocked, resetZoom } = useZoomControl({
    currentZoomRatio: getCurrentZoomRatio(),
    setNormalizedZoom,
    faceLockStatus: lockStatus,
    primaryFaceWidth,
    settings,
    maxZoomRatio,
    minZoomRatio,
  });

  const handleUpdateSettings = useCallback(
    (partial: Partial<AppSettings>) => {
      setSettings((prev) => ({ ...prev, ...partial }));
    },
    []
  );

  const handleToggleRecording = useCallback(async () => {
    if (recordingStatus === 'idle') {
      try {
        await startRecording();
      } catch (error) {
        console.error('[App] 开始录制失败:', error);
        Alert.alert('录制失败', '无法开始录制，请重试');
      }
    } else if (recordingStatus === 'recording') {
      try {
        const result = await stopRecording();
        console.log('[App] 录制完成:', result);
      } catch (error) {
        console.error('[App] 停止录制失败:', error);
        Alert.alert('保存失败', '视频保存时出错');
      }
    }
  }, [recordingStatus, startRecording, stopRecording]);

  const handleRequestPermission = useCallback(async () => {
    const granted = await requestAllPermissions();
    if (!granted) {
      Alert.alert('权限被拒绝', '需要摄像头权限才能使用此应用，请在设置中开启。');
    }
  }, [requestAllPermissions]);

  // 人脸检测到后自动确认锁定（记录初始人脸尺寸作为 dolly-zoom 目标）
  // 注意: 不依赖 primaryFaceWidth(每帧变会导致 timer 反复清除, 永远锁不上)
  // 解锁后 2 秒内不自动重锁(给用户时间手动调整 zoom/构图)
  const manualUnlockRef = useRef(0);
  useEffect(() => {
    if (lockStatus === 'detected' && !isLocked && Date.now() - manualUnlockRef.current > 2000) {
      const timer = setTimeout(() => confirmLock(), 800);
      return () => clearTimeout(timer);
    }
  }, [lockStatus, isLocked, confirmLock]);

  /** 手动锁定/解锁切换 */
  const handleToggleLock = useCallback(() => {
    if (isLocked) {
      manualUnlockRef.current = Date.now();
      resetZoom(); // 清除目标
      unlock(); // lockStatus → detected, 允许手动调整
    } else {
      confirmLock(); // 锁定: 记录当前 faceW 为目标
    }
  }, [isLocked, resetZoom, unlock, confirmLock]);

  return (
    <CameraScreen
      cameraRef={cameraRef}
      device={device}
      facing={facing}
      zoom={zoomFactor}
      zoomNormalized={_zoom}
      isTorchOn={isTorchOn}
      hasPermission={hasPermission}
      cameraReady={cameraReady}
      onCameraReady={onCameraReady}
      faceBounds={primaryFaceBounds}
      onFacesDetected={onFacesDetected}
      faceLockStatus={lockStatus}
      recordingStatus={recordingStatus}
      onToggleRecording={handleToggleRecording}
      displayZoom={displayZoom}
      isLocked={isLocked}
      onToggleLock={handleToggleLock}
      onManualZoom={setNormalizedZoom}
      onToggleFacing={toggleFacing}
      onToggleFlash={toggleFlash}
      settings={settings}
      onUpdateSettings={handleUpdateSettings}
      onRequestPermission={handleRequestPermission}
    />
  );
}
