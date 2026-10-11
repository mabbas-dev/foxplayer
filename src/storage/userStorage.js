import { STORAGE_KEYS, MAX_RECENTLY_WATCHED, getPlaylistFavoritesKey } from '../constants/index.js';
import { readCache, writeCache } from './cacheStorage';

// --- UNIFIED FAVORITES MODEL & HELPERS ---

/**
 * Normalizes content types to canonical 'movie' | 'series' | 'live'
 */
export function normalizeFavoriteType(type) {
  if (!type) return 'movie';
  const lower = String(type).toLowerCase();
  if (lower === 'channel' || lower === 'live' || lower === 'livetv' || lower === 'channels') {
    return 'live';
  }
  if (lower === 'series' || lower === 'show' || lower === 'shows') {
    return 'series';
  }
  return 'movie';
}

/**
 * Generate stable composite identity key: `${type}:${id}`
 * Prevents collisions between channel and movie IDs
 */
export function getFavoriteKey(type, id) {
  return `${normalizeFavoriteType(type)}:${String(id)}`;
}

/**
 * Creates a normalized Favorite record preserving essential metadata
 */
export function createUnifiedFavorite(item, typeOverride) {
  const type = normalizeFavoriteType(typeOverride || item.type);
  const rawId = item.id != null
    ? item.id
    : (item.streamId != null
        ? item.streamId
        : (item.seriesId != null
            ? item.seriesId
            : (item.series_id != null
                ? item.series_id
                : item.stream_id)));
  const id = String(rawId);
  const title = item.title || item.name || 'Untitled';
  const image = item.image || item.poster || item.logo || item.stream_icon || item.cover || item.movie_image || item.cover_big || '';

  return {
    id,
    type,
    title,
    image: image ? String(image) : '',
    streamId: item.streamId != null ? item.streamId : (item.stream_id != null ? item.stream_id : (type === 'movie' || type === 'live' ? rawId : undefined)),
    seriesId: item.seriesId != null ? item.seriesId : (item.series_id != null ? item.series_id : (type === 'series' ? rawId : undefined)),
    categoryId: item.categoryId != null ? String(item.categoryId) : (item.category_id != null ? String(item.category_id) : undefined),
    containerExtension: (type === 'live')
      ? ((item.containerExtension && item.containerExtension !== 'mp4')
          ? item.containerExtension
          : ((item.container_extension && item.container_extension !== 'mp4')
              ? item.container_extension
              : 'ts'))
      : (item.containerExtension || item.container_extension || 'mp4'),
    url: item.url || '',
    year: item.year != null ? String(item.year) : '',
    addedAt: item.addedAt || Date.now(),
  };
}

/**
 * Synchronize legacy storage keys in background for backward compatibility
 */
async function syncLegacyStorage(favorites) {
  try {
    const channels = favorites.filter((f) => f.type === 'live');
    const movies = favorites.filter((f) => f.type === 'movie');
    const series = favorites.filter((f) => f.type === 'series');

    await Promise.all([
      writeCache(STORAGE_KEYS.FAVORITES_CHANNELS, channels),
      writeCache(STORAGE_KEYS.FAVORITES_MOVIES, movies),
      writeCache(STORAGE_KEYS.FAVORITES_SERIES, series),
    ]);
  } catch (_e) {
    // Non-critical background sync
  }
}

/**
 * Fetch all favorites across Movies, Series, and Live TV.
 * Scoped by playlistId if provided.
 * Loads instantly from persistent file cache without network wait.
 * Automatically migrates existing legacy favorites if present.
 */
export async function getAllFavorites(playlistId = null) {
  const cacheKey = getPlaylistFavoritesKey(playlistId);
  const cached = await readCache(cacheKey, -1);
  if (Array.isArray(cached) && cached.length > 0) {
    return cached;
  }

  // For secondary or newly added playlists, start with empty favorites without inheriting another playlist's items
  if (playlistId && playlistId !== 'pl_default') {
    return [];
  }

  // If playlist-scoped cache is empty for default playlist, check legacy global cache for initial migration
  if (playlistId === 'pl_default') {
    const legacyGlobal = await readCache(STORAGE_KEYS.FAVORITES_ALL, -1);
    if (Array.isArray(legacyGlobal) && legacyGlobal.length > 0) {
      await writeCache(cacheKey, legacyGlobal);
      return legacyGlobal;
    }
  }

  // Check legacy keys for existing user favorites to migrate
  const [legacyChannels, legacyMovies, legacySeries] = await Promise.all([
    readCache(STORAGE_KEYS.FAVORITES_CHANNELS, -1),
    readCache(STORAGE_KEYS.FAVORITES_MOVIES, -1),
    readCache(STORAGE_KEYS.FAVORITES_SERIES, -1),
  ]);

  const unifiedList = [];
  const seenKeys = new Set();

  const addItems = (items, defaultType) => {
    if (Array.isArray(items)) {
      for (const it of items) {
        if (!it) continue;
        const unified = createUnifiedFavorite(it, it.type || defaultType);
        const key = getFavoriteKey(unified.type, unified.id);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          unifiedList.push(unified);
        }
      }
    }
  };

  addItems(legacyChannels, 'live');
  addItems(legacyMovies, 'movie');
  addItems(legacySeries, 'series');

  if (unifiedList.length > 0) {
    await writeCache(cacheKey, unifiedList);
    if (!playlistId) {
      await writeCache(STORAGE_KEYS.FAVORITES_ALL, unifiedList);
    }
  }

  return unifiedList;
}

