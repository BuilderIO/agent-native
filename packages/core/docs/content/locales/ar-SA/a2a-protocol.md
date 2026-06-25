---
title: "بروتوكول A2A"
description: "الاتصال من وكيل إلى وكيل عبر JSON-RPC: الاكتشاف والمراسلة والتدفق وإدارة المهام."
---

# بروتوكول A2A

الاتصال من وكيل إلى وكيل عبر HTTP. يكتشف الوكلاء بعضهم البعض، ويرسلون الرسائل، ويتلقون نتائج منظمة.

## نظرة عامة {#overview}

A2A (وكيل إلى وكيل) هو بروتوكول JSON-RPC للاتصال بين الوكلاء. يمكن لوكيل البريد أن يطلب من وكيل التحليلات تشغيل استعلام. يمكن لوكيل التقويم البحث عن المشكلات في وكيل إدارة المشروع. يعرض كل وكيل قدراته عبر بطاقة الوكيل ويقبل العمل عبر نقطة نهاية JSON-RPC القياسية.

A2A هو الركيزة الأساسية للتفويض عبر التطبيقات في هذا الإطار - وأبرزها [Dispatch](/docs/dispatch)، الذي يوجه رسالة واردة واحدة (Slack، البريد الإلكتروني، وما إلى ذلك) إلى أي تطبيق في مساحة العمل هو الأنسب للتعامل معها.

المفاهيم الأساسية:

- **بطاقة الوكيل** — بيانات التعريف العامة في `/.well-known/agent-card.json` التي تصف skills وإمكانياتها
- **JSON-RPC** — تستخدم التطبيقات الأصلية للوكيل `POST /_agent-native/a2a`؛ يجوز للأقران الخارجيين/القديمين استخدام `POST /a2a`
- **المهام** — تنشئ كل رسالة مهمة ذات دورة حياة (تم الإرسال، والعمل، والإكمال، والفشل، والإلغاء)
- **مصادقة حامل JWT** — إنتاج A2A يتطلب `A2A_SECRET` أو `apiKeyEnv` قديم صريح

```an-diagram title="وكيل يد واحد يعمل لآخر" summary="يكتشف وكيل البريد بطاقة وكيل التحليلات، ويرسل رسالة JSON-RPC، ويستعيد مهمة مكتملة."
{
  "html": "<div class=\"diagram-handoff\"><div class=\"diagram-card\"><strong>وكيل البريد</strong><small class=\"diagram-muted\">يحتاج إلى تحليلات</small></div><div class=\"diagram-col\"><div class=\"diagram-pill\">GET /.well-known/agent-card.json</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">GET /_agent-native/a2a<br><small class=\"diagram-muted\">message/send</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&larr;</div><div class=\"diagram-pill ok\">المهمة · اكتملت</div></div><div class=\"diagram-card\" data-rough><strong>وكيل التحليلات</strong><small class=\"diagram-muted\">تشغيل استعلام التشغيل، وإرجاع النتيجة</small></div></div>",
  "css": ".diagram-handoff{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.diagram-handoff .diagram-col{display:flex;flex-direction:column;align-items:center;gap:6px}.diagram-handoff .diagram-arrow{font-size:20px;line-height:1}"
}
```

## إعداد الخادم {#server-setup}

تحصل معظم القوالب على A2A من خلال البرنامج الإضافي للدردشة مع وكيل إطار العمل. إذا كنت تقوم بتثبيته بنفسك، فاتصل بـ `mountA2A()` في مكون إضافي للخادم:

```ts
// server/plugins/a2a.ts
import { mountA2A } from "@agent-native/core/a2a";

export default defineNitroPlugin((nitro) => {
  mountA2A(nitro, {
    name: "Analytics Agent",
    description: "Runs analytics queries and returns chart data",
    skills: [
      {
        id: "run-query",
        name: "Run Query",
        description: "Execute a SQL query against the analytics database",
        tags: ["analytics", "sql"],
        examples: ["Show me signups by source this month"],
      },
    ],
    // Optional legacy external-peer bearer key. Prefer A2A_SECRET for
    // agent-native workspace calls and production deployments.
    apiKeyEnv: "A2A_API_KEY",
    streaming: true, // enable message/stream
  });
});
```

