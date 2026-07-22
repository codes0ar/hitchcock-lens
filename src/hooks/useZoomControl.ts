/**
 * useZoomControl.ts — 变焦控制Hook
 *
 * 职责: 整合人脸检测和ZoomController，实现自动希区柯克变焦
 * 监听人脸尺寸变化，实时计算并更新摄像头zoom
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import {
  ZoomController,
  convertZoomToNormalized,
  type PIDDebug,
} from '../utils/ZoomController';
import type { AppSettings, FaceLockStatus } from '../types';

/** DEV: 合成 faceW 测试控制环(无需真人移动)。true=注入合成数据验证镜头是否会动; 验证后改 false。 */
const DEV_TEST_SYNTH = false;

/** Zoom控制Hook的 Props */
interface UseZoomControlProps {
  /** 当前摄像头zoom倍数 */
  currentZoomRatio: number;
  /** 设置归一化zoom值的回调 */
  setNormalizedZoom: (zoom: number) => void;
  /** 人脸锁定状态 */
  faceLockStatus: FaceLockStatus;
  /** 主要人脸像素宽度 */
  primaryFaceWidth: number;
  /** 应用设置（灵敏度、平滑度） */
  settings: AppSettings;
  /** 设备最大zoom倍数 */
  maxZoomRatio: number;
  /** 设备最小zoom倍数 */
  minZoomRatio: number;
}

/**
 * Zoom控制Hook
 * 核心逻辑: 监听人脸宽度变化 → 通过ZoomController计算目标zoom → 更新摄像头
 */
