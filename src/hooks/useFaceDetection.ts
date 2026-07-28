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
  const [lockStatus, setLockStatus] = useState<FaceLockStatus>('no-face');
  const [primaryFaceWidth, setPrimaryFaceWidth] = useState(0);
  const [primaryFaceHeight, setPrimaryFaceHeight] = useState(0);
  const [primaryFaceBounds, setPrimaryFaceBounds] = useState<{
    x: number; y: number; width: number; height: number;
  } | null>(null);
  /** 人脸检测调试信息(on-screen overlay) */
  const [faceDebug, setFaceDebug] = useState<{ eyeDist: number; avgMetric: number; boundsW: number; hasLandmark: boolean } | null>(null);

  const noFaceCount = useRef(0);
  const lastUiTs = useRef(0);
  /** debug overlay 降频(200ms) */
  const lastDebugTs = useRef(0);
  /** console.log 降频(500ms, 日志跨桥开销大) */
  const lastLogTs = useRef(0);
  const lockedFaceRef = useRef<FaceData | null>(null);
  /** ref 跟踪当前是否有脸(confirmLock 用,避免依赖 faces state 导致 callback 重建) */
  const hasFacesRef = useRef(false);
  /** 人脸边界滑动平均窗口(仅用于绿框显示平滑; 控制器用原始框宽, 零延迟) */
  const boundsHistoryRef = useRef<Array<{ x: number; y: number; width: number; height: number }>>([]);
  /** 控制器输入 2 帧轻平滑(只加 ~33ms 延迟, 让步进更细、抑制单帧抖动) */
  const metricHistoryRef = useRef<number[]>([]);

  /** 帧处理器回调（由 CameraScreen 的 frameProcessor 在每帧调用，经 runOnJS 派发） */
  const onFacesDetected = useCallback((detectedFaces: Face[]) => {
    const now = Date.now();
    if (now - lastUiTs.current < UI_THROTTLE_MS) return;
    lastUiTs.current = now;

    const valid: FaceData[] = (detectedFaces || [])
      .filter((f) => f.bounds && f.bounds.width >= 20 && f.bounds.height >= 20)
      .map((f, i) => ({
        bounds: { x: f.bounds.x, y: f.bounds.y, width: f.bounds.width, height: f.bounds.height },
        faceID: f.trackingId ?? i,
        eyeDistance: 0, // landmarkMode=none，不再计算眼距（减负）
      }));

    if (valid.length === 0) {
      hasFacesRef.current = false;
      boundsHistoryRef.current = [];
      metricHistoryRef.current = [];
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

    // 控制器用 2 帧轻平滑的绿框宽度（延迟 ~33ms，让步进更细、抑制单帧抖动）；
    // 黄框(参考)宽度是录制起点捕获值，PID 目标=黄框宽，形成"绿框宽→黄框宽"的直接回路。
    const mHist = metricHistoryRef.current;
    mHist.push(primary.bounds.width);
    if (mHist.length > 2) mHist.shift();
    const metric = mHist.reduce((a, b) => a + b, 0) / mHist.length;

    // DEBUG overlay 降频到 200ms
    if (now - lastDebugTs.current > 200) {
      lastDebugTs.current = now;
      setFaceDebug({
        eyeDist: 0,
        avgMetric: metric,
        boundsW: primary.bounds.width,
        hasLandmark: false,
      });
    }
    // console.log 降频到 500ms (跨桥开销大)
    if (now - lastLogTs.current > 500) {
      lastLogTs.current = now;
      console.log('[Face] boundsW=' + primary.bounds.width.toFixed(1));
    }

    // 控制器用原始 metric; 显示用平滑 bounds
    setPrimaryFaceWidth(metric);
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
    faces: [] as FaceData[], // faces 数组无消费者，不再每帧 setState 以减负
    lockStatus,
    primaryFaceWidth,
    primaryFaceHeight,
    primaryFaceBounds,
    imageDimensions: null, // autoMode=true 时 bounds 已是屏幕坐标，无需图像尺寸映射
    onFacesDetected,
    confirmLock,
    unlock,
    reset,
    faceDebug,
  };
}
