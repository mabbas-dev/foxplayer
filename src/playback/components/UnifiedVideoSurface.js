/**
 * FOX PLAYER — Unified Video Surface
 *
 * Renders the video frame surface for either:
 * - Native Engine: VideoView (expo-video / ExoPlayer / AVPlayer)
 * - VLC Engine: VlcPlayerView (rn-vlc-plyr / libVLC)
 *
 * Sits seamlessly beneath the shared overlay, controls, gestures, and HUD.
 * Prevents flicker and surface destruction during orientation and fullscreen changes.
 * Protected by PlayerSurfaceErrorBoundary to prevent native crash propagation.
 */

import React, { memo, useMemo } from 'react';
import { View, Text, StyleSheet, Platform, TouchableOpacity } from 'react-native';
import { VideoView } from 'expo-video';
import { ENGINE_TYPE } from '../playbackTypes.js';
import { probeVlcNativeAvailability } from '../playerSettings.js';
import { PlayerSurfaceErrorBoundary } from './PlayerSurfaceErrorBoundary.js';
import Colors from '../../constants/colors';

// Safe resolution of VlcPlayerView
let VlcPlayerView = null;
try {
  const vlcModule = require('rn-vlc-plyr');
  if (vlcModule && vlcModule.VlcPlayerView) {
    VlcPlayerView = vlcModule.VlcPlayerView;
  }
} catch (_e) {
  VlcPlayerView = null;
}

function UnifiedVideoSurfaceComponent({
  activeEngineType = ENGINE_TYPE.NATIVE,
  nativePlayer = null,
  vlcPlayer = null,
  contentFit = 'contain',
  isMini = false,
  style = null,
  onSurfaceError = null,
  onRecoverToNative = null,
}) {
  const vlcProbe = useMemo(() => probeVlcNativeAvailability(), []);

  // Map standard contentFit ('contain' | 'cover' | 'fill') to VLC resizeMode ('contain' | 'cover' | 'stretch')
  const vlcResizeMode = useMemo(() => {
    if (contentFit === 'fill') return 'stretch';
    if (contentFit === 'cover') return 'cover';
    return 'contain';
  }, [contentFit]);

  const nativeVideoViewProps = useMemo(() => {
    return {
      contentFit,
      nativeControls: false,
      pointerEvents: 'none',
      fullscreenOptions: { enable: !isMini },
      ...(Platform.OS === 'android'
        ? {
            surfaceType: 'textureView',
            useExoShutter: false, // Prevents black flash on SurfaceView switch
          }
        : {}),
    };
  }, [contentFit, isMini]);

  const canRenderVlc = activeEngineType === ENGINE_TYPE.VLC && vlcPlayer && VlcPlayerView && vlcProbe.available;

  return (
    <PlayerSurfaceErrorBoundary
      onError={(err) => {
        if (typeof onSurfaceError === 'function') {
          onSurfaceError(err);
        }
      }}
      onRecover={() => {
        if (typeof onRecoverToNative === 'function') {
          onRecoverToNative();
        }
      }}
    >
      <View style={[styles.container, style]} pointerEvents="box-none">
        {/* 1. NATIVE ENGINE SURFACE */}
        {activeEngineType === ENGINE_TYPE.NATIVE && nativePlayer && (
          <VideoView
            style={StyleSheet.absoluteFill}
            player={nativePlayer}
            {...nativeVideoViewProps}
          />
        )}

        {/* 2. VLC ENGINE SURFACE (Only when verified native support exists) */}
        {canRenderVlc && (
          <VlcPlayerView
            style={StyleSheet.absoluteFill}
            player={vlcPlayer}
            resizeMode={vlcResizeMode}
            surfaceType={Platform.OS === 'android' ? 'texture' : undefined}
          />
        )}

        {/* Fallback placeholder if VLC is active but native binary is missing */}
        {activeEngineType === ENGINE_TYPE.VLC && !canRenderVlc && (
          <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
            <Text style={styles.placeholderTitle}>VLC Engine Unavailable</Text>
            <Text style={styles.placeholderSubtitle}>
              {vlcProbe.reason || 'Native VLC module is not installed in this build.'}
            </Text>
            {onRecoverToNative && (
              <TouchableOpacity
                style={styles.switchNativeBtn}
                onPress={onRecoverToNative}
                activeOpacity={0.8}
              >
                <Text style={styles.switchNativeBtnText}>Use Native Player</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </PlayerSurfaceErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  placeholder: {
    backgroundColor: '#0A0A0C',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  placeholderTitle: {
    color: '#FFB800',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  placeholderSubtitle: {
    color: '#8A92A6',
    fontSize: 12,
    textAlign: 'center',
    maxWidth: 280,
    marginBottom: 16,
  },
  switchNativeBtn: {
    backgroundColor: Colors.brand.primary,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
  },
  switchNativeBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});

export const UnifiedVideoSurface = memo(UnifiedVideoSurfaceComponent);
export default UnifiedVideoSurface;
