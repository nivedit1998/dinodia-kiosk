import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
} from 'react-native';
import { palette, radii, spacing } from '../../ui/theme';

type Props = TextInputProps & {
  label?: string;
  secureToggle?: boolean;
};

export function TextField({ label, secureTextEntry, secureToggle, style, ...rest }: Props) {
  const [secure, setSecure] = useState<boolean>(Boolean(secureTextEntry));

  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.inputWrap}>
        <TextInput
          {...rest}
          style={[styles.input, style]}
          placeholderTextColor="#98a2b3"
          secureTextEntry={secureTextEntry ? secure : false}
        />
        {secureToggle ? (
          <TouchableOpacity
            style={styles.toggle}
            onPress={() => setSecure((prev) => !prev)}
            activeOpacity={0.8}
          >
            <Text style={styles.toggleText}>{secure ? 'Show' : 'Hide'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { width: '100%' },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.text,
    marginBottom: 6,
  },
  inputWrap: {
    position: 'relative',
  },
  input: {
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: palette.outline,
    fontSize: 15,
    color: palette.text,
  },
  toggle: {
    position: 'absolute',
    right: spacing.md,
    top: spacing.md,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  toggleText: {
    fontWeight: '700',
    color: palette.primary,
    fontSize: 13,
  },
});
