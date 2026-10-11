const express = require('express');
const router = express.Router();
const { pairingLimiter, apiLimiter, verifyManagementAuth } = require('../middleware/security');
const {
  isValidDeviceId,
  registerOrUpdateDevice,
  getDevice,
  setIdLock,
  isDeviceLocked,
  getOrCreatePairingToken,
  pairDevice,
  getOrCreateSessionToken,
} = require('../models/deviceModel');
const {
  savePlaylistConfig,
  getPlaylistConfig,
  getAllPlaylists,
  setActivePlaylist,
  deletePlaylist,
  getPublicPlaylistConfig,
  getSafeServerHost,
} = require('../models/playlistModel');
const {
  getSubscription,
  validateSubscription,
  isValidInstallationId,
  checkTrialEligibility,
  activateTrial,
} = require('../models/subscriptionModel');

// Health check
router.get('/health', (req, res) => {
  res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
});

// Device pairing exchange: exchange pairing token or 6-digit code for a management session token
router.post('/auth/pair', pairingLimiter, (req, res) => {
  try {
    const { device_id, token, code } = req.body;
    if (!device_id || !isValidDeviceId(device_id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DEVICE_ID', message: 'Valid device ID is required.' },
      });
    }

    const tokenOrCode = token || code;
    if (!tokenOrCode) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_PARAM', message: 'Pairing token or 6-digit code is required.' },
      });
    }

    const result = pairDevice(device_id, tokenOrCode);
    if (!result.success) {
      return res.status(401).json({
        success: false,
        error: { code: result.error, message: result.message },
      });
    }

    res.json({
      success: true,
      device_id,
      session_token: result.session_token,
      expires_at: result.expires_at,
      id_lock: result.id_lock,
    });
  } catch (e) {
    console.error('[API] Pair device error:', e.message);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Unable to complete device pairing.' },
    });
  }
});

// Establish or retrieve management session for website playlist management (no PIN)
router.post('/device/:deviceId/session', apiLimiter, (req, res) => {
  try {
    const { deviceId } = req.params;
    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DEVICE_ID', message: 'Valid device ID is required.' },
      });
    }

    const device = getDevice(deviceId);
    if (!device) {
      return res.status(404).json({
        success: false,
        error: { code: 'DEVICE_NOT_FOUND', message: 'Device was not found.' },
      });
    }

    const sessionInfo = getOrCreateSessionToken(deviceId);
    res.json({
      success: true,
      device_id: deviceId,
      session_token: sessionInfo.session_token,
      expires_at: sessionInfo.expires_at,
      id_lock: isDeviceLocked(deviceId),
    });
  } catch (e) {
    console.error('[API] Device session error:', e.message);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Unable to establish device session.' },
    });
  }
});

// Register device with installation UUID and authoritative subscription issuance
router.post('/devices/register', pairingLimiter, (req, res) => {
  try {
    const { device_id } = req.body;
    const installation_id = req.body.installation_id || req.body.installationId || req.headers['x-installation-id'] || null;

    if (!device_id || !isValidDeviceId(device_id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DEVICE_ID', message: 'Invalid device ID.' },
      });
    }

    if (installation_id && !isValidInstallationId(installation_id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INSTALLATION_ID', message: 'Installation UUID must be a valid UUID string.' },
      });
    }

    const result = registerOrUpdateDevice(device_id, installation_id);
    const device = getDevice(device_id);

    console.log(`[API] Device ${result.created ? 'registered' : 'updated'}: ${device_id} (installation: ${result.installation_id || 'none'})`);

    const subscriptionValidation = result.validation || (result.subscription ? validateSubscription(result.subscription) : null);

    res.json({
      success: true,
      created: result.created,
      device: {
        device_id: device.device_id,
        installation_id: result.installation_id || device.installation_id || null,
        status: device.status,
        created_at: device.created_at,
        last_seen_at: device.last_seen_at,
        id_lock: Boolean(device.id_lock === 1),
        pairing_token: result.pairing_token,
        pairing_code: result.pairing_code,
      },
      subscription: subscriptionValidation,
      is_trial_eligible: result.is_trial_eligible || false,
      trial_settings: result.trial_settings || null,
    });
  } catch (e) {
    console.error('[API] Register device error:', e.message);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Unable to register device.' },
    });
  }
});

