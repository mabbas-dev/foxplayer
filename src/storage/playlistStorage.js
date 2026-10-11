import { STORAGE_KEYS, CONFIG_TYPES } from '../constants';
import { readCache, writeCache, deleteCache } from './cacheStorage';
import { secureGet, secureSet, secureDelete } from './deviceStorage';

const PWD_PREFIX = 'fox_pl_pwd_';

/**
 * Normalizes playlist object representation
 */
export function normalizePlaylist(raw) {
  if (!raw) return null;
  const id = String(raw.id || raw.playlist_id || `pl_${Date.now()}`);
  const type = raw.type === CONFIG_TYPES.M3U ? CONFIG_TYPES.M3U : CONFIG_TYPES.XTREAM;
  const name =
    raw.name ||
    raw.playlist_name ||
    (type === CONFIG_TYPES.XTREAM ? (raw.username || 'Xtream IPTV') : 'M3U Playlist');

  return {
    id,
    name,
    type,
    serverUrl: raw.serverUrl || raw.server_url || '',
    server_url: raw.serverUrl || raw.server_url || '',
    username: raw.username || '',
    password: raw.password || '',
    playlistUrl: raw.playlistUrl || raw.playlist_url || '',
    playlist_url: raw.playlistUrl || raw.playlist_url || '',
    expirationDate: raw.expirationDate || null,
    status: raw.status || null,
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || Date.now(),
    lastUsedAt: raw.lastUsedAt || Date.now(),
    // Authoritative backend revision of this playlist's configuration (playlist_configs.updated_at).
    // Only changes when the configuration is saved on the backend; used for cache invalidation.
    remoteRevision: raw.remoteRevision || raw.updated_at || null,
  };
}

/**
 * Retrieve all saved playlists
 */
export async function getSavedPlaylists() {
  const cached = await readCache(STORAGE_KEYS.SAVED_PLAYLISTS, -1);
  if (!Array.isArray(cached) || cached.length === 0) {
    return [];
  }

  // Restore passwords securely from SecureStore if missing
  const playlists = await Promise.all(
    cached.map(async (pl) => {
      const normalized = normalizePlaylist(pl);
      if (!normalized) return null;
      if (!normalized.password && normalized.type === CONFIG_TYPES.XTREAM) {
        try {
          const pwd = await secureGet(`${PWD_PREFIX}${normalized.id}`);
          if (pwd) normalized.password = pwd;
        } catch (_e) {
          // Non-fatal
        }
      }
      return normalized;
    })
  );

  return playlists.filter(Boolean);
}

/**
 * Save or update a playlist in local storage
 */
