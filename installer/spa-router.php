<?php
/**
 * Router for `php -S` serving the built frontend (frontend/dist).
 *
 * Two jobs:
 *  1. Anything under /api/*, plus /login, /logout, and /sanctum/* (Sanctum's
 *     own auth routes), is proxied straight through to the backend (php
 *     artisan serve on :8010) and the response streamed back as-is.
 *     This keeps the browser talking to ONE origin (this server's port),
 *     so the frontend's existing relative `baseURL: '/api'` just works —
 *     no CORS setup, no cross-origin cookie issues for Sanctum auth,
 *     and no frontend code changes needed for production vs dev.
 *  2. Anything else that isn't a real file in dist/ (a client-side route
 *     like /patients/12) falls back to index.html, same as any SPA needs.
 */

const BACKEND_ORIGIN = 'http://127.0.0.1:8010';

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// /login, /logout, and /sanctum/* are Sanctum's own routes (not under
// /api/) — the SPA's login form posts to these directly, so they need the
// same backend proxying or "login" silently falls through to the SPA
// catch-all below and returns index.html with a 200 instead of actually
// authenticating.
$isBackendRoute = str_starts_with($uri, '/api/') || in_array($uri, ['/login', '/logout'], true) || str_starts_with($uri, '/sanctum/');

if ($isBackendRoute) {
    $ch = curl_init(BACKEND_ORIGIN . $_SERVER['REQUEST_URI']);

    $headers = [];
    foreach (getallheaders() as $name => $value) {
        if (strtolower($name) === 'host') continue;
        $headers[] = "$name: $value";
    }

    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $_SERVER['REQUEST_METHOD'],
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => true,
        CURLOPT_FOLLOWLOCATION => false,
    ]);

    if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents('php://input'));
    }

    $response = curl_exec($ch);
    if ($response === false) {
        http_response_code(502);
        echo 'Backend unreachable — is the backend server running on :8010?';
        exit;
    }

    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    http_response_code($statusCode);
    foreach (explode("\r\n", substr($response, 0, $headerSize)) as $line) {
        if (stripos($line, 'HTTP/') === 0 || trim($line) === '' || stripos($line, 'Transfer-Encoding:') === 0) continue;
        header($line, false);
    }
    echo substr($response, $headerSize);
    exit;
}

$file = __DIR__ . '/../frontend/dist' . $uri;
if ($uri !== '/' && file_exists($file) && !is_dir($file)) {
    return false; // let the built-in server serve the real file
}

readfile(__DIR__ . '/../frontend/dist/index.html');
