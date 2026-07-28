/**
 * CameraScreen.tsx — 主摄像界面 (react-native-vision-camera v4 直连)
 *
 * 直接用 vision-camera 的 Camera + useFrameProcessor + useFaceDetector，
 * 不用 face-detector 的 Camera 包装(它强制 useSkiaFrameProcessor 需 skia)。
 * 帧处理器实时检测人脸，无 takePictureAsync → 无白屏闪、~相机帧率。
 * autoMode=true 使 bounds 直接为屏幕坐标，绿框无需手动映射。
 */

import React, { useRef, useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  SafeAreaView,
  StatusBar,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  PanResponder,
  AppState,
  useWindowDimensions,
} from 'react-native';
import {
  Camera,
  useFrameProcessor,
  type CameraDevice,
} from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import { useFaceDetector, type Face, type FrameFaceDetectionOptions } from 'react-native-vision-camera-face-detector';
import { Accelerometer } from 'expo-sensors';

import type { FaceLockStatus, RecordingStatus, AppSettings, CameraFacing } from '../types';
import type { PIDDebug } from '../utils/ZoomController';
import { RecordButton } from './RecordButton';
import { FaceLockIndicator } from './FaceLockIndicator';
import { ZoomDisplay } from './ZoomDisplay';
import { SettingsPanel } from './SettingsPanel';

type BoxBounds = { x: number; y: number; width: number; height: number };

/**
 * 复制 face-detector 原生 autoMode 的"后摄"缩放+旋转公式，
 * 但 orientation 改用我们自己用加速度计测到的物理方向（原生监听器在本机不触发）。
 * raw 为 autoMode=false 返回的图像坐标框（imageW×imageH）。
 */
function processBox(
  raw: BoxBounds,
  orientation: number, // 0 / 90 / 180 / 270
  winW: number,
  winH: number,
  imageW: number,
  imageH: number
): BoxBounds {
  // 与原生一致：sourceWidth=image.height, sourceHeight=image.width（带维度交换）
  const sourceWidth = imageH;
  const sourceHeight = imageW;
  const scaleX = winW / sourceWidth;
  const scaleY = winH / sourceHeight;
  const w = raw.width * scaleX;
  const h = raw.height * scaleY;
  const x = raw.x;
  const y = raw.y;
  let bx = x * scaleX;
  let by = y * scaleY;
  if (orientation === 270) {
    bx = y * scaleX;
    by = (sourceHeight - x) * scaleY - h;
  } else if (orientation === 90) {
    bx = (sourceWidth - y) * scaleX - w;
    by = x * scaleY;
  } else if (orientation === 180) {
    bx = (sourceWidth - x) * scaleX - w;
    by = (sourceHeight - y) * scaleY - h;
  }
  return { x: bx, y: by, width: w, height: h };
}

interface CameraScreenProps {
  cameraRef: React.RefObject<Camera | null>;
  device: CameraDevice | undefined;
  facing: CameraFacing;
  zoom: number;
  zoomNormalized: number;
  isTorchOn: boolean;
  hasPermission: boolean;
  cameraReady: boolean;
  onCameraReady: () => void;
  faceBounds: { x: number; y: number; width: number; height: number } | null;
  /** 录制时的黄色参考框(固定屏幕位置, 不随人脸移动) */
  referenceBounds: { x: number; y: number; width: number; height: number } | null;
  onFacesDetected: (faces: Face[]) => void;
  faceLockStatus: FaceLockStatus;
  recordingStatus: RecordingStatus;
  onToggleRecording: () => void;
  displayZoom: number;
  isLocked: boolean;
  onToggleLock: () => void;
  onManualZoom: (normalized: number) => void;
  /** 捏合缩放：按真实变焦倍数(1~maxX)做乘法 */
  onManualZoomRatio: (ratio: number) => void;
  debugInfo: PIDDebug | null;
  faceDebug: { eyeDist: number; avgMetric: number; boundsW: number; hasLandmark: boolean } | null;
  onToggleFacing: () => void;
  onToggleFlash: () => void;
  settings: AppSettings;
  onUpdateSettings: (settings: Partial<AppSettings>) => void;
  pidKp: number;
  pidKi: number;
  pidKd: number;
  onUpdatePidKp: (v: number) => void;
  onUpdatePidKi: (v: number) => void;
  onUpdatePidKd: (v: number) => void;
  /** 控制模式开关状态与切换（PID+卡尔曼+前馈 vs 纯PID） */
  kalmanLeadEnabled: boolean;
  onToggleKalmanLead: () => void;
  onRequestPermission: () => void;
}