// Authoritative public subscription validation endpoint (server-clock source of truth)
router.get('/subscription/status', apiLimiter, (req, res) => {
  try {
    const installationId = req.query.installation_id || req.query.installationId || req.headers['x-installation-id'];
    const deviceId = req.query.device_id || req.query.deviceId || req.headers['x-device-id'];
    const identifier = installationId || deviceId;

    if (!identifier) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_PARAM', message: 'installation_id or device_id is required.' },
      });
    }

    const sub = getSubscription(identifier);
    if (!sub) {
      const eligibility = checkTrialEligibility(installationId, deviceId);
      return res.json({
        success: true,
        has_subscription: false,
        is_trial_eligible: eligibility.is_eligible,
        trial_settings: eligibility.is_eligible ? { duration_days: eligibility.duration_days } : null,
        subscription: null,
        validation: {
          is_valid: false,
          status: eligibility.is_eligible ? 'trial_available' : 'missing',
          reason: eligibility.reason,
          server_time: new Date().toISOString(),
        },
      });
    }

    res.json({
      success: true,
      has_subscription: true,
      is_trial_eligible: false,
      subscription: {
        id: sub.id,
        created_at: sub.created_at,
        ...sub.validation,
      },
    });
  } catch (e) {
    console.error('[API] Subscription status error:', e.message);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Unable to check subscription status.' },
    });
  }
});

// Check free trial eligibility for a device/installation
router.get('/subscription/eligibility', apiLimiter, (req, res) => {
  try {
    const installationId = req.query.installation_id || req.query.installationId || req.headers['x-installation-id'];
    const deviceId = req.query.device_id || req.query.deviceId || req.headers['x-device-id'];

    if (!installationId && !deviceId) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_PARAM', message: 'installation_id or device_id is required.' },
      });
    }

    const eligibility = checkTrialEligibility(installationId, deviceId);
    res.json({
      success: true,
      ...eligibility,
    });
  } catch (e) {
    console.error('[API] Subscription eligibility error:', e.message);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Unable to check trial eligibility.' },
    });
  }
});

// Atomically activate free trial upon user consent via disclaimer
router.post('/subscription/activate-trial', apiLimiter, (req, res) => {
  try {
    const installationId = req.body.installation_id || req.body.installationId || req.headers['x-installation-id'];
    const deviceId = req.body.device_id || req.body.deviceId || req.headers['x-device-id'];

    if (!installationId) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_PARAM', message: 'installation_id is required to activate trial.' },
      });
    }

    if (!isValidInstallationId(installationId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INSTALLATION_ID', message: 'Valid UUID installation ID is required.' },
      });
    }

    if (deviceId && !isValidDeviceId(deviceId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DEVICE_ID', message: 'Invalid device ID format.' },
      });
    }

    const result = activateTrial(installationId, deviceId);

    if (!result.success) {
      const statusCode = result.already_activated ? 409 : (result.error?.code === 'TRIAL_DISABLED' ? 403 : 400);
      return res.status(statusCode).json({
        success: false,
        error: result.error,
        subscription: result.subscription || null,
      });
    }

    res.json({
      success: true,
      created: true,
      subscription: result.subscription,
    });
  } catch (e) {
    console.error('[API] Activate trial error:', e.message);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Unable to activate free trial.' },
    });
  }
});

// Get pairing token and code for a device
router.get('/device/:deviceId/pairing-token', apiLimiter, (req, res) => {
  try {
    const { deviceId } = req.params;

    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DEVICE_ID', message: 'Invalid device ID.' },
      });
    }

    const device = getDevice(deviceId);
    if (!device) {
      return res.status(404).json({
        success: false,
        error: { code: 'DEVICE_NOT_FOUND', message: 'Device not found.' },
      });
    }

    const tokenInfo = getOrCreatePairingToken(deviceId);

    res.json({
      success: true,
      device_id: deviceId,
      pairing_token: tokenInfo.pairing_token,
      pairing_code: tokenInfo.pairing_code,
      expires_at: tokenInfo.expires_at,
      id_lock: Boolean(device.id_lock === 1),
    });
  } catch (e) {
    console.error('[API] Get pairing token error:', e.message);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Unable to retrieve pairing token.' },
    });
  }
});

// Get ID Lock status for a device
router.get('/device/:deviceId/id-lock', apiLimiter, (req, res) => {
  try {
    const { deviceId } = req.params;

    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DEVICE_ID', message: 'Invalid device ID.' },
      });
    }

    const device = getDevice(deviceId);
    if (!device) {
      return res.status(404).json({
        success: false,
        error: { code: 'DEVICE_NOT_FOUND', message: 'Device not found.' },
      });
    }

    res.json({
      success: true,
      device_id: deviceId,
      id_lock: isDeviceLocked(deviceId),
    });
  } catch (e) {
    console.error('[API] Get ID lock error:', e.message);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Unable to retrieve ID lock state.' },
    });
  }
});

