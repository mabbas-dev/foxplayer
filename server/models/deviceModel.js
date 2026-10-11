const crypto = require('crypto');
const { getDb } = require('../database/db');
const { createOrGetInstallationTrial, getSubscription, checkTrialEligibility } = require('./subscriptionModel');

const DEVICE_ID_REGEX = /^[A-Z0-9]{8}$/;

/**
 * Validate device ID format
 */
function isValidDeviceId(deviceId) {
  if (typeof deviceId !== 'string') return false;
  return DEVICE_ID_REGEX.test(deviceId.trim()) || /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(deviceId.trim());
}

/**
 * Register or update a device with optional installation UUID
 */
function registerOrUpdateDevice(deviceId, installationId = null, options = {}) {
  const db = getDb();

  const cleanDeviceId = String(deviceId).trim();
  const cleanInstId = installationId ? String(installationId).trim() : null;

  let existing = db.prepare('SELECT id, device_id, installation_id, id_lock, pairing_token, pairing_code, pairing_token_expires_at FROM devices WHERE device_id = ?').get(cleanDeviceId);
  if (!existing && cleanInstId) {
    existing = db.prepare('SELECT id, device_id, installation_id, id_lock, pairing_token, pairing_code, pairing_token_expires_at FROM devices WHERE installation_id = ?').get(cleanInstId);
  }

  let created = false;

  if (existing) {
    if (cleanInstId && !existing.installation_id) {
      db.prepare('UPDATE devices SET installation_id = ?, last_seen_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?').run(cleanInstId, existing.id);
    } else {
      db.prepare('UPDATE devices SET last_seen_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?').run(existing.id);
    }
  } else {
    db.prepare('INSERT INTO devices (device_id, installation_id, status, id_lock) VALUES (?, ?, \'active\', 0)').run(cleanDeviceId, cleanInstId);
    created = true;
  }

  const effectiveInstId = cleanInstId || existing?.installation_id || null;
  let subscriptionData = null;
  let validationData = null;
  let isTrialEligible = false;
  let trialSettings = null;

  // 1. Check for existing subscription first
  const existingSub = (effectiveInstId ? getSubscription(effectiveInstId) : null) || getSubscription(cleanDeviceId);

  if (existingSub) {
    subscriptionData = existingSub;
    validationData = existingSub.validation;
    isTrialEligible = false;
  } else {
    // 2. Check free trial eligibility
    const eligibility = checkTrialEligibility(effectiveInstId, cleanDeviceId);
    isTrialEligible = Boolean(eligibility.is_eligible);
    trialSettings = eligibility.is_eligible ? { duration_days: eligibility.duration_days } : null;

    if (options && options.autoTrial && effectiveInstId && eligibility.is_eligible) {
      const trialResult = createOrGetInstallationTrial(effectiveInstId, cleanDeviceId);
      subscriptionData = trialResult?.subscription || null;
      validationData = trialResult?.validation || null;
      isTrialEligible = false;
    }
  }

  const tokenInfo = getOrCreatePairingToken(cleanDeviceId);
  const currentDev = getDevice(cleanDeviceId);

  return {
    created,
    pairing_token: tokenInfo.pairing_token,
    pairing_code: tokenInfo.pairing_code,
    id_lock: Boolean(currentDev?.id_lock === 1),
    installation_id: effectiveInstId,
    subscription: subscriptionData,
    validation: validationData,
    is_trial_eligible: isTrialEligible,
    trial_settings: trialSettings,
  };
}

/**
 * Get a device by ID
 */
function getDevice(deviceId) {
  const db = getDb();
  return db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId);
}

/**
 * Check if device exists
 */
function deviceExists(deviceId) {
  const db = getDb();
  return !!db.prepare('SELECT 1 FROM devices WHERE device_id = ?').get(deviceId);
}

/**
 * Set ID Lock for a device (authoritative database update)
 */
function setIdLock(deviceId, isLocked) {
  const db = getDb();
  const val = isLocked ? 1 : 0;
  return db.prepare('UPDATE devices SET id_lock = ?, updated_at = datetime(\'now\') WHERE device_id = ?').run(val, deviceId);
}

/**
 * Check if device has ID Lock enabled
 */
function isDeviceLocked(deviceId) {
  if (!deviceId) return false;
  const db = getDb();
  const row = db.prepare('SELECT id_lock FROM devices WHERE device_id = ?').get(deviceId);
  return Boolean(row && row.id_lock === 1);
}

/**
 * Generate or retrieve an active pairing token & 6-digit pairing code
 */
