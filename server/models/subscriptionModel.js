const crypto = require('crypto');
const { getDb } = require('../database/db');

/**
 * Validate installation UUID format (Standard UUID v4 or v1-v5 format)
 */
function isValidInstallationId(id) {
  if (typeof id !== 'string') return false;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id.trim());
}

/**
 * Get dynamic subscription configuration from database
 */
function getSubscriptionSettings() {
  const db = getDb();
  const settings = db.prepare('SELECT * FROM subscription_settings WHERE id = 1').get();
  if (!settings) {
    return {
      id: 1,
      trial_enabled: 1,
      trial_duration_days: 7,
      updated_at: new Date().toISOString(),
      updated_by: 'system',
      notes: 'Fallback default',
    };
  }
  return {
    ...settings,
    trial_enabled: Boolean(settings.trial_enabled === 1),
  };
}

/**
 * Update dynamic subscription settings in database (Admin only)
 */
function updateSubscriptionSettings({ trial_enabled, trial_duration_days, updated_by = 'admin', notes = '' }) {
  const db = getDb();
  const current = getSubscriptionSettings();

  const enabledVal = trial_enabled !== undefined ? (trial_enabled ? 1 : 0) : (current.trial_enabled ? 1 : 0);
  let durationVal = trial_duration_days !== undefined ? parseInt(trial_duration_days, 10) : current.trial_duration_days;

  if (isNaN(durationVal) || durationVal < 1) {
    throw new Error('Trial duration must be a positive integer greater than or equal to 1.');
  }

  const nowIso = new Date().toISOString();

  db.transaction(() => {
    db.prepare(`
      UPDATE subscription_settings
      SET trial_enabled = ?, trial_duration_days = ?, updated_at = ?, updated_by = ?, notes = ?
      WHERE id = 1
    `).run(enabledVal, durationVal, nowIso, String(updated_by), String(notes || ''));

    // Record audit log
    db.prepare(`
      INSERT INTO subscription_audit_logs (action, target_type, target_id, performed_by, details)
      VALUES ('update_settings', 'settings', '1', ?, ?)
    `).run(
      String(updated_by),
      JSON.stringify({
        previous: { trial_enabled: current.trial_enabled, trial_duration_days: current.trial_duration_days },
        updated: { trial_enabled: Boolean(enabledVal === 1), trial_duration_days: durationVal },
        notes,
      })
    );
  })();

  return getSubscriptionSettings();
}

/**
 * Authoritative subscription validation logic against server UTC time.
 *
 * Rule: valid = status === 'active' AND currentServerTime < expiresAt
 *
 * Distinguishes:
 * - active
 * - expired
 * - disabled
 * - revoked
 * - missing
 * - invalid
 *
 * @param {Object} sub - Database subscription row
 * @param {Date|string|number} [testServerTime] - Optional test clock (for deterministic automated testing)
 */
