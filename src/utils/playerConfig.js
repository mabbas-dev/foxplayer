import { logPlayer, redactString } from './diagnostics.js';

let Platform = { OS: 'ios', select: (obj) => (obj ? (obj.ios || obj.default) : undefined) };
try {
  const RN = require('react-native');
  if (RN && RN.Platform) Platform = RN.Platform;
} catch (_e) {}

/**
 * FOX PLAYER — Platform-Specific Player Architecture
 *
 * Separates Android (Media3/ExoPlayer) and iOS (AVFoundation/AVPlayer)
 * configurations, buffering strategies, and native surface properties.
 */

/**
 * Returns native buffer configuration tailored to the host platform and stream type.
 *
 * For iOS (AVPlayer):
 * - Live TV: preferredForwardBufferDuration = 1.0s, waitsToMinimizeStalling = false
 *   avoids 30-60s pre-buffering stall and plays as soon as first HLS segment arrives.
 * - VOD (Movies & Series): preferredForwardBufferDuration = 2.0s, waitsToMinimizeStalling = false
 *   ensures rapid initial playback with smooth onward streaming.
 *
 * For Android (Media3 / ExoPlayer):
 * - Preserves standard buffer parameters (fast startup + stable playback).
 *
 * @param {Object} options
 * @param {'live' | 'movie' | 'series' | string} [options.type='movie']
 * @param {boolean} [options.isLive=false]
 * @param {string} [options.platform=Platform.OS]
 * @returns {Object} BufferOptions object passed to player.bufferOptions
 */
export function getPlatformBufferOptions({
  type = 'movie',
  isLive = false,
  platform = Platform.OS,
  enableStallRecovery = false,
} = {}) {
  const live = isLive || type === 'live' || type === 'channel';

  if (platform === 'ios') {
    if (enableStallRecovery) {
      return {
        preferredForwardBufferDuration: live ? 2.5 : 4.0,
        waitsToMinimizeStalling: true,
      };
    }
    return {
      preferredForwardBufferDuration: live ? 1.0 : 2.0,
      waitsToMinimizeStalling: false,
    };
  }

  // Android Media3 / ExoPlayer buffer options
  return {
    preferredForwardBufferDuration: live ? 3.0 : 10.0,
    minBufferForPlayback: live ? 1.0 : 2.5,
  };
}

/**
 * Returns player initialization configuration tailored to the host platform.
 *
 * @param {Object} options
 * @param {'live' | 'movie' | 'series' | string} [options.type='movie']
 * @param {boolean} [options.isLive=false]
 * @param {string} [options.platform=Platform.OS]
 * @returns {Object} Setup options applied to expo-video player instance
 */
export function getPlatformPlayerOptions({ type = 'movie', isLive = false, platform = Platform.OS } = {}) {
  const bufferOptions = getPlatformBufferOptions({ type, isLive, platform });

  if (platform === 'ios') {
    // iOS AVPlayer-specific setup:
    // - timeUpdateEventInterval: 0.25s (balanced UI time updates without flooding JS bridge)
    // - loop: false (live streams should never loop, preventing AVPlayer seek-to-zero stalls)
    // - staysActiveInBackground: false to prevent orphaned audio sessions
    // - bufferOptions: optimized for low latency and zero stalling wait
    // - audioMixingMode: 'doNotMix' configures AVAudioSession playback to ignore hardware silent switch
    return {
      loop: false,
      timeUpdateEventInterval: 0.25,
      staysActiveInBackground: false,
      audioMixingMode: 'doNotMix',
      bufferOptions,
    };
  }

  // Android Media3 / ExoPlayer setup:
  return {
    loop: false,
    timeUpdateEventInterval: 0.25,
    staysActiveInBackground: false,
    audioMixingMode: 'doNotMix',
    bufferOptions,
  };
}

/**
 * Returns native VideoView props appropriate for the host OS.
 *
 * @param {Object} options
 * @param {string} [options.contentFit='contain']
 * @param {boolean} [options.isMini=false]
 * @returns {Object} Props to spread onto <VideoView />
 */
