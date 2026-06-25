---
title: "قابلية الملاحظة"
description: "تتبعات الوكيل، وعمليات التقييم، والتعليقات، وتجارب A/B، ولوحة التحكم المضمنة - كل ذلك بدون أي تكوين."
---

# إمكانية ملاحظة الوكيل

يحصل كل تطبيق أصلي للوكيل على إمكانية المراقبة خارج الصندوق. تعمل عمليات التتبع والتقييمات التلقائية وتعليقات المستخدمين وتجارب A/B بدون تكوين - حيث تظل جميع البيانات موجودة في قاعدة بيانات SQL الخاصة بالتطبيق.

تغطي هذه الصفحة مقاييس *جودة*الوكيل: التتبعات والتكلفة والتقييمات والتعليقات المخزنة في قاعدة بياناتك. بالنسبة لتحليلات _product_ (أحداث تطبيقك التي تتدفق إلى PostHog/Mixpanel/Amplitude)، راجع [Tracking](/docs/tracking).

## ثلاثة أشياء تسمى "التقييمات"/"قابلية الملاحظة" — ما الذي أريده؟ {#which}

من السهل الخلط بين هذه الصفحات الثلاث. اختر السؤال الذي تطرحه:

| الصفحة                                                           | السؤال الذي يجيب عليه                                  | عند تشغيله                          | قلق            |
| ---------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------- | -------------- |
| **تقييمات إمكانية الملاحظة** (هذه الصفحة، علامة التبويب _Evals_) | "كيف كان أداء عمليات الإنتاج الحقيقية؟"                | سلبي، بعد كل جولة (عينة القاضي LLM) | الجودة         |
| **[CI Eval Gate](/docs/evals)** (`*.eval.ts`)                    | "هل يفعل الوكيل الشيء الصحيح بشأن هذا الإدخال الثابت؟" | بوابة CI/نشر نشطة وحتمية            | الجودة         |
| **[Observational Memory](/docs/observational-memory)**           | "هل يظل هذا الخيط الطويل رخيصًا وداخل النافذة؟"        | ضغط الخلفية على المواضيع الطويلة    | التكلفة/السياق |

تسجل كل من إمكانية المراقبة وبوابة تقييم CI _الجودة_ ولكن من طرفين متعاكسين - تسجيل سلبي لاحق لحركة المرور الحقيقية مقابل عمليات فحص النجاح/الفشل النشطة على المدخلات الثابتة. ذاكرة الملاحظة لا علاقة لها بالجودة؛ يتعلق الأمر بتكلفة الرمز المميز وضغط نافذة السياق.

## ما يتم التقاطه تلقائيًا {#captured}

عندما يرسل المستخدم رسالة، يسجل الإطار تلقائيًا:

- **استخدام الرمز المميز** — الإدخال والإخراج وذاكرة التخزين المؤقت للقراءة والكتابة في ذاكرة التخزين المؤقت
- **التكلفة** — يتم حسابها من أعداد الرموز المميزة وتسعير النماذج
- **زمن الوصول** — إجمالي المدة والوقت لكل استدعاء للأداة
- **استدعاءات الأداة** — التي تم استدعاء actions، وحالة النجاح/الخطأ، والمدة
- **التقييمات التلقائية** — يتم حساب 5 نقاط جودة بعد كل جولة

لا يلزم إجراء تغييرات على التعليمات البرمجية. يتم ربط الأجهزة بـ `production-agent.ts` بشفافية.

```an-diagram title="كل شوط يغذي الحلقة" summary="ينتج عن تشغيل وكيل واحد تتبعًا ونتائج تلقائية وخطافًا للتعليقات - يتم تخزين كل ذلك في SQL الخاص بالتطبيق ويظهر على لوحة المعلومات. تقوم التجارب بتقسيم حركة المرور عبر متغيرات التكوين."
{
  "html": "<div class=\"obs-loop\"><div class=\"diagram-node\">تشغيل الوكيل<br><small class=\"diagram-muted\">production-agent.ts</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">يلتقط تلقائيا</span><small class=\"diagram-muted\">tokens &middot; cost &middot; latency &middot; tool calls</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Traces &amp; spans</div><div class=\"diagram-box\">Evals (5 scorers + LLM judge)</div><div class=\"diagram-box\">Feedback &amp; frustration index</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node ok\">Dashboard<br><small class=\"diagram-muted\">scoped to the signed-in user</small></div></div>",
  "css": ".obs-loop{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.obs-loop .diagram-col{display:flex;flex-direction:column;gap:8px}.obs-loop .diagram-arrow{font-size:22px;line-height:1}.obs-loop .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## لوحة التحكم {#dashboard}

أضف لوحة التحكم إلى أي قالب بمسار واحد:

```tsx
// app/routes/observability.tsx
import { ObservabilityDashboard } from "@agent-native/core/client";