هذا يتصاعد:

- `GET /.well-known/agent-card.json` — بيانات تعريف الاكتشاف العامة.
- `POST /_agent-native/a2a` — نقطة نهاية JSON-RPC للوكيل الأساسي.
- `POST /_agent-native/a2a/_process-task` — مسار المعالج الداخلي غير المتزامن، موقع بـ `A2A_SECRET`.

يرجع العميل أيضًا إلى `/a2a` للوكلاء الخارجيين الذين يكشفون عن المسار القديم/البسيط. يجب أن تقوم عمليات النشر الأصلية لعامل الإنتاج بتعيين `A2A_SECRET`؛ وبدون ذلك، تفشل أوقات التشغيل المستضافة في الإغلاق بدلاً من قبول العمل عن بعد غير المصادق عليه.

## بطاقة الوكيل {#agent-card}

يتم إنشاء بطاقة الوكيل تلقائيًا من التكوين الخاص بك ويتم تقديمها في `/.well-known/agent-card.json`. يقوم الوكلاء الآخرون بإحضاره لاكتشاف skills الخاص بوكيلك.

### تصفية المهارات لكل مستأجر {#agent-card-filtering}

نقطة نهاية البطاقة عامة، لذا يقوم إطار العمل بتنقيح skills الذي تكشف معرفاته عن عمليات التكامل لكل مستخدم أو لكل مؤسسة قبل تقديمها. يتم إسقاط أي مهارة يبدأ معرفها بـ `mcp__user_<emailhash>_…` أو `mcp__org_<orgid>_…` من البطاقة المنشورة. تظل أدوات stdio MCP التي يتحكم فيها المشغل (المحملة من `mcp.config.json`) وskills المحددة بالقالب مرئية. وهذا يمنع المتصل غير المصادق من أخذ بصمات أصابع المستأجرين الموجودين أو عمليات التكامل التي قاموا بتوصيلها. انظر `packages/core/src/a2a/server.ts`.

```json
{
  "name": "Analytics Agent",
  "description": "Runs analytics queries and returns chart data",
  "url": "https://analytics.example.com",
  "version": "1.0.0",
  "protocolVersion": "0.3",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "stateTransitionHistory": true
  },
  "skills": [
    {
      "id": "run-query",
      "name": "Run Query",
      "description": "Execute a SQL query against the analytics database",
      "tags": ["analytics", "sql"],
      "examples": ["Show me signups by source this month"]
    }
  ],
  "securitySchemes": {
    "jwtBearer": { "type": "http", "scheme": "bearer", "bearerFormat": "JWT" },
    "apiKey": { "type": "http", "scheme": "bearer" }
  },
  "security": [{ "jwtBearer": [] }, { "apiKey": [] }]
}
```

_(قد يختلف الإصدار؛ احصل على البطاقة المباشرة لتطبيقك على `/.well-known/agent-card.json` لـ `protocolVersion` الحالي.)_

عند تعيين `A2A_SECRET` (المسار الموصى به)، تعلن البطاقة عن
مخطط `jwtBearer` كما هو مذكور أعلاه. تتم إضافة مخطط `apiKey` فقط عندما يكون قديمًا
تم تكوين `apiKeyEnv` أيضًا، لذلك يتم نشر بطاقة تحتوي على مجموعة `A2A_SECRET` فقط
`jwtBearer` وحده.

## طرق JSON-RPC {#json-rpc-methods}

يتم استدعاء كافة الأساليب عبر `POST /_agent-native/a2a` بتنسيق JSON-RPC 2.0:

| الطريقة          | الوصف                                                                                                 | المعلمات الرئيسية             |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------- |
| `message/send`   | أرسل رسالة وانتظر اكتمال المهمة. قم بتمرير `async: true` للعودة فورًا إلى ولاية `working` والاستطلاع. | `message, contextId?, async?` |
| `message/stream` | أرسل رسالة، واحصل على تحديثات مهمة SSE                                                                | `message, contextId?`         |
| `tasks/get`      | جلب مهمة حسب المعرف - يُستخدم لاستقصاء مهمة غير متزامنة حتى اكتمالها                                  | `id`                          |
| `tasks/cancel`   | إلغاء مهمة قيد التشغيل                                                                                | `id`                          |

```an-api title="نقطة النهاية الأساسية A2A" summary="جميع أساليب JSON-RPC منشورة هنا. message/send معروض."
{
  "method": "POST",
  "path": "/_agent-native/a2a",
  "summary": "أرسل رسالة وانتظر اكتمال المهمة",
  "description": "JSON-RPC 2.0 endpoint for `message/send`, `message/stream`, `tasks/get`, and `tasks/cancel`. Pass `async: true` to return immediately in `working` state and poll with `tasks/get`.",
  "auth": "JWT bearer signed with A2A_SECRET (or legacy apiKeyEnv static token)",
  "params": [
    { "name": "Authorization", "in": "header", "type": "string", "required": false, "description": "Bearer token. Required in hosted production runtimes; optional in local dev." },
    { "name": "method", "in": "body", "type": "string", "required": true, "description": "One of message/send, message/stream, tasks/get, tasks/cancel." },
    { "name": "params.message", "in": "body", "type": "object", "required": false, "description": "{ role, parts[] } for message/send and message/stream." },
    { "name": "params.async", "in": "body", "type": "boolean", "required": false, "description": "Return immediately in working state and poll via tasks/get. Use on serverless hosts." },
    { "name": "params.id", "in": "body", "type": "string", "required": false, "description": "Task id for tasks/get and tasks/cancel." }
  ],
  "request": {
    "contentType": "application/json",
    "example": "{\n  \"jsonrpc\": \"2.0\",\n  \"id\": 1,\n  \"method\": \"message/send\",\n  \"params\": {\n    \"message\": {\n      \"role\": \"user\",\n      \"parts\": [{ \"type\": \"text\", \"text\": \"Show signups by source\" }]\n    },\n    \"async\": true\n  }\n}"
  },
  "responses": [
    { "status": "200", "description": "JSON-RPC result containing the task. With async:true the task returns in working state.", "example": "{\n  \"jsonrpc\": \"2.0\",\n  \"id\": 1,\n  \"result\": { \"id\": \"task_123\", \"status\": { \"state\": \"working\" } }\n}" },
    { "status": "503", "description": "Hosted production runtime with no A2A_SECRET configured — fails closed instead of running unauthenticated." }
  ]
}
```

عندما يتم استدعاء `message/send` باستخدام `async: true`، يقوم معالج JSON-RPC بإدراج المهمة في قائمة الانتظار وإطلاق POST ذاتيًا إلى مسار `/_agent-native/a2a/_process-task` داخلي بحيث يعمل المعالج في تنفيذ وظيفة جديدة مع مهلة كاملة خاصة به. تمت مصادقة هذا المسار باستخدام رمز HMAC المرتبط بمعرف المهمة (عمر 5 دقائق، موقع بـ `A2A_SECRET`). يتم تثبيته قبل المسار `/_agent-native/a2a` JSON-RPC، لذا لا تبتلعه مطابقة بادئة h3.

```an-diagram title="دورة حياة مهمة غير متزامنة على خادم" summary="async:true يُرجع العمل بالمللي ثانية، ثم يقوم تنفيذ جديد بتشغيل حلقة الوكيل أثناء استقصاء المتصل."
{
  "html": "<div class=\"diagram-async\"><div class=\"diagram-box\" data-rough>message/send<br><small class=\"diagram-muted\">غير متزامن: صحيح</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\"><span class=\"diagram-pill\">مهمة سرد</span><span class=\"diagram-pill warn\">عودة العمل</span><small class=\"diagram-muted\">~ ميلي ثانية</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>إطلاق نار ذاتي POST /_agent-native/a2a/_process-task<br><small class=\"diagram-muted\">رمز POST المميز · تنفيذ جديد · مهلة كاملة</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">tasks/get (استطلاع)</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-pill ok\">مكتمل</div></div></div>",
  "css": ".diagram-async{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-async .diagram-panel{display:flex;flex-direction:column;align-items:center;gap:6px}.diagram-async .diagram-col{display:flex;flex-direction:column;align-items:center;gap:6px}.diagram-async .diagram-arrow{font-size:20px;line-height:1}",
  "caption": "A recurring sweeper re-claims any task left in flight if the function execution dies mid-run."
}
```

