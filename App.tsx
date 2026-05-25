import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ComponentType, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PrimaryButton } from './src/components/PrimaryButton';
import { appConfig } from './src/config/appConfig';
import { SelfieCaptureProps } from './src/features/attendance/SelfieCaptureTypes';
import { useAttendanceFlow } from './src/features/attendance/useAttendanceFlow';
import { AppUpdater, useAppUpdater } from './src/features/update/AppUpdater';
import { apiClient, AttendanceLog, LoginResponse } from './src/services/api/ApiClient';
import { deviceInfoService } from './src/services/upload/DeviceInfoService';

type DashboardView = 'logs' | 'timeIn';

export default function App() {
  return (
    <AppUpdater>
      <TimeLogsApp />
    </AppUpdater>
  );
}

function TimeLogsApp() {
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [login, setLogin] = useState('admin');
  const [password, setPassword] = useState('123456');
  const [token, setToken] = useState('');
  const [user, setUser] = useState<LoginResponse['user'] | null>(null);
  const [authMessage, setAuthMessage] = useState('Sign in to continue.');
  const [authBusy, setAuthBusy] = useState(false);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [logsBusy, setLogsBusy] = useState(false);
  const [logsMessage, setLogsMessage] = useState('No attendance logs loaded yet.');
  const [activeView, setActiveView] = useState<DashboardView>('logs');
  const [cameraPreviewReady, setCameraPreviewReady] = useState(false);
  const [cameraMountError, setCameraMountError] = useState('');
  const [NativeSelfieCapture, setNativeSelfieCapture] = useState<ComponentType<SelfieCaptureProps> | null>(null);
  const flow = useAttendanceFlow(token);
  const updater = useAppUpdater();

  const mediaPermissionReady = cameraPermission?.granted;
  const cameraReady = mediaPermissionReady && cameraPreviewReady;
  const useNativeFaceLiveness = appConfig.capture.nativeFaceLivenessEnabled && NativeSelfieCapture;

  useEffect(() => {
    if (!token) {
      return;
    }

    void loadAttendanceLogs(token);
  }, [token]);

  useEffect(() => {
    if (token && flow.step === 'done') {
      void loadAttendanceLogs(token);
    }
  }, [flow.step, token]);

  useEffect(() => {
    setCameraPreviewReady(false);
    setCameraMountError('');
  }, [activeView, flow.step]);

  useEffect(() => {
    if (!appConfig.capture.nativeFaceLivenessEnabled) {
      return;
    }

    import('./src/features/attendance/NativeSelfieCapture')
      .then((module) => setNativeSelfieCapture(() => module.NativeSelfieCapture))
      .catch((caught) => {
        setCameraMountError(
          caught instanceof Error ? caught.message : 'Native selfie capture is not available.',
        );
      });
  }, []);

  async function signIn() {
    setAuthBusy(true);
    setAuthMessage('Signing in.');

    try {
      const response = await apiClient.login(login, password, deviceInfoService.getDeviceInfo().deviceName);
      setToken(response.token);
      setUser(response.user);
      setActiveView('logs');
      setAuthMessage('');
    } catch (caught) {
      setAuthMessage(caught instanceof Error ? caught.message : 'Sign in failed.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function loadAttendanceLogs(authToken = token) {
    setLogsBusy(true);
    setLogsMessage('Loading attendance logs.');

    try {
      const response = await apiClient.getAttendanceLogs(authToken);
      setLogs(response.data);
      setLogsMessage(response.data.length ? 'Showing latest attendance logs.' : 'No time-in records yet.');
    } catch (caught) {
      setLogsMessage(caught instanceof Error ? caught.message : 'Unable to load attendance logs.');
    } finally {
      setLogsBusy(false);
    }
  }

  function signOut() {
    setToken('');
    setUser(null);
    setLogs([]);
    setLogsMessage('No attendance logs loaded yet.');
    setActiveView('logs');
    flow.reset();
  }

  async function requestMediaPermissions() {
    await requestCameraPermission();
  }

  if (!token || !user) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="auto" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboard}
        >
          <ScrollView contentContainerStyle={[styles.content, styles.loginContent]}>
            <View style={styles.header}>
              <Text style={styles.title}>TimeLogs</Text>
              <Text style={styles.subtitle}>Employee attendance and proof-of-presence.</Text>
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Sign in</Text>
              <Text style={styles.smallText}>Endpoint: {appConfig.apiBaseUrl}</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="username"
                onChangeText={setLogin}
                placeholder="Username or email"
                style={styles.input}
                value={login}
              />
              <TextInput
                autoComplete="password"
                onChangeText={setPassword}
                placeholder="Password"
                secureTextEntry
                style={styles.input}
                value={password}
              />
              <PrimaryButton label={authBusy ? 'Signing in...' : 'Sign in'} onPress={signIn} disabled={authBusy} />
              <Text onPress={() => void updater.checkNow()} style={styles.updateLink}>
                {updater.checking ? 'Checking updates...' : 'Check updates'}
              </Text>
              <Text style={styles.smallText}>
                Version {appConfig.appVersion} ({appConfig.appVersionCode})
              </Text>
              {authMessage ? <Text style={styles.status}>{authMessage}</Text> : null}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Dashboard</Text>
            <Text style={styles.subtitle}>Signed in as {user.name}</Text>
          </View>

          <View style={styles.tabBar}>
            <Text
              onPress={() => setActiveView('logs')}
              style={[styles.tabButton, activeView === 'logs' ? styles.tabButtonActive : null]}
            >
              Logs
            </Text>
            <Text
              onPress={() => setActiveView('timeIn')}
              style={[styles.tabButton, activeView === 'timeIn' ? styles.tabButtonActive : null]}
            >
              Time In
            </Text>
          </View>

          {activeView === 'logs' ? (
            <View style={styles.panel}>
            <View style={styles.dashboardHeader}>
              <View style={styles.dashboardCopy}>
                <Text style={styles.panelTitle}>My Time Logs</Text>
                <Text style={styles.smallText}>Endpoint: {appConfig.apiBaseUrl}</Text>
              </View>
              <Text onPress={signOut} style={styles.linkButton}>Sign out</Text>
            </View>

            <View style={styles.tableHeader}>
              <Text style={[styles.tableCell, styles.timeCell]}>Date / Time</Text>
              <Text style={[styles.tableCell, styles.clientCell]}>Client</Text>
              <Text style={[styles.tableCell, styles.locationCell]}>Location</Text>
            </View>
            {logs.map((log) => (
              <View key={log.id} style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.timeCell]}>{formatDateTime(log.created_at)}</Text>
                <Text style={[styles.tableCell, styles.clientCell]}>{log.client_name}</Text>
                <Text style={[styles.tableCell, styles.locationCell]}>
                  {log.location_address ?? formatCoordinates(log.latitude, log.longitude)}
                </Text>
              </View>
            ))}
            {logsBusy ? <ActivityIndicator color="#126C67" /> : null}
            <Text style={styles.status}>{logsMessage}</Text>
            <PrimaryButton label="Refresh logs" onPress={() => loadAttendanceLogs()} disabled={logsBusy} />
            <PrimaryButton label="Go to Time In" onPress={() => setActiveView('timeIn')} />
            </View>
          ) : null}

          {activeView === 'timeIn' ? (
            <View style={styles.panel}>
            <View style={styles.dashboardHeader}>
              <Text style={styles.panelTitle}>Time in</Text>
              <Text onPress={() => setActiveView('logs')} style={styles.linkButton}>Back to logs</Text>
            </View>
            <Text style={styles.status}>{flow.message}</Text>
            {flow.error ? <Text style={styles.error}>{flow.error}</Text> : null}

            {flow.locationSnapshot ? (
              <View style={styles.locationCard}>
                {flow.locationSnapshot.map_image_data_uri || flow.locationSnapshot.map_url ? (
                  <Image
                    resizeMode="cover"
                    source={{
                      uri: flow.locationSnapshot.map_image_data_uri ?? flow.locationSnapshot.map_url ?? '',
                    }}
                    style={styles.mapPreview}
                  />
                ) : (
                  <View style={styles.mapFallback}>
                    <Text style={styles.status}>OpenStreetMap preview is unavailable.</Text>
                  </View>
                )}
                <Text style={styles.locationLabel}>Captured Location</Text>
                <View style={styles.addressBox}>
                  <Text style={styles.body}>{flow.locationSnapshot.address}</Text>
                </View>
                {flow.locationSnapshot.accuracy !== null ? (
                  <Text style={styles.status}>
                    Accuracy: {Math.round(flow.locationSnapshot.accuracy)} m
                  </Text>
                ) : null}
                <Text style={styles.status}>This address will be saved with your time-in evidence.</Text>
              </View>
            ) : null}

            {flow.busy ? <ActivityIndicator color="#126C67" /> : null}

            {flow.step === 'gps' ? (
              <PrimaryButton
                label="Get location"
                onPress={flow.checkLocation}
                disabled={!token || flow.busy}
              />
            ) : null}

            {flow.step === 'camera' ? (
              <View style={styles.cameraBlock}>
                {useNativeFaceLiveness ? (
                  <NativeSelfieCapture
                    active={activeView === 'timeIn' && flow.step === 'camera'}
                    busy={flow.busy}
                    onCaptured={flow.acceptCapturedEvidence}
                    onError={(message) => flow.setErrorMessage(message)}
                  />
                ) : mediaPermissionReady ? (
                  <View style={styles.cameraShell}>
                  <CameraView
                    key={`${activeView}-${flow.step}`}
                    ref={cameraRef}
                    active={activeView === 'timeIn' && flow.step === 'camera'}
                    facing="front"
                    mirror
                    mode="picture"
                    onCameraReady={() => setCameraPreviewReady(true)}
                    onMountError={(event) => setCameraMountError(event.message)}
                    ratio="4:3"
                    style={styles.camera}
                  />
                    <View pointerEvents="none" style={styles.faceGuide} />
                  </View>
                ) : (
                  <View style={styles.permissionBox}>
                    <Text style={styles.body}>Camera permission is required.</Text>
                    <PrimaryButton label="Allow camera" onPress={requestMediaPermissions} />
                  </View>
                )}
                {!useNativeFaceLiveness && mediaPermissionReady && !cameraPreviewReady ? (
                  <Text style={styles.status}>Opening camera preview.</Text>
                ) : null}
                {!useNativeFaceLiveness && mediaPermissionReady ? (
                  <Text style={styles.status}>Center your face in the guide, then tap Selfie.</Text>
                ) : null}
                {cameraMountError ? <Text style={styles.error}>{cameraMountError}</Text> : null}
                {!useNativeFaceLiveness ? (
                  <PrimaryButton
                    label={flow.busy ? 'Capturing...' : 'Selfie'}
                    onPress={() => flow.recordEvidence(cameraRef.current)}
                    disabled={!cameraReady || flow.busy}
                  />
                ) : null}
              </View>
            ) : null}

            {flow.step === 'upload' ? (
              <PrimaryButton
                label="Submit time-in"
                onPress={flow.submit}
                disabled={!flow.canSubmit || flow.busy}
              />
            ) : null}

            {flow.step === 'done' ? <PrimaryButton label="Start another time-in" onPress={flow.reset} /> : null}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function formatDateTime(value: string | null) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatCoordinates(latitude: number, longitude: number) {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F4EF',
  },
  keyboard: {
    flex: 1,
  },
  content: {
    gap: 16,
    padding: 18,
  },
  loginContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  header: {
    paddingTop: 8,
  },
  title: {
    color: '#152B2A',
    fontSize: 30,
    fontWeight: '800',
  },
  subtitle: {
    color: '#52615E',
    fontSize: 15,
    marginTop: 4,
  },
  panel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D9DED9',
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  panelTitle: {
    color: '#152B2A',
    fontSize: 18,
    fontWeight: '800',
  },
  tabBar: {
    backgroundColor: '#EAF1EC',
    borderRadius: 8,
    flexDirection: 'row',
    padding: 4,
  },
  tabButton: {
    borderRadius: 6,
    color: '#254441',
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    overflow: 'hidden',
    paddingVertical: 10,
    textAlign: 'center',
  },
  tabButtonActive: {
    backgroundColor: '#126C67',
    color: '#FFFFFF',
  },
  dashboardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  dashboardCopy: {
    flex: 1,
    gap: 4,
  },
  linkButton: {
    color: '#126C67',
    fontSize: 14,
    fontWeight: '800',
    paddingVertical: 4,
  },
  updateLink: {
    color: '#126C67',
    fontSize: 14,
    fontWeight: '800',
    paddingVertical: 4,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#F9FAF8',
    borderColor: '#C8D1CB',
    borderRadius: 6,
    borderWidth: 1,
    color: '#152B2A',
    fontSize: 16,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  smallText: {
    color: '#52615E',
    fontSize: 12,
  },
  challenge: {
    color: '#A64220',
    fontSize: 24,
    fontWeight: '800',
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
  error: {
    color: '#B3261E',
    fontSize: 14,
    fontWeight: '700',
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metric: {
    backgroundColor: '#EAF1EC',
    borderRadius: 6,
    color: '#254441',
    fontSize: 13,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  locationCard: {
    borderColor: '#D9DED9',
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 10,
  },
  mapPreview: {
    backgroundColor: '#EAF1EC',
    borderRadius: 6,
    height: 150,
    overflow: 'hidden',
    width: '100%',
  },
  mapFallback: {
    alignItems: 'center',
    backgroundColor: '#EAF1EC',
    borderRadius: 6,
    height: 150,
    justifyContent: 'center',
    padding: 14,
    width: '100%',
  },
  locationLabel: {
    color: '#52615E',
    fontSize: 12,
    fontWeight: '800',
  },
  addressBox: {
    backgroundColor: '#FFFFFF',
    borderColor: '#C8D1CB',
    borderRadius: 6,
    borderWidth: 1,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  tableHeader: {
    backgroundColor: '#EAF1EC',
    borderRadius: 6,
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  tableRow: {
    borderBottomColor: '#E5E9E5',
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  tableCell: {
    color: '#254441',
    fontSize: 12,
    lineHeight: 16,
  },
  timeCell: {
    flex: 1.1,
  },
  clientCell: {
    flex: 1,
    fontWeight: '700',
  },
  statusCell: {
    flex: 0.9,
  },
  locationCell: {
    flex: 1.2,
  },
  cameraBlock: {
    gap: 12,
  },
  cameraShell: {
    aspectRatio: 3 / 4,
    backgroundColor: '#152B2A',
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  camera: {
    height: '100%',
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
  permissionBox: {
    backgroundColor: '#F9FAF8',
    borderColor: '#C8D1CB',
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  note: {
    paddingHorizontal: 4,
    paddingBottom: 24,
  },
  noteText: {
    color: '#66716E',
    fontSize: 13,
    lineHeight: 19,
  },
});