export default function ObservabilityPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <ObservabilityDashboard />
    </div>
  );
}
```

يتم تحديد نطاق كافة البيانات للمستخدم الذي قام بتسجيل الدخول؛ لا يوجد عرض إداري عبر المستخدمين اليوم.

تحتوي لوحة التحكم على 5 علامات تبويب:

| علامة التبويب | ما يعرضه                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------- |
| **نظرة عامة** | المقاييس الرئيسية - التشغيل، والتكلفة، ووقت الاستجابة، ومعدل نجاح الأداة، والرضا، ودرجة التقييم |
| **المحادثات** | تتبع القائمة مع الانتقال إلى النطاقات الفردية (agent_run، llm_call، tool_call)                  |
| **التقييمات** | نتائج التقييم الآلي حسب المعايير والاتجاهات مع مرور الوقت                                       |
| **التجارب**   | قائمة اختبار A/B مع شارات الحالة، ونتائج متغيرة مع فواصل الثقة                                  |
| **التعليقات** | إبداء الإعجاب لأعلى/لأسفل، تصنيف الفئات، درجات الإحباط                                          |

## تعليقات المستخدم {#feedback}

### تعليقات صريحة

تظهر أزرار إبهام لأعلى/لأسفل مضمنة في كل رسالة وكيل في الدردشة UI. يؤدي الإبهام لأسفل إلى فتح نافذة منبثقة للفئة (غير دقيقة، غير مفيدة، أداة خاطئة، بطيئة جدًا). يتم توصيل هذا إلى `AssistantChat.tsx` تلقائيًا.

### تعليقات ضمنية (مؤشر الإحباط)

يحسب إطار العمل مؤشر الإحباط (0-100) من إشارات المحادثة:

| إشارة                | الوزن | ما يكتشفه                              |
| -------------------- | ----- | -------------------------------------- |
| إعادة الصياغة        | 30%   | يكرر المستخدم رسائل مشابهة             |
| إعادة محاولة الأنماط | 20%   | "حاول مرة أخرى"، "لا، هذا خطأ"         |
| الهجر                | 20%   | تنتهي الجلسة بعد وقت قصير من الاستجابة |
| المشاعر              | 15%   | أنماط اللغة السلبية                    |
| اتجاه الطول          | 15%   | تناقص طول الرسالة                      |

تفسير النتيجة: 0-20 = صحي، 20-40 = احتكاك، 40-60 = غير راض، 60+ = جلسة معطلة.

## التقييمات الآلية {#evals}

يتم تشغيل خمسة مسجلين محددين بعد كل تشغيل للعميل:

| المعايير            | ما يقيسه                                                  | نطاق النتائج |
| ------------------- | --------------------------------------------------------- | ------------ |
| `tool_success_rate` | % من استدعاءات الأداة بدون أخطاء                          | 0-1          |
| `step_efficiency`   | يعاقب تكرارات LLM المفرطة لعمليات التشغيل باستخدام الأداة | 0-1          |
| `latency_score`     | تمت التسوية مقابل 10 ثوانٍ/خط الأساس للأداة               | 0-1          |
| `cost_efficiency`   | تمت التسوية مقابل خط الأساس للتكلفة                       | 0-1          |
| `error_recovery`    | هل تعافى الوكيل من أخطاء الأداة؟                          | 0 أو 1       |

### LLM-كقاضي (اختياري)

تمكين التقييم المستند إلى LLM لعينات من خلال إعداد `evalSampleRate`:

```ts
import { putSetting } from "@agent-native/core/settings";

await putSetting("observability-config", {
  enabled: true,
  evalSampleRate: 0.05, // 5% of runs
});
```

تستخدم المعايير المخصصة قواعد اللغة الطبيعية:

```ts
const criteria = {
  name: "helpfulness",
  description: "Was the response helpful and complete?",
  rubric: "0.0 = unhelpful, 0.5 = partially helpful, 1.0 = fully resolved",
};
```

## تجارب أ/ب {#experiments}

اختبر نماذج مختلفة، أو درجات حرارة، أو تكوينات وكيل:

```ts
// Create via API
POST /_agent-native/observability/experiments
{
  "name": "model-a-vs-b",
  "variants": [
    { "id": "control", "weight": 50, "config": { "model": "<your-model-id>" } },
    { "id": "treatment", "weight": 50, "config": { "model": "<other-model-id>" } }
  ],
  "metrics": ["cost", "latency", "satisfaction"]
}

