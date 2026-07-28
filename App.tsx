/**
 * App.tsx — 希区柯克变焦摄像APP入口 (vision-camera 版)
 *
 * 数据流:
 *   [vision-camera Camera] ──帧处理器──→ [onFacesDetected] → primaryFaceWidth
 *     → [useZoomControl] → targetZoom → setNormalizedZoom → [Camera.zoom]
 *     → [Camera.startRecording] 录像中实时变焦 = dolly-zoom
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
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
  /** PID 增益, slider 实时调节 */
  const [pidKp, setPidKp] = useState(0.8);
  const [pidKi, setPidKi] = useState(0.02);
  const [pidKd, setPidKd] = useState(0.03);
  /** 录制时的黄色参考框(固定屏幕位置, 提示用户保持人脸居中+控制移动速度) */
  const [referenceBounds, setReferenceBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

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
    setZoomFromRatio,
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
    faceDebug,
  } = useFaceDetection();

  const { displayZoom, isLocked, debugInfo, resetZoom, setTargetSize, setKalmanLead } = useZoomControl({
    currentZoomRatio: getCurrentZoomRatio(),
    setNormalizedZoom,
    faceLockStatus: lockStatus,
    primaryFaceWidth,
    maxZoomRatio,
    minZoomRatio,
    kp: pidKp,
    ki: pidKi,
    kd: pidKd,
  });

  /** 控制模式开关：true=PID+卡尔曼+前馈(实测负优化), false=纯PID(默认,实测最优) */
  const [kalmanLeadEnabled, setKalmanLeadEnabled] = useState(false);
  useEffect(() => {
    setKalmanLead(kalmanLeadEnabled);
  }, [kalmanLeadEnabled, setKalmanLead]);

  const handleUpdateSettings = useCallback(
    (partial: Partial<AppSettings>) => {
      setSettings((prev) => ({ ...prev, ...partial }));
    },
    []
  );

  /** 手动解锁/手动调整 zoom 的时间戳（防止状态残留） */
  const manualUnlockRef = useRef(0);

  const handleToggleRecording = useCallback(async () => {
    if (recordingStatus === 'idle') {
      // 捕获当前人脸框作为黄色参考(固定位置, 不随脸移动)
      setReferenceBounds(primaryFaceBounds);
      // PID 目标直接用黄框宽度：控制回路 = 绿框宽 → 黄框宽
      if (primaryFaceBounds && primaryFaceBounds.width > 0) {
        setTargetSize(primaryFaceBounds.width);
      }
      try {
        await startRecording();
      } catch (error) {
        console.error('[App] 开始录制失败:', error);
        Alert.alert('录制失败', '无法开始录制，请重试');
      }
    } else if (recordingStatus === 'recording') {
      setReferenceBounds(null);
      // 停止录制后复位：清 PID 目标 + 解锁 + zoom 回 1x，避免卡在录制时的 zoom
      manualUnlockRef.current = Date.now();
      resetZoom();
      unlock();
      try {
        const result = await stopRecording();
        console.log('[App] 录制完成:', result);
      } catch (error) {
        console.error('[App] 停止录制失败:', error);
        Alert.alert('保存失败', '视频保存时出错');
      }
    }
  }, [recordingStatus, startRecording, stopRecording, primaryFaceBounds, setTargetSize, resetZoom, unlock]);

  const handleRequestPermission = useCallback(async () => {
    const granted = await requestAllPermissions();
    if (!granted) {
      Alert.alert('权限被拒绝', '需要摄像头权限才能使用此应用，请在设置中开启。');
    }
  }, [requestAllPermissions]);

  // 注意: 已移除自动锁定。预览模式下 zoom 由手动 slider 控制，
  // 锁定只通过 🔒 按钮显式触发；录制时自动以黄框尺寸为目标。
  // 这样手动 zoom slider 不会被控制器覆写，也不会被自动锁定隐藏。

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

  /** 手动 zoom：用户拖动 slider 时优先于控制器（若处于锁定则先解锁） */
  const handleManualZoom = useCallback(
    (normalized: number) => {
      if (isLocked) {
        manualUnlockRef.current = Date.now();
        resetZoom();
        unlock();
      }
      setNormalizedZoom(normalized);
    },
    [isLocked, resetZoom, unlock, setNormalizedZoom]
  );

  /** 捏合缩放：按真实变焦倍数(1~4x)做乘法，避免归一化 0 基线导致 1x 时捏合无效 */
  const handleManualZoomRatio = useCallback(
    (ratio: number) => {
      if (isLocked) {
        manualUnlockRef.current = Date.now();
        resetZoom();
        unlock();
      }
      setZoomFromRatio(ratio);
    },
    [isLocked, resetZoom, unlock, setZoomFromRatio]
  );

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
      referenceBounds={referenceBounds}
      onFacesDetected={onFacesDetected}
      faceLockStatus={lockStatus}
      recordingStatus={recordingStatus}
      onToggleRecording={handleToggleRecording}
      displayZoom={displayZoom}
      isLocked={isLocked}
      onToggleLock={handleToggleLock}
      onManualZoom={handleManualZoom}
      onManualZoomRatio={handleManualZoomRatio}
      debugInfo={debugInfo}
      faceDebug={faceDebug}
      onToggleFacing={toggleFacing}
      onToggleFlash={toggleFlash}
      settings={settings}
      onUpdateSettings={handleUpdateSettings}
      pidKp={pidKp}
      pidKi={pidKi}
      pidKd={pidKd}
      onUpdatePidKp={setPidKp}
      onUpdatePidKi={setPidKi}
      onUpdatePidKd={setPidKd}
      kalmanLeadEnabled={kalmanLeadEnabled}
      onToggleKalmanLead={() => setKalmanLeadEnabled((v) => !v)}
      onRequestPermission={handleRequestPermission}
    />
  );
}
