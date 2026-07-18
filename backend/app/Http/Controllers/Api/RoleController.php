<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Spatie\Permission\Models\Role;

class RoleController extends Controller
{
    public function index()
    {
        return Role::orderBy('name')->pluck('name');
    }
}
