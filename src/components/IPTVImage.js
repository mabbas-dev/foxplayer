import React, { useState, useEffect, useMemo, useCallback, Component } from 'react';
import { View, StyleSheet, Platform, Image as RNImage } from 'react-native';
import Colors from '../constants/colors';
import { normalizeImageUrl, resolvePosterUrl } from '../utils/imageHelpers';

// Local asset placeholders
const POSTER_PLACEHOLDER = require('../../assets/poster-placeholder.png');
const CHANNEL_PLACEHOLDER = require('../../assets/channel-placeholder.png');

// Safely load ExpoImage with graceful fallback if native module is not linked
let ExpoImageComponent = null;
try {
  const mod = require('expo-image');
  if (mod && (mod.Image || mod.default)) {
    ExpoImageComponent = mod.Image || mod.default;
  }
} catch (_e) {
  ExpoImageComponent = null;
}

// Time-bounded failure cache to avoid hammering broken URLs while allowing recovery
const failedUriCache = new Map();
const FAILED_CACHE_TTL_MS = 30000;

/**
 * Error boundary wrapper to prevent native ExpoImage crashes from breaking the UI
 */
class SafeImageWrapper extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(err) {
    if (__DEV__) {
      console.warn('[IPTVImage] Native image renderer error, falling back to RN Image:', err?.message);
    }
  }

  render() {
    if (this.state.hasError || !ExpoImageComponent) {
      return this.props.renderFallback();
    }
    try {
      return this.props.children;
    } catch (_e) {
      return this.props.renderFallback();
    }
  }
}

/**
 * Standard HTTP headers for media image CDN requests.
 */
const IMAGE_REQUEST_HEADERS = Platform.select({
  ios: {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1 FOX-PLAYER/1.0',
    Accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8',
  },
  default: {
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 FOX-PLAYER/1.0',
    Accept: 'image/webp,image/jpeg,image/png,image/*;q=0.8',
  },
});

/**
 * High-Performance IPTV Image Component.
 * Automatically leverages expo-image (SDWebImage / Glide) with persistent memory-disk caching
 * when available, and smoothly falls back to standard React Native Image without breaking the UI.
 */
export const IPTVImage = React.memo(function IPTVImage({
  uri,
  item = null,
  serverUrl = null,
  type = 'movie', // 'movie' | 'series' | 'live' | 'episode' | 'favorite'
  contentId = null,
  title = null,
  style,
  borderRadius = 8,
  resizeMode = 'cover',
  placeholderResizeMode = null,
  priority = 'high',
}) {
  // Resolve and normalize the image URL with fallback chain
  const cleanUri = useMemo(() => {
    let resolved = null;
    if (uri && typeof uri === 'string' && uri.trim().length > 0) {
      resolved = normalizeImageUrl(uri, serverUrl);
    }
    if (!resolved && item) {
      resolved = resolvePosterUrl(item, serverUrl);
    }
    return resolved;
  }, [uri, item, serverUrl]);

  const [hasError, setHasError] = useState(() => {
    if (!cleanUri) return true;
    const failedAt = failedUriCache.get(cleanUri);
    return Boolean(failedAt && Date.now() - failedAt < FAILED_CACHE_TTL_MS);
  });

  useEffect(() => {
    if (!cleanUri) {
      setHasError(true);
      return;
    }
    const failedAt = failedUriCache.get(cleanUri);
    const isRecentlyFailed = Boolean(failedAt && Date.now() - failedAt < FAILED_CACHE_TTL_MS);
    setHasError(isRecentlyFailed);
  }, [cleanUri]);

  const handleLoad = useCallback(() => {
    if (cleanUri) {
      failedUriCache.delete(cleanUri);
    }
    setHasError(false);
  }, [cleanUri]);

  const handleError = useCallback((errorEvent) => {
    if (cleanUri) {
      failedUriCache.set(cleanUri, Date.now());
    }
    setHasError(true);

    if (__DEV__) {
      const errorMsg = errorEvent?.error || errorEvent?.nativeEvent?.error || 'Network/Decode error';
      const safeId = contentId || item?.id || item?.streamId || item?.seriesId || 'unknown';
      console.log(
        `[IPTVImage] Image load failed: id=${safeId} type=${type} title="${title || item?.name || item?.title || ''}" url="${cleanUri}" reason="${errorMsg}"`
      );
    }
  }, [cleanUri, contentId, item, type, title]);

  // Determine placeholder asset based on content type
  const isLive = type === 'live' || type === 'channel';
  const placeholderAsset = isLive ? CHANNEL_PLACEHOLDER : POSTER_PLACEHOLDER;
  const resolvedPlaceholderResizeMode = placeholderResizeMode || (isLive ? 'contain' : 'cover');
  const resolvedContentFit = resizeMode === 'contain' ? 'contain' : (resizeMode === 'stretch' || resizeMode === 'fill' ? 'fill' : 'cover');

  if (!cleanUri || hasError) {
    return (
      <View style={[styles.container, { borderRadius }, style]}>
        <RNImage
          source={placeholderAsset}
          style={[styles.image, { borderRadius }]}
          resizeMode={resolvedPlaceholderResizeMode}
          accessibilityLabel={title ? `${title} (No poster)` : 'Media placeholder'}
        />
      </View>
    );
  }

  const renderRNFallback = () => (
    <RNImage
      source={{
        uri: cleanUri,
        headers: IMAGE_REQUEST_HEADERS,
      }}
      style={[styles.image, { borderRadius }]}
      resizeMode={resizeMode === 'contain' ? 'contain' : 'cover'}
      onLoad={handleLoad}
      onError={handleError}
      accessibilityLabel={title || 'Media poster'}
    />
  );

  return (
    <View style={[styles.container, { borderRadius }, style]}>
      <SafeImageWrapper renderFallback={renderRNFallback}>
        {ExpoImageComponent ? (
          <ExpoImageComponent
            source={{
              uri: cleanUri,
              headers: IMAGE_REQUEST_HEADERS,
            }}
            placeholder={placeholderAsset}
            placeholderContentFit={resolvedPlaceholderResizeMode}
            style={[styles.image, { borderRadius }]}
            contentFit={resolvedContentFit}
            transition={100}
            priority={priority}
            cachePolicy="memory-disk"
            recyclingKey={cleanUri}
            onLoad={handleLoad}
            onError={handleError}
            accessibilityLabel={title || 'Media poster'}
          />
        ) : (
          renderRNFallback()
        )}
      </SafeImageWrapper>
    </View>
  );
});

export default IPTVImage;

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: Colors.background.card,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
});
