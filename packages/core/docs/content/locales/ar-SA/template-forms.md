---
title: "النماذج"
description: "أداة إنشاء النماذج الأصلية للوكيل — إنشاء عمليات إرسال النماذج وتحريرها ونشرها وتوجيهها من خلال اللغة الطبيعية بالإضافة إلى محرر مرئي."
---

# النماذج

Forms عبارة عن أداة إنشاء نماذج أصلية للوكيل. قم بوصف النموذج الذي تريده، وقم بتحسينه في المحرر، وانشر نموذجًا عامًا يخزن عمليات الإرسال في قاعدة بيانات SQL الخاصة بك.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1.4px solid var(--wf-line)'><strong>الاشتراك التجريبي</strong><span class='wf-pill accent'>published</span><div style='flex:1'></div><button>يشارك</button><button class='primary'>إلغاء النشر</button></div><div style='display:flex;gap:8px;padding:12px 16px;border-bottom:1.4px solid var(--wf-line)'><span class='wf-pill accent'>يحرر</span><span class='wf-pill'>النتائج 187</span><span class='wf-pill'>إعدادات</span><span class='wf-pill'>التكامل</span></div><div style='display:flex;flex-direction:column;gap:12px;padding:30px 78px;overflow:hidden'><h2 style='margin:0'>الاشتراك التجريبي</h2><p class='wf-muted' style='margin:0'>احجز مكانًا في مجموعة البيتا الخاصة القادمة.</p><div class='wf-card'><strong>الاسم الكامل</strong><input value='Ada Lovelace'/></div><div class='wf-card'><strong>البريد الإلكتروني للعمل</strong><input value='you@company.com'/></div><div class='wf-card'><strong>دورك</strong><input value='Select...'/></div><div class='wf-card'><strong>حجم الفريق</strong><input value='Select...'/></div></div></div>"
}
```

عند فتح التطبيق، ترى النماذج والمحرر الحالي والمعاينة المباشرة. يمكن للوكيل إنشاء نموذج من موجه، وتحديث تسميات الحقول وخياراتها، وتغيير التحقق من الصحة، وتوصيل وجهات الإرسال باستخدام نفس actions الذي يستخدمه UI.

```an-diagram title="بناء ونشر وجمع" summary="يقوم الوكيل والمحرر المرئي بتحرير تعريف نموذج SQL-backed واحد. لم تتم مصادقة صفحة التعبئة العامة، ويتم توجيه عمليات الإرسال من جانب الخادم إلى وجهاتك."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">موجه الوكيل<br><small class=\"diagram-muted\">\"add an NPS question\"</small></div><div class=\"diagram-node\">محرر مرئي<br><small class=\"diagram-muted\">التسميات والتحقق والترتيب</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">create-form · update-form</span><small class=\"diagram-muted\">JSON للحقول وJSON للإعدادات</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">forms table<br><small class=\"diagram-muted\">SQL عبر Drizzle</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">صفحة تعبئة عامة<br><small class=\"diagram-muted\">unauthenticated</small></div><div class=\"diagram-box\">responses<br><small class=\"diagram-muted\">+ Slack / webhook / جداول</small></div></div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## ما يمكنك فعله به

- **إنشاء النماذج بشكل تحادثي.** "إنشاء نموذج اتصال"، "أضف سؤال نتيجة NPS"، "اجعل حقل البريد الإلكتروني مطلوبًا." يقوم الوكيل بتحديث مخطط النموذج وتحديثات المعاينة من الحالة المدعومة SQL.
- **الضبط البصري.** قم بتحرير التسميات والعناصر النائبة والحالة المطلوبة والخيارات وترتيب الحقول من أداة الإنشاء UI عندما تريد التحكم المباشر.
- **استخدم أنواع الحقول المشحونة.** يتم دعم حقول النص والبريد الإلكتروني والرقم والنص الطويل والتحديد والتحديد المتعدد ومربع الاختيار والراديو والتاريخ والتقييم والمقياس بشكل جاهز.
- **جمع الردود.** يتم تخزين كل إرسال في SQL مع عرض التفاصيل لكل إجابة ولوحة معلومات لمراجعة الإدخالات.
- **توجيه عمليات الإرسال.** أرسل حمولات الإرسال إلى webhooks، أو Slack، أو Discord، أو Google Sheets باستخدام عمليات التكامل المضمنة.
- **نشر النماذج العامة.** شارك نموذجًا عامًا URL وأظهر رسالة شكر بعد الإرسال.

