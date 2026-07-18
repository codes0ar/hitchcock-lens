/**
 * RecordButton.tsx — 录制按钮组件
 *
 * 职责: 显示录制/停止按钮，录制时显示红色脉动动画效果
 * 位于屏幕底部中央，是主要的用户交互入口
 */

import React from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';

import type { RecordingStatus } from '../types';

/** 录制按钮 Props */
interface RecordButtonProps {
  /** 当前录制状态 */
  recordingStatus: RecordingStatus;
  /** 点击回调（开始/停止录制） */
  onPress: () => void;
}

/**
 * 录制按钮组件
 * - 空闲状态: 白色空心圆环 + 红色实心内圆
 * - 录制中: 红色实心方形 + 脉动动画环
 */
export const RecordButton: React.FC<RecordButtonProps> = ({
  recordingStatus,
  onPress,
}) => {
  const isRecording = recordingStatus === 'recording';

  // 脉动动画值
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  // 录制中的脉动动画效果
  React.useEffect(() => {
    let pulseAnimation: Animated.CompositeAnimation | null = null;

    if (isRecording) {
      // 创建循环脉动动画
      pulseAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.6,
            duration: 1000,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1.0,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      );
      pulseAnimation.start();
    } else {
      // 停止录制时重置动画
      pulseAnim.setValue(1);
    }

    return () => {
      if (pulseAnimation) {
        pulseAnimation.stop();
      }
    };
  }, [isRecording, pulseAnim]);

  return (
    <View style={styles.container}>
      {/* 脉动动画环（仅录制时显示） */}
      {isRecording && (
        <Animated.View
          style={[
            styles.pulseRing,
            {
              transform: [{ scale: pulseAnim }],
              opacity: pulseAnim.interpolate({
                inputRange: [1, 1.6],
                outputRange: [0.5, 0],
              }),
            },
          ]}
        />
      )}

      {/* 主按钮 */}
      <TouchableOpacity
        style={styles.button}
        onPress={onPress}
        activeOpacity={0.8}
        disabled={recordingStatus === 'stopping' || recordingStatus === 'saving'}
      >
        <View style={styles.outerRing}>
          {isRecording ? (
            // 录制中: 红色方形（停止按钮）
            <View style={styles.stopSquare} />
          ) : (
            // 空闲: 红色实心圆（开始按钮）
            <View style={styles.recordCircle} />
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
};

/** 样式定义 */
const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  /** 脉动动画环 */
  pulseRing: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FF3B30',
  },
  /** 按钮触控区域 */
  button: {
    width: 84,
    height: 84,
    borderRadius: 42,
    justifyContent: 'center',
    alignItems: 'center',
  },
  /** 外圈白环 */
  outerRing: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  /** 录制圆点（空闲状态） */
  recordCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FF3B30',
  },
  /** 停止方块（录制中状态） */
  stopSquare: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
  },
});
