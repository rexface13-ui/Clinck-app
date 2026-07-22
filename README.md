# DentaFlow

نظام إدارة عيادة أسنان — محلي لعيادة واحدة الآن، ببنية SaaS-ready من أول migration لتتحوّل لاحقاً لمنصة اشتراكات متعددة العيادات بدون إعادة بناء.

## Stack

- **Backend**: Laravel 13 + PHP 8.3 + PostgreSQL 18
- **Auth**: Laravel Sanctum (SPA، cookie-based)
- **الصلاحيات**: spatie/laravel-permission · **التوثيق**: spatie/laravel-activitylog · **بوابة الميزات**: laravel/pennant
- **الطوابير**: Redis (لاحقاً) — Horizon **غير مدعوم على Windows** (يحتاج `ext-pcntl`/`ext-posix` غير الموجودتين على PHP-Windows إطلاقاً). يُشغَّل عبر WSL2/Linux عند الوصول للمرحلة 4، أو `queue:work` عادي محلياً بدونه.
- **Frontend**: React + Vite + TypeScript + TailwindCSS v4، RTL كامل
- **الأيقونات**: Font Awesome (`@fortawesome/*`) · **الخط**: IBM Plex Sans Arabic (مستضاف محلياً عبر `@fontsource`)

## لماذا Laravel 13 لا 11؟

المواصفات الأصلية حدّدت Laravel 11، لكن دعمه الأمني انتهى (EOL أمني مارس 2026). Laravel 13.20 هو الأحدث حالياً وكل الحزم المطلوبة (Sanctum, Spatie permission/activitylog, Pennant) متوافقة معه. Laravel 13 يتطلب PHP ^8.3 — لم يكن مثبتاً على الجهاز (فقط PHP 8.2 عبر XAMPP)، فتم تحميل PHP 8.3.32 الرسمي محلياً داخل `php83/` (تحقّق SHA-256 من الملف الموقّع بالكامل قبل التثبيت).

## بنية المجلد

```
DentaFlow/
├── backend/          Laravel 13 API
├── frontend/         React + Vite + TS
├── docs/erd.md        مخطط كل الجداول لكل المراحل (مرجعي)
├── php83/             PHP 8.3.32 محلي (composer + artisan يستخدمانه)
└── composer.phar       Composer محلي (لا يوجد composer عالمي على الجهاز)
```

## التشغيل محلياً

### الباكند (Laravel)

```bash
cd backend
../php83/php.exe ../composer.phar install     # أول مرة فقط
../php83/php.exe artisan serve --port=8010
```

### الفرونت (React)

```bash
cd frontend
npm install     # أول مرة فقط
npm run dev -- --port 5183
```

أو عبر Claude Code: preview باسم `dentaflow-backend` (8010) و`dentaflow-frontend` (5183) مُعرَّفين في `.claude/launch.json`.

### قاعدة البيانات

PostgreSQL 18 محلي، قاعدة البيانات `dentaflow` منشأة مسبقاً. بيانات الاتصال في `backend/.env` (`DB_*`).

## قواعد معمارية غير قابلة للتفاوض

راجع تفاصيلها الكاملة في التعليمات الأصلية للمشروع؛ ملخصاً:

1. **Multi-tenancy**: كل جدول أساسي فيه `clinic_id` + trait [`BelongsToClinic`](backend/app/Models/Concerns/BelongsToClinic.php) يطبّق Global Scope + auto-stamp تلقائياً. محلياً `clinic_id = 1` دائماً عبر [`CurrentClinic`](backend/app/Support/Tenancy/CurrentClinic.php).
2. **بوابة ميزات**: `feature('key')` (Pennant، معرَّفة في [`FeatureServiceProvider`](backend/app/Providers/FeatureServiceProvider.php)) — محلياً ترجّع دائماً `true`. أي ميزة قابلة للتقسيم (bot, checks, purchasing, insurance, multi_branch...) تمرّ من هنا فقط.
3. **العملات**: أساس ILS. كل مبلغ = `amount` + `currency` + `exchange_rate` + `amount_ils`.
4. **التواريخ**: تخزين `timestamptz` (UTC) دائماً. عرض `dd/mm/yyyy` حصراً عبر formatter مركزي — [`DateFormatter`](backend/app/Support/DateFormatter.php) بالباكند، [`formatDate.ts`](frontend/src/lib/formatDate.ts) بالفرونت. Timezone العرض: `Asia/Hebron`. أرقام لاتينية tabular دائماً (لا أرقام هندية-عربية حتى بواجهة عربية).
5. **التوثيق**: كل حركة عبر `activitylog`.
6. **Polymorphic**: `notes` و`attachments` يرتبطان بأي كيان.

## النسخ الاحتياطي والاستعادة

`artisan backup:create` ينشئ نسخة `pg_dump --format=custom` في `backend/storage/app/backups/`. `artisan backup:restore <file> --force` يستعيدها (`pg_restore --clean --if-exists`) — **يمسح كل البيانات الحالية**. نفس الوظيفتين متاحتان من الواجهة (`/backups`، صلاحية `settings.manage`).

**ملاحظة تقنية مهمة (Windows)**: أي `Process::run()` في Laravel يستبدل بيئة العملية الفرعية بالكامل بدل دمجها مع البيئة الموروثة — على Windows هذا يعني فقدان `SystemRoot`/`PATH`/`TEMP`، ما يُسقط أي برنامج native (`pg_dump.exe` هون) برسالة خطأ فارغة تقريباً. الحل: [`App\Support\ProcessEnv::withOverrides()`](backend/app/Support/ProcessEnv.php) — استخدمه دايماً بدل تمرير array فاضي أو مباشر لـ `->env()`.

