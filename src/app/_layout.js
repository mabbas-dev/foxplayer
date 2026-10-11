import { useEffect } from 'react';
import { LogBox, Platform, StatusBar as RNStatusBar, View, StyleSheet, Modal } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';

// Suppress internal native track loader warnings while retaining comprehensive OTT in-player error UI
LogBox.ignoreLogs([
  'Failed to load available audio tracks',
  'Failed to load available subtitle tracks',
]);
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SystemUI from 'expo-system-ui';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, DarkTheme } from 'expo-router/react-navigation';
import { AppProvider, useApp } from '../state/AppContext';
import Colors from '../constants/colors';
import { REFRESH_STATE } from '../constants';
import LoadingScreen from '../components/LoadingScreen';
import GlobalToast from '../components/GlobalToast';
import PlaylistExpiredDialog from '../components/PlaylistExpiredDialog';
import SubscriptionExpiredBarrier from '../components/SubscriptionExpiredBarrier';
import FreeTrialDisclaimerModal from '../components/FreeTrialDisclaimerModal';
import { SubscriptionProvider } from '../state/SubscriptionContext';

const AppNavTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.background.primary,
    card: Colors.background.primary,
    text: Colors.text.primary,
    border: Colors.border.default,
  },
};

function NavigationController() {
  const { isInitialized, isConfigured } = useApp();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (!isInitialized) return;

    const inPairing = segments[0] === 'pairing';
    const inIndex = segments.length === 0 || segments[0] === 'index';

    // When backend confirms device has zero associated playlists, automatically return to QR-code setup screen
    if (!isConfigured && !inPairing && !inIndex) {
      const timer = setTimeout(() => {
        try {
          router.replace('/pairing');
        } catch (_e) {}
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isInitialized, isConfigured, segments, router]);

  return null;
}

function GlobalRefreshScreen() {
  const {
    refreshState,
    refreshStep,
    refreshProgress,
    refreshError,
    retryRefresh,
    dismissRefreshError,
    showPlaylistExpiredDialog,
    hidePlaylistExpiredDialog,
    playlistExpiredModal,
    savedPlaylists,
    activePlaylistId,
    activePlaylist,
    switchPlaylist,
    deviceId,
  } = useApp();

  const isExpired = refreshState === REFRESH_STATE.EXPIRED;

  const isVisible =
    refreshState === REFRESH_STATE.REFRESHING ||
    refreshState === REFRESH_STATE.SWITCHING ||
    refreshState === REFRESH_STATE.SYNCHRONIZING ||
    refreshState === REFRESH_STATE.INITIALIZING ||
    refreshState === REFRESH_STATE.ERROR ||
    isExpired;

  if (!isVisible) return null;

  return (
    <View style={styles.rootRefreshBarrier} pointerEvents="auto">
      <LoadingScreen
        step={refreshStep || (refreshError ? 'Connection Issue' : isExpired ? 'Playlist Expired' : 'Updating Content')}
        progress={refreshProgress}
        deviceId={deviceId}
        showDeviceId={true}
        error={refreshError}
        isExpired={isExpired}
        expiredInfo={playlistExpiredModal}
        savedPlaylists={savedPlaylists}
        activePlaylistId={activePlaylistId}
        activePlaylist={activePlaylist}
        onRetry={retryRefresh}
        onDismiss={isExpired ? hidePlaylistExpiredDialog : dismissRefreshError}
        onSwitchPlaylist={switchPlaylist}
      />
    </View>
  );
}

function RootAppContent() {
  const { refreshState } = useApp();

  const isRefreshActive =
    refreshState === REFRESH_STATE.REFRESHING ||
    refreshState === REFRESH_STATE.SWITCHING ||
    refreshState === REFRESH_STATE.SYNCHRONIZING ||
    refreshState === REFRESH_STATE.INITIALIZING ||
    refreshState === REFRESH_STATE.ERROR ||
    refreshState === REFRESH_STATE.EXPIRED;

  return (
    <View style={styles.rootContainer}>
      <NavigationController />
      <StatusBar hidden={true} translucent={true} />

      {/* Main Navigation: Completely hidden from visual rendering and touches when Global Refresh Screen is active */}
      <View
        style={[
          styles.mainNavigationContainer,
          isRefreshActive && styles.mainNavigationHidden,
        ]}
        pointerEvents={isRefreshActive ? 'none' : 'auto'}
      >
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: Colors.background.primary },
            animation: 'fade',
          }}
        >
          <Stack.Screen name="index" options={{ animation: 'none' }} />
          <Stack.Screen name="pairing" options={{ animation: 'fade' }} />
          <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
          <Stack.Screen
            name="player"
            options={{
              // The visual transition is handled by MiniToFullTransition's
              // expansion animation. Use a short fade so the route push is
              // invisible — no competing slide flash.
              animation: 'fade',
              animationDuration: 120,
              presentation: 'fullScreenModal',
            }}
          />
          <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="favorites" options={{ animation: 'fade' }} />
        </Stack>
      </View>

      {/* Global Refresh Screen: Authoritative Root-Level Presentation sitting strictly ABOVE all application UI */}
      <GlobalRefreshScreen />

      {/* Authoritative Device Subscription Expired / Inactive Barrier */}
      <SubscriptionExpiredBarrier />

      {/* Authoritative Free Trial One-Time Disclaimer Modal */}
      <FreeTrialDisclaimerModal />

      {/* Non-blocking Global Toast on the topmost layer */}
      <GlobalToast />

      {/* PlaylistExpiredDialog stub for universal navigation safety */}
      <PlaylistExpiredDialog />
    </View>
  );
}

function SubscriptionContainer({ children }) {
  const { deviceId, installationId, subscription, isTrialEligible, trialDurationDays } = useApp();

  return (
    <SubscriptionProvider
      deviceId={deviceId}
      installationId={installationId}
      initialSubscription={subscription}
      initialEligibility={{ is_eligible: isTrialEligible, duration_days: trialDurationDays }}
    >
      {children}
    </SubscriptionProvider>
  );
}

export default function RootLayout() {
  useEffect(() => {
    async function configureSystemUI() {
      // Global status bar hidden enforcement (native Android & iOS)
      try {
        RNStatusBar.setHidden(true, 'none');
      } catch (_e) {}

      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      } catch (e) {
        // Fallback or web
      }

      try {
        await SystemUI.setBackgroundColorAsync(Colors.background.primary);
      } catch (e) {
        // Non-Android or web
      }

      if (Platform.OS === 'android') {
        try {
          const NavigationBar = require('expo-navigation-bar');
          if (NavigationBar?.setBackgroundColorAsync) {
            NavigationBar.setBackgroundColorAsync('#000000').catch(() => {});
          }
          if (NavigationBar?.setButtonStyleAsync) {
            NavigationBar.setButtonStyleAsync('light').catch(() => {});
          }
        } catch (_e) {
          // Native module fallback
        }
      }
    }
    configureSystemUI();
  }, []);

  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: Colors.background.primary }}>
      <ThemeProvider value={AppNavTheme}>
        <AppProvider>
          <SubscriptionContainer>
            <RootAppContent />
          </SubscriptionContainer>
        </AppProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    ...StyleSheet.absoluteFillObject,
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: Colors.background.primary,
    position: 'relative',
    overflow: 'hidden',
  },
  mainNavigationContainer: {
    ...StyleSheet.absoluteFillObject,
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: Colors.background.primary,
  },
  mainNavigationHidden: {
    display: 'none',
  },
  rootRefreshBarrier: {
    ...StyleSheet.absoluteFillObject,
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: Colors.background.primary,
    zIndex: 9999,
  },
});

