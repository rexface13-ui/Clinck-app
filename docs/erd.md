# DentaFlow — ERD مرجعي كامل (كل المراحل)

هذا الملف مرجع تصميمي فقط. الجداول المُنفَّذة فعلياً بـ migrations هي جداول **المرحلة 1** حصراً (مؤشَّر عليها أدناه بـ ✅). باقي الجداول موثّقة هنا لمنع أي تعارض تسمية/بنية لاحقاً، ولا تُنفَّذ إلا عند الوصول لمرحلتها.

قواعد عامة تنطبق على كل جدول أساسي ما لم يُذكر خلاف ذلك:
- `id bigserial PK`
- `clinic_id bigint FK -> clinics.id NOT NULL` (عبر `BelongsToClinic` trait — Global Scope تلقائي)
- `created_at timestamptz`, `updated_at timestamptz` (UTC، تُعرض عبر formatter مركزي بـ `Asia/Hebron`)
- الحقول النقدية دائماً ثلاثية: `amount numeric(14,2)` + `currency char(3)` + `exchange_rate numeric(14,6)` + `amount_ils numeric(14,2)` (عمود مشتق/محسوب عند الحفظ)
- كل حركة CRUD مهمة تُسجَّل عبر `spatie/laravel-activitylog`

---

## 1. Core & Tenancy

### `clinics` ✅
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| name | varchar | |
| slug | varchar unique | |
| is_active | boolean default true | |
| created_at / updated_at | timestamptz | |

لا `clinic_id` هنا (هو نفسه المستأجِر الجذري).

### `branches` ✅
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| name | varchar | |
| is_main | boolean default false | فرع رئيسي واحد لكل عيادة |
| address | text nullable | |
| phone | varchar nullable | |
| is_active | boolean default true | |

### `user_branch` ✅
جدول ربط many-to-many.
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| user_id | FK users | |
| branch_id | FK branches | |

### `users` ✅ (+ Sanctum personal_access_tokens)
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| name | varchar | |
| email | varchar unique | |
| password | varchar (hashed) | |
| is_active | boolean default true | |
| email_verified_at | timestamptz nullable | |
| remember_token | varchar nullable | |
| created_at / updated_at | timestamptz | |

الأدوار/الصلاحيات عبر `spatie/laravel-permission` (جداول `roles`, `permissions`, `model_has_roles`, `model_has_permissions`, `role_has_permissions` — منشأة تلقائياً من الحزمة). ✅

### `settings` ✅
key-value لكل عيادة.
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| key | varchar | e.g. `commission_basis`, `base_currency`, `tooth_numbering`, `inventory_enabled`, `insurance_enabled` |
| value | jsonb | |

unique(`clinic_id`, `key`)

---

## 2. SaaS (plans/features/subscriptions)

### `plans` (مبني هيكلياً في المرحلة 1، مُفعَّل بالكامل بالمرحلة 5)
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| name | varchar | |
| price_ils | numeric(14,2) | |
| max_users | int nullable | null = بلا حد |
| max_branches | int nullable | |
| max_patients | int nullable | |
| storage_mb | int nullable | |
| is_active | boolean default true | |

### `plan_features` (بنفس حالة `plans`)
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| plan_id | FK plans | |
| key | varchar | يطابق مفاتيح `feature()`: bot, checks, purchasing, insurance, multi_branch... |
| enabled | boolean default false | |

unique(`plan_id`, `key`)

### `subscriptions` (مبني فقط — Phase 1، غير مُفعَّل منطقياً حتى Phase 5)
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| plan_id | FK plans | |
| status | enum(active, trialing, past_due, cancelled) | |
| starts_at | timestamptz | |
| ends_at | timestamptz nullable | |

### `telegram_links` (مبني فقط — Phase 1، مُستخدَم فعلياً من Phase 4)
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| user_id | FK users | |
| telegram_chat_id | bigint unique | |
| link_code | varchar nullable | كود الربط المؤقت |
| linked_at | timestamptz nullable | |

---

## 3. Patients

