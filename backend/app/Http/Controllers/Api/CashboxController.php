<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Cashbox;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class CashboxController extends Controller
{
    public function index(Request $request)
    {
        abort_unless($request->user()->can('cash.view'), 403);

        return Cashbox::with('branch:id,name')->orderBy('currency')->get();
    }

    public function store(Request $request)
    {
        abort_unless($request->user()->can('cash.manage'), 403);

        $data = $request->validate([
            'branch_id' => ['required', Rule::exists('branches', 'id')],
            'currency' => ['required', 'string', 'size:3'],
            'name' => ['required', 'string', 'max:255'],
        ]);

        $cashbox = Cashbox::create($data + ['balance' => 0]);

        return $cashbox->load('branch:id,name');
    }
}
