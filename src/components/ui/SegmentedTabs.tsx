import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { palette, radii, shadows, spacing } from '../../ui/theme';

type Tab = {
  key: string;
  label: string;
};

type Props = {
  tabs: Tab[];
  activeKey: string;
  onChange: (key: string) => void;
};

export function SegmentedTabs({ tabs, activeKey, onChange }: Props) {
  const activeIndex = useMemo(() => Math.max(0, tabs.findIndex((t) => t.key === activeKey)), [tabs, activeKey]);
  const [width, setWidth] = useState(0);
  const highlight = useRef(new Animated.Value(activeIndex)).current;

  useEffect(() => {
    Animated.spring(highlight, {
      toValue: activeIndex,
      useNativeDriver: true,
      tension: 150,
      friction: 18,
    }).start();
  }, [activeIndex, highlight]);

  const widthPercent = 1 / Math.max(1, tabs.length);
  const translateX = highlight.interpolate({
    inputRange: [0, tabs.length - 1],
    outputRange: [0, (tabs.length - 1) * widthPercent * (width || 1)],
  });

  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  };

  return (
    <View style={styles.container} onLayout={onLayout}>
      <Animated.View
        style={[
          styles.highlight,
          {
            width: widthPercent * width || 0,
            transform: [{ translateX }],
          },
        ]}
      />
      {tabs.map((tab, idx) => {
        const selected = tab.key === activeKey;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tab}
            onPress={() => onChange(tab.key)}
            activeOpacity={0.85}
          >
            <Text style={[styles.label, selected && styles.labelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#eef1f6',
    borderRadius: radii.pill,
    paddingVertical: 2,
    paddingHorizontal: 3,
    position: 'relative',
    overflow: 'hidden',
    ...shadows.soft,
    minWidth: 200,
  },
  highlight: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 3,
    borderRadius: radii.pill,
    backgroundColor: palette.surface,
    ...shadows.soft,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  label: {
    fontWeight: '700',
    color: palette.textMuted,
    fontSize: 13,
  },
  labelActive: {
    color: palette.text,
  },
});