export const CameraScreen: React.FC<CameraScreenProps> = ({
  cameraRef,
  device,
  facing,
  zoom,
  isTorchOn,
  hasPermission,
  cameraReady,
  onCameraReady,
  faceBounds,
  referenceBounds,
  onFacesDetected,
  faceLockStatus,
  recordingStatus,
  onToggleRecording,
  displayZoom,
  isLocked,
  onToggleLock,
  onManualZoom,
  debugInfo,
  faceDebug,
  onToggleFacing,
  onToggleFlash,
  settings,
  onUpdateSettings,
  pidKp,
  pidKi,
  pidKd,
  onUpdatePidKp,
  onUpdatePidKi,
  onUpdatePidKd,
  kalmanLeadEnabled,
  onToggleKalmanLead,
  onRequestPermission,
  onManualZoomRatio,
}) => {
  // 实验：autoMode=false 拿原始帧坐标，日志打印原始框，验证检测库给的坐标系
  const { width: winW, height: winH } = useWindowDimensions();
  const detectorOptions = useMemo(
    () =>
      ({
        performanceMode: 'fast',
        landmarkMode: 'none',
        contourMode: 'none',
        classificationMode: 'none',
        trackingEnabled: true,
        autoMode: false,
        minFaceSize: 0.05, // 最小人脸比例从默认 0.15 降到 0.05，让更远/更小的人脸也能被检出
        cameraFacing: facing,
      } as FrameFaceDetectionOptions),
    [facing]
  );
  const detector = useFaceDetector(detectorOptions);

  // === 加速度计测设备物理方向（替代原生方向监听器，本机它不触发）===
  const [deviceRotation, setDeviceRotation] = useState(0); // 0/90/180/270
  const deviceRotationRef = useRef(0);
  const accelLogTs = useRef(0);
  useEffect(() => {
    Accelerometer.setUpdateInterval(200);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      // 低通滤波
      const gx = x, gy = y;
      let rot = deviceRotationRef.current;
      if (Math.abs(gy) >= Math.abs(gx)) {
        rot = gy < -2 ? 0 : gy > 2 ? 180 : rot;
      } else {
        rot = gx > 2 ? 270 : gx < -2 ? 90 : rot;
      }
      if (rot !== deviceRotationRef.current) {
        deviceRotationRef.current = rot;
        setDeviceRotation(rot);
      }
      const now = Date.now();
      if (now - accelLogTs.current > 1000) {
        accelLogTs.current = now;
        console.log(`[Accel] x=${x.toFixed(2)} y=${y.toFixed(2)} z=${z.toFixed(2)} rot=${rot}`);
      }
    });
    return () => sub.remove();
  }, []);

  // 记录最近一次帧方向/尺寸，用于 debug 面板核对映射是否正确
  const [oriDebug, setOriDebug] = useState('?');
  const diagLogTs = useRef(0);

  // worklet → JS：把检测到的人脸(图像坐标)扔回 JS 线程，用加速度计方向做缩放+旋转映射
  const sendFacesToJs = useRunOnJS(
    (payloadJson: string) => {
      try {
        const payload = JSON.parse(payloadJson) as {
          faces: Face[];
          orientation: string;
          frameWidth: number;
          frameHeight: number;
          isMirrored: boolean;
        };
        setOriDebug(`${deviceRotationRef.current} ${payload.frameWidth}x${payload.frameHeight}`);
        const rot = deviceRotationRef.current;
        const mapped = payload.faces.map((f) => ({
          ...f,
          bounds: processBox(f.bounds, rot, winW, winH, payload.frameWidth, payload.frameHeight),
        }));
        // 诊断日志：方向 + 原始框 + 映射后框（每秒一条，adb 可读）
        const now = Date.now();
        if (now - diagLogTs.current > 1000) {
          diagLogTs.current = now;
          const f = payload.faces[0];
          const m = mapped[0];
          console.log(
            `[Map] rot=${rot} win=${winW.toFixed(0)}x${winH.toFixed(0)} frame=${payload.frameWidth}x${payload.frameHeight}` +
            (f && m
              ? ` raw=(${f.bounds.x.toFixed(0)},${f.bounds.y.toFixed(0)},${f.bounds.width.toFixed(0)}x${f.bounds.height.toFixed(0)})` +
                ` -> box=(${m.bounds.x.toFixed(0)},${m.bounds.y.toFixed(0)},${m.bounds.width.toFixed(0)}x${m.bounds.height.toFixed(0)})`
              : ' no-face')
          );
        }
        onFacesDetected(mapped);
      } catch (e) {
        // ignore parse error
      }
    },
    [onFacesDetected, winW, winH]
  );

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      try {
        const faces = detector.detectFaces(frame);
        sendFacesToJs(
          JSON.stringify({
            faces,
            orientation: frame.orientation,
            frameWidth: frame.width,
            frameHeight: frame.height,
            isMirrored: frame.isMirrored,
          })
        );
      } catch (e) {
        // 检测错误不上报以免刷屏
      }
    },
    [detector, sendFacesToJs]
  );

  // App 前后台状态：后台/锁屏时关闭相机，回前台时重新激活，
  // 强制 vision-camera 重建会话，修复"回桌面+锁屏后重新进入黑屏"的问题。
  const [appActive, setAppActive] = useState(true);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => sub.remove();
  }, []);

  // 双指捏合缩放(预览未锁定且未录制时可用; 无人脸也可用, 因为不依赖锁定)
  // 基准用真实变焦倍数 zoom(1~maxX) 做乘法：归一化 0~1 在 1x 时是 0，乘法会恒为 0（旧 bug）
  const zoomFactorRef = useRef(zoom);
  useEffect(() => { zoomFactorRef.current = zoom; }, [zoom]);
  const isLockedRef = useRef(isLocked);
  useEffect(() => { isLockedRef.current = isLocked; }, [isLocked]);
  const recStatusRef = useRef(recordingStatus);
  useEffect(() => { recStatusRef.current = recordingStatus; }, [recordingStatus]);
  const pinchRef = useRef({ initialDist: 0, initialZoom: 0 });
  const smoothRatioRef = useRef(0);
  // 捏合调试：实时显示触点数和系数，用于追溯为什么捏合不生效
  const [pinchDebug, setPinchDebug] = useState({ touches: 0, factor: 0 });
  // 用根容器原生 onTouch* 事件（与 zoom slider 同一套机制，直接读 touches 数组）。
  const handlePinchTouch = (evt: { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } }) => {
    const t = evt.nativeEvent.touches;
    if (t.length >= 2) {
      const dist = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
      if (isLockedRef.current || recStatusRef.current === 'recording') {
        setPinchDebug({ touches: t.length, factor: -1 }); // -1 = 被锁定/录制门挡住
        return;
      }
      if (pinchRef.current.initialDist <= 0) {
        pinchRef.current.initialDist = dist;
        pinchRef.current.initialZoom = zoomFactorRef.current; // 真实倍数 1~maxX
        smoothRatioRef.current = zoomFactorRef.current;
        setPinchDebug({ touches: t.length, factor: 1 });
        return;
      }
      const factor = dist / pinchRef.current.initialDist;
      const targetRatio = pinchRef.current.initialZoom * factor;
      // EMA 平滑，让捏合 zoom 不跳
      smoothRatioRef.current += (targetRatio - smoothRatioRef.current) * 0.35;
      setPinchDebug({ touches: t.length, factor });
      onManualZoomRatio(smoothRatioRef.current);
    } else {
      if (pinchRef.current.initialDist > 0 || pinchDebug.touches !== 0) {
        setPinchDebug({ touches: t.length, factor: 0 });
      }
      pinchRef.current.initialDist = 0;
      smoothRatioRef.current = 0;
    }
  };
  const resetPinch = () => {
    pinchRef.current.initialDist = 0;
    smoothRatioRef.current = 0;
    setPinchDebug({ touches: 0, factor: 0 });
  };

  if (!hasPermission) {
    return (
      <View style={styles.permissionContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <Text style={styles.permissionTitle}>需要摄像头权限</Text>
        <Text style={styles.permissionText}>
          此应用需要摄像头权限以实现实时人脸检测和希区柯克变焦效果
        </Text>
        <TouchableOpacity style={styles.permissionButton} onPress={onRequestPermission}>
          <Text style={styles.permissionButtonText}>授予权限</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView
      style={styles.container}
      onTouchStart={handlePinchTouch}
      onTouchMove={handlePinchTouch}
      onTouchEnd={resetPinch}
      onTouchCancel={resetPinch}
    >
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* === 相机预览（本机 SurfaceView 不跟 transform/布局偏移，稳像已放弃；固定全屏） === */}
      {device ? (
        <Camera
          ref={cameraRef as React.RefObject<Camera>}
          style={styles.camera}
          device={device}
          isActive={appActive}
          audio={true}
          videoStabilizationMode="off"
          zoom={zoom}
          torch={isTorchOn ? 'on' : 'off'}
          onInitialized={onCameraReady}
          frameProcessor={frameProcessor}
          enableZoomGesture={false}
        />
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.loadingText}>正在初始化摄像头…</Text>
        </View>
      )}

      {/* === 人脸检测框叠加（绿框，autoMode 屏幕坐标，直接贴脸，无任何变换） === */}
      {faceBounds && faceBounds.width > 0 && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: faceBounds.x,
            top: faceBounds.y,
            width: faceBounds.width,
            height: faceBounds.height,
            borderColor: '#00FF00',
            borderWidth: 3,
            zIndex: 4,
          }}
        />
      )}

      {/* === 录制时的黄色参考框(固定屏幕位置, 提示用户保持人脸居中+控制移动速度) === */}
      {referenceBounds && referenceBounds.width > 0 && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: referenceBounds.x,
            top: referenceBounds.y,
            width: referenceBounds.width,
            height: referenceBounds.height,
            borderColor: 'rgba(255, 215, 0, 0.85)',
            borderWidth: 3,
            zIndex: 5,
          }}
        />
      )}

      {/* === DEBUG 信息面板(on-screen overlay) === */}
      <View style={styles.debugOverlay} pointerEvents="none">
        <Text style={styles.debugText}>
          <Text style={styles.debugTitle}>● Kp:{pidKp.toFixed(2)} Ki:{pidKi.toFixed(3)} Kd:{pidKd.toFixed(3)}</Text>{'\n'}
          lock:{isLocked ? 'Y' : 'N'} zoom:{displayZoom.toFixed(2)}x{'\n'}
          pinch:{pinchDebug.touches} f:{pinchDebug.factor.toFixed(2)}{'\n'}
          win:{winW.toFixed(0)}x{winH.toFixed(0)}{'\n'}
          ori:{oriDebug}{'\n'}
          {faceDebug ? `eye:${faceDebug.eyeDist.toFixed(0)} avg:${faceDebug.avgMetric.toFixed(0)} bw:${faceDebug.boundsW.toFixed(0)} lm:${faceDebug.hasLandmark ? 'Y' : 'N'}` : 'no-face'}{'\n'}
          {debugInfo ? `tgt:${debugInfo.target.toFixed(0)} faceW:${debugInfo.faceW.toFixed(1)}` : ''}{'\n'}
          {debugInfo ? `err:${debugInfo.error.toFixed(4)} dt:${debugInfo.dt.toFixed(2)}` : ''}{'\n'}
          {debugInfo ? `Kp*e:${debugInfo.P.toFixed(4)} Ki*∫:${debugInfo.I.toFixed(4)} Kd*de:${debugInfo.D.toFixed(4)}` : ''}{'\n'}
          {debugInfo ? `dMeas:${debugInfo.dMeasurement.toFixed(1)} ∫e:${debugInfo.integral.toFixed(3)}` : ''}{'\n'}
          {debugInfo ? `out:${debugInfo.output.toFixed(3)}x` : ''}{'\n'}
          v4.7
        </Text>
      </View>

      {/* === 顶部工具栏 === */}
      <View style={styles.topBar} pointerEvents="box-none">
        <View style={styles.topBarContent}>
          <TouchableOpacity style={styles.iconButton} onPress={onToggleFlash} activeOpacity={0.7}>
            <View style={styles.iconContainer}>
              <Text style={[styles.iconText, isTorchOn && styles.iconTextActive]}>🔦</Text>
            </View>
            <Text style={styles.iconLabel}>{isTorchOn ? '开启' : '关闭'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.iconButton} onPress={onToggleLock} activeOpacity={0.7}>
            <View style={[styles.iconContainer, isLocked && styles.iconContainerActive]}>
              <Text style={styles.iconText}>{isLocked ? '🔒' : '🔓'}</Text>
            </View>
            <Text style={[styles.iconLabel, isLocked && styles.iconLabelActive]}>
              {isLocked ? '已锁定' : '点击锁定'}
            </Text>
          </TouchableOpacity>

          {recordingStatus === 'recording' && (
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>录制中</Text>
            </View>
          )}

          <TouchableOpacity style={styles.iconButton} onPress={onToggleFacing} activeOpacity={0.7}>
            <View style={styles.iconContainer}>
              <Text style={styles.iconText}>🔄</Text>
            </View>
            <Text style={styles.iconLabel}>翻转</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* === 中央: 人脸锁定指示器 === */}
      <View style={styles.centerOverlay} pointerEvents="box-none">
        <FaceLockIndicator lockStatus={faceLockStatus} faceWidth={displayZoom > 1 ? 1 : 0} onToggleLock={onToggleLock} />
      </View>

      {/* === 底部控制区 === */}
      <View style={styles.bottomControls} pointerEvents="box-none">
        <ZoomDisplay zoomRatio={displayZoom} />
        <RecordButton recordingStatus={recordingStatus} onPress={onToggleRecording} />
        <SettingsPanel pidKp={pidKp} pidKi={pidKi} pidKd={pidKd}
          onUpdatePidKp={onUpdatePidKp} onUpdatePidKi={onUpdatePidKi} onUpdatePidKd={onUpdatePidKd}
          kalmanLeadEnabled={kalmanLeadEnabled} onToggleKalmanLead={onToggleKalmanLead} />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  camera: { ...StyleSheet.absoluteFillObject, flex: 1 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#fff', marginTop: 12 },
  permissionContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  permissionTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 12 },
  permissionText: { fontSize: 15, color: '#aaa', textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  permissionButton: { backgroundColor: '#007AFF', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 10 },
  permissionButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  topBarContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 50, paddingBottom: 12 },
  iconButton: { alignItems: 'center', justifyContent: 'center' },
  iconContainer: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0, 0, 0, 0.4)', justifyContent: 'center', alignItems: 'center' },
  iconText: { fontSize: 20 },
  iconTextActive: { color: '#FFD60A' },
  iconLabel: { color: '#fff', fontSize: 11, marginTop: 4, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  iconLabelActive: { color: '#34C759' },
  iconContainerActive: { backgroundColor: 'rgba(52, 199, 89, 0.3)', borderColor: '#34C759', borderWidth: 1 },
  recordingIndicator: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.5)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30', marginRight: 6 },
  recordingText: { color: '#fff', fontSize: 13, fontWeight: '500' },
  centerOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', zIndex: 5 },
  bottomControls: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: 40, paddingHorizontal: 20, zIndex: 10, alignItems: 'center' },
  debugOverlay: { position: 'absolute', left: 8, top: 60, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, zIndex: 20, maxWidth: 240 },
  debugText: { color: '#0F0', fontSize: 10, fontFamily: 'monospace', lineHeight: 13 },
  debugTitle: { color: '#FF0', fontSize: 10, fontFamily: 'monospace', fontWeight: '700' },
});
