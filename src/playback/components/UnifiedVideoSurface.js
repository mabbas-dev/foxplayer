/**
 * FOX PLAYER — Unified Video Surface
 *
 * Renders the video frame surface for either:
 * - Native Engine: VideoView (expo-video / ExoPlayer / AVPlayer)
 * - VLC Engine: VlcPlayerView (rn-vlc-plyr / libVLC)
 *
 * Sits seamlessly beneath the shared overlay, controls, gestures, and HUD.
 * Prevents flicker and surface destruction during orientation and fullscreen changes.
 */

import React, { memo, useMemo } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { VideoView } from 'expo-video';
import { ENGINE_TYPE } from '../playbackTypes.js';

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
}) {
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

  return (
    <View style={[styles.container, style]} pointerEvents="box-none">
      {/* 1. NATIVE ENGINE SURFACE */}
      {activeEngineType === ENGINE_TYPE.NATIVE && nativePlayer && (
        <VideoView
          style={StyleSheet.absoluteFill}
          player={nativePlayer}
          {...nativeVideoViewProps}
        />
      )}

      {/* 2. VLC ENGINE SURFACE */}
      {activeEngineType === ENGINE_TYPE.VLC && vlcPlayer && VlcPlayerView && (
        <VlcPlayerView
          style={StyleSheet.absoluteFill}
          player={vlcPlayer}
          resizeMode={vlcResizeMode}
          surfaceType={Platform.OS === 'android' ? 'texture' : undefined}
        />
      )}

      {/* Fallback placeholder if VLC view cannot be resolved in this runtime */}
      {activeEngineType === ENGINE_TYPE.VLC && !VlcPlayerView && (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  placeholder: {
    backgroundColor: '#000000',
  },
});

export const UnifiedVideoSurface = memo(UnifiedVideoSurfaceComponent);
export default UnifiedVideoSurface;
