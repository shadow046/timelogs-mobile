import * as Location from 'expo-location';
import { appConfig } from '../../config/appConfig';
import { Coordinates, GeofenceResult } from '../../types/attendance';

export interface GeolocationService {
  getCurrentCoordinates(): Promise<Coordinates>;
  validateGeofence(coordinates: Coordinates): GeofenceResult;
}

class ExpoGeolocationService implements GeolocationService {
  async getCurrentCoordinates(): Promise<Coordinates> {
    const permission = await Location.requestForegroundPermissionsAsync();

    if (permission.status !== Location.PermissionStatus.GRANTED) {
      throw new Error('Location permission is required to time in.');
    }

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracyMeters: location.coords.accuracy,
    };
  }

  validateGeofence(coordinates: Coordinates): GeofenceResult {
    const distanceMeters = distanceBetweenMeters(
      coordinates.latitude,
      coordinates.longitude,
      appConfig.geofence.latitude,
      appConfig.geofence.longitude,
    );

    return {
      allowed: distanceMeters <= appConfig.geofence.radiusMeters,
      distanceMeters,
      radiusMeters: appConfig.geofence.radiusMeters,
      center: {
        latitude: appConfig.geofence.latitude,
        longitude: appConfig.geofence.longitude,
      },
    };
  }
}

export const geolocationService: GeolocationService = new ExpoGeolocationService();

function distanceBetweenMeters(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
) {
  const earthRadiusMeters = 6371000;
  const fromLatitudeRadians = toRadians(fromLatitude);
  const toLatitudeRadians = toRadians(toLatitude);
  const deltaLatitude = toRadians(toLatitude - fromLatitude);
  const deltaLongitude = toRadians(toLongitude - fromLongitude);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(fromLatitudeRadians) *
      Math.cos(toLatitudeRadians) *
      Math.sin(deltaLongitude / 2) ** 2;

  return earthRadiusMeters * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}
