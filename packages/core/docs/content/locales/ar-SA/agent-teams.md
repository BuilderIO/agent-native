---
title: "فرق الوكلاء"
description: "يعمل مفوضو الوكلاء الرئيسيون مع الوكلاء الفرعيين الذين يعملون في سلاسل الرسائل الخاصة بهم ويظهرون كشرائح معاينة مباشرة مضمنة في الدردشة."
---

# فرق الوكلاء

إن دردشة الوكيل هي **منسقة** وليست كتلة واحدة. عندما يقوم الوكيل الرئيسي بمهمة من الأفضل أن يمتلكها أحد المتخصصين - "اكتب هذه الرسالة الإلكترونية بصوتي"، "قم بإجراء تحليل BigQuery"، "مراجعة العلاقات العامة هذه" - فإنه يولد وكيلًا فرعيًا في سلسلة الرسائل والأدوات والسياق الخاصة به. يظهر الوكيل الفرعي كمعاينة مباشرة **شريحة** مضمنة في الدردشة الرئيسية؛ انقر عليه لفتح المحادثة الكاملة كعلامة تبويب.

يحافظ هذا على تركيز الموضوع الرئيسي، ويسمح للوكلاء الفرعيين بالعمل بالتوازي، ويمنحك مسار تدقيق نظيف لأي عمل مفوض.

يتم تشغيل فرق الوكلاء على مدير التشغيل الأساسي: حيث يتم بث الأحداث واستمرارها، ويتم نشر عمليات الإلغاء عبر SQL، وتظل المهام على قيد الحياة عند البدء البارد بدون خادم.

## النموذج العقلي {#mental-model}

- **الدردشة الرئيسية** — المنسق. يقرأ طلبك، المندوبين. نادرًا ما يؤدي العمل الشاق بحد ذاته.
- **الوكلاء الفرعيون** — يتم تشغيلهم باستخدام سلسلة الرسائل الخاصة بهم، وموجه النظام الخاص بهم، ومجموعة الأدوات الخاصة بهم. يتم تعيين كل منها إلى ملف تعريف "الوكيل المخصص" في [workspace](/docs/workspace).
- **الرقائق** — بطاقة المعاينة الغنية التي تظهر مضمنة في الدردشة الرئيسية، وتعرض الخطوة الحالية للوكيل الفرعي، ومخرجات البث، والملخص النهائي. تم طيها بشكل افتراضي؛ يتم توسيعه إلى المحادثة الكاملة عند النقر.
- **المراسلة ثنائية الاتجاه** — يمكن للوكيل الرئيسي إرسال متابعات إلى وكيل فرعي قيد التشغيل؛ يمكن للوكيل الفرعي الرد على الرسائل عندما يصل إلى نقطة غامضة.

تستمر حالة الوكيل الفرعي في جدول `application_state` SQL (ضمن `agent-task:<taskId>`)، لذلك تظل المهام قادرة على البقاء على قيد الحياة مع عمليات التشغيل الباردة بدون خادم والعمل عبر عمليات متعددة.

```an-diagram title="المنسقين والمتخصصين" summary="تقوم الدردشة الرئيسية بتفويض الوكلاء الفرعيين الذين يعملون في سلاسل الرسائل الخاصة بهم ويقدمون تقاريرهم كشرائح مضمنة."
{
  "html": "<div class=\"at-orc\"><div class=\"diagram-card main\"><span class=\"diagram-pill accent\">الدردشة الرئيسية</span><small class=\"diagram-muted\">منسق &mdash; يقرأ طلبك، المندوبين</small></div><div class=\"at-fan\"><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"at-subs\"><div class=\"diagram-box\">مراجعة الكود<br><small class=\"diagram-muted\">الخيط الخاص &amp; اِسْتَدْعَى</small></div><div class=\"diagram-box\">تحليل BigQuery<br><small class=\"diagram-muted\">الأدوات الخاصة</small></div><div class=\"diagram-box\">البريد الإلكتروني في الصوت<br><small class=\"diagram-muted\">السياق الخاص</small></div></div></div><div class=\"diagram-pill\">يظهر كل منها مضمنًا كشريحة حية &#8635;</div></div>",
  "css": ".at-orc{display:flex;flex-direction:column;align-items:center;gap:12px}.at-orc .diagram-card{padding:14px 18px;display:flex;flex-direction:column;gap:4px;align-items:center}.at-orc .at-fan{display:flex;flex-direction:column;align-items:center;gap:8px}.at-orc .diagram-arrow{font-size:22px}.at-orc .at-subs{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}.at-orc .diagram-box{text-align:center}"
}
```

