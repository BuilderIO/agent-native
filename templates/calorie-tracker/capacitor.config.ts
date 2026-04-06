import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nutritrack.app',
  appName: 'NutriTrack',
  webDir: 'dist/spa',
  server: {
    // For development, you can uncomment this to load from your dev server
    // url: 'http://localhost:5173',
    // cleartext: true
  },
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    scheme: 'NutriTrack'
  },
  plugins: {}
};

export default config;
