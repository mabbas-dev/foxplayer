/**
 * FOX PLAYER — Centralized Playback & Player Settings Service
 *
 * Single source of truth for:
 * 1. Player engine definitions (AUTO, NATIVE, VLC)
 * 2. Native runtime capability probing (safe detection of ExoPlayer/AVPlayer and libVLC)
 * 3. Settings persistence and live subscription
 * 4. Fallback and retry policy configuration
 */

let Platform = { OS: 'android', select: (obj) => obj?.android || obj?.default };
try {
  const RN = require('react-native');
  if (RN && RN.Platform) Platform = RN.Platform;
} catch (_e) {}

let readCache = async () => null;
let writeCache = async () => {};
try {
  const cacheStorage = require('../storage/cacheStorage.js');
  if (cacheStorage.readCache) readCache = cacheStorage.readCache;
  if (cacheStorage.writeCache) writeCache = cacheStorage.writeCache;
} catch (_e) {}

import { ENGINE_MODE, ENGINE_TYPE, ENGINE_LABELS } from './playbackTypes.js';

// Storage keys
export const STORAGE_PLAYER_SETTINGS_KEY = 'fox_player_settings_v2';
export const STORAGE_LEGACY_ENGINE_MODE_KEY = 'fox_player_preferred_engine_mode';

// Buffer profiles
export const BUFFER_PROFILE = {
  LOW_LATENCY: 'low_latency',
  NORMAL: 'normal',
  STABLE: 'stable',
};

export const BUFFER_PROFILE_LABELS = {
  [BUFFER_PROFILE.LOW_LATENCY]: 'Low Latency (Fastest Start)',
  [BUFFER_PROFILE.NORMAL]: 'Standard (Balanced)',
  [BUFFER_PROFILE.STABLE]: 'High Buffer (Smooth & Stable)',
};

// Default Settings
export const DEFAULT_PLAYER_SETTINGS = {
  preferredEngine: ENGINE_MODE.AUTO,
  autoFallbackEnabled: true,
  retryFailedStreams: true,
  maxRetryAttempts: 3,
  bufferProfile: BUFFER_PROFILE.NORMAL,
  rememberPlayerPreference: true,
};

// In-memory active settings cache
let cachedSettings = { ...DEFAULT_PLAYER_SETTINGS };
let isLoaded = false;
const listeners = new Set();

/**
 * Safely probe whether VLC native binary is installed and registered in this runtime.
 * Never throws an exception.
 *
 * @returns {{ available: boolean, reason: string }}
 */
export function probeVlcNativeAvailability() {
  try {
    // 1. Check if global NitroModulesProxy is installed and has VlcPlayer registered
    if (
      typeof global !== 'undefined' &&
      global.NitroModulesProxy &&
      typeof global.NitroModulesProxy.hasHybridObject === 'function'
    ) {
      const hasHybrid = global.NitroModulesProxy.hasHybridObject('VlcPlayer');
      if (hasHybrid) {
        return {
          available: true,
          reason: 'Integrated libVLC engine available and linked via Nitro Modules.',
        };
      }
      return {
        available: false,
        reason: 'VlcPlayer native module is not compiled into this binary (requires custom development build).',
      };
    }

    // 2. Check React Native UIManager for VlcPlayerView
    try {
      const RN = require('react-native');
      if (RN && RN.UIManager && typeof RN.UIManager.getViewManagerConfig === 'function') {
        const config = RN.UIManager.getViewManagerConfig('VlcPlayerView');
        if (config) {
          return {
            available: true,
            reason: 'VlcPlayerView registered in UIManager.',
          };
        }
      }
    } catch (_uiErr) {}

    return {
      available: false,
      reason: 'VLC native binaries are not linked in this build. Running in standard Expo client.',
    };
  } catch (err) {
    return {
      available: false,
      reason: err?.message || 'VLC native runtime module is unavailable.',
    };
  }
}

/**
 * Check whether Native Player (Media3 on Android / AVPlayer on iOS) is available.
 *
 * @returns {{ available: boolean, name: string, reason: string }}
 */