export async function savePlaylist(playlistData) {
  const normalized = normalizePlaylist(playlistData);
  if (!normalized) return null;

  // Persist password securely in SecureStore
  if (normalized.password) {
    try {
      await secureSet(`${PWD_PREFIX}${normalized.id}`, normalized.password);
    } catch (e) {
      console.warn('[PlaylistStorage] SecureStore password save error:', e?.message);
    }
  }

  const existing = await getSavedPlaylists();
  let updatedList;

  // Check if matching playlist already exists STRICTLY by unique ID
  const strId = String(normalized.id);
  const existingIdx = existing.findIndex((p) => String(p.id) === strId);

  if (existingIdx >= 0) {
    const prev = existing[existingIdx];
    const merged = {
      ...prev,
      ...normalized,
      id: strId,
      password: normalized.password || prev.password || '',
      updatedAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    updatedList = [...existing];
    updatedList[existingIdx] = merged;
  } else {
    updatedList = [...existing, normalized];
  }

  // Save metadata to file cache
  await writeCache(STORAGE_KEYS.SAVED_PLAYLISTS, updatedList);

  return normalized;
}

/**
 * Synchronize local saved playlists with the authoritative backend playlist list.
 * - Preserves existing SecureStore passwords and cached passwords for each playlist ID.
 * - Retains EVERY valid remote playlist (guarantees all backend playlists appear in the app).
 * - Removes obsolete playlists that no longer exist on the remote device.
 * - Writes the authoritative list to persistent file cache.
 */
export async function syncSavedPlaylistsWithRemote(remotePlaylists) {
  if (!Array.isArray(remotePlaylists)) {
    return await getSavedPlaylists();
  }

  const existingLocal = await getSavedPlaylists();
  const existingMap = new Map();
  for (const pl of existingLocal) {
    if (pl && pl.id) {
      existingMap.set(String(pl.id), pl);
    }
  }

  const remoteIds = new Set();
  const reconciled = [];

  for (const raw of remotePlaylists) {
    const normalized = normalizePlaylist(raw);
    if (!normalized || !normalized.id) continue;

    const strId = String(normalized.id);
    remoteIds.add(strId);

    // Check if we have an existing local record with password
    const localPrev = existingMap.get(strId);
    let resolvedPassword = normalized.password || localPrev?.password || '';

    // If still no password and xtream, check SecureStore
    if (!resolvedPassword && normalized.type === CONFIG_TYPES.XTREAM) {
      try {
        const storedPwd = await secureGet(`${PWD_PREFIX}${strId}`);
        if (storedPwd) resolvedPassword = storedPwd;
      } catch (_e) {}
    }

    if (resolvedPassword) {
      normalized.password = resolvedPassword;
      try {
        await secureSet(`${PWD_PREFIX}${strId}`, resolvedPassword);
      } catch (_e) {}
    }

    reconciled.push({
      ...localPrev,
      ...normalized,
      id: strId,
      password: resolvedPassword,
      isActive: Boolean(raw.is_active || raw.isActive),
    });
  }

  // Clean up SecureStore passwords and caches for deleted playlists
  for (const localPl of existingLocal) {
    if (!remoteIds.has(String(localPl.id))) {
      try {
        await secureDelete(`${PWD_PREFIX}${localPl.id}`);
        await Promise.all([
          deleteCache(`fox_player_${localPl.id}_config`),
          deleteCache(`fox_player_${localPl.id}_channels`),
          deleteCache(`fox_player_${localPl.id}_movies`),
          deleteCache(`fox_player_${localPl.id}_series`),
          deleteCache(`fox_player_${localPl.id}_fav_all`),
        ]);
      } catch (_e) {}
    }
  }

  await writeCache(STORAGE_KEYS.SAVED_PLAYLISTS, reconciled);
  return reconciled;
}

/**
 * Get active playlist ID from storage
 */
export async function getActivePlaylistId() {
  const id = await readCache(STORAGE_KEYS.ACTIVE_PLAYLIST_ID, -1);
  return id ? String(id) : null;
}

/**
 * Set active playlist ID
 */
export async function setActivePlaylistId(playlistId) {
  if (!playlistId) return;
  const strId = String(playlistId);
  await writeCache(STORAGE_KEYS.ACTIVE_PLAYLIST_ID, strId);

  // Update lastUsedAt in playlist registry
  try {
    const existing = await getSavedPlaylists();
    const updated = existing.map((p) =>
      p.id === strId ? { ...p, lastUsedAt: Date.now() } : p
    );
    await writeCache(STORAGE_KEYS.SAVED_PLAYLISTS, updated);
  } catch (_e) {
    // Non-critical
  }
}

/**
 * Delete a playlist from storage
 */
export async function deletePlaylist(playlistId) {
  const strId = String(playlistId);
  const existing = await getSavedPlaylists();
  const filtered = existing.filter((p) => p.id !== strId);

  await writeCache(STORAGE_KEYS.SAVED_PLAYLISTS, filtered);

  // Clean up password from SecureStore
  try {
    await secureDelete(`${PWD_PREFIX}${strId}`);
  } catch (_e) {
    // Non-fatal
  }

  // Clean up cached data for this playlist
  try {
    await Promise.all([
      deleteCache(`fox_player_${strId}_config`),
      deleteCache(`fox_player_${strId}_channels`),
      deleteCache(`fox_player_${strId}_movies`),
      deleteCache(`fox_player_${strId}_series`),
      deleteCache(`fox_player_${strId}_fav_all`),
    ]);
  } catch (_e) {
    // Non-fatal
  }

  return filtered;
}

/**
 * Migrates existing single playlist if present and no playlists saved yet
 */
export async function migrateLegacyPlaylist(legacyConfigData) {
  if (!legacyConfigData) return null;
  const saved = await getSavedPlaylists();
  if (saved.length > 0) return saved[0];

  const type = legacyConfigData.type || CONFIG_TYPES.XTREAM;
  const conf = legacyConfigData.config || legacyConfigData;

  const legacyPlaylist = normalizePlaylist({
    id: 'pl_default',
    type,
    name: conf.playlist_name || (type === CONFIG_TYPES.XTREAM ? (conf.username || 'My Playlist') : 'My Playlist'),
    serverUrl: conf.server_url || conf.serverUrl,
    username: conf.username,
    password: conf.password,
    playlistUrl: conf.playlist_url || conf.playlistUrl,
    expirationDate: conf.expirationDate,
  });

  if (legacyPlaylist) {
    await savePlaylist(legacyPlaylist);
    await setActivePlaylistId(legacyPlaylist.id);
    return legacyPlaylist;
  }
  return null;
}