function getOrCreatePairingToken(deviceId) {
  const db = getDb();
  const row = db.prepare('SELECT pairing_token, pairing_code, pairing_token_expires_at FROM devices WHERE device_id = ?').get(deviceId);

  if (row && row.pairing_token && row.pairing_code && row.pairing_token_expires_at) {
    const exp = new Date(row.pairing_token_expires_at).getTime();
    if (exp - Date.now() > 3600000) { // Still valid with >1h remaining
      return {
        pairing_token: row.pairing_token,
        pairing_code: row.pairing_code,
        expires_at: row.pairing_token_expires_at,
      };
    }
  }

  const pairingToken = crypto.randomBytes(24).toString('hex');
  const pairingCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  db.prepare(`
    UPDATE devices SET pairing_token = ?, pairing_code = ?, pairing_token_expires_at = ?, updated_at = datetime('now')
    WHERE device_id = ?
  `).run(pairingToken, pairingCode, expiresAt, deviceId);

  return {
    pairing_token: pairingToken,
    pairing_code: pairingCode,
    expires_at: expiresAt,
  };
}

/**
 * Exchange a pairing token or code for an authorized management session
 */
function pairDevice(deviceId, tokenOrCode) {
  if (!deviceId || !tokenOrCode) {
    return { success: false, error: 'MISSING_PARAM', message: 'Device ID and pairing token/code are required.' };
  }

  const db = getDb();
  const clean = String(tokenOrCode).trim();
  const device = db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId);

  if (!device) {
    return { success: false, error: 'DEVICE_NOT_FOUND', message: 'Device not found.' };
  }

  const matchesToken = device.pairing_token && device.pairing_token === clean;
  const matchesCode = device.pairing_code && device.pairing_code === clean;

  if (!matchesToken && !matchesCode) {
    return { success: false, error: 'INVALID_PAIRING', message: 'Invalid pairing code or token.' };
  }

  if (device.pairing_token_expires_at) {
    const exp = new Date(device.pairing_token_expires_at).getTime();
    if (Date.now() > exp) {
      return { success: false, error: 'PAIRING_EXPIRED', message: 'Pairing session has expired. Please refresh on your TV.' };
    }
  }

  // Issue 7-day management session
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const sessionExpiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  db.prepare(`
    UPDATE devices SET session_token = ?, session_token_expires_at = ?, updated_at = datetime('now')
    WHERE device_id = ?
  `).run(sessionToken, sessionExpiresAt, deviceId);

  return {
    success: true,
    session_token: sessionToken,
    expires_at: sessionExpiresAt,
    id_lock: Boolean(device.id_lock === 1),
  };
}

/**
 * Verify whether a management session token is valid for a given device
 */
function verifyManagementSession(deviceId, sessionToken) {
  if (!deviceId || !sessionToken) return false;
  const db = getDb();
  const device = db.prepare('SELECT session_token, session_token_expires_at FROM devices WHERE device_id = ?').get(deviceId);
  if (!device || !device.session_token) return false;

  if (device.session_token !== sessionToken) return false;

  if (device.session_token_expires_at) {
    const exp = new Date(device.session_token_expires_at).getTime();
    if (Date.now() > exp) return false;
  }

  return true;
}

/**
 * Generate or retrieve an active management session token for a device
 * Establishes authorized website management session without requiring a PIN.
 */
function getOrCreateSessionToken(deviceId) {
  if (!deviceId) return null;
  const db = getDb();
  const device = db.prepare('SELECT session_token, session_token_expires_at, id_lock FROM devices WHERE device_id = ?').get(deviceId);
  if (!device) return null;

  if (device.session_token && device.session_token_expires_at) {
    const exp = new Date(device.session_token_expires_at).getTime();
    if (exp - Date.now() > 3600000) { // Valid with >1h remaining
      return {
        session_token: device.session_token,
        expires_at: device.session_token_expires_at,
        id_lock: Boolean(device.id_lock === 1),
      };
    }
  }

  const sessionToken = crypto.randomBytes(32).toString('hex');
  const sessionExpiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  db.prepare(`
    UPDATE devices SET session_token = ?, session_token_expires_at = ?, updated_at = datetime('now')
    WHERE device_id = ?
  `).run(sessionToken, sessionExpiresAt, deviceId);

  return {
    session_token: sessionToken,
    expires_at: sessionExpiresAt,
    id_lock: Boolean(device.id_lock === 1),
  };
}

module.exports = {
  isValidDeviceId,
  registerOrUpdateDevice,
  getDevice,
  deviceExists,
  setIdLock,
  isDeviceLocked,
  getOrCreatePairingToken,
  pairDevice,
  getOrCreateSessionToken,
  verifyManagementSession,
};