export function getPlatformVideoViewProps({ contentFit = 'contain', isMini = false } = {}) {
  const baseProps = {
    contentFit,
    nativeControls: false,
    pointerEvents: 'none',
  };

  if (Platform.OS === 'android') {
    // Android ExoPlayer-specific surface props:
    // surfaceType: 'textureView' prevents SurfaceView black screen / clipping issues in React Native
    // useExoShutter: false prevents black flicker between streams on Android
    return {
      ...baseProps,
      surfaceType: 'textureView',
      useExoShutter: false,
      fullscreenOptions: { enable: !isMini },
    };
  }

  // iOS AVPlayer-specific view props:
  // Do NOT pass useExoShutter to iOS (Android-only prop).
  return {
    ...baseProps,
    fullscreenOptions: { enable: !isMini },
  };
}

/**
 * Sanitizes and encodes media URLs for native player consumption.
 * Encodes unescaped characters (spaces, brackets, unicode) that cause iOS NSURL to fail.
 * Preserves already-encoded characters.
 *
 * @param {string} rawUrl
 * @returns {string} Safe encoded URL string
 */
export function sanitizeMediaUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  try {
    return encodeURI(decodeURI(trimmed));
  } catch (_e) {
    try {
      return encodeURI(trimmed);
    } catch (_e2) {
      return trimmed.replace(/\s+/g, '%20');
    }
  }
}

/**
 * Prepares a stream URL for platform-specific playback compatibility.
 * On iOS:
 * - Live streams ending in .ts are rewritten to .m3u8 (HLS) because AVPlayer
 *   cannot decode progressive raw MPEG-TS over HTTP.
 * - Encodes special characters so iOS NSURL creation does not return nil.
 * On Android:
 * - Preserves existing stream format (ExoPlayer natively decodes MPEG-TS and MKV).
 *
 * @param {string} rawUrl
 * @param {Object} options
 * @param {'live' | 'movie' | 'series' | string} [options.type]
 * @param {string} [options.extension]
 * @param {string} [options.platform=Platform.OS]
 * @returns {string} Platform-compatible stream URL
 */
export function prepareStreamUrlForPlatform(
  rawUrl,
  { type = '', extension = '', platform = Platform.OS, streamId = '' } = {}
) {
  if (!rawUrl) return '';
  let sanitized = sanitizeMediaUrl(rawUrl);

  const isLive = type === 'live' || type === 'channel' || sanitized.includes('/live/');

  // On iOS, Apple AVPlayer (AVFoundation) requires HLS (.m3u8) manifests for Live TV streaming.
  // Apple AVPlayer cannot decode progressive raw MPEG-TS (.ts) over plain HTTP (Code=-11850 / -12939).
  // For Xtream Codes and IPTV live streams, requesting .m3u8 directly targets the server's native HLS endpoint.
  if (platform === 'ios' && isLive) {
    // 1. Raw .ts rewrite -> .m3u8
    if (/\.ts(\?.*)?$/i.test(sanitized)) {
      sanitized = sanitized.replace(/\.ts(\?.*)?$/i, '.m3u8$1');
    }
    // 2. Query param output=ts -> output=m3u8
    if (sanitized.includes('output=ts')) {
      sanitized = sanitized.replace(/output=ts/gi, 'output=m3u8');
    }
    // 3. DASH .mpd on iOS live -> .m3u8
    if (/\.mpd(\?.*)?$/i.test(sanitized)) {
      sanitized = sanitized.replace(/manifest\.mpd/gi, 'manifest.m3u8').replace(/\.mpd(\?.*)?$/i, '.m3u8$1');
    }
    // 4. Extensionless live streams (e.g. /live/user/pass/123 or port-based channel without extension)
    if (sanitized.includes('/live/') && !sanitized.includes('.m3u8') && !sanitized.includes('.mp4')) {
      const queryIdx = sanitized.indexOf('?');
      if (queryIdx !== -1) {
        const pathPart = sanitized.slice(0, queryIdx);
        const queryPart = sanitized.slice(queryIdx);
        sanitized = `${pathPart.replace(/\.[a-zA-Z0-9]+$/, '')}.m3u8${queryPart}`;
      } else {
        sanitized = `${sanitized.replace(/\.[a-zA-Z0-9]+$/, '')}.m3u8`;
      }
    }
  }

  // On iOS, Apple AVPlayer cannot decode or open MKV (.mkv) container files (Code=-11828 / -12847 "This media format is not supported").
  // Xtream Codes IPTV servers natively provide MP4 container streams for movies and series when requested with .mp4.
  // When playing on iOS, transform .mkv, .avi, .flv, .webm, .wmv to .mp4 for VOD URLs so AVPlayer can natively open the container.
  if (platform === 'ios') {
    const isVod = !isLive || type === 'movie' || type === 'series' || type === 'vod' || sanitized.includes('/movie/') || sanitized.includes('/series/');

    if (isVod) {
      if (/\.mkv(\?.*)?$/i.test(sanitized) || extension === 'mkv') {
        sanitized = sanitized.replace(/\.mkv(\?.*)?$/i, '.mp4$1');
      } else if (/\.(avi|flv|webm|wmv)(\?.*)?$/i.test(sanitized)) {
        sanitized = sanitized.replace(/\.(avi|flv|webm|wmv)(\?.*)?$/i, '.mp4$2');
      } else if (/\.mpd(\?.*)?$/i.test(sanitized)) {
        sanitized = sanitized.replace(/\.mpd(\?.*)?$/i, '.m3u8$1');
      }
    }
  }

  return sanitized;
}