### `patients` ✅
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| branch_id | FK branches | |
| code | varchar unique per clinic | كود تلقائي |
| full_name | varchar | |
| birth_date | date nullable | |
| gender | enum(male, female) | |
| is_child | boolean default false | يحدد ترقيم الأسنان اللبنية |
| phone | varchar nullable | |
| guardian_name | varchar nullable | |
| guardian_phone | varchar nullable | |
| medical_alerts | jsonb nullable | حساسية، أمراض مزمنة... |
| created_at / updated_at | timestamptz | |

---

## 4. Dental Chart (states/findings)

### `tooth_states` ✅
الحالة الحالية المشتقة لكل سن (آخر لقطة — وليست سجل تاريخي بحد ذاتها؛ التاريخ من `tooth_findings`).
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| patient_id | FK patients | |
| tooth_number | smallint | FDI: 11–48 دائم، 51–85 لبني |
| status | enum(present, missing) | |
| updated_at | timestamptz | |

unique(`patient_id`, `tooth_number`)

### `tooth_findings` ✅
كل تشخيص/إجراء على سن (السجل الفعلي — الرسمة مُشتقة من هنا).
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| patient_id | FK patients | |
| tooth_number | smallint | |
| surfaces | varchar nullable | تركيبة من M,D,O/I,B,L |
| finding_type | varchar | تشخيص أو إجراء (e.g. caries, filling, extraction, crown...) |
| status | enum(planned, in_progress, done) | يحدد اللون بالرسمة: أحمر/-/أزرق |
| service_id | FK services nullable | ربط اختياري بخدمة (لتوليد فاتورة لاحقاً بالمرحلة 2) |
| doctor_id | FK doctors nullable | |
| note | text nullable | |
| recorded_at | timestamptz | لعرض حالة السن بتاريخ سابق |
| created_at / updated_at | timestamptz | |

---

## 5. Doctors & Contracts

### `doctors` ✅
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| user_id | FK users nullable | إن كان له حساب دخول |
| full_name | varchar | |
| contract_type | enum(salary, salary_commission, commission, independent) | |
| commission_direction | enum(clinic_pays, clinic_receives) nullable | independent = clinic_receives دائماً |
| default_commission_percent | numeric(5,2) nullable | |
| monthly_salary | numeric(14,2) nullable | |
| is_active | boolean default true | |

### `doctor_service_commissions` ✅
override نسبة العمولة لكل خدمة لكل طبيب.
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| doctor_id | FK doctors | |
| service_id | FK services | |
| commission_percent | numeric(5,2) | |

unique(`doctor_id`, `service_id`)

### `doctor_availability` ✅
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| doctor_id | FK doctors | |
| branch_id | FK branches | |
| weekday | smallint | 0–6 |
| start_time | time | |
| end_time | time | |

---

## 6. Services & Pricing

### `service_categories` ✅
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| name | varchar | |
| sort_order | int default 0 | |

### `services` ✅
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| service_category_id | FK service_categories | |
| name | varchar | |
| default_price | numeric(14,2) | |
| default_currency | char(3) default 'ILS' | |
| default_sessions | int default 1 | |
| default_interval_days | int nullable | للجدولة التلقائية بالمرحلة 2 |
| default_commission_percent | numeric(5,2) nullable | |
| is_active | boolean default true | |

### `branch_service_prices` ✅
override سعر/سرشارج لكل فرع.
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| branch_id | FK branches | |
| service_id | FK services | |
| price | numeric(14,2) nullable | null = استخدم default_price |
| surcharge | numeric(14,2) default 0 | |

unique(`branch_id`, `service_id`)

---

## 7. Calendar & Appointments

### `appointments` ✅
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| branch_id | FK branches | |
| patient_id | FK patients | |
| doctor_id | FK doctors | |
| plan_item_session_id | FK plan_item_sessions nullable | من Phase 2 (توليد تلقائي من خطة علاج) |
| starts_at | timestamptz | |
| ends_at | timestamptz | |
| status | enum(scheduled, confirmed, done, cancelled, no_show) | |
| created_via | enum(web, bot) default 'web' | |

ملاحظات الموعد عبر جدول `notes` polymorphic (مجموعة 13) — لا عمود نصي مباشر لتفادي ازدواجية مع `HasNotesAndAttachments`.

---

## 8. Treatment Plans (Phase 2)

