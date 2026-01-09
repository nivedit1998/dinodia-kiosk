// src/components/ui/WizardScaffold.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PrimaryButton } from './PrimaryButton';
import { palette, radii, spacing, typography, shadows } from '../../ui/theme';

type Props = {
  title: string;
  subtitle?: string;
  stepLabel?: string;
  children: React.ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  canBack?: boolean;
  canNext?: boolean;
  nextLabel?: string;
  backLabel?: string;
  showBack?: boolean;
  showNext?: boolean;
  bottomContent?: React.ReactNode;
};

export function WizardScaffold({
  title,
  subtitle,
  stepLabel,
  children,
  onBack,
  onNext,
  canBack = true,
  canNext = true,
  nextLabel = 'Next',
  backLabel = 'Back',
  showBack = true,
  showNext = true,
  bottomContent,
}: Props) {
  return (
    <View style={styles.root}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          {stepLabel ? <Text style={styles.stepLabel}>{stepLabel}</Text> : null}
        </View>
        <View style={styles.body}>{children}</View>
      </View>
      <View style={styles.footer}>
        {bottomContent}
        <View style={styles.actions}>
          {showBack ? (
            <PrimaryButton
              title={backLabel}
              variant="ghost"
              onPress={onBack ?? (() => {})}
              disabled={!canBack || !onBack}
              style={styles.button}
            />
          ) : null}
          {showNext ? (
            <PrimaryButton
              title={nextLabel}
              onPress={onNext ?? (() => {})}
              disabled={!canNext || !onNext}
              style={styles.button}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  header: {
    marginBottom: spacing.md,
  },
  title: {
    ...typography.heading,
    marginBottom: spacing.xs,
  },
  subtitle: {
    color: palette.textMuted,
    fontSize: 14,
    marginBottom: spacing.xs,
  },
  stepLabel: {
    color: palette.textMuted,
    fontSize: 12,
  },
  body: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: radii.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: palette.outline,
    ...shadows.soft,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.outline,
    backgroundColor: palette.surfaceMuted,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  button: {
    flex: 1,
  },
});
