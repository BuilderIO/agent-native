---
title: "مثبت المخطط"
description: "تطبع إضافة Agent-Native وصفة تكامل Markdown منسقة إلى stdout - قم بتوصيلها إلى وكيل الترميز الخاص بك، والذي يطبق التغييرات على الريبو المباشر الخاص بك."
---

# مثبت المخطط

> **من هو هذا:** المؤلفون المضيفون والمتكاملون الذين يضيفون موفرًا وقناة
> الواجهة الخلفية لصندوق الحماية، أو إجراء عملية إعادة الشراء عن طريق إدخال وصفة في وكيل الترميز الخاص بهم.

`agent-native add` ** ليس ** سقالة غبية تكتب الملفات لك. فهو يصدر مخطط تكامل Markdown منسق إلى stdout. يمكنك توجيه هذا المخطط إلى وكيل الترميز الخاص بك (Claude Code، Codex، ...)، والذي يطبق التغييرات على الريبو المباشر مع السياق الكامل.

يتناسب هذا مع أسلوب الوكيل الذي يطبق التغييرات ونظام الملفات أولاً: يوفر إطار العمل الوصفة (الملفات الأساسية التي يجب لمسها، والقواعد التي يجب احترامها، وخطوة التحقق)، ويقوم وكيل الترميز بالتحرير.

```bash
agent-native add provider stripe | claude
agent-native add channel discord  | codex
```

```an-diagram title="إضافة مطبوعات وصفة؛ يقوم وكيل الترميز الخاص بك بتطبيقه" summary="agent-native يُصدر مخطط Markdown إلى stdout (التشخيص إلى stderr)؛ تقوم بتوصيله إلى Claude Code أو Codex، والذي يقوم بتحرير الريبو المباشر الخاص بك بالسياق الكامل."
{
  "html": "<div class=\"diagram-bp\"><div class=\"diagram-node\" data-rough>agent-native إضافة<br><small class=\"diagram-muted\">&lt;عطوف&gt; &lt;الاسم|URL&gt;</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>مخطط Markdown<br><small class=\"diagram-muted\">stdout · ملفات للمس · قواعد · التحقق</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough>وكيل الترميز<br><small class=\"diagram-muted\">كلود · المخطوطة</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">يقوم بتحرير الريبو المباشر الخاص بك</div></div>",
  "css": ".diagram-bp{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-bp .diagram-arrow{font-size:22px;line-height:1}.diagram-bp .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## الاستخدام {#usage}

```bash
agent-native add <kind> <name>            # print a curated blueprint
agent-native add <kind> <https://docs…>   # البحث والتكامل من URL
agent-native add --list                   # list available kinds and blueprints
```

- يحل **الاسم** العاري مخططًا منسقًا من `blueprints/<kind>/<name>.md`.
- يُصدر **URL** بدلاً من الاسم مخططًا عامًا _للبحث والتكامل_ لهذا النوع، مع تضمين URL كنقطة بداية للبحث (URL عبارة عن بذرة بحث، وليست وصفة معروفة).
- ينتقل المخطط إلى **stdout**; تنتقل التشخيصات إلى stderr، لذلك يتلقى `… | claude` المخطط فقط.

## المخططات المصنفة {#seeded}

يعرض `agent-native add --list` ما يأتي في الصندوق:

| النوع      | الاسم     | ما يتم إعداده                                                                       |
| ---------- | --------- | ----------------------------------------------------------------------------------- |
| `provider` | `stripe`  | قم بتوصيل الموفر إلى الركيزة `provider-api` (الكتالوج / المستندات / الطلب الثلاثي). |
| `channel`  | `discord` | نفذ قناة `PlatformAdapter` للربط الداخلي على الويب وقم بتسجيلها.                    |
| `sandbox`  | `docker`  | قم بتنفيذ وصلة `SandboxAdapter` لتشغيل `run-code` في حاوية Docker.                  |
| `action`   | `crud`    | أضف `defineAction` واحدًا متعدد الأسطح بمخطط Zod (واحد `update` على N).             |

كل مخطط مستقل بذاته: وكيل الترميز الذي يقرأه يجعل الملفات تلمسه، ويحترم قواعد إطار العمل (actions هي المصدر الوحيد للحقيقة، ولا أسرار مطلقة، ونطاق البيانات القابلة للامتلاك، وإضافة مجموعة تغييرات لمصدر `packages/*`)، وقسم **تحقق** ملموس.

## URL → مخطط البحث {#url}

عند تمرير URL، لا يحتوي هذا النوع على وصفة منسقة لـ (أو يريد تكاملًا جديدًا)، يُصدر `add` مخططًا عامًا "للبحث والتكامل" مع URL باعتباره البذرة:

```bash
agent-native add provider https://docs.example.com/api | claude
```

يخبر المخطط الذي تم إنشاؤه وكيل الترميز بإحضار URL (والصفحات التي يرتبط بها) لنقاط النهاية الحقيقية، ونموذج المصادقة، وأشكال الحمولة، ومتطلبات التوقيع/التحقق - _عدم_ التخمين من بيانات التدريب - ثم التنفيذ والتحقق. كما أنه يحمل أيضًا إرشادات خاصة بالنوع (على سبيل المثال، يتم توجيه `provider` URL نحو الركيزة `provider-api`؛ و`channel` URL نحو `PlatformAdapter`).

## إضافة مخططك الخاص {#authoring}

أسقط ملف Markdown في `packages/core/blueprints/<kind>/<name>.md`. هذا النوع هو الدليل الفرعي؛ الاسم هو اسم الملف بدون `.md`. يتم التقاطه تلقائيًا - يقرأ كل من `--list` وتحليل الاسم والكتالوج الدليل في وقت التشغيل. ليست هناك حاجة إلى تغيير الرمز لتسجيله.

يتم شحن ملفات Blueprint `.md` في الحزمة المنشورة عبر إدخال `blueprints` في `package.json` `files`، بحيث يتم حلها عند `node_modules/@agent-native/core/blueprints/**` للمستخدمين النهائيين.

اكتب كل مخطط كمجموعة تعليمات لوكيل الترميز بدون سياق آخر. يحتوي المخطط الجيد على:

1. **هدف من سطر واحد** وإطار "أنت وكيل ترميز في تطبيق أصلي للوكيل، قم بتطبيق ذلك كإطار تغييرات المصدر الحقيقي".
2. **اقرأ أولاً** — الملفات المحددة التي تشكل_العقد.
3. **الملفات التي يجب لمسها** — المسارات الملموسة وما يفعله كل تغيير.
4. **قواعد إطار العمل التي يجب احترامها** — actions-أولاً، لا توجد أسرار مضمنة، نطاق البيانات القابلة للامتلاك، أضف مجموعة تغييرات لمصدر الحزمة القابلة للنشر.
5. **التحقق** — فحص الكتابة، وفحص `*.spec.ts` المركز، والفحص الشامل.

> [!TIP]
> لا يحتاج المخطط الجديد المنسق ضمن نوع موجود إلى تعليمات برمجية - ولكن إذا قمت بإنشاء دليل نوع جديد تمامًا، فسيظهر هذا النوع في `--list` تلقائيًا أيضًا.

## ما هي الخطوة التالية

- [**Sandbox Adapters**](/docs/sandbox-adapters) — خط التماس الذي يستهدفه مخطط `add sandbox docker`
- [**Actions**](/docs/actions) — المصدر الوحيد للحقيقة الذي يبني عليه كل مخطط
- [**External Agents**](/docs/external-agents) — توصيل وكيل الترميز الذي تقوم بتوجيه المخططات إليه