### `treatment_plans`
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| patient_id | FK patients | |
| doctor_id | FK doctors | |
| status | enum(draft, approved, cancelled) | اعتماد الخطة يولّد الفاتورة |
| approved_at | timestamptz nullable | |
| notes | text nullable | |

### `plan_items`
بند ضمن خطة: خدمة + سن + سطوح + سعر + عدد جلسات.
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| treatment_plan_id | FK treatment_plans | |
| service_id | FK services | |
| tooth_number | smallint nullable | |
| surfaces | varchar nullable | |
| unit_price | numeric(14,2) | |
| currency | char(3) | |
| sessions_count | int default 1 | |

### `plan_item_sessions`
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| plan_item_id | FK plan_items | |
| session_number | int | |
| status | enum(pending, scheduled, done, cancelled) | |
| appointment_id | FK appointments nullable | |

---

## 9. Patient Financials (Phase 2)

### `invoices`
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| patient_id | FK patients | |
| treatment_plan_id | FK treatment_plans nullable | |
| invoice_number | varchar unique per clinic | |
| status | enum(unpaid, partial, paid, void) | |
| total_amount_ils | numeric(14,2) | |
| issued_at | timestamptz | |

### `invoice_lines`
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| invoice_id | FK invoices | |
| plan_item_id | FK plan_items nullable | |
| description | varchar | |
| amount | numeric(14,2) | |
| currency | char(3) | |
| exchange_rate | numeric(14,6) | |
| amount_ils | numeric(14,2) | |

### `patient_transactions`
كشف حساب المريض الموحّد (ledger).
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| patient_id | FK patients | |
| type | enum(charge, payment, refund, adjustment) | |
| reference_type | varchar | polymorphic: invoice, payment, check... |
| reference_id | bigint | |
| amount | numeric(14,2) | |
| currency | char(3) | |
| exchange_rate | numeric(14,6) | |
| amount_ils | numeric(14,2) | موحَّد للكشف، مع حفظ الأصل للفلترة |
| occurred_at | timestamptz | |

### `payments`
دفعة فعلية (متعددة العملات) — تحرّك `cashbox_transactions` و `patient_transactions` بمعاملة DB واحدة.
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| patient_id | FK patients | |
| invoice_id | FK invoices nullable | |
| cashbox_id | FK cashboxes | صندوق بعملة الدفعة |
| amount | numeric(14,2) | |
| currency | char(3) | |
| exchange_rate | numeric(14,6) | |
| amount_ils | numeric(14,2) | |
| method | enum(cash, card, transfer, check) | |
| paid_at | timestamptz | |

### `doctor_transactions`
عمولات الأطباء (تُسجَّل عند status=done حسب `commission_basis`).
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| doctor_id | FK doctors | |
| tooth_finding_id | FK tooth_findings nullable | مصدر الاحتساب |
| type | enum(commission, salary, settlement) | |
| amount_ils | numeric(14,2) | |
| period_month | date | لكشف التسوية الشهري (أول يوم بالشهر) |
| settled_at | timestamptz nullable | |

---

## 10. Cash (Phase 2)

### `cashboxes`
صندوق مستقل لكل عملة/فرع.
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| branch_id | FK branches | |
| currency | char(3) | |
| name | varchar | |
| balance | numeric(14,2) default 0 | مُحدَّث من آخر `cashbox_transactions.balance_after` |

unique(`branch_id`, `currency`)

### `cashbox_transactions`
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| cashbox_id | FK cashboxes | |
| type | enum(payment_in, expense_out, income_in, check_in, check_out, adjustment) | |
| reference_type | varchar | polymorphic |
| reference_id | bigint | |
| amount | numeric(14,2) | +/- حسب الاتجاه |
| balance_after | numeric(14,2) | |
| occurred_at | timestamptz | |

### `expense_categories`
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| name | varchar | |

### `expenses`
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| expense_category_id | FK expense_categories | |
| cashbox_id | FK cashboxes | |
| amount | numeric(14,2) | |
| currency | char(3) | |
| amount_ils | numeric(14,2) | |
| description | varchar nullable | |
| spent_at | timestamptz | |

### `income_categories`
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| name | varchar | |

