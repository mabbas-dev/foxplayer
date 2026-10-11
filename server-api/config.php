<?php
// FOX PLAYER Production API Configuration — PHP 8.2 & MariaDB / MySQL
declare(strict_types=1);

// Database configuration
define('DB_HOST', 'localhost');
define('DB_NAME', 'u139837297_fox_db');
define('DB_USER', 'u139837297_fox_db');
define('DB_PASS', '6pXeaXlP@');
define('DB_CHARSET', 'utf8mb4');

// Security secrets
define('ENCRYPTION_KEY', hash('sha256', 'FOX_PLAYER_CIPHER_KEY_2026_PRODUCTION_SECURE'));
define('ADMIN_SECRET', 'fox_admin_2026');

/**
 * Get singleton PDO instance
 */
function get_db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s', DB_HOST, DB_NAME, DB_CHARSET);
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_PERSISTENT         => false,
        ];
        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
        } catch (PDOException $e) {
            json_response([
                'success' => false,
                'error' => [
                    'code' => 'DB_CONNECTION_FAILED',
                    'message' => 'Database connection failed: ' . $e->getMessage()
                ]
            ], 500);
            exit;
        }
    }
    return $pdo;
}

/**
 * JSON Response helper
 */
function json_response(array $data, int $statusCode = 200): void {
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Read JSON input payload
 */
function get_json_input(): array {
    $raw = file_get_contents('php://input');
    if (empty($raw)) {
        return $_POST ?? [];
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

/**
 * Encrypt sensitive credentials (e.g. Xtream passwords)
 */
function encrypt_secret(?string $plain): ?string {
    if ($plain === null || $plain === '') return null;
    $iv = openssl_random_pseudo_bytes(16);
    $encrypted = openssl_encrypt($plain, 'AES-256-CBC', ENCRYPTION_KEY, 0, $iv);
    return base64_encode($iv . $encrypted);
}

/**
 * Decrypt sensitive credentials
 */
function decrypt_secret(?string $cipher): ?string {
    if ($cipher === null || $cipher === '') return null;
    $raw = base64_decode($cipher);
    if (strlen($raw) < 17) return $cipher; // fallback if plain
    $iv = substr($raw, 0, 16);
    $data = substr($raw, 16);
    $decrypted = openssl_decrypt($data, 'AES-256-CBC', ENCRYPTION_KEY, 0, $iv);
    return ($decrypted !== false) ? $decrypted : $cipher;
}

/**
 * Normalize device ID / MAC address
 */
function normalize_device_id(string $id): string {
    $cleaned = strtoupper(trim($id));
    return $cleaned;
}

/**
 * Verify admin authorization token
 */
function verify_admin(): bool {
    $headers = getallheaders();
    $auth = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    $token = $headers['x-admin-key'] ?? $headers['x-admin-token'] ?? ($_GET['admin_token'] ?? null);

    if (empty($token) && !empty($auth) && str_starts_with($auth, 'Bearer ')) {
        $token = trim(substr($auth, 7));
    }

    if ($token === ADMIN_SECRET) {
        return true;
    }

    // Check session in db if any
    if (!empty($token)) {
        try {
            $db = get_db();
            $stmt = $db->prepare("SELECT id FROM admins WHERE password_hash = ?");
            $stmt->execute([$token]);
            if ($stmt->fetch()) return true;
        } catch (Exception $e) {}
    }

    return false;
}
