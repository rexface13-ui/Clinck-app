<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;

class BranchController extends Controller
{
    public function index()
    {
        return Branch::query()->orderByDesc('is_main')->orderBy('name')->get(['id', 'name', 'is_main', 'is_active']);
    }
}
