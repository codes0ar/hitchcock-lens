/**
 * SettingsPanel.tsx — PID 增益调节面板
 *
 * 注意：
 * 1. 不使用 RN Modal（华为设备上 SurfaceView 图层会盖住 Dialog），
 *    面板在主视图层级渲染，保证显示在视频之上。
 * 2. slider 使用与右侧 zoom slider 相同的 onTouchStart/onTouchMove + locationX
 *    方案（已在真机验证可用），不再依赖原生 Slider 组件。
 * 3. 每个参数带 −/＋ 微调按钮兜底。
 * 4. 面板打开时隐藏 ⚙️ 按钮，避免遮挡面板内容。
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Dimensions,
} from 'react-native';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface PidSliderProps {
  label: string;
  value: number;
  minimumValue: number;
  maximumValue: number;
  step: number;
  digits: number;
  onValueChange: (value: number) => void;
  description?: string;
}

const PidSlider: React.FC<PidSliderProps> = ({
  label,
  value,
  minimumValue,
  maximumValue,
  step,
  digits,
  onValueChange,
  description,
}) => {
  const progress = (value - minimumValue) / (maximumValue - minimumValue);
  const trackWidthRef = useRef(0);

  // 与主界面 zoom slider 相同的触摸方案：locationX 相对轨道，无需 measureInWindow
  const handleTouch = useCallback(
    (evt: { nativeEvent: { locationX: number } }) => {
      if (trackWidthRef.current <= 0) return;
      const ratio = Math.max(0, Math.min(1, evt.nativeEvent.locationX / trackWidthRef.current));
      const newValue = minimumValue + ratio * (maximumValue - minimumValue);
      const stepped = Math.round(newValue / step) * step;
      const clamped = Math.max(minimumValue, Math.min(maximumValue, stepped));
      onValueChange(parseFloat(clamped.toFixed(digits)));
    },
    [minimumValue, maximumValue, step, digits, onValueChange]
  );

  const clampStep = useCallback(
    (dir: 1 | -1) => {
      const next = Math.max(minimumValue, Math.min(maximumValue, value + dir * step));
      onValueChange(parseFloat(next.toFixed(digits)));
    },
    [value, minimumValue, maximumValue, step, digits, onValueChange]
  );

  return (
    <View style={sliderStyles.container}>
      <View style={sliderStyles.labelRow}>
        <Text style={sliderStyles.label}>{label}</Text>
        <View style={sliderStyles.valueRow}>
          <TouchableOpacity style={sliderStyles.stepButton} onPress={() => clampStep(-1)}>
            <Text style={sliderStyles.stepButtonText}>−</Text>
          </TouchableOpacity>
          <Text style={sliderStyles.value}>{value.toFixed(digits)}</Text>
          <TouchableOpacity style={sliderStyles.stepButton} onPress={() => clampStep(1)}>
            <Text style={sliderStyles.stepButtonText}>＋</Text>
          </TouchableOpacity>
        </View>
      </View>
      {description && (
        <Text style={sliderStyles.description}>{description}</Text>
      )}
      <View
        style={sliderStyles.track}
        onLayout={(e) => { trackWidthRef.current = e.nativeEvent.layout.width; }}
        onTouchStart={handleTouch}
        onTouchMove={handleTouch}
      >
        <View pointerEvents="none" style={[sliderStyles.fill, { width: `${progress * 100}%` }]} />
        <View pointerEvents="none" style={[sliderStyles.thumb, { left: `${progress * 100}%`, marginLeft: -8 }]} />
      </View>
    </View>
  );
};

interface SettingsPanelProps {
  pidKp: number;
  pidKi: number;
  pidKd: number;
  onUpdatePidKp: (v: number) => void;
  onUpdatePidKi: (v: number) => void;
  onUpdatePidKd: (v: number) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  pidKp,
  pidKi,
  pidKd,
  onUpdatePidKp,
  onUpdatePidKi,
  onUpdatePidKd,
}) => {
  const [visible, setVisible] = useState(false);

  const openPanel = useCallback(() => {
    console.log('[SettingsPanel] openPanel');
    setVisible(true);
  }, []);

  const closePanel = useCallback(() => {
    console.log('[SettingsPanel] closePanel');
    setVisible(false);
  }, []);

  return (
    <>
      {!visible && (
        <TouchableOpacity style={styles.settingsButton} onPress={openPanel} activeOpacity={0.7}>
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
      )}

      {visible && (
        <>
          {/* 遮罩：负边距抵消 bottomControls 的 paddingHorizontal，覆盖全屏 */}
          <TouchableOpacity style={styles.backdrop} onPress={closePanel} activeOpacity={1} />
          <View style={styles.panel}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>PID 增益调节</Text>
              <TouchableOpacity onPress={closePanel} activeOpacity={0.7} style={styles.closeHit}>
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* 内容较短，不用 ScrollView，避免拦截 slider 触摸 */}
            <View style={styles.content}>
              <PidSlider
                label="Kp (比例)"
                value={pidKp}
                minimumValue={0.1}
                maximumValue={1.0}
                step={0.01}
                digits={2}
                onValueChange={onUpdatePidKp}
                description="越大响应越快, 太大震荡"
              />

              <PidSlider
                label="Ki (积分)"
                value={pidKi}
                minimumValue={0.0}
                maximumValue={0.1}
                step={0.001}
                digits={3}
                onValueChange={onUpdatePidKi}
                description="消除稳态误差, 过大过冲"
              />

              <PidSlider
                label="Kd (微分)"
                value={pidKd}
                minimumValue={0.0}
                maximumValue={0.1}
                step={0.001}
                digits={3}
                onValueChange={onUpdatePidKd}
                description="抑制震荡, 噪声敏感"
              />

              <View style={styles.infoSection}>
                <Text style={styles.infoTitle}>默认值</Text>
                <Text style={styles.infoText}>Kp=0.50  Ki=0.02  Kd=0.00</Text>
                <Text style={styles.infoHint}>slider 或 −/＋ 按钮即时生效</Text>
              </View>

              <TouchableOpacity style={styles.doneButton} onPress={closePanel} activeOpacity={0.8}>
                <Text style={styles.doneButtonText}>完成</Text>
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  settingsButton: { position: 'absolute', right: 10, bottom: 60, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', zIndex: 32 },
  settingsIcon: { fontSize: 22 },
  // 遮罩与面板渲染在主视图层级(bottomControls 内)，left/right 负边距抵消父容器 padding
  backdrop: { position: 'absolute', left: -20, right: -20, bottom: 0, height: SCREEN_HEIGHT, backgroundColor: 'rgba(0,0,0,0.08)', zIndex: 30 },
  // 紧凑卡片：debug 窗大小，居中置于屏幕下方，半透明不挡取景
  panel: { position: 'absolute', bottom: 0, alignSelf: 'center', width: 300, backgroundColor: 'rgba(20,20,24,0.6)', borderRadius: 14, paddingHorizontal: 14, paddingTop: 4, paddingBottom: 12, zIndex: 31 },
  handle: { width: 32, height: 3, borderRadius: 2, backgroundColor: '#555', alignSelf: 'center', marginTop: 6, marginBottom: 6 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  title: { color: '#fff', fontSize: 14, fontWeight: '700' },
  closeHit: { padding: 6, marginRight: -6 },
  closeButton: { color: '#aaa', fontSize: 16, fontWeight: '600' },
  content: {},
  infoSection: { marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#333' },
  infoTitle: { color: '#aaa', fontSize: 11, fontWeight: '600', marginBottom: 2 },
  infoText: { color: '#777', fontSize: 11, lineHeight: 15 },
  infoHint: { color: '#555', fontSize: 10, marginTop: 3 },
  doneButton: { marginTop: 8, backgroundColor: '#007AFF', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  doneButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});

const sliderStyles = StyleSheet.create({
  container: { marginBottom: 10 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  label: { color: '#fff', fontSize: 13, fontWeight: '600' },
  valueRow: { flexDirection: 'row', alignItems: 'center' },
  value: { color: '#007AFF', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'], minWidth: 44, textAlign: 'center' },
  stepButton: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#333', justifyContent: 'center', alignItems: 'center', marginHorizontal: 4 },
  stepButtonText: { color: '#fff', fontSize: 15, fontWeight: '700', lineHeight: 17 },
  description: { color: '#999', fontSize: 10, marginBottom: 4 },
  // 窄轨道（不铺满全宽，居中约 60% 宽）+ 小滑块，不占太多取景画面
  track: { height: 24, width: '60%', alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 12, justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#007AFF', borderRadius: 12 },
  thumb: { position: 'absolute', width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 4 },
});
