<?php
/*
 * Video Playground - tiny server storage (works on InfinityFree and any PHP host).
 *
 * Saves the Ad slots + video list into data/site-data.json so they are the same for EVERY visitor
 * and survive deploys, browser changes and cleared cache.
 *
 * >>> CHANGE THE PIN BELOW before uploading. It is the PIN you type in the Admin Portal. <<<
 * Saving is blocked while it is still the default, so nobody can edit your site by guessing it.
 */
const ADMIN_PIN = 'CHANGE_ME';

const DATA_DIR   = __DIR__ . '/data';
const DATA_FILE  = DATA_DIR . '/site-data.json';
const THUMB_DIR  = __DIR__ . '/thumbs';
const MAX_BODY   = 6 * 1024 * 1024;   // 6 MB
const MAX_THUMB  = 1500000;           // 1.5 MB per thumbnail

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');

function out(int $code, array $arr): void {
    http_response_code($code);
    echo json_encode($arr, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function read_data(): ?array {
    if (!is_file(DATA_FILE)) return null;
    $j = json_decode((string)file_get_contents(DATA_FILE), true);
    return is_array($j) ? $j : null;
}

function body_json(): array {
    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
    if ($raw === false || strlen($raw) > MAX_BODY) out(413, ['ok' => false, 'error' => 'Request too large']);
    $j = json_decode($raw, true);
    if (!is_array($j)) out(400, ['ok' => false, 'error' => 'Invalid JSON']);
    return $j;
}

function check_pin(array $body): void {
    if (in_array(ADMIN_PIN, ['', 'CHANGE_ME', '1234', '0000', '1111'], true) || strlen(ADMIN_PIN) < 4) {
        out(403, ['ok' => false, 'error' => 'Open api.php on your hosting and set ADMIN_PIN to your own secret PIN (at least 4 characters).']);
    }
    $pin = $_SERVER['HTTP_X_ADMIN_PIN'] ?? ($body['pin'] ?? '');
    if (!hash_equals(ADMIN_PIN, (string)$pin)) {
        usleep(700000);                        // slow down guessing
        out(401, ['ok' => false, 'error' => 'Wrong PIN']);
    }
}

$action = $_GET['action'] ?? 'get';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($action === 'get' && $method === 'GET') {
    $d = read_data();
    if (!$d) out(200, ['server' => true, 'empty' => true]);
    $d['server'] = true;
    out(200, $d);
}

if ($method !== 'POST') out(405, ['ok' => false, 'error' => 'Use POST']);

if ($action === 'login') {
    $b = body_json();
    check_pin($b);
    out(200, ['ok' => true, 'server' => true]);
}

if ($action === 'save') {
    $b = body_json();
    check_pin($b);
    $data = read_data() ?: [];
    if (isset($b['ads']))      { if (!is_array($b['ads']))    out(400, ['ok' => false, 'error' => 'ads must be a list']);    $data['ads'] = array_values($b['ads']); }
    if (isset($b['videos']))   { if (!is_array($b['videos'])) out(400, ['ok' => false, 'error' => 'videos must be a list']); $data['videos'] = array_values($b['videos']); }
    if (isset($b['globalAdsEnabled'])) $data['globalAdsEnabled'] = (bool)$b['globalAdsEnabled'];
    $data['updated'] = gmdate('c');

    if (!is_dir(DATA_DIR) && !@mkdir(DATA_DIR, 0755, true)) out(500, ['ok' => false, 'error' => 'Cannot create data/ folder. Create it by hand and make it writable.']);
    $tmp = DATA_FILE . '.tmp' . getmypid();
    if (file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX) === false) {
        out(500, ['ok' => false, 'error' => 'Cannot write data/site-data.json (folder not writable?)']);
    }
    if (!@rename($tmp, DATA_FILE)) {           // some hosts cannot rename over an existing file
        $ok = @copy($tmp, DATA_FILE); @unlink($tmp);
        if (!$ok) out(500, ['ok' => false, 'error' => 'Cannot replace data/site-data.json']);
    }
    out(200, ['ok' => true, 'updated' => $data['updated']]);
}

if ($action === 'thumb') {
    $b = body_json();
    check_pin($b);
    $id = preg_replace('/\D+/', '', (string)($b['id'] ?? ''));
    $img = (string)($b['image'] ?? '');
    if ($id === '' || !preg_match('#^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$#', $img, $m)) {
        out(400, ['ok' => false, 'error' => 'Bad image']);
    }
    $bin = base64_decode($m[2], true);
    if ($bin === false || strlen($bin) > MAX_THUMB) out(413, ['ok' => false, 'error' => 'Image too large']);
    $info = @getimagesizefromstring($bin);
    $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'][$info['mime'] ?? ''] ?? null;
    if (!$ext) out(400, ['ok' => false, 'error' => 'Not an image']);
    if (!is_dir(THUMB_DIR) && !@mkdir(THUMB_DIR, 0755, true)) out(500, ['ok' => false, 'error' => 'Cannot create thumbs/ folder']);
    foreach (['jpg', 'png', 'webp'] as $e) @unlink(THUMB_DIR . "/$id.$e");
    if (file_put_contents(THUMB_DIR . "/$id.$ext", $bin) === false) out(500, ['ok' => false, 'error' => 'Cannot write thumbs/']);
    out(200, ['ok' => true, 'url' => "thumbs/$id.$ext?v=" . time()]);
}

out(404, ['ok' => false, 'error' => 'Unknown action']);
