/**
 * CameraScreen.tsx — 主摄像界面组件
 *
 * 职责: 整合摄像头预览、变焦控制、录像功能和所有UI覆盖层
 * 是全屏摄像头预览的容器，叠加了顶部工具栏、人脸锁定指示器、
 * 录制按钮、Zoom显示和设置面板
 */

import React from 'react';
import {
  StyleSheet,
  View,
  SafeAreaView,
  StatusBar,
  Text,
  TouchableOpacity,
} from 'react-native';
import { CameraView, PermissionStatus } from 'expo-camera';

import type { FaceLockStatus, RecordingStatus, AppSettings } from '../types';
import { RecordButton } from './RecordButton';
import { FaceLockIndicator } from './FaceLockIndicator';
import { ZoomDisplay } from './ZoomDisplay';
import { SettingsPanel } from './SettingsPanel';

/** CameraScreen 组件 Props */
interface CameraScreenProps {
  // 摄像头相关
  cameraRef: React.RefObject<CameraView | null>;
  facing: 'front' | 'back';
  flashMode: 'off' | 'on' | 'auto';
  zoom: number;
  cameraPermission: { status: PermissionStatus; granted: boolean } | null;
  // 人脸检测相关
  faceLockStatus: FaceLockStatus;
  // 录像相关
  recordingStatus: RecordingStatus;
  onToggleRecording: () => void;
  // Zoom显示
  displayZoom: number;
  // 控制函数
  onToggleFacing: () => void;
  onToggleFlash: () => void;
  isTorchOn: boolean;
  // 设置面板
  settings: AppSettings;
  onUpdateSettings: (settings: Partial<AppSettings>) => void;
  // 权限请求
  onRequestPermission: () => void;
}

/**
 * 主摄像界面
 * 布局: 全屏摄像头预览 + 顶部工具栏 + 中央锁定指示器 + 底部控制区
 */
export const CameraScreen: React.FC<CameraScreenProps> = ({
  cameraRef,
  facing,
  flashMode,
  zoom,
  cameraPermission,
  faceLockStatus,
  recordingStatus,
  onToggleRecording,
  displayZoom,
  onToggleFacing,
  onToggleFlash,
  isTorchOn,
  settings,
  onUpdateSettings,
  onRequestPermission,
}) => {
  // === 权限未授权时的提示界面 ===
  if (!cameraPermission?.granted) {
    return (
      <View style={styles.permissionContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <Text style={styles.permissionTitle}>需要摄像头权限</Text>
        <Text style={styles.permissionText}>
          此应用需要摄像头权限以实现实时人脸检测和希区柯克变焦效果
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={onRequestPermission}
        >
          <Text style={styles.permissionButtonText}>授予权限</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* === 全屏摄像头预览 === */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        flash={flashMode}
        zoom={zoom}
        mode="video"
        enableTorch={isTorchOn}
      />

      {/* === 顶部工具栏 === */}
      <View style={styles.topBar} pointerEvents="box-none">
        <View style={styles.topBarContent}>
          {/* 手电筒按钮 */}
          <TouchableOpacity
            style={styles.iconButton}
            onPress={onToggleFlash}
            activeOpacity={0.7}
          >
            <View style={styles.iconContainer}>
              <Text style={[styles.iconText, isTorchOn && styles.iconTextActive]}>
                🔦
              </Text>
            </View>
            <Text style={styles.iconLabel}>
              {isTorchOn ? '开启' : '关闭'}
            </Text>
          </TouchableOpacity>

          {/* 录制状态指示 */}
          {recordingStatus === 'recording' && (
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>录制中</Text>
            </View>
          )}

          {/* 翻转镜头按钮 */}
          <TouchableOpacity
            style={styles.iconButton}
            onPress={onToggleFacing}
            activeOpacity={0.7}
          >
            <View style={styles.iconContainer}>
              <Text style={styles.iconText}>🔄</Text>
            </View>
            <Text style={styles.iconLabel}>翻转</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* === 中央: 人脸锁定指示器 === */}
      <View style={styles.centerOverlay} pointerEvents="none">
        <FaceLockIndicator
          lockStatus={faceLockStatus}
          faceWidth={displayZoom > 1 ? 1 : 0}
        />
      </View>

      {/* === 底部控制区 === */}
      <View style={styles.bottomControls} pointerEvents="box-none">
        {/* Zoom显示 */}
        <ZoomDisplay zoomRatio={displayZoom} />

        {/* 录制按钮 */}
        <RecordButton
          recordingStatus={recordingStatus}
          onPress={onToggleRecording}
        />

        {/* 设置面板 */}
        <SettingsPanel
          settings={settings}
          onUpdateSettings={onUpdateSettings}
        />
      </View>
    </SafeAreaView>
  );
};

/** 样式定义 */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  // === 摄像头预览 ===
  camera: {
    ...StyleSheet.absoluteFillObject,
    flex: 1,
  },
  // === 权限提示界面 ===
  permissionContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  permissionText: {
    fontSize: 15,
    color: '#aaa',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  permissionButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 10,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // === 顶部工具栏 ===
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  topBarContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 50, // 为状态栏留空间
    paddingBottom: 12,
  },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconText: {
    fontSize: 20,
  },
  iconTextActive: {
    color: '#FFD60A',
  },
  iconLabel: {
    color: '#fff',
    fontSize: 11,
    marginTop: 4,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  // === 录制状态指示 ===
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
    marginRight: 6,
  },
  recordingText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  // === 中央覆盖层 ===
  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
  },
  // === 底部控制区 ===
  bottomControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 40,
    paddingHorizontal: 20,
    zIndex: 10,
    alignItems: 'center',
  },
});
