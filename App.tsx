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
import * as FileSystem from 'expo-file-system';

import type { AppSettings } from './src/types';
import { useCamera } from './src/hooks/useCamera';
import { useFaceDetection } from './src/hooks/useFaceDetection';
import { useZoomControl } from './src/hooks/useZoomControl';
import type { ControlMode } from './src/utils/ZoomController';
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
    uwActive,
    equivZoomFactor,
    hasPermission,
    requestAllPermissions,
    facing,
    zoom: _zoom,
    zoomFactor,
    isTorchOn,
    recordingStatus,
    minZoomRatio,
    minZoomEquiv,
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

  const { displayZoom, isLocked, debugInfo, resetZoom, setTargetSize, setControlMode, setTuneParams } = useZoomControl({
    currentZoomRatio: getCurrentZoomRatio(),
    setNormalizedZoom,
    faceLockStatus: lockStatus,
    primaryFaceWidth,
    maxZoomRatio,
    minZoomRatio: minZoomEquiv,
    kp: pidKp,
    ki: pidKi,
    kd: pidKd,
  });

  /**
   * 控制模式（三档循环）：
   *  'pid' 纯PID(默认, 动态A/B误差最小) | 'smooth' +卡尔曼平滑(滞后使误差+17%, 弃用)
   *  | 'lead' 平滑+前馈(实测负优化)
   */
  const [controlMode, setControlModeState] = useState<ControlMode>('pid');
  useEffect(() => {
    setControlMode(controlMode);
  }, [controlMode, setControlMode]);

  /**
   * 调优热加载：每 2s 轮询 /sdcard/Download/hitchcock_tune.json，
   * 内容变化时把 mode/gains/控制器参数热应用（resetState 由控制器处理，保留锁定）。
   * 文件不存在或解析失败则静默跳过——日常使用零开销。
   */
  const tuneContentRef = useRef('');
  const tuneErrLoggedRef = useRef(false);
  useEffect(() => {
    const TUNE_PATH = '/sdcard/Android/data/com.example.hitchcockcamera/files/hitchcock_tune.json';
    const timer = setInterval(async () => {
      try {
        let content: string;
        try {
          content = await FileSystem.readAsStringAsync('file://' + TUNE_PATH);
        } catch (e1) {
          content = await FileSystem.readAsStringAsync(TUNE_PATH);
        }
        if (content === tuneContentRef.current) return;
        tuneContentRef.current = content;
        const p = JSON.parse(content);
        if (p.mode === 'pid' || p.mode === 'smooth' || p.mode === 'lead') {
          setControlModeState(p.mode);
        }
        if (typeof p.kp === 'number') setPidKp(p.kp);
        if (typeof p.ki === 'number') setPidKi(p.ki);
        if (typeof p.kd === 'number') setPidKd(p.kd);
        setTuneParams({
          tuneId: p.tuneId, kfQS: p.kfQS, kfQV: p.kfQV, kfR: p.kfR,
          tLag: p.tLag, rdClamp: p.rdClamp, leadClamp: p.leadClamp,
          deadband: p.deadband, outputTau: p.outputTau, resetState: p.resetState,
        });
        console.log('[Tune] id=' + p.tuneId + ' applied: ' + content.replace(/\s+/g, ' ').slice(0, 160));
      } catch (e) {
        // 文件不存在/解析失败：跳过；但首个错误打印一次便于诊断
        if (!tuneErrLoggedRef.current) {
          tuneErrLoggedRef.current = true;
          console.log('[Tune] read/parse error: ' + String(e).slice(0, 200));
        }
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [setTuneParams]);

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
      zoomEquiv={equivZoomFactor}
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
      displayZoom={uwActive ? equivZoomFactor : displayZoom}
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
      controlMode={controlMode}
      onCycleControlMode={() =>
        setControlModeState((m) => (m === 'pid' ? 'smooth' : m === 'smooth' ? 'lead' : 'pid'))
      }
      onRequestPermission={handleRequestPermission}
    />
  );
}
