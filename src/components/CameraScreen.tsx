/**
 * CameraScreen.tsx — 主摄像界面 (react-native-vision-camera v4 直连)
 *
 * 直接用 vision-camera 的 Camera + useFrameProcessor + useFaceDetector，
 * 不用 face-detector 的 Camera 包装(它强制 useSkiaFrameProcessor 需 skia)。
 * 帧处理器实时检测人脸，无 takePictureAsync → 无白屏闪、~相机帧率。
 * autoMode=true 使 bounds 直接为屏幕坐标，绿框无需手动映射。
 */

import React from 'react';
import {
  StyleSheet,
  View,
  SafeAreaView,
  StatusBar,
  Text,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import {
  Camera,
  useFrameProcessor,
  type CameraDevice,
} from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import { useFaceDetector, type Face, type FrameFaceDetectionOptions } from 'react-native-vision-camera-face-detector';

import type { FaceLockStatus, RecordingStatus, AppSettings, CameraFacing } from '../types';
import { RecordButton } from './RecordButton';
import { FaceLockIndicator } from './FaceLockIndicator';
import { ZoomDisplay } from './ZoomDisplay';
import { SettingsPanel } from './SettingsPanel';

const { width: WIN_W, height: WIN_H } = Dimensions.get('window');

interface CameraScreenProps {
  cameraRef: React.RefObject<Camera | null>;
  device: CameraDevice | undefined;
  facing: CameraFacing;
  zoom: number;
  isTorchOn: boolean;
  hasPermission: boolean;
  cameraReady: boolean;
  onCameraReady: () => void;
  faceBounds: { x: number; y: number; width: number; height: number } | null;
  onFacesDetected: (faces: Face[]) => void;
  faceLockStatus: FaceLockStatus;
  recordingStatus: RecordingStatus;
  onToggleRecording: () => void;
  displayZoom: number;
  onToggleFacing: () => void;
  onToggleFlash: () => void;
  settings: AppSettings;
  onUpdateSettings: (settings: Partial<AppSettings>) => void;
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
  onFacesDetected,
  faceLockStatus,
  recordingStatus,
  onToggleRecording,
  displayZoom,
  onToggleFacing,
  onToggleFlash,
  settings,
  onUpdateSettings,
  onRequestPermission,
}) => {
  const detector = useFaceDetector({
    performanceMode: 'fast',
    landmarkMode: 'none',
    contourMode: 'none',
    classificationMode: 'none',
    trackingEnabled: true,
    autoMode: true,
    windowWidth: WIN_W,
    windowHeight: WIN_H,
    cameraFacing: facing,
  } as FrameFaceDetectionOptions);

  // worklet → JS：把检测到的人脸(JSON)扔回 JS 线程更新 state
  const sendFacesToJs = useRunOnJS(
    (facesJson: string) => {
      try {
        const faces = JSON.parse(facesJson) as Face[];
        onFacesDetected(faces);
      } catch (e) {
        // ignore parse error
      }
    },
    [onFacesDetected]
  );

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      try {
        const faces = detector.detectFaces(frame);
        sendFacesToJs(JSON.stringify(faces));
      } catch (e) {
        // 检测错误不上报以免刷屏
      }
    },
    [detector, sendFacesToJs]
  );

  // 自动居中: 高倍数时数字平移 Camera 使人脸居中(zoom≤1 时不裁剪保持画质)
  const centeringGain = Math.max(0, Math.min(1, (zoom - 1) / 3)); // 0@1x, 1@4x+
  const centerScale = 1 + 0.15 * centeringGain;
  let dx = 0;
  let dy = 0;
  if (faceBounds && faceBounds.width > 0 && centeringGain > 0) {
    const fx = faceBounds.x + faceBounds.width / 2;
    const fy = faceBounds.y + faceBounds.height / 2;
    dx = -centerScale * (fx - WIN_W / 2) * centeringGain;
    dy = -centerScale * (fy - WIN_H / 2) * centeringGain;
    const maxDx = WIN_W * 0.07 * centeringGain;
    const maxDy = WIN_H * 0.07 * centeringGain;
    dx = Math.max(-maxDx, Math.min(maxDx, dx));
    dy = Math.max(-maxDy, Math.min(maxDy, dy));
  }

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
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {device ? (
        <Camera
          ref={cameraRef as React.RefObject<Camera>}
          style={[styles.camera, { transform: [{ scale: centerScale }, { translateX: dx }, { translateY: dy }] }]}
          device={device}
          isActive
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

      {/* === 人脸检测框叠加（绿框，autoMode 已是屏幕坐标，随人脸大小变化） === */}
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

      {/* === 中心准星(自动居中激活时显示) === */}
      {centeringGain > 0 && (
        <View style={styles.centerReticle} pointerEvents="none">
          <View style={styles.reticleH} />
          <View style={styles.reticleV} />
        </View>
      )}

      {/* === 顶部工具栏 === */}
      <View style={styles.topBar} pointerEvents="box-none">
        <View style={styles.topBarContent}>
          <TouchableOpacity style={styles.iconButton} onPress={onToggleFlash} activeOpacity={0.7}>
            <View style={styles.iconContainer}>
              <Text style={[styles.iconText, isTorchOn && styles.iconTextActive]}>🔦</Text>
            </View>
            <Text style={styles.iconLabel}>{isTorchOn ? '开启' : '关闭'}</Text>
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
      <View style={styles.centerOverlay} pointerEvents="none">
        <FaceLockIndicator lockStatus={faceLockStatus} faceWidth={displayZoom > 1 ? 1 : 0} />
      </View>

      {/* === 底部控制区 === */}
      <View style={styles.bottomControls} pointerEvents="box-none">
        <ZoomDisplay zoomRatio={displayZoom} />
        <RecordButton recordingStatus={recordingStatus} onPress={onToggleRecording} />
        <SettingsPanel settings={settings} onUpdateSettings={onUpdateSettings} />
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
  recordingIndicator: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.5)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30', marginRight: 6 },
  recordingText: { color: '#fff', fontSize: 13, fontWeight: '500' },
  centerOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', zIndex: 5 },
  bottomControls: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: 40, paddingHorizontal: 20, zIndex: 10, alignItems: 'center' },
  centerReticle: { position: 'absolute', left: WIN_W / 2 - 15, top: WIN_H / 2 - 15, width: 30, height: 30, zIndex: 6 },
  reticleH: { position: 'absolute', left: 0, top: 14, width: 30, height: 2, backgroundColor: 'rgba(255,255,255,0.7)' },
  reticleV: { position: 'absolute', left: 14, top: 0, width: 2, height: 30, backgroundColor: 'rgba(255,255,255,0.7)' },
});