// Set ID Lock status for a device (App Settings or authorized management)
router.post('/device/:deviceId/id-lock', apiLimiter, verifyManagementAuth, (req, res) => {
  try {
    const { deviceId } = req.params;
    const { id_lock } = req.body;

    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DEVICE_ID', message: 'Invalid device ID.' },
      });
    }

    const device = getDevice(deviceId);
    if (!device) {
      return res.status(404).json({
        success: false,
        error: { code: 'DEVICE_NOT_FOUND', message: 'Device not found.' },
      });
    }

    const lockVal = Boolean(id_lock);
    setIdLock(deviceId, lockVal);

    res.json({
      success: true,
      device_id: deviceId,
      id_lock: lockVal,
      message: lockVal ? 'ID Lock enabled successfully.' : 'ID Lock disabled successfully.',
    });
  } catch (e) {
    console.error('[API] Set ID lock error:', e.message);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Unable to update ID lock state.' },
    });
  }
});

// Get all playlists for a device (public lookup for dashboard/app)
router.get('/device/:deviceId/playlists', apiLimiter, (req, res) => {
  try {
    const { deviceId } = req.params;

    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DEVICE_ID', message: 'Invalid device ID.' },
      });
    }

    const device = getDevice(deviceId);
    if (!device) {
      return res.status(404).json({
        success: false,
        error: { code: 'DEVICE_NOT_FOUND', message: 'Device not found.' },
      });
    }

    registerOrUpdateDevice(deviceId);

    const playlists = getAllPlaylists(deviceId);
    const active = playlists.find((p) => p.is_active) || playlists[0] || null;
    const locked = isDeviceLocked(deviceId);
    const sessionInfo = getOrCreateSessionToken(deviceId);

    let maxUpdatedAt = null;
    for (const p of playlists) {
      if (p.updated_at && (!maxUpdatedAt || p.updated_at > maxUpdatedAt)) {
        maxUpdatedAt = p.updated_at;
      }
    }

    res.json({
      success: true,
      device: {
        device_id: device.device_id,
        status: device.status,
        created_at: device.created_at,
        last_seen_at: device.last_seen_at,
        id_lock: locked,
      },
      id_lock: locked,
      playlists,
      active_playlist_id: active ? String(active.id) : null,
      count: playlists.length,
      session_token: sessionInfo ? sessionInfo.session_token : null,
      revision: maxUpdatedAt || device.last_seen_at || device.created_at,
    });
  } catch (e) {
    console.error('[API] Get playlists error:', e.message);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Unable to retrieve playlists.' },
    });
  }
});

// Add a playlist to a device (Website dashboard & authorized management)
router.post('/device/:deviceId/playlists', apiLimiter, verifyManagementAuth, (req, res) => {
  try {
    const { deviceId } = req.params;
    const { type, playlist_url, playlist_name, server_url, username, password } = req.body;

    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DEVICE_ID', message: 'Invalid device ID.' },
      });
    }

    const device = getDevice(deviceId);
    if (!device) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DEVICE_NOT_FOUND',
          message: 'Device not found. Please install and launch FOX PLAYER app first.',
        },
      });
    }

    if (isDeviceLocked(deviceId)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'DEVICE_LOCKED',
          message: 'Playlist management is locked for this device. Please disable ID Lock in Fox Player Settings.',
        },
      });
    }

    // Validate type and required fields
    if (type === 'm3u') {
      if (!playlist_url || typeof playlist_url !== 'string' || !playlist_url.trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CONFIGURATION', message: 'Please enter a playlist URL.' },
        });
      }
      try {
        new URL(playlist_url.trim());
      } catch (e) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CONFIGURATION', message: 'Please enter a valid playlist URL.' },
        });
      }
    } else if (type === 'xtream') {
      if (!server_url || typeof server_url !== 'string' || !server_url.trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CONFIGURATION', message: 'Please enter your Xtream server URL.' },
        });
      }
      try {
        new URL(server_url.trim());
      } catch (e) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CONFIGURATION', message: 'Please enter a valid Xtream server URL (e.g. http://server.com:8080).' },
        });
      }
      if (!username || typeof username !== 'string' || !username.trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CONFIGURATION', message: 'Please enter your username.' },
        });
      }
      if (!password || typeof password !== 'string' || !password.trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CONFIGURATION', message: 'Please enter your password.' },
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_CONFIGURATION', message: 'Invalid configuration type. Must be "m3u" or "xtream".' },
      });
    }

    const saveResult = savePlaylistConfig(deviceId, {
      type,
      playlist_url: playlist_url?.trim(),
      playlist_name: playlist_name?.trim() || (type === 'xtream' ? 'Xtream Playlist' : 'M3U Playlist'),
      server_url: server_url?.trim(),
      username: username?.trim(),
      password: typeof password === 'string' ? password.trim() : password,
      id: req.body.id || req.body.playlist_id,
    });

    const safeHost = getSafeServerHost(type, server_url, playlist_url);
    const all = getAllPlaylists(deviceId);

    res.json({
      success: true,
      message: 'Playlist added successfully.',
      playlist: {
        id: String(saveResult.playlist_id),
        name: playlist_name?.trim() || (type === 'xtream' ? 'Xtream Playlist' : 'M3U Playlist'),
        type,
        server_hostname: safeHost,
        status: 'Active',
        is_active: true,
        created_at: new Date().toISOString(),
      },
      count: all.length,
      playlists: all,
    });
  } catch (e) {
    if (e.code === 'DEVICE_LOCKED' || e.message?.includes('locked')) {
      return res.status(403).json({
        success: false,
        error: { code: 'DEVICE_LOCKED', message: e.message },
      });
    }
    console.error('[API] Add playlist error:', e.message);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Unable to add playlist.' },
    });
  }
});

