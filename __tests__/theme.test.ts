import { colors } from '@/constants/theme';

describe('TempoLoop deep-purple theme', () => {
  test('uses the locked purple palette with no legacy green tokens', () => {
    expect(colors).toEqual(
      expect.objectContaining({
        background: '#120A24',
        surface: '#1D1033',
        surfacePressed: '#2A1746',
        accent: '#A970FF',
        accentPressed: '#8750D6',
        text: '#FAF7FF',
        textMuted: '#B9A9CC',
        border: '#432B5E',
        danger: '#FF6B8A',
      }),
    );

    expect(Object.values(colors)).not.toContain('#2F6554');
    expect(Object.values(colors)).not.toContain('#264F43');
  });
});
