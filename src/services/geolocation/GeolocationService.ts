import * as Location from 'expo-location';
import { appConfig } from '../../config/appConfig';
import { Coordinates, GeofenceResult } from '../../types/attendance';

export interface GeolocationService {
  getCurrentCoordinates(): Promise<Coordinates>;
  getReadableAddress(coordinates: Coordinates): Promise<string | null>;
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

  async getReadableAddress(coordinates: Coordinates): Promise<string | null> {
    const addresses = await Location.reverseGeocodeAsync({
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
    });
    const address = addresses[0];

    if (!address) {
      return null;
    }

    return formatReadableAddress(address);
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

function formatReadableAddress(address: Location.LocationGeocodedAddress) {
  const streetLine = joinUniqueParts([
    address.name,
    address.street,
  ]);
  const cityLine = joinUniqueParts([
    address.district,
    address.city,
    address.subregion,
    address.region,
  ]);
  const readableAddress = joinUniqueParts([streetLine, cityLine]);

  return readableAddress || null;
}

function joinUniqueParts(parts: Array<string | null | undefined>) {
  const normalizedParts = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  const uniqueParts = normalizedParts.filter((part, index) => {
    const normalizedPart = part.toLowerCase();

    return normalizedParts.findIndex((candidate) => candidate.toLowerCase() === normalizedPart) === index;
  });

  return uniqueParts.join(', ');
}

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
