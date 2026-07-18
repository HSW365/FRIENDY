import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hsw365.friendy',
  appName: 'Friendy',
  webDir: 'www',
  ios: {
    contentInset: 'always',
    backgroundColor: '#080809',
    scheme: 'Friendy',
    limitsNavigationsToAppBoundDomains: false,
    allowsLinkPreview: false
  },
  server: {
    androidScheme: 'https'
  }
};

export default config;