export function useZoomControl({
  currentZoomRatio,
  setNormalizedZoom,
  faceLockStatus,
  primaryFaceWidth,
  settings,
  maxZoomRatio,
  minZoomRatio,
}: UseZoomControlProps) {
  // === Refs ===
  /** ZoomController 实例（使用ref保证跨渲染周期持久） */
  const controllerRef = useRef<ZoomController | null>(null);
  /** 上一次的锁定状态（用于检测状态变化） */
  const lastLockStatusRef = useRef<FaceLockStatus>('no-face');
  /** 是否已经记录目标尺寸 */
  const targetSetRef = useRef(false);
  /** 当前zoom倍数的引用（用于ZoomController.update） */
  const currentZoomRef = useRef(currentZoomRatio);
  /** 上一帧 faceW(deadzone 防抖: 变化<3% 不更新 zoom, 消除 high-zoom 微抖) */
  const lastFaceWRef = useRef(0);
  /** 执行器匹配节流时间戳(镜头~100ms 才稳定, 控制器每 100ms 发一次命令, 否则几何级数发散→振荡) */
  const lastControlTsRef = useRef(0);
  /** PID 目标 zoom(Stage1 每 100ms 计算, Stage2 每 33ms 平滑逼近) */
  const targetZoomRef = useRef(1.0);
  /** 平滑后的实际 zoom(Stage2 EMA 输出, 30fps 连续更新消除跳动) */
  const smoothedZoomRef = useRef(1.0);

  // === 状态 ===
  /** 当前显示给用户的zoom倍数 */
  const [displayZoom, setDisplayZoom] = useState(1.0);
  /** 人脸锁定指示器是否显示 */
  const [showLockIndicator, setShowLockIndicator] = useState(false);
  /** PID 调试信息(on-screen overlay) */
  const [debugInfo, setDebugInfo] = useState<PIDDebug | null>(null);

  // 同步currentZoomRef
  useEffect(() => {
    currentZoomRef.current = currentZoomRatio;
  }, [currentZoomRatio]);

  // 初始化ZoomController
  useEffect(() => {
    if (!controllerRef.current) {
      controllerRef.current = new ZoomController({
        minZoom: minZoomRatio,
        maxZoom: maxZoomRatio,
        smoothingFactor: settings.smoothness,
      });
    }

    return () => {
      // 清理
      controllerRef.current = null;
    };
  }, [minZoomRatio, maxZoomRatio]);

  // 当设置变化时更新控制器参数
  useEffect(() => {
    if (controllerRef.current) {
      controllerRef.current.updateOptions({
        smoothingFactor: settings.smoothness,
        minZoom: minZoomRatio,
        maxZoom: maxZoomRatio,
      });
    }
  }, [settings, minZoomRatio, maxZoomRatio]);

  /**
   * 处理人脸锁定状态变化
   * - 从 'no-face' -> 'detected': 首次检测到人脸，记录目标尺寸
   * - 从 'detected' -> 'locked': 人脸锁定确认
   * - 从 'locked' -> 'no-face': 人脸丢失，重置
   */
  useEffect(() => {
    if (DEV_TEST_SYNTH) return; // DEV: 跳过真实目标锁定, 由合成 effect 接管
    const prevStatus = lastLockStatusRef.current;
    const currentStatus = faceLockStatus;

    // dolly-zoom：仅在"锁定"(检测稳定 500ms 后)且首次记录目标尺寸；之后永不重置(避免丢脸闪烁改参考)
    if (!targetSetRef.current && currentStatus === 'locked' && primaryFaceWidth > 0) {
      if (controllerRef.current) {
        controllerRef.current.setTargetFaceSize(primaryFaceWidth);
        targetSetRef.current = true;
        setShowLockIndicator(true);
        console.log('[useZoomControl] 锁定目标尺寸:', primaryFaceWidth);
      }
    }

    // 人脸丢失：保持目标参考不变，zoom 维持上一次值
    if (currentStatus === 'no-face') {
      setShowLockIndicator(false);
      lastFaceWRef.current = 0;
    }

    lastLockStatusRef.current = currentStatus;
  }, [faceLockStatus, primaryFaceWidth]);

  /**
   * 核心控制循环 — 监听人脸尺寸变化，更新zoom
   * 当 primaryFaceWidth 变化时（即检测到新人脸帧），计算新的zoom
   */
  useEffect(() => {
    if (DEV_TEST_SYNTH) return; // DEV: 跳过真实控制环, 由合成 effect 接管
    // 只有在锁定状态且有有效人脸宽度时才更新zoom
    if (
      faceLockStatus === 'locked' ||
      (faceLockStatus === 'detected' && targetSetRef.current)
    ) {
      if (primaryFaceWidth <= 0) return;
      if (!controllerRef.current) return;

      // Stage 2: 平滑插值(每 33ms, EMA 0.3 → 时间常数~100ms, 消除 100ms 步进跳动感)
      const target = targetZoomRef.current;
      const current = smoothedZoomRef.current;
      const smoothed = current + (target - current) * 0.3;
      smoothedZoomRef.current = smoothed;
      const normalizedZoom = convertZoomToNormalized(smoothed, minZoomRatio, maxZoomRatio);
      setNormalizedZoom(normalizedZoom);
      setDisplayZoom(smoothed);

      // Stage 1: PID 目标计算(每 100ms, 匹配镜头执行器响应时间)
      const now = Date.now();
      if (now - lastControlTsRef.current >= 100) {
        lastControlTsRef.current = now;
        try {
          const pidOutput = controllerRef.current.update(primaryFaceWidth, smoothed);
          targetZoomRef.current = pidOutput;
          if (controllerRef.current?.lastDebug) {
            setDebugInfo({ ...controllerRef.current.lastDebug });
          }
        } catch (error) {
          console.error('[useZoomControl] PID更新失败:', error);
        }
      }
    }
  }, [
    primaryFaceWidth,
    faceLockStatus,
    setNormalizedZoom,
    minZoomRatio,
    maxZoomRatio,
  ]);

  /**
   * DEV: 合成 faceW 测试控制环(无需真人移动)
   * 模拟用户距离 D 振荡, faceW = target * zoom / D (真实物理耦合: zoom升→脸大)
   * 期望: D大(远)→zoom升保持脸≈150; D小(近)→zoom clamp 1.0
   */
  useEffect(() => {
    if (!DEV_TEST_SYNTH) return;
    if (!controllerRef.current || maxZoomRatio <= 0) return;
    controllerRef.current.setTargetFaceSize(150);
    targetSetRef.current = true;
    setShowLockIndicator(true);
    console.log('[DEV] 合成测试启动 target=150 (耦合 faceW=150*zoom/D, 无需真人)');
    const start = Date.now();
    const id = setInterval(() => {
      if (!controllerRef.current) return;
      const t = (Date.now() - start) / 1000;
      const D = 1.0 + 0.7 * Math.sin(t * 0.4); // 合成距离 0.3↔1.7
      const curZ = currentZoomRef.current > 0 ? currentZoomRef.current : 1.0;
      const syntheticFaceW = (150 * curZ) / D; // 耦合: zoom 升→脸大
      const z = controllerRef.current.update(syntheticFaceW, curZ);
      const norm = convertZoomToNormalized(z, minZoomRatio, maxZoomRatio);
      setNormalizedZoom(norm);
      setDisplayZoom(z);
      console.log(
        '[DEV] t=' + t.toFixed(1) + 's D=' + D.toFixed(2) +
        ' faceW=' + syntheticFaceW.toFixed(0) +
        ' zoom=' + z.toFixed(3) + 'x norm=' + norm.toFixed(3)
      );
    }, 250);
    return () => clearInterval(id);
  }, [DEV_TEST_SYNTH, maxZoomRatio, minZoomRatio, setNormalizedZoom]);

  /**
   * 手动重置zoom控制
   */
  const resetZoom = useCallback(() => {
    targetSetRef.current = false;
    lastControlTsRef.current = 0;
    targetZoomRef.current = 1.0;
    smoothedZoomRef.current = 1.0;
    if (controllerRef.current) {
      controllerRef.current.reset();
    }
    setNormalizedZoom(0); // 回到最小zoom
    setDisplayZoom(1.0);
    setShowLockIndicator(false);
  }, [setNormalizedZoom]);

  /**
   * 强制设置目标人脸尺寸（手动校准）
   */
  const setTargetSize = useCallback((size: number) => {
    if (controllerRef.current) {
      controllerRef.current.setTargetFaceSize(size);
      targetSetRef.current = true;
    }
  }, []);

  return {
    displayZoom,
    showLockIndicator,
    debugInfo,
    resetZoom,
    setTargetSize,
    isLocked: controllerRef.current?.isLocked() ?? false,
  };
}
