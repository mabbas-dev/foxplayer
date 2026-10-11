/**
 * FOX PLAYER — Server API Tests
 * 
 * Run: cd server && node -e "require('./tests/api.test.js')"
 * or use a proper test runner
 */

const path = require('path');

// Test Environment configuration
process.env.ENCRYPTION_KEY = 'test_key_for_unit_tests_only_32!!';

const { initDatabase } = require('../database/db');
const { isValidDeviceId, registerOrUpdateDevice, getDevice } = require('../models/deviceModel');
const { savePlaylistConfig, getPlaylistConfig, getPublicPlaylistConfig } = require('../models/playlistModel');

async function runTests() {
  console.log('\n--- FOX PLAYER Server Tests ---\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) {
      console.log('  PASS:', name);
      passed++;
    } else {
      console.error('  FAIL:', name);
      failed++;
    }
  }

  // Init DB
  await initDatabase();
  console.log('Database: initialized\n');

  // Device ID validation
  console.log('Device ID Validation:');
  assert(isValidDeviceId('A7K92PX4'), 'Valid uppercase alphanumeric ID');
  assert(isValidDeviceId('AAAAAAAA'), 'Valid all-letter ID');
  assert(isValidDeviceId('12345678'), 'Valid all-numeric ID');
  assert(!isValidDeviceId('abc12345'), 'Rejects lowercase');
  assert(!isValidDeviceId('TOOLONG12'), 'Rejects more than 8 chars');
  assert(!isValidDeviceId('SHORT'), 'Rejects fewer than 8 chars');
  assert(!isValidDeviceId(''), 'Rejects empty');
  assert(!isValidDeviceId(null), 'Rejects null');
  assert(!isValidDeviceId('ABCD!@#4'), 'Rejects special chars');

  // Device registration
  console.log('\nDevice Registration:');
  const result1 = registerOrUpdateDevice('TESTDEV1');
  assert(result1.created === true, 'Creates new device');

  const result2 = registerOrUpdateDevice('TESTDEV1');
  assert(result2.created === false, 'Updates existing device (no duplicate)');

  const device = getDevice('TESTDEV1');
  assert(device?.device_id === 'TESTDEV1', 'Device retrievable after registration');
  assert(device?.status === 'active', 'Device status is active');

  // Playlist configuration
  console.log('\nPlaylist Configuration:');
  savePlaylistConfig('TESTDEV1', {
    type: 'm3u',
    playlist_url: 'http://example.com/playlist.m3u',
    playlist_name: 'Test Playlist',
  });

  const config = getPlaylistConfig('TESTDEV1');
  assert(config?.type === 'm3u', 'M3U config type saved');
  assert(config?.playlist_url === 'http://example.com/playlist.m3u', 'M3U URL saved');

  // Xtream config with password encryption
  savePlaylistConfig('TESTDEV1', {
    type: 'xtream',
    server_url: 'http://server.example.com:8080',
    username: 'testuser',
    password: 'super_secret_password',
  });

  const xtreamConfig = getPlaylistConfig('TESTDEV1');
  assert(xtreamConfig?.type === 'xtream', 'Xtream config type saved');
  assert(xtreamConfig?.username === 'testuser', 'Username saved');
  assert(xtreamConfig?.password === 'super_secret_password', 'Password decrypted correctly');

  // Public config strips password
  const publicConfig = getPublicPlaylistConfig('TESTDEV1');
  assert(!('password' in publicConfig), 'Public config does not include password');
  assert(publicConfig?.username === 'testuser', 'Public config includes username');

  // Multi-playlist tests
  console.log('\nMulti-Playlist Management:');
  const { getAllPlaylists, setActivePlaylist, deletePlaylist } = require('../models/playlistModel');

  // Add 3rd playlist
  const res3 = savePlaylistConfig('TESTDEV1', {
    type: 'xtream',
    server_url: 'http://backup.example.com:8080',
    username: 'backupuser',
    password: 'backup_password',
    playlist_name: 'Backup IPTV',
  });

  const playlists = getAllPlaylists('TESTDEV1');
  assert(playlists.length === 3, `Saved 3 playlists for device (got ${playlists.length})`);
  assert(playlists[0].is_active === true, 'Newly added playlist is automatically active');
  assert(playlists[0].name === 'Backup IPTV', 'Active playlist is Backup IPTV');

  // Switch active playlist
  const m3uPlaylist = playlists.find((p) => p.type === 'm3u');
  assert(!!m3uPlaylist, 'Found M3U playlist');
  const activated = setActivePlaylist('TESTDEV1', m3uPlaylist.id);
  assert(activated.is_active === true, 'M3U playlist successfully activated');
  assert(activated.type === 'm3u', 'Active playlist is now M3U');

  const activeConfigNow = getPlaylistConfig('TESTDEV1');
  assert(activeConfigNow.id === m3uPlaylist.id, 'getPlaylistConfig returns newly active playlist');

  // Delete playlist
  const deleteSuccess = deletePlaylist('TESTDEV1', res3.playlist_id);
  assert(deleteSuccess === true, 'Playlist deleted successfully');
  const playlistsAfterDelete = getAllPlaylists('TESTDEV1');
  assert(playlistsAfterDelete.length === 2, 'Playlists count decreased to 2');

  // Section: Device Pairing, Authorization & ID Lock
  console.log('\nDevice Pairing, Authorization & ID Lock:');
  const {
    getOrCreatePairingToken,
    pairDevice,
    verifyManagementSession,
    setIdLock,
    isDeviceLocked,
  } = require('../models/deviceModel');

  const pInfo = getOrCreatePairingToken('TESTDEV1');
  assert(typeof pInfo.pairing_token === 'string', 'Generated pairing token for device');
  assert(typeof pInfo.pairing_code === 'string' && pInfo.pairing_code.length === 6, 'Generated 6-digit TV pairing code');

  const pRes = pairDevice('TESTDEV1', pInfo.pairing_code);
  assert(pRes.success === true, 'Device pairing succeeds with 6-digit code');
  assert(typeof pRes.session_token === 'string', 'Session token issued');

  assert(verifyManagementSession('TESTDEV1', pRes.session_token) === true, 'Session token verified for TESTDEV1');
  assert(verifyManagementSession('TESTDEV2', pRes.session_token) === false, 'Session token isolated from TESTDEV2');

  // ID Lock tests
  assert(isDeviceLocked('TESTDEV1') === false, 'Default ID Lock is false');
  setIdLock('TESTDEV1', true);
  assert(isDeviceLocked('TESTDEV1') === true, 'ID Lock successfully enabled in database');
  setIdLock('TESTDEV1', false);
  assert(isDeviceLocked('TESTDEV1') === false, 'ID Lock successfully disabled in database');

  // Section: Safe Server Host Extraction
  console.log('\nSafe Server Host Extraction:');
  const { getSafeServerHost } = require('../models/playlistModel');
  const xtreamSafe = getSafeServerHost('xtream', 'http://iptv.example.com:8080/live/user/secret/123.m3u8', null);
  assert(xtreamSafe === 'http://iptv.example.com:8080', `Strips Xtream credentials from URL (got ${xtreamSafe})`);
  assert(!xtreamSafe.includes('secret'), 'Xtream safe host contains no credentials');

  const m3uSafe = getSafeServerHost('m3u', null, 'https://provider.stream.net/get.php?username=alice&password=secretpassword&type=m3u');
  assert(m3uSafe === 'https://provider.stream.net', `Strips M3U query tokens from URL (got ${m3uSafe})`);
  assert(!m3uSafe.includes('secretpassword'), 'M3U safe host contains no passwords');

  // Section: Multi-Device Isolation on Playlist Removal
  console.log('\nMulti-Device Isolation:');
  registerOrUpdateDevice('TESTDEV2');
  const sharedRes1 = savePlaylistConfig('TESTDEV1', {
    type: 'm3u',
    playlist_url: 'http://shared.example.com/playlist.m3u',
    playlist_name: 'Shared Family IPTV',
  });
  const sharedRes2 = savePlaylistConfig('TESTDEV2', {
    type: 'm3u',
    playlist_url: 'http://shared.example.com/playlist.m3u',
    playlist_name: 'Shared Family IPTV',
  });

  const dev1Before = getAllPlaylists('TESTDEV1');
  const dev2Before = getAllPlaylists('TESTDEV2');
  assert(dev1Before.some((p) => p.name === 'Shared Family IPTV'), 'Device 1 has shared playlist');
  assert(dev2Before.some((p) => p.name === 'Shared Family IPTV'), 'Device 2 has shared playlist');

  // Remove from Device 1
  deletePlaylist('TESTDEV1', sharedRes1.playlist_id);
  const dev1After = getAllPlaylists('TESTDEV1');
  const dev2After = getAllPlaylists('TESTDEV2');

  assert(!dev1After.some((p) => p.name === 'Shared Family IPTV'), 'Shared playlist removed from Device 1');
  assert(dev2After.some((p) => p.name === 'Shared Family IPTV'), 'Shared playlist remains intact on Device 2');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error('Test run failed:', e.message);
  process.exit(1);
});