function validateSubscription(sub, testServerTime = null) {
  const serverTime = testServerTime ? new Date(testServerTime) : new Date();
  const serverTimeIso = serverTime.toISOString();

  if (!sub) {
    return {
      is_valid: false,
      status: 'missing',
      reason: 'No subscription found for this device installation.',
      server_time: serverTimeIso,
    };
  }

  // Check malformed or invalid data
  if (!sub.starts_at || !sub.expires_at) {
    return {
      is_valid: false,
      status: 'invalid',
      reason: 'Malformed subscription dates in database record.',
      server_time: serverTimeIso,
      subscription: sub,
    };
  }

  const expiresDate = new Date(sub.expires_at);
  const startsDate = new Date(sub.starts_at);
  if (isNaN(expiresDate.getTime()) || isNaN(startsDate.getTime())) {
    return {
      is_valid: false,
      status: 'invalid',
      reason: 'Invalid timestamp format in subscription record.',
      server_time: serverTimeIso,
      subscription: sub,
    };
  }

  const rawStatus = String(sub.status || '').toLowerCase();

  // Manually disabled
  if (rawStatus === 'disabled') {
    return {
      is_valid: false,
      status: 'disabled',
      reason: 'Subscription has been manually disabled by administrator.',
      subscription_type: sub.subscription_type,
      starts_at: sub.starts_at,
      expires_at: sub.expires_at,
      server_time: serverTimeIso,
      installation_id: sub.installation_id,
      device_id: sub.device_id,
    };
  }

  // Revoked
  if (rawStatus === 'revoked') {
    return {
      is_valid: false,
      status: 'revoked',
      reason: 'Subscription has been revoked by administrator.',
      subscription_type: sub.subscription_type,
      starts_at: sub.starts_at,
      expires_at: sub.expires_at,
      server_time: serverTimeIso,
      installation_id: sub.installation_id,
      device_id: sub.device_id,
    };
  }

  // Expired status explicitly marked
  if (rawStatus === 'expired') {
    return {
      is_valid: false,
      status: 'expired',
      reason: 'Subscription expired on ' + sub.expires_at,
      subscription_type: sub.subscription_type,
      starts_at: sub.starts_at,
      expires_at: sub.expires_at,
      server_time: serverTimeIso,
      installation_id: sub.installation_id,
      device_id: sub.device_id,
    };
  }

  // Check temporal expiry against current server UTC time
  const remainingMs = expiresDate.getTime() - serverTime.getTime();
  if (remainingMs <= 0) {
    return {
      is_valid: false,
      status: 'expired',
      reason: `Subscription period ended at ${sub.expires_at} (current server time: ${serverTimeIso}).`,
      subscription_type: sub.subscription_type,
      starts_at: sub.starts_at,
      expires_at: sub.expires_at,
      duration_days: sub.duration_days,
      remaining_seconds: 0,
      remaining_days: 0,
      server_time: serverTimeIso,
      installation_id: sub.installation_id,
      device_id: sub.device_id,
    };
  }

  if (rawStatus !== 'active') {
    return {
      is_valid: false,
      status: rawStatus,
      reason: `Subscription status is ${rawStatus}.`,
      subscription_type: sub.subscription_type,
      starts_at: sub.starts_at,
      expires_at: sub.expires_at,
      server_time: serverTimeIso,
      installation_id: sub.installation_id,
      device_id: sub.device_id,
    };
  }

  // Subscription is active and valid
  const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const remainingDays = Math.ceil(remainingMs / (24 * 3600 * 1000));

  return {
    id: sub.id,
    is_valid: true,
    status: 'active',
    subscription_type: sub.subscription_type || 'trial',
    starts_at: sub.starts_at,
    expires_at: sub.expires_at,
    duration_days: sub.duration_days,
    remaining_seconds: remainingSeconds,
    remaining_days: remainingDays,
    source: sub.source,
    server_time: serverTimeIso,
    installation_id: sub.installation_id,
    device_id: sub.device_id,
    created_at: sub.created_at,
  };
}

/**
 * Get subscription by installation UUID or device ID
 */
function getSubscription(identifier, testServerTime = null) {
  if (!identifier) return null;
  const db = getDb();
  const clean = String(identifier).trim();

  let sub = db.prepare('SELECT * FROM subscriptions WHERE installation_id = ?').get(clean);
  if (!sub) {
    sub = db.prepare('SELECT * FROM subscriptions WHERE device_id = ?').get(clean);
  }
  if (!sub) return null;

  const validation = validateSubscription(sub, testServerTime);
  return {
    ...sub,
    validation,
  };
}

/**
 * Check if an installation or device is eligible for a free trial.
 * 
 * Rules:
 * - A device/installation is eligible if:
 *   1. System trial configuration is enabled (trial_enabled === 1).
 *   2. No subscription record exists in database for this installation_id or device_id.
 * - If an existing subscription (active, expired, disabled, revoked) is found, is_eligible is false.
 */
