<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use Illuminate\Http\Request;

class ActivityLogController extends Controller
{
    public function index(Request $request)
    {
        abort_unless($request->user()->hasRole('owner'), 403);

        return ActivityLog::orderByDesc('created_at')
            ->limit(200)
            ->get()
            ->map(fn (ActivityLog $log) => [
                'id' => $log->id,
                'user_name' => $log->user_name,
                'action' => $log->action,
                'description' => $log->description,
                'created_at' => display_datetime($log->created_at),
            ]);
    }
}
