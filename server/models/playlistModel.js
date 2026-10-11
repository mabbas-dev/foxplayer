const crypto = require('crypto');
const { getDb } = require('../database/db');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'foxplayer_default_dev_key_32bytes!';
const ALGORITHM = 'aes-256-gcm';
const KEY = crypto.scryptSync(ENCRYPTION_KEY, 'foxplayer_salt_v1', 32);

/**
 * Encrypt a credential string
 */
function encryptCredential(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a credential string
 */
function decryptCredential(ciphertext) {
  if (!ciphertext) return null;
  try {
    const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final('utf8');
  } catch (_e) {
    return null;
  }
}

/**
 * Inspects whether an M3U URL is an Xtream-style credential-bearing endpoint.
 * Returns { serverUrl, username, password, type, output } or null.
 */
function parseXtreamCredentialsFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const trimmed = url.trim();
    const parsed = new URL(trimmed);
    const serverUrl = `${parsed.protocol}//${parsed.host}`;

    const userParam = parsed.searchParams.get('username') || parsed.searchParams.get('user');
    const passParam = parsed.searchParams.get('password') || parsed.searchParams.get('pass');

    if (userParam && passParam) {
      return {
        isXtream: true,
        serverUrl,
        username: userParam.trim(),
        password: passParam.trim(),
        type: parsed.searchParams.get('type') || 'm3u_plus',
        output: parsed.searchParams.get('output') || 'ts',
      };
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length >= 3) {
      const first = segments[0].toLowerCase();
      if (first === 'playlist' || first === 'get') {
        const username = segments[1];
        const password = segments[2];
        if (username && password && !username.includes('.') && !password.includes('.')) {
          return {
            isXtream: true,
            serverUrl,
            username: decodeURIComponent(username).trim(),
            password: decodeURIComponent(password).trim(),
            type: segments[3] || 'm3u_plus',
            output: 'ts',
          };
        }
      }
    }
  } catch (_e) {}
  return null;
}

/**
 * Extract safe hostname or base URL without credentials or sensitive query params
 */
function getSafeServerHost(type, serverUrl, playlistUrl) {
  const raw = type === 'xtream' ? serverUrl : playlistUrl;
  if (!raw) return 'Unknown Server';
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (_e) {
    return String(raw).split('?')[0].replace(/\/+$/, '');
  }
}

/**
 * Save or update playlist configuration for a device
 * If config matches existing (by id, or by server_url+username / playlist_url), updates it.
 * Otherwise, inserts a new playlist record.
 * Automatically marks the newly saved playlist as active (is_active = 1).
 */