/**
 * Get favorites filtered by content type ('movie' | 'series' | 'live' | 'channel')
 */
export async function getFavorites(type, playlistId = null) {
  const all = await getAllFavorites(playlistId);
  if (!type || type === 'all' || type === 'ALL') return all;
  const targetType = normalizeFavoriteType(type);
  return all.filter((item) => item.type === targetType);
}

/**
 * Toggle favorite item with unified persistence (playlist-scoped).
 * Flexible signature supports:
 * - toggleFavorite(item, playlistId?)
 * - toggleFavorite(type, item, playlistId?)
 * Returns boolean (true if added, false if removed).
 */
export async function toggleFavorite(typeOrItem, maybeItem, maybePlaylistId = null) {
  let item;
  let type;
  let playlistId = maybePlaylistId;

  if (maybeItem && typeof typeOrItem === 'string') {
    type = typeOrItem;
    item = maybeItem;
  } else {
    item = typeOrItem;
    type = item?.type;
    if (typeof maybeItem === 'string') {
      playlistId = maybeItem;
    }
  }

  const unified = createUnifiedFavorite(item, type);
  const targetKey = getFavoriteKey(unified.type, unified.id);
  const all = await getAllFavorites(playlistId);

  const existingIndex = all.findIndex((f) => getFavoriteKey(f.type, f.id) === targetKey);
  let updated;
  let isAdded = false;

  if (existingIndex >= 0) {
    updated = all.filter((_, idx) => idx !== existingIndex);
    isAdded = false;
  } else {
    updated = [unified, ...all];
    isAdded = true;
  }

  const cacheKey = getPlaylistFavoritesKey(playlistId);
  await writeCache(cacheKey, updated);
  if (!playlistId) {
    syncLegacyStorage(updated);
  }

  return isAdded;
}

/**
 * Remove a favorite item by type and id (playlist-scoped)
 */
export async function removeFavorite(type, id, playlistId = null) {
  const targetKey = getFavoriteKey(type, id);
  const all = await getAllFavorites(playlistId);
  const filtered = all.filter((f) => getFavoriteKey(f.type, f.id) !== targetKey);
  const cacheKey = getPlaylistFavoritesKey(playlistId);
  await writeCache(cacheKey, filtered);
  if (!playlistId) {
    syncLegacyStorage(filtered);
  }
  return filtered;
}

/**
 * Check if an item is favorited (playlist-scoped)
 */
export async function isFavorite(type, id, playlistId = null) {
  if (!id) return false;
  const targetKey = getFavoriteKey(type, id);
  const all = await getAllFavorites(playlistId);
  return all.some((f) => getFavoriteKey(f.type, f.id) === targetKey);
}

// --- RECENTLY WATCHED ---

export async function getRecentlyWatched() {
  const data = await readCache(STORAGE_KEYS.RECENTLY_WATCHED, -1);
  return Array.isArray(data) ? data : [];
}

export async function addRecentlyWatched(item) {
  const recent = await getRecentlyWatched();
  const normType = normalizeFavoriteType(item.type);
  const filtered = recent.filter((r) => !(String(r.id) === String(item.id) && normalizeFavoriteType(r.type) === normType));
  const updated = [
    {
      id: String(item.id),
      type: normType, // 'live' | 'movie' | 'series'
      name: item.name || item.title || '',
      logo: item.logo || null,
      poster: item.poster || item.image || null,
      watchedAt: Date.now(),
    },
    ...filtered,
  ].slice(0, MAX_RECENTLY_WATCHED);
  await writeCache(STORAGE_KEYS.RECENTLY_WATCHED, updated);
}

export async function clearRecentlyWatched() {
  await writeCache(STORAGE_KEYS.RECENTLY_WATCHED, []);
}