export function probeNativePlayerAvailability() {
  const isAndroid = Platform.OS === 'android';
  const name = isAndroid ? 'Native Player (Media3 ExoPlayer)' : 'Native Player (AVPlayer)';
  return {
    available: true,
    name,
    reason: isAndroid
      ? 'AndroidX Media3 ExoPlayer with hardware acceleration.'
      : 'Apple AVFoundation AVPlayer with native HLS hardware decoding.',
  };
}

/**
 * Returns comprehensive availability and metadata for all supported player engines.
 *
 * @param {string} [activeEngineType] - Currently playing engine ('NATIVE' | 'VLC')
 * @returns {Array<Object>} List of player engine descriptors
 */
export function getAvailablePlayerEngines(activeEngineType = ENGINE_TYPE.NATIVE) {
  const vlcProbe = probeVlcNativeAvailability();
  const nativeProbe = probeNativePlayerAvailability();
  const currentPref = cachedSettings.preferredEngine || ENGINE_MODE.AUTO;

  return [
    {
      id: ENGINE_MODE.AUTO,
      name: 'Auto (Recommended)',
      shortName: 'Auto',
      description: 'Uses high-performance native engine first, then seamlessly switches to VLC if format or codec fails.',
      isAvailable: true,
      tag: 'RECOMMENDED',
      isSelected: currentPref === ENGINE_MODE.AUTO,
      isActive: currentPref === ENGINE_MODE.AUTO,
      disabledReason: null,
    },
    {
      id: ENGINE_MODE.NATIVE,
      name: nativeProbe.name,
      shortName: Platform.OS === 'ios' ? 'AVPlayer' : 'ExoPlayer',
      description: nativeProbe.reason,
      isAvailable: true,
      tag: 'FASTEST',
      isSelected: currentPref === ENGINE_MODE.NATIVE,
      isActive: activeEngineType === ENGINE_TYPE.NATIVE,
      disabledReason: null,
    },
    {
      id: ENGINE_MODE.VLC,
      name: 'VLC Player (libVLC)',
      shortName: 'VLC',
      description: 'Maximum container and codec compatibility for raw MPEG-TS, MKV, AVI, and legacy IPTV streams.',
      isAvailable: vlcProbe.available,
      tag: vlcProbe.available ? 'COMPATIBLE' : 'UNAVAILABLE',
      isSelected: currentPref === ENGINE_MODE.VLC,
      isActive: activeEngineType === ENGINE_TYPE.VLC,
      disabledReason: vlcProbe.available ? null : vlcProbe.reason,
    },
  ];
}

/**
 * Validate whether a preferred engine selection is valid and available.
 *
 * @param {string} engineId - 'AUTO' | 'NATIVE' | 'VLC'
 * @returns {{ valid: boolean, error: string | null }}
 */
export function validateEngineSelection(engineId) {
  if (engineId !== ENGINE_MODE.AUTO && engineId !== ENGINE_MODE.NATIVE && engineId !== ENGINE_MODE.VLC) {
    return { valid: false, error: `Invalid player engine mode: ${engineId}` };
  }

  if (engineId === ENGINE_MODE.VLC) {
    const vlcProbe = probeVlcNativeAvailability();
    if (!vlcProbe.available) {
      return {
        valid: false,
        error: `VLC Player is not available in this build: ${vlcProbe.reason}`,
      };
    }
  }

  return { valid: true, error: null };
}

/**
 * Load persisted player settings from storage.
 *
 * @returns {Promise<Object>} Player settings
 */