/**
 * Returns alternative fallback URL if primary stream URL fails or times out.
 * E.g., if .m3u8 fails, fallback to .ts; if .ts fails, fallback to .m3u8.
 * For VOD on iOS, if .mkv fails, fallback to .mp4; if .mp4 fails, fallback to .m3u8.
 *
 * @param {string} currentUrl
 * @param {Object} options
 * @param {boolean} [options.isLive=true]
 * @param {string} [options.platform=Platform.OS]
 * @returns {string | null}
 */
export function getStreamFallbackUrl(currentUrl, { isLive = true, platform = Platform.OS } = {}) {
  if (!currentUrl || typeof currentUrl !== 'string') return null;

  if (isLive) {
    if (/\.m3u8(\?.*)?$/i.test(currentUrl)) {
      return currentUrl.replace(/\.m3u8(\?.*)?$/i, '.ts$1');
    }
    if (/\.ts(\?.*)?$/i.test(currentUrl)) {
      return currentUrl.replace(/\.ts(\?.*)?$/i, '.m3u8$1');
    }
    if (/\.mpd(\?.*)?$/i.test(currentUrl)) {
      return currentUrl.replace(/\.mpd(\?.*)?$/i, '.m3u8$1');
    }
  } else if (platform === 'ios') {
    // On iOS, if MKV fails, try MP4
    if (/\.mkv(\?.*)?$/i.test(currentUrl)) {
      return currentUrl.replace(/\.mkv(\?.*)?$/i, '.mp4$1');
    }
    // If MP4 fails on iOS, try M3U8
    if (/\.mp4(\?.*)?$/i.test(currentUrl)) {
      return currentUrl.replace(/\.mp4(\?.*)?$/i, '.m3u8$1');
    }
    // If AVI / FLV fails on iOS, try MP4
    if (/\.(avi|flv|webm|wmv)(\?.*)?$/i.test(currentUrl)) {
      return currentUrl.replace(/\.(avi|flv|webm|wmv)(\?.*)?$/i, '.mp4$2');
    }
  } else {
    // On Android, if .mp4 fails, try .mkv
    if (/\.mp4(\?.*)?$/i.test(currentUrl)) {
      return currentUrl.replace(/\.mp4(\?.*)?$/i, '.mkv$1');
    }
    if (/\.mkv(\?.*)?$/i.test(currentUrl)) {
      return currentUrl.replace(/\.mkv(\?.*)?$/i, '.mp4$1');
    }
  }

  return null;
}

/**
 * Sanitizes a media URL for safe logging.
 * Strips usernames, passwords, authorization tokens, and credentials from both path and query parameters.
 *
 * @param {string} rawUrl
 * @returns {{ sanitizedUrl: string, hasQueryParams: boolean, host: string, protocol: string }}
 */
