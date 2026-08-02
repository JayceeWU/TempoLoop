export const colors = {
  background: '#120A24',
  surface: '#1D1033',
  surfacePressed: '#2A1746',
  text: '#FAF7FF',
  textMuted: '#B9A9CC',
  textOnAccent: '#FFFFFF',
  accent: '#A970FF',
  accentPressed: '#8750D6',
  accentSoft: '#2A1746',
  accentTranslucent: 'rgba(169, 112, 255, 0.24)',
  border: '#432B5E',
  disabledBackground: '#2B2234',
  disabledText: '#80758B',
  danger: '#FF6B8A',
  dangerPressed: '#D94D6D',
  focus: '#C4A1FF',
  waveform: '#B9A9CC',
  waveformOverview: '#756486',
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

export const minimumTapSize = 48;

export const shadows = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
  },
} as const;