### `incomes`
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| income_category_id | FK income_categories | |
| cashbox_id | FK cashboxes | |
| amount | numeric(14,2) | |
| currency | char(3) | |
| amount_ils | numeric(14,2) | |
| description | varchar nullable | |
| received_at | timestamptz | |

---

## 11. Suppliers & Purchasing (Phase 3)

### `suppliers`
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| name | varchar | |
| phone | varchar nullable | |
| is_active | boolean default true | |

### `supplier_transactions`
كشف حساب المورد.
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| supplier_id | FK suppliers | |
| type | enum(purchase, payment, check_endorsed, check_bounced, adjustment) | |
| reference_type | varchar | polymorphic |
| reference_id | bigint | |
| amount_ils | numeric(14,2) | |
| occurred_at | timestamptz | |

### `item_categories`
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| name | varchar | |

### `items`
كتالوج الأصناف.
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| item_category_id | FK item_categories | |
| name | varchar | |
| type | enum(direct_expense, simple_stock, tracked) | tracked = دفعات + صلاحية (الزرعات) |
| unit | varchar default 'piece' | |
| is_active | boolean default true | |

### `purchase_invoices`
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| supplier_id | FK suppliers | |
| branch_id | FK branches | |
| invoice_number | varchar nullable | رقم فاتورة المورد |
| status | enum(draft, confirmed) | التأكيد يحرّك المخزون + ذاكرة السعر |
| total_amount_ils | numeric(14,2) | |
| issued_at | timestamptz | |

### `purchase_invoice_lines`
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| purchase_invoice_id | FK purchase_invoices | |
| item_id | FK items | |
| quantity | numeric(14,3) | |
| unit_price | numeric(14,2) | |
| currency | char(3) | |
| amount_ils | numeric(14,2) | |
| item_lot_id | FK item_lots nullable | لو tracked |

### `item_supplier_prices`
ذاكرة آخر سعر لكل صنف/مورد (لتعبئة الفاتورة تلقائياً).
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| item_id | FK items | |
| supplier_id | FK suppliers | |
| last_price | numeric(14,2) | |
| currency | char(3) | |
| updated_at | timestamptz | |

unique(`item_id`, `supplier_id`)

### `item_price_history`
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| item_id | FK items | |
| supplier_id | FK suppliers | |
| price | numeric(14,2) | |
| currency | char(3) | |
| purchase_invoice_id | FK purchase_invoices | |
| recorded_at | timestamptz | |

### `stock_movements`
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| branch_id | FK branches | |
| item_id | FK items | |
| item_lot_id | FK item_lots nullable | |
| type | enum(purchase_in, manual_out, adjustment) | لا استهلاك تلقائي بالمرحلة 3 |
| quantity | numeric(14,3) | +/- |
| reference_type | varchar nullable | |
| reference_id | bigint nullable | |
| occurred_at | timestamptz | |

### `item_lots`
دفعات لصنف tracked (زرعات).
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| item_id | FK items | |
| lot_number | varchar nullable | |
| expiry_date | date nullable | |
| quantity_remaining | numeric(14,3) | |

---

## 12. Checks (Phase 3)

### `checks`
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| direction | enum(incoming, outgoing) | وارد من زبون / صادر لمورد |
| party_type | varchar | polymorphic: patient أو supplier |
| party_id | bigint | |
| check_number | varchar | |
| bank_name | varchar nullable | |
| amount | numeric(14,2) | |
| currency | char(3) | |
| due_date | date | |
| status | enum(in_wallet, endorsed, bounced, cleared) | |
| image_requested_at | timestamptz nullable | لتذكير التلغرام |
| received_at | timestamptz | |

### `check_events`
سجل تاريخي لكل تغيّر حالة (استلام، تظهير، رجوع، تحصيل).
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| check_id | FK checks | |
| event_type | enum(received, endorsed, bounced, cleared) | |
| endorsed_to_supplier_id | FK suppliers nullable | عند event_type=endorsed |
| occurred_at | timestamptz | |
| notes | text nullable | |

---

## 13. Polymorphic (Phase 1)

### `notes` ✅
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| notable_type | varchar | polymorphic: patient, invoice, check, appointment... |
| notable_id | bigint | |
| user_id | FK users | كاتب الملاحظة |
| body | text | |
| created_at / updated_at | timestamptz | |

