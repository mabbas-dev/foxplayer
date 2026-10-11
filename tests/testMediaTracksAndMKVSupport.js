/**
 * FOX PLAYER — MEDIA TRACKS & MKV SUPPORT TEST SUITE
 *
 * Validates:
 * 1. Automatic container rewrite of MKV -> MP4 on iOS for Xtream Codes movies & series
 * 2. Unaltered MKV playback on Android (ExoPlayer Matroska support)
 * 3. Bidirectional fallback URL generation
 * 4. Audio & Subtitle Track selection modal component
 * 5. Track listeners & state synchronization in EmbeddedVideoPlayer and PlayerScreen
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    failedTests++;
  }
}

console.log('\n================================================================');
console.log('   FOX PLAYER — MEDIA TRACKS & MKV SUPPORT TESTS (iOS & Android) ');
console.log('================================================================\n');

// Load playerConfig module
const { prepareStreamUrlForPlatform, getStreamFallbackUrl } = require('../src/utils/playerConfig');

// Load TrackSelectionModal.js
const trackModalPath = path.join(__dirname, '../src/components/TrackSelectionModal.js');
const trackModalCode = fs.existsSync(trackModalPath) ? fs.readFileSync(trackModalPath, 'utf8') : '';

// Load PlayerControls.js
const playerControlsPath = path.join(__dirname, '../src/components/PlayerControls.js');
const playerControlsCode = fs.readFileSync(playerControlsPath, 'utf8');

// Load EmbeddedVideoPlayer.js
const embeddedPlayerPath = path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js');
const embeddedPlayerCode = fs.readFileSync(embeddedPlayerPath, 'utf8');

// Load PlayerScreen.js
const playerScreenPath = path.join(__dirname, '../src/screens/PlayerScreen.js');
const playerScreenCode = fs.readFileSync(playerScreenPath, 'utf8');

// Case 1: iOS MKV Container Resolution
console.log('--- Case 1: iOS MKV Container Resolution ---');

runTest('1.1: prepareStreamUrlForPlatform rewrites .mkv to .mp4 for iOS movie streams', () => {
  const mkvMovieUrl = 'http://toxicplay1.com:8080/movie/Usa2012231/sherry123/110929.mkv';
  const iosMovie = prepareStreamUrlForPlatform(mkvMovieUrl, { platform: 'ios', type: 'movie' });
  assert.strictEqual(
    iosMovie,
    'http://toxicplay1.com:8080/movie/Usa2012231/sherry123/110929.mp4',
    'iOS movie stream with .mkv must be rewritten to .mp4'
  );

  const mkvSeriesUrl = 'http://toxicplay1.com:8080/series/Usa2012231/sherry123/54321.mkv';
  const iosSeries = prepareStreamUrlForPlatform(mkvSeriesUrl, { platform: 'ios', type: 'series' });
  assert.strictEqual(
    iosSeries,
    'http://toxicplay1.com:8080/series/Usa2012231/sherry123/54321.mp4',
    'iOS series stream with .mkv must be rewritten to .mp4'
  );
});

runTest('1.2: prepareStreamUrlForPlatform preserves MKV on Android', () => {
  const mkvMovieUrl = 'http://toxicplay1.com:8080/movie/Usa2012231/sherry123/110929.mkv';
  const androidMovie = prepareStreamUrlForPlatform(mkvMovieUrl, { platform: 'android', type: 'movie' });
  assert.strictEqual(
    androidMovie,
    mkvMovieUrl,
    'Android movie stream with .mkv must remain unmodified for ExoPlayer'
  );
});

runTest('1.3: getStreamFallbackUrl supports fallback between MKV, MP4, and HLS', () => {
  const mkvMovieUrl = 'http://toxicplay1.com:8080/movie/Usa2012231/sherry123/110929.mkv';
  const iosFallbackFromMkv = getStreamFallbackUrl(mkvMovieUrl, { isLive: false, platform: 'ios' });
  assert.strictEqual(
    iosFallbackFromMkv,
    'http://toxicplay1.com:8080/movie/Usa2012231/sherry123/110929.mp4',
    'iOS VOD fallback from MKV must yield MP4'
  );

  const mp4MovieUrl = 'http://toxicplay1.com:8080/movie/Usa2012231/sherry123/110929.mp4';
  const iosFallbackFromMp4 = getStreamFallbackUrl(mp4MovieUrl, { isLive: false, platform: 'ios' });
  assert.strictEqual(
    iosFallbackFromMp4,
    'http://toxicplay1.com:8080/movie/Usa2012231/sherry123/110929.m3u8',
    'iOS VOD fallback from MP4 must yield M3U8'
  );
});

// Case 2: Track Selection Modal Component
console.log('\n--- Case 2: Track Selection Modal ---');

runTest('2.1: TrackSelectionModal exists and imports Modal, Text, TouchableOpacity', () => {
  assert(trackModalCode.length > 0, 'TrackSelectionModal.js must exist');
  assert(trackModalCode.includes('Modal'), 'TrackSelectionModal must use Modal');
  assert(trackModalCode.includes('TouchableOpacity'), 'TrackSelectionModal must use TouchableOpacity');
});

runTest('2.2: TrackSelectionModal provides segmented tabs for Audio and Subtitles', () => {
  assert(trackModalCode.includes("'audio'"), "Must support 'audio' tab");
  assert(trackModalCode.includes("'subtitles'"), "Must support 'subtitles' tab");
});

runTest('2.3: TrackSelectionModal formats language codes to human-readable names', () => {
  assert(trackModalCode.includes('LANGUAGE_NAMES'), 'Must define LANGUAGE_NAMES dictionary');
  assert(trackModalCode.includes("'English'"), 'Must include English in LANGUAGE_NAMES');
  assert(trackModalCode.includes("'Spanish'"), 'Must include Spanish in LANGUAGE_NAMES');
});

runTest('2.4: Subtitles tab includes option to turn subtitles off', () => {
  assert(trackModalCode.includes('SUBTITLES DISABLED'), 'Must provide subtitles disabled label');
  assert(trackModalCode.includes('onSelectSubtitleTrack'), 'Must provide onSelectSubtitleTrack callback');
});

// Case 3: Player Controls Integration
console.log('\n--- Case 3: Player Controls Integration ---');

runTest('3.1: PlayerControls accepts audio and subtitle track props', () => {
  assert(playerControlsCode.includes('availableAudioTracks'), 'Must accept availableAudioTracks');
  assert(playerControlsCode.includes('selectedAudioTrack'), 'Must accept selectedAudioTrack');
  assert(playerControlsCode.includes('onSelectAudioTrack'), 'Must accept onSelectAudioTrack');
  assert(playerControlsCode.includes('availableSubtitleTracks'), 'Must accept availableSubtitleTracks');
  assert(playerControlsCode.includes('selectedSubtitleTrack'), 'Must accept selectedSubtitleTrack');
  assert(playerControlsCode.includes('onSelectSubtitleTrack'), 'Must accept onSelectSubtitleTrack');
});

runTest('3.2: PlayerControls completely removes TrackSelectionModal and Audio/Caption buttons from UI', () => {
  assert(!playerControlsCode.includes('<TrackSelectionModal'), 'Must not render TrackSelectionModal');
  assert(!playerControlsCode.includes('trackModalVisible'), 'Must not declare trackModalVisible');
  assert(!playerControlsCode.includes('AudioTrackIcon'), 'Must not render AudioTrackIcon in PlayerControls');
  assert(!playerControlsCode.includes('SubtitleTrackIcon'), 'Must not render SubtitleTrackIcon in PlayerControls');
});

// Case 4: Native Player Track Event Wiring
console.log('\n--- Case 4: Native Player Track Event Wiring ---');

runTest('4.1: EmbeddedVideoPlayer listens to audio track events', () => {
  assert(embeddedPlayerCode.includes("'availableAudioTracksChange'"), 'Must listen to availableAudioTracksChange');
  assert(embeddedPlayerCode.includes("'audioTrackChange'"), 'Must listen to audioTrackChange');
});

runTest('4.2: EmbeddedVideoPlayer listens to subtitle track events', () => {
  assert(embeddedPlayerCode.includes("'availableSubtitleTracksChange'"), 'Must listen to availableSubtitleTracksChange');
  assert(embeddedPlayerCode.includes("'subtitleTrackChange'"), 'Must listen to subtitleTrackChange');
});

runTest('4.3: EmbeddedVideoPlayer sets player.audioTrack and player.subtitleTrack on selection', () => {
  assert(embeddedPlayerCode.includes('player.audioTrack = track'), 'Must set player.audioTrack');
  assert(embeddedPlayerCode.includes('player.subtitleTrack = track'), 'Must set player.subtitleTrack');
});

runTest('4.4: PlayerScreen listens to audio and subtitle track events and updates player', () => {
  assert(playerScreenCode.includes("'availableAudioTracksChange'"), 'Must listen to availableAudioTracksChange in PlayerScreen');
  assert(playerScreenCode.includes("'availableSubtitleTracksChange'"), 'Must listen to availableSubtitleTracksChange in PlayerScreen');
  assert(playerScreenCode.includes('player.audioTrack = track'), 'Must set player.audioTrack in PlayerScreen');
  assert(playerScreenCode.includes('player.subtitleTrack = track'), 'Must set player.subtitleTrack in PlayerScreen');
});

console.log('\n================================================================');
console.log(`TOTAL MEDIA TRACK & MKV TESTS: ${passedTests + failedTests}`);
console.log(`PASSED: ${passedTests}`);
console.log(`FAILED: ${failedTests}`);
console.log('================================================================\n');

if (failedTests > 0) {
  process.exit(1);
}

module.exports = { passedTests, failedTests };
