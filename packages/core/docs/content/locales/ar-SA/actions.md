---
title: "Actions"
description: "defineAction — التعريف الوحيد الذي يصبح أداة وكيل، وخطافات الواجهة الأمامية المكتوبة، ونقل إطار العمل، وأداة MCP، وأمر CLI."
---

# Actions

Actions هي المصدر الوحيد للحقيقة لأي شيء يفعله تطبيقك. حدد إجراءً مرة واحدة باستخدام `defineAction()`، ثم أسقطه في `actions/`، وسيكون متاحًا على الفور على النحو التالي:

- **أداة الوكيل** — يراها الوكيل باستخدام مخطط JSON المشتق من zod ويمكنه الاتصال بها في الدردشة.
- **خطافات Typesafe React** — `useActionQuery("name")` و`useActionMutation("name")` في الواجهة الأمامية، الأنواع المستنتجة من المخطط.
- **استدعاءات العميل الحتمية** — `callAction("name", params)` عندما لا يكون الخطاف مناسبًا.
- **نقل إطار العمل** — يتم تركيبه تلقائيًا بواسطة إطار العمل خلف تلك الخطافات وهو متاح لعملاء HTTP الخارجيين.
- **أداة MCP** — مكشوفة لتطبيقات Claude وChatGPT المخصصة MCP وClaude Desktop/Code وCursor وCodex وأي عميل MCP آخر.
- **أداة A2A** — يتم استدعاؤها بواسطة تطبيقات الوكيل الأصلية الأخرى عبر A2A.
- **أمر CLI** — `pnpm action <name>` للبرمجة النصية وحلقات التطوير.

