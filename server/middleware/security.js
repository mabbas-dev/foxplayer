const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for the pairing/registration endpoints
 */
const pairingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT', message: 'Too many requests. Please wait before trying again.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for the API endpoints
 */
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT', message: 'Too many requests. Please wait before trying again.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Validate device ID format middleware
 */
function validateDeviceId(req, res, next) {
  const deviceId = req.params.deviceId || req.body.device_id || req.query['device-id'];
  if (!deviceId || !/^[A-Z0-9]{8}$/.test(deviceId)) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_DEVICE_ID', message: 'Invalid device ID.' },
    });
  }
  next();
}

/**
 * Sanitize input — strips dangerous characters
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input.trim().substring(0, 1000); // Limit length
}

/**
 * Management authorization middleware.
 * Verifies that the request carries a valid device management session token,
 * an active pairing token, or is an authenticated device self-request.
 */
function verifyManagementAuth(req, res, next) {
  const deviceId = req.params.deviceId || req.body.device_id || req.query['device-id'];
  const authHeader = req.headers['authorization'];
  let token = req.headers['x-session-token'] || req.headers['x-pairing-token'] || req.query.session_token || req.query.token || req.body.session_token || req.body.token;
  if (!token && authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  // 1. Allow app on the device itself if caller identifies as device
  const clientDeviceId = req.headers['x-device-id'] || req.headers['x-device-token'];
  if (clientDeviceId && deviceId && clientDeviceId === deviceId) {
    req.isAuthorized = true;
    req.authRole = 'device_self';
    return next();
  }

  // 2. Check session token in deviceModel
  const { verifyManagementSession, getDevice } = require('../models/deviceModel');
  if (token && verifyManagementSession(deviceId, token)) {
    req.isAuthorized = true;
    req.authRole = 'manager';
    return next();
  }

  // 3. Check if token matches active pairing token directly
  if (token && deviceId) {
    const dev = getDevice(deviceId);
    if (dev) {
      const clean = String(token).trim();
      if ((dev.pairing_token && dev.pairing_token === clean) || (dev.pairing_code && dev.pairing_code === clean)) {
        req.isAuthorized = true;
        req.authRole = 'paired';
        return next();
      }
    }
  }

  return res.status(401).json({
    success: false,
    error: {
      code: 'UNAUTHORIZED',
      message: 'Unauthorized management session for this device.',
    },
  });
}

module.exports = { pairingLimiter, apiLimiter, validateDeviceId, sanitizeInput, verifyManagementAuth };


