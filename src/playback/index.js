/**
 * FOX PLAYER — Playback Architecture Public API
 *
 * Exposes the PlaybackController, platform-specific players (AndroidPlayer, IOSPlayer),
 * source normalizers, types, and the usePlaybackController hook.
 */

export * from './playbackTypes.js';
export * from './sourceNormalizer.js';
export { AndroidPlayer, AndroidPlayerDriver } from './AndroidPlayer.js';
export { IOSPlayer, IOSPlayerDriver } from './IOSPlayer.js';
export {
  getPlatformPlayer,
  ActivePlatformPlayer,
  isIOS,
  isAndroid,
} from './PlatformPlayer.js';
export { PlaybackController } from './PlaybackController.js';
export { usePlaybackController } from './usePlaybackController.js';

import { PlaybackController } from './PlaybackController.js';
export default PlaybackController;