> [!IMPORTANT]
> **مهلات الخطاف والبوابة بدون خادم:**
> تفرض بوابات البيئة المستضافة (مثل Netlify أو Vercel أو Cloudflare Pages) حدود تنفيذ صارمة (غالبًا من 10 إلى 30 ثانية) على مسارات HTTP العامة. نظرًا لأن حلقات الوكيل يمكن أن تستغرق وقتًا طويلاً لتشغيل الاستعلامات وجلب السياق وتنفيذ الأدوات، **يجب عليك استخدام `async: true`** عند استدعاء نقاط نهاية A2A أو التعامل مع webhooks الخارجية. يؤدي هذا على الفور إلى إرجاع حالة `working` إلى بوابة API، مع إبقاء الاتصال مفتوحًا لبضعة ميلي ثانية فقط، بينما يقوم `/process-task` POST الذي يتم تشغيله ذاتيًا بتنفيذ حلقة الوكيل في الخلفية. لا تقم بحظر طلب HTTP الأساسي في انتظار انتهاء حلقة الوكيل.

تحتوي الرسائل على أجزاء مكتوبة - يمكن للنصوص والبيانات المنظمة والملفات أن تنتقل في رسالة واحدة:

```an-annotated-code title="A2A رسالة تحتوي على أجزاء مكتوبة"
{
  "language": "json",
  "code": "{\n  \"role\": \"user\",\n  \"parts\": [\n    { \"type\": \"text\", \"text\": \"Show signups by source\" },\n    { \"type\": \"data\", \"data\": { \"dateRange\": \"last-30d\" } },\n    {\n      \"type\": \"file\",\n      \"file\": { \"name\": \"report.csv\", \"mimeType\": \"text/csv\", \"bytes\": \"...\" }\n    }\n  ]\n}",
  "annotations": [
    {
      "lines": "4",
      "label": "جزء النص",
      "note": "تعليمات بسيطة باللغة الطبيعية يقرأها الوكيل."
    },
    {
      "lines": "5",
      "label": "جزء البيانات",
      "note": "وسيطات JSON المنظمة - على سبيل المثال نطاق زمني - تم تمريره بجانب المطالبة."
    },
    {
      "lines": "6-9",
      "label": "جزء الملف",
      "note": "قم بإرفاق ملف بالاسم، `mimeType`، وbase64 `bytes`."
    }
  ]
}
```

## العميل {#client}

تتعامل فئة `A2AClient` مع الاكتشاف والمراسلة والبث:

```ts
import { A2AClient } from "@agent-native/core/a2a";

const client = new A2AClient("https://analytics.example.com", "my-api-key");

// Discover agent capabilities
const card = await client.getAgentCard();
console.log(card.skills);

// Send a message and get a completed task
const task = await client.send({
  role: "user",
  parts: [{ type: "text", text: "Show signups by source this month" }],
});
console.log(task.status.state); // "completed"
// task.status.message is a Message object ({ role, parts }), not a string.
// Pull text out of its parts:
const reply = task.status.message?.parts
  .filter((p) => p.type === "text")
  .map((p) => p.text)
  .join("");
console.log(reply); // agent's response text

// Stream responses for long-running work
for await (const update of client.stream({
  role: "user",
  parts: [{ type: "text", text: "Generate a full quarterly report" }],
})) {
  console.log(update.status.state, update.status.message);
}
```

## مساعد الراحة {#convenience-helper}

