---
title: "التقويم"
description: "تقويم مدعوم من الوكيل مع مزامنة Google Calendar وروابط الحجز بنمط Calendly. يمكنك الجدولة والعثور على المواعيد وإدارة التوفر من خلال اللغة الإنجليزية البسيطة."
---

# التقويم

تطبيق تقويم مدعوم من الوكيل. قم بتوصيل Google Calendar الخاص بك وسيتمكن الوكيل من قراءة جدولك الزمني والعثور على فتحات مجانية وإنشاء أحداث وإدارة روابط الحجز على نمط Calendly - كل ذلك باللغة الإنجليزية البسيطة. فهو يستبدل مجموعة Google Calendar + Calendly بتطبيق واحد تملكه.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1.4px solid var(--wf-line)'><button>Week</button><button>Today</button><button>‹</button><button>›</button><div style='flex:1'></div><strong>3-9 مايو 2026</strong><div style='flex:1'></div><button class='primary'>حدث جديد</button></div><div style='display:grid;grid-template-columns:56px repeat(7,minmax(0,1fr));grid-template-rows:36px repeat(5,72px);gap:7px;padding:14px;flex:1'><div></div><strong>الأحد 3</strong><strong>الاثنين 4</strong><strong>الثلاثاء 5</strong><strong>الأربعاء 6</strong><strong>الخميس 7</strong><strong>الجمعة 8</strong><strong>السبت 9</strong><small class='wf-muted'>7 AM</small><div class='wf-box' style='opacity:.45'></div><div></div><div></div><div></div><div></div><div></div><div></div><small class='wf-muted'>9 AM</small><div class='wf-box'>اجتماع عام</div><div class='wf-box'>اجتماع هندسي يومي</div><div class='wf-box'>اجتماع هندسي يومي</div><div class='wf-box'>اجتماع هندسي يومي</div><div></div><div class='wf-box'>Planning</div><div></div><small class='wf-muted'>11 AM</small><div class='wf-box'>مراجعة التصميم</div><div></div><div class='wf-box'>نقد التصميم</div><div class='wf-box'>Roadmap</div><div class='wf-box'>عرض الجمعة</div><div></div><div></div><small class='wf-muted'>1 PM</small><div></div><div class='wf-box'>1:1</div><div class='wf-box'>كتلة تركيز</div><div></div><div></div><div class='wf-box'>اجتماع عام</div><div></div><small class='wf-muted'>3 PM</small><div></div><div></div><div></div><div class='wf-box'>اجتماع تخطي المستوى</div><div></div><div></div><div></div></div></div>"
}
```

عند فتح التطبيق، يكون عرض التقويم النشط هو السطح الأساسي. لا يزال الوكيل يعرف اليوم أو الأسبوع أو الحدث الذي تتطلع إليه، لذا يمكنك أن تقول "حدد موعدًا لمكالمة مدتها 30 دقيقة مع Alex في هذا اليوم" دون توضيح كل شيء.

```an-diagram title="كيف يتدفق طلب الجدولة" summary="سواء قمت بالنقر فوق التقويم أو سؤال الوكيل، تتم قراءة نفس الإجراءات مباشرة من Google Calendar ثم يتم إعادة كتابتها إلى نفس العرض."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">تنقر<br><small class=\"diagram-muted\">السحب، شريط الأدوات، الاختصارات</small></div><div class=\"diagram-node\">أنت تسأل الوكيل<br><small class=\"diagram-muted\">\"find a 1-hour slot next week\"</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Actions</span><small class=\"diagram-muted\">list-events · check-availability · create-event</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Google Calendar<br><small class=\"diagram-muted\">مباشر، متعدد الحسابات</small></div><div class=\"diagram-box\">SQL<br><small class=\"diagram-muted\">الحجوزات · التوفر</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box\">تتحدث طريقة عرض التقويم مباشرة</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## ما يمكنك فعله به