export async function loadPlayerSettings() {
  try {
    const raw = await readCache(STORAGE_PLAYER_SETTINGS_KEY);
    if (raw && typeof raw === 'object') {
      cachedSettings = {
        ...DEFAULT_PLAYER_SETTINGS,
        ...raw,
      };
    } else {
      // Migrate from legacy single-key storage if present
      const legacyMode = await readCache(STORAGE_LEGACY_ENGINE_MODE_KEY);
      if (legacyMode && [ENGINE_MODE.AUTO, ENGINE_MODE.NATIVE, ENGINE_MODE.VLC].includes(legacyMode)) {
        cachedSettings = {
          ...DEFAULT_PLAYER_SETTINGS,
          preferredEngine: legacyMode,
        };
      }
    }

    // Safety guard: if saved engine is VLC but VLC is unavailable, safely reset to AUTO
    if (cachedSettings.preferredEngine === ENGINE_MODE.VLC) {
      const vlcProbe = probeVlcNativeAvailability();
      if (!vlcProbe.available) {
        console.warn('[PlayerSettings] Saved VLC engine is unavailable on this device. Falling back to AUTO.');
        cachedSettings.preferredEngine = ENGINE_MODE.AUTO;
      }
    }

    isLoaded = true;
    notifyListeners();
    return { ...cachedSettings };
  } catch (err) {
    console.warn('[PlayerSettings] Error reading player settings:', err?.message);
    cachedSettings = { ...DEFAULT_PLAYER_SETTINGS };
    isLoaded = true;
    return { ...cachedSettings };
  }
}

/**
 * Get current in-memory settings (synchronous).
 *
 * @returns {Object}
 */
export function getPlayerSettings() {
  if (!isLoaded) {
    // Initiate background load if not already loaded
    loadPlayerSettings().catch(() => {});
  }
  return { ...cachedSettings };
}

/**
 * Save updated player settings to storage and notify all active player components.
 *
 * @param {Object} partial - Settings to update
 * @returns {Promise<{ success: boolean, settings: Object, error?: string }>}
 */
export async function savePlayerSettings(partial = {}) {
  if (partial.preferredEngine) {
    const validation = validateEngineSelection(partial.preferredEngine);
    if (!validation.valid) {
      return { success: false, settings: { ...cachedSettings }, error: validation.error };
    }
  }

  // Validate bounds on maxRetryAttempts
  let maxRetries = cachedSettings.maxRetryAttempts;
  if (typeof partial.maxRetryAttempts === 'number') {
    maxRetries = Math.max(1, Math.min(5, Math.round(partial.maxRetryAttempts)));
  }

  const nextSettings = {
    ...cachedSettings,
    ...partial,
    maxRetryAttempts: maxRetries,
  };

  cachedSettings = nextSettings;
  notifyListeners();

  try {
    if (nextSettings.rememberPlayerPreference) {
      await writeCache(STORAGE_PLAYER_SETTINGS_KEY, nextSettings);
      await writeCache(STORAGE_LEGACY_ENGINE_MODE_KEY, nextSettings.preferredEngine);
    }
    return { success: true, settings: { ...cachedSettings } };
  } catch (err) {
    console.warn('[PlayerSettings] Failed to persist settings:', err?.message);
    return { success: false, settings: { ...cachedSettings }, error: err?.message };
  }
}

/**
 * Reset player settings to factory defaults.
 *
 * @returns {Promise<Object>} Default settings
 */
export async function resetPlayerSettings() {
  cachedSettings = { ...DEFAULT_PLAYER_SETTINGS };
  notifyListeners();

  try {
    await writeCache(STORAGE_PLAYER_SETTINGS_KEY, DEFAULT_PLAYER_SETTINGS);
    await writeCache(STORAGE_LEGACY_ENGINE_MODE_KEY, DEFAULT_PLAYER_SETTINGS.preferredEngine);
  } catch (_e) {}

  return { ...cachedSettings };
}

/**
 * Subscribe to player settings changes.
 *
 * @param {(settings: Object) => void} listener
 * @returns {() => void} Unsubscribe function
 */
export function subscribePlayerSettings(listener) {
  listeners.add(listener);
  // Send current settings immediately
  try {
    listener({ ...cachedSettings });
  } catch (_e) {}

  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners() {
  const current = { ...cachedSettings };
  listeners.forEach((fn) => {
    try {
      fn(current);
    } catch (_e) {}
  });
}
