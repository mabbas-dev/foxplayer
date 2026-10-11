/**
 * FOX PLAYER — Playback Architecture Types & Constants
 *
 * Defines shared playback states, commands, media types, and error categories
 * used across both Android (Media3) and iOS (AVFoundation) playback paths.
 */

import { ERROR_CLASSIFICATION } from '../utils/playerErrorMapper.js';

/**
 * Standard playback lifecycle states.
 */
export const PLAYBACK_STATE = {
  IDLE: 'IDLE',
  LOADING: 'LOADING',
  READY: 'READY',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  BUFFERING: 'BUFFERING',
  RETRYING: 'RETRYING',
  RECOVERING: 'RETRYING',
  ERROR: 'ERROR',
  UNAVAILABLE: 'UNAVAILABLE',
  ENDED: 'ENDED',
};

/**
 * Standard player commands accepted by the PlaybackController.
 */
export const PLAYER_COMMAND = {
  LOAD: 'LOAD',
  PLAY: 'PLAY',
  PAUSE: 'PAUSE',
  STOP: 'STOP',
  REPLACE: 'REPLACE',
  SEEK: 'SEEK',
  RELEASE: 'RELEASE',
};

/**
 * Supported media and stream classifications.
 */
export const MEDIA_TYPE = {
  LIVE: 'live',
  VOD: 'vod',
  SERIES: 'series',
};

/**
 * Explicit media categories for IPTV playback.
 */
export const MEDIA_CLASS = {
  LIVE_HLS: 'LIVE_HLS',
  LIVE_PROGRESSIVE: 'LIVE_PROGRESSIVE',
  VOD_HLS: 'VOD_HLS',
  VOD_PROGRESSIVE: 'VOD_PROGRESSIVE',
  UNKNOWN: 'UNKNOWN',
};

/**
 * Content-Type classifications recognized by native players.
 */
export const CONTENT_TYPE = {
  HLS: 'hls',
  PROGRESSIVE: 'progressive',
  DASH: 'dash',
  SMOOTH_STREAMING: 'smoothStreaming',
  AUTO: 'auto',
};

/**
 * Stream format containers.
 */
export const CONTAINER_FORMAT = {
  M3U8: 'm3u8',
  TS: 'ts',
  MP4: 'mp4',
  MKV: 'mkv',
  AVI: 'avi',
  MOV: 'mov',
  UNKNOWN: 'unknown',
};

/**
 * Provider source classifications.
 */
export const PROVIDER_TYPE = {
  XTREAM: 'xtream',
  M3U: 'm3u',
  DIRECT: 'direct',
  UNKNOWN: 'unknown',
};

/**
 * Error categories mapped from native players.
 */
export const PLAYBACK_ERROR = ERROR_CLASSIFICATION;
