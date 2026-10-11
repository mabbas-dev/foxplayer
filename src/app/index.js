import React, { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useApp } from '../state/AppContext';
import LoadingScreen from '../components/LoadingScreen';
import { REFRESH_STATE } from '../constants';

export default function IndexScreen() {
  const { isInitialized, isConfigured, initialize, deviceId, refreshState } = useApp();
  const router = useRouter();
  const navigatedRef = useRef(false);

  useEffect(() => {
    initialize();
  }, []);

  useEffect(() => {
    if (!isInitialized || navigatedRef.current) return;
    // When the active playlist is detected as expired, do not navigate to tabs!
    // The user will see the LoadingScreen in expired mode and can switch/add playlists directly.
    if (refreshState === REFRESH_STATE.EXPIRED) return;

    navigatedRef.current = true;
    const timer = setTimeout(() => {
      try {
        if (isConfigured) {
          router.replace('/(tabs)');
        } else {
          router.replace('/pairing');
        }
      } catch (_e) {}
    }, 0);
    return () => clearTimeout(timer);
  }, [isInitialized, isConfigured, refreshState, router]);

  return (
    <LoadingScreen
      step="Starting FOX PLAYER"
      progress={0.1}
      deviceId={deviceId}
      showDeviceId={true}
    />
  );
}
