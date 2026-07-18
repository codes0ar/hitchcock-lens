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
} from '../utils/ZoomController';
import type { AppSettings, FaceLockStatus } from '../types';

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

  // === 状态 ===
  /** 当前显示给用户的zoom倍数 */
  const [displayZoom, setDisplayZoom] = useState(1.0);
  /** 人脸锁定指示器是否显示 */
  const [showLockIndicator, setShowLockIndicator] = useState(false);

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
    }

    lastLockStatusRef.current = currentStatus;
  }, [faceLockStatus, primaryFaceWidth]);

  /**
   * 核心控制循环 — 监听人脸尺寸变化，更新zoom
   * 当 primaryFaceWidth 变化时（即检测到新人脸帧），计算新的zoom
   */
  useEffect(() => {
    // 只有在锁定状态且有有效人脸宽度时才更新zoom
    if (
      faceLockStatus === 'locked' ||
      (faceLockStatus === 'detected' && targetSetRef.current)
    ) {
      if (primaryFaceWidth <= 0) return;
      if (!controllerRef.current) return;

      try {
        // 计算目标zoom倍数（用最新的 currentZoomRatio，避免 currentZoomRef 陈旧导致控制器收敛到错误均衡点）
        const targetZoomRatio = controllerRef.current.update(
          primaryFaceWidth,
          currentZoomRatio
        );

        // 转换为归一化zoom值并更新摄像头
        const normalizedZoom = convertZoomToNormalized(
          targetZoomRatio,
          minZoomRatio,
          maxZoomRatio
        );

        setNormalizedZoom(normalizedZoom);
        setDisplayZoom(targetZoomRatio);
        console.log('[useZoomControl] faceW=' + primaryFaceWidth + ' zoom=' + targetZoomRatio.toFixed(2) + 'x norm=' + normalizedZoom.toFixed(3));
      } catch (error) {
        console.error('[useZoomControl] Zoom更新失败:', error);
      }
    }
  }, [
    primaryFaceWidth,
    faceLockStatus,
    setNormalizedZoom,
    minZoomRatio,
    maxZoomRatio,
    // 注意：currentZoomRatio 故意不放入依赖。每次新检测(primaryFaceWidth变化)时闭包已捕获其最新值；
    // 若放入依赖，setNormalizedZoom→currentZoomRatio变化→effect再触发，会形成反馈回路在单帧内冲到 maxZoom。
  ]);

  /**
   * 手动重置zoom控制
   */
  const resetZoom = useCallback(() => {
    targetSetRef.current = false;
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
    resetZoom,
    setTargetSize,
    isLocked: controllerRef.current?.isLocked() ?? false,
  };
}