## متى يتم إنشاء وكيل فرعي {#when-to-spawn}

تفرخ عند المهمة:

- يحتاج إلى **موجه نظام** مختلف (صوت أو نغمة متخصصة، على سبيل المثال، "مراجعة الكود").
- يحتوي على سلسلة أدوات **طويلة الأمد** من شأنها تلويث السياق الرئيسي.
- يمكن تشغيله **بالتوازي** مع الأعمال الأخرى التي يقوم بها الوكيل الرئيسي.
- مملوكة من قبل **فريق مختلف** لديه بالفعل ملف تعريف وكيل مخصص.

لا تلجأ إلى عمل تافه لمرة واحدة - قم باستدعاء الإجراء مباشرة.

## استدعاء وكيل فرعي {#invoking}

ثلاث طرق لبدء وكيل فرعي، من الأقل إلى الأكثر وضوحًا:

### 1. `@mention` وكيل مخصص {#mention}

يكتب المستخدم `@agent-name` في مؤلف الدردشة. تظهر قائمة منسدلة للوكلاء الفرعيين لمساحة العمل. يؤدي اختيار واحدة إلى إدراج شريحة؛ عند الإرسال، يقوم الوكيل الرئيسي بتفويض الرسالة إلى ذلك الوكيل الفرعي.