// Start the experiment
PUT /_agent-native/observability/experiments/:id
{ "status": "running" }
```

استخدم معرفات الطراز الحقيقية التي يقبلها محركك بدلاً من `<your-model-id>` / `<other-model-id>` (تتغير أسماء الطرازات كثيرًا - تحقق من الموفر/المحرك الخاص بك لمعرفة المعرفات الحالية). تعمل حلقة الوكيل تلقائيًا على حل متغير المستخدم وتطبيق تجاوز التكوين. تستخدم المهمة تجزئة متسقة — يحصل المستخدم نفسه دائمًا على نفس المتغير.

```an-diagram title="تعيين متغير التجزئة المتسق" summary="يقوم كل مستخدم بالتجزئة إلى متغير ثابت، وتطبق الحلقة تجاوز تكوين هذا المتغير، ويتم عرض النتائج لكل متغير مع فواصل الثقة."
{
  "html": "<div class=\"exp\"><div class=\"diagram-node\">معرف المستخدم<br><small class=\"diagram-muted\">تجزئة متسقة</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-card\"><span class=\"diagram-pill\">control &middot; 50%</span><small class=\"diagram-muted\">تجاوز التكوين أ</small></div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">treatment &middot; 50%</span><small class=\"diagram-muted\">تجاوز التكوين ب</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">النتائج لكل متغير<br><small class=\"diagram-muted\">cost &middot; latency &middot; satisfaction</small></div></div>",
  "css": ".exp{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.exp .diagram-col{display:flex;flex-direction:column;gap:8px}.exp .diagram-card{display:flex;flex-direction:column;gap:2px;padding:8px 12px}.exp .diagram-arrow{font-size:22px;line-height:1}"
}
```

## التكوين {#config}

يتم تخزين كافة الإعدادات في مفتاح `observability-config`:

```ts
{
  enabled: true,           // Master switch
  capturePrompts: false,   // Store prompt content in traces
  captureToolArgs: false,  // Store action input arguments
  captureToolResults: false, // Store action results
  evalSampleRate: 0,       // 0-1, fraction of runs to LLM-judge
  exporters: []            // OTLP export targets
}
```

```an-callout
{
  "tone": "info",
  "body": "Content is **redacted by default** — only token counts, costs, and timing are stored. `capturePrompts`, `captureToolArgs`, and `captureToolResults` are opt-in; turn them on only when you need prompt/argument content for debugging."
}
```

## نقاط نهاية API {#api}

جميعها مثبتة تلقائيًا في `/_agent-native/observability/`:

| الطريقة | المسار                     | الغرض                               |
| ------- | -------------------------- | ----------------------------------- |
| GET     | `/`                        | نظرة عامة على الإحصائيات            |
| GET     | `/traces`                  | سرد ملخصات التتبع                   |
| GET     | `/traces/:runId`           | تتبع التفاصيل (الملخص + الامتدادات) |
| GET     | `/traces/:runId/evals`     | تقييمات التشغيل                     |
| POST    | `/feedback`                | إرسال تعليقات                       |
| GET     | `/feedback`                | إدراج التعليقات                     |
| GET     | `/feedback/stats`          | تجميع التعليقات                     |
| GET     | `/satisfaction`            | نتائج الرضا                         |
| GET     | `/evals/stats`             | إحصائيات التقييم                    |
| POST    | `/experiments`             | إنشاء تجربة                         |
| GET     | `/experiments`             | سرد التجارب                         |
| GET     | `/experiments/:id`         | الحصول على تفاصيل التجربة           |
| PUT     | `/experiments/:id`         | تحديث التجربة                       |
| POST    | `/experiments/:id/results` | حساب النتائج                        |
| GET     | `/experiments/:id/results` | الحصول على النتائج                  |

تدعم جميع نقاط النهاية `?since=N` (الطابع الزمني مللي ثانية) ومعلمات الاستعلام `?limit=N`.

## التصدير إلى منصات خارجية {#export}

أرسل آثارًا إلى Langfuse، أو Datadog، أو Grafana، أو أي واجهة خلفية متوافقة مع OTel:

```ts
await putSetting("observability-config", {
  enabled: true,
  exporters: [
    {
      type: "otlp",
      endpoint: "https://cloud.langfuse.com/api/public/otel",
      headers: { Authorization: "Bearer sk-..." },
    },
  ],
});
```

يصدر إطار العمل امتدادات اصطلاحات دلالية `gen_ai.*` متوافقة مع مواصفات OpenTelemetry GenAI.

## امتدادات القياس عن بعد المفتوحة {#otel}

بشكل منفصل عن تكوين `exporters` أعلاه (الذي يشحن التتبعات الداخلية إلى نقطة نهاية OTLP)، يمكن لحلقة الوكيل أيضًا إصدار **امتدادات OpenTelemetry المباشرة** لكل تشغيل واستدعاء نموذج واستدعاء أداة — بحيث يرى المضيف الذي يقوم بالفعل بتشغيل مجمع OTel نشاط الوكيل جنبًا إلى جنب مع بقية آثاره الموزعة.

هذه الطبقة **اختيارية ولا يمكن تشغيلها افتراضيًا**:

- `@opentelemetry/api` هي **تبعية اختيارية**. إذا لم يتم تثبيته، فإن المساعدين يتدهورون إلى عدم إجراء عمليات صامتة - لا يوجد شيء هنا على الإطلاق يدخل في حلقة الوكيل.
- حتى عندما تكون حزمة واجهة برمجة التطبيقات \_ موجودة، فإنها تشحن أداة تتبع افتراضية بدون تشغيل. تصبح الامتدادات حقيقية فقط بمجرد قيام **المضيف بتسجيل `TracerProvider`** (عبر `@opentelemetry/sdk-node` أو ما شابه ذلك). لا يعتمد إطار العمل عمدًا **لا** على حزم SDK/المصدرين الثقيلة أو يقوم بتسجيل الموفر نفسه - يتم الاشتراك في الأجهزة من خلال تطبيق التضمين.

لذا فإن التكلفة عند عدم توصيل OTel هي بضع قراءات للخصائص المخزنة مؤقتًا لكل مكالمة. لتشغيله، قم بتثبيت حزمة API بالإضافة إلى SDK الخاص بك وقم بتسجيل المزود عند بدء تشغيل الخادم بنفس الطريقة التي تفعلها مع أي خدمة Node أخرى.

تصدر حلقة الوكيل ثلاثة أنواع من الامتداد:

| امتداد      | متى                         | السمات                                                            |
| ----------- | --------------------------- | ----------------------------------------------------------------- |
| `agent.run` | مرة واحدة لكل وكيل          | `agent.run_id`, `agent.thread_id`, `agent.user_id`, `agent.model` |
| `tool.call` | مرة واحدة لكل استدعاء إجراء | `tool.name`، بالإضافة إلى حالة النجاح/الخطأ                       |
| `llm.call`  | لكل مكالمة نموذجية          | التوقيت + حالة موافق/خطأ                                          |

تم الانتهاء من الامتدادات بحالة OK/ERROR وتسجيل رسالة الخطأ عند الفشل. يتم تقليم قيم السمات الصفرية/الحارسة حتى لا تزدحم الامتدادات بالضوضاء. تعتبر طبقة OTel هذه إضافة بحتة إلى جداول `agent_trace_spans` / `agent_trace_summaries` الداخلية التي تعمل على تشغيل لوحة المعلومات أعلاه - وكلاهما يتم إنتاجهما من نفس أحداث التشغيل.

## الإبلاغ عن الأخطاء (Sentry) {#sentry}

يتم الإبلاغ عن الأخطاء من جانب الخادم التي تهرب من معالجات التوجيه Nitro إلى Sentry عند تكوين DSN. بدونها، لا توجد عمليات لـ SDK بصمت، لذلك من الآمن ترك env vars بدون ضبط في dev. يمكن أن تنتقل أحداث المتصفح والخادم إلى نفس مشروع Sentry؛ قم بتقسيمها إلى مشاريع منفصلة فقط عندما تريد الفصل التشغيلي للملكية أو الحجم أو الحصص أو توجيه التنبيه.

| السطح              | SDK               | إنف فار                                                           | ملاحظات                                                                          |
| ------------------ | ----------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| المتصفح / SPA      | `@sentry/browser` | `VITE_SENTRY_CLIENT_DSN`، أو `SENTRY_CLIENT_DSN`، أو `SENTRY_DSN` | يلتقط الأخطاء التي لم تتم معالجتها ومسارات التنقل لتغيير المسار في العميل.       |
| خادم Nitro         | `@sentry/node`    | `SENTRY_SERVER_DSN` أو `SENTRY_DSN`                               | يلتقط استجابات 5xx وأخطاء دورة حياة Nitro. مستخدم لكل طلب.                       |
| `agent-native` CLI | `@sentry/node`    | _hardcoded_                                                       | تقارير الأعطال من الإصدار الثنائي CLI المنشور؛ غير قابل للتكوين بواسطة المستخدم. |

### التكوين من جانب الخادم {#sentry-config}

قم بتعيين `SENTRY_SERVER_DSN` أو `SENTRY_DSN` المشترك في بيئة النشر (لوحة تحكم Netlify، أسرار Cloudflare، وما إلى ذلك). يقوم إطار العمل تلقائيًا بتثبيت المكون الإضافي Nitro الذي:

1. استدعاء `Sentry.init` مرة واحدة عند بدء التشغيل (غير فعال - آمن للاتصال من مكونات إضافية متعددة).
2. حل مشكلة المستخدم عبر `getSession(event)` في كل طلب API/إطار العمل وإرفاق `id` / `email` / `username` بالإضافة إلى علامة `orgId` بنطاق عزل Sentry لكل طلب. يتم تخطي مسارات الأصول الثابتة لتجنب زيارات قاعدة البيانات الإضافية.
3. يلتقط كل مسار إطار عمل 5xx مع علامات `route` و`method` و`userAgent` القابلة للبحث.

المقابض الاختيارية:

- `SENTRY_SERVER_TRACES_SAMPLE_RATE` (عائم `0`–`1`) — الاشتراك في تتبع الأداء. الإعدادات الافتراضية هي `0` (الأخطاء فقط). يتم تثبيت القيم غير الصالحة على `0`.
- `AGENT_NATIVE_RELEASE` — يتجاوز علامة `release`. الإعدادات الافتراضية هي `agent-native-server@<core-version>`.

### القوالب

يرث كل قالب هذا تلقائيًا - ولا يوجد شيء لاستيراده. بالنسبة لتطبيقات SSR، يقوم الخادم بإدخال برنامج نصي صغير لتكوين المتصفح عندما يكون `SENTRY_CLIENT_DSN` أو `VITE_SENTRY_CLIENT_DSN` أو `SENTRY_DSN` المشترك متاحًا في وقت التشغيل، لذلك لا يقتصر التقاط المتصفح على بيئة وقت البناء Vite. يمكن للنماذج التي تريد سلوكًا مخصصًا (علامات إضافية، DSN مختلفة لكل قالب، Sentry الذي يمكن تعطيله بشدة) أن تتجاوزها عن طريق تصدير المكون الإضافي الخاص بها من `server/plugins/sentry.ts`:

```ts
// server/plugins/sentry.ts
import { createSentryPlugin } from "@agent-native/core/server";
export default createSentryPlugin();
```

إن DSN المضمن في CLI مقصود - فالاحتياجات الثنائية المنشورة لتعطل هاتف المنزل بغض النظر عن البيئة التي تديره. لا تقوم وحدة الخادم أبدًا بترميز DSN بشكل ثابت لأنها تعمل داخل بيئات العملاء حيث يقرر المشغلون ما إذا كان يجب أن تصل الأخطاء إلى Sentry على الإطلاق.

### الخصوصية وPII {#privacy}

يتم تهيئة كل من الخادم وCLI باستخدام `sendDefaultPii: false` وخطاف `beforeSend` الذي يزيل:

- `request.headers.authorization`, `cookie`, `set-cookie`, `proxy-authorization`
- `request.cookies`
- `user.ip_address` (يتم جمعها تلقائيًا بدون موافقة)
- `contexts.runtime_env` (لقطة بيئة العملية)
- أي حدث يكون نوع استثناء المستوى الأعلى له هو `ValidationError` (يتم التعامل معه على أنه رفض متوقع لإدخال المستخدم، وليس خطأ).

يتم الاحتفاظ بحقول الهوية التي تم تعيينها بشكل صريح عبر `setUser({ id, email, username })`.

## ما هي الخطوة التالية

- [**Tracking**](/docs/tracking) — تحليلات المنتج (PostHog، Mixpanel، Amplitude) لأحداث تطبيقك الخاصة
- [**Actions**](/docs/actions) — العمليات التي تظهر كاستدعاءات أداة في التتبع
- [**Security**](/docs/security) — تحديد نطاق البيانات ومعالجة بيانات الاعتماد
