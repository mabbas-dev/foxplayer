import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import Colors from '../constants/colors';
import {
  PlayIcon,
  PauseIcon,
  BackArrowIcon,
  Rewind10Icon,
  Forward10Icon,
  VolumeHighIcon,
  VolumeMuteIcon,
  SpeedIcon,
  AspectRatioIcon,
  FullscreenIcon,
  MinimizeIcon,
} from './Icons';
import PlayerSeekBar from './PlayerSeekBar';
import PlayerGestureHUD from './PlayerGestureHUD';
import { measureAndLogLayout } from '../utils/layoutDiagnostics';

/**
 * Unified PlayerControls component.
 *
 * Root Layout Architecture
 * ─────────────────────────
 * overlayRoot  (position: absolute, top:0, left:0, right:0, bottom:0)
 *   dimOverlay   (absoluteFill — dark background)
 *   topZone      (position: absolute, top:0, left:0, right:0)
 *   centerZone   (position: absolute, top:0, left:0, right:0, bottom:0)  ← centered in FULL player
 *   bottomZone   (position: absolute, bottom:0, left:0, right:0)
 *   gestureHUD   (PlayerGestureHUD — integrated brightness on left & volume on right)
 *
 * Each zone is INDEPENDENTLY anchored — they do NOT depend on the parent's
 * flex height propagation or justifyContent: 'space-between'.
 * The bottom zone is ALWAYS at the physical bottom of the player.
 */
