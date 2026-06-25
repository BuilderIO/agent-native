---
title: "التصميم"
description: "استوديو نماذج أولية HTML للوكيل - يمكنك إنشاء تصميمات Alpine/Tailwind التفاعلية وتحسينها ومعاينتها وتصديرها مع الوكيل."
---

# التصميم

التصميم عبارة عن استوديو نماذج أولية تابع للوكيل HTML. بدلاً من لوحة رسم ذات طبقات، يقوم الوكيل بإنشاء نماذج Alpine/Tailwind HTML كاملة ومستقلة بذاتها، ويعرضها في إطار iframe، ويتيح لك تحسين النتيجة باستخدام المطالبات وعناصر التحكم.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>صفحة إطلاق المنتج</h1><span class='wf-pill accent'>Desktop</span><span class='wf-pill'>Tablet</span><span class='wf-pill'>Mobile</span><div style='flex:1'></div><button>معاينة</button><button class='primary'>Export code</button></div><div class='wf-card' style='flex:1;display:grid;grid-template-rows:auto 1fr auto;gap:12px'><div style='display:flex;gap:8px'><span class='wf-pill accent'>Hero</span><span class='wf-pill'>Pricing</span><span class='wf-pill'>FAQ</span></div><div class='wf-box' style='display:flex;align-items:center;justify-content:center;min-height:230px'><strong>نموذج HTML أولي مولد</strong></div><div class='wf-card' style='display:flex;align-items:center;gap:10px'><span class='wf-muted'>اجعل القسم الرئيسي أكثر كثافة والدعوة إلى الإجراء أوضح.</span><div style='flex:1'></div><button class='primary'>تطبيق المراجعة</button></div></div></div>"
}
```

عند فتح التطبيق، يكون النموذج الأولي الذي تم إنشاؤه هو مركز مساحة العمل، مع وجود أوضاع المعاينة والمراجعات السريعة وعناصر التحكم في التصدير في متناول اليد. كل ما ينتجه الوكيل هو HTML حقيقي ويمكنك تحسينه أو تصديره أو تسليمه.

```an-diagram title="قطعة أثرية واحدة، لا ترجمة" summary="يقوم الوكيل بإنشاء Alpine/Tailwind مستقل HTML؛ يقرأ iframe والمصدر القابل للتحرير وكل عملية تصدير نفس الملفات. يقوم نظام التصميم المرتبط بتغذية الرموز المميزة في كل تمريرة."
{
  "html": "<div class=\"diagram-design\"><div class=\"diagram-col\"><div class=\"diagram-node\">اِسْتَدْعَى<br><small class=\"diagram-muted\">describe screen / page</small></div><div class=\"diagram-pill\">نظام التصميم</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><span class=\"diagram-pill accent\">توليد الوكيل</span><small class=\"diagram-muted\">ملفات HTML / JSX مستقلة</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>iframe preview<br><small class=\"diagram-muted\">اضبط الخيارات · تنقيح Cmd+I</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill ok\">Export</span><small class=\"diagram-muted\">HTML · ZIP · PDF · تسليم</small></div></div>",
  "css": ".diagram-design{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-design .diagram-col{display:flex;flex-direction:column;gap:8px;align-items:flex-start}.diagram-design .diagram-box{display:flex;flex-direction:column;gap:4px}.diagram-design .diagram-arrow{font-size:20px;line-height:1}.diagram-design .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## متى يتم اختياره

- **أنت تريد مفهومًا مصقولًا للصفحة المقصودة، أو اتجاه منتج UI، أو استكشاف العلامة التجارية** التي يمكن أن تترك الأداة كـ HTML حقيقية — وليست لوحة رسم متعددة الطبقات.
- **أنت تريد نموذجًا أوليًا تفاعليًا فعالاً**، مع تصميم Alpine interactions وTailwind، بدلاً من النماذج الثابتة.
- **تريد مقارنة الاتجاهات بسرعة** وإنشاء بعض المتغيرات واختيار الأقوى والاستمرار في التحسين.
- **تريد مخرجات تصميم خاصة بك** — قم بتصدير HTML، أو ZIP، أو PDF، أو قم بتسليم النموذج الأولي إلى أداة البرمجة.

## ما يمكنك فعله به

- **إنشاء نماذج أولية كاملة.** قم بوصف الشاشة أو الصفحة التي تحتاجها وسيقوم الوكيل بإنشاء مستند HTML صالح مع تصميم Tailwind وAlpine interactions.
- **مقارنة المتغيرات.** ابدأ باتجاهات متعددة، واختر الاتجاه الأقوى، ثم تابع التحسين.
- **التعديل بشكل مرئي.** استخدم عناصر التحكم في التعديل المضمنة لإجراء التغييرات الشائعة، أو اطلب من الوكيل تحديثات النسخ والتخطيط واللون والتباعد والتفاعل.
- **تطبيق أنظمة التصميم.** يمكنك حفظ تفضيلات نظام التصميم وإعادة استخدامها حتى يظل العمل الذي يتم إنشاؤه أقرب إلى علامتك التجارية.
- **استيراد المراجع.** قم بإحضار HTML أو المواد المرجعية الحالية كسياق لبطاقة التصميم الجديدة.
- **تصدير ملفات حقيقية.** تصدير HTML أو ZIP أو PDF من النموذج الأولي الذي تم إنشاؤه.

## البدء

عرض توضيحي مباشر: [design.agent-native.com](https://design.agent-native.com).

1. **وصف العنصر.** اطلب الشاشة أو التدفق أو الصفحة المقصودة أو العناصر المرئية
   الاتجاه الذي تريده. قم بتضمين الجمهور والنغمة وأي قيود على المنتج.
2. **مقارنة الاتجاهات.** أنشئ بعض المتغيرات، واختر الأقوى منها، ثم
   استمر في التحسين بدلاً من البدء من جديد.
3. **اضبط التفاصيل.** استخدم أدوات التحكم القابلة للتعديل لإجراء تغييرات مرئية شائعة، أو اسأل
   وكيل تغييرات التخطيط والنسخ والاستجابة والتفاعل.
4. **قم بالتصدير عندما يكون ذلك مفيدًا.** قم بتنزيل HTML أو ZIP أو PDF بمجرد النموذج الأولي
   جاهز لتسليمه إلى أداة أخرى أو إلى زميل في الفريق.

### مطالبات مفيدة

- "إنشاء ثلاثة اتجاهات للصفحة المقصودة لمنتج التحليلات الفنية."
- "اجعل لوحة المعلومات هذه أكثر كثافة وأسهل في الفحص لفريق العمليات."
- "تطبيق نظام التصميم المحفوظ لدينا وتبسيط تخطيط الهاتف المحمول."
- "قم بتصدير هذا النموذج الأولي كـ ZIP بمجرد تحديد المتغير النهائي."
- "تحويل HTML إلى صفحة تسعير أقوى دون تغيير ألوان العلامة التجارية."

## للمطورين

باقي هذا المستند مخصص لأي شخص يقوم بتعديل قالب التصميم أو توسيعه.

### بداية سريعة

```bash
npx @agent-native/core@latest create my-design --standalone --template design
cd my-design
pnpm install
pnpm dev
```

### نموذج البيانات

تعيش جميع البيانات في SQL عبر Drizzle ORM. المخطط: `templates/design/server/db/schema.ts`. تحمل التصميمات وأنظمة التصميم معيار `ownableColumns` وجدول مشاركات إطار عمل مطابق، بحيث يتم إدراجها في نموذج المشاركة لكل مستخدم / لكل مؤسسة.

| الجدول                                   | ما يحمله                                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `designs`                                | مشروع تصميم — `title`، و`description`، و`project_type` (`prototype` / `other`)، و`data` JSON، ورابط `design_system_id` الاختياري        |
| `design_files`                           | الملفات الفردية التي تنتمي إلى التصميم (`filename`، `content`، `file_type` الافتراضية هي `html`)                                        |
| `design_versions`                        | `snapshot` في الوقت المناسب لتصميم مع `label` اختياري، للتاريخ والتراجع                                                                 |
| `design_systems`                         | رموز العلامة التجارية القابلة لإعادة الاستخدام - `data` (الألوان/الطباعة/التباعد)، `assets`، `custom_instructions`، وعلامة `is_default` |
| `design_shares` / `design_system_shares` | يشارك إطار العمل الجداول التي تحدد المبادئ الأساسية (المستخدمين أو المؤسسات) للأدوار (العارض، المحرر، المسؤول)                          |

```an-schema title="نموذج بيانات التصميم" summary="يمتلك التصميم ملفاته ولقطاته ذات الإصدار، ويرتبط بشكل اختياري بنظام تصميم قابل لإعادة الاستخدام. كل من التصميمات والأنظمة قابلة للتملك، ولكل منها جدول مشاركات الإطار."
{
  "entities": [
    { "id": "designs", "name": "designs", "note": "A design project (ownable)", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "title", "type": "text" },
      { "name": "description", "type": "text", "nullable": true },
      { "name": "project_type", "type": "text", "note": "prototype / other" },
      { "name": "data", "type": "json", "note": "starts as {}" },
      { "name": "design_system_id", "type": "id", "fk": "design_systems.id", "nullable": true }
    ] },
    { "id": "files", "name": "design_files", "note": "الملفات الموجودة في التصميم", "fields": [
      { "name": "design_id", "type": "id", "fk": "designs.id" },
      { "name": "filename", "type": "text" },
      { "name": "content", "type": "text" },
      { "name": "file_type", "type": "text", "note": "defaults to html" }
    ] },
    { "id": "versions", "name": "design_versions", "note": "التاريخ / التراجع", "fields": [
      { "name": "design_id", "type": "id", "fk": "designs.id" },
      { "name": "snapshot", "type": "json" },
      { "name": "label", "type": "text", "nullable": true }
    ] },
    { "id": "systems", "name": "design_systems", "note": "Reusable brand tokens (ownable)", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "data", "type": "json", "note": "colors / typography / spacing" },
      { "name": "assets", "type": "json", "nullable": true },
      { "name": "custom_instructions", "type": "text", "nullable": true },
      { "name": "is_default", "type": "boolean" }
    ] },
    { "id": "design_shares", "name": "design_shares", "note": "جدول مشاركات الإطار", "fields": [
      { "name": "design_id", "type": "id", "fk": "designs.id" },
      { "name": "role", "type": "text", "note": "viewer / editor / admin" }
    ] },
    { "id": "system_shares", "name": "design_system_shares", "note": "جدول مشاركات الإطار", "fields": [
      { "name": "design_system_id", "type": "id", "fk": "design_systems.id" },
      { "name": "role", "type": "text", "note": "viewer / editor / admin" }
    ] }
  ],
  "relations": [
    { "from": "designs", "to": "files", "kind": "1-n" },
    { "from": "designs", "to": "versions", "kind": "1-n" },
    { "from": "systems", "to": "designs", "kind": "1-n", "label": "applied to" },
    { "from": "designs", "to": "design_shares", "kind": "1-n" },
    { "from": "systems", "to": "system_shares", "kind": "1-n" }
  ]
}
```

يظل مشروع التصميم عبارة عن غلاف حتى يحتوي على محتوى: يقوم `create-design` بإنشاء صف فارغ (`data: "{}"`)، ثم يكتب `generate-design` ملفات HTML/JSX المستقلة الفعلية. تأتي العناصر التي تم إنشاؤها والمصدر القابل للتحرير وكل عملية تصدير من نفس HTML، لذلك لا يوجد تنسيق منفصل "نموذج بالحجم الطبيعي" لترجمته. يوفر نظام التصميم المرتبط الرموز المميزة و`custom_instructions` التي يكرمها الوكيل في كل تذكرة جيل.

توجد المسارات في UI ضمن `templates/design/app/routes/`: `_index.tsx` (قائمة)، `design.$id.tsx` (محرر)، `present.$id.tsx` (عرض تقديمي)، `design-systems.tsx` و`design-systems_.setup.tsx`، `templates.tsx`، `examples.tsx`، بالإضافة إلى `settings.tsx` و `team.tsx`.

### مفتاح actions

كل عملية قابلة للاستدعاء للوكيل هي ملف TypeScript في `templates/design/actions/`، مثبت تلقائيًا في `POST /_agent-native/actions/:name` وقابل للتشغيل من CLI كـ `pnpm action <name>`. المجموعات:

- **التصميمات** — `create-design` (صدفة فارغة)، `generate-design` (كتابة محتوى HTML/JSX)، `update-design`، `get-design`، `list-designs`، `duplicate-design`، `delete-design`، و`apply-tweaks` لاستمرار مقبض القرص المباشر القيم (لون التمييز، والكثافة، وما إلى ذلك).
- **الملفات** — `create-file`، `update-file`، `list-files`، `delete-file` للملفات الموجودة داخل مشروع التصميم.
- **أنظمة التصميم** — `create-design-system`، و`update-design-system`، و`get-design-system`، و`list-design-systems`، و`delete-design-system`، و`set-default-design-system`، و`analyze-brand-assets` لجمع بيانات العلامة التجارية قبل التحليل.
- **استيراد** — `import-code`، و`import-figma`، و`import-github`، و`import-from-url`، و`import-document` (DOCX/PPTX/PDF/XLSX)، و`import-design-project` لرفع نظام التصميم من مشروع حالي.
- **التصدير والتسليم** — `export-html`، و`export-pdf`، و`export-svg`، و`export-zip`، و`export-coding-handoff` لتحويل التصميم إلى تسليم لأداة البرمجة.
- **السياق والتنقل** — `view-screen` (التصميم الحالي، ملف مفتوح، عرض، سؤال معلق أو شبكة متغيرة)، `get-design-snapshot` (الحالة الحالية للوكيل الخارجي للمتابعة منها)، و`navigate`.

### العمل مع الوكيل

يعرف الوكيل دائمًا ما قمت بفتحه. يتم إرجاع التصميم الحالي والملف المفتوح والعرض النشط وأي سؤال معلق أو شبكة متغيرة بواسطة `view-screen` ويتم إدخالها في كل رسالة، بحيث يمكنك قول "اجعل هذا أكثر كثافة" أو "قم بتصدير هذا المتغير" بدون تسمية التصميم.

نظرًا لأن التصميم هو مجرد ملفات HTML/JSX مستقلة، يقوم الوكيل بتحرير نفس المصدر الذي يعرضه iframe ويأتي منه كل تصدير - لا يوجد تنسيق "AI mockup" منفصل لترجمته. يوفر نظام التصميم المرتبط الرموز المميزة ويكرم الوكيل `custom_instructions` في كل تذكرة جيل. حدد نصًا أو منطقة في المعاينة واضغط على Cmd+I لتركيز الوكيل على هذا الجزء بالضبط.

### تخصيصه

التصميم عبارة عن قالب كامل وقابل للاستنساخ. بعض الأفكار الإضافية العملية:

- "أضف نظام تصميم للتجارة الإلكترونية قابل لإعادة الاستخدام باستخدام الرموز المميزة وعينات المكونات."
- "أضف خطوة تصدير لتحميل ZIP إلى نظام المراجعة الداخلية الخاص بنا."
- "اسمح لي بلصق الصفحة المقصودة الحالية HTML وأطلب من الوكيل ثلاثة إصدارات أقوى."
- "أضف مكتبة مطالبات محفوظة لصفحة المنتج ولوحة التحكم وملخصات شاشة الإعداد."
- "أضف إعدادًا مسبقًا للتصدير PDF مخصص لمراجعة أصحاب المصلحة."

يقوم الوكيل بتحرير المسارات والمكونات والنماذج المدعومة actions وSQL حسب الحاجة. راجع [Templates](/docs/cloneable-saas) للاطلاع على الاستنساخ الكامل والتخصيص والنشر و[Getting Started](/docs/getting-started) إذا كان هذا هو أول قالب أصلي للوكيل.

## ما هي الخطوة التالية

- [**Templates**](/docs/cloneable-saas) — نموذج الاستنساخ والتملك
- [**Context Awareness**](/docs/context-awareness) — كيف يعرف الوكيل ما يشاهده المستخدم
- [**Creating Templates**](/docs/creating-templates) — أنماط البناء الحالية لقوالب الوكيل الأصلية