للمكالمات النصية البسيطة الواردة/الصادرة، استخدم `callAgent()`:

```ts
import { callAgent } from "@agent-native/core/a2a";

// One-shot: send text, get text back
const response = await callAgent(
  "https://analytics.example.com",
  "How many signups last week?",
  { apiKey: process.env.ANALYTICS_API_KEY },
);
console.log(response); // "There were 1,247 signups last week..."
```

## استدعاء مساحة العمل الآلية {#programmatic-invoke}

بالنسبة لمساحات العمل الأصلية للوكيل، تفضل مساعد `agentNative` عند استخدام الكود أو
يحتاج التطبيق بدون رأس إلى اكتشاف التطبيقات الشقيقة واستدعائها بواسطة المعرف أو الاسم أو
زكسق0قكسز. ويستخدم نفس الاكتشاف وبدائل استدعاء A2A مثل
الأوامر `agent-native agents` و`agent-native invoke` CLI.

```ts
import { agentNative } from "@agent-native/core/agent-native";

const agents = await agentNative.listAgents();

const result = await agentNative.invoke(
  "analytics",
  "Summarize signups by source this month.",
  { userEmail: "steve@example.com" },
);

console.log(`Called ${result.target.name}: ${result.responseText}`);
```

استخدم هذا للتطبيقات المصغرة القابلة للتركيب: يكتشف تطبيق Dispatch أو المنسق
الأخوة في مساحة العمل، ثم يستدعون التطبيق المتخصص الذي يمتلك الموفر،
مجموعة البيانات أو سير العمل. في التطبيقات الأصلية لوكيل الإنتاج، قم بتعيين `A2A_SECRET` في كل
بيئة التطبيق وتمرير هوية المتصل (`userEmail`) حتى تتم المكالمات الصادرة
تم التوقيع عليها كرموز حاملة JWT. استخدم `apiKeyEnv` فقط للأقران الخارجيين القدامى الذين
توقع رمزًا مميزًا لحامل ثابت. استخدم actions المحلي بدلاً من استدعاء نفسك.

## دورة حياة المهمة {#task-lifecycle}

تنشئ كل رسالة مهمة تنتقل عبر هذه الحالات:

`submitted` → `working` → `completed` | `failed` | `canceled` | `input-required`

`input-required` غير طرفية: المعالج ينتظر المزيد من المعلومات من المتصل، ويمكن للمهمة العودة إلى `working` بمجرد وصول هذا الإدخال.

| الولاية          | المعنى                                             |
| ---------------- | -------------------------------------------------- |
| `submitted`      | تم إنشاء المهمة، ووضعها في قائمة الانتظار للمعالجة |
| `working`        | يقوم المعالج بمعالجة الرسالة                       |
| `completed`      | انتهى المعالج بنجاح                                |
| `failed`         | ألقى المعالج خطأً                                  |
| `canceled`       | تم إلغاء المهمة عبر المهام/الإلغاء                 |
| `input-required` | يحتاج المعالج إلى مزيد من المعلومات من المتصل      |

تظل المهام موجودة في الجدول `a2a_tasks` SQL ويمكن استرجاعها لاحقًا عبر `tasks/get`.

## الأمان {#security}

قم بتعيين `A2A_SECRET` على كل تطبيق إنتاج يتصل أو يستقبل حركة مرور A2A. يقوم المتصلون من الوكيل الأصليون بتوقيع الرموز المميزة لحامل JWT بهذا السر حتى يتمكن المستلمون من التحقق من هوية المتصل قبل بدء حلقة الوكيل.

بالنسبة للأقران الخارجيين الذين ما زالوا يستخدمون رمزًا مميزًا ثابتًا مشتركًا، قم بتعيين `apiKeyEnv` في التكوين الخاص بك على اسم متغير البيئة الذي يحتوي على الرمز المميز للحامل المتوقع:

```ts
// Config
mountA2A(app, {
  // ...
  apiKeyEnv: "A2A_API_KEY", // reads process.env.A2A_API_KEY
});

// Client calls with the matching key
const client = new A2AClient(url, process.env.A2A_API_KEY);
```