// Get device playlist configuration (used by the app)
// Supports optional ?playlist_id=... query parameter, defaults to active playlist
router.get('/device/:deviceId/playlist', apiLimiter, (req, res) => {
  try {
    const { deviceId } = req.params;
    const { playlist_id } = req.query;

    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DEVICE_ID', message: 'Invalid device ID.' },
      });
    }

    const device = getDevice(deviceId);
    if (!device) {
      return res.status(404).json({
        success: false,
        error: { code: 'DEVICE_NOT_FOUND', message: 'Device was not found.' },
      });
    }

    // Update last seen
    registerOrUpdateDevice(deviceId);

    const config = getPlaylistConfig(deviceId, playlist_id || null);
    if (!config) {
      return res.json({
        success: true,
        configured: false,
        error: { code: 'NO_CONFIGURATION', message: 'No IPTV configuration found for this device.' },
      });
    }

    if (!config.enabled) {
      return res.json({
        success: true,
        configured: false,
        error: { code: 'INVALID_CONFIGURATION', message: 'Configuration is disabled.' },
      });
    }

    // Build configuration response based on type
    let configuration = {};

    if (config.type === 'm3u') {
      configuration = {
        playlist_url: config.playlist_url,
        playlistUrl: config.playlist_url,
        playlist_name: config.playlist_name,
        name: config.playlist_name,
        ...(config.server_url ? { server_url: config.server_url, serverUrl: config.server_url } : {}),
        ...(config.username ? { username: config.username } : {}),
        ...(config.password ? { password: config.password } : {}),
      };
    } else if (config.type === 'xtream') {
      configuration = {
        server_url: config.server_url,
        serverUrl: config.server_url,
        username: config.username,
        password: config.password, // Decrypted at this point — app needs it
        playlist_name: config.playlist_name,
        name: config.playlist_name,
      };
    }

    res.json({
      success: true,
      configured: true,
      id: String(config.id),
      name: config.playlist_name,
      type: config.type,
      configuration,
      is_active: config.is_active,
      updated_at: config.updated_at,
    });
  } catch (e) {
    console.error('[API] Get playlist error:', e.message);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Unable to retrieve configuration.' },
    });
  }
});

// Set active playlist for a device
router.post('/device/:deviceId/active-playlist', apiLimiter, verifyManagementAuth, (req, res) => {
  try {
    const { deviceId } = req.params;
    const { playlist_id } = req.body;

    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DEVICE_ID', message: 'Invalid device ID.' },
      });
    }

    if (!playlist_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_PARAM', message: 'playlist_id is required.' },
      });
    }

    const activated = setActivePlaylist(deviceId, playlist_id);
    if (!activated) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Playlist not found.' },
      });
    }

    res.json({
      success: true,
      active_playlist_id: String(playlist_id),
      active_playlist: {
        id: String(activated.id),
        name: activated.playlist_name,
        type: activated.type,
      },
    });
  } catch (e) {
    console.error('[API] Set active playlist error:', e.message);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Unable to switch active playlist.' },
    });
  }
});

