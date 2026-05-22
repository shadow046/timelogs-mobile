import { apiClient } from '../api/ApiClient';
import { TimeInSubmission } from '../../types/attendance';

type TimeInResponse = {
  message: string;
  data: {
    id: number;
    created_at: string;
  };
  geofence: {
    distance_meters: number;
    radius_meters: number;
  };
};

export interface UploadService {
  uploadTimeIn(token: string, submission: TimeInSubmission): Promise<TimeInResponse>;
}

class LaravelUploadService implements UploadService {
  async uploadTimeIn(token: string, submission: TimeInSubmission): Promise<TimeInResponse> {
    const formData = new FormData();
    formData.append('latitude', String(submission.coordinates.latitude));
    formData.append('longitude', String(submission.coordinates.longitude));
    if (submission.locationAddress) {
      formData.append('location_address', submission.locationAddress);
    }
    formData.append('challenge_type', submission.challengeType);
    formData.append('device_name', submission.deviceInfo.deviceName);
    formData.append('device_os', submission.deviceInfo.deviceOs);
    if (submission.evidence.videoUri) {
      formData.append('video', {
        uri: submission.evidence.videoUri,
        name: `time-in-${Date.now()}.mp4`,
        type: 'video/mp4',
      } as unknown as Blob);
    }

    if (submission.evidence.imageUri) {
      formData.append('image', {
        uri: submission.evidence.imageUri,
        name: `time-in-${Date.now()}.jpg`,
        type: 'image/jpeg',
      } as unknown as Blob);
    }

    return apiClient.postForm<TimeInResponse>('/time-in', token, formData);
  }
}

export const uploadService: UploadService = new LaravelUploadService();