تكون نقطة نهاية بطاقة الوكيل عامة دائمًا (بدون مصادقة) حتى يتمكن الوكلاء الآخرون من اكتشاف الإمكانات. تقبل نقطة النهاية `/_agent-native/a2a` JSON-RPC الرموز الحاملة JWT الموقعة بواسطة `A2A_SECRET`، كما تقبل أيضًا الرمز المميز `apiKeyEnv` القديم عند تكوينه. في التنمية المحلية، يمكن حذف المصادقة؛ في أوقات تشغيل الإنتاج المستضافة، يؤدي فقدان مصادقة A2A إلى إرجاع 503 بدلاً من التشغيل دون مصادقة.

### حدود سياسة المصادقة {#auth-policy}

يتم تشغيل التحقق من صحة الحامل عند حدود الطلب — في معالج JSON-RPC — قبل أن ترى حلقة الوكيل الرسالة. يقرر المساعدون المشتركون في `packages/core/src/a2a/auth-policy.ts` ما يتطلبه النشر:

- يُرجع `isA2AProductionRuntime()` `true` على Netlify وAWS Lambda وCloudflare Pages/Workers وVercel وRender وFly وCloud Run - حتى عندما لا يكون `NODE_ENV` `"production"`. لا يقوم بعض موفري الخدمة بدون خادم بتعيين `NODE_ENV` بشكل متسق، لذا تقرأ السياسة العلامات الخاصة بموفر الخدمة أيضًا.
- ترجع `hasConfiguredA2ASecret()` `true` عند ضبط `A2A_SECRET`.
- `shouldAdvertiseJwtA2AAuth()` هو ما تستخدمه بطاقة الوكيل لتحديد ما إذا كان سيتم نشر نظام أمان `jwtBearer` أم لا.

سياسة الإنتاج صارمة: في أي وقت تشغيل للإنتاج، يرفض مسار `_process-task` غير المتزامن الإرسال ما لم يتم تكوين `A2A_SECRET` (إرجاع 503)، وترفض نقطة النهاية JSON-RPC المكالمات غير المصادق عليها. يتم تشغيل الإجراء الاحتياطي للتطوير (التحذير مرة واحدة، والسماح) فقط عند عدم تعيين علامة إنتاج.

هذا الحد مهم لأن حلقة الوكيل تقبل الإدخال الحر من المتصل البعيد. إن وضع فحص الحامل داخل الحلقة، أو الاعتماد على أداة لفرضه، من شأنه أن يسمح للحقن الفوري أو معالج عربات التي تجرها الدواب بتجاوز المصادقة. إن إبقائه عند حدود HTTP يعني حدوث فشل في دوائر القصر قبل أي استدعاء LLM.

يقبل التحقق من JWT (`verifyA2AToken` في `server.ts`) الرموز المميزة الموقعة إما باستخدام `A2A_SECRET` العام أو سر على مستوى المؤسسة تم البحث عنه من SQL عبر مطالبة الرمز المميز `org_domain`، ويفرض مطالبات `aud`/`iss` الخاصة بالرمز المميز عند وجودها.

## الاستمرارية {#continuations}

عندما يستدعي الوكيل نظير A2A البعيد الذي لا يعود على الفور، يقوم إطار العمل باستقصاء `tasks/get` حتى تستقر المهمة. ويتم توصيل ذلك عبر `A2AClient.sendAndWait`، وهو الوضع الافتراضي الذي يستخدمه مساعد `callAgent()`.

```ts
// Default: async + poll (safe on serverless hosts)
const reply = await callAgent(url, "Generate the quarterly report", {
  userEmail: session.email,
});

// Single-shot blocking POST (avoid on Netlify/Vercel for slow handlers)
const reply2 = await callAgent(url, "Quick lookup", { async: false });
```

بالنسبة للاستمرارية الواردة التي يتم تشغيلها عن طريق تكامل المراسلة (Slack، البريد الإلكتروني)، يحافظ إطار العمل على الاستمرارية في SQL ويعالجها خارج النطاق:

