import { appConfig } from '../../config/appConfig';
import { Coordinates } from '../../types/attendance';

export type AppUpdateResponse = {
  platform: string;
  update_available: boolean;
  mandatory: boolean;
  latest_version: string;
  latest_version_code: number;
  current_version: string | null;
  current_version_code: number | null;
  apk_url: string;
  details: string[];
  published_at: string | null;
};

export type LoginResponse = {
  token: string;
  user: {
    id: number;
    name: string;
    email: string;
  };
};

export type AttendanceLog = {
  id: number;
  location_address: string | null;
  accuracy: number | null;
  challenge_type: string;
  device_name: string | null;
  device_os: string | null;
  latitude: number;
  longitude: number;
  created_at: string | null;
};

export type LocationSnapshot = {
  lat: number;
  lng: number;
  accuracy: number | null;
  address: string;
  map_image_data_uri: string | null;
  map_url: string | null;
  raw?: unknown;
};

export class ApiClient {
  constructor(private readonly baseUrl: string = appConfig.apiBaseUrl) {}

  async login(login: string, password: string, deviceName: string): Promise<LoginResponse> {
    const response = await fetch(`${this.baseUrl}/auth/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ login, password, device_name: deviceName }),
    });

    return parseJsonResponse<LoginResponse>(response);
  }

  async checkAppUpdate(currentVersion: string, currentVersionCode: number): Promise<AppUpdateResponse> {
    const params = new URLSearchParams({
      platform: 'android',
      current_version: currentVersion,
      current_version_code: String(currentVersionCode),
    });
    const response = await fetch(`${this.baseUrl}/app-update?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
      },
    });

    return parseJsonResponse<AppUpdateResponse>(response);
  }

  async postForm<T>(path: string, token: string, formData: FormData): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    return parseJsonResponse<T>(response);
  }

  async getAttendanceLogs(token: string): Promise<{ data: AttendanceLog[] }> {
    const response = await fetch(`${this.baseUrl}/attendance-logs`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    return parseJsonResponse<{ data: AttendanceLog[] }>(response);
  }

  async resolveLocation(
    token: string,
    coordinates: Coordinates,
  ): Promise<LocationSnapshot> {
    const params = new URLSearchParams({
      latitude: String(coordinates.latitude),
      longitude: String(coordinates.longitude),
    });
    if (coordinates.accuracyMeters !== undefined && coordinates.accuracyMeters !== null) {
      params.set('accuracy', String(coordinates.accuracyMeters));
    }
    const response = await fetch(`${this.baseUrl}/location/resolve?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    return parseJsonResponse<LocationSnapshot>(response);
  }
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload?.message ??
      Object.values(payload?.errors ?? {})
        .flat()
        .join(' ') ??
      'Request failed.';

    throw new Error(message);
  }

  return payload as T;
}

export const apiClient = new ApiClient();
