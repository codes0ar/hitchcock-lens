/**
 * useCamera.ts — 摄像头管理Hook (react-native-vision-camera v4)
 *
 * 职责: 设备选择、权限、zoom控制、录像开始/停止
 * 变更: 从 expo-camera 迁移到 vision-camera，以支持帧处理器(实时人脸检测)与录像并行。
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { PermissionsAndroid } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraDevices,
  useCameraPermission,
  type CameraDevice,
  type VideoFile,
} from 'react-native-vision-camera';
import * as MediaLibrary from 'expo-media-library';

import type {
  CameraFacing,
  RecordingStatus,
  VideoRecordResult,
} from '../types';

/** 本机超广角等效倍率（dumpsys 实测: 超广角 2.35mm / 主摄 5.58mm ≈ 0.42x）。设备相关常量。 */
const UW_EQUIV = 0.42;
/** 设备枚举日志只打印一次（模块级标志） */
let camEnumLogged = false;

export function useCamera() {
  const cameraRef = useRef<Camera>(null);
  const recordingPromiseRef = useRef<{ resolve: (v: VideoRecordResult) => void; reject: (e: unknown) => void } | null>(null);

  const [facing, setFacing] = useState<CameraFacing>('back');
  const device = useCameraDevice(facing);
  // 枚举全部相机设备（超广角对第三方开放，id=3 已验证）
  const allDevices = useCameraDevices();
  if (!camEnumLogged && allDevices.length > 0) {
    camEnumLogged = true;
    for (const d of allDevices) {
      console.log(
        `[CamDevices] id=${d.id} pos=${d.position} phys=[${(d.physicalDevices || []).join(',')}]` +
        ` zoom=${d.minZoom}~${d.maxZoom} neutral=${d.neutralZoom}`
      );
    }
  }
  /** 后置超广角物理设备（无则 null，UW 变焦不可用）。
   *  注意必须匹配"仅超广角"的物理设备(id=3)，排除融合逻辑设备(id=0 也含 UW 但 minZoom=1) */
  const uwDevice = allDevices.find((d) => {
    const phys = d.physicalDevices || [];
    return d.position === 'back' && phys.length === 1 && phys[0] === 'ultra-wide-angle-camera';
  }) ?? null;
  /** 超广角模式：true=Camera 切换到 uwDevice（主摄等效 <1x 时） */
  const [uwActive, setUwActive] = useState(false);
  /** UW 设备自身倍率（其原生 1x = 主摄等效 UW_EQUIV） */
  const [uwRatio, setUwRatio] = useState(1.0);
  // 诊断：uwDevice 探测结果（每 5s 一次，避开一次性日志被缓冲冲掉的问题）
  const uwLogTs = useRef(0);
  if (Date.now() - uwLogTs.current > 5000) {
    uwLogTs.current = Date.now();
    console.log('[UW] uwDevice=' + (uwDevice ? `id=${uwDevice.id} zoom=${uwDevice.minZoom}~${uwDevice.maxZoom}` : 'NULL') + ' uwActive=' + uwActive);
  }

  const { hasPermission, requestPermission } = useCameraPermission();
  const [mediaPermission, requestMediaPermission] =
    MediaLibrary.usePermissions();

  const [zoom, setZoom] = useState(0); // 归一化 [0,1]，0=1x，1=maxZoom（内部状态/控制器用）
  const [flashMode, setFlashMode] = useState<'off' | 'on' | 'auto'>('off');
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [recordingStatus, setRecordingStatus] =
    useState<RecordingStatus>('idle');
  const [cameraReady, setCameraReady] = useState(false);

  // 设备 zoom 范围（vision-camera device.maxZoom 是最大倍数；capped 控制器上限）
  const [minZoomRatio, setMinZoomRatio] = useState(1.0);
  const [maxZoomRatio, setMaxZoomRatio] = useState(10.0);
  /** 传给 vision-camera Camera.zoom 的实际倍数(v4 zoom prop 是倍数不是归一化!) */
  const zoomFactor = minZoomRatio + zoom * (maxZoomRatio - minZoomRatio);

  // 设备变化时更新 zoom 范围(minZoom 可能 <1.0 超广角, maxZoom 上限 15 防止过大)
  useEffect(() => {
    if (device) {
      const devMin = typeof device.minZoom === 'number' && device.minZoom > 0
        ? device.minZoom
        : 1.0;
      // 数码变焦接力：上限恢复到 10x，保证远距离也能把人脸放大到黄框尺寸
      // （v2.1 曾压到 4x 导致"绿框远小于黄框也调不动"，现恢复；高倍会糊是数码变焦物理特性）
      const devMax = typeof device.maxZoom === 'number' && device.maxZoom > 1
        ? Math.min(device.maxZoom, 10)
        : 10.0;
      setMinZoomRatio(devMin);
      setMaxZoomRatio(devMax);
      console.log('[useCamera] 设备 zoom 范围: min=' + devMin + ' max=' + devMax + ' neutral=' + (device.neutralZoom ?? 1.0));
    }
  }, [device]);

  const requestAllPermissions = useCallback(async (): Promise<boolean> => {
    let cam = hasPermission;
    if (!cam) {
      const r = await requestPermission();
      cam = r;
    }
    let media = mediaPermission?.granted ?? false;
    if (!media) {
      const r = await requestMediaPermission();
      media = r.granted;
    }
    const mic = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
    );
    if (!mic) {
      await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
      );
    }
    return cam;
  }, [hasPermission, requestPermission, mediaPermission?.granted, requestMediaPermission]);

  const toggleFacing = useCallback(() => {
    setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
  }, []);

  const toggleFlash = useCallback(() => {
    setFlashMode((prev) => {
      if (prev === 'off') return 'on';
      if (prev === 'on') return 'auto';
      return 'off';
    });
    setIsTorchOn((prev) => !prev);
  }, []);

  const setNormalizedZoom = useCallback((normalizedZoom: number) => {
    setUwActive(false); // 控制器驱动范围是主摄 1x+，切回主摄
    setZoom(Math.max(0, Math.min(1, normalizedZoom)));
  }, []);

  /** 按主摄等效倍率设置 zoom；有超广角设备时支持 <1x（切换到 UW 物理镜头） */
  const ratioLogTs = useRef(0);
  const setZoomFromRatio = useCallback(
    (zoomRatio: number) => {
      const now = Date.now();
      if (now - ratioLogTs.current > 300) {
        ratioLogTs.current = now;
        console.log('[UW] setRatio=' + zoomRatio.toFixed(3) + ' hasUW=' + (uwDevice ? 'Y' : 'N'));
      }
      if (zoomRatio < 1.0 && uwDevice) {
        console.log('[UW] 切换到超广角: 等效=' + zoomRatio.toFixed(2) + ' UW原生=' + (zoomRatio / UW_EQUIV).toFixed(2));
        setUwActive(true);
        setUwRatio(Math.min(uwDevice.maxZoom, Math.max(uwDevice.minZoom, zoomRatio / UW_EQUIV)));
        return;
      }
      if (zoomRatio < 1.0 && !uwDevice) {
        console.log('[UW] r<1 但 uwDevice 为 NULL，无法切换');
      }
      setUwActive(false);
      const normalized =
        (zoomRatio - minZoomRatio) / (maxZoomRatio - minZoomRatio);
      setZoom(Math.max(0, Math.min(1, normalized)));
    },
    [minZoomRatio, maxZoomRatio, uwDevice]
  );

  const getCurrentZoomRatio = useCallback((): number => {
    return minZoomRatio + zoom * (maxZoomRatio - minZoomRatio);
  }, [zoom, minZoomRatio, maxZoomRatio]);

  /** 当前实际使用的相机设备（UW 模式下为超广角） */
  const activeDevice = uwActive && uwDevice ? uwDevice : device;
  /** 传给 Camera 的设备原生倍率（UW 设备上是 UW 自身倍率） */
  const cameraZoomFactor = uwActive ? uwRatio : zoomFactor;
  /** 主摄等效倍率（显示/捏合基线用） */
  const equivZoomFactor = uwActive ? uwRatio * UW_EQUIV : zoomFactor;

  const onCameraReady = useCallback(() => {
    setCameraReady(true);
  }, []);

  const updateZoomRange = useCallback(
    (range: { min?: number; max?: number }) => {
      if (typeof range.min === 'number' && range.min > 0) setMinZoomRatio(range.min);
      if (typeof range.max === 'number' && range.max > 0) setMaxZoomRatio(range.max);
    },
    []
  );

  const startRecording = useCallback(async (): Promise<void> => {
    if (recordingStatus === 'recording') return;
    if (!cameraRef.current) throw new Error('摄像头未初始化');

    const mic = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
    );
    if (!mic) {
      const res = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
      );
      if (res !== 'granted') throw new Error('需要麦克风权限以录制视频');
    }

    setRecordingStatus('recording');
    cameraRef.current.startRecording({
      onRecordingFinished: (video: VideoFile) => {
        setRecordingStatus('saving');
        MediaLibrary.saveToLibraryAsync(video.path)
          .then(() => console.log('[useCamera] 视频已保存到相册:', video.path))
          .catch((e) => console.warn('[useCamera] 保存相册失败:', e))
          .finally(() => {
            setRecordingStatus('idle');
            recordingPromiseRef.current?.resolve({
              uri: video.path,
              duration: video.duration ?? 0,
            });
            recordingPromiseRef.current = null;
          });
      },
      onRecordingError: (error) => {
        console.error('[useCamera] 录制错误:', error);
        setRecordingStatus('idle');
        recordingPromiseRef.current?.reject(error);
        recordingPromiseRef.current = null;
      },
    });
  }, [recordingStatus]);

  const stopRecording = useCallback(async (): Promise<VideoRecordResult> => {
    if (recordingStatus !== 'recording') throw new Error('当前未在录制');
    if (!cameraRef.current) throw new Error('摄像头引用不存在');

    setRecordingStatus('stopping');
    const result = await new Promise<VideoRecordResult>((resolve, reject) => {
      recordingPromiseRef.current = { resolve, reject };
      cameraRef.current!.stopRecording();
    });
    return result;
  }, [recordingStatus]);

  const toggleRecording = useCallback(async (): Promise<VideoRecordResult | void> => {
    if (recordingStatus === 'idle') {
      await startRecording();
    } else if (recordingStatus === 'recording') {
      return await stopRecording();
    }
  }, [recordingStatus, startRecording, stopRecording]);

  useEffect(() => {
    return () => {
      if (recordingStatus === 'recording' && cameraRef.current) {
        try { cameraRef.current.stopRecording(); } catch { /* ignore */ }
      }
    };
  }, [recordingStatus]);

  return {
    cameraRef,
    device: activeDevice,
    uwActive,
    hasUltraWide: uwDevice !== null,
    equivZoomFactor,
    hasPermission,
    cameraPermission: { granted: hasPermission },
    requestAllPermissions,
    facing,
    flashMode,
    zoom,
    zoomFactor: cameraZoomFactor,
    isTorchOn,
    recordingStatus,
    minZoomRatio,
    maxZoomRatio,
    cameraReady,
    onCameraReady,
    updateZoomRange,
    toggleFacing,
    toggleFlash,
    setNormalizedZoom,
    setZoomFromRatio,
    getCurrentZoomRatio,
    startRecording,
    stopRecording,
    toggleRecording,
  };
}
