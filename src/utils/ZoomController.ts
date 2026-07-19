/**
 * ZoomController.ts — 希区柯克变焦核心控制算法
 *
 * 职责: 根据人脸像素尺寸偏差，通过比例控制 + EMA平滑计算目标zoom值
 * 实现经典的dolly zoom效果：人脸大小保持不变，背景产生透视拉伸
 */

import type { ZoomControllerOptions } from '../types';

/** 默认控制参数 */
const DEFAULT_OPTIONS: ZoomControllerOptions = {
  minZoom: 1.0,
  maxZoom: 10.0,
  smoothingFactor: 0.15,
};

/**
 * 将zoom比例值转换为CameraView所需的归一化值 [0, 1]
 * @param zoomRatio - 当前zoom倍数（如 2.0 表示2倍zoom）
 * @param minZoom - 设备最小zoom倍数
 * @param maxZoom - 设备最大zoom倍数
 * @returns 归一化zoom值 [0, 1]
 */
export function convertZoomToNormalized(
  zoomRatio: number,
  minZoom: number,
  maxZoom: number
): number {
  // 将 [minZoom, maxZoom] 映射到 [0, 1]
  const normalized = (zoomRatio - minZoom) / (maxZoom - minZoom);
  // 限制在 [0, 1] 范围内
  return Math.max(0, Math.min(1, normalized));
}

/**
 * 将归一化zoom值转换回zoom比例
 * @param normalized - 归一化zoom值 [0, 1]
 * @param minZoom - 设备最小zoom倍数
 * @param maxZoom - 设备最大zoom倍数
 * @returns zoom倍数
 */
export function convertNormalizedToZoom(
  normalized: number,
  minZoom: number,
  maxZoom: number
): number {
  return minZoom + normalized * (maxZoom - minZoom);
}

/**
 * 希区柯克变焦控制器类
 *
 * 控制逻辑（每帧执行）:
 *   Error = targetSize / facePixelSize  // >1表示人脸太小需zoom in, <1需zoom out
 *   correctedZoom = currentZoom * Error * smoothingFactor
 *   outputZoom = clamp(correctedZoom, minZoom, maxZoom)
 */
export class ZoomController {
  /** 目标人脸像素宽度（首次检测到时记录） */
  private targetSize: number | null = null;
  /** 上一次的输出zoom值（用于EMA平滑） */
  private lastOutputZoom: number = 1.0;
  /** 控制器配置选项 */
  private options: ZoomControllerOptions;

  constructor(options: Partial<ZoomControllerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.lastOutputZoom = this.options.minZoom;
  }

  /**
   * 设置/重置目标人脸像素尺寸
   * 通常在首次检测到人脸时调用，或在用户主动重置时调用
   * @param pixelWidth - 人脸像素宽度
   */
  public setTargetFaceSize(pixelWidth: number): void {
    if (pixelWidth <= 0) {
      console.warn('[ZoomController] 目标人脸尺寸必须大于0');
      return;
    }
    this.targetSize = pixelWidth;
    console.log(`[ZoomController] 目标人脸尺寸已设置: ${pixelWidth.toFixed(1)}px`);
  }

  /**
   * 获取当前目标人脸尺寸
   * @returns 目标人脸像素宽度，未设置时返回null
   */
  public getTargetFaceSize(): number | null {
    return this.targetSize;
  }

  /**
   * 检查是否已设置目标尺寸（即人脸是否已锁定）
   * @returns 是否已锁定
   */
  public isLocked(): boolean {
    return this.targetSize !== null;
  }

  /**
   * 重置控制器状态（清除目标尺寸）
   */
  public reset(): void {
    this.targetSize = null;
    this.lastOutputZoom = this.options.minZoom;
  }

  /**
   * 更新控制器配置
   * @param options - 部分配置选项
   */
  public updateOptions(options: Partial<ZoomControllerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * 获取当前配置
   */
  public getOptions(): ZoomControllerOptions {
    return { ...this.options };
  }

  /**
   * 核心控制算法 — 自适应 slew-rate 限速器(替换 EMA, 消除指数迟滞)
   *
   * @param facePixelSize - 当前检测到的人脸像素宽度
   * @param currentZoom - 当前摄像头zoom值（zoom倍数，非归一化值）
   * @returns 目标zoom倍数（非归一化），未设置targetSize时返回currentZoom
   *
   * 算法:
   * 1. 精确目标: targetZoom = currentZoom * (targetSize / facePixelSize)  [一步到位解]
   * 2. 自适应限速: 误差大→30%/步(快追), 误差小→4%/步(抑抖)
   * 3. 线性逼近: output = lastOutput + clamp(delta, ±maxDelta)
   *
   * vs EMA: 线性收敛(非指数), 大误差时快 3-5 倍; 限速 cap 防止噪声放大(无 overshoot)
   */
  public update(facePixelSize: number, currentZoom: number): number {
    if (this.targetSize === null) return currentZoom;
    if (facePixelSize <= 0) return this.lastOutputZoom;

    const { minZoom, maxZoom } = this.options;

    // 步骤1: 精确目标 zoom
    const errorRatio = this.targetSize / facePixelSize;
    const targetZoom = currentZoom * errorRatio;

    // 步骤2: 自适应 slew rate (误差大→快追, 误差小→精细抑抖)
    const absError = Math.abs(errorRatio - 1);
    const slewRate = 0.04 + 0.26 * Math.min(absError, 1);
    const maxDelta = Math.max(this.lastOutputZoom * slewRate, 0.05);

    // 步骤3: 限速线性逼近目标(单调收敛, 无 overshoot)
    const delta = targetZoom - this.lastOutputZoom;
    const clampedDelta = Math.max(-maxDelta, Math.min(maxDelta, delta));
    const outputZoom = Math.max(minZoom, Math.min(maxZoom, this.lastOutputZoom + clampedDelta));

    this.lastOutputZoom = outputZoom;
    return outputZoom;
  }

  /**
   * 根据人脸检测结果计算目标zoom（简化版，直接使用face bounds）
   *
   * @param faceWidth - 人脸边界框宽度（像素）
   * @param faceHeight - 人脸边界框高度（像素）
   * @param currentZoom - 当前zoom倍数
   * @returns 目标zoom倍数
   */
  public updateFromFaceBounds(
    faceWidth: number,
    faceHeight: number,
    currentZoom: number
  ): number {
    // 使用宽度作为主要参考（通常更稳定）
    return this.update(faceWidth, currentZoom);
  }
}

/** 创建ZoomController实例的工厂函数 */
export function createZoomController(
  options?: Partial<ZoomControllerOptions>
): ZoomController {
  return new ZoomController(options);
}
