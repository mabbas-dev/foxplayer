import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Animated,
  AppState,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state/AppContext';
import Colors from '../constants/colors';
import { API_BASE_URL } from '../constants/index.js';
import BrokenVideoView from '../components/BrokenVideoView';
import PlayerErrorToast from '../components/PlayerErrorToast';
import GlobalToast from '../components/GlobalToast';
import PlayerControls from '../components/PlayerControls';
import BufferingIndicator from '../components/BufferingIndicator';
import PlayerGestureOverlay from '../components/PlayerGestureOverlay';
import usePlayerBrightness from '../hooks/usePlayerBrightness';
import usePlayerVolume from '../hooks/usePlayerVolume';
import {
  mapStreamError,
  classifyPlayerError,
  getErrorDisplayDetails,
  evaluatePlayerErrorPopupPolicy,
  isConfirmedServerError,
  isFatalNativePlayerError,
  logClassifiedPlayerError,
  ERROR_POPUP_CATEGORY,
} from '../utils/playerErrorMapper';
import {
  validateStreamSource,
  detectContentType,
  normalizePlaybackSource,
  DEFAULT_IPTV_USER_AGENT,
} from '../utils/mediaSourcePipeline.js';
import {
  getPlatformPlayerOptions,
  getPlatformBufferOptions,
  getPlatformVideoViewProps,
  prepareStreamUrlForPlatform,
  getStreamFallbackUrl,
  logPlayerDiagnostic,
} from '../utils/playerConfig.js';
import { PlaybackController } from '../playback/PlaybackController.js';
import { getPlatformPlayer } from '../playback/PlatformPlayer.js';
import { PLAYBACK_STATE, ENGINE_TYPE, ENGINE_MODE, ENGINE_SWITCH_REASON, ENGINE_LABELS } from '../playback/playbackTypes.js';
import { DualPlaybackCoordinator } from '../playback/engines/DualPlaybackCoordinator.js';
import UnifiedVideoSurface from '../playback/components/UnifiedVideoSurface.js';
import PlaybackEngineModal from '../components/PlaybackEngineModal.js';
import { readCache, writeCache } from '../storage/cacheStorage.js';
import { safeBack } from '../utils/navigation';
import { measureAndLogLayout } from '../utils/layoutDiagnostics';

let useVlcPlayerHook = null;
try {
  const vlcModule = require('rn-vlc-plyr');
  if (vlcModule && typeof vlcModule.useVlcPlayer === 'function') {
    useVlcPlayerHook = vlcModule.useVlcPlayer;
  }
} catch (_e) {}

const SPEEDS    = [1.0, 1.25, 1.5, 2.0];
const FIT_MODES = ['contain', 'cover', 'fill'];