function savePlaylistConfig(deviceId, configData) {
  const db = getDb();

  const type = configData.type || configData.playlistType || (configData.server_url || configData.serverUrl ? 'xtream' : 'm3u');
  const playlist_url = configData.playlist_url || configData.playlistUrl || configData.m3uUrl || null;
  const playlist_name = configData.playlist_name || configData.playlistName || null;
  let server_url = configData.server_url || configData.serverUrl || null;
  let username = configData.username || null;
  let password = configData.password || null;
  const targetId = configData.id || configData.playlist_id || configData.playlistId || null;

  // If M3U URL contains embedded Xtream credentials and they weren't explicitly provided, extract and preserve them
  if (type === 'm3u' && playlist_url && (!username || !password)) {
    const creds = parseXtreamCredentialsFromUrl(playlist_url);
    if (creds && creds.serverUrl && creds.username && creds.password) {
      if (!server_url) server_url = creds.serverUrl;
      if (!username) username = creds.username;
      if (!password) password = creds.password;
    }
  }

  const passwordEncrypted = password ? encryptCredential(password) : null;

  // Derive sensible default name if not provided
  let resolvedName = playlist_name ? playlist_name.trim() : '';
  if (!resolvedName) {
    if (type === 'xtream') {
      try {
        const parsedUrl = new URL(server_url);
        resolvedName = username ? `${username} (${parsedUrl.hostname})` : parsedUrl.hostname;
      } catch (_e) {
        resolvedName = username || 'Xtream IPTV';
      }
    } else {
      resolvedName = 'M3U Playlist';
    }
  }

  let savedId = null;

  db.transaction(() => {
    // 0. Atomic ID Lock check inside transaction (race condition safeguard)
    const devLock = db.prepare('SELECT id_lock FROM devices WHERE device_id = ?').get(deviceId);
    if (devLock && devLock.id_lock === 1) {
      const err = new Error('Playlist management is locked for this device. Please disable ID Lock in Fox Player Settings.');
      err.code = 'DEVICE_LOCKED';
      throw err;
    }

    // 1. Check for existing record in playlist_configs
    let existing = null;
    if (targetId) {
      existing = db.prepare('SELECT id FROM playlist_configs WHERE device_id = ? AND id = ?').get(deviceId, targetId);
    } else {
      // Guard against rapid duplicate submission (within 2 seconds with exact same name and credentials)
      const recentDup = db.prepare(`
        SELECT id FROM playlist_configs 
        WHERE device_id = ? AND type = ? AND playlist_name = ?
          AND created_at >= datetime('now', '-2 seconds')
      `).get(deviceId, type, resolvedName);
      if (recentDup) {
        existing = recentDup;
      }
    }

    // 2. Set all other playlists for this device to inactive
    db.prepare('UPDATE playlist_configs SET is_active = 0 WHERE device_id = ?').run(deviceId);

    try {
      db.prepare('UPDATE device_playlists SET is_active = 0 WHERE device_id = ?').run(deviceId);
    } catch (_e) {}

    if (existing) {
      // UPDATE existing playlist
      savedId = existing.id;
      db.prepare(`
        UPDATE playlist_configs SET
          type = COALESCE(?, type),
          playlist_url = COALESCE(?, playlist_url),
          playlist_name = COALESCE(?, playlist_name),
          server_url = COALESCE(?, server_url),
          username = COALESCE(?, username),
          password_encrypted = COALESCE(?, password_encrypted),
          updated_at = datetime('now'),
          last_used_at = datetime('now'),
          is_active = 1,
          enabled = 1
        WHERE id = ?
      `).run(
        configData.type || null,
        playlist_url ? playlist_url.trim() : null,
        playlist_name ? playlist_name.trim() : null,
        server_url ? server_url.trim() : null,
        username ? username.trim() : null,
        passwordEncrypted,
        savedId
      );
    } else {
      // INSERT new playlist
      const info = db.prepare(`
        INSERT INTO playlist_configs (
          device_id, type, playlist_url, playlist_name, server_url, username, password_encrypted, is_active, last_used_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
      `).run(
        deviceId,
        type,
        playlist_url ? playlist_url.trim() : null,
        resolvedName,
        server_url ? server_url.trim() : null,
        username ? username.trim() : null,
        passwordEncrypted
      );
      savedId = info.lastInsertRowid;
    }

    // 3. Keep normalized playlists & device_playlists tables synchronized
    try {
      let sharedPlaylistId = null;
      if (type === 'xtream' && server_url && username) {
        const pMatch = db.prepare(
          "SELECT id FROM playlists WHERE type = 'xtream' AND server_url = ? AND username = ?"
        ).get(server_url.trim(), username.trim());
        if (pMatch) sharedPlaylistId = pMatch.id;
      } else if (type === 'm3u' && playlist_url) {
        const pMatch = db.prepare(
          "SELECT id FROM playlists WHERE type = 'm3u' AND playlist_url = ?"
        ).get(playlist_url.trim());
        if (pMatch) sharedPlaylistId = pMatch.id;
      }

      if (sharedPlaylistId) {
        db.prepare(`
          UPDATE playlists SET
            password_encrypted = COALESCE(?, password_encrypted),
            updated_at = datetime('now')
          WHERE id = ?
        `).run(passwordEncrypted, sharedPlaylistId);
      } else {
        const pInfo = db.prepare(`
          INSERT INTO playlists (type, playlist_url, server_url, username, password_encrypted)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          type,
          playlist_url ? playlist_url.trim() : null,
          server_url ? server_url.trim() : null,
          username ? username.trim() : null,
          passwordEncrypted
        );
        sharedPlaylistId = pInfo.lastInsertRowid;
      }

      // Upsert device_playlists association
      const assoc = db.prepare(
        'SELECT id FROM device_playlists WHERE device_id = ? AND playlist_id = ?'
      ).get(deviceId, sharedPlaylistId);

      if (assoc) {
        db.prepare(`
          UPDATE device_playlists SET
            playlist_name = ?,
            is_active = 1,
            updated_at = datetime('now'),
            last_used_at = datetime('now')
          WHERE id = ?
        `).run(resolvedName, assoc.id);
      } else {
        db.prepare(`
          INSERT INTO device_playlists (device_id, playlist_id, playlist_name, is_active, last_used_at)
          VALUES (?, ?, ?, 1, datetime('now'))
        `).run(deviceId, sharedPlaylistId, resolvedName);
      }
    } catch (_e) {}

    // Log sync
    db.prepare(`
      INSERT INTO playlist_sync_logs (device_id, status) VALUES (?, 'success')
    `).run(deviceId);
  })();

  return { success: true, playlist_id: String(savedId) };
}

/**
 * Get all playlists configured for a device (sanitized — no passwords)
 */
function getAllPlaylists(deviceId) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, device_id, type, playlist_url, playlist_name, server_url, username,
            created_at, updated_at, is_active, last_used_at
     FROM playlist_configs
     WHERE device_id = ? AND enabled = 1
     ORDER BY is_active DESC, updated_at DESC`
  ).all(deviceId);

  return rows.map((r) => ({
    id: String(r.id),
    name: r.playlist_name || (r.type === 'xtream' ? (r.username || 'Xtream') : 'M3U Playlist'),
    type: r.type,
    playlist_url: r.playlist_url,
    playlistUrl: r.playlist_url,
    playlist_name: r.playlist_name,
    server_url: r.server_url,
    serverUrl: r.server_url,
    server_hostname: getSafeServerHost(r.type, r.server_url, r.playlist_url),
    username: r.username,
    is_active: r.is_active === 1,
    isActive: r.is_active === 1,
    status: r.is_active === 1 ? 'Active' : 'Configured',
    created_at: r.created_at,
    updated_at: r.updated_at,
    last_used_at: r.last_used_at,
  }));
}

/**
 * Get playlist configuration for a device
 * If playlistId specified, gets that specific playlist.
 * Otherwise returns the currently active playlist (or latest).
 */
function getPlaylistConfig(deviceId, playlistId = null) {
  const db = getDb();
  let config;

  if (playlistId) {
    config = db.prepare(
      'SELECT * FROM playlist_configs WHERE device_id = ? AND id = ? AND enabled = 1'
    ).get(deviceId, playlistId);
  } else {
    // Select active playlist first, fallback to latest updated
    config = db.prepare(
      'SELECT * FROM playlist_configs WHERE device_id = ? AND enabled = 1 ORDER BY is_active DESC, updated_at DESC LIMIT 1'
    ).get(deviceId);
  }

  if (!config) return null;

  // Decrypt password for internal use (when returning config to app)
  const decryptedPassword = config.password_encrypted ? decryptCredential(config.password_encrypted) : null;

  return {
    id: String(config.id),
    type: config.type,
    playlist_url: config.playlist_url,
    playlistUrl: config.playlist_url,
    playlist_name: config.playlist_name || (config.type === 'xtream' ? (config.username || 'Xtream') : 'M3U Playlist'),
    server_url: config.server_url,
    serverUrl: config.server_url,
    server_hostname: getSafeServerHost(config.type, config.server_url, config.playlist_url),
    username: config.username,
    password: decryptedPassword,
    is_active: config.is_active === 1,
    status: config.is_active === 1 ? 'Active' : 'Configured',
    created_at: config.created_at,
    updated_at: config.updated_at,
    last_used_at: config.last_used_at,
    enabled: config.enabled === 1,
  };
}

/**
 * Set a specific playlist as active for a device
 */
function setActivePlaylist(deviceId, playlistId) {
  const db = getDb();
  let activated = null;

  db.transaction(() => {
    db.prepare('UPDATE playlist_configs SET is_active = 0 WHERE device_id = ?').run(deviceId);
    const result = db.prepare(
      'UPDATE playlist_configs SET is_active = 1, last_used_at = datetime(\'now\') WHERE device_id = ? AND id = ?'
    ).run(deviceId, playlistId);

    try {
      db.prepare('UPDATE device_playlists SET is_active = 0 WHERE device_id = ?').run(deviceId);
      db.prepare(`
        UPDATE device_playlists SET is_active = 1, last_used_at = datetime('now')
        WHERE device_id = ? AND (id = ? OR playlist_id = ?)
      `).run(deviceId, playlistId, playlistId);
    } catch (_e) {}

    if (result.changes > 0) {
      activated = getPlaylistConfig(deviceId, playlistId);
    }
  })();

  return activated;
}

/**
 * Delete a playlist for a device
 * Handles shared vs exclusive playlists:
 * Deletes the device association. If no other device references this playlist,
 * cleans up the shared playlist record.
 */
function deletePlaylist(deviceId, playlistId) {
  const db = getDb();
  let success = false;

  db.transaction(() => {
    // 0. Atomic ID Lock check inside transaction (race condition safeguard)
    const devLock = db.prepare('SELECT id_lock FROM devices WHERE device_id = ?').get(deviceId);
    if (devLock && devLock.id_lock === 1) {
      const err = new Error('Playlist management is locked for this device. Please disable ID Lock in Fox Player Settings.');
      err.code = 'DEVICE_LOCKED';
      throw err;
    }

    const target = db.prepare('SELECT id, is_active, type, server_url, username, playlist_url FROM playlist_configs WHERE device_id = ? AND id = ?').get(deviceId, playlistId);
    if (!target) return;

    // Delete from playlist_configs
    db.prepare('DELETE FROM playlist_configs WHERE device_id = ? AND id = ?').run(deviceId, playlistId);
    success = true;

    // Manage normalized device_playlists and playlists
    try {
      // Find matching playlist ID in playlists
      let sharedPlaylistId = null;
      if (target.type === 'xtream' && target.server_url && target.username) {
        const pMatch = db.prepare(
          "SELECT id FROM playlists WHERE type = 'xtream' AND server_url = ? AND username = ?"
        ).get(target.server_url.trim(), target.username.trim());
        if (pMatch) sharedPlaylistId = pMatch.id;
      } else if (target.type === 'm3u' && target.playlist_url) {
        const pMatch = db.prepare(
          "SELECT id FROM playlists WHERE type = 'm3u' AND playlist_url = ?"
        ).get(target.playlist_url.trim());
        if (pMatch) sharedPlaylistId = pMatch.id;
      }

      if (sharedPlaylistId) {
        // Delete device association
        db.prepare('DELETE FROM device_playlists WHERE device_id = ? AND playlist_id = ?').run(deviceId, sharedPlaylistId);

        // Check if any other device references this playlist
        const refs = db.prepare('SELECT COUNT(*) as count FROM device_playlists WHERE playlist_id = ?').get(sharedPlaylistId);
        if (refs && refs.count === 0) {
          // No other device uses this playlist, clean it up completely
          db.prepare('DELETE FROM playlists WHERE id = ?').run(sharedPlaylistId);
        }
      }
    } catch (_e) {}

    // If active playlist was deleted, activate the latest remaining one
    if (target.is_active === 1) {
      const remaining = db.prepare(
        'SELECT id FROM playlist_configs WHERE device_id = ? AND enabled = 1 ORDER BY updated_at DESC LIMIT 1'
      ).get(deviceId);
      if (remaining) {
        db.prepare('UPDATE playlist_configs SET is_active = 1, last_used_at = datetime(\'now\') WHERE id = ?').run(remaining.id);
        try {
          db.prepare(`
            UPDATE device_playlists SET is_active = 1, last_used_at = datetime('now')
            WHERE device_id = ? AND (id = ? OR playlist_id = ?)
          `).run(deviceId, remaining.id, remaining.id);
        } catch (_e) {}
      }
    }
  })();

  return success;
}

/**
 * Get sanitized config for website display (no password)
 */
function getPublicPlaylistConfig(deviceId, playlistId = null) {
  const config = getPlaylistConfig(deviceId, playlistId);
  if (!config) return null;
  const { password, ...safeConfig } = config; // Strip password
  return safeConfig;
}

module.exports = {
  savePlaylistConfig,
  getAllPlaylists,
  getPlaylistConfig,
  setActivePlaylist,
  deletePlaylist,
  getPublicPlaylistConfig,
  getSafeServerHost,
  encryptCredential,
  decryptCredential,
};