export default function PlayerControls({
  opacityAnim,
  isPlaying = false,
  onTogglePlay,
  title = 'FOX PLAYER',
  type = 'movie',
  isLive = false,
  canSeek = true,
  currentTime = 0,
  duration = 0,
  onSeek,
  onSeekingChange,
  onRewind,
  onForward,
  isMuted = false,
  onToggleMute,
  playbackSpeed,
  onCycleSpeed,
  contentFit,
  onCycleFit,
  onBack,
  onFullscreen,
  onClose,
  onBackdropPress = null,
  isMini = false,
  insets = { top: 0, bottom: 0, left: 0, right: 0 },
  streamId = '',
  extension = '',
  url = '',
  poster = null,
  topRightCustom = null,
  // Staggered entrance animation values (Animated.Value 0 → 1, optional)
  // Only applied in expanded mode so mini mode is never hidden with opacity 0!
  topAnim    = null,
  centerAnim = null,
  bottomAnim = null,
  isBuffering = false,
  bufferingLabel = 'Buffering...',
  // Unified Gesture HUD Feedback
  gestureHud = null,
  // Audio & Subtitle Track Management (UI buttons removed)
  availableAudioTracks = [],
  selectedAudioTrack = null,
  onSelectAudioTrack = null,
  availableSubtitleTracks = [],
  selectedSubtitleTrack = null,
  onSelectSubtitleTrack = null,
  // Dual Engine Controls
  activeEngineType = 'NATIVE',
  engineMode = 'AUTO',
  onOpenEngineModal = null,
}) {

  const isLiveStream = isLive || type === 'live';
  const showSeek = Boolean(
    (canSeek && onSeek && (!isLiveStream || (duration > 0 && isFinite(duration)))) ||
    Boolean(onRewind || onForward)
  );

  const topInset    = Math.max(insets?.top    || 0, isMini ? 6  : 14);
  const bottomInset = Math.max(insets?.bottom || 0, isMini ? 6  : 14);
  const leftInset   = Math.max(insets?.left   || 0, isMini ? 8  : 20);
  const rightInset  = Math.max(insets?.right  || 0, isMini ? 8  : 20);

  // ── Zone entrance animation helpers ─────────────────────────────────────
  // Only applied when !isMini and Animated.Values are provided (0→1).
  // Zero-translate opacity/scale avoids shifting buttons outside the visible viewport!
  const topEntranceStyle = (!isMini && topAnim)
    ? {
        opacity: topAnim,
      }
    : null;
  const bottomEntranceStyle = (!isMini && bottomAnim)
    ? {
        opacity: bottomAnim,
      }
    : null;

  const effectivePoster = poster || null;

  const rootRef       = useRef(null);
  const centerZoneRef = useRef(null);
  const playBtnRef    = useRef(null);
  const topZoneRef    = useRef(null);
  const bottomZoneRef = useRef(null);
  const seekBarRef    = useRef(null);

  const handleZoneLayout = (zone, nodeRef) => (event) => {
    const layout = event?.nativeEvent?.layout;
    measureAndLogLayout(`PlayerControls:${zone}`, nodeRef, layout, insets, { isMini });
  };

  return (
    <Animated.View
      ref={rootRef}
      style={[styles.overlayRoot, opacityAnim ? { opacity: opacityAnim } : null]}
      pointerEvents="box-none"
      onLayout={handleZoneLayout('overlayRoot', rootRef)}
    >
      {/* Cinematic dim scrim — covers the full player area */}
      <View style={styles.dimOverlay} pointerEvents="none" />

      {/* CENTER ZONE — centered play/pause, rewind -10s, forward +10s */}
      <View
        ref={centerZoneRef}
        style={[styles.centerZone, isMini && styles.miniCenterZone]}
        pointerEvents="box-none"
        onLayout={handleZoneLayout('centerZone', centerZoneRef)}
      >
        <View
          style={[styles.centerRow, isMini && styles.miniCenterRow]}
          pointerEvents="box-none"
          onLayout={handleZoneLayout('centerRow', null)}
        >
          {/* Rewind 10 s — VOD only */}
          {showSeek && onRewind && !isMini ? (
            <TouchableOpacity
              style={styles.skipBtn}
              onPress={(e) => {
                e?.stopPropagation?.();
                onRewind();
              }}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Rewind 10 seconds"
            >
              <Rewind10Icon size={isMini ? 20 : 26} color="#FFFFFF" />
            </TouchableOpacity>
          ) : null}

          {/* Dynamic Center Play/Pause Control: Strictly hidden during buffering */}
          {!isBuffering ? (
            <TouchableOpacity
              ref={playBtnRef}
              style={styles.playBtnWrapper}
              onPress={(e) => {
                e?.stopPropagation?.();
                onTogglePlay();
              }}
              activeOpacity={0.85}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
              onLayout={handleZoneLayout('playBtnWrapper', playBtnRef)}
            >
              <View style={[styles.playCircle, isMini && styles.miniPlayCircle]}>
                {isPlaying
                  ? <PauseIcon size={isMini ? 22 : 32} color="#FFFFFF" />
                  : <PlayIcon  size={isMini ? 22 : 32} color="#FFFFFF" />
                }
              </View>
            </TouchableOpacity>
          ) : (
            <View
              style={[styles.playBtnSpacer, isMini && styles.miniPlayBtnSpacer]}
              pointerEvents="none"
            />
          )}

          {/* Forward 10 s — VOD only */}
          {showSeek && onForward && !isMini ? (
            <TouchableOpacity
              style={styles.skipBtn}
              onPress={(e) => {
                e?.stopPropagation?.();
                onForward();
              }}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Forward 10 seconds"
            >
              <Forward10Icon size={isMini ? 20 : 26} color="#FFFFFF" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* TOP ZONE — rendered above centerZone so Back and actions receive touches reliably */}
      <Animated.View
        ref={topZoneRef}
        style={[
          styles.topZone,
          isMini && styles.miniTopZone,
          {
            paddingTop:   topInset,
            paddingLeft:  leftInset,
            paddingRight: rightInset,
          },
          topEntranceStyle,
        ]}
        pointerEvents="box-none"
        onLayout={handleZoneLayout('topZone', topZoneRef)}
      >
        {isMini ? (
          <View style={styles.miniTopRow} pointerEvents="box-none">
            <Text style={styles.miniTitleText} numberOfLines={1} ellipsizeMode="tail">
              {title || (isLiveStream ? 'Live Broadcast' : 'Fox Player')}
            </Text>
          </View>
        ) : (
          <>
            {/* Left: back button + LIVE badge */}
            <View style={styles.topLeftGroup}>
              {onBack && (
                <TouchableOpacity
                  style={styles.backPill}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    onBack();
                  }}
                  activeOpacity={0.75}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityLabel="Go back or minimize"
                >
                  <BackArrowIcon size={16} color={Colors.brand.primary} />
                  <Text style={styles.backPillText}>Back</Text>
                </TouchableOpacity>
              )}

              {isLiveStream && (
                <View style={styles.liveTagBadge}>
                  <View style={styles.liveRedDot} />
                  <Text style={styles.liveTagText}>LIVE</Text>
                </View>
              )}
            </View>

            {/* Center: media title — truncates gracefully */}
            <View style={styles.titleContainer}>
              <Text
                style={styles.titleText}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {title || (isLiveStream ? 'Live Broadcast' : 'Fox Player')}
              </Text>
            </View>

            {/* Right: Custom top right action (if any) */}
            <View style={styles.topRightGroup} pointerEvents="auto">
              {topRightCustom}
            </View>
          </>
        )}
      </Animated.View>

      {/* BOTTOM ZONE */}
      <Animated.View
        ref={bottomZoneRef}
        style={[
          styles.bottomZone,
          isMini && styles.miniBottomZone,
          {
            paddingBottom: bottomInset,
            paddingLeft:   leftInset,
            paddingRight:  rightInset,
          },
          bottomEntranceStyle,
        ]}
        pointerEvents="box-none"
        onLayout={handleZoneLayout('bottomZone', bottomZoneRef)}
      >
        {isMini ? (
          /* Mini Player Bottom Controls: Left Mute, Right Maximize */
          <View style={styles.miniBottomRow}>
            <View style={styles.miniBottomLeft}>
              {onToggleMute ? (
                <TouchableOpacity
                  style={styles.miniActionBtn}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    onToggleMute();
                  }}
                  activeOpacity={0.75}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityLabel="Toggle mute"
                >
                  {isMuted
                    ? <VolumeMuteIcon size={15} color={Colors.status.error} />
                    : <VolumeHighIcon size={15} color="#FFFFFF" />
                  }
                </TouchableOpacity>
              ) : null}
            </View>

            {onFullscreen ? (
              <TouchableOpacity
                style={styles.miniMaximizeBtn}
                onPress={(e) => {
                  e?.stopPropagation?.();
                  onFullscreen();
                }}
                activeOpacity={0.75}
                hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                accessibilityLabel="Maximize player"
              >
                <FullscreenIcon size={17} color="#FFFFFF" />
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          /* Full Player Bottom Controls: Full-width seekbar & actions */
          <>
            {showSeek && onSeek ? (
              <View
                ref={seekBarRef}
                style={styles.seekBarWrapper}
                onLayout={handleZoneLayout('seekBarWrapper', seekBarRef)}
              >
                <PlayerSeekBar
                  currentTime={currentTime}
                  duration={duration}
                  onSeek={onSeek}
                  onSeekingChange={onSeekingChange}
                  isLive={false}
                />
              </View>
            ) : null}

            <View style={styles.actionsRow} pointerEvents="box-none">
              {/* Left: volume + LIVE label */}
              <View style={styles.actionsLeft} pointerEvents="box-none">
                {onToggleMute ? (
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={(e) => {
                      e?.stopPropagation?.();
                      onToggleMute();
                    }}
                    activeOpacity={0.75}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Toggle mute"
                  >
                    {isMuted
                      ? <VolumeMuteIcon size={18} color={Colors.status.error} />
                      : <VolumeHighIcon size={18} color="#FFFFFF" />
                    }
                  </TouchableOpacity>
                ) : null}

                {isLiveStream ? (
                  <View style={styles.liveBroadcastBadge}>
                    <View style={styles.liveRedDot} />
                    <Text style={styles.liveBroadcastText}>DIRECT BROADCAST</Text>
                  </View>
                ) : null}
              </View>

              {/* Right actions: speed, fit, fullscreen */}
              <View style={styles.actionsRight} pointerEvents="box-none">
                {onCycleSpeed && playbackSpeed !== undefined && !isLiveStream ? (
                  <TouchableOpacity
                    style={styles.actionPill}
                    onPress={(e) => {
                      e?.stopPropagation?.();
                      onCycleSpeed();
                    }}
                    activeOpacity={0.75}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Playback speed"
                  >
                    <SpeedIcon size={13} color={Colors.brand.primary} />
                    <Text style={styles.actionPillText}>{playbackSpeed}x</Text>
                  </TouchableOpacity>
                ) : null}

                {onCycleFit && contentFit ? (
                  <TouchableOpacity
                    style={styles.actionPill}
                    onPress={(e) => {
                      e?.stopPropagation?.();
                      onCycleFit();
                    }}
                    activeOpacity={0.75}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Aspect ratio"
                  >
                    <AspectRatioIcon size={13} color={Colors.brand.primary} />
                    <Text style={styles.actionPillText}>{contentFit.toUpperCase()}</Text>
                  </TouchableOpacity>
                ) : null}

                {onOpenEngineModal ? (
                  <TouchableOpacity
                    style={[styles.actionPill, activeEngineType === 'VLC' && { borderColor: 'rgba(255, 107, 0, 0.4)', backgroundColor: 'rgba(255, 107, 0, 0.14)' }]}
                    onPress={(e) => {
                      e?.stopPropagation?.();
                      onOpenEngineModal();
                    }}
                    activeOpacity={0.75}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Playback engine settings"
                  >
                    <Text style={[styles.actionPillText, { color: Colors.brand.primary, fontWeight: '800' }]}>
                      {activeEngineType === 'VLC' ? 'VLC' : (engineMode === 'AUTO' ? 'AUTO' : 'NATIVE')}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {onFullscreen ? (
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={(e) => {
                      e?.stopPropagation?.();
                      onFullscreen();
                    }}
                    activeOpacity={0.75}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessibilityLabel="Minimize player"
                  >
                    <MinimizeIcon size={18} color="#FFFFFF" />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </>
        )}
      </Animated.View>

      {/* Unified Brightness & Volume HUD Indicators */}
      {gestureHud?.visible && gestureHud?.type ? (
        <PlayerGestureHUD
          type={gestureHud.type}
          value={gestureHud.value}
          visible={gestureHud.visible}
          opacityAnim={gestureHud.opacityAnim}
          insets={insets}
          isMini={isMini}
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /* ── ROOT: covers the full parent player container ───────────────────── */
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    zIndex: 30,
    elevation: 30,
  },
  dimOverlay: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
  },

  /* ── TOP ZONE: anchored to top edge ─────────────────────────────────── */
  topZone: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    backgroundColor: 'rgba(12, 12, 14, 0.92)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.10)',
    zIndex: 20,
    elevation: 20,
  },
  topLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  backPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(28, 28, 32, 0.92)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 5,
  },
  backPillText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  miniBackBtn: {
    backgroundColor: 'rgba(28, 28, 32, 0.92)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    padding: 5,
  },
  liveTagBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    gap: 5,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  liveRedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#EF4444',
  },
  liveTagText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#EF4444',
    letterSpacing: 0.5,
  },
  titleContainer: {
    flex: 1,
    marginHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
  },
  titleText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  miniTitleText: {
    flex: 1,
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  topRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
    zIndex: 35,
    elevation: 35,
  },
  miniIconBtn: {
    backgroundColor: 'rgba(28, 28, 32, 0.92)',
    borderRadius: 6,
    padding: 5,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },

  /* ── CENTER ZONE: spans entire player, centers its children ─────────── */
  centerZone: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    marginTop: -33,
    height: 66,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 12,
    elevation: 12,
  },
  miniCenterZone: {
    marginTop: -23,
    height: 46,
  },
  centerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 66,
    minWidth: 66,
    gap: 36,
  },
  miniCenterRow: {
    gap: 18,
  },
  skipBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(18, 18, 20, 0.88)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniSkipBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  playBtnSpacer: {
    width: 66,
    height: 66,
  },
  miniPlayBtnSpacer: {
    width: 46,
    height: 46,
  },
  playBtnWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  playCircle: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: 'rgba(18, 18, 20, 0.94)',
    borderWidth: 2,
    borderColor: Colors.brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.brand.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  miniPlayCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1.5,
  },
  bufferingCenterBox: {
    minWidth: 66,
    minHeight: 66,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniBufferingCenterBox: {
    minWidth: 46,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── BOTTOM ZONE: anchored to bottom edge ───────────────────────────── */
  bottomZone: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    width: '100%',
    flexDirection: 'column',
    backgroundColor: 'rgba(12, 12, 14, 0.92)',
    paddingTop: 8,
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.10)',
    zIndex: 20,
    elevation: 20,
  },
  seekBarWrapper: {
    width: '100%',
    marginBottom: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  actionsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    backgroundColor: 'rgba(28, 28, 32, 0.92)',
    borderRadius: 6,
    padding: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniActionBtn: {
    padding: 4,
  },
  liveBroadcastBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    gap: 5,
  },
  liveBroadcastText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#EF4444',
    letterSpacing: 0.5,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(28, 28, 32, 0.92)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 4,
  },
  actionPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  miniTopZone: {
    paddingBottom: 6,
    backgroundColor: 'rgba(12, 12, 14, 0.88)',
  },
  miniTopRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  miniCloseBtn: {
    backgroundColor: 'rgba(28, 28, 32, 0.92)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniBottomZone: {
    paddingTop: 4,
    paddingBottom: 4,
    backgroundColor: 'rgba(12, 12, 14, 0.88)',
  },
  miniBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  miniBottomLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  miniMaximizeBtn: {
    backgroundColor: 'rgba(28, 28, 32, 0.92)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
