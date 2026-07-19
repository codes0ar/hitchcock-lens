/**
 * 希区柯克变焦摄像APP - 类型定义
 * 包含所有模块共享的TypeScript接口和类型
 */

/** 人脸检测结果接口 */
export interface FaceData {
  /** 人脸边界框 */
  bounds: {
    /** 左上角x坐标 */
    x: number;
    /** 左上角y坐标 */
    y: number;
    /** 人脸宽度（像素） */
    width: number;
    /** 人脸高度（像素） */
    height: number;
  };
  /** 人脸唯一ID */
  faceID: number;
  /** 双眼间距(像素, 比 bounding box 更稳定的 face-size metric) */
  eyeDistance: number;
}

/** Zoom控制器配置选项 */
export interface ZoomControllerOptions {
  /** 最小zoom值（广角端） */
  minZoom: number;
  /** 最大zoom值（长焦端） */
  maxZoom: number;
  /** EMA平滑系数，范围 [0, 1]，值越大越平滑 */
  smoothingFactor: number;
}

/** 应用设置状态 */
export interface AppSettings {
  /** 灵敏度（控制响应速度），范围 [0.05, 0.5] */
  sensitivity: number;
  /** 平滑度（EMA系数），范围 [0.01, 0.5] */
  smoothness: number;
}

/** 摄像头设备信息 */
export interface CameraDeviceInfo {
  /** 设备最小zoom值 */
  minZoom: number;
  /** 设备最大zoom值 */
  maxZoom: number;
  /** 是否支持手电筒 */
  supportsFlash: boolean;
}

/** 录制状态 */
export type RecordingStatus = 'idle' | 'recording' | 'stopping' | 'saving';

/** 人脸锁定状态 */
export type FaceLockStatus = 'no-face' | 'detected' | 'locked';

/** 摄像头 facing 模式 */
export type CameraFacing = 'front' | 'back';

/** 手电筒模式 */
export type FlashMode = 'off' | 'on' | 'auto';

/** 视频录制结果 */
export interface VideoRecordResult {
  /** 视频文件URI */
  uri: string;
  /** 视频时长（毫秒） */
  duration: number;
  /** 视频尺寸 */
  size?: number;
}
