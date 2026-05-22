import { CameraView } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import { EvidenceCapture } from '../../types/attendance';

export interface CameraService {
  captureSelfiePhoto(camera: CameraView): Promise<EvidenceCapture>;
}

class ExpoCameraService implements CameraService {
  async captureSelfiePhoto(camera: CameraView): Promise<EvidenceCapture> {
    const photo = await camera.takePictureAsync({
      imageType: 'jpg',
      quality: 0.82,
      skipProcessing: false,
    });

    if (!photo?.uri) {
      throw new Error('Camera did not return a selfie photo.');
    }

    const imageInfo = await FileSystem.getInfoAsync(photo.uri);

    return {
      imageUri: photo.uri,
      durationSeconds: 1,
      imageSizeBytes: imageInfo.exists ? imageInfo.size : undefined,
    };
  }
}

export const cameraService: CameraService = new ExpoCameraService();
