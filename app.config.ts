import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'TempoLoop',
  owner: 'jaycee.ucsc',
  slug: 'tempoloop',
  scheme: 'tempoloop',
  version: '1.0.0',
  orientation: 'portrait',
  platforms: ['android'],
  userInterfaceStyle: 'dark',
  icon: './assets/images/tempoloop-icon-purple.png',
  updates: {
    enabled: false,
  },
  extra: {
    eas: {
      projectId: 'f15bd21b-a9d8-4625-8fed-bddd75d658d9',
    },
  },
  android: {
    package: 'com.tempoloop.app',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon-purple.png',
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
        image: './assets/images/tempoloop-icon-purple.png',
        imageWidth: 160,
        resizeMode: 'contain',
        backgroundColor: '#120A24',
        dark: {
          backgroundColor: '#120A24',
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
