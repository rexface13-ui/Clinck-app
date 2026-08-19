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

    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    // php://input reads empty for multipart/form-data — PHP's built-in
    // server (like every SAPI) parses that body into $_POST/$_FILES before
    // this script ever runs, and offers no way to get the raw bytes back
    // afterward. Forwarding the *original* Content-Length header alongside
    // that empty body used to tell the backend "N bytes are coming" while
    // curl actually sent none, so the backend sat there waiting for a body
    // that would never arrive — freezing every check upload (and anything
    // else with an attached file) for as long as the backend kept waiting,
    // and since php -S handles one request at a time, the whole app with it.
    // Rebuilding the multipart body from $_POST/$_FILES and handing curl an
    // array lets it generate a fresh, correctly-sized body instead.
    $isMultipart = str_starts_with($contentType, 'multipart/form-data');

    $headers = [];
    foreach (getallheaders() as $name => $value) {
        $lower = strtolower($name);
        if ($lower === 'host') continue;
        // These describe the body we're about to replace — keeping the old
        // ones (wrong boundary, wrong length) is exactly what caused the hang.
        if ($isMultipart && in_array($lower, ['content-type', 'content-length'], true)) continue;
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
        if ($isMultipart) {
            $fields = $_POST;
            foreach ($_FILES as $key => $file) {
                if (is_array($file['tmp_name'])) {
                    foreach ($file['tmp_name'] as $i => $tmpName) {
                        $fields["{$key}[{$i}]"] = new CURLFile($tmpName, $file['type'][$i], $file['name'][$i]);
                    }
                } else {
                    $fields[$key] = new CURLFile($file['tmp_name'], $file['type'], $file['name']);
                }
            }
            // Laravel reads PUT/PATCH from a spoofed POST (_method field) —
            // multipart bodies can't carry a real PUT/PATCH payload anyway.
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'POST');
            curl_setopt($ch, CURLOPT_POSTFIELDS, $fields);
        } else {
            curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents('php://input'));
        }
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
