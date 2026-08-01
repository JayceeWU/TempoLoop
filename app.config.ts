import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'TempoLoop',
  owner: 'jwu453',
  slug: 'tempoloop',
  scheme: 'tempoloop',
  version: '1.0.0',
  orientation: 'portrait',
  platforms: ['android'],
  userInterfaceStyle: 'automatic',
  icon: './assets/images/tempoloop-icon-v2.png',
  updates: {
    enabled: false,
  },
  extra: {
    eas: {
      projectId: 'b2ba5951-4f59-4fdf-83a4-ad1798b8e452',
    },
  },
  android: {
    package: 'com.tempoloop.app',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: '#120A24',
    },
    blockedPermissions: [
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
    ],
  },
  plugins: [
    'expo-router',
    'expo-asset',
    [
      'expo-splash-screen',
      {
        image: './assets/images/tempoloop-icon-v2.png',
        imageWidth: 160,
        resizeMode: 'contain',
        backgroundColor: '#F7F6F2',
        dark: {
          backgroundColor: '#F7F6F2',
        },
      },
    ],
    'expo-document-picker',
    [
      'expo-audio',
      {
        recordAudioAndroid: false,
        enableBackgroundPlayback: false,
        enableBackgroundRecording: false,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
