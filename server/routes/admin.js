const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { apiLimiter } = require('../middleware/security');
const {
  getSubscriptionSettings,
  updateSubscriptionSettings,
  getSubscription,
  validateSubscription,
  adminUpdateSubscription,
  adminGetAllDevices,
  adminGetSubscriptionStats,
} = require('../models/subscriptionModel');
const { getDb } = require('../database/db');

// In-memory admin session store (sessionToken -> { createdAt, expiresAt })
const adminSessions = new Map();

function getAdminSecret() {
  return process.env.ADMIN_KEY || process.env.ADMIN_SECRET || process.env.API_SECRET || 'fox_admin_2026';
}

/**
 * Admin authorization middleware.
 * Verifies Bearer session token, x-admin-key header, or query token against configured admin credentials.
 * Rejects unauthenticated mobile clients and non-administrators.
 */
function verifyAdminAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = req.headers['x-admin-key'] || req.headers['x-admin-token'] || req.query.admin_token;

  if (!token && authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  const expectedSecret = getAdminSecret();

  // 1. Direct secret match
  if (token && token === expectedSecret) {
    req.adminUser = 'admin_root';
    return next();
  }

  // 2. Session token check
  if (token && adminSessions.has(token)) {
    const session = adminSessions.get(token);
    if (Date.now() < session.expiresAt) {
      req.adminUser = session.username || 'admin';
      return next();
    } else {
      adminSessions.delete(token);
    }
  }

  return res.status(401).json({
    success: false,
    error: {
      code: 'UNAUTHORIZED_ADMIN',
      message: 'Administrative authorization required. Valid admin credentials must be provided.',
    },
  });
}

// Admin login endpoint
router.post('/login', apiLimiter, (req, res) => {
  try {
    const { password, username } = req.body;
    const expectedSecret = getAdminSecret();

    if (!password || password !== expectedSecret) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect administrator password.' },
      });
    }

    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 24 * 3600 * 1000; // 24 hours

    adminSessions.set(sessionToken, {
      username: username || 'admin',
      createdAt: Date.now(),
      expiresAt,
    });

    res.json({
      success: true,
      token: sessionToken,
      expires_at: new Date(expiresAt).toISOString(),
    });
  } catch (e) {
    console.error('[Admin] Login error:', e.message);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Unable to process administrator login.' },
    });
  }
});

// Admin stats
router.get('/stats', apiLimiter, verifyAdminAuth, (req, res) => {
  try {
    const stats = adminGetSubscriptionStats();
    res.json({ success: true, stats });
  } catch (e) {
    console.error('[Admin] Stats error:', e.message);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: e.message } });
  }
});

// Get trial settings
router.get('/trial-settings', apiLimiter, verifyAdminAuth, (req, res) => {
  try {
    const settings = getSubscriptionSettings();
    res.json({ success: true, settings });
  } catch (e) {
    console.error('[Admin] Get settings error:', e.message);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: e.message } });
  }
});

// Update trial settings
router.put('/trial-settings', apiLimiter, verifyAdminAuth, (req, res) => {
  try {
    const { trial_enabled, trial_duration_days, notes } = req.body;

    const updated = updateSubscriptionSettings({
      trial_enabled,
      trial_duration_days,
      updated_by: req.adminUser || 'admin',
      notes,
    });

    console.log(`[Admin] Trial settings updated by ${req.adminUser}: enabled=${updated.trial_enabled}, duration=${updated.trial_duration_days}d`);

    res.json({
      success: true,
      message: 'Subscription settings updated successfully. New trial duration will apply to all subsequent new registrations.',
      settings: updated,
    });
  } catch (e) {
    console.error('[Admin] Update settings error:', e.message);
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: e.message },
    });
  }
});

// List all devices & installation UUIDs
router.get('/devices', apiLimiter, verifyAdminAuth, (req, res) => {
  try {
    const { search, limit, offset } = req.query;
    const devices = adminGetAllDevices({ search, limit, offset });
    res.json({
      success: true,
      count: devices.length,
      devices,
    });
  } catch (e) {
    console.error('[Admin] Get devices error:', e.message);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: e.message } });
  }
});

// Get single device & subscription
router.get('/devices/:identifier', apiLimiter, verifyAdminAuth, (req, res) => {
  try {
    const { identifier } = req.params;
    const sub = getSubscription(identifier);

    if (!sub) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `No subscription or device found for ${identifier}` },
      });
    }

    res.json({
      success: true,
      subscription: sub,
      validation: sub.validation,
    });
  } catch (e) {
    console.error('[Admin] Get device error:', e.message);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: e.message } });
  }
});

// Edit device subscription (duration, expiry, status, type)
router.put('/devices/:identifier/subscription', apiLimiter, verifyAdminAuth, (req, res) => {
  try {
    const { identifier } = req.params;
    const { status, expires_at, duration_days, subscription_type, notes } = req.body;

    const updated = adminUpdateSubscription(
      identifier,
      { status, expires_at, duration_days, subscription_type, notes },
      req.adminUser || 'admin'
    );

    console.log(`[Admin] Subscription updated for ${identifier}: status=${updated.status}, expires_at=${updated.expires_at}`);

    res.json({
      success: true,
      message: 'Subscription updated and validated successfully against server time.',
      subscription: updated,
      validation: updated.validation,
    });
  } catch (e) {
    console.error('[Admin] Edit subscription error:', e.message);
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: e.message },
    });
  }
});

// Test/validate subscription against server time (or mock test time for verification)
router.post('/devices/:identifier/validate', apiLimiter, verifyAdminAuth, (req, res) => {
  try {
    const { identifier } = req.params;
    const { test_server_time } = req.body;

    const sub = getSubscription(identifier, test_server_time || null);
    if (!sub) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Subscription for ${identifier} not found.` },
      });
    }

    res.json({
      success: true,
      identifier,
      validation: sub.validation,
      checked_against: test_server_time ? 'simulated_test_time' : 'actual_server_utc',
      server_time: sub.validation.server_time,
    });
  } catch (e) {
    console.error('[Admin] Validate subscription error:', e.message);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: e.message } });
  }
});

// Get audit logs
router.get('/audit-logs', apiLimiter, verifyAdminAuth, (req, res) => {
  try {
    const db = getDb();
    const limit = parseInt(req.query.limit, 10) || 50;
    const logs = db.prepare('SELECT * FROM subscription_audit_logs ORDER BY created_at DESC LIMIT ?').all(limit);
    res.json({ success: true, count: logs.length, logs });
  } catch (e) {
    console.error('[Admin] Audit logs error:', e.message);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: e.message } });
  }
});

module.exports = router;
