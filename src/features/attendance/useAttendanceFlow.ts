import { useEffect, useMemo, useRef, useState } from 'react';
import { CameraView } from 'expo-camera';
import { cameraService } from '../../services/camera/CameraService';
import { deviceInfoService } from '../../services/upload/DeviceInfoService';
import { geolocationService } from '../../services/geolocation/GeolocationService';
import { livenessService } from '../../services/liveness/LivenessService';
import { uploadService } from '../../services/upload/UploadService';
import { apiClient, LocationSnapshot } from '../../services/api/ApiClient';
import { Challenge, Coordinates, EvidenceCapture, GeofenceResult } from '../../types/attendance';

type FlowStep = 'idle' | 'gps' | 'camera' | 'upload' | 'done';
const EVIDENCE_TTL_MS = 2 * 60 * 1000;

export function useAttendanceFlow(token: string) {
  const [step, setStep] = useState<FlowStep>('idle');
  const [challenge, setChallenge] = useState<Challenge>(() => livenessService.getRandomChallenge());
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [geofence, setGeofence] = useState<GeofenceResult | null>(null);
  const [locationSnapshot, setLocationSnapshot] = useState<LocationSnapshot | null>(null);
  const [evidence, setEvidence] = useState<EvidenceCapture | null>(null);
  const [message, setMessage] = useState('Ready to take your selfie.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selfieCapturedAt, setSelfieCapturedAt] = useState<number | null>(null);
  const [locationCapturedAt, setLocationCapturedAt] = useState<number | null>(null);
  const flowRunRef = useRef(0);

  const canSubmit = useMemo(() => Boolean(token && coordinates && evidence), [coordinates, evidence, token]);

  useEffect(() => {
    if (!selfieCapturedAt || step === 'idle' || step === 'camera' || step === 'done') {
      return;
    }

    const remainingMs = selfieCapturedAt + EVIDENCE_TTL_MS - Date.now();
    if (remainingMs <= 0) {
      resetExpiredFlow('Selfie expired. Please start again.');
      return;
    }

    const timeout = setTimeout(() => {
      resetExpiredFlow('Selfie expired. Please start again.');
    }, remainingMs);

    return () => clearTimeout(timeout);
  }, [selfieCapturedAt, step]);

  useEffect(() => {
    if (!locationCapturedAt || step !== 'upload') {
      return;
    }

    const remainingMs = locationCapturedAt + EVIDENCE_TTL_MS - Date.now();
    if (remainingMs <= 0) {
      resetExpiredFlow('Location expired. Please start again.');
      return;
    }

    const timeout = setTimeout(() => {
      resetExpiredFlow('Location expired. Please start again.');
    }, remainingMs);

    return () => clearTimeout(timeout);
  }, [locationCapturedAt, step]);

  async function checkLocation() {
    if (selfieCapturedAt && hasExpired(selfieCapturedAt)) {
      resetExpiredFlow('Selfie expired. Please start again.');
      return;
    }

    const flowRun = flowRunRef.current;
    setBusy(true);
    setError(null);

    try {
      const currentCoordinates = await geolocationService.getCurrentCoordinates();
      const result = geolocationService.validateGeofence(currentCoordinates);
      const snapshot = token
        ? await apiClient.resolveLocation(token, currentCoordinates)
        : null;
      if (flowRun !== flowRunRef.current) {
        return;
      }

      setCoordinates(currentCoordinates);
      setGeofence(result);
      setLocationSnapshot(snapshot);
      setLocationCapturedAt(Date.now());

      setMessage('Location captured. Review the map before submitting.');
      setStep('upload');
    } catch (caught) {
      if (flowRun !== flowRunRef.current) {
        return;
      }

      setError(caught instanceof Error ? caught.message : 'Location check failed.');
    } finally {
      if (flowRun === flowRunRef.current) {
        setBusy(false);
      }
    }
  }

  async function recordEvidence(camera: CameraView | null) {
    if (!camera) {
      setError('Camera is not ready yet.');
      return;
    }

    const flowRun = flowRunRef.current;
    setBusy(true);
    setError(null);
    setMessage('Capturing selfie evidence.');

    try {
      const capture = await cameraService.captureSelfiePhoto(camera);
      if (flowRun !== flowRunRef.current) {
        return;
      }

      setEvidence(capture);
      setSelfieCapturedAt(Date.now());
      setLocationCapturedAt(null);
      setStep('gps');
      setMessage('Selfie captured. Continue to location.');
    } catch (caught) {
      if (flowRun !== flowRunRef.current) {
        return;
      }

      setError(caught instanceof Error ? caught.message : 'Selfie capture failed.');
    } finally {
      if (flowRun === flowRunRef.current) {
        setBusy(false);
      }
    }
  }

  function acceptCapturedEvidence(capture: EvidenceCapture) {
    setError(null);
    setEvidence(capture);
    setSelfieCapturedAt(Date.now());
    setLocationCapturedAt(null);
    setStep('gps');
    setMessage('Selfie captured. Continue to location.');
  }

  async function submit() {
    if (!coordinates || !evidence) {
      setError('Location and recording are required before upload.');
      return;
    }

    if ((selfieCapturedAt && hasExpired(selfieCapturedAt)) || (locationCapturedAt && hasExpired(locationCapturedAt))) {
      resetExpiredFlow('Attendance evidence expired. Please start again.');
      return;
    }

    const flowRun = flowRunRef.current;
    setBusy(true);
    setError(null);

    try {
      const response = await uploadService.uploadTimeIn(token, {
        coordinates,
        evidence,
        locationAddress: locationSnapshot?.address,
        capturedAt: new Date().toISOString(),
        challengeType: challenge.type,
        deviceInfo: deviceInfoService.getDeviceInfo(),
      });
      if (flowRun !== flowRunRef.current) {
        return;
      }

      setStep('done');
      setMessage(`${response.message} Log #${response.data.id}`);
    } catch (caught) {
      if (flowRun !== flowRunRef.current) {
        return;
      }

      setError(caught instanceof Error ? caught.message : 'Upload failed.');
    } finally {
      if (flowRun === flowRunRef.current) {
        setBusy(false);
      }
    }
  }

  function reset() {
    flowRunRef.current += 1;
    setStep('idle');
    setChallenge(livenessService.getRandomChallenge());
    setCoordinates(null);
    setGeofence(null);
    setLocationSnapshot(null);
    setEvidence(null);
    setSelfieCapturedAt(null);
    setLocationCapturedAt(null);
    setMessage('Ready to take your selfie.');
    setError(null);
    setBusy(false);
  }

  function resetExpiredFlow(expiredMessage: string) {
    flowRunRef.current += 1;
    setStep('idle');
    setChallenge(livenessService.getRandomChallenge());
    setCoordinates(null);
    setGeofence(null);
    setLocationSnapshot(null);
    setEvidence(null);
    setSelfieCapturedAt(null);
    setLocationCapturedAt(null);
    setMessage('Ready to take your selfie.');
    setError(expiredMessage);
    setBusy(false);
  }

  function startTimeIn() {
    flowRunRef.current += 1;
    setStep('camera');
    setChallenge(livenessService.getRandomChallenge());
    setCoordinates(null);
    setGeofence(null);
    setLocationSnapshot(null);
    setEvidence(null);
    setSelfieCapturedAt(null);
    setLocationCapturedAt(null);
    setMessage('Ready to take your selfie.');
    setError(null);
  }

  function hasExpired(capturedAt: number) {
    return Date.now() - capturedAt >= EVIDENCE_TTL_MS;
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
    startTimeIn,
    step,
    submit,
  };
}
