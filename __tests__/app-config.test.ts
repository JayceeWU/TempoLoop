import { readFileSync } from 'node:fs';

import config from '../app.config';
import easConfig from '../eas.json';

describe('TempoLoop app configuration', () => {
  it('is an offline, Android-only application', () => {
    expect(config.name).toBe('TempoLoop');
    expect(config.owner).toBe('jwu453');
    expect(config.slug).toBe('tempoloop');
    expect(config.scheme).toBe('tempoloop');
    expect(config.version).toBe('1.0.0');
    expect(config.platforms).toEqual(['android']);
    expect(config.orientation).toBe('portrait');
    expect(config.userInterfaceStyle).toBe('dark');
    expect(config.icon).toBe('./assets/images/tempoloop-icon-purple.png');
    expect(config.updates?.enabled).toBe(false);
    expect(config.extra?.eas).toEqual({
      projectId: 'b2ba5951-4f59-4fdf-83a4-ad1798b8e452',
    });
    expect(config.ios).toBeUndefined();
    expect(config.android).toEqual(
      expect.objectContaining({
        package: 'com.tempoloop.app',
        versionCode: 1,
        adaptiveIcon: {
          foregroundImage: './assets/images/adaptive-icon-purple.png',
          backgroundColor: '#120A24',
        },
      }),
    );

    expect(config.android?.blockedPermissions).toEqual(
      expect.arrayContaining([
        'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO',
        'android.permission.MANAGE_EXTERNAL_STORAGE',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.READ_MEDIA_AUDIO',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
        'android.permission.ACCESS_MEDIA_LOCATION',
      ]),
    );

    const splashPlugin = config.plugins?.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
    );
    expect(splashPlugin).toEqual([
      'expo-splash-screen',
      expect.objectContaining({
        image: './assets/images/tempoloop-icon-purple.png',
        backgroundColor: '#120A24',
        dark: { backgroundColor: '#120A24' },
      }),
    ]);

    expect(config.plugins).toContain('expo-asset');
    expect(config.plugins).toContain('expo-document-picker');
    const audioPlugin = config.plugins?.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-audio',
    );
    expect(audioPlugin).toEqual([
      'expo-audio',
      {
        recordAudioAndroid: false,
        enableBackgroundPlayback: false,
        enableBackgroundRecording: false,
      },
    ]);
  });

  it('defines only internal Android APK build profiles', () => {
    expect(easConfig.cli.appVersionSource).toBe('remote');
    expect(Object.keys(easConfig.build)).toEqual(['development', 'preview']);
    expect(easConfig.build.development).toEqual({
      developmentClient: true,
      distribution: 'internal',
      autoIncrement: true,
      android: { buildType: 'apk' },
    });
    expect(easConfig.build.preview).toEqual({
      distribution: 'internal',
      autoIncrement: true,
      android: { buildType: 'apk' },
    });
    expect(easConfig).not.toHaveProperty('submit');
  });

  it('uses a square RGBA adaptive foreground with transparent-pixel support', () => {
    const foreground = readFileSync('assets/images/adaptive-icon-purple.png');

    expect(foreground.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(foreground.readUInt32BE(16)).toBe(foreground.readUInt32BE(20));
    expect(foreground[25]).toBe(6);
  });
});
