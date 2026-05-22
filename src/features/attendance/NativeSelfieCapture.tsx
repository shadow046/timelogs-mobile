import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
} from 'react-native-vision-camera';
import { Face, useFaceDetectorOutput } from 'react-native-vision-camera-face-detector';
import { PrimaryButton } from '../../components/PrimaryButton';
import { EvidenceCapture } from '../../types/attendance';
import { SelfieCaptureProps } from './SelfieCaptureTypes';

type GuideLayout = {
  width: number;
  height: number;
};

type MotionState = {
  baselineY: number | null;
  upSeen: boolean;
  downSeen: boolean;
};

const verticalMoveRatio = 0.045;
const captureCountdownSeconds = 5;

export function NativeSelfieCapture({ active, busy, onCaptured, onError }: SelfieCaptureProps) {
  const device = useCameraDevice('front');
  const cameraPermission = useCameraPermission();
  const photoOutput = usePhotoOutput({
    containerFormat: 'jpeg',
    quality: 0.86,
    qualityPrioritization: 'speed',
  });
  const dimensions = useWindowDimensions();
  const [layout, setLayout] = useState<GuideLayout>({ width: 0, height: 0 });
  const [instruction, setInstruction] = useState('Center your face in the guide.');
  const [countdown, setCountdown] = useState<number | null>(null);
  const [faceCentered, setFaceCentered] = useState(false);
  const motionRef = useRef<MotionState>({ baselineY: null, upSeen: false, downSeen: false });
  const activeRef = useRef(active);
  const captureScheduledRef = useRef(false);
  const captureStartedRef = useRef(false);
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => () => {
    if (captureTimerRef.current) {
      clearTimeout(captureTimerRef.current);
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }
  }, []);

  const captureSelfie = useCallback(async () => {
    if (captureStartedRef.current || busy || !activeRef.current) {
      return;
    }

    captureStartedRef.current = true;

    try {
      const photo = await photoOutput.capturePhotoToFile({ flashMode: 'off' }, {});
      const imageUri = photo.filePath.startsWith('file://') ? photo.filePath : `file://${photo.filePath}`;
      const capture: EvidenceCapture = {
        imageUri,
        durationSeconds: 1,
      };
      onCaptured(capture);
    } catch (caught) {
      captureScheduledRef.current = false;
      captureStartedRef.current = false;
      setCountdown(null);
      onError(caught instanceof Error ? caught.message : 'Failed to capture selfie.');
      setInstruction('Center your face in the guide.');
    }
  }, [busy, onCaptured, onError, photoOutput]);

  const scheduleCaptureSelfie = useCallback(() => {
    if (captureScheduledRef.current || captureStartedRef.current) {
      return;
    }

    captureScheduledRef.current = true;
    setInstruction('Hold still.');
    setCountdown(captureCountdownSeconds);
    countdownIntervalRef.current = setInterval(() => {
      setCountdown((current) => {
        if (current === null || current <= 1) {
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }

          return current === null ? null : 0;
        }

        return current - 1;
      });
    }, 1000);
    captureTimerRef.current = setTimeout(() => {
      void captureSelfie();
    }, captureCountdownSeconds * 1000);
  }, [captureSelfie]);

  const handleFacesDetected = useCallback(
    (faces: Face[]) => {
      if (
        !active ||
        busy ||
        captureScheduledRef.current ||
        captureStartedRef.current ||
        layout.width === 0 ||
        layout.height === 0
      ) {
        return;
      }

      const face = faces[0];
      if (!face) {
        motionRef.current = { baselineY: null, upSeen: false, downSeen: false };
        setFaceCentered(false);
        setInstruction('Center your face in the guide.');
        return;
      }

      const centerX = face.bounds.x + face.bounds.width / 2;
      const centerY = face.bounds.y + face.bounds.height / 2;
      const guideCenterX = layout.width / 2;
      const guideCenterY = layout.height * 0.45;
      const radiusX = layout.width * 0.33;
      const radiusY = layout.height * 0.24;
      const normalizedDistance =
        ((centerX - guideCenterX) * (centerX - guideCenterX)) / (radiusX * radiusX) +
        ((centerY - guideCenterY) * (centerY - guideCenterY)) / (radiusY * radiusY);
      const faceFits = face.bounds.width >= layout.width * 0.18 && face.bounds.width <= layout.width * 0.7;
      const insideGuide = normalizedDistance <= 1 && faceFits;

      setFaceCentered(insideGuide);

      if (!insideGuide) {
        motionRef.current = { baselineY: null, upSeen: false, downSeen: false };
        setInstruction('Center your face in the guide.');
        return;
      }

      const motion = motionRef.current;
      if (motion.baselineY === null) {
        motion.baselineY = centerY;
        setInstruction('Move up and down.');
        return;
      }

      const threshold = layout.height * verticalMoveRatio;
      if (centerY < motion.baselineY - threshold) {
        motion.upSeen = true;
        setInstruction('Now move down.');
      }

      if (motion.upSeen && centerY > motion.baselineY + threshold) {
        motion.downSeen = true;
        scheduleCaptureSelfie();
      }
    },
    [active, busy, layout.height, layout.width, scheduleCaptureSelfie],
  );

  const faceOutput = useFaceDetectorOutput(
    useMemo(
      () => ({
        autoMode: true,
        cameraFacing: 'front' as const,
        minFaceSize: 0.18,
        onError: (error: Error) => onError(error.message),
        onFacesDetected: handleFacesDetected,
        outputResolution: 'preview' as const,
        performanceMode: 'fast' as const,
        runClassifications: false,
        runContours: false,
        runLandmarks: false,
        trackingEnabled: true,
        windowHeight: layout.height || dimensions.height,
        windowWidth: layout.width || dimensions.width,
      }),
      [dimensions.height, dimensions.width, handleFacesDetected, layout.height, layout.width, onError],
    ),
  );

  if (!cameraPermission.hasPermission) {
    return (
      <View style={styles.permissionBox}>
        <Text style={styles.body}>Camera permission is required.</Text>
        <PrimaryButton label="Allow camera" onPress={() => void cameraPermission.requestPermission()} />
      </View>
    );
  }

  if (!device) {
    return <Text style={styles.status}>Front camera is not available.</Text>;
  }

  return (
    <View style={styles.wrapper}>
      <View
        style={styles.cameraShell}
        onLayout={(event) => {
          const nextLayout = event.nativeEvent.layout;
          setLayout({ width: nextLayout.width, height: nextLayout.height });
        }}
      >
        <Camera
          device={device}
          isActive={active && !busy}
          mirrorMode="on"
          outputs={[faceOutput, photoOutput]}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" style={[styles.faceGuide, faceCentered ? styles.faceGuideReady : null]} />
        {countdown !== null ? (
          <View pointerEvents="none" style={styles.countdownOverlay}>
            <Text style={styles.countdownText}>{countdown}</Text>
          </View>
        ) : null}
      </View>
      <Text style={faceCentered ? styles.readyInstruction : styles.instruction}>{instruction}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 10,
  },
  cameraShell: {
    aspectRatio: 3 / 4,
    backgroundColor: '#152B2A',
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  faceGuide: {
    alignSelf: 'center',
    borderColor: '#FFFFFF',
    borderRadius: 999,
    borderWidth: 3,
    height: '48%',
    opacity: 0.92,
    position: 'absolute',
    top: '21%',
    width: '66%',
  },
  faceGuideReady: {
    borderColor: '#35D0A4',
  },
  countdownOverlay: {
    alignItems: 'center',
    alignSelf: 'center',
    height: '48%',
    justifyContent: 'center',
    position: 'absolute',
    top: '21%',
    width: '66%',
  },
  countdownText: {
    color: '#FFFFFF',
    fontSize: 82,
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: '#152B2A',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  instruction: {
    color: '#52615E',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  readyInstruction: {
    color: '#126C67',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  permissionBox: {
    backgroundColor: '#F9FAF8',
    borderColor: '#C8D1CB',
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  body: {
    color: '#2E3C3A',
    fontSize: 15,
    lineHeight: 21,
  },
  status: {
    color: '#52615E',
    fontSize: 14,
  },
});
