/**
 * useCamera.ts — 摄像头管理Hook (react-native-vision-camera v4)
 *
 * 职责: 设备选择、权限、zoom控制、录像开始/停止
 * 变更: 从 expo-camera 迁移到 vision-camera，以支持帧处理器(实时人脸检测)与录像并行。
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { PermissionsAndroid } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  type CameraDevice,
  type VideoFile,
} from 'react-native-vision-camera';
import * as MediaLibrary from 'expo-media-library';

import type {
  CameraFacing,
  RecordingStatus,
  VideoRecordResult,
} from '../types';

export function useCamera() {
  const cameraRef = useRef<Camera>(null);
  const recordingPromiseRef = useRef<{ resolve: (v: VideoRecordResult) => void; reject: (e: unknown) => void } | null>(null);

  const [facing, setFacing] = useState<CameraFacing>('back');
  const device = useCameraDevice(facing);

  const { hasPermission, requestPermission } = useCameraPermission();
  const [mediaPermission, requestMediaPermission] =
    MediaLibrary.usePermissions();

  const [zoom, setZoom] = useState(0); // 归一化 [0,1]，0=1x，1=maxZoom（内部状态/控制器用）
  const [flashMode, setFlashMode] = useState<'off' | 'on' | 'auto'>('off');
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [recordingStatus, setRecordingStatus] =
    useState<RecordingStatus>('idle');
  const [cameraReady, setCameraReady] = useState(false);

  // 设备 zoom 范围（vision-camera device.maxZoom 是最大倍数；capped 控制器上限）
  const [minZoomRatio, setMinZoomRatio] = useState(1.0);
  const [maxZoomRatio, setMaxZoomRatio] = useState(10.0);
  /** 传给 vision-camera Camera.zoom 的实际倍数(v4 zoom prop 是倍数不是归一化!) */
  const zoomFactor = minZoomRatio + zoom * (maxZoomRatio - minZoomRatio);

  // 设备变化时更新 zoom 范围(minZoom 可能 <1.0 超广角, maxZoom 上限 15 防止过大)
  useEffect(() => {
    if (device) {
      const devMin = typeof device.minZoom === 'number' && device.minZoom > 0
        ? device.minZoom
        : 1.0;
      const devMax = typeof device.maxZoom === 'number' && device.maxZoom > 1
        ? Math.min(device.maxZoom, 15)
        : 10.0;
      setMinZoomRatio(devMin);
      setMaxZoomRatio(devMax);
      console.log('[useCamera] 设备 zoom 范围: min=' + devMin + ' max=' + devMax + ' neutral=' + (device.neutralZoom ?? 1.0));
    }
  }, [device]);

  const requestAllPermissions = useCallback(async (): Promise<boolean> => {
    let cam = hasPermission;
    if (!cam) {
      const r = await requestPermission();
      cam = r;
    }
    let media = mediaPermission?.granted ?? false;
    if (!media) {
      const r = await requestMediaPermission();
      media = r.granted;
    }
    const mic = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
    );
    if (!mic) {
      await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
      );
    }
    return cam;
  }, [hasPermission, requestPermission, mediaPermission?.granted, requestMediaPermission]);

  const toggleFacing = useCallback(() => {
    setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
  }, []);

  const toggleFlash = useCallback(() => {
    setFlashMode((prev) => {
      if (prev === 'off') return 'on';
      if (prev === 'on') return 'auto';
      return 'off';
    });
    setIsTorchOn((prev) => !prev);
  }, []);

  const setNormalizedZoom = useCallback((normalizedZoom: number) => {
    setZoom(Math.max(0, Math.min(1, normalizedZoom)));
  }, []);

  const setZoomFromRatio = useCallback(
    (zoomRatio: number) => {
      const normalized =
        (zoomRatio - minZoomRatio) / (maxZoomRatio - minZoomRatio);
      setZoom(Math.max(0, Math.min(1, normalized)));
    },
    [minZoomRatio, maxZoomRatio]
  );

  const getCurrentZoomRatio = useCallback((): number => {
    return minZoomRatio + zoom * (maxZoomRatio - minZoomRatio);
  }, [zoom, minZoomRatio, maxZoomRatio]);

  const onCameraReady = useCallback(() => {
    setCameraReady(true);
  }, []);

  const updateZoomRange = useCallback(
    (range: { min?: number; max?: number }) => {
      if (typeof range.min === 'number' && range.min > 0) setMinZoomRatio(range.min);
      if (typeof range.max === 'number' && range.max > 0) setMaxZoomRatio(range.max);
    },
    []
  );

  const startRecording = useCallback(async (): Promise<void> => {
    if (recordingStatus === 'recording') return;
    if (!cameraRef.current) throw new Error('摄像头未初始化');

    const mic = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
    );
    if (!mic) {
      const res = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
      );
      if (res !== 'granted') throw new Error('需要麦克风权限以录制视频');
    }

    setRecordingStatus('recording');
    cameraRef.current.startRecording({
      onRecordingFinished: (video: VideoFile) => {
        setRecordingStatus('saving');
        MediaLibrary.saveToLibraryAsync(video.path)
          .then(() => console.log('[useCamera] 视频已保存到相册:', video.path))
          .catch((e) => console.warn('[useCamera] 保存相册失败:', e))
          .finally(() => {
            setRecordingStatus('idle');
            recordingPromiseRef.current?.resolve({
              uri: video.path,
              duration: video.duration ?? 0,
            });
            recordingPromiseRef.current = null;
          });
      },
      onRecordingError: (error) => {
        console.error('[useCamera] 录制错误:', error);
        setRecordingStatus('idle');
        recordingPromiseRef.current?.reject(error);
        recordingPromiseRef.current = null;
      },
    });
  }, [recordingStatus]);

  const stopRecording = useCallback(async (): Promise<VideoRecordResult> => {
    if (recordingStatus !== 'recording') throw new Error('当前未在录制');
    if (!cameraRef.current) throw new Error('摄像头引用不存在');

    setRecordingStatus('stopping');
    const result = await new Promise<VideoRecordResult>((resolve, reject) => {
      recordingPromiseRef.current = { resolve, reject };
      cameraRef.current!.stopRecording();
    });
    return result;
  }, [recordingStatus]);

  const toggleRecording = useCallback(async (): Promise<VideoRecordResult | void> => {
    if (recordingStatus === 'idle') {
      await startRecording();
    } else if (recordingStatus === 'recording') {
      return await stopRecording();
    }
  }, [recordingStatus, startRecording, stopRecording]);

  useEffect(() => {
    return () => {
      if (recordingStatus === 'recording' && cameraRef.current) {
        try { cameraRef.current.stopRecording(); } catch { /* ignore */ }
      }
    };
  }, [recordingStatus]);

  return {
    cameraRef,
    device,
    hasPermission,
    cameraPermission: { granted: hasPermission },
    requestAllPermissions,
    facing,
    flashMode,
    zoom,
    zoomFactor,
    isTorchOn,
    recordingStatus,
    minZoomRatio,
    maxZoomRatio,
    cameraReady,
    onCameraReady,
    updateZoomRange,
    toggleFacing,
    toggleFlash,
    setNormalizedZoom,
    setZoomFromRatio,
    getCurrentZoomRatio,
    startRecording,
    stopRecording,
    toggleRecording,
  };
}
