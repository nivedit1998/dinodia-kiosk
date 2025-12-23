export const palette = {
  background: '#e9edf4',
  surface: '#ffffff',
  surfaceMuted: '#f5f7fb',
  outline: '#e3e7ee',
  text: '#0f172a',
  textMuted: '#6b7280',
  primary: '#0a84ff',
  primaryDark: '#0060df',
  success: '#34c759',
  danger: '#ff3b30',
  cloud: '#7c3aed',
  home: '#0ea5e9',
};

export const radii = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
};

export const spacing = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32,
};

export const typography = {
  heading: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: palette.text,
  },
  title: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: palette.text,
  },
  body: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: palette.text,
  },
  small: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: palette.textMuted,
  },
};

export const shadows = {
  soft: {
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  medium: {
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
};

// Cap the primary content width to keep 4-column grids inside an 8" landscape view.
export const maxContentWidth = 820;