- تتم كتابة صف في الجدول `a2a_continuations` عندما يقوم معالج التكامل بتسليم الوكيل البعيد.
- تطالب `POST /_agent-native/integrations/process-a2a-continuation` ذاتية التشغيل بالصف، وتستدعي `tasks/get` على الوكيل البعيد، وتقوم إما بتسليم الرد إلى محول التكامل أو إعادة الجدولة.
- إذا كانت المهمة البعيدة لا تزال تعمل، فستتم إعادة جدولة الصف وإعادة إرساله. ميزانية الاستطلاع **تحدها ~20 دقيقة من العمل عن بعد** (`MAX_REMOTE_WORK_MS`) و **30 محاولة إرسال** (`MAX_ATTEMPTS`)؛ بعد أي من الحدين، تفشل المتابعة مع وجود خطأ واضح ويحصل المستخدم على الرد "لم يستجب الوكيل في الوقت المناسب".
- تقوم أداة الكنس المتكررة (`claimDueA2AContinuations`) بإعادة المطالبة بأي صفوف استمرارية تم تركها أثناء الطيران عند توقف تنفيذ الوظيفة السابقة. حتى إذا تعطل تطبيق الاتصال في منتصف الاستطلاع، فإن علامة المسح التالية تستأنف العمل.

محدد في `packages/core/src/integrations/a2a-continuation-processor.ts`. يتم استخدام نفس نمط إعادة محاولة المهمة لمهام خطاف الويب التكاملي (`pending-tasks-retry-job.ts`)، وهي قائمة انتظار مميزة بحد أقصى 3 محاولات — منفصلة عن ميزانية استطلاع الاستمرار أعلاه.

## مساحة العمل A2A {#workspace-a2a}

في مساحة عمل متعددة التطبيقات تم نشرها على موقع Netlify واحد (راجع [multi-app workspace](/docs/multi-app-workspace))، يتم تسجيل كل تطبيق ضمن `apps/<id>/` تلقائيًا كنظير A2A:

- يتم تثبيت `A2A_SECRET` مشترك في بيئة كل تطبيق في وقت الإنشاء.
- المكالمات عبر التطبيقات هي من نفس المصدر — `https://workspace.example.com/apps/analytics` تستدعي `https://workspace.example.com/apps/mail` — لذا لا يوجد إعداد DNS أو CORS أو JWT لكل زوج.
- تحمل المكالمات الصادرة الموقعة باستخدام السر المشترك البريد الإلكتروني للمتصل كـ `sub` ومجال المؤسسة (في حالة وجوده). تقبل أداة التحقق JWT الخاصة بالمستلم إما السر المشترك أو السر على مستوى المؤسسة من SQL، بهذا الترتيب.
- يقوم اكتشاف الوكيل بالتجول في سجل مساحة العمل بدلاً من الاعتماد على المشغل لتوصيل كل نظير يدويًا. راجع `discoverAgents` في `packages/core/src/server/agent-discovery.ts` ومسار تحديث المؤسسة في `packages/core/src/org/handlers.ts`.

لا تزال A2A الخارجية - المكالمات إلى الوكلاء خارج مساحة العمل الخاصة بك - تستخدم نموذج الرمز المميز لحاملها (`apiKeyEnv` + `A2AClient(url, apiKey)`). مساحة العمل A2A موضوعة في الأعلى؛ لا شيء يتغير بشأن الأقران الخارجيين.

## مشاكل بدون خادم {#serverless}

**لا تعتمد أبدًا على `Promise` الذي يعمل بنظام "أطلق وانسى" الذي يدوم لفترة أطول من الاستجابة.** تعمل الوظائف بدون خادم (Netlify وVercel وAWS Lambda وCloud Run) على تجميد لحظة مسح نص الاستجابة - في بعض الأحيان قبل اكتمال مصافحة TCP لـ `fetch(...)` غير المنتظر. الأنماط التي تعمل محليًا على Node ستتوقف عن العمل في الإنتاج بصمت.