function checkTrialEligibility(installationId, deviceId) {
  const db = getDb();
  const cleanInstId = installationId ? String(installationId).trim() : null;
  const cleanDevId = deviceId ? String(deviceId).trim() : null;

  if (!cleanInstId && !cleanDevId) {
    return {
      is_eligible: false,
      reason: 'Installation ID or Device ID is required.',
      duration_days: 0,
      server_time: new Date().toISOString(),
    };
  }

  // 1. Check for existing subscription
  let existingSub = null;
  if (cleanInstId) {
    existingSub = db.prepare('SELECT * FROM subscriptions WHERE installation_id = ?').get(cleanInstId);
  }
  if (!existingSub && cleanDevId) {
    existingSub = db.prepare('SELECT * FROM subscriptions WHERE device_id = ?').get(cleanDevId);
  }

  if (existingSub) {
    const val = validateSubscription(existingSub);
    return {
      is_eligible: false,
      has_subscription: true,
      reason: val.is_valid
        ? 'Device already has an active subscription.'
        : (val.status === 'expired'
          ? 'Free trial has already expired for this device.'
          : `Device subscription status is ${val.status}.`),
      duration_days: existingSub.duration_days,
      subscription: val,
      server_time: new Date().toISOString(),
    };
  }

  // 2. Check global trial settings
  const settings = getSubscriptionSettings();
  if (!settings.trial_enabled) {
    return {
      is_eligible: false,
      has_subscription: false,
      reason: 'Free trials are currently unavailable.',
      duration_days: 0,
      server_time: new Date().toISOString(),
    };
  }

  return {
    is_eligible: true,
    has_subscription: false,
    duration_days: settings.trial_duration_days,
    reason: 'Device is eligible for a free trial.',
    server_time: new Date().toISOString(),
  };
}

/**
 * Atomically activate free trial when user taps "Activate Free Trial".
 * 
 * Guarantees:
 * - Atomic inside database transaction.
 * - Re-validates eligibility at the moment of execution.
 * - Concurrency safe against duplicate requests.
 * - Server UTC clock calculates starts_at and expires_at.
 * - Logs audit record in subscription_audit_logs.
 */
