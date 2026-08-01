import { ProjectNameSchema, normalizeProjectName } from '@/domain/validation';

describe('project name validation', () => {
  it('trims surrounding whitespace', () => {
    expect(ProjectNameSchema.parse('  Floorwork  ')).toBe('Floorwork');
    expect(normalizeProjectName('  Floorwork  ')).toBe('Floorwork');
  });

  it('rejects control characters instead of silently rewriting the name', () => {
    expect(ProjectNameSchema.safeParse('Warmup\u0000Take 1').success).toBe(false);
    expect(ProjectNameSchema.safeParse('Warmup\nTake 1').success).toBe(false);
  });

  it('rejects path separators', () => {
    expect(ProjectNameSchema.safeParse('Practice/One').success).toBe(false);
    expect(ProjectNameSchema.safeParse('Practice\\One').success).toBe(false);
  });

  it('rejects an empty trimmed name', () => {
    expect(ProjectNameSchema.safeParse('   ').success).toBe(false);
  });

  it('counts Unicode code points and accepts 80 while rejecting 81', () => {
    expect(ProjectNameSchema.safeParse('舞'.repeat(80)).success).toBe(true);
    expect(ProjectNameSchema.safeParse('舞'.repeat(81)).success).toBe(false);
  });

  it('does not reject duplicate names at the domain boundary', () => {
    expect(ProjectNameSchema.parse('Practice')).toBe('Practice');
    expect(ProjectNameSchema.parse('Practice')).toBe('Practice');
  });
});
