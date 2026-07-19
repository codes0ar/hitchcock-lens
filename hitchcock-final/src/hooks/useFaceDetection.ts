/**
 * useFaceDetection.ts — 人脸检测Hook
 *
 * 职责: 通过 expo-face-detector 实现人脸检测
 * 处理人脸检测结果，提取主要人脸并跟踪其像素尺寸
 *
 * 注意: expo-camera v16 的 CameraView 不直接内置 onFacesDetected 回调。
 * 本实现使用定时轮询 + CameraView.takePictureAsync 捕获帧，
 * 然后通过 expo-face-detector 的 detectFacesAsync 进行人脸检测。
 * 在实际项目中，也可以考虑使用 react-native-vision-camera 的 Frame Processor。
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import * as FaceDetector from 'expo-face-detector';
import { CameraView } from 'expo-camera';

import type { FaceData, FaceLockStatus } from '../types';

/** 定时检测间隔（毫秒） */
const DETECTION_INTERVAL_MS = 100;

/** 人脸丢失容忍帧数 */
const NO_FACE_TOLERANCE_FRAMES = 30;

/**
 * 将 expo-face-detector 的 FaceFeature 转换为内部 FaceData 格式
 */
function convertFaceFeature(feature: FaceDetector.FaceFeature): FaceData {
  return {
    bounds: {
      x: feature.bounds.origin.x,
      y: feature.bounds.origin.y,
      width: feature.bounds.size.width,
      height: feature.bounds.size.height,
    },
    faceID: feature.faceID ?? 0,
  };
}

/**
 * 人脸检测Hook
 * @param cameraRef - CameraView 引用，用于捕获帧
 * @returns 人脸检测状态和处理函数
 */
export function useFaceDetection(
  cameraRef: React.RefObject<CameraView | null>
) {
  // === 状态 ===
  /** 检测到的人脸列表 */
  const [faces, setFaces] = useState<FaceData[]>([]);
  /** 人脸锁定状态 */
  const [lockStatus, setLockStatus] = useState<FaceLockStatus>('no-face');
  /** 主要人脸的像素宽度（用于zoom控制） */
  const [primaryFaceWidth, setPrimaryFaceWidth] = useState<number>(0);
  /** 主要人脸的像素高度 */
  const [primaryFaceHeight, setPrimaryFaceHeight] = useState<number>(0);

  // === Refs ===
  /** 人脸丢失计数器（连续多帧未检测到则重置锁定） */
  const noFaceFrameCount = useRef(0);
  /** 是否正在检测中 */
  const isDetectingRef = useRef(false);
  /** 定时器引用 */
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 锁定状态持久化（避免闪烁） */
  const lockedFaceRef = useRef<FaceData | null>(null);

  /**
   * 从检测到的人脸列表中选择主要人脸
   * 选择策略: 选择面积最大的人脸（通常是最靠近相机的人）
   */
  const selectPrimaryFace = useCallback(
    (detectedFaces: FaceData[]): FaceData | null => {
      if (detectedFaces.length === 0) return null;

      let primary = detectedFaces[0];
      let maxArea = primary.bounds.width * primary.bounds.height;

      for (let i = 1; i < detectedFaces.length; i++) {
        const face = detectedFaces[i];
        const area = face.bounds.width * face.bounds.height;
        if (area > maxArea) {
          maxArea = area;
          primary = face;
        }
      }

      return primary;
    },
    []
  );

  /**
   * 执行一次人脸检测
   * 捕获预览帧并通过 expo-face-detector 检测人脸
   */
  const performDetection = useCallback(async () => {
    // 防止并发检测
    if (isDetectingRef.current) return;
    if (!cameraRef.current) return;

    isDetectingRef.current = true;

    try {
      // 捕获一帧快照（低质量、快速度）
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.1, // 低质量以提高速度
        skipProcessing: true, // 跳过处理，直接获取原始帧
      });

      if (!photo?.uri) return;

      // 使用 expo-face-detector 检测人脸
      const result = await FaceDetector.detectFacesAsync(photo.uri, {
        mode: FaceDetector.FaceDetectorMode.accurate,
        detectLandmarks: FaceDetector.FaceDetectorLandmarks.none,
        runClassifications: FaceDetector.FaceDetectorClassifications.none,
        minDetectionInterval: 50,
        tracking: true,
      });

      // 转换人脸数据
      const detectedFaces: FaceData[] = (result.faces ?? [])
        .map(convertFaceFeature)
        .filter((face: FaceData) => face.bounds.width > 0 && face.bounds.height > 0);

      setFaces(detectedFaces);

      if (detectedFaces.length === 0) {
        // 未检测到人脸
        noFaceFrameCount.current += 1;
        if (noFaceFrameCount.current >= NO_FACE_TOLERANCE_FRAMES) {
          setLockStatus('no-face');
          lockedFaceRef.current = null;
          setPrimaryFaceWidth(0);
          setPrimaryFaceHeight(0);
        }
      } else {
        // 检测到人脸
        noFaceFrameCount.current = 0;
        const primary = selectPrimaryFace(detectedFaces);

        if (primary) {
          setPrimaryFaceWidth(primary.bounds.width);
          setPrimaryFaceHeight(primary.bounds.height);
          lockedFaceRef.current = primary;

          setLockStatus((prev) => {
            if (prev === 'no-face') return 'detected';
            return prev;
          });
        }
      }
    } catch (error) {
      // 静默处理检测错误（如摄像头未就绪）
      // console.debug('[useFaceDetection] 检测帧失败:', error);
    } finally {
      isDetectingRef.current = false;
    }
  }, [cameraRef, selectPrimaryFace]);

  /**
   * 启动定时人脸检测
   */
  const startDetection = useCallback(() => {
    // 清除已有定时器
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    // 设置新定时器
    timerRef.current = setInterval(() => {
      performDetection();
    }, DETECTION_INTERVAL_MS);
  }, [performDetection]);

  /**
   * 停止定时人脸检测
   */
  const stopDetection = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 组件挂载时启动检测，卸载时停止
  useEffect(() => {
    startDetection();
    return () => {
      stopDetection();
    };
  }, [startDetection, stopDetection]);

  /**
   * 确认人脸锁定（用户确认或自动确认）
   * 通常在首次检测到人脸并记录目标尺寸后调用
   */
  const confirmLock = useCallback(() => {
    if (faces.length > 0) {
      setLockStatus('locked');
    }
  }, [faces.length]);

  /**
   * 强制设置锁定状态
   */
  const setLocked = useCallback((locked: boolean) => {
    setLockStatus(locked ? 'locked' : faces.length > 0 ? 'detected' : 'no-face');
  }, [faces.length]);

  /**
   * 重置人脸检测状态
   */
  const reset = useCallback(() => {
    setFaces([]);
    setLockStatus('no-face');
    setPrimaryFaceWidth(0);
    setPrimaryFaceHeight(0);
    noFaceFrameCount.current = 0;
    lockedFaceRef.current = null;
  }, []);

  return {
    // 状态
    faces,
    lockStatus,
    primaryFaceWidth,
    primaryFaceHeight,
    // 控制函数
    confirmLock,
    setLocked,
    reset,
    startDetection,
    stopDetection,
  };
}
