/**
 * ZoomController.ts — 希区柯克变焦核心控制算法
 *
 * 职责: 根据人脸像素尺寸偏差，通过比例控制 + EMA平滑计算目标zoom值
 * 实现经典的dolly zoom效果：人脸大小保持不变，背景产生透视拉伸
 */

import type { ZoomControllerOptions } from '../types';

/** PID 调试信息(供 on-screen debug overlay 显示) */
export interface PIDDebug {
  faceW: number;
  target: number;
  error: number;
  P: number;
  I: number;
  D: number;
  dt: number;
  dMeasurement: number;
  targetZoom: number;
  output: number;
  slewRate: number;
  integral: number;
}

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
  /** 目标人脸像素宽度（首次检测到时记录, 优先用眼距） */
  private targetSize: number | null = null;
  /** 上一次的输出zoom值（用于 slew-rate 限速） */
  private lastOutputZoom: number = 1.0;
  /** PID 积分项累积 */
  private integralError: number = 0;
  /** 上一次的测量值(用于 D-on-measurement, 避免 setpoint 尖峰) */
  private lastFaceSize: number = 0;
  /** 上一次更新时间戳(ms, 用于计算 dt) */
  private lastUpdateTime: number = 0;
  /** 控制器配置选项 */
  private options: ZoomControllerOptions;

  /** PID 增益 (dt≈0.1s, 100ms 执行器匹配节流) */
  private readonly Kp = 0.3;  // 比例: 保守(降低噪声放大)
  private readonly Ki = 0.02; // 积分: 消除稳态偏差
  private readonly Kd = 0.0;  // 微分: 设为0 — D-on-measurement 在噪声系统下放大振荡

  /** 上次 update 的调试信息(on-screen overlay 用) */
  public lastDebug: PIDDebug | null = null;

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
    this.integralError = 0;
    this.lastFaceSize = 0;
    this.lastUpdateTime = 0;
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
   * PID 控制算法 — P(快速响应) + I(稳态精度) + D(制动防过冲)
   *
   * D 项基于测量值(faceW 变化率)而非误差, 避免 setpoint 突变时的微分尖峰。
   * 外层套 slew-rate 安全帽, 防止 PID 异常时大幅跳变。
   *
   * @param facePixelSize - 当前人脸 metric (眼距或 bounding box 宽度)
   * @param currentZoom - 当前摄像头zoom倍数
   * @returns 目标zoom倍数
   */
  public update(facePixelSize: number, currentZoom: number): number {
    if (this.targetSize === null) return currentZoom;
    if (facePixelSize <= 0) return this.lastOutputZoom;

    const { minZoom, maxZoom } = this.options;
    const now = Date.now();
    const dt = this.lastUpdateTime > 0
      ? Math.max(0.03, Math.min(0.5, (now - this.lastUpdateTime) / 1000))
      : 0.1;
    this.lastUpdateTime = now;

    // 归一化误差: e>0 脸太小(远,需zoom in), e<0 脸太大(近,需zoom out)
    const error = (this.targetSize - facePixelSize) / this.targetSize;

    // 积分项 (带 anti-windup 限幅)
    this.integralError += error * dt;
    this.integralError = Math.max(-0.5, Math.min(0.5, this.integralError));

    // 微分项 (基于测量值: faceW 增大→D<0→制动, 避免误差突变尖峰)
    let derivative = 0;
    if (this.lastFaceSize > 0 && dt > 0) {
      const dMeasurement = (facePixelSize - this.lastFaceSize) / dt;
      derivative = -dMeasurement / this.targetSize;
    }
    this.lastFaceSize = facePixelSize;

    // PID 输出: zoom 调整因子
    const adjustment = this.Kp * error + this.Ki * this.integralError + this.Kd * derivative;
    const targetZoom = currentZoom * (1 + adjustment);

    // Slew-rate 安全帽 (误差大→快追 30%, 误差小→精细 5%, 防 PID 异常)
    const absError = Math.abs(error);
    const slewRate = 0.05 + 0.25 * Math.min(absError, 1);
    const maxDelta = Math.max(this.lastOutputZoom * slewRate, 0.05);
    const delta = targetZoom - this.lastOutputZoom;
    const clampedDelta = Math.max(-maxDelta, Math.min(maxDelta, delta));
    const outputZoom = Math.max(minZoom, Math.min(maxZoom, this.lastOutputZoom + clampedDelta));

    this.lastOutputZoom = outputZoom;

    // 调试信息 (console + on-screen overlay)
    const dMeas = this.lastFaceSize > 0 ? (facePixelSize - this.lastFaceSize) / dt : 0;
    this.lastDebug = {
      faceW: facePixelSize, target: this.targetSize, error,
      P: this.Kp * error, I: this.Ki * this.integralError, D: this.Kd * derivative,
      dt, dMeasurement: dMeas, targetZoom, output: outputZoom, slewRate,
      integral: this.integralError,
    };
    console.log(
      '[PID] dt=' + dt.toFixed(3) + ' faceW=' + facePixelSize.toFixed(1) +
      ' tgt=' + this.targetSize.toFixed(1) + ' err=' + error.toFixed(4) +
      ' P=' + (this.Kp * error).toFixed(4) + ' I=' + (this.Ki * this.integralError).toFixed(4) +
      ' D=' + (this.Kd * derivative).toFixed(4) + ' dMeas=' + dMeas.toFixed(1) +
      ' adj=' + adjustment.toFixed(4) + ' tgtZ=' + targetZoom.toFixed(3) +
      ' slew=' + slewRate.toFixed(3) + ' out=' + outputZoom.toFixed(3)
    );

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
