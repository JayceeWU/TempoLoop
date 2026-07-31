import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'TempoLoop',
  slug: 'tempo-loop',
  scheme: 'tempoloop',
  version: '0.1.0',
  orientation: 'portrait',
  platforms: ['ios'],
  userInterfaceStyle: 'automatic',
  icon: './assets/images/tempoloop-icon-v2.png',
  updates: {
    enabled: false,
  },
  ios: {
    bundleIdentifier: 'com.jipeng.tempoloop',
    deploymentTarget: '16.4',
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins: [
    'expo-router',
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
    [
      'expo-image-picker',
      {
        photosPermission:
          'TempoLoop uses the video you select only to extract audio for offline dance practice.',
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
