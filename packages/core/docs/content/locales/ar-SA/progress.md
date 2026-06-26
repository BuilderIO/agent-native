---
title: "التقدم"
description: "إشارة تقدم مباشرة لمهام الوكيل طويلة الأمد - البدء والتحديث والإكمال"
---

# التقدم

يجب ألا تختبئ مهام الوكيل الطويلة خلف القرص الدوار. يوفر `progress_runs` للوكيل طريقة للإعلان _"أنا أعمل على هذا، لقد انتهيت من 45%، إليك الخطوة الحالية"_ - والتي يعرضها UI كدرج تشغيل عائم مع شريط نسبة مئوية.

```ts
import {
  startRun,
  updateRunProgress,
  completeRun,
} from "@agent-native/core/progress";

const run = await startRun({
  owner: "steve@builder.io",
  title: "Triage 128 unread emails",
  step: "Fetching inbox",
});

for (let i = 1; i <= total; i++) {
  await updateRunProgress(run.id, run.owner, {
    percent: Math.round((i / total) * 100),
    step: `Classifying ${i}/${total}`,
  });
}

await completeRun(run.id, run.owner, "succeeded");
```

قلق منفصل عن [notifications](/docs/notifications): يتم تشغيل الإشعارات مرة واحدة (_"حدث X"_)، والتقدم هو حالة مستمرة (_"تم الانتهاء من X بنسبة 45%"_). يقوم التأليفان — `completeRun` متبوعًا بـ `notify(..., severity: "info")` بإخبار المستخدم عند انتهاء العمل حتى لو لم يكن يشاهد الدرج.

## دورة الحياة {#lifecycle}

| الحالة      | الانتقال                           |
| ----------- | ---------------------------------- |
| `running`   | الأولي — تم ضبطه بواسطة `startRun` |
| `succeeded` | محطة المسار السعيد                 |
| `failed`    | خطأ في المحطة                      |
| `cancelled` | تمت مقاطعة المستخدم                |

```an-diagram title="تشغيل دورة الحياة" summary="startRun يفتح صفًا قيد التشغيل؛ updateRunProgress يصححه؛ completeRun ينقله إلى حالة طرفية واحدة ويختم completed_at."
{
  "html": "<div class=\"diagram-run\"><div class=\"diagram-box\" data-rough>startRun()</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel running\" data-rough><span class=\"diagram-pill accent\">running</span><small class=\"diagram-muted\">updateRunProgress() &#8635; percent + step</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col terminal\"><span class=\"diagram-pill ok\">succeeded</span><span class=\"diagram-pill warn\">failed</span><span class=\"diagram-pill\">cancelled</span><small class=\"diagram-muted\">completeRun() &rarr; sets completed_at</small></div></div>",
  "css": ".diagram-run{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-run .diagram-panel{display:flex;flex-direction:column;gap:6px;padding:12px 16px}.diagram-run .terminal{display:flex;flex-direction:column;gap:6px;align-items:flex-start}.diagram-run .diagram-arrow{font-size:22px;line-height:1}"
}
```

تم ضبط الحالات الطرفية على `completed_at`. يعرض درج UI صفوف `running` فقط؛ تبقى الصفوف المكتملة في قاعدة البيانات لاستعلامات `action=list`.

## API {#api}

### `startRun(input)` {#start}

إنشاء جولة. تقوم بإرجاع `AgentRun` الكامل بالمعرف الذي تم إنشاؤه.

```ts
const run = await startRun({
  owner: "steve@builder.io",
  title: "Ingest 1M rows",
  step: "Opening CSV",
  metadata: { jobId: "abc123", artifactPath: "s3://..." },
});
```

ينبعث `run.progress.started` على ناقل الحدث.

### `updateRunProgress(id, owner, input)` {#update}

قم بتصحيح أي حقل للتشغيل الجاري. أي حقل محذوف يبقى دون تغيير.

```ts
await updateRunProgress(run.id, run.owner, {
  percent: 75,
  step: "Writing to target DB",
});
```

ينبعث `run.progress.updated` على ناقل الحدث. إرجاع `AgentRun` المحدث، أو `null` إذا لم يكن التشغيل موجودًا أو لم يكن مملوكًا للمتصل.

### `completeRun(id, owner, status, extras?)` {#complete}

الانتقال إلى حالة المحطة الطرفية. `succeeded` يعين ضمنيًا `percent=100`.

```ts
await completeRun(run.id, run.owner, "succeeded", {
  step: "All 1M rows ingested",
  metadata: { totalDurationMs: 98_123 },
});
```

يُصدر أيضًا `run.progress.updated` بالحالة الطرفية.

### قائمة {#list}

```ts
import { listRuns, getRun, deleteRun } from "@agent-native/core/progress";

const active = await listRuns("steve@builder.io", { activeOnly: true });
const run = await getRun("run-id", "steve@builder.io");
await deleteRun("run-id", "steve@builder.io");
```

## HTTP API {#http}

تم تركيبه على `/_agent-native/runs/*` بواسطة البرنامج الإضافي للمسارات الأساسية. **للقراءة فقط عبر HTTP** — تمر عمليات الكتابة عبر أدوات الوكيل نظرًا لأن الوكيل هو الكاتب الأساسي. جميع المسارات مخصصة للمالك.

