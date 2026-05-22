import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { DeviceInfo } from '../../types/attendance';

export interface DeviceInfoService {
  getDeviceInfo(): DeviceInfo;
}

class ExpoDeviceInfoService implements DeviceInfoService {
  getDeviceInfo(): DeviceInfo {
    const model = Device.modelName ?? Device.deviceName ?? 'Unknown device';
    const osVersion = Device.osVersion ? ` ${Device.osVersion}` : '';

    return {
      deviceName: model,
      deviceOs: `${Platform.OS}${osVersion}`,
    };
  }
}

export const deviceInfoService: DeviceInfoService = new ExpoDeviceInfoService();
