export type ChallengeType =
  | 'blink_once'
  | 'blink_twice'
  | 'turn_head_left'
  | 'turn_head_right'
  | 'smile'
  | 'move_up_down';

export type Challenge = {
  type: ChallengeType;
  label: string;
  instruction: string;
};

export type Coordinates = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
};

export type GeofenceResult = {
  allowed: boolean;
  distanceMeters: number;
  radiusMeters: number;
  center: {
    latitude: number;
    longitude: number;
  };
};

export type DeviceInfo = {
  deviceName: string;
  deviceOs: string;
};

export type EvidenceCapture = {
  videoUri?: string;
  imageUri?: string;
  durationSeconds: number;
  videoSizeBytes?: number;
  imageSizeBytes?: number;
};

export type TimeInSubmission = {
  evidence: EvidenceCapture;
  coordinates: Coordinates;
  locationAddress?: string | null;
  challengeType: ChallengeType;
  deviceInfo: DeviceInfo;
};
