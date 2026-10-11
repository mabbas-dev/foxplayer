<?php
// FOX PLAYER Production REST API Router — PHP 8.2 & MariaDB
declare(strict_types=1);

require_once __DIR__ . '/config.php';

// Global CORS headers
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, x-device-id, x-installation-id, x-admin-key, x-admin-token, x-requested-with');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Clean Request URI
$requestUri = $_SERVER['REQUEST_URI'] ?? '/';
$parsedUrl = parse_url($requestUri);
$path = rtrim($parsedUrl['path'] ?? '/', '/');
if ($path === '') $path = '/';
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

// Allow method override via header or POST _method
if ($method === 'POST') {
    if (isset($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'])) {
        $method = strtoupper($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE']);
    } elseif (isset($_POST['_method'])) {
        $method = strtoupper($_POST['_method']);
    }
}

$db = get_db();

// -------------------------------------------------------------
// Route: Health Check
// -------------------------------------------------------------
if (($path === '/health' || $path === '/api/health') && $method === 'GET') {
    json_response([
        'success' => true,
        'status' => 'ok',
        'service' => 'FOX PLAYER MySQL REST API',
        'php_version' => PHP_VERSION,
        'timestamp' => gmdate('Y-m-d\TH:i:s\Z')
    ]);
}

// -------------------------------------------------------------
// Route: POST /api/devices/register
// -------------------------------------------------------------
if ($path === '/api/devices/register' && $method === 'POST') {
    $input = get_json_input();
    $deviceId = normalize_device_id($input['device_id'] ?? ($input['deviceId'] ?? ''));
    $installationId = $input['installation_id'] ?? ($input['installationId'] ?? null);
    $macAddress = $input['mac_address'] ?? ($input['mac'] ?? null);
    $appVersion = $input['app_version'] ?? '1.0.0';
    $ipAddress = $_SERVER['REMOTE_ADDR'] ?? null;

    if (empty($deviceId)) {
        json_response(['success' => false, 'error' => ['code' => 'INVALID_DEVICE_ID', 'message' => 'Device ID is required.']], 400);
    }

    // Insert or update device
    $stmt = $db->prepare("
        INSERT INTO devices (device_id, mac_address, installation_id, app_version, ip_address, last_seen_at)
        VALUES (?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
            mac_address = COALESCE(VALUES(mac_address), mac_address),
            installation_id = COALESCE(VALUES(installation_id), installation_id),
            app_version = VALUES(app_version),
            ip_address = VALUES(ip_address),
            last_seen_at = NOW()
    ");
    $stmt->execute([$deviceId, $macAddress, $installationId, $appVersion, $ipAddress]);

    // Check subscription settings for default trial days
    $setStmt = $db->query("SELECT trial_enabled, trial_duration_days FROM subscription_settings WHERE id = 1 LIMIT 1");
    $settings = $setStmt->fetch() ?: ['trial_enabled' => 1, 'trial_duration_days' => 7];
    $trialDays = (int)($settings['trial_duration_days'] ?? 7);

    // Check if subscription exists for this device or installation
    $subStmt = $db->prepare("
        SELECT * FROM subscriptions 
        WHERE device_id = ? OR (installation_id IS NOT NULL AND installation_id = ?)
        ORDER BY id DESC LIMIT 1
    ");
    $subStmt->execute([$deviceId, $installationId ?: '']);
    $sub = $subStmt->fetch();

    if (!$sub) {
        // Issue authoritative free trial
        $startsAt = gmdate('Y-m-d H:i:s');
        $expiresAt = gmdate('Y-m-d H:i:s', time() + ($trialDays * 86400));
        $insSub = $db->prepare("
            INSERT INTO subscriptions (installation_id, device_id, subscription_type, status, starts_at, expires_at, duration_days, source, notes)
            VALUES (?, ?, 'trial', 'active', ?, ?, ?, 'auto_trial', 'Default free trial granted upon device registration')
        ");
        $insSub->execute([$installationId, $deviceId, $startsAt, $expiresAt, $trialDays]);

        $sub = [
            'device_id' => $deviceId,
            'installation_id' => $installationId,
            'subscription_type' => 'trial',
            'status' => 'active',
            'starts_at' => $startsAt,
            'expires_at' => $expiresAt,
            'duration_days' => $trialDays,
        ];
    }

    // Calculate remaining days
    $expiryTime = strtotime($sub['expires_at'] . ' UTC');
    $now = time();
    $isActive = ($expiryTime > $now) && ($sub['status'] === 'active');
    $daysLeft = max(0, (int)ceil(($expiryTime - $now) / 86400));

    // Retrieve device id_lock state
    $dCheck = $db->prepare("SELECT id_lock FROM devices WHERE device_id = ? LIMIT 1");
    $dCheck->execute([$deviceId]);
    $devRow = $dCheck->fetch();
    $idLock = (bool)($devRow['id_lock'] ?? false);

    json_response([
        'success' => true,
        'device_id' => $deviceId,
        'installation_id' => $installationId,
        'id_lock' => $idLock,
        'device' => [
            'device_id' => $deviceId,
            'id_lock' => $idLock
        ],
        'status' => $isActive ? 'active' : 'expired',
        'subscription' => [
            'type' => $sub['subscription_type'],
            'status' => $sub['status'],
            'is_active' => $isActive,
            'days_left' => $daysLeft,
            'expires_at' => gmdate('Y-m-d\TH:i:s\Z', $expiryTime),
            'starts_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime($sub['starts_at'] . ' UTC'))
        ]
    ]);
}

// -------------------------------------------------------------
// Route: GET /api/subscription/status
// -------------------------------------------------------------
if ($path === '/api/subscription/status' && $method === 'GET') {
    $deviceId = normalize_device_id($_GET['device_id'] ?? ($_GET['deviceId'] ?? ''));
    $installationId = $_GET['installation_id'] ?? ($_GET['installationId'] ?? null);

    if (empty($deviceId) && empty($installationId)) {
        json_response(['success' => false, 'error' => ['code' => 'MISSING_PARAM', 'message' => 'device_id or installation_id required.']], 400);
    }

    $stmt = $db->prepare("
        SELECT s.*, d.id_lock, d.mac_address 
        FROM subscriptions s
        LEFT JOIN devices d ON d.device_id = s.device_id
        WHERE s.device_id = ? OR (s.installation_id IS NOT NULL AND s.installation_id = ?)
        ORDER BY s.id DESC LIMIT 1
    ");
    $stmt->execute([$deviceId, $installationId ?: '']);
    $sub = $stmt->fetch();

    if (!$sub) {
        json_response([
            'success' => true,
            'configured' => false,
            'status' => 'not_found',
            'is_active' => false,
            'days_left' => 0
        ]);
    }

    $expiryTime = strtotime($sub['expires_at'] . ' UTC');
    $now = time();
    $isActive = ($expiryTime > $now) && ($sub['status'] === 'active');
    $daysLeft = max(0, (int)ceil(($expiryTime - $now) / 86400));

    json_response([
        'success' => true,
        'device_id' => $sub['device_id'],
        'subscription_type' => $sub['subscription_type'],
        'status' => $isActive ? 'active' : 'expired',
        'is_active' => $isActive,
        'days_left' => $daysLeft,
        'expires_at' => gmdate('Y-m-d\TH:i:s\Z', $expiryTime),
        'starts_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime($sub['starts_at'] . ' UTC')),
        'id_lock' => (bool)($sub['id_lock'] ?? false)
    ]);
}

// -------------------------------------------------------------
// Route: GET /api/subscription/eligibility
// -------------------------------------------------------------
if ($path === '/api/subscription/eligibility' && $method === 'GET') {
    $deviceId = normalize_device_id($_GET['device_id'] ?? '');
    $installationId = $_GET['installation_id'] ?? '';

    $stmt = $db->prepare("
        SELECT id FROM subscriptions 
        WHERE device_id = ? OR (installation_id IS NOT NULL AND installation_id = ?)
        LIMIT 1
    ");
    $stmt->execute([$deviceId, $installationId]);
    $exists = $stmt->fetch();

    $setStmt = $db->query("SELECT trial_enabled, trial_duration_days FROM subscription_settings WHERE id = 1 LIMIT 1");
    $settings = $setStmt->fetch() ?: ['trial_enabled' => 1, 'trial_duration_days' => 7];

    json_response([
        'success' => true,
        'eligible' => empty($exists) && ((int)$settings['trial_enabled'] === 1),
        'trial_duration_days' => (int)$settings['trial_duration_days']
    ]);
}

// -------------------------------------------------------------
// Route: POST /api/subscription/activate-trial
// -------------------------------------------------------------
if ($path === '/api/subscription/activate-trial' && $method === 'POST') {
    $input = get_json_input();
    $deviceId = normalize_device_id($input['device_id'] ?? '');
    $installationId = $input['installation_id'] ?? null;

    if (empty($deviceId)) {
        json_response(['success' => false, 'error' => ['code' => 'INVALID_DEVICE_ID', 'message' => 'device_id required.']], 400);
    }

    $setStmt = $db->query("SELECT trial_enabled, trial_duration_days FROM subscription_settings WHERE id = 1 LIMIT 1");
    $settings = $setStmt->fetch() ?: ['trial_enabled' => 1, 'trial_duration_days' => 7];
    $trialDays = (int)($settings['trial_duration_days'] ?? 7);

    $startsAt = gmdate('Y-m-d H:i:s');
    $expiresAt = gmdate('Y-m-d H:i:s', time() + ($trialDays * 86400));

    $ins = $db->prepare("
        INSERT INTO subscriptions (installation_id, device_id, subscription_type, status, starts_at, expires_at, duration_days, source, notes)
        VALUES (?, ?, 'trial', 'active', ?, ?, ?, 'manual_trial', 'Free trial activated')
        ON DUPLICATE KEY UPDATE
            status = 'active',
            expires_at = VALUES(expires_at),
            updated_at = NOW()
    ");
    $ins->execute([$installationId, $deviceId, $startsAt, $expiresAt, $trialDays]);

    json_response([
        'success' => true,
        'message' => 'Free trial activated successfully.',
        'trial_duration_days' => $trialDays,
        'expires_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime($expiresAt . ' UTC'))
    ]);
}

// -------------------------------------------------------------
// Route: POST /api/subscription/activate (For 1 Year / Forever Web Activation)
// -------------------------------------------------------------
if ($path === '/api/subscription/activate' && $method === 'POST') {
    $input = get_json_input();
    $macOrDevice = normalize_device_id($input['mac'] ?? ($input['device_id'] ?? ''));
    $plan = strtoupper(trim($input['plan'] ?? 'YEAR_1')); // YEAR_1 or FOREVER

    if (empty($macOrDevice)) {
        json_response(['success' => false, 'error' => ['code' => 'INVALID_MAC', 'message' => 'MAC address or Device ID is required.']], 400);
    }

    // Ensure device exists and was registered by the application
    $devCheck = $db->prepare("SELECT id, device_id, id_lock FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1");
    $devCheck->execute([$macOrDevice, $macOrDevice]);
    $dev = $devCheck->fetch();

    if (!$dev) {
        json_response([
            'success' => false,
            'error' => [
                'code' => 'DEVICE_NOT_FOUND',
                'message' => 'Device ID not found in FOX PLAYER system. Please open FOX PLAYER app on your TV or streaming device first to generate and register your Device ID before activating.'
            ]
        ], 404);
    }
    $deviceId = $dev['device_id'];

    $durationDays = ($plan === 'FOREVER') ? 18250 : 365; // ~50 years or 1 year
    $subType = ($plan === 'FOREVER') ? 'forever' : 'year_1';
    $startsAt = gmdate('Y-m-d H:i:s');
    $expiresAt = gmdate('Y-m-d H:i:s', time() + ($durationDays * 86400));

    // Update or insert subscription
    $subStmt = $db->prepare("SELECT id FROM subscriptions WHERE device_id = ? LIMIT 1");
    $subStmt->execute([$deviceId]);
    $existing = $subStmt->fetch();

    if ($existing) {
        $upd = $db->prepare("
            UPDATE subscriptions 
            SET subscription_type = ?, status = 'active', starts_at = ?, expires_at = ?, duration_days = ?, source = 'portal_activation', updated_at = NOW()
            WHERE id = ?
        ");
        $upd->execute([$subType, $startsAt, $expiresAt, $durationDays, $existing['id']]);
    } else {
        $ins = $db->prepare("
            INSERT INTO subscriptions (device_id, subscription_type, status, starts_at, expires_at, duration_days, source, notes)
            VALUES (?, ?, 'active', ?, ?, ?, 'portal_activation', 'Web portal activation')
        ");
        $ins->execute([$deviceId, $subType, $startsAt, $expiresAt, $durationDays]);
    }

    // Audit log
    $audit = $db->prepare("INSERT INTO subscription_audit_logs (action, target_type, target_id, performed_by, details) VALUES ('web_activation', 'device', ?, 'user_portal', ?)");
    $audit->execute([$deviceId, json_encode(['plan' => $plan, 'expires_at' => $expiresAt])]);

    json_response([
        'success' => true,
        'message' => 'Your MAC address / Device is activated successfully! Please restart the FOX PLAYER app.',
        'device_id' => $deviceId,
        'plan' => $subType,
        'status' => 'active',
        'expires_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime($expiresAt . ' UTC')),
        'days_left' => $durationDays
    ]);
}

// -------------------------------------------------------------
// Route: GET /api/device/{deviceId}/validate (Verify device generated by app)
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/validate$#', $path, $matches) && $method === 'GET') {
    $rawId = $matches[1];
    $deviceId = normalize_device_id($rawId);

    $stmt = $db->prepare("
        SELECT id, device_id, mac_address, installation_id, id_lock, status, app_version, created_at, last_seen_at
        FROM devices 
        WHERE device_id = ? OR mac_address = ? 
        LIMIT 1
    ");
    $stmt->execute([$deviceId, $deviceId]);
    $row = $stmt->fetch();

    if (!$row) {
        json_response([
            'success' => false,
            'registered' => false,
            'device_id' => $deviceId,
            'error' => [
                'code' => 'DEVICE_NOT_FOUND',
                'message' => 'Device ID not found in FOX PLAYER system. Please open FOX PLAYER app on your TV or device first so your Device ID is generated and registered.'
            ]
        ], 404);
    }

    json_response([
        'success' => true,
        'registered' => true,
        'device_id' => $row['device_id'],
        'mac_address' => $row['mac_address'],
        'id_lock' => (bool)$row['id_lock'],
        'status' => $row['status'],
        'app_version' => $row['app_version'],
        'created_at' => $row['created_at'],
        'last_seen_at' => $row['last_seen_at']
    ]);
}

// -------------------------------------------------------------
// Route: GET /api/device/{deviceId}/playlists
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/playlists$#', $path, $matches) && $method === 'GET') {
    $deviceId = normalize_device_id($matches[1]);

    // Check device existence
    $devCheck = $db->prepare("SELECT id, device_id, id_lock FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1");
    $devCheck->execute([$deviceId, $deviceId]);
    $devRow = $devCheck->fetch();

    if (!$devRow) {
        json_response([
            'success' => false,
            'error' => [
                'code' => 'DEVICE_NOT_FOUND',
                'message' => 'Device not found. Please open FOX PLAYER app on your TV or device first to register this ID.'
            ]
        ], 404);
    }
    $canonicalDeviceId = $devRow['device_id'];

    $stmt = $db->prepare("
        SELECT dp.id as device_playlist_id, dp.playlist_id, dp.playlist_name, dp.is_active, dp.enabled,
               p.type, p.playlist_url, p.server_url, p.username, p.password_encrypted
        FROM device_playlists dp
        JOIN playlists p ON p.id = dp.playlist_id
        WHERE dp.device_id = ?
        ORDER BY dp.is_active DESC, dp.id ASC
    ");
    $stmt->execute([$canonicalDeviceId]);
    $rows = $stmt->fetchAll();

    $playlists = [];
    foreach ($rows as $r) {
        $playlists[] = [
            'id' => (int)$r['playlist_id'],
            'device_playlist_id' => (int)$r['device_playlist_id'],
            'type' => $r['type'],
            'playlist_name' => $r['playlist_name'],
            'playlist_url' => $r['playlist_url'],
            'server_url' => $r['server_url'],
            'username' => $r['username'],
            'password' => decrypt_secret($r['password_encrypted']),
            'is_active' => (bool)$r['is_active'],
            'enabled' => (bool)$r['enabled']
        ];
    }

    json_response([
        'success' => true,
        'device_id' => $canonicalDeviceId,
        'id_lock' => (bool)$devRow['id_lock'],
        'count' => count($playlists),
        'playlists' => $playlists
    ]);
}

// -------------------------------------------------------------
// Route: GET /api/device/{deviceId}/playlist (Active or specific config)
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/playlist$#', $path, $matches) && $method === 'GET') {
    $deviceId = normalize_device_id($matches[1]);
    $playlistId = isset($_GET['playlist_id']) ? (int)$_GET['playlist_id'] : null;

    if ($playlistId) {
        $stmt = $db->prepare("
            SELECT dp.playlist_id, dp.playlist_name, dp.is_active, dp.enabled,
                   p.type, p.playlist_url, p.server_url, p.username, p.password_encrypted
            FROM device_playlists dp
            JOIN playlists p ON p.id = dp.playlist_id
            WHERE dp.device_id = ? AND dp.playlist_id = ?
            LIMIT 1
        ");
        $stmt->execute([$deviceId, $playlistId]);
    } else {
        $stmt = $db->prepare("
            SELECT dp.playlist_id, dp.playlist_name, dp.is_active, dp.enabled,
                   p.type, p.playlist_url, p.server_url, p.username, p.password_encrypted
            FROM device_playlists dp
            JOIN playlists p ON p.id = dp.playlist_id
            WHERE dp.device_id = ? AND dp.is_active = 1
            LIMIT 1
        ");
        $stmt->execute([$deviceId]);
    }

    $r = $stmt->fetch();
    if (!$r) {
        // Fallback to first available playlist for this device
        $fallback = $db->prepare("
            SELECT dp.playlist_id, dp.playlist_name, dp.is_active, dp.enabled,
                   p.type, p.playlist_url, p.server_url, p.username, p.password_encrypted
            FROM device_playlists dp
            JOIN playlists p ON p.id = dp.playlist_id
            WHERE dp.device_id = ?
            ORDER BY dp.id ASC LIMIT 1
        ");
        $fallback->execute([$deviceId]);
        $r = $fallback->fetch();
    }

    if (!$r) {
        json_response([
            'success' => true,
            'configured' => false,
            'device_id' => $deviceId,
            'message' => 'No playlists configured for this device.'
        ]);
    }

    json_response([
        'success' => true,
        'configured' => true,
        'device_id' => $deviceId,
        'playlist_id' => (int)$r['playlist_id'],
        'type' => $r['type'],
        'playlist_name' => $r['playlist_name'],
        'playlist_url' => $r['playlist_url'],
        'server_url' => $r['server_url'],
        'username' => $r['username'],
        'password' => decrypt_secret($r['password_encrypted']),
        'is_active' => (bool)$r['is_active']
    ]);
}

// -------------------------------------------------------------
// Route: POST /api/device/{deviceId}/playlists (Add Playlist)
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/playlists$#', $path, $matches) && $method === 'POST') {
    $deviceId = normalize_device_id($matches[1]);
    $input = get_json_input();

    $type = strtolower(trim($input['type'] ?? 'm3u'));
    $name = trim($input['playlist_name'] ?? ($input['name'] ?? 'My Playlist'));
    $playlistUrl = trim($input['playlist_url'] ?? ($input['url'] ?? ''));
    $serverUrl = trim($input['server_url'] ?? ($input['host'] ?? ''));
    $username = trim($input['username'] ?? '');
    $password = trim($input['password'] ?? '');

    if ($type !== 'm3u' && $type !== 'xtream') {
        json_response(['success' => false, 'error' => ['code' => 'INVALID_TYPE', 'message' => 'Type must be m3u or xtream.']], 400);
    }

    // Verify device exists and was registered by FOX PLAYER app
    $devCheck = $db->prepare("SELECT id, device_id, id_lock FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1");
    $devCheck->execute([$deviceId, $deviceId]);
    $devRow = $devCheck->fetch();

    if (!$devRow) {
        json_response([
            'success' => false,
            'error' => [
                'code' => 'DEVICE_NOT_FOUND',
                'message' => 'Device ID not found in FOX PLAYER network. Please open the FOX PLAYER app on your TV or mobile device first so your Device ID is generated and registered.'
            ]
        ], 404);
    }

    // Check device lock
    if ((int)$devRow['id_lock'] === 1) {
        json_response([
            'success' => false,
            'error' => [
                'code' => 'DEVICE_LOCKED',
                'message' => 'Device is Locked! This device has been locked in FOX PLAYER app settings. Please unlock it from the app first before adding or modifying playlists.'
            ]
        ], 403);
    }

    $canonicalDeviceId = $devRow['device_id'];

    // Update last seen
    $db->prepare("UPDATE devices SET last_seen_at = NOW() WHERE id = ?")->execute([$devRow['id']]);

    // Check if playlist exists or insert
    $pwEncrypted = encrypt_secret($password);
    $playlistId = null;

    if ($type === 'xtream') {
        $pFind = $db->prepare("SELECT id FROM playlists WHERE type = 'xtream' AND server_url = ? AND username = ? LIMIT 1");
        $pFind->execute([$serverUrl, $username]);
        $rowP = $pFind->fetch();
        if ($rowP) {
            $playlistId = (int)$rowP['id'];
            $db->prepare("UPDATE playlists SET password_encrypted = ?, updated_at = NOW() WHERE id = ?")->execute([$pwEncrypted, $playlistId]);
        }
    } else {
        $pFind = $db->prepare("SELECT id FROM playlists WHERE type = 'm3u' AND playlist_url = ? LIMIT 1");
        $pFind->execute([$playlistUrl]);
        $rowP = $pFind->fetch();
        if ($rowP) $playlistId = (int)$rowP['id'];
    }

    if (!$playlistId) {
        $pIns = $db->prepare("
            INSERT INTO playlists (type, playlist_url, server_url, username, password_encrypted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NOW(), NOW())
        ");
        $pIns->execute([$type, $playlistUrl ?: null, $serverUrl ?: null, $username ?: null, $pwEncrypted ?: null]);
        $playlistId = (int)$db->lastInsertId();
    }

    // Check how many playlists exist for this device. If 0, make this active.
    $cntStmt = $db->prepare("SELECT COUNT(*) FROM device_playlists WHERE device_id = ?");
    $cntStmt->execute([$canonicalDeviceId]);
    $count = (int)$cntStmt->fetchColumn();
    $isActive = ($count === 0) ? 1 : 0;

    $dpIns = $db->prepare("
        INSERT INTO device_playlists (device_id, playlist_id, playlist_name, is_active, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
            playlist_name = VALUES(playlist_name),
            enabled = 1,
            updated_at = NOW()
    ");
    $dpIns->execute([$canonicalDeviceId, $playlistId, $name, $isActive]);

    json_response([
        'success' => true,
        'message' => 'Playlist added successfully. Please reload playlist in your FOX PLAYER app.',
        'playlist_id' => $playlistId,
        'device_id' => $canonicalDeviceId,
        'is_active' => (bool)$isActive
    ]);
}

// -------------------------------------------------------------
// Route: POST /api/device/{deviceId}/active-playlist
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/active-playlist$#', $path, $matches) && $method === 'POST') {
    $deviceId = normalize_device_id($matches[1]);
    $input = get_json_input();
    $playlistId = (int)($input['playlist_id'] ?? 0);

    if ($playlistId <= 0) {
        json_response(['success' => false, 'error' => ['code' => 'INVALID_PARAM', 'message' => 'playlist_id is required.']], 400);
    }

    // Check device existence & lock
    $devCheck = $db->prepare("SELECT id, device_id, id_lock FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1");
    $devCheck->execute([$deviceId, $deviceId]);
    $devRow = $devCheck->fetch();

    if (!$devRow) {
        json_response(['success' => false, 'error' => ['code' => 'DEVICE_NOT_FOUND', 'message' => 'Device not found.']], 404);
    }
    if ((int)$devRow['id_lock'] === 1) {
        json_response(['success' => false, 'error' => ['code' => 'DEVICE_LOCKED', 'message' => 'Device is Locked! This device has been locked in FOX PLAYER app settings. Please unlock it from the app first before modifying playlists.']], 403);
    }
    $canonicalDeviceId = $devRow['device_id'];

    // Set all to 0, then set target to 1
    $db->prepare("UPDATE device_playlists SET is_active = 0 WHERE device_id = ?")->execute([$canonicalDeviceId]);
    $stmt = $db->prepare("UPDATE device_playlists SET is_active = 1, last_used_at = NOW() WHERE device_id = ? AND playlist_id = ?");
    $stmt->execute([$canonicalDeviceId, $playlistId]);

    json_response([
        'success' => true,
        'message' => 'Active playlist updated.',
        'device_id' => $canonicalDeviceId,
        'playlist_id' => $playlistId
    ]);
}

// -------------------------------------------------------------
// Route: DELETE /api/device/{deviceId}/playlist/{playlistId}
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/playlist/([^/]+)$#', $path, $matches) && $method === 'DELETE') {
    $deviceId = normalize_device_id($matches[1]);
    $playlistId = (int)$matches[2];

    // Check device existence & lock
    $devCheck = $db->prepare("SELECT id, device_id, id_lock FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1");
    $devCheck->execute([$deviceId, $deviceId]);
    $devRow = $devCheck->fetch();

    if (!$devRow) {
        json_response(['success' => false, 'error' => ['code' => 'DEVICE_NOT_FOUND', 'message' => 'Device not found.']], 404);
    }
    if ((int)$devRow['id_lock'] === 1) {
        json_response(['success' => false, 'error' => ['code' => 'DEVICE_LOCKED', 'message' => 'Device is Locked! This device has been locked in FOX PLAYER app settings. Please unlock it from the app first before modifying playlists.']], 403);
    }
    $canonicalDeviceId = $devRow['device_id'];

    $del = $db->prepare("DELETE FROM device_playlists WHERE device_id = ? AND playlist_id = ?");
    $del->execute([$canonicalDeviceId, $playlistId]);

    // If an active one was deleted, make another one active
    $cntActive = $db->prepare("SELECT COUNT(*) FROM device_playlists WHERE device_id = ? AND is_active = 1");
    $cntActive->execute([$canonicalDeviceId]);
    if ((int)$cntActive->fetchColumn() === 0) {
        $db->prepare("UPDATE device_playlists SET is_active = 1 WHERE device_id = ? LIMIT 1")->execute([$canonicalDeviceId]);
    }

    json_response(['success' => true, 'message' => 'Playlist removed from device.', 'device_id' => $canonicalDeviceId]);
}

// -------------------------------------------------------------
// Route: DELETE /api/device/{deviceId}/playlists/all (HotPlayer Wipe Feature)
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/playlists/all$#', $path, $matches) && ($method === 'DELETE' || $method === 'POST')) {
    $deviceId = normalize_device_id($matches[1]);

    // Check device existence & lock
    $devCheck = $db->prepare("SELECT id, device_id, id_lock FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1");
    $devCheck->execute([$deviceId, $deviceId]);
    $devRow = $devCheck->fetch();

    if (!$devRow) {
        json_response(['success' => false, 'error' => ['code' => 'DEVICE_NOT_FOUND', 'message' => 'Device not found.']], 404);
    }
    if ((int)$devRow['id_lock'] === 1) {
        json_response(['success' => false, 'error' => ['code' => 'DEVICE_LOCKED', 'message' => 'Device is Locked! This device has been locked in FOX PLAYER app settings. Please unlock it from the app first before wiping playlists.']], 403);
    }
    $canonicalDeviceId = $devRow['device_id'];

    $db->prepare("DELETE FROM device_playlists WHERE device_id = ?")->execute([$canonicalDeviceId]);
    json_response(['success' => true, 'message' => 'All playlist links removed successfully from device.', 'device_id' => $canonicalDeviceId]);
}

// -------------------------------------------------------------
// Route: GET /api/device/{deviceId}/id-lock
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/id-lock$#', $path, $matches) && $method === 'GET') {
    $deviceId = normalize_device_id($matches[1]);
    $stmt = $db->prepare("SELECT id, device_id, id_lock FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1");
    $stmt->execute([$deviceId, $deviceId]);
    $row = $stmt->fetch();

    if (!$row) {
        json_response(['success' => false, 'error' => ['code' => 'DEVICE_NOT_FOUND', 'message' => 'Device not found.']], 404);
    }

    json_response(['success' => true, 'device_id' => $row['device_id'], 'id_lock' => (bool)$row['id_lock']]);
}

// -------------------------------------------------------------
// Route: POST /api/device/{deviceId}/id-lock (Toggle Lock from App)
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/id-lock$#', $path, $matches) && $method === 'POST') {
    $deviceId = normalize_device_id($matches[1]);
    $input = get_json_input();
    $idLock = !empty($input['id_lock']) ? 1 : 0;

    $stmt = $db->prepare("SELECT id, device_id FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1");
    $stmt->execute([$deviceId, $deviceId]);
    $row = $stmt->fetch();

    if (!$row) {
        json_response([
            'success' => false,
            'error' => ['code' => 'DEVICE_NOT_FOUND', 'message' => 'Device not found. Please open FOX PLAYER app on your device first.']
        ], 404);
    }

    $upd = $db->prepare("UPDATE devices SET id_lock = ?, last_seen_at = NOW() WHERE id = ?");
    $upd->execute([$idLock, $row['id']]);

    json_response(['success' => true, 'device_id' => $row['device_id'], 'id_lock' => (bool)$idLock]);
}

// -------------------------------------------------------------
// Route: GET /api/device/{deviceId}/pairing-token
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/pairing-token$#', $path, $matches) && $method === 'GET') {
    $deviceId = normalize_device_id($matches[1]);
    $pairingCode = sprintf('%06d', random_int(100000, 999999));
    $pairingToken = bin2hex(random_bytes(24));
    $expiresAt = gmdate('Y-m-d H:i:s', time() + 900); // 15 mins

    $db->prepare("
        INSERT INTO devices (device_id, pairing_code, pairing_token, pairing_token_expires_at, last_seen_at)
        VALUES (?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
            pairing_code = VALUES(pairing_code),
            pairing_token = VALUES(pairing_token),
            pairing_token_expires_at = VALUES(pairing_token_expires_at)
    ")->execute([$deviceId, $pairingCode, $pairingToken, $expiresAt]);

    json_response([
        'success' => true,
        'device_id' => $deviceId,
        'pairing_code' => $pairingCode,
        'pairing_token' => $pairingToken,
        'expires_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime($expiresAt . ' UTC'))
    ]);
}

// -------------------------------------------------------------
// Route: POST /api/auth/pair
// -------------------------------------------------------------
if ($path === '/api/auth/pair' && $method === 'POST') {
    $input = get_json_input();
    $deviceId = normalize_device_id($input['device_id'] ?? '');
    $codeOrToken = trim($input['code'] ?? ($input['token'] ?? ''));

    $stmt = $db->prepare("
        SELECT id, id_lock, pairing_token_expires_at 
        FROM devices 
        WHERE device_id = ? AND (pairing_code = ? OR pairing_token = ?)
        LIMIT 1
    ");
    $stmt->execute([$deviceId, $codeOrToken, $codeOrToken]);
    $row = $stmt->fetch();

    if (!$row) {
        json_response(['success' => false, 'error' => ['code' => 'INVALID_CODE', 'message' => 'Invalid or expired pairing code.']], 401);
    }

    $sessionToken = bin2hex(random_bytes(32));
    $sessExpires = gmdate('Y-m-d H:i:s', time() + 86400 * 7);

    $db->prepare("UPDATE devices SET session_token = ?, session_token_expires_at = ? WHERE id = ?")->execute([$sessionToken, $sessExpires, $row['id']]);

    json_response([
        'success' => true,
        'device_id' => $deviceId,
        'session_token' => $sessionToken,
        'expires_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime($sessExpires . ' UTC')),
        'id_lock' => (bool)$row['id_lock']
    ]);
}

// -------------------------------------------------------------
// Route: POST /api/device/{deviceId}/session
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/session$#', $path, $matches) && $method === 'POST') {
    $deviceId = normalize_device_id($matches[1]);
    $sessionToken = bin2hex(random_bytes(32));
    $sessExpires = gmdate('Y-m-d H:i:s', time() + 86400 * 7);

    $db->prepare("
        INSERT INTO devices (device_id, session_token, session_token_expires_at, last_seen_at)
        VALUES (?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE session_token = VALUES(session_token), session_token_expires_at = VALUES(session_token_expires_at)
    ")->execute([$deviceId, $sessionToken, $sessExpires]);

    json_response([
        'success' => true,
        'device_id' => $deviceId,
        'session_token' => $sessionToken,
        'expires_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime($sessExpires . ' UTC'))
    ]);
}

// =============================================================
// ADMIN ROUTES
// =============================================================

// Route: POST /api/admin/login
if ($path === '/api/admin/login' && $method === 'POST') {
    $input = get_json_input();
    $password = trim($input['password'] ?? '');

    if ($password !== ADMIN_SECRET) {
        json_response(['success' => false, 'error' => ['code' => 'INVALID_CREDENTIALS', 'message' => 'Invalid admin secret password.']], 401);
    }

    $token = hash('sha256', $password . '_SESSION_' . time());
    // Store in admins table
    $db->prepare("
        INSERT INTO admins (username, password_hash, created_at)
        VALUES ('admin', ?, NOW())
        ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)
    ")->execute([$token]);

    json_response([
        'success' => true,
        'token' => $token,
        'expires_at' => gmdate('Y-m-d\TH:i:s\Z', time() + 86400)
    ]);
}

// Require admin auth for all subsequent /api/admin/* routes
if (str_starts_with($path, '/api/admin/')) {
    if (!verify_admin()) {
        json_response(['success' => false, 'error' => ['code' => 'UNAUTHORIZED_ADMIN', 'message' => 'Administrative authorization required.']], 401);
    }
}

// Route: GET /api/admin/stats
if ($path === '/api/admin/stats' && $method === 'GET') {
    $totalDevices = (int)$db->query("SELECT COUNT(*) FROM devices")->fetchColumn();
    $activeDevices = (int)$db->query("SELECT COUNT(*) FROM devices WHERE last_seen_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)")->fetchColumn();
    
    $trialUsers = (int)$db->query("SELECT COUNT(*) FROM subscriptions WHERE subscription_type = 'trial' AND expires_at > NOW() AND status = 'active'")->fetchColumn();
    $paid1Year = (int)$db->query("SELECT COUNT(*) FROM subscriptions WHERE subscription_type = 'year_1' AND expires_at > NOW() AND status = 'active'")->fetchColumn();
    $paidForever = (int)$db->query("SELECT COUNT(*) FROM subscriptions WHERE subscription_type = 'forever' AND status = 'active'")->fetchColumn();
    $expiredUsers = (int)$db->query("SELECT COUNT(*) FROM subscriptions WHERE expires_at <= NOW() OR status = 'expired'")->fetchColumn();
    
    $totalPlaylists = (int)$db->query("SELECT COUNT(*) FROM playlists")->fetchColumn();
    $m3uPlaylists = (int)$db->query("SELECT COUNT(*) FROM playlists WHERE type = 'm3u'")->fetchColumn();
    $xtreamPlaylists = (int)$db->query("SELECT COUNT(*) FROM playlists WHERE type = 'xtream'")->fetchColumn();

    $setStmt = $db->query("SELECT trial_enabled, trial_duration_days FROM subscription_settings WHERE id = 1 LIMIT 1");
    $settings = $setStmt->fetch() ?: ['trial_enabled' => 1, 'trial_duration_days' => 7];

    json_response([
        'success' => true,
        'stats' => [
            'total_devices' => $totalDevices,
            'active_devices_7d' => $activeDevices,
            'trial_users' => $trialUsers,
            'paid_users' => $paid1Year + $paidForever,
            'paid_1year' => $paid1Year,
            'paid_forever' => $paidForever,
            'expired_users' => $expiredUsers,
            'total_playlists' => $totalPlaylists,
            'm3u_playlists' => $m3uPlaylists,
            'xtream_playlists' => $xtreamPlaylists,
            'trial_enabled' => (bool)$settings['trial_enabled'],
            'trial_duration_days' => (int)$settings['trial_duration_days']
        ]
    ]);
}

// Route: GET /api/admin/trial-settings
if ($path === '/api/admin/trial-settings' && $method === 'GET') {
    $stmt = $db->query("SELECT id, trial_enabled, trial_duration_days, updated_at, updated_by, notes FROM subscription_settings WHERE id = 1 LIMIT 1");
    $settings = $stmt->fetch() ?: ['trial_enabled' => 1, 'trial_duration_days' => 7];
    json_response(['success' => true, 'settings' => $settings]);
}

// Route: PUT/POST /api/admin/trial-settings (Update default trial days)
if ($path === '/api/admin/trial-settings' && ($method === 'PUT' || $method === 'POST')) {
    $input = get_json_input();
    $trialEnabled = isset($input['trial_enabled']) ? (int)(bool)$input['trial_enabled'] : 1;
    $trialDays = (int)($input['trial_duration_days'] ?? 7);
    if ($trialDays < 1) $trialDays = 7;
    $notes = trim($input['notes'] ?? 'Updated via admin dashboard');

    $stmt = $db->prepare("
        INSERT INTO subscription_settings (id, trial_enabled, trial_duration_days, updated_at, updated_by, notes)
        VALUES (1, ?, ?, NOW(), 'admin', ?)
        ON DUPLICATE KEY UPDATE
            trial_enabled = VALUES(trial_enabled),
            trial_duration_days = VALUES(trial_duration_days),
            updated_at = NOW(),
            updated_by = 'admin',
            notes = VALUES(notes)
    ");
    $stmt->execute([$trialEnabled, $trialDays, $notes]);

    // Audit log
    $db->prepare("INSERT INTO subscription_audit_logs (action, target_type, target_id, details) VALUES ('update_trial_settings', 'settings', '1', ?)")
       ->execute([json_encode(['trial_duration_days' => $trialDays, 'trial_enabled' => $trialEnabled])]);

    json_response([
        'success' => true,
        'message' => 'Default trial settings updated successfully. New trial duration will apply to subsequent registrations.',
        'settings' => [
            'trial_enabled' => (bool)$trialEnabled,
            'trial_duration_days' => $trialDays,
            'updated_at' => gmdate('Y-m-d\TH:i:s\Z')
        ]
    ]);
}

// Route: GET /api/admin/devices
if ($path === '/api/admin/devices' && $method === 'GET') {
    $search = trim($_GET['search'] ?? '');
    $filter = trim($_GET['filter'] ?? 'all'); // all, trial, paid, expired
    $limit = min(100, max(1, (int)($_GET['limit'] ?? 50)));
    $offset = max(0, (int)($_GET['offset'] ?? 0));

    $sql = "
        SELECT d.id, d.device_id, d.mac_address, d.id_lock, d.status as device_status, d.last_seen_at, d.created_at,
               s.subscription_type, s.status as sub_status, s.starts_at, s.expires_at, s.duration_days,
               COUNT(dp.id) as playlists_count
        FROM devices d
        LEFT JOIN subscriptions s ON s.device_id = d.device_id
        LEFT JOIN device_playlists dp ON dp.device_id = d.device_id
    ";

    $where = [];
    $params = [];

    if (!empty($search)) {
        $where[] = "(d.device_id LIKE ? OR d.mac_address LIKE ?)";
        $params[] = "%{$search}%";
        $params[] = "%{$search}%";
    }

    if ($filter === 'trial') {
        $where[] = "s.subscription_type = 'trial' AND s.expires_at > NOW() AND s.status = 'active'";
    } elseif ($filter === 'paid') {
        $where[] = "s.subscription_type IN ('year_1', 'forever', 'custom') AND s.status = 'active'";
    } elseif ($filter === 'expired') {
        $where[] = "(s.expires_at <= NOW() OR s.status = 'expired')";
    }

    if (!empty($where)) {
        $sql .= " WHERE " . implode(' AND ', $where);
    }

    $sql .= " GROUP BY d.id, s.id ORDER BY d.id DESC LIMIT {$limit} OFFSET {$offset}";

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $devices = $stmt->fetchAll();

    $now = time();
    foreach ($devices as &$dev) {
        $expiryTime = !empty($dev['expires_at']) ? strtotime($dev['expires_at'] . ' UTC') : 0;
        $dev['is_active'] = ($expiryTime > $now) && ($dev['sub_status'] === 'active');
        $dev['days_left'] = max(0, (int)ceil(($expiryTime - $now) / 86400));
        $dev['playlists_count'] = (int)$dev['playlists_count'];
    }

    json_response(['success' => true, 'count' => count($devices), 'devices' => $devices]);
}

// Route: GET /api/admin/devices/{id} (Full details + playlists)
if (preg_match('#^/api/admin/devices/([^/]+)$#', $path, $matches) && $method === 'GET') {
    $idOrDevice = normalize_device_id($matches[1]);
    $stmt = $db->prepare("
        SELECT d.*, s.subscription_type, s.status as sub_status, s.starts_at, s.expires_at, s.duration_days, s.source
        FROM devices d
        LEFT JOIN subscriptions s ON s.device_id = d.device_id
        WHERE d.device_id = ? OR d.mac_address = ?
        LIMIT 1
    ");
    $stmt->execute([$idOrDevice, $idOrDevice]);
    $dev = $stmt->fetch();

    if (!$dev) {
        json_response(['success' => false, 'error' => ['code' => 'NOT_FOUND', 'message' => 'Device not found.']], 404);
    }

    // Get playlists
    $pStmt = $db->prepare("
        SELECT dp.id as device_playlist_id, dp.playlist_name, dp.is_active, dp.enabled, dp.created_at,
               p.type, p.playlist_url, p.server_url, p.username, p.password_encrypted
        FROM device_playlists dp
        JOIN playlists p ON p.id = dp.playlist_id
        WHERE dp.device_id = ?
        ORDER BY dp.id ASC
    ");
    $pStmt->execute([$dev['device_id']]);
    $pRows = $pStmt->fetchAll();

    $playlists = [];
    foreach ($pRows as $p) {
        $playlists[] = [
            'id' => (int)$p['device_playlist_id'],
            'name' => $p['playlist_name'],
            'type' => $p['type'],
            'url' => $p['playlist_url'],
            'server_url' => $p['server_url'],
            'username' => $p['username'],
            'password' => decrypt_secret($p['password_encrypted']),
            'is_active' => (bool)$p['is_active'],
            'enabled' => (bool)$p['enabled'],
            'created_at' => $p['created_at']
        ];
    }

    $expiryTime = !empty($dev['expires_at']) ? strtotime($dev['expires_at'] . ' UTC') : 0;
    $now = time();
    $dev['is_active'] = ($expiryTime > $now) && ($dev['sub_status'] === 'active');
    $dev['days_left'] = max(0, (int)ceil(($expiryTime - $now) / 86400));
    $dev['playlists'] = $playlists;

    json_response(['success' => true, 'device' => $dev]);
}

// Route: PUT/POST /api/admin/devices/{id}/subscription (Edit subscription)
if (preg_match('#^/api/admin/devices/([^/]+)/subscription$#', $path, $matches) && ($method === 'PUT' || $method === 'POST')) {
    $idOrDevice = normalize_device_id($matches[1]);
    $input = get_json_input();

    $subType = strtolower(trim($input['subscription_type'] ?? 'year_1'));
    $status = strtolower(trim($input['status'] ?? 'active'));
    $durationDays = isset($input['duration_days']) ? (int)$input['duration_days'] : null;
    $expiresAt = trim($input['expires_at'] ?? '');
    $notes = trim($input['notes'] ?? 'Admin manual update');

    // Get device ID
    $dStmt = $db->prepare("SELECT device_id FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1");
    $dStmt->execute([$idOrDevice, $idOrDevice]);
    $dev = $dStmt->fetch();
    $deviceId = $dev ? $dev['device_id'] : $idOrDevice;

    if (!empty($expiresAt)) {
        $expiryDb = gmdate('Y-m-d H:i:s', strtotime($expiresAt));
        $durationDays = max(1, (int)ceil((strtotime($expiresAt) - time()) / 86400));
    } else {
        $durationDays = $durationDays ?: 365;
        $expiryDb = gmdate('Y-m-d H:i:s', time() + ($durationDays * 86400));
    }

    $startsAt = gmdate('Y-m-d H:i:s');

    $checkSub = $db->prepare("SELECT id FROM subscriptions WHERE device_id = ? LIMIT 1");
    $checkSub->execute([$deviceId]);
    $existing = $checkSub->fetch();

    if ($existing) {
        $upd = $db->prepare("
            UPDATE subscriptions 
            SET subscription_type = ?, status = ?, expires_at = ?, duration_days = ?, notes = ?, updated_at = NOW()
            WHERE id = ?
        ");
        $upd->execute([$subType, $status, $expiryDb, $durationDays, $notes, $existing['id']]);
    } else {
        $ins = $db->prepare("
            INSERT INTO subscriptions (device_id, subscription_type, status, starts_at, expires_at, duration_days, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ");
        $ins->execute([$deviceId, $subType, $status, $startsAt, $expiryDb, $durationDays, $notes]);
    }

    // Audit log
    $db->prepare("INSERT INTO subscription_audit_logs (action, target_type, target_id, details) VALUES ('admin_update_subscription', 'device', ?, ?)")
       ->execute([$deviceId, json_encode(['type' => $subType, 'status' => $status, 'expires_at' => $expiryDb])]);

    json_response([
        'success' => true,
        'message' => 'Subscription updated successfully.',
        'device_id' => $deviceId,
        'subscription' => [
            'type' => $subType,
            'status' => $status,
            'expires_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime($expiryDb . ' UTC')),
            'days_left' => $durationDays
        ]
    ]);
}

// Route: DELETE /api/admin/devices/{id}
if (preg_match('#^/api/admin/devices/([^/]+)$#', $path, $matches) && $method === 'DELETE') {
    $idOrDevice = normalize_device_id($matches[1]);
    $db->prepare("DELETE FROM devices WHERE device_id = ? OR mac_address = ?")->execute([$idOrDevice, $idOrDevice]);
    $db->prepare("DELETE FROM subscriptions WHERE device_id = ?")->execute([$idOrDevice]);
    $db->prepare("DELETE FROM device_playlists WHERE device_id = ?")->execute([$idOrDevice]);

    json_response(['success' => true, 'message' => 'Device and associated records deleted.']);
}

// Route: GET /api/admin/audit-logs
if ($path === '/api/admin/audit-logs' && $method === 'GET') {
    $limit = min(100, max(1, (int)($_GET['limit'] ?? 50)));
    $stmt = $db->prepare("SELECT * FROM subscription_audit_logs ORDER BY id DESC LIMIT {$limit}");
    $stmt->execute();
    json_response(['success' => true, 'logs' => $stmt->fetchAll()]);
}

// -------------------------------------------------------------
// 404 Route Not Found
// -------------------------------------------------------------
json_response([
    'success' => false,
    'error' => [
        'code' => 'NOT_FOUND',
        'message' => "The requested route '{$method} {$path}' was not found on this server."
    ]
], 404);
