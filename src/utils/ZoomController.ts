/**
 * ZoomController.ts — 希区柯克变焦核心控制算法
 *
 * 职责: 根据人脸像素尺寸偏差，通过比例控制 + EMA平滑计算目标zoom值
 * 实现经典的dolly zoom效果：人脸大小保持不变，背景产生透视拉伸
 */

import type { ZoomControllerOptions } from '../types';

/** 控制模式：'pid' 纯PID | 'smooth' PID+卡尔曼平滑 | 'lead' PID+卡尔曼平滑+前馈 */
export type ControlMode = 'pid' | 'smooth' | 'lead';

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
  /** 当前控制模式(pid/smooth/lead)，on-screen 验证用 */
  mode: ControlMode;
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
  /** 上一次的输出zoom值（指令值，用于 slew-rate 限速） */
  private lastOutputZoom: number = 1.0;
  /** 执行器模型：估计真实镜头当前位置（一阶滞后，τ≈120ms） */
  private actualZoom: number = 1.0;
  /** PID 积分项累积 */
  private integralError: number = 0;
  /** 上一次的测量值(用于 D-on-measurement, 避免 setpoint 尖峰) */
  private lastFaceSize: number = 0;
  /** 上一次更新时间戳(ms, 用于计算 dt) */
  private lastUpdateTime: number = 0;
  /** console.log 降频用时间戳(日志跨桥开销大) */
  private lastLogTs: number = 0;
  /** 控制器配置选项 */
  private options: ZoomControllerOptions;

  // === 匀速卡尔曼滤波（人脸尺寸 s 及其变化率 v 的状态估计，替代 2帧MA）===
  /** 卡尔曼状态：人脸尺寸估计 s */
  private kS = 0;
  /** 卡尔曼状态：尺寸变化率估计 v (px/s) */
  private kV = 0;
  /** 卡尔曼协方差 */
  private kP00 = 100;
  private kP01 = 0;
  private kP11 = 100;
  /** 卡尔曼过程噪声(尺寸) / 过程噪声(速度) / 测量噪声
   *  v5.10 调优战役(6窗回文对照)整定：R=3/QV=20 时 smooth 与纯PID统计打平；
   *  R≥12 或 QV≥100 显著滞后恶化；lead 全参数空间负优化 */
  private KF_QS = 8;
  private KF_QV = 20;
  private KF_R = 3;
  /** 上一次 actualZoom（用于求 dlog(z_lens)/dt，进而算扰动速率 rd） */
  private prevActualZoom = 0;
  /** 镜头物理滞后估计 T_lag（秒），用于扰动前馈提前量 */
  private T_LAG = 0.12;
  /** 扰动速率限幅 (1/s) / 前馈提前量限幅（调优可热改） */
  private RD_CLAMP = 2.0;
  private LEAD_CLAMP = 0.3;
  /** 死区 / 输出 EMA 时间常数 / 自适应速率上限（调优可热改） */
  private DEADBAND = 0.01;
  private OUTPUT_TAU = 0.12;
  private MAX_SLEW_PER_SEC = 4.0; // 自适应限速的上限（|e|≥0.4 时达到）
  /** 自适应输出平滑：|e| 小时用 TAU_MAX（重平滑抑抖），大时用 TAU_MIN（快响应）；
   *  默认 tauMin==tauMax==OUTPUT_TAU 即固定平滑（现状）。实测灵感：pid 误差小但抖，
   *  平滑模式平滑但滞后——自适应取两者之长 */
  private TAU_MIN = 0.12;
  private TAU_MAX = 0.12;
  /** E2 执行器过驱增益：0=关闭（默认），0.5~1.0 为有效区 */
  private OD_GAIN = 0;
  /** E1 掉脸续行：faceW 对数速度 EMA / 续行开关（默认关） */
  private velEma = 0;
  private coastEnabled = false;

  /**
   * 掉脸续行：锁定中检测短暂丢失时，按 velEma 外推 faceW 继续走正常控制管线。
   * 调用方（useZoomControl 看门狗）负责限制续行时长（~150-650ms）。
   */
  public updateCoast(): number {
    if (!this.coastEnabled || this.targetSize === null || this.lastFaceSize <= 0) {
      return this.lastOutputZoom;
    }
    const now = Date.now();
    const dt = Math.max(0.03, Math.min(0.3, (now - this.lastUpdateTime) / 1000));
    const extrapolated = this.lastFaceSize * Math.exp(this.velEma * dt);
    return this.update(extrapolated, this.lastOutputZoom);
  }
  /** 调优参数组 ID（[Track] 日志分段用；0=未在调优） */
  private tuneId = 0;

  /** 调优热参数：不改结构只改数值；resetState 重置积分/卡尔曼但保留锁定目标与 zoom 状态 */
  public setTuneParams(p: {
    tuneId?: number; kfQS?: number; kfQV?: number; kfR?: number;
    tLag?: number; rdClamp?: number; leadClamp?: number;
    deadband?: number; outputTau?: number; tauMin?: number; tauMax?: number;
    maxSlew?: number; odGain?: number; coast?: boolean; resetState?: boolean;
  }): void {
    if (p.tuneId !== undefined) this.tuneId = p.tuneId;
    if (p.kfQS !== undefined) this.KF_QS = p.kfQS;
    if (p.kfQV !== undefined) this.KF_QV = p.kfQV;
    if (p.kfR !== undefined) this.KF_R = p.kfR;
    if (p.tLag !== undefined) this.T_LAG = p.tLag;
    if (p.rdClamp !== undefined) this.RD_CLAMP = p.rdClamp;
    if (p.leadClamp !== undefined) this.LEAD_CLAMP = p.leadClamp;
    if (p.deadband !== undefined) this.DEADBAND = p.deadband;
    if (p.outputTau !== undefined) {
      this.OUTPUT_TAU = p.outputTau;
      // 只给 outputTau 而未给 tauMin/tauMax 时，固定平滑（兼容旧调参文件）
      if (p.tauMin === undefined && p.tauMax === undefined) {
        this.TAU_MIN = p.outputTau;
        this.TAU_MAX = p.outputTau;
      }
    }
    if (p.tauMin !== undefined) this.TAU_MIN = p.tauMin;
    if (p.tauMax !== undefined) this.TAU_MAX = p.tauMax;
    if (p.maxSlew !== undefined) this.MAX_SLEW_PER_SEC = p.maxSlew;
    if (p.odGain !== undefined) this.OD_GAIN = p.odGain;
    if (p.coast !== undefined) this.coastEnabled = p.coast;
    if (p.resetState) {
      this.integralError = 0;
      this.kS = 0;
      this.kV = 0;
      this.kP00 = 100;
      this.kP01 = 0;
      this.kP11 = 100;
      this.prevActualZoom = 0;
      this.lastFaceSize = 0;
    }
  }
  /**
   * 控制模式（A/B/C 对比）：
   *  - 'pid'    纯 PID（默认）：原始测量 + 有限差分微分。
   *             静态诊断证明环路稳定; 75s×690样本动态 A/B 中误差最小(σ9.45px)
   *  - 'smooth' PID + 卡尔曼输入平滑：反转数略降但滞后使误差 +17%, 抖动未降, 弃用
   *  - 'lead'   PID + 卡尔曼平滑 + T_lag 扰动前馈（实测负优化, 误差 45px）
   */
  private controlMode: ControlMode = 'pid';

  /** 切换控制模式 */
  public setControlMode(mode: ControlMode): void {
    this.controlMode = mode;
  }

  /** PID 增益 (默认值, slider 可在录制中随时调整) */
  private Kp = 0.3;
  private Ki = 0.02;
  private Kd = 0.0;

  /** 上次 update 的调试信息(on-screen overlay 用) */
  public lastDebug: PIDDebug | null = null;

  constructor(options: Partial<ZoomControllerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.lastOutputZoom = this.options.minZoom;
    this.actualZoom = this.options.minZoom;
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
    this.actualZoom = this.options.minZoom;
    this.integralError = 0;
    this.lastFaceSize = 0;
    this.lastUpdateTime = 0;
    // 重置卡尔曼滤波与扰动前馈状态
    this.kS = 0;
    this.kV = 0;
    this.kP00 = 100;
    this.kP01 = 0;
    this.kP11 = 100;
    this.prevActualZoom = 0;
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
   * 动态设置 PID 增益(slider 实时调节, 录制中可调)
   */
  public setGains(kp: number, ki: number, kd: number): void {
    this.Kp = kp;
    this.Ki = ki;
    this.Kd = kd;
  }

  /**
   * 获取当前 PID 增益
   */
  public getGains(): { kp: number; ki: number; kd: number } {
    return { kp: this.Kp, ki: this.Ki, kd: this.Kd };
  }

  /**
   * 变焦控制器 — 几何前馈 + 增量式 PID + 执行器一阶滞后模型 + 速率限制
   *
   * 关键修复：不再把"指令 zoom"当反馈，而是用内部执行器模型估计真实镜头位置。
   * 人脸像素尺寸 s ≈ k * actualZoom / distance，
   * 因此目标 zoom = actualZoom * target / s（Kp=1 时一步静态补偿到位）。
   * 用估计的 actualZoom 做反馈可避免"指令立即生效"导致的累积过冲/震荡。
   *
   * @param facePixelSize - 当前人脸 metric (眼距 MA)
   * @param currentZoom - 当前真实镜头 zoom 倍数（仅第一帧用于初始化）
   * @returns 目标 zoom 倍数（指令值）
   */
  public update(facePixelSize: number, currentZoom: number): number {
    if (this.targetSize === null) return currentZoom;
    if (facePixelSize <= 0) return this.lastOutputZoom;

    const { minZoom, maxZoom } = this.options;
    const now = Date.now();
    const isFirstUpdate = this.lastUpdateTime === 0;
    const dt = isFirstUpdate
      ? 0.1
      : Math.max(0.03, Math.min(0.5, (now - this.lastUpdateTime) / 1000));
    this.lastUpdateTime = now;

    // 第一帧以当前真实 zoom 初始化执行器模型与指令值
    if (isFirstUpdate) {
      this.actualZoom = currentZoom;
      this.lastOutputZoom = currentZoom;
    }

    const target = this.targetSize;

    // 执行器一阶滞后模型：真实镜头以 τ≈100ms 时间常数跟随指令
    // (130→100ms 再降延迟；回稳主要受平滑限制而非速率限制)
    const ACTUATOR_TAU = 0.10;
    const actAlpha = dt / (ACTUATOR_TAU + dt);
    this.actualZoom += (this.lastOutputZoom - this.actualZoom) * actAlpha;

    // === 输入端人脸尺寸估计（按控制模式）===
    // smooth/lead: 卡尔曼滤波得干净 s/v; pid(纯PID): 直接用原始 facePixelSize
    const useSmooth = this.controlMode !== 'pid';
    const useLead = this.controlMode === 'lead';
    // 输入变化率钳制：人脸丢失后重新捕获/主脸切换时 faceW 不连续跳变，
    // 单样本最大 ±22% (ln 0.2)，超出部分截断——2-3 个样本内收敛但不猛冲
    let clampedInput = facePixelSize;
    if (this.lastFaceSize > 0) {
      const ratio = facePixelSize / this.lastFaceSize;
      const maxRatio = 1.22;
      if (ratio > maxRatio) clampedInput = this.lastFaceSize * maxRatio;
      else if (ratio < 1 / maxRatio) clampedInput = this.lastFaceSize / maxRatio;
    }
    let faceS = clampedInput;
    let faceV = 0;
    if (useSmooth) {
      const kf = this.kalmanUpdate(clampedInput, dt);
      faceS = kf.s;
      faceV = kf.v;
    }

    // 对数误差：+ 脸太小需要 zoom in，- 脸太大需要 zoom out
    const logError = Math.log(target / faceS);

    // 死区：|误差|<DEADBAND 时不调整，防止围绕目标的微震荡；同时积分衰减防残余拉动
    const inDeadband = Math.abs(logError) < this.DEADBAND;
    const effectiveError = inDeadband ? 0 : logError;

    // 积分项 (anti-windup ±1.0)
    if (inDeadband) {
      this.integralError *= 0.9;
    } else {
      this.integralError += effectiveError * dt;
      this.integralError = Math.max(-1.0, Math.min(1.0, this.integralError));
    }

    // 微分项：卡尔曼平滑模式用速度 v；纯PID用有限差分(用钳制后输入, 防重捕获尖峰)
    const rawDelta = this.lastFaceSize > 0 ? facePixelSize - this.lastFaceSize : 0;
    let logDerivative = 0;
    if (useSmooth) {
      logDerivative = faceS > 0 ? -faceV / faceS : 0;
    } else if (this.lastFaceSize > 0 && dt > 0) {
      logDerivative = -(Math.log(clampedInput) - Math.log(this.lastFaceSize)) / dt;
    }
    // E1 掉脸续行：faceW 对数速度的 EMA 估计（coast 外推用，无论何种模式都维护）
    if (this.lastFaceSize > 0 && dt > 0) {
      const instVel = (Math.log(clampedInput) - Math.log(this.lastFaceSize)) / dt;
      this.velEma += (instVel - this.velEma) * 0.3;
    }
    this.lastFaceSize = clampedInput;

    // === 扰动速率前馈（T_lag 提前量，补镜头物理滞后；仅 'lead' 模式启用）===
    let lead = 0;
    if (useLead) {
      let rd = 0;
      if (this.prevActualZoom > 0 && faceS > 0 && dt > 0) {
        const dlogZ = (Math.log(this.actualZoom) - Math.log(this.prevActualZoom)) / dt;
        const dlogS = faceV / faceS;
        rd = dlogZ - dlogS;
      }
      rd = Math.max(-this.RD_CLAMP, Math.min(this.RD_CLAMP, rd));
      lead = rd * this.T_LAG;
      lead = Math.max(-this.LEAD_CLAMP, Math.min(this.LEAD_CLAMP, lead)); // 提前量限幅，保守防过冲
    }
    this.prevActualZoom = this.actualZoom;

    // PID 修正项作用于指数（死区内整体为零）+ T_lag 前馈提前量
    const P = this.Kp * effectiveError;
    const I = this.Ki * this.integralError;
    const D = this.Kd * logDerivative;
    let adjustment = (inDeadband ? 0 : P + I + D) + lead;

    // === E2 执行器过驱（overdrive）：对输出 EMA + 镜头执行器的确定性滞后做超前补偿。
    //  与 lead 的本质区别：用控制器自身指令历史（干净信号），不碰带噪测量。
    //  过驱量 = OD_GAIN × log(指令/输出)，限幅 ±0.15（16%），实测最优区 0.5~1.0
    if (this.OD_GAIN > 0 && this.lastOutputZoom > 0) {
      const fullAdj = Math.log(this.actualZoom * Math.exp(adjustment) / this.lastOutputZoom);
      adjustment += Math.max(-0.15, Math.min(0.15, this.OD_GAIN * fullAdj));
    }

    // 几何前馈：用估计的真实 zoom 计算目标
    const desiredZoom = Math.max(minZoom, Math.min(maxZoom, this.actualZoom * Math.exp(adjustment)));

    // 自适应速率限制：误差大时快速追、接近目标时温和（兼顾响应与平滑）。
    // 实测：固定 1.0x/s 在大范围跟踪时 37% 的样本顶满限速成为瓶颈；
    // |logError|=0.05 时 0.5x/s（平滑区），0.2 时 2x/s，≥0.4 时封顶 4x/s
    const adaptiveSlew = Math.max(0.4, Math.min(this.MAX_SLEW_PER_SEC, 10 * Math.abs(logError)));
    const maxDelta = adaptiveSlew * dt;
    const slewLimited = Math.max(
      this.lastOutputZoom - maxDelta,
      Math.min(this.lastOutputZoom + maxDelta, desiredZoom)
    );

    // 输出 EMA：自适应 τ —— |误差| 小用 TAU_MAX（重平滑抑抖），大用 TAU_MIN（快响应）。
    // 线性插值区间 |e|∈[0.03, 0.15]；TAU_MIN==TAU_MAX 时退化为固定平滑（现状）
    const eMag = Math.abs(logError);
    const k = Math.max(0, Math.min(1, (0.15 - eMag) / (0.15 - 0.03)));
    const tauEff = this.TAU_MIN + (this.TAU_MAX - this.TAU_MIN) * k;
    const outAlpha = dt / (tauEff + dt);
    const outputZoom = this.lastOutputZoom + outAlpha * (slewLimited - this.lastOutputZoom);

    this.lastOutputZoom = outputZoom;
    this.lastDebug = {
      faceW: facePixelSize,
      target,
      error: logError,
      P,
      I,
      D,
      dt,
      dMeasurement: rawDelta / dt,
      targetZoom: desiredZoom,
      output: outputZoom,
      slewRate: maxDelta / dt,
      integral: this.integralError,
      mode: this.controlMode,
    };
    if (now - this.lastLogTs > 50) {
      this.lastLogTs = now;
      // 高速率跟踪日志（仿真测量用）：faceW(控制器输入) / tgt(目标) / out(输出zoom)
      console.log(
        '[Track] tid=' + this.tuneId +
        ' faceW=' + facePixelSize.toFixed(1) +
        ' tgt=' + target.toFixed(1) + ' out=' + outputZoom.toFixed(3) +
        ' actual=' + this.actualZoom.toFixed(3) + ' desired=' + desiredZoom.toFixed(3)
      );
    }

    return outputZoom;
  }

  /**
   * 匀速卡尔曼滤波（constant-velocity）：估计人脸尺寸 s 与变化率 v
   * 替代 2帧MA，最优降噪；v 同时用作 Kd 的干净微分 和 扰动速率前馈的 dlog(s)/dt
   */
  private kalmanUpdate(z: number, dt: number): { s: number; v: number } {
    if (this.kS <= 0) {
      this.kS = z;
      this.kV = 0;
      return { s: z, v: 0 };
    }
    const dtc = Math.max(0.01, Math.min(0.5, dt));
    // Predict (F = [[1, dt],[0,1]])
    const sP = this.kS + this.kV * dtc;
    const p00 = this.kP00 + 2 * dtc * this.kP01 + dtc * dtc * this.kP11 + this.KF_QS;
    const p01 = this.kP01 + dtc * this.kP11;
    const p11 = this.kP11 + this.KF_QV;
    // Update (H = [1, 0])
    const y = z - sP;
    const S = p00 + this.KF_R;
    const k0 = p00 / S;
    const k1 = p01 / S;
    this.kS = sP + k0 * y;
    this.kV = this.kV + k1 * y;
    this.kP00 = (1 - k0) * p00;
    this.kP01 = (1 - k0) * p01;
    this.kP11 = p11 - k1 * p01;
    return { s: this.kS, v: this.kV };
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