نمط إطار العمل، المستخدم من قبل كل من الإرسال غير المتزامن A2A و[integration webhook queue](/docs/messaging)، هو:

1. اقبل الطلب، واستمر في تنفيذ ما يجب أن يحدث لـ SQL، وأعد 200 على الفور.
2. قم بإطلاق `POST` ذاتيًا إلى مسار إطار عمل منفصل (`/_agent-native/a2a/_process-task` أو `/_agent-native/integrations/process-task`) بحيث يتم تشغيل العمل الفعلي في **تنفيذ وظيفة جديدة** مع مهلة كاملة خاصة به.
3. توثيق إطلاق النار الذاتي باستخدام رمز HMAC المرتبط بمعرف الصف، الموقع بـ `A2A_SECRET`.
4. تقوم مهمة إعادة المحاولة المتكررة بمسح أي صفوف تمت المطالبة بها ولكن لم يتم الانتهاء منها، لذلك لا تؤدي الوظيفة المتعطلة إلى تعطيل العمل.

عندما تكتب معالج A2A أو محول التكامل الخاص بك، اتبع نفس الشكل. ولا تربط العمل بالوعد المنفصل بعد `return`. إذا كان عليك إطلاق النار ذاتيًا من معالج بدون خادم، فابدأ في الجلب قبل العودة وامنحه بداية صغيرة (يستخدم إطار العمل مهلة قصيرة) حتى لا تتجمد أوقات التشغيل بنمط Lambda قبل أن يغادر الطلب الصادر العملية. تعتبر مهارة `integration-webhooks` هي المرجع الأساسي.

## إشارات الوكيل {#agent-mentions}

يمكنك الإشارة إلى الوكلاء في `@` مباشرةً في مؤلف الدردشة. يستخدم الوكلاء المتصلون A2A: عندما تذكر وكيلًا متصلاً، يقوم الخادم بإجراء مكالمة A2A لذلك الوكيل وينسج الاستجابة في سياق المحادثة الخاصة بك.

تختلف وكلاء مساحة العمل المخصصة: فهي تعمل محليًا داخل التطبيق/وقت التشغيل الحالي بدلاً من تشغيلها عبر A2A.

راجع [Agent Mentions](/docs/agent-mentions) للحصول على تفاصيل حول كيفية عمل الإشارات، وكيفية إضافة وكلاء، وكيفية إنشاء موفري إشارات مخصصة.

## عمليات تكامل المراسلة {#messaging-integrations}

يمكن أيضًا الوصول إلى الوكلاء من منصات المراسلة الخارجية مثل Slack والبريد الإلكتروني وTelegram وWhatsApp. يرسل المستخدمون رسائل على تلك الأنظمة الأساسية ويستجيب الوكيل في نفس الموضوع، باستخدام نفس الأدوات وactions مثل الدردشة عبر الويب.

راجع [Messaging](/docs/messaging) للحصول على تفاصيل الإعداد على كل نظام أساسي.

## مثال: استعلام عبر الوكلاء {#example}

يحتاج وكيل البريد إلى بيانات تحليلية. يكشف وكيل التحليلات عن مهارة "تشغيل الاستعلام" عبر A2A:

```ts
// In the mail agent's actions/get-analytics.ts
import { defineAction } from "@agent-native/core/action";
import { callAgent } from "@agent-native/core/a2a";
import { z } from "zod";

export default defineAction({
  description: "Ask the analytics agent a question.",
  schema: z.object({ question: z.string() }),
  async run({ question }) {
    const response = await callAgent(
      "https://analytics.example.com",
      question,
      { apiKey: process.env.ANALYTICS_API_KEY },
    );
    return { answer: response };
  },
});
```

يتلقى وكيل التحليلات الرسالة، ويقوم بتشغيل الاستعلام عبر معالجه، ويعيد النتيجة. يقوم إجراء البريد باستعادة الاستجابة النصية. لا توجد قاعدة بيانات مشتركة، ولا توجد مكالمات API مباشرة - فقط اتصال من وكيل إلى وكيل.
