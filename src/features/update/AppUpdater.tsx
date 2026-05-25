import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { appConfig } from '../../config/appConfig';

const APK_MIME_TYPE = 'application/vnd.android.package-archive';
const FLAG_GRANT_READ_URI_PERMISSION = 1;
const FLAG_ACTIVITY_NEW_TASK = 0x10000000;
const UPDATE_APK_FILE = `${FileSystem.documentDirectory ?? ''}app-update.apk`;

type RemoteVersionManifest = {
  version?: string;
  changelog?: string;
  apk_url?: string;
  latest_version?: string;
  latest_version_code?: number;
  details?: string[];
  mandatory?: boolean;
};

type AppUpdaterContextValue = {
  checkNow: () => Promise<void>;
  checking: boolean;
  downloading: boolean;
};

type AppUpdaterProps = {
  children: ReactNode;
  autoCheck?: boolean;
  manifestUrl?: string;
};

const AppUpdaterContext = createContext<AppUpdaterContextValue>({
  checkNow: async () => undefined,
  checking: false,
  downloading: false,
});

export function AppUpdater({
  children,
  autoCheck = true,
  manifestUrl = appConfig.updateManifestUrl,
}: AppUpdaterProps) {
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [pendingInstallUri, setPendingInstallUri] = useState<string | null>(null);

  const packageName = getPackageName();
  const canSelfUpdate = Platform.OS === 'android' && Constants.appOwnership !== 'expo';

  const installApk = useCallback(
    async (fileUri: string, openSettingsOnFailure = true) => {
      if (Platform.OS !== 'android') {
        return;
      }

      try {
        const contentUri = await FileSystem.getContentUriAsync(fileUri);
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          type: APK_MIME_TYPE,
          flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
        });
      } catch (caught) {
        if (!openSettingsOnFailure) {
          throw caught;
        }

        setPendingInstallUri(fileUri);
        Alert.alert(
          'Allow app installs',
          'Android needs permission to install updates from this app. Enable it, then return here to continue installing.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open settings',
              onPress: () => {
                void IntentLauncher.startActivityAsync(
                  IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES,
                  { data: `package:${packageName}` },
                );
              },
            },
          ],
        );
      }
    },
    [packageName],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !pendingInstallUri) {
        return;
      }

      const fileUri = pendingInstallUri;
      setPendingInstallUri(null);
      setTimeout(() => {
        void installApk(fileUri, false).catch((caught) => {
          Alert.alert(
            'Install failed',
            caught instanceof Error ? caught.message : 'Unable to start Android package installer.',
          );
        });
      }, 500);
    });

    return () => subscription.remove();
  }, [installApk, pendingInstallUri]);

  const downloadAndInstall = useCallback(
    async (apkUrl: string) => {
      if (!canSelfUpdate) {
        Alert.alert('APK update unavailable', 'Install updates are available only in Android APK builds.');
        return;
      }

      setDownloadProgress(0);
      setDownloading(true);

      try {
        await FileSystem.deleteAsync(UPDATE_APK_FILE, { idempotent: true });
        const download = FileSystem.createDownloadResumable(
          apkUrl,
          UPDATE_APK_FILE,
          {},
          ({ totalBytesExpectedToWrite, totalBytesWritten }) => {
            if (totalBytesExpectedToWrite > 0) {
              setDownloadProgress(totalBytesWritten / totalBytesExpectedToWrite);
            }
          },
        );
        const result = await download.downloadAsync();

        if (!result?.uri) {
          throw new Error('Update download did not return a local APK file.');
        }

        await installApk(result.uri);
      } catch (caught) {
        Alert.alert(
          'Update failed',
          caught instanceof Error ? caught.message : 'Unable to download or install the update.',
        );
      } finally {
        setDownloading(false);
      }
    },
    [canSelfUpdate, installApk],
  );

  const checkNow = useCallback(async (showUpToDate = true) => {
    if (Platform.OS !== 'android') {
      return;
    }

    if (!canSelfUpdate) {
      Alert.alert('APK update unavailable', 'Self-updates are available only in installed Android APK builds.');
      return;
    }

    setChecking(true);

    try {
      const response = await fetch(manifestUrl, { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        throw new Error(`Update check failed: ${response.status}`);
      }

      const manifest = (await response.json()) as RemoteVersionManifest;
      const remoteVersion = manifest.version ?? manifest.latest_version;
      const apkUrl = manifest.apk_url;

      if (!remoteVersion || !apkUrl) {
        throw new Error('Update manifest is missing version or apk_url.');
      }

      if (!isUpdateAvailable(manifest, remoteVersion)) {
        if (showUpToDate) {
          Alert.alert('App is up to date', `Version ${Constants.expoConfig?.version ?? appConfig.appVersion}`);
        }
        return;
      }

      const changelog = manifest.changelog ?? manifest.details?.join('\n') ?? 'Bug fixes and improvements.';
      Alert.alert(
        `Update ${remoteVersion} available`,
        changelog,
        [
          ...(manifest.mandatory ? [] : [{ text: 'Later', style: 'cancel' as const }]),
          {
            text: 'Install',
            onPress: () => {
              void downloadAndInstall(apkUrl);
            },
          },
        ],
      );
    } catch (caught) {
      Alert.alert(
        'Update check failed',
        caught instanceof Error ? caught.message : 'Unable to check for updates.',
      );
    } finally {
      setChecking(false);
    }
  }, [canSelfUpdate, downloadAndInstall, manifestUrl]);

  useEffect(() => {
    if (!autoCheck || Platform.OS !== 'android' || !canSelfUpdate) {
      return;
    }

    void checkNow(false);
  }, [autoCheck, canSelfUpdate, checkNow]);

  const contextValue = useMemo(
    () => ({ checkNow, checking, downloading }),
    [checkNow, checking, downloading],
  );

  return (
    <AppUpdaterContext.Provider value={contextValue}>
      {children}
      <Modal transparent visible={downloading}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalPanel}>
            <ActivityIndicator color="#126C67" size="large" />
            <Text style={styles.modalTitle}>Downloading update</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(downloadProgress * 100)}%` }]} />
            </View>
            <Text style={styles.modalText}>{Math.round(downloadProgress * 100)}%</Text>
          </View>
        </View>
      </Modal>
    </AppUpdaterContext.Provider>
  );
}

export function useAppUpdater() {
  return useContext(AppUpdaterContext);
}

function isUpdateAvailable(manifest: RemoteVersionManifest, remoteVersion: string) {
  const localVersion = Constants.expoConfig?.version ?? appConfig.appVersion;
  const localVersionCode = getLocalVersionCode();

  if (manifest.latest_version_code && localVersionCode) {
    return manifest.latest_version_code > localVersionCode;
  }

  return compareVersions(remoteVersion, localVersion) > 0;
}

function getLocalVersionCode() {
  const androidConfig = Constants.expoConfig?.android as { versionCode?: number } | undefined;

  return androidConfig?.versionCode ?? appConfig.appVersionCode;
}

function getPackageName() {
  const androidConfig = Constants.expoConfig?.android as { package?: string } | undefined;

  return Constants.applicationId ?? androidConfig?.package ?? 'com.timelogs.presence';
}

function compareVersions(candidate: string, current: string) {
  const candidateParts = toVersionParts(candidate);
  const currentParts = toVersionParts(current);
  const length = Math.max(candidateParts.length, currentParts.length);

  for (let index = 0; index < length; index += 1) {
    const candidatePart = candidateParts[index] ?? 0;
    const currentPart = currentParts[index] ?? 0;
    if (candidatePart !== currentPart) {
      return candidatePart > currentPart ? 1 : -1;
    }
  }

  return 0;
}

function toVersionParts(version: string) {
  return version
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

const styles = StyleSheet.create({
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  modalPanel: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    gap: 12,
    padding: 20,
    width: '100%',
  },
  modalText: {
    color: '#52615E',
    fontSize: 14,
  },
  modalTitle: {
    color: '#152B2A',
    fontSize: 18,
    fontWeight: '800',
  },
  progressFill: {
    backgroundColor: '#126C67',
    borderRadius: 999,
    height: '100%',
  },
  progressTrack: {
    backgroundColor: '#EAF1EC',
    borderRadius: 999,
    height: 10,
    overflow: 'hidden',
    width: '100%',
  },
});