| الطريقة  | المسار                            |
| -------- | --------------------------------- |
| `GET`    | `/_agent-native/runs?active=true` |
| `GET`    | `/_agent-native/runs/:id`         |
| `DELETE` | `/_agent-native/runs/:id`         |

```an-api title="قائمة عمليات التشغيل النشطة" method="GET" path="/_agent-native/runs"
{
  "method": "GET",
  "path": "/_agent-native/runs",
  "summary": "List the caller's runs. The RunsTray polls this with active=true.",
  "description": "Read-only and owner-scoped — every row has an `owner` column and every query filters on it, so callers only ever see their own runs. Writes (start/update/complete) go through the agent's `manage-progress` tool, not HTTP.",
  "auth": "Session cookie (owner-scoped)",
  "params": [
    { "name": "active", "in": "query", "type": "boolean", "required": false, "description": "When true, returns only `running` rows." }
  ],
  "responses": [
    { "status": "200", "description": "Array of AgentRun rows owned by the caller." }
  ]
}
```

## مكون UI {#ui}

```tsx
import { RunsTray } from "@agent-native/core/client/progress";

export function HeaderBar() {
  return (
    <header className="flex items-center gap-2">
      {/* … */}
      <RunsTray />
    </header>
  );
}
```

أداة الرأس المضمّنة - قم بتثبيتها بجوار جرس الإشعارات. يظهر رمز القرص الدوار + شارة العد عندما تكون عمليات التشغيل نشطة؛ يؤدي النقر إلى فتح قائمة منسدلة تحتوي على شريط نسبة مئوية مباشر واحد لكل تشغيل. يخفي المشغل بالكامل في حالة عدم وجود عمليات تشغيل نشطة. استطلاعات الرأي `/_agent-native/runs?active=true` كل `pollMs` (افتراضي 3 ثوانٍ). يستخدم الرموز الدلالية shadcn، ويتكيف مع السمات الفاتحة والداكنة.

## أداة الوكيل {#agent-tool}

يتم تسجيل أداة `manage-progress` واحدة في كل قالب. تحدد المعلمة `action` العملية:

| الإجراء    | الغرض                                                   |
| ---------- | ------------------------------------------------------- |
| `start`    | الاتصال بأعلى مهمة طويلة. تقوم بإرجاع معرف التشغيل.     |
| `update`   | اتصل بشكل دوري أثناء المهمة بـ `percent` و/أو `step`.   |
| `complete` | المحطة — إحدى `succeeded`، `failed`، `cancelled`.       |
| `list`     | فحص عمليات التشغيل الأخيرة (التصفية حسب `active=true`). |

### متى يبدأ الجري {#when-to-start}

- استخدمه لأي شيء > ~5 ثوانٍ. الدوار الذي لا يحتوي على سياق يبدو متجمدًا.
- يتم التحديث عند نقاط التفتيش الطبيعية، وليس في كل تكرار. كل 5-10% كثير.
- **دائمًا** اتصل بـ `manage-progress` باستخدام `action=complete`، بما في ذلك مسارات الأخطاء. صف `running` اليتيم أسوأ من عدم وجود صف.
- قم بالإقران مع `notify` عند الانتهاء حتى يرى المستخدم النتيجة عندما لا يشاهد الدرج بشكل نشط.

## حافلة الأحداث {#event-bus}

ينبعث حدثان على [event bus](/docs/automations#event-bus):

| الحدث                  | الحمولة                            |
| ---------------------- | ---------------------------------- |
| `run.progress.started` | `{ runId, title, step? }`          |
| `run.progress.updated` | `{ runId, percent, step, status }` |

يمكن لـ [Automations](/docs/automations) الاشتراك في هذه — على سبيل المثال، _"إذا استغرق التشغيل وقتًا أطول من 5 دقائق، فأخبرني"_:

```yaml
---
triggerType: event
event: run.progress.updated
condition: "status is failed"
mode: agentic
---
إشعار me that run {{runId}} has failed.
```

## كيفية العمل {#internals}

- **نطاق المالك** — يحتوي كل صف على عمود `owner`؛ يتم تصفية كل استعلام عليه. يرى المستخدمون عمليات التشغيل الخاصة بهم فقط.
- **تكامل الاستقصاء** — تستدعي كل طفرة `recordChange()`, لذا يتم إبطال صحة القوالب التي تستخدم [`useDbSync`](/docs/client) تلقائيًا دون أي أسلاك إضافية.
- **اسم الجدول** — يحتوي إطار العمل أيضًا على جدول `agent_runs` لتتبع دورة حياة دورة حياة الوكيل الداخلي للدردشة. يستخدم التقدم البدائي `progress_runs` للفصل بين الاهتمامين.
- **تثبيت النسبة المئوية** — يتم تثبيت القيم على `[0, 100]` وتقريبها إلى عدد صحيح عند الكتابة.

## ما هي الخطوة التالية

- [**Notifications**](/docs/notifications) — قم بالاقتران مع `manage-progress` (`action=complete`) لإخبار المستخدم عند انتهاء العمل
- [**Automations**](/docs/automations) — يعمل جهاز المراقبة ببطء عبر `run.progress.updated`
- [**Client**](/docs/client) — `useDbSync` لإبطال ذاكرة التخزين المؤقت في الوقت الفعلي