تعريف واحد، سبعة مستهلكين. هذه هي الدرجة الثالثة من [ladder](/docs/what-is-agent-native#the-ladder).
إذا كنت تقرر ما إذا كنت ستكشف عن عملية بدون رأس، في الدردشة، في
السيارة الجانبية المضمنة، أو كشاشة تطبيق كاملة، راجع [Agent Surfaces](/docs/agent-surfaces).

```an-diagram title="تعريف واحد، سبعة مستهلكين" summary="ينتشر defineAction() واحد على كل سطح - الوكيل، وUI، وHTTP، وMCP، وA2A, وCLI - مع مخطط واحد تم التحقق منه ونص run() واحد."
{
  "html": "<div class=\"diagram-fanout\"><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">defineAction()</span><small class=\"diagram-muted\">مخطط + تشغيل (), تم تعريفه مرة واحدة</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-grid\"><div class=\"diagram-node\">أداة الوكيل<br><small class=\"diagram-muted\">JSON المخطط في السياق</small></div><div class=\"diagram-node\">React خطافات<br><small class=\"diagram-muted\">useActionQuery/Mutation</small></div><div class=\"diagram-node\">كولأكشن ()<br><small class=\"diagram-muted\">العميل الحتمي</small></div><div class=\"diagram-node\">HTTP<br><small class=\"diagram-muted\">/_agent-native/actions/:اسم</small></div><div class=\"diagram-node\">أداة JSON<br><small class=\"diagram-muted\">المضيفين الخارجيين</small></div><div class=\"diagram-node\">أداة JSON<br><small class=\"diagram-muted\">تطبيقات agent-native الأخرى</small></div><div class=\"diagram-node\">CLI<br><small class=\"diagram-muted\">عمل pnpm &lt;اسم&gt;</small></div></div></div>",
  "css": ".diagram-fanout{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-fanout .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 16px}.diagram-fanout .diagram-arrow{font-size:22px;line-height:1}.diagram-fanout .diagram-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}"
}
```

إذا كان كل من UI والوكيل بحاجة إلى القيام بشيء ما، فاتصل إلى إجراء - وليس مخصصًا
المسار. لمعرفة متى يكون البروتوكول على شكل مسار هو المكالمة الصحيحة، راجع [تفضيل Actions
لعمليات التطبيقات](/docs/server#actions-first).

## ابدأ بإجراء واحد {#hello-action}

المنحدر البدائي الأول هو إجراء واحد، وليس قالبًا. في مقطوعة الرأس
سقالة مثل `agent-native create my-agent --headless`، يمكن أن تكون
التطبيق الأول بالكامل:

```ts
// actions/hello.ts
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description: "قل مرحبًا من الوكيل المحلي.",
  schema: z.object({
    name: z.string().default("world"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ name }) => {
    return { message: `Hello, ${name}!` };
  },
});
```

قم بتشغيله من نفس المجلد:

```bash
pnpm action hello '{"name":"Steve"}'
```

يقبل CLI كائن JSON كمدخل إجراء، والذي يطابق البنية
يقوم وكلاء استدعاءات الأداة بالفعل. لا تزال العلامات البسيطة صالحة للتشغيل اليدوي السريع:

```bash
pnpm action hello --name Steve
```

ثم قم بتشغيل حلقة وكيل التطبيق على المجلد:

```bash
pnpm agent "Call hello for Steve and explain the result"
```

هذا هو نفس وكيل التطبيق الذي يكرر مهامك المجدولة، والدردشة UI، MCP الخارجية
الأدوات، وسيتم استخدام الشاشات المستقبلية. قوالب الدردشة والمجال مخصصة لإضافة UI
حول actions، وليس شرطًا أساسيًا مطلوبًا للإجراء نفسه.

## تعريف الإجراء {#defining}

```an-annotated-code title="تشريح الفعل"
{
  "filename": "actions/reply-to-email.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { z } from \"zod\";\n\nexport default defineAction({\n  description: \"Reply to an email thread in the user's voice.\",\n  schema: z.object({\n    emailId: z.string().describe(\"The id of the email to reply to.\"),\n    body: z.string().describe(\"The reply body, in markdown.\"),\n  }),\n  run: async ({ emailId, body }) => {\n    await db.insert(replies).values({ emailId, body });\n    return { ok: true, emailId };\n  },\n});",
  "annotations": [
    {
      "lines": "5",
      "label": "سطح الأداة",
      "note": "`description` هو ما يقرأه الوكيل ليقرر متى يتم الاتصال به. تتدفق مكالمات `.describe()` لكل حقل إلى مخطط JSON أيضًا."
    },
    {
      "lines": "6-9",
      "label": "عقد typed",
      "note": "يتحقق مخطط واحد من صحة الإدخال من **كل** السطح ويتم تحويله إلى مخطط JSON للنموذج. لا تصل المدخلات غير الصالحة أبدًا إلى `run`."
    },
    {
      "lines": "10-13",
      "label": "التنفيذ واحد",
      "note": "يعد نص `run` المصدر الوحيد للحقيقة - حيث يقوم زر واجهة المستخدم وأداة الوكيل بتنفيذ ذلك بالضبط."
    }
  ]
}
```

هذا كل شيء. يكتشف إطار العمل تلقائيًا كل ملف في `actions/` ويقوم بتثبيته عند بدء التشغيل.

### خيارات المخطط {#schemas}

يقبل `schema` أي مكتبة متوافقة مع [Standard Schema](https://standardschema.dev):

- **Zod** (v4) — الاستدلال الأكثر شيوعًا وأفضل نوع، ويتم التحويل تلقائيًا إلى مخطط JSON.
- **Valibot** — الحد الأدنى لحجم الحزمة إذا كان ذلك مهمًا.
- **ArkType** — إذا أعجبك بناء الجملة.

يتم تحويل المخطط إلى مخطط JSON لتعريف أداة Claude API، _and_ المستخدم في وقت التشغيل للتحقق من صحة المدخلات قبل تشغيل `run()`. لا تصل المدخلات غير الصالحة إلى معالجك أبدًا.

### التحقق من صحة القيمة المرجعة {#output-schema}

`schema` يتحقق من صحة _inputs_. للتحقق أيضًا من صحة الإجراء الذي يرجعه \*\*، قم بتمرير `outputSchema` (أي مخطط قياسي متوافق مع المخطط — Zod، Valibot، ArkType، نفس السطح مثل `schema`). يتحقق إطار العمل من صحة النتيجة التي حلها _after_ `run()`، ويتم تأليفها باستخدام التحقق من صحة الإدخال: تم التحقق من صحة الإدخال قبل `run`، وتم التحقق من صحة الإخراج بعد ذلك.

```ts
export default defineAction({
  description: "Summarize a thread.",
  schema: z.object({ threadId: z.string() }),
  outputSchema: z.object({
    summary: z.string(),
    messageCount: z.number(),
  }),
  outputErrorStrategy: "warn", // default
  run: async ({ threadId }) => {
    /* ...returns { summary, messageCount } ... */
  },
});
```

يتحكم `outputErrorStrategy` في ما يحدث في حالة عدم التطابق:

| الإستراتيجية | السلوك عند عدم التطابق                                                                      |
| ------------ | ------------------------------------------------------------------------------------------- |
| `"warn"`     | **Default.** `console.warn` المشكلات وإرجاع النتيجة **الأصلية** دون تغيير. غير قابلة للكسر. |
| `"strict"`   | قم بإلقاء خطأ واضح حتى يظهر الإجراء الذي به خطأ بصوت عالٍ.                                  |
| `"fallback"` | قم بإرجاع قيمة `outputFallback` المقدمة بدلاً من النتيجة غير الصالحة.                       |

عند النجاح، يتم إرجاع القيمة **التي تم التحقق منها**، بحيث يصبح أي إكراه أو افتراضيات محددة في `outputSchema` ساري المفعول (يعكس مسار الإدخال). عند عدم توفير `outputSchema`، يظل السلوك بايت مقابل بايت دون تغيير - ولا يوجد أي تغليف. تم استعارة هذا من المخرجات المنظمة لـMastra/Flue وتم الحفاظ عليه خاليًا من التبعية في طبقة الإجراء.

### تكوين HTTP {#http}

افتراضيًا، يتم عرض كل إجراء كـ `POST /_agent-native/actions/<name>`. التجاوز باستخدام خيار `http`:

```ts
export default defineAction({
  description: "Get details for a lead.",
  schema: z.object({ leadId: z.string() }),
  http: { method: "GET" },
  run: async ({ leadId }) => {
    return await db.select().from(leads).where(eq(leads.id, leadId));
  },
});
```

بالنسبة لإجراء `GET`، يتم تمرير `leadId` كمعلمة استعلام: `/_agent-native/actions/get-lead?leadId=abc`.

```an-api title="نقطة نهاية action المثبتة تلقائيا" method="GET" path="/_agent-native/actions/get-lead"
{
  "method": "GET",
  "path": "/_agent-native/actions/get-lead",
  "summary": "كل action يثبت هنا تلقائيا - اسم الملف هو اسم action.",
  "description": "الافتراضي هو POST؛ `http: { method: \"GET\" }` يجعلها GET. تستدعي خطافات React و `callAction` هذا المسار دائما بالاسم، بغض النظر عن أي تجاوز `http.path`.",
  "auth": "ملف تعريف ارتباط للجلسة؛ تحمل استدعاءات الواجهة `X-Agent-Native-Frontend: 1`",
  "params": [
    { "name": "leadId", "in": "query", "type": "string", "required": true, "description": "تصل وسائط GET كمعاملات query؛ وتصل وسائط POST في جسم JSON." }
  ],
  "responses": [
    { "status": "200", "description": "قيمة إرجاع action بصيغة JSON." },
    { "status": "400", "description": "فشل الإدخال في التحقق من schema قبل تشغيل run()." }
  ]
}
```

- **`http: { method: "GET" | "POST" | "PUT" | "DELETE" }`** — `POST` الافتراضي. تم وضع علامة `GET` على actions تلقائيًا على `readOnly`، لذا لا تؤدي المكالمات الناجحة إلى تحديث استقصاء UI.
- **`http: { path: "..." }`** — تجاوز URL المثبت أسفل `/_agent-native/actions/`. الإعدادات الافتراضية لاسم الملف. **تجاوزات المسار تغير URL فقط للمتصلين المباشرين HTTP** — `useActionQuery` و`useActionMutation` و`callAction` يتصلون دائمًا بـ `/_agent-native/actions/<name>` بغض النظر عن هذا التجاوز، لذا فإن تجاوز المسار يجعل هذه الخطافات 404. استخدم تجاوزات المسار فقط للمتصلين HTTP الخارجيين. لاحظ أيضًا أن مقاطع مسار `:param` في مسار التجاوز **لم** يتم تحليلها إلى وسيطات `run()` — فقط معلمات سلسلة الاستعلام وحقول النص JSON هي التي يتم تحليلها.
- **`http: false`** — تعطيل نقطة النهاية HTTP بالكامل. الوكيل + CLI فقط.
- **`readOnly: true`** — تخطي تحديث الاستقصاء بشكل صريح حتى بالنسبة إلى POST actions التي لم تتغير.
- **`parallelSafe: true`** — السماح بإجراء تغيير بالتزامن مع استدعاءات أداة التشغيل نفسها. قم بتعيين هذا فقط عندما يكون الإجراء آمنًا للتزامن داخليًا ومستقلًا عن الطلب؛ تحويل actions إلى تسلسل افتراضي.

### اجعل سطح العمل صغيرًا {#small-surface}

كل إجراء يمكن للوكيل رؤيته هو أداة في نافذة سياق النموذج، كما أن قائمة الأدوات الطويلة والمتداخلة تؤدي إلى انخفاض جودة تحديد أداة النموذج. صمم سطح الحركة مثل API الذي تحتفظ به، وليس إجراء واحد لكل قدرة UI:

- تفضل **`update` بنمط CRUD** الذي يأخذ مجموعة من الحقول الاختيارية على N لكل حقل actions (`update-name`، `update-order`، `update-color`، ...). يرسل المتصل فقط ما تغير.
- قبل إضافة إجراء قراءة جديد لكل استعلام/مرشح، يمكنك الوصول إلى فتحة هروب عامة: [provider API trio](/docs/template-dispatch) (`provider-api-catalog` / `provider-api-docs` / `provider-api-request`) لبيانات الموفر، أو أداة dev `db-query` لبيانات التطبيق.
- ضع علامة على UI فقط أو actions [`agentTool: false`](#agent-tool) الآلية بحيث تظل قابلة للاستدعاء في الواجهة الأمامية/HTTP دون إنفاق أي خانة في قائمة أدوات النموذج.
- قم بحذف أو إخفاء actions الذي لم يعد UI يستخدمه بدلاً من تركه مكشوفًا للنموذج.

يقوم المساعد الاستشاري على مستوى الريبو، `node scripts/audit-template-actions.mjs [template ...]` (الاسم المستعار `pnpm actions:audit`)، بفحص `actions/` للقالب بشكل ثابت ويضع علامة على UI المحتملة actions الميتة والمجموعات الزائدة لكل حقل. إنها استشارية فقط (تخرج دائمًا من 0، ولا تفشل أبدًا في CI) وتستخدم أساليب استدلالية متحفظة، لذا قم بمراجعة اقتراحاتها بدلاً من التعامل معها كأخطاء.

### أعلام التعرض {#exposure-flags}

أربع أعلام تتحكم في _who_ الذي يمكنه استدعاء الإجراء. يتم ضبط كل القيم بشكل افتراضي على القيمة المسموح بها، لذا يمكنك تعيين واحدة فقط لتشديد سطح معين. هذا الجدول هو ملخص سريع. تضيف الأقسام الفرعية التفاصيل التي يحتاجها كل منها.

| علم             | افتراضي     | قيمة مقيدة → من لا يزال بإمكانه الاتصال                                   | الاستخدام النموذجي                                                |
| --------------- | ----------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `agentTool`     | `true`      | `false` → UI وHTTP وCLI فقط — **مخفي من النموذج** وMCP وA2A               | UI فقط / actions البرمجي الذي لا ينبغي أن يستخدم فتحة أداة        |
| `toolCallable`  | `true`      | `false` → كل شيء **ما عدا** جسر iframe الممتد في وضع الحماية (403)        | عمليات المصادقة المجاورة (حذف الحساب، تغيير عضوية/أدوار المؤسسة)  |
| `publicAgent`   | إيقاف (خاص) | `{ expose: true }` → يضيف الإجراء إلى **العامة** MCP/A2A/OpenAPI          | أدوات قراءة/الاستيعاب آمنة يمكن الوصول إليها بدون مصادقة          |
| `needsApproval` | `false`     | `true` → الوكيل **إيقاف مؤقت**; يجب أن يوافق الإنسان على المكالمة المحددة | الآثار الجانبية اللاحقة (إرسال بريد إلكتروني، شحن البطاقة، الحذف) |

هذه مستقلة: يتحكم `agentTool` في عرض النموذج، ويتحكم `toolCallable` فقط في إطار iframe الملحق، ويضيف `publicAgent` سطحًا عامًا للاشتراك (مسارات الويب العامة لا تعني أبدًا التعرض للأداة العامة)، وينفذ `needsApproval` بوابات بعد إجراء المكالمة - راجع [Human-in-the-loop approval](#needs-approval) أدناه.

#### `agentTool` — إخفاء من النموذج {#agent-tool}

افتراضيًا، كل إجراء هو أداة وكيل قابلة للاستدعاء. قم بتعيين `agentTool: false` لإبقائه خلف سطح المصادقة + الإجراء الخاص بإطار العمل أثناء إزالته من كل قائمة أدوات الوكيل - ويظل قابلاً للاستدعاء من UI (`useActionMutation` / `callAction`)، وCLI، و`/_agent-native/actions/<name>`:

```ts
export default defineAction({
  description: "Persist the user's sidebar width.",
  agentTool: false, // UI-only — not a tool in the model's context window
  schema: z.object({ widthPx: z.number() }),
  http: { method: "PUT" },
  run: async ({ widthPx }) => {
    /* ... */
  },
});
```

يمكنك الوصول إليه عند إضافة إجراء UI فقط أو إجراء برمجي بحت، أو عندما يتوقف UI عن استخدام إجراء كنت ستتركه مكشوفًا للنموذج.

#### `toolCallable` — حظر امتداد iframe {#tool-callable}

تستدعي الامتدادات ([Alpine.js mini-apps in sandboxed iframes](/docs/extensions)) actions عبر `appAction(name, params)`، وتعمل مع أذونات _viewer's_، وأسراره، ونطاق SQL. بالنسبة للعمليات ذات نصف القطر العالي، فهي تحظى بثقة كبيرة بشكل افتراضي. قم بتعيين `toolCallable: false` لجعل جسر الامتداد يعود 403 مع الاحتفاظ بالإجراء قابلاً للاستدعاء من UI والوكيل وCLI وMCP وA2A:

```ts
export default defineAction({
  description: "Delete the current user's account.",
  toolCallable: false, // never callable from an extension iframe
  schema: z.object({ confirm: z.literal("yes") }),
  run: async () => {
    /* ... */
  },
});
```

استخدمه مع actions الذي يقوم بحذف الحسابات/المؤسسات أو نقلها، أو تغيير حالة المصادقة، أو تعديل عضوية المؤسسة، أو منح حق الوصول للمشاركة. لقد تم بالفعل إلغاء الاشتراك في `share-resource` و`unshare-resource` و`set-resource-visibility` المضمنة في إطار العمل. يتم التنفيذ من خلال رأس مجموعة مضيف غير قابل للتحايل على استدعاءات iframe؛ لن تتأثر مكالمات UI/agent/CLI/MCP/A2A — راجع [Security](/docs/security) لمزيد من التفاصيل.

### تشغيل السياق (الوسيطة الثانية) {#run-context}

يتلقى `run` وسيطة ثانية اختيارية، `ctx`، تحمل هوية الطلب الذي تم حله والسطح الذي استدعى الإجراء. اقرأها بدلاً من الاتصال بـ `getRequestUserEmail()` / `getRequestOrgId()` يدويًا، وقم بتمرير `ctx` بالكامل إلى التتبع:

```ts
export default defineAction({
  description: "Log an audit entry for the current request.",
  schema: z.object({ event: z.string() }),
  run: async (args, ctx) => {
    // ctx is undefined-safe: a 1-arg `run(args)` is still valid.
    const actor = ctx?.userEmail ?? "system";
    if (ctx?.caller === "frontend") {
      // tighter rules for browser-initiated calls, looser for "tool"/"cli"
    }
    await db.insert(audit).values({
      actor,
      orgId: ctx?.orgId ?? null,
      source: ctx?.caller ?? "unknown",
      event: args.event,
    });
    return { ok: true };
  },
});
```

حقول `ActionRunContext`:

| الحقل         | اكتب                    | ملاحظات                                                                                                                                                         |
| ------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `userEmail`   | `string \| undefined`   | Resolved request user. **Never defaulted to a dev identity** — `undefined` when the request has no authenticated user. Apply your own fallback if you need one. |
| `orgId`       | `string \| null`        | Resolved org id, or `null` when the request has no org.                                                                                                         |
| `caller`      | `ActionCaller`          | كيفية استدعاء الإجراء (انظر أدناه).                                                                                                                             |
| `send`        | `(event) => void`       | اختياري. إرسال حدث SSE إلى العميل. موجود فقط داخل حلقة أداة الوكيل (`caller: "tool"`)؛ `undefined` في مكان آخر.                                                 |
| `attachments` | `AgentChatAttachment[]` | الملفات والصور والكتل النصية الملصقة التي تم إرسالها مع دور الوكيل الحالي. يتم ملؤها فقط عندما `caller: "tool"`؛ `undefined` على كافة الأسطح الأخرى.            |

`caller` هو الاتحاد `"tool" | "http" | "frontend" | "cli" | "mcp" | "a2a"`:

| `caller`     | اضبط متى…                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `"tool"`     | حلقة الوكيل داخل التطبيق، أو فريق الوكيل الفرعي/الوكيل، أو طلب A2A (A2A يقود نفس حلقة الوكيل، لذا فإن استدعاءات الأداة هي `"tool"`). |
| `"frontend"` | استدعاء متصفح عبر `useActionMutation` / `useActionQuery` / `callAction` (تم وضع علامة عليها برأس `X-Agent-Native-Frontend: 1`).      |
| `"http"`     | من `POST` / `GET` برمجي إلى `/_agent-native/actions/<name>` بدون علامة الواجهة الأمامية.                                             |
| `"cli"`      | `pnpm action <name>` (عداء CLI).                                                                                                     |
| `"mcp"`      | وكيل خارجي عبر نقطة نهاية MCP `tools/call`.                                                                                          |
| `"a2a"`      | محجوز لإرسال إجراء A2A مباشر في المستقبل. اليوم، يتم تشغيل A2A عبر حلقة الوكيل، لذا فإن هذه الاستدعاءات هي `"tool"`.                 |

يظل `run` متوافقًا مع الإصدارات السابقة: تستمر معالجات الوسيطة الواحدة الحالية والمعالجات التي تدمر `{ send }` فقط في العمل دون تغيير.

### التحكم في الوصول في actions {#access-control}

يجب أن تتم قراءة الجداول المملوكة للمستخدم من خلال `accessFilter` والكتابة من خلال `assertAccess` - نفس المساعدين الذين يستخدمهم نظام مشاركة إطار العمل. فيما يلي مثال كامل وجاهز لللصق:

```ts
// actions/create-lead.ts
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import * as schema from "../server/db/schema.js";

export default defineAction({
  description: "Create a lead in the CRM.",
  schema: z.object({ name: z.string(), company: z.string() }),
  run: async ({ name, company }, ctx) => {
    const db = getDb();
    await db.insert(schema.leads).values({
      id: crypto.randomUUID(),
      name,
      company,
      ownerEmail: ctx?.userEmail ?? "system",
    });
    return { ok: true };
  },
});
```

لإدراج actions وقراءته، استخدم `accessFilter` لتحديد نطاق الاستعلام ليشمل المستخدم الحالي والمؤسسة. بالنسبة إلى actions الذي يقوم بتحديث صف معين أو حذفه، استخدم `assertAccess` للتأكد من السماح للمتصل قبل الكتابة. راجع [Security](/docs/security#access-guards) و[Sharing](/docs/sharing) للحصول على المساعد الكامل API.

### موافقة الإنسان في الحلقة {#needs-approval}

تعد مجموعة من actions ذات أهمية كبيرة جدًا بحيث لا تسمح للوكيل بالعمل بشكل مستقل - إرسال بريد إلكتروني، وشحن البطاقة، وحذف الحساب. بالنسبة إلى هؤلاء، قم بتعيين `needsApproval` لإيقاف الحلقة مؤقتًا واطلب من الإنسان الموافقة على مكالمة محددة قبل تنفيذ `run()`:

```ts
export default defineAction({
  description: "Send an email via Gmail.",
  schema: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
  needsApproval: true, // pause; a human must approve this specific send
  run: async (args) => {
    /* ...actually send... */
  },
});
```

يقبل `needsApproval` أيضًا المسند `(args, ctx) => boolean | Promise<boolean>` للدخول بشكل مشروط (على سبيل المثال، المستلمون الخارجيون فقط، أعلى من العتبة فقط)؛ **فشل في الإغلاق**، لذا يتم احتساب الرمية على أنها "موافقة مطلوبة". عندما تكون البوابة صادقة وغير موافق عليها، توقف الحلقة الدور ولا يبدأ التأثير الجانبي أبدًا حتى يوافق الإنسان في الدردشة UI.

> [!WARNING]
> حافظ على الموافقات نادرة. يعد كل إجراء مسور بمثابة نقطة توقف صعبة في حلقة الوكيل. الإعداد الافتراضي هو **إيقاف**، ويجب أن يتم إيقافه في كل إجراء تقريبًا. راجع [Human-in-the-Loop Approvals](/docs/human-approval) لمعرفة المسند API، والحدث `approval_required`، والتدفق الكامل.

### تسجيل التدقيق {#audit}

يتم تدقيق كل إجراء تغيير **تلقائيًا** — يسجل إطار العمل من قام بتشغيله، ومتى، ومن أي سطح، و(متى كان الوكيل) وأي مسار/دور، مع مدخلات منقحة ببيانات الاعتماد. للقراءة فقط (`GET`) تم تخطي actions. لا تكتب أي رمز لهذا؛ يحدث ذلك عند خط التماس `defineAction`.

أضف كتلة `audit` فقط لالتقاط _tune_ - من المفيد جدًا الإعلان عن المورد الذي تغير الإجراء بحيث يظهر التغيير في مسار مالك هذا المورد:

```ts
export default defineAction({
  description: "Delete a recording.",
  schema: z.object({ id: z.string() }),
  audit: {
    target: (args, result) => ({ type: "recording", id: args.id }),
    summary: (args) => `Deleted recording ${args.id}`,
  },
  run: async (args, ctx) => {
    /* ...delete... */
  },
});
```

مقابض أخرى: يقوم `audit: { onRead: true }` بمراجعة القراءة الحساسة (الوصول السري، التصدير بالجملة)؛ `audit: { enabled: false }` يختار كتابة صاخبة؛ يتخطى `audit: { recordInputs: false }` التقاط الوسائط. اقرأ المسار مرة أخرى باستخدام `list-audit-events` / `get-audit-event` actions المدمج. التفاصيل الكاملة في [Audit Log](/docs/audit-log).

## استدعاءه من UI {#ui}

خطافان، كلاهما في `@agent-native/core/client`. يتم استنتاج الأنواع من مخططات `defineAction` الخاصة بك — لا توجد إعلانات يدوية عن النوع.

### `useActionMutation` {#use-action-mutation}

بالنسبة إلى actions التي تغير الحالة:

```tsx
import { useActionMutation } from "@agent-native/core/client";

const { mutate, isPending } = useActionMutation("reply-to-email");

<Button
  disabled={isPending}
  onClick={() => mutate({ emailId, body: "Thanks!" })}
>
  Send Reply
</Button>;
```

عند النجاح، يُصدر إطار العمل حدث تغيير باستخدام `source: "action"` بحيث تتم إعادة جلب مستهلكي `useActionQuery` ومراقبي الاستعلام النشطين تلقائيًا. انظر [Live Sync](/docs/key-concepts#polling-sync).

### `useActionQuery` {#use-action-query}

للقراءة فقط GET actions:

```ts
import { useActionQuery } from "@agent-native/core/client";

const { data, isLoading } = useActionQuery("get-lead", { leadId });
```

يتم تخزين الاستعلام مؤقتًا ضمن `["action", "get-lead", { leadId }]` ويتم إبطاله تلقائيًا عند اكتمال أي إجراء تغيير.

## عرض الدردشة الأصلية UI {#native-chat-ui}

يمكن أن يعرض Actions بيانات عناصر واجهة المستخدم المنظمة التي تعرضها الدردشة داخل التطبيق
أصليًا. هذا هو مسار دردشة الطرف الأول للجداول والمخططات والإعدادات القابلة لإعادة الاستخدام
الملخصات وبطاقات المعلومات؛ استخدم [MCP Apps](/docs/mcp-apps) لـ UI المضمّن في
مضيفي MCP الخارجيين.

```ts
import { defineAction } from "@agent-native/core/action";
import { ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER } from "@agent-native/core/action-ui";
import {
  createDataInsightsWidgetResult,
  dataInsightsWidgetResultSchema,
} from "@agent-native/core/data-widgets";

export default defineAction({
  description: "Summarize response trends.",
  readOnly: true,
  outputSchema: dataInsightsWidgetResultSchema,
  chatUI: { renderer: ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER },
  run: async () =>
    createDataInsightsWidgetResult({
      title: "Response trends",
      chartSeries: {
        type: "line",
        xKey: "day",
        series: [{ key: "responses", label: "Responses" }],
        data: [
          { day: "Mon", responses: 12 },
          { day: "Tue", responses: 18 },
        ],
      },
      table: {
        columns: [
          { key: "day", label: "Day" },
          { key: "responses", label: "Responses", align: "right" },
        ],
        rows: [
          { day: "Mon", responses: 12 },
          { day: "Tue", responses: 18 },
        ],
      },
    }),
});
```

المميزات المضمنة هي `"data-table"`، `"data-chart"`، و
`"data-insights"`، مع أدوات إنشاء ومخططات آمنة للخادم في
`@agent-native/core/data-widgets`. See [Native واجهة الدردشة](/docs/native-chat-ui)
للحصول على عقد النتيجة الكاملة وإرشادات وقت تشغيل BYO، أو
[Agent Surfaces](/docs/agent-surfaces) لمعرفة كيفية استمرار نفس الإجراء
بدون رأس، أو يتم عرضه في الدردشة، أو يتم عرضه في وضع ملء الشاشة.

## استدعاءه من CLI {#cli}

كل إجراء قابل للتنفيذ عبر `pnpm action`:

```bash
pnpm action reply-to-email '{"emailId":"thread-123","body":"Thanks!"}'
```

إدخال JSON هو الشكل المفضل للوكلاء والكائنات المعقدة. الأعلام هي
لا يزال يتم تحليله في نفس شكل المخطط لعمليات التشغيل اليدوية البسيطة والموجودة
البرامج النصية. مفيد لحلقات تطوير الوكيل والبرامج النصية والكرون.

## الاتصال به من وكيل آخر (A2A) {#a2a}

إذا كان تطبيقك نظيرًا لـ [A2A](/docs/a2a-protocol)، فإن تطبيقات الوكيل الأصلية الأخرى تكتشف actions الخاص بك تلقائيًا ويمكنها الاتصال بها بالاسم. عمليات النشر ذات الأصل نفسه تخطي توقيع JWT؛ يستخدم cross-origin `A2A_SECRET` مشتركًا.

## تعريضه على MCP {#mcp}

مع تمكين MCP، تظهر actions في خادم MCP الخاص بالإطار في `/_agent-native/mcp`. يحصل كل متصل على كتالوج مضغوط بشكل افتراضي - عناصر مدمجة تواجه التطبيق بالإضافة إلى التطبيق المعلن عن القالب actions - و`tool-search` موجود دائمًا بحيث تظل أي أداة أخرى قابلة للوصول عند الطلب. يتم تقديم سطح الإجراء الكامل فقط عند الاشتراك الصريح (الرمز المميز `--full-catalog` أو `AGENT_NATIVE_MCP_FULL_CATALOG=1`)، ويختار `publicAgent.expose` أداة قراءة/الاستيعاب الآمنة على السطح العام. راجع [MCP Protocol](/docs/mcp-protocol) للتعرف على طبقات الكتالوج والمصادقة وتفاصيل موارد `mcpApp`.

بالنسبة للمضيفين MCP القادرين على UI، يمكن للإجراء الإعلان عن مورد MCP Apps الاختياري عبر حقل `mcpApp` (بالإضافة إلى `link` المطابق) بحيث يعرض المضيفون القادرون النتيجة بشكل مضمن. عندما يشير `link` و`mcpApp` إلى نفس المسار، فإن `embedRoute()` يبني كليهما من منشئ مسار خالص واحد:

```ts
import { embedRoute } from "@agent-native/core";

export default defineAction({
  description: "Create an email draft for review.",
  schema: z.object({ body: z.string() }),
  run: async ({ body }) => ({ body }),
  ...embedRoute({
    title: "Review draft",
    openLabel: "Open in Mail",
    path: ({ result }) => ({
      label: "Open draft in Mail",
      url: "/_agent-native/open?app=mail&view=inbox",
    }),
  }),
});
```

احتفظ بـ `link` كبديل لعملاء CLI وغير UI MCP؛ وهو أيضًا هدف إطلاق التضمين. جسر التضمين - جلسة بدء التضمين الموقعة، والزرع مقابل عرض الإطار المتحكم فيه، والجسر المضيف `ui/*`، وCSP، وتثبيت الارتفاع - مملوك لشركة [External Agents](/docs/external-agents#mcp-app-bridge).

## قياسي actions {#standard-actions}

يجب أن يتضمن كل قالب هذين النموذجين لـ [context awareness](/docs/context-awareness):

### شاشة العرض {#view-screen}

قراءة حالة التنقل الحالية، وجلب البيانات السياقية، وإرجاع لقطة لما يراه المستخدم. يستدعي الوكيل هذا عندما يحتاج إلى إلقاء نظرة جديدة على الشاشة.

```ts
// actions/view-screen.ts
import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description: "Read the current screen state for context.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const navigation = await readAppState("navigation");
    const screen: Record<string, unknown> = { navigation };

    if (navigation?.view === "inbox") {
      screen.emailList = await listEmailsForLabel(navigation.label);
    }

    return screen;
  },
});
```

### التنقل {#navigate}

يكتب أمر تنقل لمرة واحدة إلى حالة التطبيق. يقوم UI بقراءته والتنقل فيه وحذف الإدخال.

```ts
// actions/navigate.ts
import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description: "Navigate the user to a view.",
  schema: z.object({
    view: z.string(),
    threadId: z.string().optional(),
  }),
  run: async (args) => {
    await writeAppState("navigate", args);
    return { ok: true };
  },
});
```

## نمط CLI القديم actions {#legacy-cli-actions}

لا يزال إطار العمل يدعم `export default async function(args)` actions الأقدم التي لم يتم تضمينها في `defineAction` - وهي مفيدة لنصوص التطوير الفريدة التي لا تحتاج إلى عرض الوكيل/HTTP. هذه هي CLI فقط؛ فهي لا تظهر كأدوات وكيل، ولا تقم بتثبيت نقاط نهاية HTTP، ولا تحصل على خطافات أمامية آمنة للكتابة.

```ts
// actions/debug-dump.ts — CLI-only
import { parseArgs } from "@agent-native/core";

export default async function main(args: string[]) {
  const { table } = parseArgs(args);
  // one-off script you wouldn't want the agent to call
}
```

يجب أن يفضل الكود الجديد `defineAction()`. يمكنك الوصول إلى هذا النمط فقط عندما لا تريد أن يتم كشف الإجراء للعملاء أو UI عن عمد.

### `parseArgs(args)` {#parseargs}

مساعد للنمط القديم actions. يوزع وسيطات CLI بتنسيق `--key value` أو `--key=value`:

```ts
import { parseArgs } from "@agent-native/core";

const args = parseArgs(["--name", "Steve", "--verbose", "--count=3"]);
// { name: "Steve", verbose: "true", count: "3" }
```

## وظائف الأداة المساعدة {#utility-functions}

| الوظيفة                 | المرتجعات | الوصف                                                         |
| ----------------------- | --------- | ------------------------------------------------------------- |
| `loadEnv(path?)`        | `void`    | قم بتحميل `.env` من جذر المشروع (أو المسار المخصص).           |
| `camelCaseArgs(args)`   | `Record`  | تحويل مفاتيح علبة الكباب إلى علبة الجمل.                      |
| `isValidPath(p)`        | `boolean` | التحقق من صحة المسار النسبي (لا يوجد اجتياز, لا مطلق).        |
| `isValidProjectPath(p)` | `boolean` | التحقق من صحة ارتباط المشروع (على سبيل المثال, `my-project`). |
| `ensureDir(dir)`        | `void`    | مساعد `mkdir -p`.                                             |
| `fail(message)`         | `never`   | الطباعة إلى stderr و`exit(1)`.                                |

## ما هي الخطوة التالية

- [**Audit Log**](/docs/audit-log) — المسار التلقائي الذي قام بتغيير وماذا يحيط بكل إجراء
- [**Human-in-the-Loop Approvals**](/docs/human-approval) — بوابة `needsApproval` في العمق
- [**Drop-in Agent**](/docs/drop-in-agent) — `useActionMutation` / `useActionQuery` في React
- [**Context Awareness**](/docs/context-awareness) — نمط `view-screen` + `navigate` في العمق
- [**A2A Protocol**](/docs/a2a-protocol) — كيف يكتشف الوكلاء الآخرون actions الخاص بك ويتصلون به
- [**MCP Protocol**](/docs/mcp-protocol) — تعريض actions على MCP
