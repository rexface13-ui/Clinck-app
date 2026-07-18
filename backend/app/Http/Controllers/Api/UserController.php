<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\User\StoreUserRequest;
use App\Http\Requests\User\UpdateUserRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class UserController extends Controller
{
    public function index()
    {
        $this->authorize('viewAny', User::class);

        return UserResource::collection(
            User::with(['roles', 'branches'])->orderBy('name')->get()
        );
    }

    public function store(StoreUserRequest $request)
    {
        $this->authorize('create', User::class);
        $data = $request->validated();

        $user = DB::transaction(function () use ($data) {
            $user = User::create([
                'name' => $data['name'],
                'email' => $data['email'],
                'password' => $data['password'],
                'is_active' => $data['is_active'] ?? true,
            ]);

            $user->syncRoles($data['roles']);
            $user->branches()->sync($data['branch_ids']);

            return $user;
        });

        return new UserResource($user->load(['roles', 'branches']));
    }

    public function show(User $user)
    {
        $this->authorize('view', $user);

        return new UserResource($user->load(['roles', 'branches']));
    }

    public function update(UpdateUserRequest $request, User $user)
    {
        $this->authorize('update', $user);
        $data = $request->validated();

        DB::transaction(function () use ($data, $user) {
            $user->fill([
                'name' => $data['name'] ?? $user->name,
                'email' => $data['email'] ?? $user->email,
                'is_active' => $data['is_active'] ?? $user->is_active,
            ]);

            if (! empty($data['password'])) {
                $user->password = $data['password'];
            }

            $user->save();

            if (isset($data['roles'])) {
                $user->syncRoles($data['roles']);
            }

            if (isset($data['branch_ids'])) {
                $user->branches()->sync($data['branch_ids']);
            }
        });

        return new UserResource($user->fresh(['roles', 'branches']));
    }

    public function destroy(User $user)
    {
        $this->authorize('delete', $user);
        $user->delete();

        return response()->noContent();
    }
}
