/**
 * SettingsPanel.tsx — 设置面板组件
 *
 * 职责: 底部弹出式设置面板，包含:
 * - 灵敏度调节滑块（控制zoom响应速度）
 * - 平滑度调节滑块（控制EMA平滑系数，防止抖动）
 */

import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Modal,
  Animated,
  Easing,
  ScrollView,
  Dimensions,
  GestureResponderEvent,
} from 'react-native';

import type { AppSettings } from '../types';

/** 设置面板 Props */
interface SettingsPanelProps {
  /** 当前设置值 */
  settings: AppSettings;
  /** 设置变更回调 */
  onUpdateSettings: (settings: Partial<AppSettings>) => void;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * 自定义滑块组件
 * （使用 Touchable 实现，不依赖外部库）
 */
interface CustomSliderProps {
  label: string;
  value: number;
  minimumValue: number;
  maximumValue: number;
  onValueChange: (value: number) => void;
  step?: number;
  description?: string;
}

const CustomSlider: React.FC<CustomSliderProps> = ({
  label,
  value,
  minimumValue,
  maximumValue,
  onValueChange,
  step = 0.01,
  description,
}) => {
  // 计算百分比位置
  const progress = (value - minimumValue) / (maximumValue - minimumValue);

  // 处理滑块条上的触摸
  const handleBarPress = useCallback(
    (event: GestureResponderEvent) => {
      const { locationX } = event.nativeEvent;
      // 假设滑块条宽度约为 SCREEN_WIDTH - 80（左右padding）
      const sliderWidth = Dimensions.get('window').width - 80;
      const ratio = Math.max(0, Math.min(1, locationX / sliderWidth));
      const newValue = minimumValue + ratio * (maximumValue - minimumValue);

      // 根据step取整
      const steppedValue = Math.round(newValue / step) * step;
      const clampedValue = Math.max(
        minimumValue,
        Math.min(maximumValue, steppedValue)
      );

      onValueChange(parseFloat(clampedValue.toFixed(2)));
    },
    [minimumValue, maximumValue, step, onValueChange]
  );

  return (
    <View style={sliderStyles.container}>
      <View style={sliderStyles.labelRow}>
        <Text style={sliderStyles.label}>{label}</Text>
        <Text style={sliderStyles.value}>{value.toFixed(2)}</Text>
      </View>
      {description && (
        <Text style={sliderStyles.description}>{description}</Text>
      )}
      <TouchableOpacity
        style={sliderStyles.track}
        onPress={handleBarPress}
        activeOpacity={1}
      >
        {/* 已填充部分 */}
        <View
          style={[
            sliderStyles.fill,
            { width: `${progress * 100}%` },
          ]}
        />
        {/* 滑块按钮 */}
        <View
          style={[
            sliderStyles.thumb,
            { left: `${progress * 100}%`, marginLeft: -12 },
          ]}
        />
      </TouchableOpacity>
    </View>
  );
};

/**
 * 设置面板组件
 * 通过底部弹窗展示设置选项
 */
export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const [visible, setVisible] = useState(false);
  const slideAnim = React.useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  // 打开面板动画
  const openPanel = useCallback(() => {
    setVisible(true);
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideAnim]);

  // 关闭面板动画
  const closePanel = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: SCREEN_HEIGHT,
      duration: 250,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setVisible(false);
    });
  }, [slideAnim]);

  // 处理灵敏度变更
  const handleSensitivityChange = useCallback(
    (value: number) => {
      onUpdateSettings({ sensitivity: value });
    },
    [onUpdateSettings]
  );

  // 处理平滑度变更
  const handleSmoothnessChange = useCallback(
    (value: number) => {
      onUpdateSettings({ smoothness: value });
    },
    [onUpdateSettings]
  );

  return (
    <>
      {/* 设置按钮 */}
      <TouchableOpacity
        style={styles.settingsButton}
        onPress={openPanel}
        activeOpacity={0.7}
      >
        <Text style={styles.settingsIcon}>⚙️</Text>
      </TouchableOpacity>

      {/* 设置面板弹窗 */}
      <Modal
        visible={visible}
        transparent
        animationType="none"
        onRequestClose={closePanel}
      >
        <View style={styles.modalOverlay}>
          {/* 点击背景关闭 */}
          <TouchableOpacity
            style={styles.overlayTouchable}
            onPress={closePanel}
            activeOpacity={1}
          />

          {/* 滑出面板 */}
          <Animated.View
            style={[
              styles.panel,
              { transform: [{ translateY: slideAnim }] },
            ]}
          >
            {/* 面板把手 */}
            <View style={styles.handle} />

            {/* 标题栏 */}
            <View style={styles.header}>
              <Text style={styles.title}>设置</Text>
              <TouchableOpacity onPress={closePanel} activeOpacity={0.7}>
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
              {/* 灵敏度滑块 */}
              <CustomSlider
                label="灵敏度"
                value={settings.sensitivity}
                minimumValue={0.05}
                maximumValue={0.5}
                step={0.01}
                onValueChange={handleSensitivityChange}
                description="控制变焦对人脸大小变化的响应速度"
              />

              {/* 平滑度滑块 */}
              <CustomSlider
                label="平滑度"
                value={settings.smoothness}
                minimumValue={0.01}
                maximumValue={0.5}
                step={0.01}
                onValueChange={handleSmoothnessChange}
                description="控制变焦过渡的平滑程度，值越大越平滑"
              />

              {/* 说明文字 */}
              <View style={styles.infoSection}>
                <Text style={styles.infoTitle}>使用提示</Text>
                <Text style={styles.infoText}>
                  • 走近被摄人物时，APP会自动调整zoom保持人脸大小不变{'\n'}
                  • 背景将产生经典的希区柯克拉伸效果{'\n'}
                  • 灵敏度越高响应越快，但可能产生抖动{'\n'}
                  • 平滑度越高画面越稳定，但响应略有延迟
                </Text>
              </View>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
};

/** 主样式 */
const styles = StyleSheet.create({
  settingsButton: {
    position: 'absolute',
    right: 10,
    bottom: 60,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsIcon: {
    fontSize: 22,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  overlayTouchable: {
    ...StyleSheet.absoluteFillObject,
  },
  panel: {
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: SCREEN_HEIGHT * 0.6,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#555',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  closeButton: {
    color: '#aaa',
    fontSize: 20,
    fontWeight: '600',
    padding: 4,
  },
  content: {
    flex: 1,
  },
  infoSection: {
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  infoTitle: {
    color: '#aaa',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  infoText: {
    color: '#777',
    fontSize: 13,
    lineHeight: 20,
  },
});

/** 滑块样式 */
const sliderStyles = StyleSheet.create({
  container: {
    marginBottom: 24,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  value: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  description: {
    color: '#777',
    fontSize: 12,
    marginBottom: 10,
  },
  track: {
    height: 6,
    backgroundColor: '#333',
    borderRadius: 3,
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#007AFF',
    borderRadius: 3,
  },
  thumb: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
});
