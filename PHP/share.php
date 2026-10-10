<?php
/*
 * Share page: https://your-site/share.php?v=VIDEO_ID
 * Social apps (Facebook, WhatsApp, Telegram, X, LinkedIn...) read the tags below to build the preview card
 * (that video's thumbnail + title). People who click it are sent straight to the video.
 */
$id = (int)($_GET['v'] ?? 0);

$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') ? 'https' : 'http';
$dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
$base = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir . '/';

function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function absu(string $u, string $base): string {
    $u = trim($u);
    if ($u === '' || preg_match('#^(data|blob|idb|javascript):#i', $u)) return '';
    if (preg_match('#^https?://#i', $u)) return $u;
    if (strpos($u, '//') === 0) return 'https:' . $u;
    return $base . ltrim($u, '/');
}

$video = null;
$file = __DIR__ . '/data/site-data.json';
if ($id > 0 && is_file($file)) {
    $j = json_decode((string)file_get_contents($file), true);
    foreach (($j['videos'] ?? []) as $v) {
        if ((int)($v['id'] ?? 0) === $id && ($v['status'] ?? 'published') === 'published') { $video = $v; break; }
    }
}

$home = $base . 'index.html';
if (!$video) { header('Location: ' . $home, true, 302); exit; }

$title = (string)($video['title'] ?? 'Video');
$desc  = trim((string)($video['description'] ?? '')) ?: 'Watch this video on Video Playground.';
$desc  = mb_substr($desc, 0, 200);
$shareUrl = $base . 'share.php?v=' . $id;
$target   = $base . 'index.html?v=' . $id;

$thumb = absu((string)($video['thumbnail'] ?? ''), $base);
$thumbIsGenerated = ($thumb === '');
if ($thumbIsGenerated) $thumb = $base . 'og-image.php?v=' . $id;     // generated picture (title + play icon)

$vurl = absu((string)($video['videoUrl'] ?? ''), $base);
$vtype = 'video/mp4';
if ($vurl !== '') {
    $ext = strtolower(pathinfo(parse_url($vurl, PHP_URL_PATH) ?: '', PATHINFO_EXTENSION));
    $vtype = ['webm' => 'video/webm', 'ogg' => 'video/ogg', 'ogv' => 'video/ogg', 'mov' => 'video/quicktime'][$ext] ?? 'video/mp4';
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: public, max-age=300');
?><!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= h($title) ?> | Video Playground</title>
<meta name="description" content="<?= h($desc) ?>">
<link rel="canonical" href="<?= h($shareUrl) ?>">

<meta property="og:site_name" content="Video Playground">
<meta property="og:type" content="video.other">
<meta property="og:url" content="<?= h($shareUrl) ?>">
<meta property="og:title" content="<?= h($title) ?>">
<meta property="og:description" content="<?= h($desc) ?>">
<meta property="og:image" content="<?= h($thumb) ?>">
<?php if ($thumbIsGenerated): ?>
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<?php endif; ?>
<?php if ($vurl !== ''): ?>
<meta property="og:video" content="<?= h($vurl) ?>">
<?php if (strpos($vurl, 'https://') === 0): ?><meta property="og:video:secure_url" content="<?= h($vurl) ?>"><?php endif; ?>

<meta property="og:video:type" content="<?= h($vtype) ?>">
<meta property="og:video:width" content="1280">
<meta property="og:video:height" content="720">
<?php endif; ?>

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="<?= h($title) ?>">
<meta name="twitter:description" content="<?= h($desc) ?>">
<meta name="twitter:image" content="<?= h($thumb) ?>">

<meta http-equiv="refresh" content="1;url=<?= h($target) ?>">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0B0F19;color:#e5e7eb;font-family:system-ui,sans-serif}
.c{max-width:420px;padding:16px;text-align:center}.c img{width:100%;border-radius:14px;border:1px solid #2A344B}a{color:#6366F1}</style>
</head><body>
<div class="c">
  <img src="<?= h($thumb) ?>" alt="<?= h($title) ?>">
  <h1 style="font-size:18px"><?= h($title) ?></h1>
  <p>Opening the video&hellip; <a href="<?= h($target) ?>">Click here if nothing happens</a></p>
</div>
<script>location.replace(<?= json_encode($target, JSON_UNESCAPED_SLASHES) ?>);</script>
</body></html>
