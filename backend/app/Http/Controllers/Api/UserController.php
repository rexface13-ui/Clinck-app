<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\User\StoreUserRequest;
use App\Http\Requests\User\UpdateUserRequest;
use App\Http\Resources\UserResource;
use App\Models\Note;
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
                'username' => $data['username'],
                // email stays NOT NULL/unique at the DB level (Sanctum's
                // stateful-domain and password-reset flow both key off it)
                // — a login-only account without a real address gets a
                // harmless placeholder instead of asking for one it doesn't
                // need to actually log in with a username.
                'email' => $data['email'] ?? $data['username'].'@local.dentaflow',
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
                'username' => $data['username'] ?? $user->username,
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

        // notes.user_id cascade-deletes at the DB level — deleting a staff
        // account would silently wipe every patient note they ever wrote.
        abort_if(
            Note::where('user_id', $user->id)->exists(),
            422,
            'هذا المستخدم كتب ملاحظات على ملفات مرضى — لا يمكن حذفه نهائياً حفاظاً على السجل. عطّله من "تعديل" بدلاً من ذلك.',
        );

        $user->delete();

        return response()->noContent();
    }
}