## حالة المشروع

**المرحلة 1 — الأساس (مكتملة):**
- Laravel 13 + React + Vite + TS + Tailwind v4 + PostgreSQL 18 يعملان محلياً.
- `BelongsToClinic` + `CurrentClinic` + `feature()` + `DateFormatter` — البنية التحتية المعمارية، مُختبَرة.
- Seeder: عيادة + فرع رئيسي + مالك + 4 أدوار (owner/doctor/secretary/accountant) + إعدادات افتراضية.
- تسجيل دخول/خروج Sanctum SPA + `/api/bootstrap`.
- CRUD كامل (API + واجهة): مستخدمون، أطباء (تعاقدات مشروطة + دوام + عمولات)، مرضى (كود تلقائي + فئة عمرية طفل/بالغ قابلة للتعديل + ملاحظات + مرفقات + زيارة Walk-in تحجز موعداً فورياً)، خدمات (تصنيفات + أسعار فروع)، مواعيد (تقويم يومي بصري + توليد فراغات + كشف تعارض).
- رسمة أسنان تفاعلية بترقيم FDI كامل (دائم + لبني حسب الفئة العمرية)، أشكال أسنان تشريحية حقيقية (قواطع/أنياب/ضواحك/أضراس) مرتّبة على شكل قوسين علوي وسفلي، مشتقّة من `tooth_states`/`tooth_findings`.
- تاريخ `dd/mm/yyyy` صارم في كل مكان عبر [`DatePicker`](frontend/src/components/DatePicker.tsx) مخصّص — لا `<input type="date">` أبداً (يعرض تنسيق المتصفح المحلي، مش dd/mm/yyyy دايماً).
- نسخ احتياطي/استعادة كاملة من الواجهة.
- [`docs/erd.md`](docs/erd.md) — مخطط مرجعي لكل الجداول عبر المراحل الخمس، مع تأشير ما نُفِّذ فعلياً.

مُختبَر يدوياً بالمتصفح: تسجيل دخول → إنشاء مريض (Walk-in) → رسم تشخيص على السن → حجز موعد من الفراغات المتاحة فعلياً → نسخة احتياطية واستعادتها.

**المرحلة 2 — العلاج والمال (مكتملة):**
- خطط علاج: بنود (خدمة + سن + سطوح + سعر + جلسات) → اعتماد الخطة بس يجدول الجلسات (بدون أي دين فوري) ([`TreatmentPlanService`](backend/app/Services/TreatmentPlanService.php)) → زر "جدولة الجلسات" يحجز أول فراغ فعلي لكل جلسة حسب `default_interval_days` → كل جلسة تُحاسب لحالها لما تصير فعلياً عبر `completeSession()` (سعر قابل للتعديل + خصم اختياري + دفع فوري أو دين)، وتُلغى/تُعدَّل لحالها عبر `cancelSession()`/`updateSession()` مع ارتداد مالي دقيق (`invoice_lines.plan_item_session_id` يربط كل سطر فاتورة بجلسته بالتحديد).
- كشف حساب المريض الموحّد بـ ILS (`patient_transactions`) برصيد متراكم، مع تحصيل دفعات متعددة العملات ([`PaymentService`](backend/app/Services/PaymentService.php)) — كل دفعة تحرّك الصندوق وتُحدّث حالة الفاتورة (unpaid/partial/paid) تلقائياً.
- صناديق مستقلة لكل عملة/فرع، كل حركة (دفعة/مصروف/وارد) مسجَّلة بـ `cashbox_transactions` مع `balance_after` دقيق ([`CashboxService`](backend/app/Services/CashboxService.php)).
- مصاريف ووارد بتصنيفات، عمولات أطباء تُحسب تلقائياً عند إنجاز إجراء (`status=done`) حسب نوع التعاقد ونسبة الخدمة ([`CommissionService`](backend/app/Services/CommissionService.php))، مع كشف تسوية شهري لكل طبيب وزر تسوية.

مُختبَر يدوياً بالمتصفح أيضاً: خطة علاج → اعتماد (بدون دين) → حساب جلسة → تحصيل دفعة جزئية → كشف حساب محدَّث → تشخيص منجز → عمولة طبيب محسوبة تلقائياً → تسوية شهرية.

### تحديث 21-22/07/2026
- OPcache كان معطّلاً بالكامل بـ`php.ini` — كان السبب الرئيسي لبطء النظام (تحسّن ~11 ضعف بعد التفعيل). `enable-opcache.bat` يفعّله تلقائياً بكل جهاز (يشتغل من `check-requirements.bat`/`start.bat`، لأن `php83/` مو مرفوع Git).
- إعادة تصميم فوترة خطط العلاج بالكامل — كان الاعتماد يسجّل دين الخطة الكامل فوراً، صار الدين يتسجّل فقط لما جلسة تصير فعلياً (راجع الفقرة فوق).
- إصلاح بطاقة "أرصدة المرضى المستحقة" بالداشبورد (كانت تصفّي دين مريض برصيد دائن لمريض تاني بدل ما تجمع الديون الحقيقية فقط).
- صفحة المريض صارت تبويبات + تبويب "سجل الزيارات" جديد (تعديل سعر/ملاحظة، تحصيل دفعة، حذف زيارة من مكان واحد) + رسمة الأسنان صار فيها تعديل/حذف للـfindings وربطها بجلسات فعلية وتمييز "طرف خارجي".
- التفاصيل الكاملة بـ [`SETUP_AND_STATUS.md`](SETUP_AND_STATUS.md).

**التالي**: المرحلة 3 — الموردون والشيكات والمشتريات.