export default function PlayerScreen() {
  const { url, title, type, streamId, extension, poster, selectedAt } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { playbackSessionId, playlistConfig, showPlaylistExpiredDialog, activePlaylistId, activePlaylist, isExpired } = useApp();

  const viewportRef = useRef(null);
  const videoSurfaceRef = useRef(null);
  const unifiedOverlayRef = useRef(null);
  const controlsContainerRef = useRef(null);

  // Dual Playback Engine state
  const [activeEngineType, setActiveEngineType]     = useState(ENGINE_TYPE.NATIVE);
  const [engineMode, setEngineMode]                 = useState(ENGINE_MODE.AUTO);
  const [showEngineModal, setShowEngineModal]       = useState(false);
  const [isSwitchingEngine, setIsSwitchingEngine]   = useState(false);
  const vlcAttemptsRef                              = useRef(0);
  const nativeAttemptsRef                           = useRef(0);

  // State machine: 'LOADING' | 'BUFFERING' | 'PLAYING' | 'PAUSED' | 'ERROR'
  const [playerState, setPlayerState]               = useState('LOADING');
  const [isBufferingUI, setIsBufferingUI]           = useState(true);
  const [errorMessage, setErrorMessage]             = useState(null);
  const [errorDetails, setErrorDetails]             = useState(null);
  const [toastMessage, setToastMessage]             = useState(null);
  const [showToast, setShowToast]                   = useState(false);
  const [controlsVisible, setControlsVisible]       = useState(true);
  const [contentFit, setContentFit]                 = useState('contain');
  const [currentTime, setCurrentTime]               = useState(0);
  const currentTimeRef                              = useRef(0);
  currentTimeRef.current                            = currentTime;
  const [duration, setDuration]                     = useState(0);
  const [playbackSpeedIndex, setPlaybackSpeedIndex] = useState(0);
  const [seekFeedback, setSeekFeedback]             = useState(null);
  const [hasFirstFrame, setHasFirstFrame]           = useState(false);
  const [gestureHud, setGestureHud]                 = useState(null);
  const [availableAudioTracks, setAvailableAudioTracks] = useState([]);
  const [selectedAudioTrack, setSelectedAudioTrack]     = useState(null);
  const [availableSubtitleTracks, setAvailableSubtitleTracks] = useState([]);
  const [selectedSubtitleTrack, setSelectedSubtitleTrack]     = useState(null);

  // Stable mutable refs — only read inside event-handlers / effects, never during render
  const playbackIntentRef   = useRef('PLAYING'); // Tracks genuine user playback intent ('PLAYING' | 'PAUSED')
  const playerStateRef      = useRef(playerState);
  const isSeekingRef        = useRef(false);
  const pendingSeekTimeRef  = useRef(null);
  const seekTimeoutRef      = useRef(null);
  const seekCounterRef      = useRef(0);
  const seekTargetTimeRef   = useRef(null);
  const isSeekingSettlingRef = useRef(false);
  const seekWatchdogRef     = useRef(null);
  const wasPlayingBeforeSeekRef = useRef(true);
  const completeSeekRef     = useRef(null);
  const durationRef         = useRef(0);
  const userPausedRef       = useRef(false);
  const hasEverPlayedRef    = useRef(false);
  const currentUrlRef        = useRef(null);
  const requestCounterRef    = useRef(0);
  const isReplacingSourceRef = useRef(false);
  const loadTimeoutRef       = useRef(null);
  const verifyPlaybackRef    = useRef(null);
  const fallbackAttemptedRef = useRef(false);
  const bufferTimerRef      = useRef(null);
  const bufferStartRef      = useRef(0);
  const controlsTimeout     = useRef(null);
  const lastTapRef          = useRef({ time: 0, side: null });
  const lastErrorRef        = useRef(null);
  const lastToastedAttemptIdRef = useRef(null);
  const lastPlaybackTimeRef = useRef(-1);
  const lastAdvanceTimeRef  = useRef(0);
  const isTogglingPlayRef   = useRef(false);
  const isRetryingRef       = useRef(false);
  const hasEndedRef         = useRef(false);
  const seekFeedbackAnimRef = useRef(new Animated.Value(0));
  const controlsOpacityRef  = useRef(new Animated.Value(1));
  const timingRef            = useRef({
    t0_tap: 0,
    t1_source: 0,
    t2_player: 0,
    t3_assigned: 0,
    t4_loading: 0,
    t5_ready: 0,
    t6_firstFrame: 0,
    t7_play: 0,
    t8_playing: 0,
    assigned: 0,
    ready: 0,
    firstPlay: 0,
  });

  useEffect(() => {
    playerStateRef.current = playerState;
  }, [playerState]);

  // Stable Animated.Value references — extracted here so JSX doesn't access .current during render
  // eslint-disable-next-line react-hooks/refs
  const seekFeedbackAnim = seekFeedbackAnimRef.current;
  // eslint-disable-next-line react-hooks/refs
  const controlsOpacity  = controlsOpacityRef.current;

  // Debounced buffering state manager — prevents rapid flicker on network pulses
  const setDebouncedBuffering = useCallback((buffering) => {
    if (bufferTimerRef.current) {
      clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }

    if (buffering) {
      // Small 120ms debounce when entering buffer to absorb micro-stalls
      bufferTimerRef.current = setTimeout(() => {
        bufferStartRef.current = Date.now();
        setIsBufferingUI(true);
      }, 120);
    } else {
      // Hold for at least 350ms before hiding so the animation doesn't flash
      const elapsed = Date.now() - bufferStartRef.current;
      const minDisplayMs = 350;
      const remaining = Math.max(0, minDisplayMs - elapsed);

      bufferTimerRef.current = setTimeout(() => {
        setIsBufferingUI(false);
      }, remaining);
    }
  }, []);

  const isLive = type === 'live' || type === 'channel';

  // Centralized playback source normalization
  const normalized = useMemo(() => {
    const creds = playlistConfig?.config || playlistConfig || {};
    return normalizePlaybackSource({
      type,
      item: {
        url,
        title,
        poster,
        streamId,
        containerExtension: extension,
      },
      credentials: creds,
    }, { platform: Platform.OS });
  }, [url, title, type, streamId, extension, poster, playlistConfig]);

  const sanitizedUrl = normalized.uri;
  const validation = useMemo(() => ({
    isValid: normalized.isValid,
    uri: normalized.uri,
    error: normalized.validationError,
  }), [normalized]);
  const contentType = normalized.contentType;
  const playerSource = useMemo(() => {
    if (normalized?.playerSource) return normalized.playerSource;
    if (!validation.isValid || !validation.uri) return null;
    return {
      uri: validation.uri,
      ...(contentType && contentType !== 'auto' ? { contentType } : {}),
      headers: normalized?.headers || { 'User-Agent': DEFAULT_IPTV_USER_AGENT },
      metadata: {
        title: title || 'Fox Player',
        ...(poster ? { artwork: poster } : {}),
      },
    };
  }, [normalized, validation, contentType, title, poster]);

  // Initialize expo-video player with stable null source to avoid render-cycle churn
  const player = useVideoPlayer(null, (p) => {
    const opts = getPlatformPlayerOptions({ type, isLive });
    p.loop = opts.loop;
    p.timeUpdateEventInterval = opts.timeUpdateEventInterval;
    p.staysActiveInBackground = opts.staysActiveInBackground;
    if (opts.audioMixingMode) {
      p.audioMixingMode = opts.audioMixingMode;
    }
    p.muted = false;
    p.volume = 1.0;
    if (opts.bufferOptions) {
      p.bufferOptions = opts.bufferOptions;
    }
  });

  // Initialize VLC player hook if native module is linked
  let vlcPlayer = null;
  if (useVlcPlayerHook) {
    try {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      vlcPlayer = useVlcPlayerHook(undefined);
    } catch (_e) {
      vlcPlayer = null;
    }
  }

  // Load persisted engine preference on mount
  useEffect(() => {
    readCache('fox_player_preferred_engine_mode').then((saved) => {
      if (saved === ENGINE_MODE.AUTO || saved === ENGINE_MODE.NATIVE || saved === ENGINE_MODE.VLC) {
        setEngineMode(saved);
        if (saved === ENGINE_MODE.VLC) {
          setActiveEngineType(ENGINE_TYPE.VLC);
          vlcAttemptsRef.current = 1;
        }
      }
    }).catch(() => {});
  }, []);

  // Seamless Dual Engine Switcher
  const switchEngine = useCallback(async (targetEngineType, reason = ENGINE_SWITCH_REASON.MANUAL_SWITCH) => {
    if (activeEngineType === targetEngineType && playerStateRef.current === 'PLAYING') return;
    setIsSwitchingEngine(true);
    setDebouncedBuffering(true);

    const fromEngine = activeEngineType;
    const currentPos = currentTimeRef.current || 0;

    logPlayerDiagnostic('engineSwitch', { from: fromEngine, to: targetEngineType, reason });

    // Stop and silence old engine completely to prevent dual audio
    if (fromEngine === ENGINE_TYPE.NATIVE) {
      try {
        player.pause();
        if (typeof player.replaceAsync === 'function') {
          player.replaceAsync(null).catch(() => {});
        }
      } catch (_e) {}
    } else if (fromEngine === ENGINE_TYPE.VLC && vlcPlayer) {
      try {
        vlcPlayer.stop();
      } catch (_e) {}
    }

    setActiveEngineType(targetEngineType);

    if (targetEngineType === ENGINE_TYPE.VLC) {
      vlcAttemptsRef.current++;
      if (vlcPlayer && url) {
        try {
          const vlcSource = {
            uri: url,
            userAgent: DEFAULT_IPTV_USER_AGENT,
            vlcOptions: [':network-caching=3000', ':live-caching=2000'],
            title: title || 'Live Stream',
          };
          vlcPlayer.source = vlcSource;
          vlcPlayer.autoPlay = true;
          vlcPlayer.play();
          setToastMessage('Switched to VLC Player Engine');
          setShowToast(true);
          setTimeout(() => setShowToast(false), 2200);
        } catch (_vlcErr) {
          logPlayerDiagnostic('vlcStartError', { error: _vlcErr.message });
        }
      }
    } else {
      nativeAttemptsRef.current++;
      if (player && playerSource) {
        try {
          if (typeof player.replaceAsync === 'function') {
            player.replaceAsync(playerSource).then(() => {
              player.play();
            }).catch(() => {});
          } else {
            player.replace(playerSource);
            player.play();
          }
          setToastMessage('Switched to Native Player Engine');
          setShowToast(true);
          setTimeout(() => setShowToast(false), 2200);
        } catch (_natErr) {}
      }
    }

    setIsSwitchingEngine(false);
  }, [activeEngineType, player, vlcPlayer, url, playerSource, title, setDebouncedBuffering]);

  // Screen brightness management with lifecycle restoration
  const { brightness, setBrightness } = usePlayerBrightness();

  const volumeRef = useRef(1.0);
  const isMutedRef = useRef(false);
  const hardwareHudTimerRef = useRef(null);

  const handleVolumeChange = useCallback((newVol, info) => {
    if (info?.source === 'hardware') {
      setGestureHud({
        type: 'volume',
        value: newVol,
        visible: true,
      });
      if (hardwareHudTimerRef.current) {
        clearTimeout(hardwareHudTimerRef.current);
      }
      hardwareHudTimerRef.current = setTimeout(() => {
        setGestureHud(null);
      }, 1200);
    }
  }, []);

  // Media volume management synchronized with player
  const {
    volume,
    setVolume,
    isMuted,
    toggleMute: toggleVolumeMute,
    notifyGestureStart,
    notifyGestureEnd,
  } = usePlayerVolume({
    player,
    onVolumeChange: handleVolumeChange,
  });

  volumeRef.current = volume;
  isMutedRef.current = isMuted;

  // Platform Playback Controller instance
  const platformDriver = useMemo(() => getPlatformPlayer(Platform.OS), []);
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = new PlaybackController({
      platform: Platform.OS,
      driver: platformDriver,
    });
  }
  const controller = controllerRef.current;

  // Attach player to PlaybackController and configure platform buffer options
  useEffect(() => {
    if (player) {
      try {
        controller.attachPlayer(player, { type, isLive });
        const opts = getPlatformPlayerOptions({ type, isLive });
        player.staysActiveInBackground = false;
        const currentVol = volumeRef.current;
        if (typeof currentVol === 'number' && !isNaN(currentVol)) {
          player.volume = currentVol;
          player.muted = Boolean(isMutedRef.current || currentVol === 0);
        } else {
          player.muted = false;
          player.volume = 1.0;
        }
        if (opts.bufferOptions) {
          player.bufferOptions = opts.bufferOptions;
        }
      } catch (_e) {}
    }
  }, [player, controller, type, isLive]);

  // Synchronize duration immediately as soon as player metadata is available
  useEffect(() => {
    if (!isLive && player?.duration && isFinite(player.duration) && !isNaN(player.duration) && player.duration > 0) {
      setDuration(player.duration);
    }
  }, [isLive, player, player?.duration]);

  // Teardown when leaving screen
  useEffect(() => {
    return () => {
      if (player) {
        try {
          player.pause();
          player.muted = true;
          if (typeof player.replaceAsync === 'function') {
            player.replaceAsync(null);
          } else if (typeof player.replace === 'function') {
            player.replace(null);
          }
        } catch (_e) {}
      }
    };
  }, [player]);

  // Teardown and exit immediately if active playlist switches during playback
  const initialSessionRef = useRef(playbackSessionId);
  useEffect(() => {
    if (initialSessionRef.current && initialSessionRef.current !== playbackSessionId) {
      try {
        player?.pause?.();
        player.muted = true;
      } catch (_e) {}
      safeBack(router);
    }
  }, [playbackSessionId, player, router]);

  // Handle AppState changes: immediately pause when minimized/backgrounded, and resume when foregrounded if active
  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'active') {
        if (
          playbackIntentRef.current === 'PLAYING' &&
          !userPausedRef.current &&
          player &&
          !player.playing &&
          player.status === 'readyToPlay'
        ) {
          try {
            player.play();
          } catch (_e) {}
        }
      } else if (nextAppState === 'background' || nextAppState === 'inactive') {
        if (player) {
          try {
            player.pause();
          } catch (_e) {}
        }
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      sub.remove();
    };
  }, [player]);



  const triggerErrorState = useCallback((rawError) => {
    const classified = classifyPlayerError(rawError);
    if (classified.category === 'CANCELLED') return;
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    if (verifyPlaybackRef.current) clearTimeout(verifyPlaybackRef.current);

    const popupPolicy = evaluatePlayerErrorPopupPolicy(rawError, {
      isNativeEvent: player?.status === 'error',
    });

    const currentAttemptId = requestCounterRef.current;

    // Phase 8 Diagnostic logging
    logClassifiedPlayerError({
      platform: Platform.OS,
      activePlaybackSessionId: currentAttemptId,
      errorCategory: popupPolicy.popupCategory,
      errorOrigin: player?.status === 'error' ? 'native_player' : 'application',
      actualHttpStatus: popupPolicy.httpStatus,
      nativeErrorCode: popupPolicy.nativeErrorCode,
      popupDisplayed: popupPolicy.shouldShowPopup,
      decisionReason: popupPolicy.decisionReason,
    });

    // Guard: Only confirmed terminal failures may transition playerState to ERROR
    const isConfirmedServer = isConfirmedServerError(rawError);
    const isFatalNative = isFatalNativePlayerError(rawError, { isNativeEvent: player?.status === 'error' });
    const isInvalidSource = classified.category === 'INVALID_URL' || (!validation?.isValid && Boolean(url));
    const isTerminalFailure = isConfirmedServer || isFatalNative || isInvalidSource || (classified.isFatal && fallbackAttemptedRef.current);

    if (!isTerminalFailure) {
      logPlayerDiagnostic('nonTerminalErrorSuppressed', {
        error: rawError?.message || String(rawError),
        category: classified.category,
        attemptId: currentAttemptId,
      });
      return;
    }

    playerStateRef.current = 'ERROR';
    setPlayerState('ERROR');
    const details = getErrorDisplayDetails(rawError);
    setErrorDetails(details);
    const userMsg = details.exactError || details.message || 'Unable to play this stream.';
    setErrorMessage(userMsg);
    setDebouncedBuffering(false);
    setIsBufferingUI(false);
    logPlayerDiagnostic('playbackError', {
      category: details.category,
      technical: details.technicalMessage,
      exactError: details.exactError,
      errorCode: details.errorCode,
      type,
      attemptId: currentAttemptId,
      popupCategory: popupPolicy.popupCategory,
      shouldShowPopup: popupPolicy.shouldShowPopup,
    });

    // Deduplicate toast: exactly one toast per attempt generation ID, ONLY when popup is authorized
    if (lastToastedAttemptIdRef.current !== currentAttemptId && popupPolicy.shouldShowPopup) {
      lastToastedAttemptIdRef.current = currentAttemptId;
      setToastMessage('Failed');
      setShowToast(true);
    }
  }, [setDebouncedBuffering, type, player, validation, url]);


  // Handle fallback or transition to error with stale operation guard
  const handleFallbackOrError = useCallback((err, failedUrl, opId = null) => {
    if (opId !== null && opId !== requestCounterRef.current) {
      // Stale operation: ignore error from obsolete stream request
      return;
    }
    const classified = classifyPlayerError(err);
    if (classified.category === 'CANCELLED') {
      // Cancellation errors are non-fatal lifecycle transitions
      return;
    }

    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    if (verifyPlaybackRef.current) clearTimeout(verifyPlaybackRef.current);

    // Automatic Dual-Engine Fallback:
    // If native engine failed on a recoverable/switchable error, switch to VLC engine automatically
    const isSwitchable = DualPlaybackCoordinator.isSwitchableError(classified);
    if (
      engineMode === ENGINE_MODE.AUTO &&
      activeEngineType === ENGINE_TYPE.NATIVE &&
      vlcAttemptsRef.current < 1 &&
      isSwitchable
    ) {
      logPlayerDiagnostic('autoSwitchingToVlcEngine', {
        error: classified.message,
        category: classified.category,
        opId,
      });
      switchEngine(ENGINE_TYPE.VLC, ENGINE_SWITCH_REASON.AUTO_FALLBACK);
      return;
    }

    if (!fallbackAttemptedRef.current && classified.isFatal) {
      const fallbackUrl = getStreamFallbackUrl(failedUrl, {
        isLive,
        platform: Platform.OS,
        serverBaseUrl: API_BASE_URL,
      });
      if (fallbackUrl && fallbackUrl !== failedUrl) {
        fallbackAttemptedRef.current = true;
        playerStateRef.current = 'RETRYING';
        setPlayerState('RETRYING');
        setDebouncedBuffering(true);
        setIsBufferingUI(true);
        logPlayerDiagnostic('fallbackAttempt', { fallbackUrl, type, platform: Platform.OS });
        // Diagnostics watchdog for fallback attempt — NEVER triggers premature false fatal error
        loadTimeoutRef.current = setTimeout(() => {
          if (opId === null || opId === requestCounterRef.current) {
            logPlayerDiagnostic('fallbackConnectSlow', { opId, platform: Platform.OS });
          }
        }, 6000);

        try {
          const fallbackSource = {
            uri: fallbackUrl,
            contentType: fallbackUrl.includes('.m3u8') ? 'hls' : 'progressive',
            headers: playerSource?.headers || { 'User-Agent': DEFAULT_IPTV_USER_AGENT },
            metadata: playerSource?.metadata,
          };
          if (typeof player?.replaceAsync === 'function') {
            player.replaceAsync(fallbackSource).then(() => {
              if (opId === null || opId === requestCounterRef.current) {
                if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
                  try { player?.play(); } catch (_e) {}
                }
              }
            }).catch((err) => {
              if (opId === null || opId === requestCounterRef.current) triggerErrorState(err);
            });
          } else {
            player?.replace(fallbackSource);
            if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
              try { player?.play(); } catch (_e) {}
            }
          }
          return;
        } catch (_e) {}
      }
    }

    triggerErrorState(err);
  }, [isLive, playerSource, triggerErrorState, type, player, engineMode, activeEngineType, switchEngine, setDebouncedBuffering]);

  // Confirm active playback and clear all buffering/loading indicators
  const confirmPlaybackActive = useCallback((opReqId = null) => {
    if (opReqId !== null && opReqId !== requestCounterRef.current) {
      return;
    }
    if (userPausedRef.current || playbackIntentRef.current === 'PAUSED') {
      return;
    }

    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    if (verifyPlaybackRef.current) clearTimeout(verifyPlaybackRef.current);
    hasEverPlayedRef.current = true;
    setHasFirstFrame(true);
    playerStateRef.current = 'PLAYING';
    setPlayerState('PLAYING');
    if (bufferTimerRef.current) {
      clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }
    setIsBufferingUI(false);
    setDebouncedBuffering(false);
  }, [setDebouncedBuffering]);

  // Unified auto-play initiation with verification watchdog
  const initiateAutoPlayback = useCallback((opReqId = null) => {
    const currentReqId = requestCounterRef.current;
    if (opReqId !== null && opReqId !== currentReqId) {
      return;
    }
    if (!player || playerStateRef.current === 'ERROR' || userPausedRef.current || playbackIntentRef.current === 'PAUSED' || isSeekingRef.current || isSeekingSettlingRef.current) {
      return;
    }

    timingRef.current.t7_play = Date.now();
    try {
      player.muted = Boolean(isMutedRef.current || volumeRef.current === 0);
      player.volume = (typeof volumeRef.current === 'number' && !isNaN(volumeRef.current)) ? volumeRef.current : 1.0;
      player.play();
    } catch (_e) {}

    if (player.playing) {
      confirmPlaybackActive(currentReqId);
    }

    if (verifyPlaybackRef.current) {
      clearTimeout(verifyPlaybackRef.current);
      verifyPlaybackRef.current = null;
    }
    verifyPlaybackRef.current = setTimeout(() => {
      if (
        currentReqId === requestCounterRef.current &&
        playbackIntentRef.current === 'PLAYING' &&
        !userPausedRef.current &&
        playerStateRef.current !== 'ERROR' &&
        player
      ) {
        if (player.status === 'readyToPlay' && !player.playing) {
          logPlayerDiagnostic('vodAutoPlayVerificationRetry', { reqId: currentReqId, status: player.status, platform: Platform.OS });
          try {
            player.muted = Boolean(isMutedRef.current || volumeRef.current === 0);
            player.volume = (typeof volumeRef.current === 'number' && !isNaN(volumeRef.current)) ? volumeRef.current : 1.0;
            player.play();
          } catch (_e) {}
          if (player.playing) {
            confirmPlaybackActive(currentReqId);
          }
        }
      }
    }, 200);
  }, [player, confirmPlaybackActive]);

  // Handle URL/source change with atomic state reset and race condition prevention
  useEffect(() => {
    if (!player) return;

    if (!validation.isValid || !playerSource) {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      if (currentUrlRef.current !== null) {
        currentUrlRef.current = null;
        try {
          player.pause();
          if (typeof player.replaceAsync === 'function') {
            player.replaceAsync(null);
          } else {
            player.replace(null);
          }
        } catch (_e) {}
      }
      playerStateRef.current = 'ERROR';
      setPlayerState('ERROR');
      const details = getErrorDisplayDetails(validation.error || 'Unable to play this stream.');
      setErrorDetails(details);
      setErrorMessage(details.message);
      setDebouncedBuffering(false);
      setIsBufferingUI(false);
      return;
    }

    const nextUri = validation.uri;
    if (nextUri === currentUrlRef.current && player.status !== 'idle') {
      if (playerStateRef.current === 'ERROR') {
        return;
      }
      if (hasEverPlayedRef.current) {
        return;
      }
    }
    currentUrlRef.current = nextUri;
    fallbackAttemptedRef.current = false;
    const reqId = ++requestCounterRef.current;
    lastToastedAttemptIdRef.current = null;

    hasEverPlayedRef.current = false;
    setHasFirstFrame(false);
    lastPlaybackTimeRef.current = -1;
    lastAdvanceTimeRef.current = Date.now();
    // Atomic reset of player state — instant blackout with loader
    playerStateRef.current = 'LOADING';
    setPlayerState('LOADING');
    setCurrentTime(0);
    setDuration(0);
    setErrorMessage(null);
    setErrorDetails(null);
    setAvailableAudioTracks([]);
    setSelectedAudioTrack(null);
    setAvailableSubtitleTracks([]);
    setSelectedSubtitleTrack(null);
    lastErrorRef.current = null;
    setShowToast(false);
    setToastMessage(null);
    userPausedRef.current = false;
    playbackIntentRef.current = 'PLAYING';
    pendingSeekTimeRef.current = null;
    if (bufferTimerRef.current) {
      clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }
    bufferStartRef.current = Date.now();
    setIsBufferingUI(true);
    timingRef.current.assigned = Date.now();

    // Connect watchdog: 12s configurable startup timeout with automatic VLC fallback
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    loadTimeoutRef.current = setTimeout(() => {
      if (reqId === requestCounterRef.current && (playerStateRef.current === 'LOADING' || playerStateRef.current === 'BUFFERING' || playerStateRef.current === 'RETRYING')) {
        logPlayerDiagnostic('playbackConnectSlow', {
          reqId,
          isLive,
          elapsedMs: 12000,
          platform: Platform.OS,
        });
        if (engineMode === ENGINE_MODE.AUTO && activeEngineType === ENGINE_TYPE.NATIVE && vlcAttemptsRef.current < 1) {
          logPlayerDiagnostic('startupTimeoutSwitchingToVLC', { reqId, platform: Platform.OS });
          switchEngine(ENGINE_TYPE.VLC, ENGINE_SWITCH_REASON.STARTUP_TIMEOUT);
        }
      }
    }, 12000);

    try {
      const now = Date.now();
      timingRef.current.t0_tap = selectedAt ? Number(selectedAt) : (timingRef.current.t0_tap || now);
      timingRef.current.t1_source = now;
      timingRef.current.t2_player = now;
      timingRef.current.t3_assigned = now;

      logPlayerDiagnostic('loadStarted', {
        url: nextUri,
        type,
        extension,
        platform: Platform.OS,
        contentType,
        reqId,
      });

      isReplacingSourceRef.current = true;
      if (typeof player.replaceAsync === 'function') {
        player.replaceAsync(playerSource).then(() => {
          isReplacingSourceRef.current = false;
          if (reqId === requestCounterRef.current && playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
            timingRef.current.t7_play = Date.now();
            try {
              player.muted = false;
              player.volume = volume || 1.0;
              player.play();
            } catch (_e) {}
            if (player.status === 'readyToPlay' || player.playing) {
              hasEverPlayedRef.current = true;
              setHasFirstFrame(true);
              playerStateRef.current = 'PLAYING';
              setPlayerState('PLAYING');
              if (bufferTimerRef.current) {
                clearTimeout(bufferTimerRef.current);
                bufferTimerRef.current = null;
              }
              setIsBufferingUI(false);
              setDebouncedBuffering(false);
            }
            initiateAutoPlayback(reqId);
          }
        }).catch((err) => {
          isReplacingSourceRef.current = false;
          if (reqId === requestCounterRef.current) {
            logPlayerDiagnostic('loadError', { error: err?.message, url: nextUri, reqId });
            handleFallbackOrError(err, nextUri, reqId);
          }
        });
      } else {
        player.replace(playerSource);
        isReplacingSourceRef.current = false;
        if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
          timingRef.current.t7_play = Date.now();
          try {
            player.muted = false;
            player.volume = volume || 1.0;
            player.play();
          } catch (_e) {}
          if (player.status === 'readyToPlay' || player.playing) {
            hasEverPlayedRef.current = true;
            setHasFirstFrame(true);
            playerStateRef.current = 'PLAYING';
            setPlayerState('PLAYING');
            if (bufferTimerRef.current) {
              clearTimeout(bufferTimerRef.current);
              bufferTimerRef.current = null;
            }
            setIsBufferingUI(false);
            setDebouncedBuffering(false);
          }
          initiateAutoPlayback(reqId);
        }
      }
    } catch (err) {
      isReplacingSourceRef.current = false;
      if (reqId === requestCounterRef.current) {
        logPlayerDiagnostic('loadError', { error: err?.message, url: nextUri, reqId });
        handleFallbackOrError(err, nextUri, reqId);
      }
    }
  }, [validation, playerSource, isLive, player, triggerErrorState, setDebouncedBuffering, type, extension, handleFallbackOrError, contentType, initiateAutoPlayback, confirmPlaybackActive]);

  // Clean teardown on unmount
  useEffect(() => {
    return () => {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      if (verifyPlaybackRef.current) clearTimeout(verifyPlaybackRef.current);
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
      if (seekWatchdogRef.current) clearTimeout(seekWatchdogRef.current);
      try { player?.pause(); } catch (_e) {}
    };
  }, [player]);

  // Safely stop and tear down playback if active playlist becomes expired during playback
  useEffect(() => {
    if (isExpired) {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
      if (seekWatchdogRef.current) clearTimeout(seekWatchdogRef.current);
      try {
        player?.pause();
        if (typeof player?.replaceAsync === 'function') {
          player.replaceAsync(null);
        } else {
          player?.replace(null);
        }
      } catch (_e) {}
      setPlayerState('ERROR');
      setErrorDetails({
        heading: 'Unable to Play Video',
        message: 'Playlist subscription has expired. Please renew or switch playlist.',
        explanation: 'Your subscription for this playlist is no longer active.',
        canRetry: false,
      });
      setErrorMessage('Playlist subscription has expired. Please renew or switch playlist.');
      setDebouncedBuffering(false);
    }
  }, [isExpired, player, setDebouncedBuffering]);

  // Track status and playback events (attached once per player instance)
  useEffect(() => {
    if (!player) return;

    const subStatus = player.addListener('statusChange', ({ status, error }) => {
      logPlayerDiagnostic('statusChange', { status, error: error?.message });

      // Guard: if already in fatal error for current stream, ignore status updates
      if (playerStateRef.current === 'ERROR') {
        return;
      }

      if (status === 'error' || (status === 'idle' && error)) {
        if (verifyPlaybackRef.current) clearTimeout(verifyPlaybackRef.current);
        if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
        if (player.playing && hasEverPlayedRef.current) {
          // Player is actually playing; ignore non-fatal track warning
          return;
        }
        handleFallbackOrError(error || new Error('Video playback error occurred'), currentUrlRef.current, requestCounterRef.current);
      } else if (
        status === 'idle' &&
        !userPausedRef.current &&
        playbackIntentRef.current === 'PLAYING' &&
        !isReplacingSourceRef.current &&
        currentUrlRef.current
      ) {
        // Player transitioned to idle during stream load; log diagnostic and avoid terminal error
        logPlayerDiagnostic('playerIdleTransition', { url: currentUrlRef.current, reqId: requestCounterRef.current, type });
      } else if (status === 'readyToPlay') {
        if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
        timingRef.current.ready = Date.now();
        timingRef.current.t5_ready = Date.now();
        if (!isLive && player.duration && isFinite(player.duration) && !isNaN(player.duration) && player.duration > 0) {
          durationRef.current = player.duration;
          setDuration(player.duration);
        }

        if (playbackIntentRef.current === 'PAUSED' || userPausedRef.current) {
          playerStateRef.current = 'PAUSED';
          setPlayerState('PAUSED');
          if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
          setIsBufferingUI(false);
        } else if (player.playing) {
          playerStateRef.current = 'PLAYING';
          setPlayerState('PLAYING');
          confirmPlaybackActive(requestCounterRef.current);
        } else if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
          timingRef.current.t7_play = Date.now();
          try {
            player.muted = false;
            player.volume = volume || 1.0;
            player.play();
          } catch (_e) {}
          hasEverPlayedRef.current = true;
          setHasFirstFrame(true);
          playerStateRef.current = 'PLAYING';
          setPlayerState('PLAYING');
          if (bufferTimerRef.current) {
            clearTimeout(bufferTimerRef.current);
            bufferTimerRef.current = null;
          }
          setIsBufferingUI(false);
          setDebouncedBuffering(false);
          try {
            if (player?.availableAudioTracks?.length) setAvailableAudioTracks(player.availableAudioTracks);
            if (player?.availableSubtitleTracks?.length) setAvailableSubtitleTracks(player.availableSubtitleTracks);
            setSelectedAudioTrack(player?.audioTrack || null);
            setSelectedSubtitleTrack(player?.subtitleTrack || null);
          } catch (_e) {}
          initiateAutoPlayback(requestCounterRef.current);
        }
      } else if (status === 'loading') {
        timingRef.current.t4_loading = Date.now();
        if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
          if (player.playing && hasEverPlayedRef.current) return;
          const nextState = hasEverPlayedRef.current ? 'BUFFERING' : 'LOADING';
          playerStateRef.current = nextState;
          setPlayerState(nextState);
          setDebouncedBuffering(true);
        }
      }
    });

    const subPlaying = player.addListener('playingChange', ({ isPlaying }) => {
      logPlayerDiagnostic('playingChange', { isPlaying });

      // Guard: if already in fatal error for current stream, ignore playing changes
      if (playerStateRef.current === 'ERROR') {
        return;
      }

      if (isPlaying) {
        if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
        setErrorMessage(null);
        lastErrorRef.current = null;
        setShowToast(false);
        setToastMessage(null);

        if (userPausedRef.current || playbackIntentRef.current === 'PAUSED') {
          try { player.pause(); } catch (_e) {}
          return;
        }

        confirmPlaybackActive(requestCounterRef.current);

        const now = Date.now();
        if (!timingRef.current.firstPlay && timingRef.current.assigned) {
          timingRef.current.firstPlay = now;
          timingRef.current.t6_firstFrame = now;
          timingRef.current.t8_playing = now;
          const elapsed = now - timingRef.current.assigned;
          const t0_to_t3 = timingRef.current.t3_assigned ? (timingRef.current.t3_assigned - timingRef.current.t0_tap) : 0;
          const t3_to_t5 = (timingRef.current.t5_ready && timingRef.current.t3_assigned) ? (timingRef.current.t5_ready - timingRef.current.t3_assigned) : 0;
          const t5_to_t6 = (timingRef.current.t6_firstFrame && timingRef.current.t5_ready) ? (timingRef.current.t6_firstFrame - timingRef.current.t5_ready) : 0;

          logPlayerDiagnostic('vodTimelineMilestones', {
            startupMs: elapsed,
            t0_to_t3_ms: t0_to_t3,
            t3_to_t5_readyMs: t3_to_t5,
            t5_to_t6_firstFrameMs: t5_to_t6,
            type,
            platform: Platform.OS,
          });
        }
      } else if (playerStateRef.current !== 'ERROR') {
        if (playbackIntentRef.current === 'PAUSED' || userPausedRef.current) {
          playerStateRef.current = 'PAUSED';
          setPlayerState('PAUSED');
          if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
          setIsBufferingUI(false);
        } else if (player?.status === 'readyToPlay') {
          if (!isSeekingRef.current && !isSeekingSettlingRef.current) {
            initiateAutoPlayback(requestCounterRef.current);
          }
        } else {
          const nextState = hasEverPlayedRef.current ? 'BUFFERING' : 'LOADING';
          playerStateRef.current = nextState;
          setPlayerState(nextState);
          if (hasEverPlayedRef.current) {
            setDebouncedBuffering(true);
          } else {
            setIsBufferingUI(true);
          }
        }
      }
    });

    const subSourceLoad = player.addListener?.('sourceLoad', (payload) => {
      timingRef.current.sourceLoaded = Date.now();
      const loadElapsed = timingRef.current.sourceLoaded - (timingRef.current.assigned || timingRef.current.sourceLoaded);
      logPlayerDiagnostic('sourceLoad', { loadTimeMs: loadElapsed, type, platform: Platform.OS });
      try {
        if (payload?.availableAudioTracks) {
          setAvailableAudioTracks(payload.availableAudioTracks);
        } else if (player?.availableAudioTracks) {
          setAvailableAudioTracks(player.availableAudioTracks);
        }
        if (payload?.availableSubtitleTracks) {
          setAvailableSubtitleTracks(payload.availableSubtitleTracks);
        } else if (player?.availableSubtitleTracks) {
          setAvailableSubtitleTracks(player.availableSubtitleTracks);
        }
        setSelectedAudioTrack(player?.audioTrack || null);
        setSelectedSubtitleTrack(player?.subtitleTrack || null);
      } catch (_e) {}
    });

    const subAudioTracks = player.addListener?.('availableAudioTracksChange', ({ availableAudioTracks: tracks }) => {
      logPlayerDiagnostic('availableAudioTracksChange', { count: tracks?.length || 0 });
      setAvailableAudioTracks(Array.isArray(tracks) ? tracks : []);
    });

    const subAudioTrackChange = player.addListener?.('audioTrackChange', ({ audioTrack: track }) => {
      logPlayerDiagnostic('audioTrackChange', { label: track?.label, lang: track?.language });
      setSelectedAudioTrack(track || null);
    });

    const subSubtitleTracks = player.addListener?.('availableSubtitleTracksChange', ({ availableSubtitleTracks: tracks }) => {
      logPlayerDiagnostic('availableSubtitleTracksChange', { count: tracks?.length || 0 });
      setAvailableSubtitleTracks(Array.isArray(tracks) ? tracks : []);
    });

    const subSubtitleTrackChange = player.addListener?.('subtitleTrackChange', ({ subtitleTrack: track }) => {
      logPlayerDiagnostic('subtitleTrackChange', { label: track?.label, lang: track?.language });
      setSelectedSubtitleTrack(track || null);
    });

    const subError = player.addListener?.('error', (err) => {
      if (verifyPlaybackRef.current) clearTimeout(verifyPlaybackRef.current);
      if (playerStateRef.current === 'ERROR') return;
      logPlayerDiagnostic('playerError', { error: err?.error?.message || err?.message });
      handleFallbackOrError(err?.error || err, currentUrlRef.current, requestCounterRef.current);
    });

    const subPlaybackError = player.addListener?.('playbackError', (err) => {
      if (verifyPlaybackRef.current) clearTimeout(verifyPlaybackRef.current);
      if (playerStateRef.current === 'ERROR') return;
      logPlayerDiagnostic('playbackErrorEvent', { error: err?.error?.message || err?.message });
      handleFallbackOrError(err?.error || err, currentUrlRef.current, requestCounterRef.current);
    });

    const subTime = player.addListener('timeUpdate', ({ currentTime: curr }) => {
      // 1. If user is dragging seekbar thumb, do not update UI from native ticks
      if (isSeekingRef.current) return;

      // 2. Guard against fatal error
      if (playerStateRef.current === 'ERROR') return;

      const safeCurr = Math.max(0, curr || 0);

      // 3. Stale event suppression during seeking & seek completion convergence
      if (isSeekingSettlingRef.current && seekTargetTimeRef.current !== null) {
        const target = seekTargetTimeRef.current;
        const hasReachedTarget = Math.abs(safeCurr - target) <= 0.6 || (target > 0 && safeCurr >= target - 0.2);
        if (hasReachedTarget) {
          if (completeSeekRef.current) {
            completeSeekRef.current(seekCounterRef.current, safeCurr);
          }
        } else {
          // Stale tick before seek completion — suppress so thumb doesn't jump back
          return;
        }
      }

      // 4. Guard against updating when intentionally paused and not seeking
      if (userPausedRef.current || playbackIntentRef.current === 'PAUSED') return;

      // 4. Glitch protection against transient CMTimeZero from AVPlayer
      if (safeCurr === 0 && lastPlaybackTimeRef.current > 1.5 && hasEverPlayedRef.current) {
        return;
      }

      // 5. Update UI position
      setCurrentTime(safeCurr);

      // 6. Synchronize duration if valid
      if (!isLive && player.duration && isFinite(player.duration) && !isNaN(player.duration) && player.duration > 0 && Math.abs(player.duration - durationRef.current) > 0.5) {
        durationRef.current = player.duration;
        setDuration(player.duration);
      }

      // 7. Track advancement vs stall
      const prev = lastPlaybackTimeRef.current;
      const isAdvancing = prev >= 0 ? (safeCurr - prev > 0.03 || (safeCurr > 0.05 && prev === 0)) : (safeCurr > 0.05);
      const now = Date.now();

      if (isAdvancing) {
        lastPlaybackTimeRef.current = safeCurr;
        lastAdvanceTimeRef.current = now;
      } else if (prev < 0) {
        lastPlaybackTimeRef.current = safeCurr;
        lastAdvanceTimeRef.current = now;
      }

      // If native player is currently in 'loading' status and NOT playing, it is actively buffering
      if (player?.status === 'loading' && !player?.playing) {
        if (hasEverPlayedRef.current && playerStateRef.current !== 'BUFFERING') {
          playerStateRef.current = 'BUFFERING';
          setPlayerState('BUFFERING');
          setDebouncedBuffering(true);
        }
        return;
      }

      // If native player is not playing, do not mark as playing
      if (player && typeof player.playing === 'boolean' && !player.playing) {
        if (player.status === 'readyToPlay' && playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
          initiateAutoPlayback(requestCounterRef.current);
        }
        return;
      }

      if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
        if (!hasEverPlayedRef.current) {
          if (isAdvancing || safeCurr > 0.05 || player?.playing) {
            confirmPlaybackActive(requestCounterRef.current);
          }
        } else {
          if (isAdvancing && playerStateRef.current !== 'PLAYING') {
            confirmPlaybackActive(requestCounterRef.current);
          } else if (!isAdvancing && playerStateRef.current === 'PLAYING' && lastAdvanceTimeRef.current > 0 && (now - lastAdvanceTimeRef.current > 1400)) {
            // Mid-stream stall detected: time has ceased progressing for > 1.4s
            playerStateRef.current = 'BUFFERING';
            setPlayerState('BUFFERING');
            setDebouncedBuffering(true);
          } else if (!isAdvancing && playerStateRef.current === 'BUFFERING' && lastAdvanceTimeRef.current > 0 && (now - lastAdvanceTimeRef.current > 14000)) {
            // Persistent mid-stream stall exceeding 14s — remain buffering without triggering false terminal error
            logPlayerDiagnostic('midStreamBufferingProlonged', { elapsedStallMs: now - lastAdvanceTimeRef.current, url: currentUrlRef.current, type });
          }
        }
      }
    });

    const subPlayToEnd = player.addListener?.('playToEnd', () => {
      logPlayerDiagnostic('playToEnd', { type, duration: durationRef.current });
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      if (verifyPlaybackRef.current) clearTimeout(verifyPlaybackRef.current);
      hasEndedRef.current = true;
      playbackIntentRef.current = 'PAUSED';
      userPausedRef.current = true;
      playerStateRef.current = 'PAUSED';
      setPlayerState('PAUSED');
      if (durationRef.current > 0) {
        setCurrentTime(durationRef.current);
      }
      if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
      setIsBufferingUI(false);
      setControlsVisible(true);
      controlsOpacityRef.current.setValue(1);
    });

    // Immediate auto-play check: if player is ALREADY in readyToPlay status when listener attaches
    if (
      player?.status === 'readyToPlay' &&
      playbackIntentRef.current === 'PLAYING' &&
      !userPausedRef.current &&
      playerStateRef.current !== 'ERROR'
    ) {
      try {
        player.muted = false;
        player.volume = volume || 1.0;
        player.play();
      } catch (_e) {}
      hasEverPlayedRef.current = true;
      setHasFirstFrame(true);
      playerStateRef.current = 'PLAYING';
      setPlayerState('PLAYING');
      if (bufferTimerRef.current) {
        clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = null;
      }
      setIsBufferingUI(false);
      setDebouncedBuffering(false);
      initiateAutoPlayback(requestCounterRef.current);
    }

    return () => {
      subStatus?.remove();
      subPlaying?.remove();
      subSourceLoad?.remove?.();
      subAudioTracks?.remove?.();
      subAudioTrackChange?.remove?.();
      subSubtitleTracks?.remove?.();
      subSubtitleTrackChange?.remove?.();
      subError?.remove?.();
      subPlaybackError?.remove?.();
      subTime?.remove();
      subPlayToEnd?.remove?.();
    };
  }, [player, triggerErrorState, setDebouncedBuffering, type, handleFallbackOrError, isLive, initiateAutoPlayback, confirmPlaybackActive]);

  // Track status and playback events for VLC engine
  useEffect(() => {
    if (!vlcPlayer) return;

    const subs = [];

    if (typeof vlcPlayer.addOnStatusChangeListener === 'function') {
      const sub = vlcPlayer.addOnStatusChangeListener((status) => {
        if (activeEngineType !== ENGINE_TYPE.VLC) return;
        logPlayerDiagnostic('vlcStatusChange', { status });
        if (status === 'playing') {
          confirmPlaybackActive(requestCounterRef.current);
          setErrorMessage(null);
          setShowToast(false);
        } else if (status === 'buffering' || status === 'loading') {
          setDebouncedBuffering(true);
        } else if (status === 'paused') {
          playerStateRef.current = 'PAUSED';
          setPlayerState('PAUSED');
        } else if (status === 'stopped' || status === 'ended') {
          if (!userPausedRef.current && playerStateRef.current === 'PLAYING') {
            playerStateRef.current = 'PAUSED';
            setPlayerState('PAUSED');
          }
        }
      });
      if (sub?.remove) subs.push(() => sub.remove());
    }

    if (typeof vlcPlayer.addOnTimeUpdateListener === 'function') {
      const sub = vlcPlayer.addOnTimeUpdateListener((event) => {
        if (activeEngineType !== ENGINE_TYPE.VLC) return;
        const curSec = (event.currentTime || 0) / 1000;
        const durSec = (event.duration || 0) / 1000;
        if (curSec > 0 && !hasEverPlayedRef.current) {
          confirmPlaybackActive(requestCounterRef.current);
        }
        if (!isSeekingRef.current) {
          setCurrentTime(curSec);
        }
        if (!isLive && durSec > 0) {
          setDuration(durSec);
        }
      });
      if (sub?.remove) subs.push(() => sub.remove());
    }

    if (typeof vlcPlayer.addOnTracksChangeListener === 'function') {
      const sub = vlcPlayer.addOnTracksChangeListener((tracks) => {
        if (activeEngineType !== ENGINE_TYPE.VLC) return;
        if (tracks?.audioTracks) setAvailableAudioTracks(tracks.audioTracks);
        if (tracks?.subtitleTracks) setAvailableSubtitleTracks(tracks.subtitleTracks);
        if (tracks?.selectedAudioTrack) setSelectedAudioTrack(tracks.selectedAudioTrack);
        if (tracks?.selectedSubtitleTrack) setSelectedSubtitleTrack(tracks.selectedSubtitleTrack);
      });
      if (sub?.remove) subs.push(() => sub.remove());
    }

    if (typeof vlcPlayer.addOnErrorListener === 'function') {
      const sub = vlcPlayer.addOnErrorListener((err) => {
        if (activeEngineType !== ENGINE_TYPE.VLC) return;
        logPlayerDiagnostic('vlcPlaybackError', { error: err });
        triggerErrorState(new Error(err?.message || 'VLC engine playback failed. Both engines failed.'));
      });
      if (sub?.remove) subs.push(() => sub.remove());
    }

    return () => {
      subs.forEach((unsub) => {
        try { unsub(); } catch (_e) {}
      });
    };
  }, [vlcPlayer, activeEngineType, confirmPlaybackActive, setDebouncedBuffering, isLive, triggerErrorState]);

  const handleSelectAudioTrack = useCallback((track) => {
    if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
      try {
        if (typeof vlcPlayer.selectAudioTrack === 'function') {
          vlcPlayer.selectAudioTrack(track?.id ?? track);
        }
        setSelectedAudioTrack(track);
      } catch (err) {}
      return;
    }
    if (!player) return;
    try {
      player.audioTrack = track;
      setSelectedAudioTrack(track);
      logPlayerDiagnostic('selectAudioTrack', { label: track?.label, language: track?.language, id: track?.id });
    } catch (err) {
      logPlayerDiagnostic('selectAudioTrackError', { error: err?.message });
    }
  }, [player, activeEngineType, vlcPlayer]);

  const handleSelectSubtitleTrack = useCallback((track) => {
    if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
      try {
        if (typeof vlcPlayer.selectSubtitleTrack === 'function') {
          vlcPlayer.selectSubtitleTrack(track?.id ?? track);
        }
        setSelectedSubtitleTrack(track);
      } catch (err) {}
      return;
    }
    if (!player) return;
    try {
      player.subtitleTrack = track;
      setSelectedSubtitleTrack(track);
      logPlayerDiagnostic('selectSubtitleTrack', { label: track?.label, language: track?.language, id: track?.id });
    } catch (err) {
      logPlayerDiagnostic('selectSubtitleTrackError', { error: err?.message });
    }
  }, [player, activeEngineType, vlcPlayer]);

  const isGestureActiveRef = useRef(false);
  const controlsVisibleRef = useRef(controlsVisible);
  useEffect(() => {
    controlsVisibleRef.current = controlsVisible;
  }, [controlsVisible]);

  const cancelAutoHideTimer = useCallback(() => {
    if (controlsTimeout.current) {
      clearTimeout(controlsTimeout.current);
      controlsTimeout.current = null;
    }
  }, []);

  const hideControlsUI = useCallback(() => {
    if (isSeekingRef.current || isGestureActiveRef.current || playerStateRef.current === 'PAUSED') {
      return;
    }
    cancelAutoHideTimer();
    controlsVisibleRef.current = false;
    setControlsVisible(false);
    controlsOpacityRef.current.stopAnimation();
    Animated.timing(controlsOpacityRef.current, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [cancelAutoHideTimer]);

  // Auto-hide timer (~3.0 s of inactivity during playback)
  const resetHideTimer = useCallback(() => {
    cancelAutoHideTimer();
    if (
      playerStateRef.current === 'PLAYING' &&
      controlsVisibleRef.current &&
      !isSeekingRef.current &&
      !isGestureActiveRef.current
    ) {
      controlsTimeout.current = setTimeout(() => {
        hideControlsUI();
      }, 3000);
    }
  }, [cancelAutoHideTimer, hideControlsUI]);

  const showControlsUI = useCallback(() => {
    controlsVisibleRef.current = true;
    setControlsVisible(true);
    controlsOpacityRef.current.stopAnimation();
    Animated.timing(controlsOpacityRef.current, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
    resetHideTimer();
  }, [resetHideTimer]);

  const toggleControls = useCallback(() => {
    if (controlsVisibleRef.current) {
      hideControlsUI();
    } else {
      showControlsUI();
    }
  }, [hideControlsUI, showControlsUI]);

  const handleGestureStart = useCallback(() => {
    isGestureActiveRef.current = true;
    cancelAutoHideTimer();
    if (typeof notifyGestureStart === 'function') {
      notifyGestureStart();
    }
  }, [cancelAutoHideTimer, notifyGestureStart]);

  const handleGestureEnd = useCallback(() => {
    isGestureActiveRef.current = false;
    if (typeof notifyGestureEnd === 'function') {
      notifyGestureEnd();
    }
    if (controlsVisibleRef.current && playerStateRef.current === 'PLAYING') {
      resetHideTimer();
    }
  }, [resetHideTimer, notifyGestureEnd]);

  // Ensure controls are immediately visible upon mounting or source change
  useEffect(() => {
    cancelAutoHideTimer();
    controlsVisibleRef.current = true;
    setControlsVisible(true);
    controlsOpacityRef.current.stopAnimation();
    controlsOpacityRef.current.setValue(1);
  }, [url, cancelAutoHideTimer]);

  useEffect(() => {
    if (playerState === 'PAUSED') {
      cancelAutoHideTimer();
      controlsVisibleRef.current = true;
      setControlsVisible(true);
      controlsOpacityRef.current.stopAnimation();
      Animated.timing(controlsOpacityRef.current, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
    } else if (playerState === 'LOADING' || playerState === 'BUFFERING' || playerState === 'RETRYING') {
      cancelAutoHideTimer();
      controlsVisibleRef.current = true;
      setControlsVisible(true);
      controlsOpacityRef.current.stopAnimation();
      controlsOpacityRef.current.setValue(1);
    } else if (playerState === 'PLAYING') {
      if (controlsVisibleRef.current) {
        resetHideTimer();
      }
    }
    return () => {
      cancelAutoHideTimer();
    };
  }, [playerState, cancelAutoHideTimer, resetHideTimer]);

  const triggerSeekFeedback = useCallback((text) => {
    setSeekFeedback((prev) => ({ text, key: (prev?.key || 0) + 1 }));
    // Only mutate inside callback (event-handler context) — not during render
    seekFeedbackAnimRef.current.setValue(0);
    Animated.sequence([
      Animated.timing(seekFeedbackAnimRef.current, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(400),
      Animated.timing(seekFeedbackAnimRef.current, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setSeekFeedback(null));
  }, []);

  const completeSeek = useCallback((opId, actualTime) => {
    if (opId !== seekCounterRef.current) return;
    if (!isSeekingSettlingRef.current && !isSeekingRef.current) return;

    isSeekingSettlingRef.current = false;
    isSeekingRef.current = false;
    pendingSeekTimeRef.current = null;
    seekTargetTimeRef.current = null;
    if (seekWatchdogRef.current) {
      clearTimeout(seekWatchdogRef.current);
      seekWatchdogRef.current = null;
    }

    logPlayerDiagnostic('seekSettled', {
      seekOpId: opId,
      actualTime,
      wasPlaying: wasPlayingBeforeSeekRef.current,
      userPaused: userPausedRef.current,
    });

    if (wasPlayingBeforeSeekRef.current && !userPausedRef.current && playerStateRef.current !== 'ERROR') {
      playerStateRef.current = 'PLAYING';
      setPlayerState('PLAYING');
      playbackIntentRef.current = 'PLAYING';
      try {
        player.play();
      } catch (_e) {}
      if (bufferTimerRef.current) {
        clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = null;
      }
      setIsBufferingUI(false);
      setDebouncedBuffering(false);
      confirmPlaybackActive(requestCounterRef.current);
    } else {
      playerStateRef.current = 'PAUSED';
      setPlayerState('PAUSED');
      playbackIntentRef.current = 'PAUSED';
      try {
        player.pause();
      } catch (_e) {}
      if (bufferTimerRef.current) {
        clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = null;
      }
      setIsBufferingUI(false);
      setDebouncedBuffering(false);
    }
  }, [player, confirmPlaybackActive, setDebouncedBuffering]);
  completeSeekRef.current = completeSeek;

  const executeSeek = useCallback((targetTime, source = 'scrubber') => {
    if (!player || type === 'live') return;
    try {
      hasEndedRef.current = false;
      const dur = duration || player.duration || 0;
      let safeTime = Math.max(0, targetTime);
      if (dur > 1 && safeTime >= dur - 0.05) {
        safeTime = Math.max(0, dur - 0.15);
      }
      if (dur > 0) {
        safeTime = Math.min(dur, safeTime);
      }

      // Record playback intent before seek started (only on initial seek action)
      if (!isSeekingRef.current && !isSeekingSettlingRef.current) {
        const wasPlaying = (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) || Boolean(player.playing);
        wasPlayingBeforeSeekRef.current = wasPlaying;
      }

      if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
        try {
          if (typeof vlcPlayer.seekTo === 'function') {
            vlcPlayer.seekTo(safeTime * 1000);
          } else if (typeof vlcPlayer.setTime === 'function') {
            vlcPlayer.setTime(safeTime * 1000);
          }
        } catch (_e) {}
        setCurrentTime(safeTime);
        return;
      }

      // 1. Immediately pause native player so old video/audio NEVER continues playing
      try {
        player.pause();
      } catch (_e) {}

      const seekOpId = ++seekCounterRef.current;
      seekTargetTimeRef.current = safeTime;
      isSeekingSettlingRef.current = true;
      pendingSeekTimeRef.current = safeTime;

      logPlayerDiagnostic('seekRequested', {
        seekOpId,
        targetTime: safeTime,
        source,
        wasPlaying: wasPlayingBeforeSeekRef.current,
        platform: Platform.OS,
      });

      if (seekWatchdogRef.current) {
        clearTimeout(seekWatchdogRef.current);
        seekWatchdogRef.current = null;
      }

      setCurrentTime(safeTime);
      lastPlaybackTimeRef.current = safeTime;
      lastAdvanceTimeRef.current = Date.now();

      // Enter buffering state immediately: shows buffering indicator and hides Play/Pause
      playerStateRef.current = 'BUFFERING';
      setPlayerState('BUFFERING');
      setDebouncedBuffering(true);
      setIsBufferingUI(true);

      // Apply the seek to native player
      player.currentTime = safeTime;

      // Watchdog timeout fallback to settle seek if native position reporting is delayed
      seekWatchdogRef.current = setTimeout(() => {
        if (seekOpId === seekCounterRef.current && (isSeekingSettlingRef.current || isSeekingRef.current)) {
          logPlayerDiagnostic('seekSettledTimeout', { seekOpId, targetTime: safeTime });
          completeSeek(seekOpId, safeTime);
        }
      }, 1600);
    } catch (_e) {}
  }, [player, duration, type, setDebouncedBuffering, completeSeek]);

  const handleSeek = useCallback((targetTime) => {
    executeSeek(targetTime, 'scrubber');
  }, [executeSeek]);

  const handleSeekingChange = useCallback((seeking) => {
    if (seeking) {
      if (!isSeekingRef.current && !isSeekingSettlingRef.current) {
        const wasPlaying = (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) || Boolean(player?.playing);
        wasPlayingBeforeSeekRef.current = wasPlaying;
      }
      isSeekingRef.current = true;
      try {
        player?.pause();
      } catch (_e) {}
      playerStateRef.current = 'BUFFERING';
      setPlayerState('BUFFERING');
      setDebouncedBuffering(true);
      setIsBufferingUI(true);
      cancelAutoHideTimer();
    } else {
      isSeekingRef.current = false;
      resetHideTimer();
    }
  }, [player, cancelAutoHideTimer, resetHideTimer, setDebouncedBuffering]);

  const handleRewind = useCallback(() => {
    if (!player || type === 'live') return;
    try {
      const cur = isSeekingSettlingRef.current && seekTargetTimeRef.current !== null
        ? seekTargetTimeRef.current
        : (typeof player.currentTime === 'number' ? player.currentTime : (currentTimeRef.current || 0));
      const target = Math.max(0, cur - 10);
      executeSeek(target, 'rewind');
      triggerSeekFeedback('↶ 10s');
      showControlsUI();
    } catch (_e) {}
  }, [player, type, executeSeek, showControlsUI, triggerSeekFeedback]);

  const handleForward = useCallback(() => {
    if (!player || type === 'live') return;
    try {
      const cur = isSeekingSettlingRef.current && seekTargetTimeRef.current !== null
        ? seekTargetTimeRef.current
        : (typeof player.currentTime === 'number' ? player.currentTime : (currentTimeRef.current || 0));
      const dur = duration || player.duration || 0;
      const target = dur > 0 ? Math.min(dur, cur + 10) : cur + 10;
      executeSeek(target, 'forward');
      triggerSeekFeedback('10s ↷');
      showControlsUI();
    } catch (_e) {}
  }, [player, duration, type, executeSeek, showControlsUI, triggerSeekFeedback]);

  const handleTouchZone = (side) => {
    const now  = Date.now();
    const last = lastTapRef.current;
    if (now - last.time < 320 && last.side === side) {
      if (side === 'left') {
        handleRewind();
      } else {
        handleForward();
      }
      lastTapRef.current = { time: 0, side: null };
    } else {
      lastTapRef.current = { time: now, side };
      toggleControls();
    }
  };

  const handleRetry = useCallback(() => {
    if (isRetryingRef.current) return;
    isRetryingRef.current = true;
    setTimeout(() => { isRetryingRef.current = false; }, 1200);

    fallbackAttemptedRef.current = false;
    hasEverPlayedRef.current = false;
    hasEndedRef.current = false;
    setHasFirstFrame(false);
    lastPlaybackTimeRef.current = -1;
    lastAdvanceTimeRef.current = Date.now();
    currentUrlRef.current = url;
    const reqId = ++requestCounterRef.current;
    lastToastedAttemptIdRef.current = null;
    playerStateRef.current = 'LOADING';
    setPlayerState('LOADING');
    setErrorMessage(null);
    setErrorDetails(null);
    lastErrorRef.current = null;
    setShowToast(false);
    setToastMessage(null);
    userPausedRef.current = false;
    playbackIntentRef.current = 'PLAYING';
    if (bufferTimerRef.current) {
      clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }
    bufferStartRef.current = Date.now();
    setIsBufferingUI(true);
    setDebouncedBuffering(true);
    timingRef.current.assigned = Date.now();

    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    loadTimeoutRef.current = setTimeout(() => {
      if (reqId === requestCounterRef.current && (playerStateRef.current === 'LOADING' || playerStateRef.current === 'BUFFERING' || playerStateRef.current === 'RETRYING')) {
        logPlayerDiagnostic('retryConnectSlow', {
          reqId,
          platform: Platform.OS,
          decisionReason: 'Suppressed: slow retry kept in LOADING/BUFFERING state without fatal popup',
        });
      }
    }, isLive ? 25000 : 30000);

    try {
      if (player && url) {
        if (typeof player.replaceAsync === 'function') {
          player.replaceAsync(playerSource || url).then(() => {
            if (reqId === requestCounterRef.current && playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
              try { player.play(); } catch (_e) {}
            }
          }).catch((err) => {
            if (reqId === requestCounterRef.current) {
              triggerErrorState(err);
            }
          });
        } else {
          player.replace(playerSource || url);
          if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
            try { player.play(); } catch (_e) {}
          }
        }
      }
    } catch (err) {
      triggerErrorState(err);
    }
  }, [player, url, playerSource, triggerErrorState, isLive, handleFallbackOrError, setDebouncedBuffering]);

  const handleBack = useCallback(() => {
    userPausedRef.current = true;
    playbackIntentRef.current = 'PAUSED';
    try { player?.pause(); } catch (_e) {}
    try { vlcPlayer?.pause(); vlcPlayer?.stop(); } catch (_e) {}
    safeBack(router);
  }, [router, player, vlcPlayer]);

  const togglePlay = useCallback(() => {
    if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
      if (isTogglingPlayRef.current) return;
      isTogglingPlayRef.current = true;
      setTimeout(() => { isTogglingPlayRef.current = false; }, 250);

      const isCurrentlyPlaying = playerState === 'PLAYING';
      if (isCurrentlyPlaying) {
        userPausedRef.current = true;
        playbackIntentRef.current = 'PAUSED';
        try { vlcPlayer.pause(); } catch (_e) {}
        playerStateRef.current = 'PAUSED';
        setPlayerState('PAUSED');
      } else {
        userPausedRef.current = false;
        playbackIntentRef.current = 'PLAYING';
        try { vlcPlayer.play(); } catch (_e) {}
        playerStateRef.current = 'PLAYING';
        setPlayerState('PLAYING');
      }
      resetHideTimer();
      return;
    }

    if (!player) return;
    if (isTogglingPlayRef.current) return;
    isTogglingPlayRef.current = true;
    setTimeout(() => { isTogglingPlayRef.current = false; }, 250);

    if (hasEndedRef.current) {
      hasEndedRef.current = false;
      userPausedRef.current = false;
      playbackIntentRef.current = 'PLAYING';
      lastAdvanceTimeRef.current = Date.now();
      try {
        player.currentTime = 0;
        player.play();
      } catch (_e) {}
      setCurrentTime(0);
      playerStateRef.current = 'PLAYING';
      setPlayerState('PLAYING');
      if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
      setIsBufferingUI(false);
      resetHideTimer();
      return;
    }

    const shouldPause = (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) || (typeof player.playing === 'boolean' ? player.playing : false) || playerState === 'PLAYING';

    if (shouldPause) {
      userPausedRef.current = true;
      playbackIntentRef.current = 'PAUSED';
      try { player.pause(); } catch (_e) {}
      playerStateRef.current = 'PAUSED';
      setPlayerState('PAUSED');
      if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
      setIsBufferingUI(false);
    } else {
      userPausedRef.current = false;
      playbackIntentRef.current = 'PLAYING';
      lastAdvanceTimeRef.current = Date.now();
      try { player.play(); } catch (_e) {}
      if (player.status === 'readyToPlay' && player.playing) {
        playerStateRef.current = 'PLAYING';
        setPlayerState('PLAYING');
        if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
        setIsBufferingUI(false);
      } else {
        const nextState = hasEverPlayedRef.current ? 'BUFFERING' : 'LOADING';
        playerStateRef.current = nextState;
        setPlayerState(nextState);
        setDebouncedBuffering(true);
      }
      resetHideTimer();
    }
  }, [player, playerState, setDebouncedBuffering, resetHideTimer]);

  const toggleMute = useCallback(() => {
    toggleVolumeMute();
    showControlsUI();
  }, [toggleVolumeMute, showControlsUI]);

  const cycleFitMode = useCallback(() => {
    setContentFit((prev) => {
      const idx = FIT_MODES.indexOf(prev);
      return FIT_MODES[(idx + 1) % FIT_MODES.length];
    });
    showControlsUI();
  }, [showControlsUI]);

  const cycleSpeed = useCallback(() => {
    const nextIdx   = (playbackSpeedIndex + 1) % SPEEDS.length;
    const nextSpeed = SPEEDS[nextIdx];
    setPlaybackSpeedIndex(nextIdx);
    try { if (player) player.playbackRate = nextSpeed; } catch (_e) {}
    showControlsUI();
  }, [playbackSpeedIndex, player, showControlsUI]);

  const handleFirstFrameRender = useCallback(() => {
    confirmPlaybackActive(requestCounterRef.current);
    const now = Date.now();
    timingRef.current.t6_firstFrame = now;
    timingRef.current.t7_firstFrame = now;
    if (verifyPlaybackRef.current) {
      clearTimeout(verifyPlaybackRef.current);
      verifyPlaybackRef.current = null;
    }
    setHasFirstFrame(true);
    hasEverPlayedRef.current = true;
    try {
      if (player) {
        player.muted = false;
        player.volume = volumeRef.current || 1.0;
      }
    } catch (_e) {}

    if (playerStateRef.current !== 'PAUSED' && !userPausedRef.current) {
      playerStateRef.current = 'PLAYING';
      setPlayerState('PLAYING');
      if (bufferTimerRef.current) {
        clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = null;
      }
      setIsBufferingUI(false);
      setDebouncedBuffering(false);
    }

    const t0 = timingRef.current.t0_tap || timingRef.current.assigned || now;
    const totalLatency = now - t0;
    const t0_to_t1 = timingRef.current.t1_source ? (timingRef.current.t1_source - t0) : 0;
    const t1_to_t3 = (timingRef.current.t3_assigned && timingRef.current.t1_source) ? (timingRef.current.t3_assigned - timingRef.current.t1_source) : 0;
    const t3_to_t5 = (timingRef.current.t5_ready && timingRef.current.t3_assigned) ? (timingRef.current.t5_ready - timingRef.current.t3_assigned) : 0;
    const t5_to_t8 = (timingRef.current.t8_playing && timingRef.current.t5_ready) ? (timingRef.current.t8_playing - timingRef.current.t5_ready) : 0;
    const t8_to_t7 = timingRef.current.t8_playing ? (now - timingRef.current.t8_playing) : 0;

    logPlayerDiagnostic('playbackStartupTimings', {
      totalSelectionToFirstFrameMs: totalLatency,
      t0_selection_to_url_ms: t0_to_t1,
      t1_url_to_assigned_ms: t1_to_t3,
      t3_assigned_to_ready_ms: t3_to_t5,
      t5_ready_to_playback_ms: t5_to_t8,
      t8_playback_to_first_frame_ms: t8_to_t7,
      type,
      platform: Platform.OS,
    });
  }, [type, setDebouncedBuffering, player]);

  const isPlaying = (playerState === 'PLAYING' || playerState === 'LOADING' || playerState === 'BUFFERING' || playerState === 'RETRYING') && playerState !== 'PAUSED' && playerState !== 'ERROR';
  const isWaitingForMedia = playerState !== 'PAUSED' && playerState !== 'ERROR' && (
    playerState === 'LOADING' ||
    playerState === 'BUFFERING' ||
    playerState === 'RETRYING' ||
    (isBufferingUI && playerState !== 'PLAYING')
  );

  const videoViewProps = getPlatformVideoViewProps({ contentFit, isMini: false });

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {/* Video Viewport (bounded container) */}
      <View style={styles.videoViewport}>
        <View
          ref={viewportRef}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          onLayout={(e) => measureAndLogLayout('PlayerScreen:videoViewport', viewportRef, e.nativeEvent.layout, insets)}
        />
        {/* Layer 1: Unified Dual Playback Video Surface */}
        <View
          ref={videoSurfaceRef}
          style={[StyleSheet.absoluteFill, styles.videoSurface]}
          pointerEvents="none"
          onLayout={(e) => measureAndLogLayout('PlayerScreen:videoSurface', videoSurfaceRef, e.nativeEvent.layout, insets)}
        >
          <UnifiedVideoSurface
            style={StyleSheet.absoluteFill}
            activeEngineType={activeEngineType}
            nativePlayer={player}
            vlcPlayer={vlcPlayer}
            contentFit={contentFit}
            isMini={false}
            allowsPictureInPicture
            onFirstFrameRender={handleFirstFrameRender}
            {...videoViewProps}
          />
        </View>

        {/* Unified Interactive Overlay Layer */}
        {playerState !== 'ERROR' && (
          <View style={styles.unifiedOverlay} pointerEvents="box-none">
            <View
              ref={unifiedOverlayRef}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
              onLayout={(e) => measureAndLogLayout('PlayerScreen:unifiedOverlay', unifiedOverlayRef, e.nativeEvent.layout, insets)}
            />
            {/* Layer 2: VLC-Style Master Gesture Overlay (Brightness on Left, Volume on Right) */}
            <PlayerGestureOverlay
              brightness={brightness}
              setBrightness={setBrightness}
              volume={volume}
              setVolume={setVolume}
              onSingleTap={toggleControls}
              onDoubleTapLeft={handleRewind}
              onDoubleTapRight={handleForward}
              onGestureStart={handleGestureStart}
              onGestureEnd={handleGestureEnd}
              disabled={playerState === 'ERROR'}
              controlsVisible={controlsVisible}
              insets={insets}
              onHudChange={setGestureHud}
            />

            {/* Layer 7: Unified 3-Zone Player Controls */}
            <View
              ref={controlsContainerRef}
              style={styles.controlsContainer}
              pointerEvents={controlsVisible ? 'box-none' : 'none'}
              onLayout={(e) => measureAndLogLayout('PlayerScreen:controlsContainer', controlsContainerRef, e.nativeEvent.layout, insets)}
            >
              <PlayerControls
                opacityAnim={controlsOpacity}
                isPlaying={isPlaying}
                onTogglePlay={togglePlay}
                title={title}
                type={type || 'movie'}
                isLive={isLive}
                canSeek={!isLive}
                currentTime={currentTime}
                duration={isLive ? 0 : duration}
                onSeek={handleSeek}
                onSeekingChange={handleSeekingChange}
                onRewind={handleRewind}
                onForward={handleForward}
                isMuted={isMuted}
                onToggleMute={toggleMute}
                playbackSpeed={SPEEDS[playbackSpeedIndex]}
                onCycleSpeed={cycleSpeed}
                contentFit={contentFit}
                onCycleFit={cycleFitMode}
                onBack={handleBack}
                onBackdropPress={toggleControls}
                insets={insets}
                isMini={false}
                streamId={streamId}
                extension={extension}
                url={url}
                poster={poster}
                isBuffering={isWaitingForMedia}
                bufferingLabel={playerState === 'RETRYING' ? 'Connecting fallback stream...' : (playerState === 'LOADING' ? 'Connecting stream...' : 'Buffering...')}
                gestureHud={gestureHud}
                availableAudioTracks={availableAudioTracks}
                selectedAudioTrack={selectedAudioTrack}
                onSelectAudioTrack={handleSelectAudioTrack}
                availableSubtitleTracks={availableSubtitleTracks}
                selectedSubtitleTrack={selectedSubtitleTrack}
                onSelectSubtitleTrack={handleSelectSubtitleTrack}
                activeEngineType={activeEngineType}
                engineMode={engineMode}
                onOpenEngineModal={() => setShowEngineModal(true)}
              />
            </View>
          </View>
        )}

        {/* Layer 4: Seek HUD Feedback Badge */}
        {seekFeedback && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.seekFeedbackBox,
              {
                opacity: seekFeedbackAnim,
                transform: [{ scale: seekFeedbackAnim.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }) }],
              },
            ]}
          >
            <Text style={styles.seekFeedbackText}>{seekFeedback.text}</Text>
          </Animated.View>
        )}

        {/* Layer 4.5: Independent Buffering & Loading Overlay */}
        {playerState !== 'ERROR' && playerState !== 'PAUSED' && (
          <View style={styles.bufferingOverlay} pointerEvents="none">
            <View style={styles.bufferingCenterBox}>
              <BufferingIndicator
                visible={isWaitingForMedia && playerState !== 'PAUSED'}
                size={54}
                strokeWidth={3.8}
                isMini={false}
                showLabel={true}
                labelText={playerState === 'RETRYING' ? 'Connecting fallback stream...' : (playerState === 'LOADING' ? 'Connecting stream...' : 'Buffering...')}
              />
            </View>
          </View>
        )}

        {/* Layer 5: Broken Video State */}
        {playerState === 'ERROR' && (
          <BrokenVideoView
            title={errorDetails?.heading || 'Unable to Play Video'}
            heading={errorDetails?.heading || 'Unable to Play Video'}
            errorMessage={errorDetails?.exactError || errorDetails?.message || errorMessage || 'Something went wrong while playing this video.'}
            message={errorDetails?.message || errorMessage || 'Something went wrong while playing this video.'}
            exactError={errorDetails?.exactError}
            errorCode={errorDetails?.errorCode}
            explanation={errorDetails?.explanation || 'This video may be temporarily unavailable. Please try again.'}
            canRetry={errorDetails ? errorDetails.canRetry : true}
            onRetry={handleRetry}
            onBack={handleBack}
            onSwitchEngine={() => {
              const target = activeEngineType === ENGINE_TYPE.NATIVE ? ENGINE_TYPE.VLC : ENGINE_TYPE.NATIVE;
              switchEngine(target, ENGINE_SWITCH_REASON.USER_RETRY);
            }}
            switchEngineLabel={activeEngineType === ENGINE_TYPE.NATIVE ? 'Try Playing with VLC Engine' : 'Try Playing with Native Engine'}
            isMini={false}
            insets={insets}
          />
        )}
      </View>

      {/* Layer 6: Error Toast */}
      <PlayerErrorToast
        message={toastMessage}
        visible={showToast}
        onDismiss={() => {
          setShowToast(false);
          setToastMessage(null);
        }}
        bottomOffset={controlsVisible ? 110 : 36}
      />

      {/* Layer 8: Global Toast notifications */}
      <GlobalToast bottomOffset={controlsVisible ? 110 : 36} />

      {/* Layer 9: Dual Playback Engine Selection Modal */}
      <PlaybackEngineModal
        visible={showEngineModal}
        activeEngineType={activeEngineType}
        engineMode={engineMode}
        onSelectMode={async (mode) => {
          setEngineMode(mode);
          try {
            await writeCache('fox_player_preferred_engine_mode', mode);
          } catch (_e) {}
          const target = mode === ENGINE_MODE.VLC ? ENGINE_TYPE.VLC : ENGINE_TYPE.NATIVE;
          if (target !== activeEngineType) {
            switchEngine(target, ENGINE_SWITCH_REASON.MANUAL_SWITCH);
          }
        }}
        onDismiss={() => setShowEngineModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    position: 'relative',
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  gestureRow: {
    flex: 1,
    flexDirection: 'row',
  },
  gestureHalf: {
    flex: 1,
    height: '100%',
  },
  seekFeedbackBox: {
    position: 'absolute',
    alignSelf: 'center',
    top: '42%',
    backgroundColor: 'rgba(18, 18, 20, 0.94)',
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: Colors.brand.primary,
    zIndex: 25,
  },
  seekFeedbackText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  videoSurface: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  bufferingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 15,
  },
  bufferingCenterBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlsContainer: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    zIndex: 30,
    elevation: 30,
  },
  videoViewport: {
    ...StyleSheet.absoluteFillObject,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  unifiedOverlay: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    zIndex: 20,
    elevation: 20,
  },
});