- **شاهد Google Calendar** الحقيقي في عرض اليوم أو الأسبوع أو الشهر، مع تراكب حسابات متعددة.
- **اشترك في خلاصات ICS** (إجازات الموارد البشرية، وجداول المؤتمرات، وتقويمات الفريق) — للقراءة فقط، ومختلطة في نفس العرض.
- **تعيين التوفر الأسبوعي** مع دعم المنطقة الزمنية — يستخدم الوكيل هذا عند البحث عن فتحات مجانية.
- **إنشاء روابط حجز عامة** على `/book/{slug}` لأشياء مثل "مقدمة مدتها 15 دقيقة" أو "عرض توضيحي مدته 30 دقيقة". قم بتكوين الفترات والحقول المخصصة وأداة المؤتمرات التي سيتم استخدامها.
- **اسأل الوكيل عن أي شيء يتعلق بالجدول الزمني**: "هل أنا متفرغ بعد ظهر يوم الخميس؟" "ابحث عن فترة زمنية مدتها ساعة واحدة في الأسبوع المقبل، ثم ضع عبارة "التخطيط مع Alex" عليها." "إيقاف رابط الحجز التجريبي مؤقتًا."
- **مشاركة روابط الحجز** مع أعضاء الفريق حتى يتمكنوا من إدارتها أيضًا.

## البدء