### `attachments` ✅
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| attachable_type | varchar | polymorphic |
| attachable_id | bigint | |
| disk | varchar default 'local' | |
| path | varchar | |
| original_name | varchar | |
| mime_type | varchar | |
| size_bytes | bigint | |
| uploaded_by | FK users nullable | |
| created_at | timestamptz | |

### `activity_log` ✅
منشأ تلقائياً من `spatie/laravel-activitylog` (log_name, description, subject_type/id, causer_type/id, properties jsonb, event, batch_uuid).

---

## 14. Insurance (Phase 3 — مبني ومُطفَّأ حتى تُفعَّل الميزة)

### `insurers`
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| name | varchar | |
| is_active | boolean default true | |

### `patient_insurer`
| عمود | نوع | ملاحظات |
|---|---|---|
| id | bigserial PK | |
| clinic_id | FK clinics | |
| patient_id | FK patients | |
| insurer_id | FK insurers | |
| policy_number | varchar nullable | |
| coverage_percent | numeric(5,2) nullable | |

---

## حالة التنفيذ الفعلية

هذا الملف مرجعي لكل الجداول عبر كل المراحل. الجداول المُشار عليها بـ ✅ أعلاه هي جداول **المرحلة 1 — الأساس**، وكلها منفَّذة الآن (migrations + models + seeder + API + واجهة).

**المرحلة 1 مكتملة بالكامل:**
- **الحزم**: Sanctum، spatie/laravel-permission، spatie/laravel-activitylog، laravel/pennant.
- **Multi-tenancy**: `BelongsToClinic` + `ClinicScope` + `CurrentClinic` — مُطبَّقة على كل جدول أساسي، مُختبَرة (عزل بين عيادتين).
- **بوابة الميزات**: `FeatureServiceProvider` عبر Pennant، محلياً كل المفاتيح ترجّع true.
- **formatter التاريخ**: باكند وفرونت، مع إصلاح جوهري لمشكلة timezone على مستوى اتصال PostgreSQL (كان الخادم يفسّر التوقيت المحلي كـ Asia/Gaza بدل UTC لأعمدة `timestamptz` — تم فرض `SET TIME ZONE 'UTC'` على الاتصال).
- **Seeder**: عيادة + فرع رئيسي + مالك + 4 أدوار (owner/doctor/secretary/accountant) بصلاحيات محدَّدة + إعدادات افتراضية.
- **Auth**: تسجيل دخول/خروج Sanctum SPA + `/api/bootstrap` (مستخدم، أدوار، صلاحيات، ميزات، إعدادات، فروع).
- **CRUD كامل عبر API + واجهة**: مستخدمين (+أدوار+فروع)، أطباء (+تعاقدات مشروطة+دوام+عمولات override)، مرضى (+كود تلقائي+ملاحظات+مرفقات)، خدمات (+تصنيفات+أسعار فروع)، مواعيد (+توليد فراغات من الدوام ناقص المحجوز+كشف تعارض).
- **رسمة الأسنان**: SVG بترقيم FDI كامل (دائم+لبني)، تفاعلية، مشتقّة من `tooth_states`+`tooth_findings`، لا تُخزَّن كصورة.

كل هذا مُختبَر يدوياً عبر المتصفح الفعلي: تسجيل دخول → مريض جديد → رسم تشخيص على السن → حجز موعد فعلي من الفراغات المتاحة.

**المرحلة 2 — العلاج والمال مكتملة بالكامل:** جداول Patient Financials وCash (مجموعتا 9 و10 أعلاه) منفَّذة كاملة (`treatment_plans`, `plan_items`, `plan_item_sessions`, `invoices`, `invoice_lines`, `patient_transactions`, `payments`, `cashboxes`, `cashbox_transactions`, `expense_categories`, `expenses`, `income_categories`, `incomes`, `doctor_transactions`) + خدمات الأعمال (`TreatmentPlanService`, `PaymentService`, `CashboxService`, `CommissionService`) + API + واجهة. الدورة الكاملة (خطة → فاتورة → دفعة → كشف حساب → عمولة → تسوية) مُختبَرة عبر المتصفح.

**التالي**: المرحلة 3 — الموردون والشيكات والمشتريات.
