/**
 * ZoomDisplay.tsx — Zoom倍数显示组件
 *
 * 职责: 在底部区域显示当前的zoom倍数（如 "1.0x"、"2.5x"）
 * 帮助用户了解当前变焦状态
 */

import React from 'react';
import {
  StyleSheet,
  View,
  Text,
} from 'react-native';

/** Zoom显示 Props */
interface ZoomDisplayProps {
  /** 当前zoom倍数（如 1.0, 2.5, 5.0） */
  zoomRatio: number;
}

/**
 * Zoom倍数显示组件
 * 简洁地显示当前光学/数码变焦倍数
 */
export const ZoomDisplay: React.FC<ZoomDisplayProps> = ({ zoomRatio }) => {
  // 格式化为一位小数 + x后缀
  const formattedZoom = `${zoomRatio.toFixed(1)}x`;

  return (
    <View style={styles.container}>
      <View style={styles.badge}>
        <Text style={styles.text}>{formattedZoom}</Text>
      </View>
    </View>
  );
};

/** 样式定义 */
const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginBottom: 8,
  },
  badge: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  text: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'], // 等宽数字，防止抖动
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
