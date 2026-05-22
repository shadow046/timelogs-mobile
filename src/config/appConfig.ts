import { Coordinates } from '../types/attendance';

export const appConfig = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://timelogs.ideaserv.online/api',
  geofence: {
    latitude: Number(process.env.EXPO_PUBLIC_GEOFENCE_LATITUDE ?? 14.5995124),
    longitude: Number(process.env.EXPO_PUBLIC_GEOFENCE_LONGITUDE ?? 120.9842195),
    radiusMeters: Number(process.env.EXPO_PUBLIC_GEOFENCE_RADIUS_METERS ?? 150),
  } satisfies Coordinates & { radiusMeters: number },
  capture: {
    nativeFaceLivenessEnabled: process.env.EXPO_PUBLIC_NATIVE_FACE_LIVENESS === 'true',
  },
};
