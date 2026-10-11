import { API_BASE_URL, TIMEOUTS } from '../constants/index.js';
import {
  ERROR_CATEGORY,
  AppNetworkError,
  isDeviceOffline,
  isAbortOrCancelledError,
} from './networkErrors.js';
import { trackRequestStart, trackRequestEnd } from '../utils/requestDiagnostics.js';

export { ERROR_CATEGORY, AppNetworkError, isAbortOrCancelledError, isDeviceOffline };

/**
 * Base API error class (backwards-compatible with AppNetworkError)
 */
export class ApiError extends AppNetworkError {
  constructor(code, message, statusCode = 0) {
    super(code, message, { statusCode });
    this.code = code;
    this.name = 'ApiError';
  }
}

/**
 * Make an authenticated request to the FOX PLAYER backend
 */
async function request(method, path, body = null, options = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeout || TIMEOUTS.API;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const externalSignal = options.signal || null;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener?.('abort', onExternalAbort);
    }
  }

  const reqId = trackRequestStart({
    endpoint: path,
    playlistId: options.playlistId,
    operationId: options.operationId,
    category: 'BACKEND_API',
  });

  try {
    const fetchOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.deviceId ? { 'x-device-id': options.deviceId } : {}),
        ...(options.installationId ? { 'x-installation-id': options.installationId } : {}),
        ...(options.headers || {}),
      },
      signal: controller.signal,
    };

    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const url = `${API_BASE_URL}${path}`;
    const response = await fetch(url, fetchOptions);

    let json;
    try {
      json = await response.json();
    } catch (_parseErr) {
      trackRequestEnd(reqId, {
        completionState: 'ERROR',
        httpStatus: response.status,
        errorCategory: ERROR_CATEGORY.INVALID_RESPONSE,
        errorMessage: 'Invalid JSON response',
      });
      throw new AppNetworkError(
        ERROR_CATEGORY.INVALID_RESPONSE,
        'Server returned an invalid response.',
        { statusCode: response.status, endpoint: path }
      );
    }

    if (!response.ok || !json.success) {
      const status = response.status;
      let cat = ERROR_CATEGORY.HTTP_ERROR;
      if (status === 401 || status === 403) {
        cat = ERROR_CATEGORY.AUTH_ERROR;
      } else if (status >= 500) {
        cat = ERROR_CATEGORY.HTTP_ERROR;
      }
      const errMsg = json?.error?.message || (status >= 500 ? 'Server error. Please try again.' : 'An unexpected error occurred.');

      trackRequestEnd(reqId, {
        completionState: 'ERROR',
        httpStatus: status,
        errorCategory: cat,
        errorMessage: errMsg,
      });

      throw new ApiError(cat, errMsg, status);
    }

    trackRequestEnd(reqId, {
      completionState: 'SUCCESS',
      httpStatus: response.status,
    });

    return json;
  } catch (e) {
    // 1. User-initiated cancellation / playlist switch
    if (externalSignal?.aborted) {
      trackRequestEnd(reqId, {
        completionState: 'ABORTED',
        errorCategory: ERROR_CATEGORY.REQUEST_ABORTED,
        errorMessage: 'Request cancelled',
      });
      throw new AppNetworkError(
        ERROR_CATEGORY.REQUEST_ABORTED,
        'Request was cancelled.',
        { endpoint: path, isCancelled: true }
      );
    }

    // 2. Request timeout
    if (e.name === 'AbortError') {
      trackRequestEnd(reqId, {
        completionState: 'ERROR',
        errorCategory: ERROR_CATEGORY.TIMEOUT,
        errorMessage: 'Request timed out',
      });
      throw new ApiError('TIMEOUT', 'Server request timed out. Please check your connection.');
    }

    if (e instanceof AppNetworkError) throw e;

    // 3. Network layer failures: separate true offline from backend down / connection refused
    if (e.message === 'Network request failed' || e.message?.includes('fetch') || e.message?.includes('Failed to fetch')) {
      const offline = await isDeviceOffline();
      if (offline) {
        trackRequestEnd(reqId, {
          completionState: 'ERROR',
          errorCategory: ERROR_CATEGORY.OFFLINE,
          errorMessage: 'Device offline',
        });
        throw new ApiError('OFFLINE', 'No internet connection.');
      }

      trackRequestEnd(reqId, {
        completionState: 'ERROR',
        errorCategory: ERROR_CATEGORY.BACKEND_UNAVAILABLE,
        errorMessage: 'Backend unavailable / connection refused',
      });
      throw new ApiError('BACKEND_UNAVAILABLE', 'Unable to connect to server.');
    }

    // 4. Default unknown network error
    trackRequestEnd(reqId, {
      completionState: 'ERROR',
      errorCategory: ERROR_CATEGORY.UNKNOWN_ERROR,
      errorMessage: e.message,
    });
    throw new ApiError('UNKNOWN_ERROR', e.message || 'Unable to reach the server.');
  } finally {
    clearTimeout(timeout);
    if (externalSignal) {
      externalSignal.removeEventListener?.('abort', onExternalAbort);
    }
  }
}

