import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { STORAGE_KEYS, DEVICE_ID_LENGTH } from '../constants/index';

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const IDENTITY_FILE_PATH = `${FileSystem.documentDirectory}fox_installation_identity.json`;
const INSTALLATION_UUID_KEY = 'fox_player_installation_uuid';

/**
 * Generate a cryptographically secure UUID v4 string
 */
export function generateInstallationUuid() {
  if (Crypto.randomUUID) {
    try {
      return Crypto.randomUUID();
    } catch (_e) {}
  }
  // Cryptographically random RFC 4122 v4 UUID generator fallback
  const randomBytes = Crypto.getRandomBytes(16);
  randomBytes[6] = (randomBytes[6] & 0x0f) | 0x40; // Version 4
  randomBytes[8] = (randomBytes[8] & 0x3f) | 0x80; // Variant 10xx
  const hex = Array.from(randomBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Generate a cryptographically secure 8-character pairing device ID
 */
export function generateSecureDeviceId() {
  const randomBytes = Crypto.getRandomBytes(DEVICE_ID_LENGTH * 4);
  let result = '';
  for (let i = 0; i < DEVICE_ID_LENGTH; i++) {
    const randomValue =
      (randomBytes[i * 4] << 24) |
      (randomBytes[i * 4 + 1] << 16) |
      (randomBytes[i * 4 + 2] << 8) |
      randomBytes[i * 4 + 3];
    result += CHARSET[Math.abs(randomValue) % CHARSET.length];
  }
  return result;
}

/**
 * Validate installation UUID format
 */
export function isValidInstallationId(uuid) {
  if (typeof uuid !== 'string') return false;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(uuid.trim());
}

/**
 * Validate device ID format
 */
export function isValidDeviceId(id) {
  return typeof id === 'string' && /^[A-Z0-9]{8}$/.test(id.trim());
}

/**
 * Persist identity to both DocumentDirectory sandbox and SecureStore
 */
async function saveIdentity(identity) {
  try {
    await FileSystem.writeAsStringAsync(
      IDENTITY_FILE_PATH,
      JSON.stringify(identity),
      { encoding: FileSystem.EncodingType.UTF8 }
    );
  } catch (_e) {}

  try {
    await SecureStore.setItemAsync(STORAGE_KEYS.DEVICE_ID, identity.deviceId, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
    await SecureStore.setItemAsync(INSTALLATION_UUID_KEY, identity.installationId, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  } catch (_e) {}
}

/**
 * Get or create the unique installation identity (UUID + Device ID).
 * 
 * Storage & Lifecycle Strategy:
 * 1. DocumentDirectory sandbox check:
 *    - iOS and Android operating systems ALWAYS delete DocumentDirectory upon uninstallation.
 *    - DocumentDirectory is ALWAYS preserved across ordinary app restarts and app updates.
 *    - If `fox_installation_identity.json` exists in DocumentDirectory: ordinary app restart or update.
 *      Return the existing installation UUID and Device ID.
 * 
 * 2. iOS Keychain Uninstall Isolation:
 *    - iOS Keychain (SecureStore) values may survive uninstallation.
 *    - If the sandbox marker does NOT exist, check if an existing installation is updating:
 *      If SecureStore has an existing Device ID AND the app sandbox has existing cache files:
 *      Preserve the existing Device ID, generate a new installation UUID, and save identity.
 *    - If neither sandbox marker nor previous cache files exist:
 *      This is a genuinely fresh installation. Wipe any stale Keychain keys from prior uninstalls,
 *      generate a brand new random UUID and Device ID, and persist to sandbox.
 */
export async function getInstallationIdentity() {
  // 1. Check if identity marker already exists in app sandbox
  try {
    const fileInfo = await FileSystem.getInfoAsync(IDENTITY_FILE_PATH);
    if (fileInfo.exists) {
      const content = await FileSystem.readAsStringAsync(IDENTITY_FILE_PATH);
      const parsed = JSON.parse(content);
      if (parsed && isValidInstallationId(parsed.installationId) && isValidDeviceId(parsed.deviceId)) {
        return {
          installationId: parsed.installationId,
          deviceId: parsed.deviceId,
          isFreshInstall: false,
        };
      }
    }
  } catch (_e) {
    // Continue to fallback
  }

  // 2. Check for existing device ID from previous version upgrade
  let existingDeviceId = null;
  let existingUuid = null;
  try {
    existingDeviceId = await SecureStore.getItemAsync(STORAGE_KEYS.DEVICE_ID);
    existingUuid = await SecureStore.getItemAsync(INSTALLATION_UUID_KEY);
  } catch (_e) {}

  // Check if sandbox has existing cache data from previous app version
  let hasExistingCache = false;
  try {
    const cacheDir = `${FileSystem.documentDirectory}fox_player_cache/`;
    const cacheInfo = await FileSystem.getInfoAsync(cacheDir);
    hasExistingCache = Boolean(cacheInfo.exists);
  } catch (_e) {}

  if (existingDeviceId && isValidDeviceId(existingDeviceId) && hasExistingCache) {
    // Existing installation update — preserve existing Device ID (e.g. BFCD0K7U)
    const effectiveUuid = (existingUuid && isValidInstallationId(existingUuid))
      ? existingUuid
      : generateInstallationUuid();

    const identity = {
      installationId: effectiveUuid,
      deviceId: existingDeviceId,
      createdAt: Date.now(),
      source: 'update_migration',
    };

    await saveIdentity(identity);

    return {
      installationId: identity.installationId,
      deviceId: identity.deviceId,
      isFreshInstall: false,
    };
  }

  // 3. Genuinely fresh installation
  // Wipe any stale Keychain leftovers from prior uninstalled apps on iOS
  try {
    await SecureStore.deleteItemAsync(STORAGE_KEYS.DEVICE_ID);
    await SecureStore.deleteItemAsync(INSTALLATION_UUID_KEY);
  } catch (_e) {}

  const freshInstallationId = generateInstallationUuid();
  const freshDeviceId = generateSecureDeviceId();

  const freshIdentity = {
    installationId: freshInstallationId,
    deviceId: freshDeviceId,
    createdAt: Date.now(),
    source: 'fresh_install',
  };

  await saveIdentity(freshIdentity);

  return {
    installationId: freshIdentity.installationId,
    deviceId: freshIdentity.deviceId,
    isFreshInstall: true,
  };
}

/**
 * Get or create the persistent device ID (backward compatible with all existing callers)
 */
export async function getOrCreateDeviceId() {
  const identity = await getInstallationIdentity();
  return identity.deviceId;
}

/**
 * Get the current installation UUID
 */
export async function getInstallationId() {
  const identity = await getInstallationIdentity();
  return identity.installationId;
}

/**
 * Store a value in SecureStore
 */
export async function secureSet(key, value) {
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

/**
 * Get a value from SecureStore
 */
export async function secureGet(key) {
  return await SecureStore.getItemAsync(key);
}

/**
 * Delete a value from SecureStore
 */
export async function secureDelete(key) {
  await SecureStore.deleteItemAsync(key);
}
