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

/** UI 状态更新节流间隔（ms）。帧处理器 30fps，但 React state ~10fps 足够且更省 */
const UI_THROTTLE_MS = 100;
/** 人脸丢失容忍帧数 */
const NO_FACE_TOLERANCE = 5;

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
    let primary = valid[0];
    let maxArea = primary.bounds.width * primary.bounds.height;
    for (let i = 1; i < valid.length; i++) {
      const a = valid[i].bounds.width * valid[i].bounds.height;
      if (a > maxArea) { maxArea = a; primary = valid[i]; }
    }

    setPrimaryFaceWidth(primary.bounds.width);
    setPrimaryFaceHeight(primary.bounds.height);
    setPrimaryFaceBounds({ ...primary.bounds });
    lockedFaceRef.current = primary;

    setLockStatus((prev) => (prev === 'no-face' ? 'detected' : prev));
  }, []);

  const confirmLock = useCallback(() => {
    if (faces.length > 0) setLockStatus('locked');
  }, [faces.length]);

  const reset = useCallback(() => {
    setFaces([]);
    setLockStatus('no-face');
    setPrimaryFaceWidth(0);
    setPrimaryFaceHeight(0);
    setPrimaryFaceBounds(null);
    noFaceCount.current = 0;
    lockedFaceRef.current = null;
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
    reset,
  };
}
