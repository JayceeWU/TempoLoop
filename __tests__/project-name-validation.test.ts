import { ProjectNameSchema, normalizeProjectName } from '@/domain/validation';

describe('project name validation', () => {
  it('trims surrounding whitespace', () => {
    expect(ProjectNameSchema.parse('  Floorwork  ')).toBe('Floorwork');
  });

  it('replaces control characters before validation', () => {
    expect(normalizeProjectName('Warmup\u0000Take 1')).toBe('Warmup Take 1');
  });

  it('rejects an empty normalized name', () => {
    expect(ProjectNameSchema.safeParse(' \n\t ').success).toBe(false);
  });

  it('accepts 80 Unicode characters and rejects 81', () => {
    expect(ProjectNameSchema.safeParse('舞'.repeat(80)).success).toBe(true);
    expect(ProjectNameSchema.safeParse('舞'.repeat(81)).success).toBe(false);
  });

  it('does not reject duplicate names at the domain boundary', () => {
    expect(ProjectNameSchema.parse('Practice')).toBe('Practice');
    expect(ProjectNameSchema.parse('Practice')).toBe('Practice');
  });
});