يعيش الوكلاء المخصصون في مساحة العمل في `agents/<slug>.md` - ملف Markdown مع المادة الأمامية YAML. راجع [Custom Agents](/docs/workspace#custom-agents) لمعرفة التنسيق.

### 2. يقوم الوكيل الرئيسي بالتفويض تلقائيًا {#auto-delegate}

يمنح إطار العمل الوكيل الرئيسي أداة `agent-teams`. عندما يقرر النموذج أن المهمة تناسب ملف تعريف وكيل فرعي مسجل، فإنه يستدعي الأداة باستخدام `action: "spawn"` ومعلمة `agent` اختيارية لتسمية ملف تعريف من `agents/*.md`. تظهر شريحة؛ يعمل الوكيل الفرعي. ينتظر الوكيل الرئيسي (أو يتحرك بالتوازي) ويدمج النتيجة عندما ينتهي الوكيل الفرعي.

مجموعة إجراءات `agent-teams` الكاملة هي:

| الإجراء       | الغرض                                    |
| ------------- | ---------------------------------------- |
| `spawn`       | ابدأ مهمة وكيل فرعي جديدة                |
| `status`      | التحقق من تقدم الوكيل الفرعي قيد التشغيل |
| `read-result` | احصل على مخرجات الوكيل الفرعي النهائية   |
| `send`        | مراسلة وكيل فرعي قيد التشغيل             |
| `list`        | عرض كافة المهام للمستخدم الحالي          |

### 3. تفرخ برمجي {#programmatic-spawn}

بالنسبة لعمليات التكامل على مستوى إطار العمل، استخدم `spawnTask()` من `@agent-native/core/server`:

```ts
import { spawnTask } from "@agent-native/core/server";

const task = await spawnTask({
  description: "Draft an outreach email to this lead",
  instructions: "Match the user's voice from memory/MEMORY.md.",
  ownerEmail: user.email,
  systemPrompt: mailAgentSystemPrompt,
  actions: mailActions,
  // Pass either apiKey or engine — engine takes precedence.
  apiKey: process.env.ANTHROPIC_API_KEY, // optional if engine is provided
  parentSend: emit, // streaming sender for the parent chat response
});
```

لن تستدعي معظم أكواد التطبيق هذا مباشرة - حيث يقوم إطار العمل بذلك تحت غطاء `@mentions` ولأداة `agent-teams`. يمكنك الوصول إلى `spawnTask()` فقط عندما تقوم بتوصيل نقطة دخول جديدة (على سبيل المثال, زر يبدأ مهمة خلفية تعمل كوكيل فرعي).

## دورة حياة المهمة {#lifecycle}

```an-diagram title="ما يفعله spawnTask()" summary="ينشئ كل نشر سلسلة رسائل، ويستمر في الحالة إلى SQL، ويقوم بتدفق أحداث الشريحة حتى الاكتمال."
{
  "html": "<div class=\"at-life\"><div class=\"diagram-box\"><code>مهمة تفرخ ()</code></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">إنشاء موضوع</span><small class=\"diagram-muted\">صف جديد في <code>chat_threads</code>، الوصف كرسالة أولى</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">استمرار الحالة</span><small class=\"diagram-muted\"><code>مهمة الوكيل:&lt;بطاقة تعريف&gt;</code> &rarr; <code>application_state</code>الحالة = قيد التشغيل</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">تدفق</span><small class=\"diagram-muted\"><code>agent_task_started</code> &rarr; تظهر الشريحة؛ <code>agent_task_step</code> &rarr; تحديثات الشريحة مباشرة</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card ok\"><span class=\"diagram-pill ok\">مكتمل</span><small class=\"diagram-muted\">الحالة = مكتملة، اكتب ملخصًا + معاينة، انبعاث <code>agent_task_done</code></small></div></div>",
  "css": ".at-life{display:flex;flex-direction:column;align-items:stretch;gap:6px;max-width:560px}.at-life .diagram-card{display:flex;flex-direction:column;gap:3px;padding:10px 14px}.at-life .diagram-box{align-self:flex-start}.at-life .diagram-arrow{font-size:18px;align-self:center}"
}
```

في أي وقت، يمكن للوكيل الأصلي استئناف الوكيل الفرعي من خلال المتابعة عبر `sendToTask(taskId, message)`. إذا كانت أخطاء الوكيل الفرعي, فإن `markTaskErrored(taskId, reason)` يسجل الفشل ويظهره للمستخدم.

ميزة المراسلة ثنائية الاتجاه متينة. تتم متابعات الوالدين لتشغيل الوكلاء الفرعيين
يتم تسليمها خلال دورة حياة المهمة؛ إذا لم يتمكن الوكيل الفرعي من استهلاكها في
الخطوة الحالية، يجب أن تظل في قائمة الانتظار ويتم تطبيقها في مكان آمن
نقطة الاستمرار. يمكن للوكلاء الفرعيين أيضًا الرد عندما يحتاجون إلى توضيح
بدلاً من الحظر بشكل غير مرئي.

## حالة مهمة القراءة {#reading-state}

من رمز الخادم أو actions آخر:

```ts
import { getTask, listTasks } from "@agent-native/core/server";

const task = await getTask(taskId); // single task
const tasks = await listTasks(); // all tasks for the user (sorted newest first)
```

الحقول الرئيسية `AgentTask`:

```ts
interface AgentTask {
  taskId: string;
  threadId: string;
  description: string;
  status: "running" | "completed" | "errored";
  preview: string; // short one-liner for the chip
  summary: string; // full summary once completed
  currentStep: string; // latest step label (updated while running)
  createdAt: number;
  // Additional fields: parentThreadId, name, updatedAt, startedAt,
  // completedAt, runId, error
}
```

## ملفات تعريف الوكيل المخصصة {#profiles}

يتم تعيين الوكلاء الفرعيين إلى ملفات تعريف الوكلاء المخصصة — ملفات Markdown في `agents/<slug>.md` في مساحة العمل التي تظهر في القائمة المنسدلة `@mention` وتعمل كأهداف للتفويض. تمتلك [Workspace — Custom Agents](/docs/workspace#custom-agents) التنسيق الكامل (frontmatter، `tools`، `delegate-default`، تجاوزات النموذج).

## حارس عمق التفويض {#depth-guard}

يمكن للوكلاء الفرعيين إنشاء وكلاء فرعيين، وهو ما يمثل مخاطرة جامحة/تكلفة: يمكن أن تنتشر سلسلة غير محدودة من التفويضات إلى أجل غير مسمى. يفرض إطار العمل حدًا أقصى **على عمق التفويض**، من جانب الخادم، بشكل مستقل عن أي حماية على مستوى الأداة.

الدردشة ذات المستوى الأعلى هي العمق `0`. العامل الفرعي الذي يولده هو العمق `1`؛ قد يظهر هذا العامل الفرعي مرة أخرى (العمق `2`)؛ تم رفض النشر الذي من شأنه إنشاء وكيل فرعي للعمق `3` **. الحد الأقصى الافتراضي هو **2\*\*.

```an-diagram title="حارس عمق التفويض (الغطاء الافتراضي 2)" summary="قد يؤدي كل مستوى إلى ظهور مستوى أعمق حتى الغطاء؛ تفرخ الماضي تم رفضه من جانب الخادم."
{
  "html": "<div class=\"at-depth\"><div class=\"diagram-card ok\"><span class=\"diagram-pill\">العمق 0</span><strong>دردشة على أعلى مستوى</strong><small class=\"diagram-muted ok\">قد ينشئ &darr;</small></div><div class=\"diagram-card ok\"><span class=\"diagram-pill\">العمق 1</span><strong>وكيل فرعي</strong><small class=\"diagram-muted ok\">قد ينشئ &darr;</small></div><div class=\"diagram-card warn\"><span class=\"diagram-pill warn\">العمق 2</span><strong>وكيل فرعي لوكيل فرعي</strong><small class=\"diagram-muted\">عند الحد الأقصى &mdash; لا يمكنه إنشاء المزيد</small></div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">العمق 3</span><strong>مرفوض</strong><small class=\"diagram-muted\">خطأ من جانب الخادم</small></div></div>",
  "css": ".at-depth{display:flex;flex-direction:column;gap:8px}.at-depth .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.at-depth .rung-1,.at-depth .diagram-card:nth-child(2){margin-inline-start:24px}.at-depth .diagram-card:nth-child(3){margin-inline-start:48px}.at-depth .diagram-card:nth-child(4){margin-inline-start:72px}"
}
```

التنفيذ محيط: يعمل كل وكيل فرعي داخل `AsyncLocalStorage` الذي يسجل عمقه الخاص، وبالتالي فإن أي `spawnTask` يتم الوصول إليه بشكل انتقالي من هذا التشغيل يقرأ عمق الأصل الخاص به ويرفض بمجرد الوصول إلى الحد الأقصى - حتى لو تم تسليم أداة `agent-teams` إلى وكيل فرعي لا ينبغي أن يحصل عليها. يتم عرض القرار على أنه `evaluateSubagentDepth(parentDepth)` نقي وقابل للاختبار بالوحدة. يُرجع النشر المرفوض خطأً واضحًا: _"تم الوصول إلى الحد الأقصى لعمق التفويض (الحد الأقصى N)؛ لا يمكن نشر وكيل فرعي آخر."_

### تهيئة الحد الأقصى {#depth-guard-config}

تجاوز الإعداد الافتراضي في وقت النشر باستخدام `AGENT_NATIVE_MAX_SUBAGENT_DEPTH`:

| القيمة           | التأثير                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| _(إلغاء الضبط)_  | الحد الأقصى الافتراضي لـ `2`.                                                                                                            |
| `0`              | **لا يجوز إنشاء أي وكلاء فرعيين** — يقوم وكيل المستوى الأعلى بكل العمل.                                                                  |
| `1`…`16`         | أن هناك مستويات عديدة للتفويض.                                                                                                           |
| غير صالح / `>16` | تعود القيمة غير الصحيحة / السالبة / NaN إلى `2`؛ أي شيء أعلى من `16` يتم تثبيته على `16` لذا لا يمكن للخطأ المطبعي تعطيل الحماية مطلقًا. |

```bash
AGENT_NATIVE_MAX_SUBAGENT_DEPTH=1   # مسموح بالوكلاء الفرعيين، لكن لا يمكنهم التفويض من الباطن
```

عندما يصل الوكيل الفرعي إلى الحد الأقصى أو أقل منه، يقوم إطار العمل بإدخال سطر في سياق وقت التشغيل الخاص به لإخباره بمدى عمقه وما إذا كان يمكنه تفويض المزيد، وبالتالي ينفق النموذج ميزانيته بشكل مناسب.

## ما هي الخطوة التالية

- [**Workspace — Custom Agents**](/docs/workspace#custom-agents) — تنسيق الملف الشخصي
- [**A2A Protocol**](/docs/a2a-protocol) — عندما يعيش "الوكيل الفرعي" في تطبيق مختلف تمامًا
- [**Actions**](/docs/actions) — الأدوات التي يستدعيها الوكيل الفرعي
