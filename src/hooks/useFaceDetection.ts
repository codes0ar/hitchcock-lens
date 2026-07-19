/**
 * useFaceDetection.ts — 人脸检测Hook (vision-camera 帧处理器驱动)
 *
 * 变更: 从 expo-face-detector 轮询 takePictureAsync 迁移到 vision-camera
 * 帧处理器实时回调。不再有白屏闪（无静态抓拍），检测频率 ~相机帧率。
 *
 * 调用方把 onFacesDetected 传给 face-detector 的 Camera 组件的 faceDetectionCallback。
 * 注意：autoMode=true 时 bounds 已是屏幕坐标，可直接用于 UI 叠加。
 */

import { useState, useCallback, useRef } from 'react';
import type { Face } from 'react-native-vision-camera-face-detector';
import type { FaceData, FaceLockStatus } from '../types';

/** UI 状态更新节流间隔（ms）。33ms≈30fps, 兼顾响应速度与 React state 开销 */
const UI_THROTTLE_MS = 33;
/** 人脸丢失容忍帧数 */
const NO_FACE_TOLERANCE = 5;
/** 人脸边界滑动平均窗口(仅用于绿框/居中显示, 控制器用原始 faceW 无延迟) */
const SMOOTH_WINDOW = 3;

export function useFaceDetection() {
  const [faces, setFaces] = useState<FaceData[]>([]);
  const [lockStatus, setLockStatus] = useState<FaceLockStatus>('no-face');
  const [primaryFaceWidth, setPrimaryFaceWidth] = useState(0);
  const [primaryFaceHeight, setPrimaryFaceHeight] = useState(0);
  const [primaryFaceBounds, setPrimaryFaceBounds] = useState<{
    x: number; y: number; width: number; height: number;
  } | null>(null);

  const noFaceCount = useRef(0);
  const lastUiTs = useRef(0);
  const lockedFaceRef = useRef<FaceData | null>(null);
  /** ref 跟踪当前是否有脸(confirmLock 用,避免依赖 faces state 导致 callback 重建) */
  const hasFacesRef = useRef(false);
  /** 人脸边界滑动平均窗口(防抖: 平滑检测噪声, 减少 high-zoom 抖动) */
  const boundsHistoryRef = useRef<Array<{ x: number; y: number; width: number; height: number }>>([]);

  /** 帧处理器回调（由 CameraScreen 的 frameProcessor 在每帧调用，经 runOnJS 派发） */
  const onFacesDetected = useCallback((detectedFaces: Face[]) => {
    const now = Date.now();
    if (now - lastUiTs.current < UI_THROTTLE_MS) return;
    lastUiTs.current = now;

    const valid: FaceData[] = (detectedFaces || [])
      .filter((f) => f.bounds && f.bounds.width >= 50 && f.bounds.height >= 50)
      .map((f, i) => ({
        bounds: { x: f.bounds.x, y: f.bounds.y, width: f.bounds.width, height: f.bounds.height },
        faceID: f.trackingId ?? i,
      }));

    setFaces(valid);

    if (valid.length === 0) {
      hasFacesRef.current = false;
      boundsHistoryRef.current = [];
      noFaceCount.current += 1;
      if (noFaceCount.current >= NO_FACE_TOLERANCE) {
        setLockStatus('no-face');
        lockedFaceRef.current = null;
        setPrimaryFaceWidth(0);
        setPrimaryFaceHeight(0);
        setPrimaryFaceBounds(null);
      }
      return;
    }

    noFaceCount.current = 0;
    hasFacesRef.current = true;
    let primary = valid[0];
    let maxArea = primary.bounds.width * primary.bounds.height;
    for (let i = 1; i < valid.length; i++) {
      const a = valid[i].bounds.width * valid[i].bounds.height;
      if (a > maxArea) { maxArea = a; primary = valid[i]; }
    }

    // 滑动平均仅平滑边界(绿框/居中显示用); 控制器用原始 width 保证零延迟响应
    const hist = boundsHistoryRef.current;
    hist.push({ x: primary.bounds.x, y: primary.bounds.y, width: primary.bounds.width, height: primary.bounds.height });
    if (hist.length > SMOOTH_WINDOW) hist.shift();
    const n = hist.length;
    const sum = hist.reduce(
      (a, b) => ({ x: a.x + b.x, y: a.y + b.y, width: a.width + b.width, height: a.height + b.height }),
      { x: 0, y: 0, width: 0, height: 0 }
    );
    const avg = { x: sum.x / n, y: sum.y / n, width: sum.width / n, height: sum.height / n };

    // 控制器用原始 faceW(无 MA 延迟, 避免 overshoot); 显示用平滑 bounds
    setPrimaryFaceWidth(primary.bounds.width);
    setPrimaryFaceHeight(primary.bounds.height);
    setPrimaryFaceBounds(avg);
    lockedFaceRef.current = primary;

    setLockStatus((prev) => (prev === 'no-face' ? 'detected' : prev));
  }, []);

  const confirmLock = useCallback(() => {
    if (hasFacesRef.current) {
      console.log('[useFaceDetection] confirmLock → locked');
      setLockStatus('locked');
    } else {
      console.log('[useFaceDetection] confirmLock 时无人脸, 跳过');
    }
  }, []);

  const reset = useCallback(() => {
    setFaces([]);
    setLockStatus('no-face');
    setPrimaryFaceWidth(0);
    setPrimaryFaceHeight(0);
    setPrimaryFaceBounds(null);
    noFaceCount.current = 0;
    lockedFaceRef.current = null;
  }, []);

  /** 解锁: 回到 detected 状态(脸还在, 但清除锁定, 允许手动重新调整) */
  const unlock = useCallback(() => {
    setLockStatus((prev) => (prev === 'locked' ? 'detected' : prev));
  }, []);

  return {
    faces,
    lockStatus,
    primaryFaceWidth,
    primaryFaceHeight,
    primaryFaceBounds,
    imageDimensions: null, // autoMode=true 时 bounds 已是屏幕坐标，无需图像尺寸映射
    onFacesDetected,
    confirmLock,
    unlock,
    reset,
  };
}
