import Constants from 'expo-constants';
import { Coordinates } from '../types/attendance';
import appManifest from '../../app.json';

const androidConfig = Constants.expoConfig?.android as { versionCode?: number } | undefined;

export const appConfig = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://timelogs.ideaserv.online/api',
  appVersion: Constants.expoConfig?.version ?? appManifest.expo.version,
  appVersionCode: Constants.platform?.android?.versionCode ?? androidConfig?.versionCode ?? appManifest.expo.android?.versionCode ?? 0,
  updateManifestUrl:
    process.env.EXPO_PUBLIC_UPDATE_MANIFEST_URL ?? 'https://timelogs.ideaserv.online/updates/mobile.json',
  geofence: {
    latitude: Number(process.env.EXPO_PUBLIC_GEOFENCE_LATITUDE ?? 14.5995124),
    longitude: Number(process.env.EXPO_PUBLIC_GEOFENCE_LONGITUDE ?? 120.9842195),
    radiusMeters: Number(process.env.EXPO_PUBLIC_GEOFENCE_RADIUS_METERS ?? 150),
  } satisfies Coordinates & { radiusMeters: number },
  capture: {
    nativeFaceLivenessEnabled: process.env.EXPO_PUBLIC_NATIVE_FACE_LIVENESS === 'true',
  },
};