// Delete a playlist
router.delete('/device/:deviceId/playlist/:playlistId', apiLimiter, verifyManagementAuth, (req, res) => {
  try {
    const { deviceId, playlistId } = req.params;

    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DEVICE_ID', message: 'Invalid device ID.' },
      });
    }

    const device = getDevice(deviceId);
    if (!device) {
      return res.status(404).json({
        success: false,
        error: { code: 'DEVICE_NOT_FOUND', message: 'Device was not found.' },
      });
    }

    if (isDeviceLocked(deviceId)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'DEVICE_LOCKED',
          message: 'Playlist management is locked for this device. Please disable ID Lock in Fox Player Settings.',
        },
      });
    }

    const success = deletePlaylist(deviceId, playlistId);
    if (!success) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Playlist not found or already removed.' },
      });
    }

    const remaining = getAllPlaylists(deviceId);

    res.json({
      success: true,
      message: 'Playlist deleted successfully.',
      count: remaining.length,
      playlists: remaining,
    });
  } catch (e) {
    if (e.code === 'DEVICE_LOCKED' || e.message?.includes('locked')) {
      return res.status(403).json({
        success: false,
        error: { code: 'DEVICE_LOCKED', message: e.message },
      });
    }
    console.error('[API] Delete playlist error:', e.message);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Unable to delete playlist.' },
    });
  }
});

// Save configuration via web form (POST)
router.post('/device/:deviceId/configure', pairingLimiter, (req, res) => {
  try {
    const { deviceId } = req.params;
    const { type, playlist_url, playlist_name, server_url, username, password } = req.body;

    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DEVICE_ID', message: 'Invalid device ID.' },
      });
    }

    const device = getDevice(deviceId);
    if (!device) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DEVICE_NOT_FOUND',
          message: 'Device not found. Please install and launch FOX PLAYER app first.',
        },
      });
    }

    if (isDeviceLocked(deviceId)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'DEVICE_LOCKED',
          message: 'Playlist management is locked for this device. Please disable ID Lock in Fox Player Settings.',
        },
      });
    }

    // Validate by type
    if (type === 'm3u') {
      if (!playlist_url) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CONFIGURATION', message: 'Please enter a playlist URL.' },
        });
      }
      try {
        new URL(playlist_url);
      } catch (e) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CONFIGURATION', message: 'Please enter a valid playlist URL.' },
        });
      }
    } else if (type === 'xtream') {
      if (!server_url) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CONFIGURATION', message: 'Please enter your Xtream server URL.' },
        });
      }
      if (!username) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CONFIGURATION', message: 'Please enter your username.' },
        });
      }
      if (!password) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CONFIGURATION', message: 'Please enter your password.' },
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_CONFIGURATION', message: 'Invalid configuration type.' },
      });
    }

    const saveResult = savePlaylistConfig(deviceId, {
      type,
      playlist_url: playlist_url?.trim(),
      playlist_name: playlist_name?.trim(),
      server_url: server_url?.trim(),
      username: username?.trim(),
      password,
      id: req.body.id || req.body.playlist_id,
    });

    console.log(`[API] Configuration saved for device: ${deviceId} (type: ${type}, playlist_id: ${saveResult.playlist_id})`);

    // Redirect to success page or return JSON
    const accept = req.headers.accept || '';
    if (accept.includes('application/json')) {
      return res.json({ success: true, playlist_id: saveResult.playlist_id });
    }
    res.redirect(`/success?device-id=${deviceId}`);
  } catch (e) {
    if (e.code === 'DEVICE_LOCKED' || e.message?.includes('locked')) {
      return res.status(403).json({
        success: false,
        error: { code: 'DEVICE_LOCKED', message: e.message },
      });
    }
    console.error('[API] Configure device error:', e.message);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Unable to save configuration.' },
    });
  }
});

// Get device status (public — no credentials)
router.get('/device/:deviceId/status', apiLimiter, (req, res) => {
  try {
    const { deviceId } = req.params;

    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DEVICE_ID', message: 'Invalid device ID.' },
      });
    }

    const device = getDevice(deviceId);
    if (!device) {
      return res.status(404).json({
        success: false,
        error: { code: 'DEVICE_NOT_FOUND', message: 'Device not found.' },
      });
    }

    const config = getPublicPlaylistConfig(deviceId); // No password
    const allPlaylists = getAllPlaylists(deviceId);
    const locked = isDeviceLocked(deviceId);

    res.json({
      success: true,
      device: {
        device_id: device.device_id,
        status: device.status,
        created_at: device.created_at,
        last_seen_at: device.last_seen_at,
        id_lock: locked,
      },
      id_lock: locked,
      configured: !!config,
      config_type: config?.type || null,
      config_updated_at: config?.updated_at || null,
      playlists_count: allPlaylists.length,
      active_playlist_id: config?.id || null,
    });
  } catch (e) {
    console.error('[API] Device status error:', e.message);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Unable to retrieve device status.' },
    });
  }
});

module.exports = router;
