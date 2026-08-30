<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Publishes the daily closing report to a dedicated, public reports repo via
 * the GitHub Contents API — no local `git add/commit/push` at all. Doing that
 * inside the app's own working directory (the old approach) meant every
 * publish touched whatever branch happened to be checked out on the live
 * server, and pushed straight into the same repo the clinic's actual code
 * lives in. A plain HTTP PUT per file has no such risk: it can't collide with
 * a deploy, and it targets a repo that holds nothing but report pages.
 */
class ReportPublishService
{
    protected function token(): string
    {
        return (string) env('GITHUB_REPORTS_TOKEN', '');
    }

    protected function repo(): string
    {
        return (string) env('GITHUB_REPORTS_REPO', '');
    }

    protected function enabled(): bool
    {
        return $this->token() !== '' && $this->repo() !== '';
    }

    protected function api(): \Illuminate\Http\Client\PendingRequest
    {
        return Http::withToken($this->token())
            ->withHeaders(['Accept' => 'application/vnd.github+json'])
            ->timeout(30);
    }

    /**
     * Publishes one day's report and refreshes the index, returning the
     * public GitHub Pages URL the report is now live at.
     *
     * @throws \RuntimeException on any failure, with an Arabic message safe
     *                            to show directly to the user.
     */
    public function publish(string $dateStr, string $html): string
    {
        if (! $this->enabled()) {
            throw new \RuntimeException('ريبو أو توكن نشر التقارير غير معبّى بـ.env (GITHUB_REPORTS_REPO / GITHUB_REPORTS_TOKEN).');
        }

        $repo = $this->repo();

        $this->putFile("{$dateStr}.html", $html, "نشر تقرير {$dateStr}");

        $files = $this->listReportDates();
        if (! in_array($dateStr, $files, true)) {
            $files[] = $dateStr;
        }
        rsort($files);

        $this->putFile('index.html', $this->buildIndexHtml($files), 'تحديث فهرس التقارير');

        $this->ensurePagesEnabled();

        [$owner, $name] = explode('/', $repo, 2);

        return "https://{$owner}.github.io/{$name}/{$dateStr}.html";
    }

    /**
     * Publishes the full all-time sessions log to a fixed path (sessions.html)
     * — overwritten every time it's published, no history of its own (the
     * daily reports are what accumulate; this is always "as of now").
     *
     * @throws \RuntimeException on any failure
     */
    public function publishSessionsLog(string $html): string
    {
        if (! $this->enabled()) {
            throw new \RuntimeException('ريبو أو توكن نشر التقارير غير معبّى بـ.env (GITHUB_REPORTS_REPO / GITHUB_REPORTS_TOKEN).');
        }

        $this->putFile('sessions.html', $html, 'تحديث سجل الجلسات الكامل');
        $this->ensurePagesEnabled();

        [$owner, $name] = explode('/', $this->repo(), 2);

        return "https://{$owner}.github.io/{$name}/sessions.html";
    }

    /**
     * @return string[] date strings (without .html), unsorted
     */
    protected function listReportDates(): array
    {
        $response = $this->api()->get("https://api.github.com/repos/{$this->repo()}/contents/");
        if (! $response->successful()) {
            // A brand new repo has no contents yet — that's fine, not an error.
            return [];
        }

        return collect($response->json())
            ->filter(fn ($item) => str_ends_with($item['name'] ?? '', '.html') && $item['name'] !== 'index.html')
            ->map(fn ($item) => substr($item['name'], 0, -5))
            ->values()
            ->all();
    }

    protected function putFile(string $path, string $content, string $commitMessage): void
    {
        $repo = $this->repo();
        $url = "https://api.github.com/repos/{$repo}/contents/{$path}";

        // GitHub needs the current file's sha to update it in place — creating
        // it fresh (no sha) when it already exists fails, so always check first.
        $existing = $this->api()->get($url);
        $sha = $existing->successful() ? $existing->json('sha') : null;

        $payload = [
            'message' => $commitMessage,
            'content' => base64_encode($content),
        ];
        if ($sha) {
            $payload['sha'] = $sha;
        }

        $response = $this->api()->put($url, $payload);

        if (! $response->successful()) {
            Log::warning('ReportPublishService: PUT failed', ['path' => $path, 'status' => $response->status(), 'body' => $response->body()]);
            throw new \RuntimeException("فشل رفع {$path} — تحقق من التوكن والصلاحيات (كود {$response->status()}).");
        }
    }

    protected function buildIndexHtml(array $dates): string
    {
        $items = collect($dates)
            ->map(fn ($d) => "<li><a href=\"{$d}.html\">{$d}</a></li>")
            ->implode('');

        return <<<HTML
<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><title>تقارير الإغلاق اليومية</title>
<style>body{font-family:sans-serif;padding:24px;max-width:500px;margin:0 auto} li{margin:6px 0} a{color:#2563eb;text-decoration:none} .sessions{display:block;margin-bottom:16px;font-weight:600}</style>
</head>
<body>
<h1>تقارير الإغلاق اليومية</h1>
<a class="sessions" href="sessions.html">📋 سجل الجلسات الكامل — كل الزيارات من أول يوم</a>
<ul>{$items}</ul>
</body>
</html>
HTML;
    }

    /**
     * Idempotent — safe to call on every publish. GitHub returns 409/422 once
     * Pages is already configured for this repo, which we simply ignore.
     */
    protected function ensurePagesEnabled(): void
    {
        $response = $this->api()->post("https://api.github.com/repos/{$this->repo()}/pages", [
            'source' => ['branch' => 'main', 'path' => '/'],
        ]);

        if (! $response->successful() && ! in_array($response->status(), [409, 422], true)) {
            Log::warning('ReportPublishService: enabling Pages failed', ['status' => $response->status(), 'body' => $response->body()]);
        }
    }
}
