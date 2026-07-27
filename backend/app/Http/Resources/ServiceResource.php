<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ServiceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'service_category_id' => $this->service_category_id,
            'name' => $this->name,
            'default_price' => $this->default_price,
            'default_currency' => $this->default_currency,
            'default_sessions' => $this->default_sessions,
            'default_interval_days' => $this->default_interval_days,
            'default_commission_percent' => $this->default_commission_percent,
            'is_active' => $this->is_active,
            'marks_teeth_missing' => $this->marks_teeth_missing,
            'allows_missing_teeth' => $this->allows_missing_teeth,
            'price_per_tooth' => $this->price_per_tooth,
            'color' => $this->color,
            'spans_teeth' => $this->spans_teeth,
            'branch_prices' => $this->whenLoaded('branchPrices', fn () => $this->branchPrices->map(fn ($p) => [
                'id' => $p->id,
                'branch_id' => $p->branch_id,
                'price' => $p->price,
                'surcharge' => $p->surcharge,
            ])),
            'steps' => $this->whenLoaded('steps', fn () => $this->steps->map(fn ($s) => [
                'id' => $s->id,
                'title' => $s->title,
                'price' => $s->price,
                'sort_order' => $s->sort_order,
                'fields' => $s->relationLoaded('fields') ? $s->fields->map(fn ($f) => [
                    'id' => $f->id,
                    'label' => $f->label,
                    'sort_order' => $f->sort_order,
                ]) : [],
            ])),
        ];
    }
}