## البدء

عرض توضيحي مباشر: [forms.agent-native.com](https://forms.agent-native.com).

1. **قم بإنشاء نموذج من الموجه.** اطلب النموذج الذي تريده، بما في ذلك
   الجمهور وما يجب أن يحدث بعد الإرسال.
2. **التحسين في المحرر.** ضبط التسميات والتحقق من الصحة والاختيارات والترتيب في
   المنشئ المرئي عندما يكون التحرير المباشر أسرع.
3. **النشر والمشاركة.** استخدم النموذج العام URL للمستجيبين، ثم شاهد
   تصل النتائج إلى عرض الردود.
4. **توصيل الوجهات.** توجيه عمليات الإرسال الجديدة إلى Slack، Discord، Google
   جداول البيانات، webhooks، أو نقطة الامتداد الخاصة بك.

### مطالبات مفيدة

- "أنشئ نموذج اشتراك تجريبي يتضمن الدور وحجم الفريق وحالة الاستخدام ذات الأولوية."
- "أضف سؤال NPS المطلوب ومتابعة النص الحر."
- "انشر كل رد جديد على قناة Slack للمنتج."
- "تلخيص عمليات الإرسال لهذا الأسبوع وتجميعها حسب شريحة العملاء."
- "اجعل هذا النموذج أقصر دون فقدان الحقول التي نحتاجها للتوجيه."

## للمطورين

باقي هذا المستند مخصص لأي شخص يقوم بتعديل قالب النماذج أو توسيعه.

### بداية سريعة

```bash
npx @agent-native/core@latest create my-forms --standalone --template forms
cd my-forms
pnpm install
pnpm dev
```

بالنسبة لمساحة العمل التي تحتوي على النماذج إلى جانب التطبيقات الأخرى:

```bash
npx @agent-native/core@latest create my-platform
```

اختر النماذج وأي قوالب أخرى تريدها أثناء إعداد مساحة العمل.

### الميزات الرئيسية {#key-features}

**تعريفات نماذج JSON.** توجد الحقول في عمود `fields` JSON واحد، لذا يستطيع الوكيل إجراء تعديلات جراحية دون إجراء تغييرات على المخطط لكل نوع حقل.

**صفحات التعبئة العامة.** يمكن للمستجيبين إرسال نماذج لم تتم مصادقتها، بينما تتم إزالة الإعدادات الخاصة قبل وصول البيانات إلى المتصفح.

**الوجهات من جانب الخادم.** تظهر عمليات تكامل Slack وDiscord وجداول بيانات Google وخطاف الويب في إعدادات النموذج ويتم تشغيلها بعد الإرسال.

### نموذج البيانات

تعيش جميع البيانات في SQL عبر Drizzle ORM. المخطط: `templates/forms/server/db/schema.ts`. تحمل النماذج `ownableColumns` القياسي وجدول مشاركات إطار العمل المطابق، بحيث يتم إدخالها في نموذج المشاركة لكل مستخدم/لكل مؤسسة.

| الجدول        | ما يحمله                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forms`       | تعريف النموذج — `title`، `description`، `slug` الفريد، `fields` (مصفوفة JSON من `FormField`)، `settings` (JSON `FormSettings`)، `status` (`draft` / `published` / `closed`)، وحذف ناعم `deleted_at` |
| `responses`   | إرسال واحد لكل صف — `form_id`، `data` (JSON `{ fieldId: value }`)، `submitted_at`، `ip` اختياري و`submitter_email`                                                                                  |
| `form_shares` | يشارك الإطار مبادئ تعيين الجدول (المستخدمين أو المؤسسات) إلى الأدوار (العارض، المحرر، المسؤول) لكل نموذج                                                                                            |

يتم تعريف الأشكال `fields` و`settings` JSON في `templates/forms/shared/types.ts` (`FormField`، `FormSettings`). تتم إزالة الإعدادات الخاصة بالمالك مثل خطاف الويب التكاملي URL والأصول المسموح بها قبل أن تصل أي بيانات إلى صفحة التعبئة العامة عبر `toPublicFormSettings`.

```an-schema title="نموذج بيانات النماذج" summary="ثلاث جداول. الحقول وعمليات التكامل عبارة عن أعمدة JSON في النماذج، لذا فإن تعديلات الوكيل عبارة عن تصحيحات جراحية بدلاً من تغييرات الصفوف عبر الجدول."
{
  "entities": [
    {
      "id": "forms",
      "name": "forms",
      "note": "A form definition (ownable)",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "title", "type": "string" },
        { "name": "description", "type": "string", "nullable": true },
        { "name": "slug", "type": "string", "note": "unique; public URL" },
        { "name": "fields", "type": "json", "note": "FormField[] — جميع أنواع الحقول" },
        { "name": "settings", "type": "json", "note": "إعدادات النموذج — عمليات التكامل، وما إلى ذلك." },
        { "name": "status", "type": "enum", "note": "مسودة | نشرت | مغلق" },
        { "name": "deleted_at", "type": "datetime", "nullable": true, "note": "soft delete" },
        { "name": "owner_email", "type": "string" },
        { "name": "org_id", "type": "id", "nullable": true }
      ]
    },
    {
      "id": "responses",
      "name": "responses",
      "note": "إرسال واحد لكل صف",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "form_id", "type": "id", "fk": "forms.id" },
        { "name": "data", "type": "json", "note": "{ fieldId: value }" },
        { "name": "submitted_at", "type": "datetime" },
        { "name": "ip", "type": "string", "nullable": true },
        { "name": "submitter_email", "type": "string", "nullable": true }
      ]
    },
    {
      "id": "form_shares",
      "name": "form_shares",
      "note": "جدول مشاركات إطار العمل — المبادئ الأساسية للأدوار لكل نموذج",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "form_id", "type": "id", "fk": "forms.id" },
        { "name": "principal", "type": "string", "note": "user or org" },
        { "name": "role", "type": "enum", "note": "عارض | محرر | admin" }
      ]
    }
  ],
  "relations": [
    { "from": "forms", "to": "responses", "kind": "1-n", "label": "has responses" },
    { "from": "forms", "to": "form_shares", "kind": "1-n", "label": "has share grants" }
  ]
}
```

### مفتاح actions

كل عملية هي ملف TypeScript في `templates/forms/actions/`، مثبت تلقائيًا في `POST /_agent-native/actions/:name`:

- `create-form` — إنشاء نموذج جديد (العنوان، الوصف، الحقول، الإعدادات)
- `update-form` - تحديث الحقول أو الإعدادات أو الحالة
- `get-form` — استرداد نموذج بالمعرف أو بالارتباط الثابت
- `list-forms` — قائمة النماذج التي يمكن الوصول إليها
- `delete-form` — الحذف الناعم (مجموعة `deleted_at`)
- `restore-form` — استعادة نموذج محذوف بشكل بسيط
- `list-responses` — قائمة عمليات الإرسال لنموذج يحتوي على مرشحات اختيارية
- `export-responses` — تصدير الاستجابات بتنسيق CSV أو JSON

### تخصيصه

اطلب من الوكيل سلوك الشحن أولاً:

- "أضف حقل اختيار مطلوب لطريقة الاتصال المفضلة."
- "نشر كل إرسال جديد إلى Slack." قم بتوصيل Slack أولاً عبر [Messaging](/docs/messaging).
- "أضف وجهة الرد التلقائي على الويب لـ CRM."
- "إنشاء نموذج تعليقات العملاء بمقياس من 1 إلى 10 ومتابعة نصية طويلة."
- "اجعل بعض النماذج عامة والبعض الآخر لتسجيل الدخول فقط."

إذا كنت بحاجة إلى إمكانات جديدة مثل تحميلات الملفات أو التوقيعات أو عناصر واجهة المستخدم المخصصة للحقول، فتعامل معها كامتدادات للقوالب: أضف شكل SQL وعناصر تحكم محرر actions وUI ودعم العارض العام وتعليمات الوكيل معًا. راجع [Creating Templates](/docs/creating-templates) للتعرف على نمط البناء الحالي.

## ما هي الخطوة التالية

- [**Templates**](/docs/cloneable-saas) — نموذج الاستنساخ والامتلاك
- [**Actions**](/docs/actions) — نظام العمل الذي يدعم المنشئ
- [**Messaging**](/docs/messaging) — Slack ووجهات الإرسال الأخرى