عرض توضيحي مباشر: [calendar.agent-native.com](https://calendar.agent-native.com).

عند فتح التطبيق لأول مرة:

1. انقر على **الإعدادات**.
2. انقر فوق **Connect Google Calendar** ثم قم بالموافقة.
3. (اختياري) قم بتوصيل المزيد من حسابات Google إذا كنت تريد تراكب الحسابات الشخصية والعملية.
4. افتح العرض الرئيسي - سيتم تحميل التقويم الحقيقي الخاص بك.

لإنشاء رابط الحجز الأول:

1. انقر على **روابط الحجز** في الشريط الجانبي.
2. انقر على **رابط حجز جديد**، وعيّن العنوان والمدة.
3. مشاركة URL العامة - يختار الزائرون من الخانات المتاحة لديك.

أو اسأل الوكيل فقط: "أنشئ رابط حجز تمهيدي مدته 15 دقيقة مع حقل الاسم."

### مطالبات مفيدة

- "ماذا يوجد في تقويمي اليوم؟"
- "هل أنا متفرغ بعد ظهر الخميس لمدة 30 دقيقة؟"
- "ابحث عن فترة زمنية مدتها ساعة واحدة في الأسبوع القادم وضع عليها عبارة "التخطيط مع Alex"."
- "إعادة جدولة هذا الحدث إلى الجمعة الساعة 2 ظهرًا." (عند تحديد حدث)
- "التبديل إلى عرض اليوم والانتقال إلى يوم الاثنين القادم."
- "أنشئ رابط حجز يسمى "مقدمة مدتها 15 دقيقة" في 15 دقيقة مع حقل ملاحظة."
- "إيقاف رابط الحجز التجريبي لمدة 30 دقيقة مؤقتًا."
- "حظر فترات ما بعد الظهر يوم الجمعة عند توفري."
- "ما هي الاجتماعات التي سأعقدها بشأن "الانطلاق" هذا الشهر؟"

سيقوم الوكيل بالاستعلام عن Google Calendar مباشرة لأي سؤال يتعلق بالجدول الزمني - فهو لا يخمن أبدًا.

## للمطورين

باقي هذا المستند مخصص لأي شخص يقوم بتعديل قالب التقويم أو توسيعه.

### بداية سريعة

قم بإنشاء مساحة عمل جديدة باستخدام قالب التقويم:

```bash
npx @agent-native/core@latest create my-app --standalone --template calendar
cd my-app
pnpm install
pnpm dev
```

افتح `http://localhost:8082` (منفذ تطوير التقويم الافتراضي).

لربط Google Calendar في جهاز التطوير، افتح عرض الإعدادات، والصق `GOOGLE_CLIENT_ID` و`GOOGLE_CLIENT_SECRET` من [Google Cloud Console](https://console.cloud.google.com/)، ثم انقر فوق "Connect Google Calendar". إعادة توجيه OAuth URI هي `http://localhost:8082/_agent-native/google/callback` في التطوير. يتم تخزين الرموز المميزة في جدول `oauth_tokens` SQL ويتم تحديثها تلقائيًا.

### الميزات الرئيسية

**عروض التقويم المباشرة.** تتم قراءة طرق عرض اليوم والأسبوع والشهر مباشرة من حسابات Google المتصلة، مع خلاصات ICS الاختيارية للقراءة فقط والمدرجة في نفس الجدول.

**التوفر والبحث في الفتحات المجانية.** تغذي قواعد التوفر الأسبوعية ودعم المنطقة الزمنية والأحداث الحالية نفس إجراء التوفر الذي يستخدمه UI والوكيل.

**روابط الحجز.** تجمع صفحات `/book/{slug}` العامة الاسم والبريد الإلكتروني والحقول المخصصة وتفضيلات المؤتمرات والرموز المميزة للإلغاء/إعادة الجدولة.

**إدارة قابلة للمشاركة.** تكون روابط الحجز خاصة بشكل افتراضي، ولكن يمكن مشاركتها مع أعضاء الفريق من خلال مشاركة إطار العمل actions.

**معاينات الأحداث المضمنة.** يستطيع الوكيل تضمين بطاقات أحداث مضغوطة في الدردشة مع العنوان، والوقت، والموقع، والحاضرين، وزر الرجوع.

### العمل مع الوكيل

يرى الوكيل ما تنظر إليه. يتم تضمين عرض التقويم الحالي والتاريخ المحدد والحدث المحدد في كل رسالة ككتلة `current-screen`، لذا يمكنك أن تقول "هذا الحدث" أو "هذا اليوم" ويتم حلها بشكل صحيح.

تحت الغطاء، يقوم الوكيل باستدعاء actions مثل `list-events`، و`check-availability`، و`create-event`، و`navigate`، و`update-availability`. نظرًا لأن الأحداث موجودة في Google Calendar، يقوم الوكيل دائمًا بالاستعلام عن API بدلاً من التخمين - ولن يقوم بإرجاع نتائج فارغة دون تشغيل البرنامج النصي أولاً.

### نموذج البيانات

محدد في `templates/calendar/server/db/schema.ts`. يتم تخزين البيانات غير المتعلقة بالحدث فقط محليًا:

- `bookings` — المواعيد المؤكدة من صفحات الحجز العامة. اسم المتجر، والبريد الإلكتروني، والبداية، والنهاية، والارتباط الثابت، والملاحظات الاختيارية، واستجابات الحقول المخصصة، ورابط الاجتماع، وإدارة `cancelToken` للعامة URL، وحالة `confirmed` أو `cancelled`.
- `booking_links` — تعريفات الارتباط بنمط Calendly. سبيكة، العنوان، الوصف، `duration` الأساسي، قائمة `durations` الاختيارية، `customFields`، `conferencing`، `color`، وعلامة `isActive`. يستخدم `ownableColumns` الخاص بإطار العمل حتى يتم تطبيق نظام المشاركة.
- `booking_slug_redirects` — يتذكر الارتباطات الثابتة القديمة عند إعادة تسمية الرابط حتى تستمر URL العامة الموجودة في العمل.
- `booking_link_shares` — مشاركة المنح لروابط الحجز.

```an-schema title="Calendar نموذج البيانات" summary="يتم تخزين البيانات غير المتعلقة بالحدث محليًا فقط - الأحداث مباشرة في Google Calendar. تستخدم روابط الحجز أعمدة خاصة بها بحيث يتم تطبيق نظام المشاركة."
{
  "entities": [
    {
      "id": "booking_links",
      "name": "booking_links",
      "note": "Calendly-style link definitions (ownable)",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "slug", "type": "string", "note": "public page at /book/{slug}" },
        { "name": "title", "type": "string" },
        { "name": "description", "type": "string", "nullable": true },
        { "name": "duration", "type": "int", "note": "primary duration in minutes" },
        { "name": "durations", "type": "json", "nullable": true, "note": "alternative durations" },
        { "name": "customFields", "type": "json", "nullable": true },
        { "name": "conferencing", "type": "string", "note": "Google لقاء / تكبير / مخصص" },
        { "name": "color", "type": "string", "nullable": true },
        { "name": "isActive", "type": "bool", "note": "pause without deleting" }
      ]
    },
    {
      "id": "bookings",
      "name": "bookings",
      "note": "تم تأكيد المواعيد من صفحات الحجز العامة",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "slug", "type": "string", "fk": "booking_links.slug" },
        { "name": "name", "type": "string" },
        { "name": "email", "type": "string" },
        { "name": "start", "type": "datetime" },
        { "name": "end", "type": "datetime" },
        { "name": "notes", "type": "string", "nullable": true },
        { "name": "customFields", "type": "json", "nullable": true, "note": "custom field responses" },
        { "name": "meetingLink", "type": "string", "nullable": true },
        { "name": "cancelToken", "type": "string", "note": "powers /booking/manage/{token}" },
        { "name": "status", "type": "enum", "note": "مؤكد | تم الإلغاء" }
      ]
    },
    {
      "id": "booking_slug_redirects",
      "name": "booking_slug_redirects",
      "note": "يحافظ على عمل عناوين URL العامة القديمة بعد إعادة تسمية الرابط",
      "fields": [
        { "name": "oldSlug", "type": "string", "pk": true },
        { "name": "linkId", "type": "id", "fk": "booking_links.id" }
      ]
    },
    {
      "id": "booking_link_shares",
      "name": "booking_link_shares",
      "note": "مشاركة المنح لروابط الحجز",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "linkId", "type": "id", "fk": "booking_links.id" },
        { "name": "principal", "type": "string", "note": "user or org" },
        { "name": "role", "type": "enum", "note": "عارض | محرر | admin" }
      ]
    }
  ],
  "relations": [
    { "from": "booking_links", "to": "bookings", "kind": "1-n", "label": "has bookings" },
    { "from": "booking_links", "to": "booking_slug_redirects", "kind": "1-n", "label": "has old slugs" },
    { "from": "booking_links", "to": "booking_link_shares", "kind": "1-n", "label": "has share grants" }
  ]
}
```

توجد قواعد التوفر والتكوين لكل مستخدم في جدول الإعدادات، مع مفتاح `calendar-availability`. توجد رموز Google OAuth في جدول إطار العمل `oauth_tokens`. توجد حالة UI المؤقتة (العرض الحالي والتاريخ والحدث المحدد) في `application_state` تحت مفتاح `navigation`.

### تخصيصه

كل جزء من التطبيق هو مصدر قابل للتحرير. ابدأ هنا:

- `templates/calendar/actions/` — كل عملية يمكن استدعاءها بواسطة الوكيل. أضف ملفًا جديدًا باستخدام `defineAction` لكشف الإمكانات الجديدة لكل من الوكيل والواجهة الأمامية. الملفات الرئيسية: `check-availability.ts`، `create-event.ts`، `list-events.ts`، `create-booking-link.ts`، `update-availability.ts`، `add-external-calendar.ts`، `navigate.ts`، `view-screen.ts`.
- `templates/calendar/app/routes/` — UI. `_app._index.tsx` هو التقويم، و`_app.availability.tsx` هو محرر الجدول الزمني، و`_app.booking-links._index.tsx` و`_app.booking-links.$id.tsx` يديران روابط الحجز، و`_app.bookings.tsx` يسرد الحجوزات، و`_app.settings.tsx` هي الإعدادات، و`book.$slug.tsx` plus `meet.$username.$slug.tsx` هي صفحات الحجز العامة.
- `templates/calendar/server/db/schema.ts` - إضافة أعمدة أو جداول باستخدام Drizzle. احتفظ باللهجة الرمزية حتى يتم تشغيل القالب على SQLite، وPostgres، وTurso، وD1، وNeon.
- `templates/calendar/AGENTS.md` — تعليمات الوكيل. قم بتحديث هذا عندما تقوم بتعليم الوكيل إمكانيات أو اصطلاحات جديدة.
- `templates/calendar/.agents/skills/` — الأنماط التفصيلية التي يتبعها الوكيل. skills ذات الصلة: `event-management`، `availability-booking`، `real-time-sync`، `storing-data`، `delegate-to-agent`، `frontend-design`.
- `templates/calendar/shared/api.ts` — أنواع TypeScript المشتركة (`AvailabilityConfig`، `BookingLink`، `ExternalCalendar`، وما إلى ذلك) التي يستخدمها كل من الخادم والعميل.

إذا قمت بإضافة ميزة، فتذكر تحديث جميع المجالات الأربعة: UI أو الإجراء أو المهارة أو إدخال AGENTS.md وأي حالة تطبيق يحتاج الوكيل إلى رؤيتها. وهذا ما يبقي الوكيل وUI على قدم المساواة.
