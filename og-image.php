<?php
/* Generated share picture (1200x630) for videos that have no real thumbnail: title + play icon. */
$id = (int)($_GET['v'] ?? 0);
$title = 'Video Playground';
$file = __DIR__ . '/data/site-data.json';
if ($id > 0 && is_file($file)) {
    $j = json_decode((string)file_get_contents($file), true);
    foreach (($j['videos'] ?? []) as $v) { if ((int)($v['id'] ?? 0) === $id) { $title = (string)($v['title'] ?? $title); break; } }
}
if (!function_exists('imagecreatetruecolor')) { header('Location: index.html'); exit; }

$W = 1200; $H = 630;
$hue = 0; foreach (preg_split('//u', $title, -1, PREG_SPLIT_NO_EMPTY) as $ch) { $hue = ($hue * 31 + (function_exists('mb_ord') ? mb_ord($ch) : ord($ch))) % 360; }
function hsl2rgb(float $h, float $s, float $l): array {
    $c = (1 - abs(2 * $l - 1)) * $s; $x = $c * (1 - abs(fmod($h / 60, 2) - 1)); $m = $l - $c / 2;
    [$r, $g, $b] = $h < 60 ? [$c, $x, 0] : ($h < 120 ? [$x, $c, 0] : ($h < 180 ? [0, $c, $x] : ($h < 240 ? [0, $x, $c] : ($h < 300 ? [$x, 0, $c] : [$c, 0, $x]))));
    return [(int)(($r + $m) * 255), (int)(($g + $m) * 255), (int)(($b + $m) * 255)];
}
$im = imagecreatetruecolor($W, $H);
[$r1, $g1, $b1] = hsl2rgb($hue, .5, .10);
[$r2, $g2, $b2] = hsl2rgb(($hue + 40) % 360, .6, .24);
for ($y = 0; $y < $H; $y++) {                       // vertical gradient
    $t = $y / $H;
    $col = imagecolorallocate($im, (int)($r1 + ($r2 - $r1) * $t), (int)($g1 + ($g2 - $g1) * $t), (int)($b1 + ($b2 - $b1) * $t));
    imageline($im, 0, $y, $W, $y, $col);
}
$ring = imagecolorallocatealpha($im, 255, 255, 255, 105);
imagefilledellipse($im, $W / 2, 250, 330, 330, $ring);
$btn = imagecolorallocate($im, 99, 102, 241);
imagefilledellipse($im, $W / 2, 250, 190, 190, $btn);
$white = imagecolorallocate($im, 255, 255, 255);
imagefilledpolygon($im, [$W / 2 - 25, 205, $W / 2 - 25, 295, $W / 2 + 55, 250], 3, $white);

// title: TTF when the host has a font, otherwise the built-in bitmap font scaled up
$lines = explode("\n", wordwrap(mb_substr($title, 0, 90), 26, "\n", true));
$lines = array_slice($lines, 0, 3);
$ttf = null;
foreach (['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf', '/Library/Fonts/Arial Bold.ttf', 'C:\\Windows\\Fonts\\arialbd.ttf'] as $f) { if (is_file($f)) { $ttf = $f; break; } }
$y0 = 480;
if ($ttf && function_exists('imagettftext')) {
    foreach ($lines as $i => $ln) {
        $bb = imagettfbbox(44, 0, $ttf, $ln);
        imagettftext($im, 44, 0, (int)(($W - ($bb[2] - $bb[0])) / 2), $y0 + $i * 64, $white, $ttf, $ln);
    }
} else {
    $scale = 4; $cw = imagefontwidth(5); $ch = imagefontheight(5);
    foreach ($lines as $i => $ln) {
        $line = preg_replace('/[^\x20-\x7E]/', '?', $ln);
        $tw = max(1, strlen($line) * $cw);
        $tmp = imagecreatetruecolor($tw, $ch);
        imagefill($tmp, 0, 0, imagecolorallocate($tmp, 0, 0, 0));
        imagecolortransparent($tmp, imagecolorallocate($tmp, 0, 0, 0));
        imagestring($tmp, 5, 0, 0, $line, imagecolorallocate($tmp, 255, 255, 255));
        imagecopyresampled($im, $tmp, (int)(($W - $tw * $scale) / 2), $y0 - 30 + $i * ($ch * $scale + 10), 0, 0, $tw * $scale, $ch * $scale, $tw, $ch);
        imagedestroy($tmp);
    }
}
$small = imagecolorallocate($im, 160, 170, 200);
imagestring($im, 5, 40, $H - 40, 'VIDEO PLAYGROUND', $small);

header('Content-Type: image/png');
header('Cache-Control: public, max-age=3600');
imagepng($im);