function activateTrial(installationId, deviceId) {
  if (!installationId) {
    throw new Error('installationId is required to activate trial.');
  }

  const db = getDb();
  const cleanInstId = String(installationId).trim();
  const cleanDevId = deviceId ? String(deviceId).trim() : null;

  const tx = db.transaction((instId, devId) => {
    // 1. Check if installation UUID already has a subscription
    let existingSub = db.prepare('SELECT * FROM subscriptions WHERE installation_id = ?').get(instId);
    if (!existingSub && devId) {
      existingSub = db.prepare('SELECT * FROM subscriptions WHERE device_id = ?').get(devId);
    }

    if (existingSub) {
      const val = validateSubscription(existingSub);
      return {
        success: false,
        already_activated: true,
        created: false,
        error: {
          code: 'ALREADY_ACTIVATED',
          message: val.is_valid
            ? 'A subscription is already active on this device.'
            : 'A trial or subscription has already been activated for this device.',
        },
        subscription: val,
      };
    }

    // 2. Check dynamic subscription settings
    const settings = getSubscriptionSettings();
    if (!settings.trial_enabled || !settings.trial_duration_days || settings.trial_duration_days <= 0) {
      return {
        success: false,
        created: false,
        error: {
          code: 'TRIAL_DISABLED',
          message: 'Free trial issuance is currently disabled by administrator.',
        },
        subscription: null,
      };
    }

    // 3. Authoritative server UTC timestamps
    const now = new Date();
    const startsAt = now.toISOString();
    const durationDays = settings.trial_duration_days;
    const expiresAt = new Date(now.getTime() + durationDays * 24 * 3600 * 1000).toISOString();
    const effectiveDevId = devId || `DEV_${instId.substring(0, 8).toUpperCase()}`;

    // Ensure device row exists
    if (devId) {
      const devRow = db.prepare('SELECT id, installation_id FROM devices WHERE device_id = ?').get(devId);
      if (devRow) {
        if (!devRow.installation_id) {
          db.prepare('UPDATE devices SET installation_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(instId, devRow.id);
        }
      } else {
        db.prepare('INSERT OR IGNORE INTO devices (device_id, installation_id, status, id_lock) VALUES (?, ?, \'active\', 0)')
          .run(devId, instId);
      }
    }

    // 4. Insert subscription atomically
    const insertRes = db.prepare(`
      INSERT INTO subscriptions (
        installation_id, device_id, subscription_type, status,
        starts_at, expires_at, duration_days, source, created_at, updated_at, notes
      ) VALUES (?, ?, 'trial', 'active', ?, ?, ?, 'user_activation', ?, ?, ?)
    `).run(
      instId,
      effectiveDevId,
      startsAt,
      expiresAt,
      durationDays,
      startsAt,
      startsAt,
      `User-activated ${durationDays}-day free trial`
    );

    // 5. Audit log
    db.prepare(`
      INSERT INTO subscription_audit_logs (action, target_type, target_id, performed_by, details)
      VALUES ('activate_trial', 'subscription', ?, 'user', ?)
    `).run(
      instId,
      JSON.stringify({
        device_id: effectiveDevId,
        duration_days: durationDays,
        starts_at: startsAt,
        expires_at: expiresAt,
      })
    );

    const newSub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(insertRes.lastInsertRowid);
    const val = validateSubscription(newSub);

    return {
      success: true,
      created: true,
      subscription: val,
    };
  });

  return tx(cleanInstId, cleanDevId);
}

/**
 * Atomically create or retrieve free trial for an installation UUID.
 * 
 * Idempotency guarantees:
 * - If installationId already registered, returns existing subscription.
 * - Never restarts or extends existing trial.
 * - Concurrency safe via transactional execution & unique constraints.
 */
function createOrGetInstallationTrial(installationId, deviceId) {
  if (!installationId) {
    throw new Error('installationId is required for trial registration.');
  }

  const db = getDb();

  const tx = db.transaction((instId, devId) => {
    // 1. Check if installation UUID already has a subscription
    let existingSub = db.prepare('SELECT * FROM subscriptions WHERE installation_id = ?').get(instId);

    // 2. Fallback: check if deviceId already has a subscription
    if (!existingSub && devId) {
      existingSub = db.prepare('SELECT * FROM subscriptions WHERE device_id = ?').get(devId);
      if (existingSub) {
        // Link installation UUID to existing device subscription
        db.prepare('UPDATE subscriptions SET installation_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
          .run(instId, existingSub.id);
        if (devId) {
          db.prepare('UPDATE devices SET installation_id = ?, updated_at = datetime(\'now\') WHERE device_id = ?')
            .run(instId, devId);
        }
        existingSub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(existingSub.id);
      }
    }

    if (existingSub) {
      return {
        created: false,
        subscription: existingSub,
        validation: validateSubscription(existingSub),
      };
    }

    // 3. New installation: Load current trial configuration from database
    const settings = getSubscriptionSettings();

    // Verify trial is enabled and duration is valid
    if (!settings.trial_enabled || typeof settings.trial_duration_days !== 'number' || settings.trial_duration_days <= 0) {
      // Configuration disabled or invalid: record device without active trial
      return {
        created: false,
        trial_denied: true,
        reason: 'Free trials are currently disabled or invalid in system configuration.',
        subscription: null,
        validation: {
          is_valid: false,
          status: 'disabled',
          reason: 'Free trial issuance is currently disabled by administrator.',
          server_time: new Date().toISOString(),
          installation_id: instId,
          device_id: devId,
        },
      };
    }

    // 4. Calculate server-side UTC timestamps
    const now = new Date();
    const startsAt = now.toISOString();
    const durationDays = settings.trial_duration_days;
    const expiresAt = new Date(now.getTime() + durationDays * 24 * 3600 * 1000).toISOString();

    // Ensure device row exists
    if (devId) {
      const devRow = db.prepare('SELECT id, installation_id FROM devices WHERE device_id = ?').get(devId);
      if (devRow) {
        if (!devRow.installation_id) {
          db.prepare('UPDATE devices SET installation_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(instId, devRow.id);
        }
      } else {
        db.prepare('INSERT OR IGNORE INTO devices (device_id, installation_id, status, id_lock) VALUES (?, ?, \'active\', 0)')
          .run(devId, instId);
      }
    }

    // 5. Insert subscription record atomically
    const insertRes = db.prepare(`
      INSERT INTO subscriptions (
        installation_id, device_id, subscription_type, status,
        starts_at, expires_at, duration_days, source, created_at, updated_at, notes
      ) VALUES (?, ?, 'trial', 'active', ?, ?, ?, 'auto_trial', ?, ?, ?)
    `).run(
      instId,
      devId || `DEV_${instId.substring(0, 8).toUpperCase()}`,
      startsAt,
      expiresAt,
      durationDays,
      startsAt,
      startsAt,
      `Auto-granted ${durationDays}-day free trial`
    );

    // 6. Record audit log
    db.prepare(`
      INSERT INTO subscription_audit_logs (action, target_type, target_id, performed_by, details)
      VALUES ('create_trial', 'subscription', ?, 'system', ?)
    `).run(
      instId,
      JSON.stringify({
        device_id: devId,
        duration_days: durationDays,
        starts_at: startsAt,
        expires_at: expiresAt,
      })
    );

    const newSub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(insertRes.lastInsertRowid);
    return {
      created: true,
      subscription: newSub,
      validation: validateSubscription(newSub),
    };
  });

  return tx(installationId, deviceId);
}

/**
 * Admin update for an individual device/installation subscription.
 * 
 * Supports:
 * - Changing status ('active', 'disabled', 'revoked', 'expired')
 * - Changing duration_days
 * - Changing expires_at (explicit date/time)
 * - Changing subscription_type ('trial', 'paid', 'lifetime')
 * 
 * Validates all inputs and logs audit records.
 */
function adminUpdateSubscription(identifier, { status, expires_at, duration_days, subscription_type, notes = '' }, performedBy = 'admin') {
  if (!identifier) {
    throw new Error('Device ID or Installation UUID is required.');
  }

  const db = getDb();
  const current = getSubscription(identifier);
  if (!current) {
    throw new Error(`No subscription found for identifier "${identifier}".`);
  }

  // Validate status if provided
  let newStatus = current.status;
  if (status !== undefined) {
    const validStatuses = ['active', 'disabled', 'revoked', 'expired'];
    if (!validStatuses.includes(String(status).toLowerCase())) {
      throw new Error(`Invalid status "${status}". Must be one of: ${validStatuses.join(', ')}.`);
    }
    newStatus = String(status).toLowerCase();
  }

  // Validate subscription_type if provided
  let newType = current.subscription_type;
  if (subscription_type !== undefined) {
    const validTypes = ['trial', 'paid', 'lifetime'];
    if (!validTypes.includes(String(subscription_type).toLowerCase())) {
      throw new Error(`Invalid subscription type "${subscription_type}". Must be one of: ${validTypes.join(', ')}.`);
    }
    newType = String(subscription_type).toLowerCase();
  }

  // Validate expires_at or calculate from duration_days
  let newExpiresAt = current.expires_at;
  let newDurationDays = current.duration_days;

  if (expires_at !== undefined) {
    const parsedExp = new Date(expires_at);
    if (isNaN(parsedExp.getTime())) {
      throw new Error('Invalid expires_at timestamp. Must be a valid ISO8601 string.');
    }
    newExpiresAt = parsedExp.toISOString();
    // Recompute durationDays relative to starts_at
    const startsMs = new Date(current.starts_at).getTime();
    newDurationDays = Math.max(1, Math.round((parsedExp.getTime() - startsMs) / (24 * 3600 * 1000)));
  } else if (duration_days !== undefined) {
    const durNum = parseInt(duration_days, 10);
    if (isNaN(durNum) || durNum < 1) {
      throw new Error('duration_days must be a positive integer.');
    }
    newDurationDays = durNum;
    const startsMs = new Date(current.starts_at).getTime();
    newExpiresAt = new Date(startsMs + durNum * 24 * 3600 * 1000).toISOString();
  }

  const nowIso = new Date().toISOString();

  db.transaction(() => {
    db.prepare(`
      UPDATE subscriptions
      SET status = ?, subscription_type = ?, expires_at = ?, duration_days = ?, updated_at = ?, notes = ?
      WHERE id = ?
    `).run(
      newStatus,
      newType,
      newExpiresAt,
      newDurationDays,
      nowIso,
      notes || current.notes || '',
      current.id
    );

    // Record audit log
    db.prepare(`
      INSERT INTO subscription_audit_logs (action, target_type, target_id, performed_by, details)
      VALUES ('admin_edit_subscription', 'subscription', ?, ?, ?)
    `).run(
      current.installation_id,
      String(performedBy),
      JSON.stringify({
        previous: {
          status: current.status,
          subscription_type: current.subscription_type,
          expires_at: current.expires_at,
          duration_days: current.duration_days,
        },
        updated: {
          status: newStatus,
          subscription_type: newType,
          expires_at: newExpiresAt,
          duration_days: newDurationDays,
          notes,
        },
      })
    );
  })();

  return getSubscription(current.installation_id);
}

/**
 * Admin: Get all devices with their subscription details and playlist counts.
 */
function adminGetAllDevices({ search = '', limit = 100, offset = 0 } = {}) {
  const db = getDb();
  let query = `
    SELECT 
      d.id,
      d.device_id,
      d.installation_id,
      d.status as device_status,
      d.created_at as device_created_at,
      d.last_seen_at,
      d.id_lock,
      s.id as subscription_id,
      s.subscription_type,
      s.status as subscription_status,
      s.starts_at,
      s.expires_at,
      s.duration_days,
      s.source as subscription_source,
      s.notes as subscription_notes,
      s.updated_at as subscription_updated_at,
      (SELECT COUNT(*) FROM device_playlists dp WHERE dp.device_id = d.device_id) as playlists_count
    FROM devices d
    LEFT JOIN subscriptions s ON (s.installation_id = d.installation_id OR s.device_id = d.device_id)
  `;

  const params = [];
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    query += ` WHERE d.device_id LIKE ? OR d.installation_id LIKE ? `;
    params.push(term, term);
  }

  query += ` ORDER BY d.last_seen_at DESC LIMIT ? OFFSET ? `;
  params.push(parseInt(limit, 10) || 100, parseInt(offset, 10) || 0);

  const rows = db.prepare(query).all(...params);

  // Augment with live server validation
  return rows.map((r) => {
    let validation = null;
    if (r.starts_at && r.expires_at) {
      validation = validateSubscription({
        status: r.subscription_status,
        starts_at: r.starts_at,
        expires_at: r.expires_at,
        duration_days: r.duration_days,
        subscription_type: r.subscription_type,
        installation_id: r.installation_id,
        device_id: r.device_id,
        source: r.subscription_source,
      });
    } else {
      validation = {
        is_valid: false,
        status: 'missing',
        reason: 'No subscription linked to this device.',
        server_time: new Date().toISOString(),
      };
    }

    return {
      id: r.id,
      device_id: r.device_id,
      installation_id: r.installation_id,
      device_status: r.device_status,
      device_created_at: r.device_created_at,
      last_seen_at: r.last_seen_at,
      id_lock: Boolean(r.id_lock === 1),
      playlists_count: r.playlists_count,
      subscription: {
        id: r.subscription_id,
        subscription_type: r.subscription_type || 'none',
        status: r.subscription_status || 'missing',
        starts_at: r.starts_at,
        expires_at: r.expires_at,
        duration_days: r.duration_days,
        source: r.subscription_source,
        notes: r.subscription_notes,
        updated_at: r.subscription_updated_at,
      },
      validation,
    };
  });
}

/**
 * Admin: Get overall statistics
 */
function adminGetSubscriptionStats() {
  const db = getDb();
  const settings = getSubscriptionSettings();

  const totalDevices = db.prepare('SELECT COUNT(*) as count FROM devices').get().count;
  const subscriptions = db.prepare('SELECT * FROM subscriptions').all();

  let activeTrials = 0;
  let activePaid = 0;
  let expiredCount = 0;
  let disabledCount = 0;
  let revokedCount = 0;

  for (const s of subscriptions) {
    const val = validateSubscription(s);
    if (val.is_valid) {
      if (s.subscription_type === 'trial') activeTrials++;
      else activePaid++;
    } else {
      if (val.status === 'expired') expiredCount++;
      else if (val.status === 'disabled') disabledCount++;
      else if (val.status === 'revoked') revokedCount++;
    }
  }

  return {
    totalDevices,
    totalSubscriptions: subscriptions.length,
    activeTrials,
    activePaid,
    expiredCount,
    disabledCount,
    revokedCount,
    currentTrialDurationDays: settings.trial_duration_days,
    trialEnabled: settings.trial_enabled,
    serverTime: new Date().toISOString(),
  };
}

module.exports = {
  isValidInstallationId,
  getSubscriptionSettings,
  updateSubscriptionSettings,
  validateSubscription,
  getSubscription,
  checkTrialEligibility,
  activateTrial,
  createOrGetInstallationTrial,
  adminUpdateSubscription,
  adminGetAllDevices,
  adminGetSubscriptionStats,
};
