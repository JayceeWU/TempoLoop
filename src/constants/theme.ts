export const colors = {
  background: '#F7F6F2',
  surface: '#FFFFFF',
  surfacePressed: '#F0EEE8',
  text: '#1B1D1C',
  textMuted: '#686C69',
  textOnAccent: '#FFFFFF',
  accent: '#2F6554',
  accentPressed: '#264F43',
  border: '#DEDCD5',
  disabledBackground: '#E7E5DF',
  disabledText: '#979A97',
  danger: '#B33A3A',
  dangerPressed: '#922F2F',
  focus: '#2F6554',
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
} as const;

export const radii = {
  sm: 10,
  md: 16,
  lg: 22,
  pill: 999,
} as const;

export const fontSizes = {
  caption: 13,
  body: 16,
  button: 17,
  title: 22,
  display: 34,
} as const;

export const fontWeights = {
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const minimumTapSize = 44;

export const shadows = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
  },
} as const;
