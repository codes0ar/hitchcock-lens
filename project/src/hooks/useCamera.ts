/**
 * useCamera.ts — 摄像头管理Hook
 *
 * 职责: 管理摄像头权限、预览流、zoom控制、录像开始/停止
 * 封装 expo-camera 的 CameraView 相关操作
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import {
  CameraView,
  useCameraPermissions,
  CameraType,
  FlashMode as CameraFlashMode,
} from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';

import type {
  CameraFacing,
  FlashMode,
  RecordingStatus,
  VideoRecordResult,
} from '../types';

/**
 * 将前端 facing 类型转换为 expo-camera 的 CameraType
 */
function toCameraType(facing: CameraFacing): CameraType {
  return facing === 'front' ? 'front' : 'back';
}

/**
 * 将前端 flashMode 转换为 expo-camera 的 FlashMode
 */
function toCameraFlashMode(mode: FlashMode): CameraFlashMode {
  switch (mode) {
    case 'on':
      return 'on';
    case 'auto':
      return 'auto';
    case 'off':
    default:
      return 'off';
  }
}

/**
 * 摄像头管理Hook
 * @returns 摄像头状态和控制函数
 */
export function useCamera() {
  // === Refs ===
  /** CameraView 组件引用 */
  const cameraRef = useRef<CameraView>(null);

  // === 权限状态 ===
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] =
    MediaLibrary.usePermissions();

  // === 摄像头状态 ===
  const [facing, setFacing] = useState<CameraFacing>('back');
  const [flashMode, setFlashMode] = useState<FlashMode>('off');
  const [zoom, setZoom] = useState(0); // 归一化zoom值 [0, 1]
  const [recordingStatus, setRecordingStatus] =
    useState<RecordingStatus>('idle');
  const [isTorchOn, setIsTorchOn] = useState(false);

  // === 设备Zoom范围 ===
  // expo-camera 的 zoom 属性使用归一化值 [0, 1]
  // 实际zoom倍数由设备决定
  const minZoomRatio = 1.0;
  const maxZoomRatio = 10.0; // 设备相关，这里使用通用上限

  /**
   * 请求所有必要权限（摄像头 + 媒体库）
   */
  const requestAllPermissions = useCallback(async (): Promise<boolean> => {
    let cameraGranted = cameraPermission?.granted ?? false;
    let mediaGranted = mediaPermission?.granted ?? false;

    if (!cameraGranted) {
      const result = await requestCameraPermission();
      cameraGranted = result.granted;
    }

    if (!mediaGranted) {
      const result = await requestMediaPermission();
      mediaGranted = result.granted;
    }

    return cameraGranted;
  }, [
    cameraPermission?.granted,
    mediaPermission?.granted,
    requestCameraPermission,
    requestMediaPermission,
  ]);

  /**
   * 切换前后摄像头
   */
  const toggleFacing = useCallback(() => {
    setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
  }, []);

  /**
   * 切换手电筒模式
   */
  const toggleFlash = useCallback(() => {
    setFlashMode((prev) => {
      if (prev === 'off') return 'on';
      if (prev === 'on') return 'auto';
      return 'off';
    });
    setIsTorchOn((prev) => !prev);
  }, []);

  /**
   * 设置归一化zoom值
   * @param normalizedZoom - [0, 1] 范围内的归一化值
   */
  const setNormalizedZoom = useCallback((normalizedZoom: number) => {
    const clamped = Math.max(0, Math.min(1, normalizedZoom));
    setZoom(clamped);
  }, []);

  /**
   * 根据zoom倍数设置归一化zoom
   * @param zoomRatio - zoom倍数（如 2.0 表示2倍zoom）
   */
  const setZoomFromRatio = useCallback(
    (zoomRatio: number) => {
      const normalized =
        (zoomRatio - minZoomRatio) / (maxZoomRatio - minZoomRatio);
      setZoom(Math.max(0, Math.min(1, normalized)));
    },
    [minZoomRatio, maxZoomRatio]
  );

  /**
   * 获取当前zoom倍数
   * @returns 当前zoom倍数
   */
  const getCurrentZoomRatio = useCallback((): number => {
    return minZoomRatio + zoom * (maxZoomRatio - minZoomRatio);
  }, [zoom]);

  /**
   * 开始录像
   */
  const startRecording = useCallback(async (): Promise<void> => {
    if (recordingStatus === 'recording') {
      console.warn('[useCamera] 正在录制中，无法重复开始');
      return;
    }

    if (!cameraRef.current) {
      throw new Error('摄像头未初始化');
    }

    try {
      setRecordingStatus('recording');

      await cameraRef.current.recordAsync({
        maxDuration: 60, // 最长录制60秒
        mute: false,
      });

      // recordAsync 会在录制完成后通过Promise返回结果
      // 但我们通过 stopRecording 来主动停止
    } catch (error) {
      setRecordingStatus('idle');
      console.error('[useCamera] 开始录像失败:', error);
      throw error;
    }
  }, [recordingStatus]);

  /**
   * 停止录像并保存到相册
   * @returns 录制的视频信息
   */
  const stopRecording = useCallback(async (): Promise<VideoRecordResult> => {
    if (recordingStatus !== 'recording') {
      throw new Error('当前未在录制状态');
    }

    setRecordingStatus('stopping');

    try {
      if (!cameraRef.current) {
        throw new Error('摄像头引用不存在');
      }

      // 停止录制并获取视频URI
      const result = await cameraRef.current.stopRecording();

      if (!result || !result.uri) {
        throw new Error('录像结果为空');
      }

      setRecordingStatus('saving');

      // 保存到相册
      try {
        if (mediaPermission?.granted) {
          await MediaLibrary.saveToLibraryAsync(result.uri);
          console.log('[useCamera] 视频已保存到相册:', result.uri);
        }
      } catch (saveError) {
        console.warn('[useCamera] 保存到相册失败:', saveError);
        // 不阻塞返回，用户仍可获得视频文件
      }

      setRecordingStatus('idle');

      return {
        uri: result.uri,
        duration: result.duration ?? 0,
        size: result.size ?? undefined,
      };
    } catch (error) {
      setRecordingStatus('idle');
      console.error('[useCamera] 停止录像失败:', error);
      throw error;
    }
  }, [recordingStatus, mediaPermission?.granted]);

  /**
   * 切换录制状态（开始/停止）
   */
  const toggleRecording = useCallback(async (): Promise<VideoRecordResult | void> => {
    if (recordingStatus === 'idle') {
      await startRecording();
    } else if (recordingStatus === 'recording') {
      return await stopRecording();
    }
  }, [recordingStatus, startRecording, stopRecording]);

  // 组件卸载时确保停止录制
  useEffect(() => {
    return () => {
      if (cameraRef.current && recordingStatus === 'recording') {
        cameraRef.current.stopRecording().catch(() => {
          // 静默处理清理错误
        });
      }
    };
  }, [recordingStatus]);

  return {
    // Refs
    cameraRef,
    // 权限状态
    cameraPermission,
    mediaPermission,
    requestAllPermissions,
    // 摄像头状态
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
    setZoomFromRatio,
    getCurrentZoomRatio,
    startRecording,
    stopRecording,
    toggleRecording,
    // 直接映射给CameraView的属性
    cameraType: toCameraType(facing),
    cameraFlashMode: toCameraFlashMode(flashMode),
  };
}
