import { formatBinaryMegabytes } from '@/utils/file';

describe('file metadata utilities', () => {
  test('formats a finite byte count without accessing media content', () => {
    expect(formatBinaryMegabytes(600 * 1024 * 1024)).toBe('600 MB');
  });

  test('rejects invalid byte counts', () => {
    expect(() => formatBinaryMegabytes(-1)).toThrow(RangeError);
    expect(() => formatBinaryMegabytes(Number.NaN)).toThrow(RangeError);
  });
});
