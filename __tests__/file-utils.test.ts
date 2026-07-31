import {
  formatBinaryMegabytes,
  hasEnoughFreeSpace,
  isFileUriWithinDirectory,
  isPositiveByteCount,
  isWithinVideoSizeLimit,
  requiredFreeSpaceForImport,
  safePickedVideoExtension,
} from '@/utils/file';
import { MAX_VIDEO_BYTES, MIN_FREE_SPACE_AFTER_PICK_BYTES } from '@/constants/app';

describe('import file utilities', () => {
  test('accepts only finite positive integer byte counts', () => {
    expect(isPositiveByteCount(1)).toBe(true);
    expect(isPositiveByteCount(1.5)).toBe(false);
    expect(isPositiveByteCount(0)).toBe(false);
    expect(isPositiveByteCount(Number.NaN)).toBe(false);
    expect(isPositiveByteCount(Number.POSITIVE_INFINITY)).toBe(false);
  });

  test('enforces the inclusive 600 MB video limit', () => {
    expect(isWithinVideoSizeLimit(MAX_VIDEO_BYTES)).toBe(true);
    expect(isWithinVideoSizeLimit(MAX_VIDEO_BYTES + 1)).toBe(false);
  });

  test('uses the larger of one GiB and 125 percent of the video size', () => {
    expect(requiredFreeSpaceForImport(100 * 1024 * 1024)).toBe(MIN_FREE_SPACE_AFTER_PICK_BYTES);

    const largeVideo = 1024 * 1024 * 1024;
    expect(requiredFreeSpaceForImport(largeVideo)).toBe(Math.ceil(largeVideo * 1.25));
  });

  test('accepts available space exactly at the conservative threshold', () => {
    const videoBytes = 500 * 1024 * 1024;
    const requiredBytes = requiredFreeSpaceForImport(videoBytes);

    expect(hasEnoughFreeSpace(requiredBytes, videoBytes)).toBe(true);
    expect(hasEnoughFreeSpace(requiredBytes - 1, videoBytes)).toBe(false);
    expect(hasEnoughFreeSpace(Number.NaN, videoBytes)).toBe(false);
  });

  test('guards cache cleanup with a full path-component boundary', () => {
    const cache = 'file:///private/app/Library/Caches/';

    expect(
      isFileUriWithinDirectory('file:///private/app/Library/Caches/ImagePicker/video.mov', cache),
    ).toBe(true);
    expect(
      isFileUriWithinDirectory('file:///private/app/Library/Caches-other/video.mov', cache),
    ).toBe(false);
    expect(isFileUriWithinDirectory('file:///private/app/Library/Documents/video.mov', cache)).toBe(
      false,
    );
    expect(isFileUriWithinDirectory('https://example.com/video.mov', cache)).toBe(false);
  });

  test('derives only a short safe extension for the app-owned picker copy', () => {
    expect(
      safePickedVideoExtension(
        'Studio Run.MOV',
        'file:///private/app/Library/Caches/ImagePicker/random-name',
      ),
    ).toBe('mov');
    expect(
      safePickedVideoExtension(
        'unsafe.extension!',
        'file:///private/app/Library/Caches/ImagePicker/video.MP4',
      ),
    ).toBe('mp4');
    expect(
      safePickedVideoExtension(
        '../unsafe',
        'file:///private/app/Library/Caches/ImagePicker/no-extension',
      ),
    ).toBe('mov');
  });

  test('formats user-facing sizes with binary megabytes', () => {
    expect(formatBinaryMegabytes(642 * 1024 * 1024)).toBe('642 MB');
    expect(formatBinaryMegabytes(1.5 * 1024 * 1024)).toBe('2 MB');
  });
});
