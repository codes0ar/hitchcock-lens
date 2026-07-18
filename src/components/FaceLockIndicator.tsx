/**
 * FaceLockIndicator.tsx — 人脸锁定指示器组件
 *
 * 职责: 在画面中央显示人脸锁定状态
 * - 未检测到人脸: 隐藏或显示灰色提示
 * - 检测到人脸: 显示绿色锁定图标 + 脉冲效果
 * - 人脸丢失: 显示警告色提示
 */

import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  Animated,
  Easing,
} from 'react-native';

import type { FaceLockStatus } from '../types';

/** 人脸锁定指示器 Props */
interface FaceLockIndicatorProps {
  /** 当前锁定状态 */
  lockStatus: FaceLockStatus;
  /** 人脸宽度（用于显示大小参考） */
  faceWidth: number;
}

/**
 * 人脸锁定指示器
 * 显示在画面中央，告知用户人脸检测和锁定状态
 */
export const FaceLockIndicator: React.FC<FaceLockIndicatorProps> = ({
  lockStatus,
}) => {
  // 呼吸动画值
  const breatheAnim = React.useRef(new Animated.Value(1)).current;

  // 锁定状态下的呼吸灯效果
  React.useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;

    if (lockStatus === 'locked') {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(breatheAnim, {
            toValue: 1.15,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(breatheAnim, {
            toValue: 1.0,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
    } else {
      breatheAnim.setValue(1);
    }

    return () => {
      if (animation) {
        animation.stop();
      }
    };
  }, [lockStatus, breatheAnim]);

  // 根据状态决定显示内容
  const getIndicatorContent = () => {
    switch (lockStatus) {
      case 'no-face':
        return (
          <View style={styles.container}>
            <View style={[styles.iconCircle, styles.noFaceCircle]}>
              <Text style={styles.icon}>👤</Text>
            </View>
            <Text style={styles.noFaceText}>未检测到人脸</Text>
          </View>
        );

      case 'detected':
        return (
          <View style={styles.container}>
            <Animated.View
              style={[
                styles.iconCircle,
                styles.detectedCircle,
                { transform: [{ scale: breatheAnim }] },
              ]}
            >
              <Text style={styles.icon}>🔍</Text>
            </Animated.View>
            <Text style={styles.detectedText}>检测到人脸，锁定中...</Text>
          </View>
        );

      case 'locked':
        return (
          <View style={styles.container}>
            <Animated.View
              style={[
                styles.iconCircle,
                styles.lockedCircle,
                { transform: [{ scale: breatheAnim }] },
              ]}
            >
              <Text style={styles.icon}>🔒</Text>
            </Animated.View>
            <Text style={styles.lockedText}>人脸已锁定</Text>
          </View>
        );

      default:
        return null;
    }
  };

  // no-face 状态时不显示指示器（保持画面干净）
  if (lockStatus === 'no-face') {
    return null;
  }

  return (
    <View style={styles.wrapper}>
      {getIndicatorContent()}
    </View>
  );
};

/** 样式定义 */
const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  /** 图标圆形背景 */
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 2,
  },
  noFaceCircle: {
    backgroundColor: 'rgba(120, 120, 120, 0.4)',
    borderColor: 'rgba(150, 150, 150, 0.6)',
  },
  detectedCircle: {
    backgroundColor: 'rgba(255, 204, 0, 0.3)',
    borderColor: '#FFCC00',
  },
  lockedCircle: {
    backgroundColor: 'rgba(52, 199, 89, 0.3)',
    borderColor: '#34C759',
  },
  icon: {
    fontSize: 26,
  },
  noFaceText: {
    color: '#aaa',
    fontSize: 14,
    fontWeight: '500',
  },
  detectedText: {
    color: '#FFCC00',
    fontSize: 14,
    fontWeight: '600',
  },
  lockedText: {
    color: '#34C759',
    fontSize: 14,
    fontWeight: '700',
  },
});
