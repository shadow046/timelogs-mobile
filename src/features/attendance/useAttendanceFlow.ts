import { useMemo, useState } from 'react';
import { CameraView } from 'expo-camera';
import { cameraService } from '../../services/camera/CameraService';
import { deviceInfoService } from '../../services/upload/DeviceInfoService';
import { geolocationService } from '../../services/geolocation/GeolocationService';
import { livenessService } from '../../services/liveness/LivenessService';
import { uploadService } from '../../services/upload/UploadService';
import { apiClient, LocationSnapshot } from '../../services/api/ApiClient';
import { Challenge, Coordinates, EvidenceCapture, GeofenceResult } from '../../types/attendance';

type FlowStep = 'gps' | 'camera' | 'upload' | 'done';

export function useAttendanceFlow(token: string) {
  const [step, setStep] = useState<FlowStep>('camera');
  const [challenge, setChallenge] = useState<Challenge>(() => livenessService.getRandomChallenge());
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [geofence, setGeofence] = useState<GeofenceResult | null>(null);
  const [locationSnapshot, setLocationSnapshot] = useState<LocationSnapshot | null>(null);
  const [evidence, setEvidence] = useState<EvidenceCapture | null>(null);
  const [message, setMessage] = useState('Ready to take your selfie.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => Boolean(token && coordinates && evidence), [coordinates, evidence, token]);

  async function checkLocation() {
    setBusy(true);
    setError(null);

    try {
      const currentCoordinates = await geolocationService.getCurrentCoordinates();
      const result = geolocationService.validateGeofence(currentCoordinates);
      const snapshot = token
        ? await apiClient.resolveLocation(token, currentCoordinates)
        : null;
      const readableAddress = snapshot && !isCoordinateAddress(snapshot.address)
        ? snapshot.address
        : await geolocationService.getReadableAddress(currentCoordinates);
      setCoordinates(currentCoordinates);
      setGeofence(result);
      setLocationSnapshot(snapshot
        ? {
            ...snapshot,
            address: readableAddress ?? snapshot.address,
          }
        : null);

      setMessage('Location captured. Submit attendance evidence.');
      setStep('upload');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Location check failed.');
    } finally {
      setBusy(false);
    }
  }

  async function recordEvidence(camera: CameraView | null) {
    if (!camera) {
      setError('Camera is not ready yet.');
      return;
    }

    setBusy(true);
    setError(null);
    setMessage('Capturing selfie evidence.');

    try {
      const capture = await cameraService.captureSelfiePhoto(camera);
      setEvidence(capture);
      setStep('gps');
      setMessage('Selfie captured. Continue to location.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Selfie capture failed.');
    } finally {
      setBusy(false);
    }
  }

  function acceptCapturedEvidence(capture: EvidenceCapture) {
    setError(null);
    setEvidence(capture);
    setStep('gps');
    setMessage('Selfie captured. Continue to location.');
  }

  async function submit() {
    if (!coordinates || !evidence) {
      setError('Location and recording are required before upload.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await uploadService.uploadTimeIn(token, {
        coordinates,
        evidence,
        locationAddress: locationSnapshot?.address,
        challengeType: challenge.type,
        deviceInfo: deviceInfoService.getDeviceInfo(),
      });
      setStep('done');
      setMessage(`${response.message} Log #${response.data.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep('camera');
    setChallenge(livenessService.getRandomChallenge());
    setCoordinates(null);
    setGeofence(null);
    setLocationSnapshot(null);
    setEvidence(null);
    setMessage('Ready to take your selfie.');
    setError(null);
  }

  function setErrorMessage(message: string) {
    setError(message);
  }

  return {
    busy,
    canSubmit,
    challenge,
    checkLocation,
    coordinates,
    error,
    evidence,
    geofence,
    locationSnapshot,
    message,
    acceptCapturedEvidence,
    recordEvidence,
    reset,
    setErrorMessage,
    step,
    submit,
  };
}

function isCoordinateAddress(address: string) {
  return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(address.trim());
}