export function sanitizePlaybackUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { sanitizedUrl: '', hasQueryParams: false, host: 'UNKNOWN', protocol: 'UNKNOWN' };
  }

  try {
    const parsed = new URL(rawUrl);
    const hasQueryParams = parsed.search.length > 1;

    // Redact sensitive path segments in standard Xtream / IPTV routes
    const safePathname = parsed.pathname
      .replace(/\/(live|movie|series)\/[^/\s]+\/[^/\s]+\//gi, '/$1/[REDACTED]/[REDACTED]/')
      .replace(/\/[^/\s]+\/[^/\s]+\/([0-9]+)\./gi, '/[REDACTED]/[REDACTED]/$1.');

    // Redact sensitive query parameters
    const safeSearchParams = new URLSearchParams();
    parsed.searchParams.forEach((val, key) => {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('pass') ||
        lowerKey.includes('user') ||
        lowerKey.includes('token') ||
        lowerKey.includes('auth') ||
        lowerKey.includes('key') ||
        lowerKey.includes('secret')
      ) {
        safeSearchParams.append(key, '[REDACTED]');
      } else {
        safeSearchParams.append(key, val);
      }
    });

    const queryString = safeSearchParams.toString();
    const sanitizedUrl = `${parsed.protocol}//${parsed.host}${safePathname}${queryString ? `?${queryString}` : ''}`;

    return {
      sanitizedUrl,
      hasQueryParams,
      host: parsed.host,
      protocol: parsed.protocol.replace(':', ''),
    };
  } catch (_e) {
    return {
      sanitizedUrl: redactString(rawUrl),
      hasQueryParams: rawUrl.includes('?'),
      host: 'INVALID_URL',
      protocol: 'UNKNOWN',
    };
  }
}

/**
 * Sanitizes request headers for telemetry.
 * Strips authorization tokens, session cookies, and credentials.
 *
 * @param {Object} headers
 * @returns {Object} Safe headers object
 */
export function sanitizePlaybackHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const safe = {};
  for (const [key, val] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('auth') ||
      lowerKey.includes('cookie') ||
      lowerKey.includes('token') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('key')
    ) {
      safe[key] = '[REDACTED]';
    } else {
      safe[key] = val;
    }
  }
  return safe;
}

/**
 * Comprehensive safe playback diagnostic logger.
 * Instruments the complete 17-point playback pipeline:
 * 1. contentId, 2. contentType, 3. playlistId, 4. providerType,
 * 5. platform, 6. normalized streamType, 7. sanitized final URL,
 * 8. hasQueryParams, 9. source contentType passed to expo-video,
 * 10. safe headers, 11. player status, 12. player error message,
 * 13. sourceLoad event, 14. readyToPlay event, 15. playing event,
 * 16. loadTimeMs, 17. playbackStartupMs.
 *
 * NEVER logs passwords, usernames, or auth tokens.
 *
 * @param {string} event - Lifecycle event name
 * @param {Object} meta - Diagnostic metadata
 */
export function logPlayerDiagnostic(event, meta = {}) {
  const safeMeta = { ...meta };

  if (safeMeta.url && typeof safeMeta.url === 'string') {
    const urlInfo = sanitizePlaybackUrl(safeMeta.url);
    safeMeta.sanitizedUrl = urlInfo.sanitizedUrl;
    safeMeta.hasQueryParams = urlInfo.hasQueryParams;
    safeMeta.host = urlInfo.host;
    safeMeta.protocol = urlInfo.protocol;
    delete safeMeta.url;
  }

  if (safeMeta.fallbackUrl && typeof safeMeta.fallbackUrl === 'string') {
    const urlInfo = sanitizePlaybackUrl(safeMeta.fallbackUrl);
    safeMeta.sanitizedFallbackUrl = urlInfo.sanitizedUrl;
    delete safeMeta.fallbackUrl;
  }

  if (safeMeta.headers) {
    safeMeta.headers = sanitizePlaybackHeaders(safeMeta.headers);
  }

  if (!safeMeta.platform) {
    safeMeta.platform = Platform.OS;
  }

  safeMeta.engine = safeMeta.platform === 'ios' ? 'AVFoundation / AVPlayer' : 'Media3 / ExoPlayer';
  safeMeta.playerLibrary = 'expo-video ~57.0.5';
  if (Platform.Version != null) {
    safeMeta.osVersion = String(Platform.Version);
  }

  if (safeMeta.error && typeof safeMeta.error === 'string') {
    safeMeta.error = redactString(safeMeta.error);
  }
  if (safeMeta.technical && typeof safeMeta.technical === 'string') {
    safeMeta.technical = redactString(safeMeta.technical);
  }

  logPlayer(event, safeMeta);
}