// --- Device API ---

/**
 * Register this device and installation UUID with the backend
 */
export async function registerDevice(deviceId, options = {}) {
  const installationId = options.installationId || options.installation_id || null;
  return request(
    'POST',
    '/api/devices/register',
    { device_id: deviceId, installation_id: installationId },
    { deviceId, installationId, ...options }
  );
}

/**
 * Query authoritative subscription status from backend server clock
 */
export async function getSubscriptionStatus(deviceId, installationId = null, options = {}) {
  const params = [];
  if (installationId) params.push(`installation_id=${encodeURIComponent(installationId)}`);
  if (deviceId) params.push(`device_id=${encodeURIComponent(deviceId)}`);
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  return request('GET', `/api/subscription/status${query}`, null, { deviceId, installationId, ...options });
}

/**
 * Check free-trial eligibility with backend server
 */
export async function checkTrialEligibility(deviceId, installationId = null, options = {}) {
  const params = [];
  if (installationId) params.push(`installation_id=${encodeURIComponent(installationId)}`);
  if (deviceId) params.push(`device_id=${encodeURIComponent(deviceId)}`);
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  return request('GET', `/api/subscription/eligibility${query}`, null, { deviceId, installationId, ...options });
}

/**
 * Atomically activate free trial on backend
 */
export async function activateTrial(deviceId, installationId, options = {}) {
  return request(
    'POST',
    '/api/subscription/activate-trial',
    { device_id: deviceId, installation_id: installationId },
    { deviceId, installationId, ...options }
  );
}

// In-flight request deduplication maps
const inFlightDevicePlaylists = new Map();
const inFlightDevicePlaylistConfig = new Map();

/**
 * Get all playlists configured for this device (deduplicated across concurrent calls)
 */
export async function getDevicePlaylists(deviceId, options = {}) {
  if (!deviceId) return { success: false, playlists: [] };
  const key = String(deviceId);
  if (inFlightDevicePlaylists.has(key)) {
    return inFlightDevicePlaylists.get(key);
  }

  const promise = request('GET', `/api/device/${deviceId}/playlists`, null, { deviceId, ...options })
    .finally(() => {
      inFlightDevicePlaylists.delete(key);
    });

  inFlightDevicePlaylists.set(key, promise);
  return promise;
}

/**
 * Get the playlist configuration for this device (active or specific playlist, deduplicated)
 */
export async function getDevicePlaylist(deviceId, playlistId = null, options = {}) {
  if (!deviceId) return { configured: false };
  const key = `${deviceId}:${playlistId || 'active'}`;
  if (inFlightDevicePlaylistConfig.has(key)) {
    return inFlightDevicePlaylistConfig.get(key);
  }

  const query = playlistId ? `?playlist_id=${encodeURIComponent(playlistId)}` : '';
  const promise = request('GET', `/api/device/${deviceId}/playlist${query}`, null, { deviceId, ...options })
    .finally(() => {
      inFlightDevicePlaylistConfig.delete(key);
    });

  inFlightDevicePlaylistConfig.set(key, promise);
  return promise;
}

/**
 * Set active playlist for this device on the server
 */
export async function setActiveDevicePlaylist(deviceId, playlistId, options = {}) {
  return request('POST', `/api/device/${deviceId}/active-playlist`, { playlist_id: playlistId }, { deviceId, ...options });
}

/**
 * Delete a playlist from the server
 */
export async function deleteDevicePlaylist(deviceId, playlistId, options = {}) {
  return request('DELETE', `/api/device/${deviceId}/playlist/${encodeURIComponent(playlistId)}`, null, { deviceId, ...options });
}

/**
 * Get pairing token and 6-digit code for this device
 */
export async function getDevicePairingToken(deviceId, options = {}) {
  return request('GET', `/api/device/${deviceId}/pairing-token`, null, { deviceId, ...options });
}

/**
 * Get ID Lock status for this device
 */
export async function getDeviceIdLock(deviceId, options = {}) {
  return request('GET', `/api/device/${deviceId}/id-lock`, null, { deviceId, ...options });
}

/**
 * Set ID Lock status for this device
 */
export async function setDeviceIdLock(deviceId, isLocked, options = {}) {
  return request('POST', `/api/device/${deviceId}/id-lock`, { id_lock: isLocked }, { deviceId, ...options });
}

/**
 * Add a playlist (M3U or Xtream) for this device
 */
export async function addDevicePlaylist(deviceId, playlistData, options = {}) {
  return request('POST', `/api/device/${deviceId}/playlists`, playlistData, { deviceId, ...options });
}

/**
 * Check if server is reachable
 */
export async function healthCheck(options = {}) {
  return request('GET', '/api/health', null, options);
}
