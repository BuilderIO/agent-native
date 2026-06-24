---
title: "الأتمتة"
description: "عمليات التشغيل التلقائي المجدولة والمشغلة بالحدث مع ظروف اللغة الطبيعية"
---

# الأتمتة

**الأتمتة** هي قاعدة: _عندما يحدث X، افعل Y_ — موصوفة باللغة الطبيعية. ينفذ الوكيل التعليمات، بحيث يكون للتشغيل الآلي حق الوصول إلى كل إجراء وأداة وخادم MCP الذي يمكن للوكيل استخدامه في الدردشة التفاعلية.

توسّع عمليات التشغيل الآلي [recurring jobs](/docs/recurring-jobs) من خلال **مشغلات الأحداث** و**شروط اللغة الطبيعية** و**HTTP** الصادرة عبر أداة `web-request`. إنهم يستخدمون نفس تنسيق الملف `jobs/<name>.md` والتخزين وسير العمل "إنشاء ثلاث طرق" كمهام متكررة - راجع [Recurring Jobs](/docs/recurring-jobs#job-file) للتعرف على التنسيق المشترك. تغطي هذه الصفحة فقط ما هو جديد في عمليات التشغيل الآلي المستندة إلى الأحداث.

```an-diagram title="When X happens, do Y" summary="An event fires on the bus, an optional natural-language condition gates it, and the agent runs the automation body with full tool access."
{
  "html": "<div class=\"auto-flow\"><div class=\"diagram-card\"><span class=\"diagram-pill\">Event</span><small class=\"diagram-muted\"><code>calendar.booking.created</code></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">Condition</span><small class=\"diagram-muted\">Haiku checks: &ldquo;email ends with @builder.io&rdquo;</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">Agent runs the body</span><small class=\"diagram-muted\">actions &middot; web-request &middot; MCP &middot; sub-agents</small></div></div>",
  "css": ".auto-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.auto-flow .diagram-card{display:flex;flex-direction:column;gap:4px;padding:14px 16px;min-width:180px}.auto-flow .diagram-arrow{font-size:22px}"
}
```

## نوعان من المشغلات {#trigger-types}

| اكتب       | يتم تشغيله عند                               | حقل المفتاح       |
| ---------- | -------------------------------------------- | ----------------- |
| `schedule` | يتطابق تعبير cron (مثل المهام المتكررة)      | `schedule` (كرون) |
| `event`    | يتم إطلاق حدث مطابق في ناقل أحداث إطار العمل | `event` (الاسم)   |

يمكن أن تتضمن مشغلات الأحداث `condition` — سلسلة باللغة الطبيعية يتم تقييمها بواسطة Haiku مقابل حمولة الحدث قبل الإرسال. إذا لم يتطابق الشرط، فسيتم تخطي التشغيل التلقائي بصمت.

## إنشاء عمليات التشغيل الآلي {#creating}

### من خلال سؤال الوكيل

> "عندما يحجز شخص ما اجتماعًا باستخدام بريد إلكتروني @builder.io، أرسل لي رسالة على Slack."

يكتشف الوكيل الأحداث المتاحة، ويؤكد الخطة، ويكتب لك الأتمتة.

### من الإعدادات UI

تظهر عمليات التشغيل التلقائي في لوحة الإعدادات. يمكن للمستخدمين عرضها وتمكينها/تعطيلها وحذفها هناك.

المسار الثالث - كتابة ملف `jobs/<name>.md` يدويًا عبر `resourcePut` - يعمل تمامًا كما هو الحال مع [recurring jobs](/docs/recurring-jobs#creating). للحصول على أتمتة تعتمد على الحدث، يمكنك إضافة المادة الأمامية لمشغل الحدث أدناه إلى نفس الملف. تقوم المهمة التي يتم تشغيلها بواسطة حدث بتعيين `schedule: ""` وتوفر `triggerType: event` واسم `event` و`condition` اختياري:

```an-annotated-code title="An event-triggered automation"
{
  "filename": "jobs/slack-on-builder-booking.md",
  "language": "markdown",
  "code": "---\nschedule: \"\"\nenabled: true\ntriggerType: event\nevent: calendar.booking.created\ncondition: \"attendee email ends with @builder.io\"\nmode: agentic\ndomain: calendar\nrunAs: creator\n---\nSend a Slack message to #sales with the booking details.\nUse the web-request tool to POST to ${keys.SLACK_WEBHOOK}.",
  "annotations": [
    { "lines": "2", "label": "No cron", "note": "Event triggers set `schedule` to `\"\"` — the cron field stays empty." },
    { "lines": "4-5", "label": "The trigger", "note": "`triggerType: event` plus the `event` name subscribes this automation to the bus." },
    { "lines": "6", "label": "Gate", "note": "An optional natural-language `condition`, evaluated by Haiku against the payload before dispatch." },
    { "lines": "12", "label": "Server-side secret", "note": "`${keys.SLACK_WEBHOOK}` is resolved server-side — the raw value never enters the agent's context." }
  ]
}
```

## الأتمتة الأمامية {#frontmatter}

تشارك عمليات التشغيل الآلي كل حقل في [recurring-jobs frontmatter table](/docs/recurring-jobs#frontmatter). تتحكم هذه الحقول الإضافية في مشغلات الأحداث وشروطها ووضع التنفيذ:

| الحقل         | اكتب                             | الافتراضي    | الوصف                                                                                                                                                               |
| ------------- | -------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `triggerType` | `"schedule"` \| `"event"`        | `"schedule"` | كيفية تشغيل الأتمتة                                                                                                                                                 |
| `event`       | سلسلة                            | _(اختياري)_  | اسم الحدث المطلوب الاشتراك فيه (مشغّلات الحدث فقط)                                                                                                                  |
| `condition`   | سلسلة                            | _(اختياري)_  | تم تقييم حالة اللغة الطبيعية قبل الإرسال                                                                                                                            |
| `mode`        | `"agentic"` \| `"deterministic"` | `"agentic"`  | حلقة الوكيل الكاملة. (`"deterministic"` محجوز ولكن لم يتم تنفيذه بعد — يتم تخطي عمليات الأتمتة التي تقوم بتعيينه. استخدم `"agentic"` لجميع عمليات الأتمتة الحالية.) |
| `domain`      | سلسلة                            | _(اختياري)_  | علامة التجميع (البريد، التقويم، المقاطع، إلخ.)                                                                                                                      |

بالنسبة لمشغل الحدث، `schedule` هو `""` (فارغ)؛ بالنسبة لمشغل الجدول الزمني فإنه يحمل تعبير cron. يكتب المرسل أيضًا نفس حقول `lastRun` / `lastStatus` / `lastError` المُدارة التي يكتبها المجدول، بالإضافة إلى حالة `"skipped"` عندما يتم تقييم الشرط إلى خطأ.

## حافلة الأحداث {#event-bus}

تقوم عمليات التكامل بتسجيل الأحداث في وقت تحميل الوحدة. تقوم الحافلة بالتحقق من صحة الحمولات مقابل تعريفات [Standard Schema](https://standardschema.dev) وإرسالها إلى المشتركين.

### الأحداث المضمنة {#built-in-events}

| الحدث                  | المصدر                                          |
| ---------------------- | ----------------------------------------------- |
| `test.event.fired`     | يدوي / إجراء `manage-automations`=اختبار الحريق |
| `agent.turn.completed` | دردشة الوكيل                                    |
| `calendar.*`           | تكامل التقويم                                   |
| `clip.*`               | تكامل المقاطع                                   |
| `mail.*`               | تكامل البريد                                    |

اتصل بـ `manage-automations` مع `action=list-events` من الوكيل لرؤية جميع الأحداث المسجلة مع الأوصاف ومخططات الحمولة للقالب الحالي.

### إصدار أحداث مخصصة {#emitting-events}

قم بتسجيل نوع الحدث في مكون إضافي للخادم، ثم قم بإصداره من actions أو معالجات خطاف الويب:

```ts
import { registerEvent, emit } from "@agent-native/core/event-bus";
import { z } from "zod";

// Register the event type (once, at module load)
registerEvent({
  name: "order.completed",
  description: "A customer completed an order",
  payloadSchema: z.object({
    orderId: z.string(),
    customerEmail: z.string(),
    total: z.number(),
  }),
  example: {
    orderId: "ord_123",
    customerEmail: "jane@example.com",
    total: 49.99,
  },
});

// Emit the event (from an action, webhook handler, etc.)
emit(
  "order.completed",
  {
    orderId: "ord_123",
    customerEmail: "jane@example.com",
    total: 49.99,
  },
  { owner: "steve@builder.io" },
);
```

`owner` في نطاقات البيانات التعريفية المنبعثة التي تطلق عمليات التشغيل الآلي - يتم تقييم عمليات التشغيل الآلي المملوكة لنفس المستخدم (أو عمليات التشغيل الآلي المشتركة) فقط.

## الشروط {#conditions}

الشروط هي سلاسل باللغة الطبيعية يتم تقييمها بواسطة Claude Haiku مقابل حمولة الحدث. هذا تصنيف نعم/لا، وليس مهمة إنشاء.

- **شرط فارغ أو مفقود** = غير مشروط (يتم تفعيله دائمًا).
- يتم حفظ النتائج (SHA-256 للحالة + الحمولة) باستخدام ذاكرة تخزين مؤقت TTL مدتها 5 دقائق وذاكرة تخزين مؤقت LRU مكونة من 500 إدخال.
- يتم اقتطاع الحمولة إلى 4000 حرف قبل إرسالها إلى Haiku.
- في حالة فشل API، يتم تقييم الحالة إلى `false` (الافتراضي الآمن - يتم تخطي التنفيذ التلقائي).

أمثلة على الشروط:

- `"attendee email ends with @builder.io"`
- `"the order total is greater than $100"`
- `"the message contains the word 'urgent'"`

## أداة طلب الويب {#web-request}

تستخدم عمليات التشغيل الآلي أداة `web-request` لـ HTTP الصادرة. وهو يدعم العناصر النائبة `${keys.NAME}` في URL والرؤوس والنص:

```
POST to ${keys.SLACK_WEBHOOK}

Headers: {"Authorization": "Bearer ${keys.API_TOKEN}"}

Body: {"text": "New booking from ${attendeeEmail}"}
```

يتم حل العناصر النائبة **من جانب الخادم** بعد أن يرسل الوكيل استدعاء الأداة — لا تدخل القيمة السرية الأولية مطلقًا في سياق الوكيل.

### المعلمات {#web-request-params}

| المعلمة      | اكتب  | الافتراضي | الوصف                                             |
| ------------ | ----- | --------- | ------------------------------------------------- |
| `url`        | سلسلة | —         | URL كامل. قد يحتوي على مراجع `${keys.NAME}`.      |
| `method`     | سلسلة | `GET`     | طريقة HTTP (GET، POST، PUT، PATCH، DELETE، HEAD). |
| `headers`    | سلسلة | `{}`      | كائن JSON للرؤوس. قد يحتوي على `${keys.NAME}`.    |
| `body`       | سلسلة | —         | نص الطلب. قد يحتوي على `${keys.NAME}`.            |
| `timeout_ms` | الرقم | 15000     | المهلة بالمللي ثانية (30000 كحد أقصى).            |

## المفاتيح {#keys}

المفاتيح هي أسرار مخصصة تم إنشاؤها بواسطة المستخدمين أو الوكيل لاستخدام التشغيل الآلي (على سبيل المثال، `SLACK_WEBHOOK`، `HUBSPOT_API_KEY`). وهي تختلف عن الأسرار المسجلة (`registerRequiredSecret`) من حيث أنها لا تحتوي على بيانات وصفية محددة في القالب أو خطوة إعداد.

- تم الإنشاء عبر الإعدادات UI أو `/_agent-native/secrets/adhoc` API.
- يمكن أن يحتوي كل مفتاح على **قائمة مسموح بها URL** تقيد المصادر التي يمكن إرسال المفتاح إليها (المطابقة على مستوى الأصل).
- لا يتم عرض القيمة الأولية مطلقًا للذكاء الاصطناعي - تظهر فقط العناصر النائبة `${keys.NAME}` في سياق الوكيل.
- يرجع القرار من نطاق المستخدم إلى نطاق مساحة العمل، حتى يتمكن المستخدمون من تجاوز المفاتيح المشتركة.

## أدوات الوكيل {#agent-tools}

يتم الوصول إلى كافة عمليات التشغيل الآلي من خلال أداة `manage-automations` واحدة باستخدام معلمة `action`:

| الإجراء       | الغرض                                                               |
| ------------- | ------------------------------------------------------------------- |
| `list-events` | اكتشف جميع الأحداث المسجلة مع الأوصاف ومخططات الحمولة               |
| `list`        | سرد جميع عمليات الأتمتة ذات الحالة؛ التصفية حسب المجال أو التمكين   |
| `define`      | إنشاء آلية جديدة (الاسم، نوع المشغل، الحدث، الحالة، النص)           |
| `update`      | تحديث آلية موجودة (ممكّنة، الحالة، النص)                            |
| `delete`      | حذف عملية تلقائية (يتم التأكيد دائمًا مع المستخدم أولاً)            |
| `fire-test`   | قم بإصدار حدث `test.event.fired` للتحقق من صحة عمليات التشغيل الآلي |

أداة إضافية: `web-request` — HTTP للخارج مع استبدال `${keys.NAME}`.

## نقاط نهاية API {#api}

| نقطة النهاية                           | الطريقة | الوصف                                              |
| -------------------------------------- | ------- | -------------------------------------------------- |
| `/_agent-native/automations`           | GET     | سرد جميع عمليات التشغيل التلقائي (التي تم تحليلها) |
| `/_agent-native/automations/fire-test` | POST    | أصدر حدث `test.event.fired`                        |
| `/_agent-native/secrets/adhoc`         | GET     | قائمة المفاتيح المخصصة (بدون قيم)                  |
| `/_agent-native/secrets/adhoc`         | POST    | إنشاء أو تحديث مفتاح مخصص                          |
| `/_agent-native/secrets/adhoc/:name`   | DELETE  | حذف مفتاح مخصص                                     |

```an-api title="Fire a test event"
{
  "method": "POST",
  "path": "/_agent-native/automations/fire-test",
  "summary": "Emit a test.event.fired event to validate event-triggered automations",
  "description": "Confirm an automation's wiring and condition without waiting for a real provider event. Equivalent to the `manage-automations` action `fire-test`.",
  "responses": [
    { "status": "200", "description": "Event emitted; matching automations are dispatched through the normal condition + ownership path." }
  ]
}
```

## كيف يعمل الإرسال {#dispatch}

```an-diagram title="The dispatch path" summary="From a fired event to a completed agent run, gated by ownership scope and the natural-language condition."
{
  "html": "<div class=\"disp\"><div class=\"diagram-box accent\">event fired on the bus</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">match</span><small class=\"diagram-muted\">load enabled automations subscribed to this event name</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">scope</span><small class=\"diagram-muted\">keep only those owned by the event's owner (or shared)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">condition</span><small class=\"diagram-muted\">Haiku yes/no on the payload &mdash; false &rarr; <code>skipped</code></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">run</span><small class=\"diagram-muted\"><code>runAgentLoop</code> with body as prompt, payload as context, 5-min timeout</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card ok\"><span class=\"diagram-pill ok\">record</span><small class=\"diagram-muted\">write <code>lastRun</code> / <code>lastStatus</code> / <code>lastError</code></small></div></div>",
  "css": ".disp{display:flex;flex-direction:column;gap:6px;max-width:540px}.disp .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.disp .diagram-box{align-self:flex-start}.disp .diagram-arrow{font-size:18px;align-self:center}"
}
```

## مثال {#example}

**المستخدم:** "عندما يقوم شخص ما بالحجز باستخدام بريد إلكتروني @builder.io، أرسل لي رسالة على Slack."

**تدفق الوكيل:**

1. استدعاء `manage-automations` باستخدام `action=list-events` — العثور على `calendar.booking.created`.
2. تأكيد الخطة مع المستخدم.
3. استدعاء `manage-automations` مع `action=define`:
   - `name`: `slack-on-builder-booking`
   - `trigger_type`: `event`
   - `event`: `calendar.booking.created`
   - `condition`: `attendee email ends with @builder.io`
   - `mode`: `agentic`
   - `domain`: `calendar`
   - `body`: `Send a Slack message to #sales with the booking details. Use the web-request tool to POST to ${keys.SLACK_WEBHOOK}.`
4. يتم حفظ التشغيل الآلي باسم `jobs/slack-on-builder-booking.md` ويبدأ الاستماع على الفور.

## مزيد من الأمثلة {#more-examples}

### الإخطار عبر الرد التلقائي على الويب عند التعليق على الخطة

اسأل وكيل الخطة: _"عندما يضيف شخص ما تعليقًا بشريًا على الخطة، POST a
إشعار بخطاف الويب الخاص بي."_

```yaml
---
triggerType: event
event: plan.commented
condition: "resolutionTarget is human or resolutionTarget is null"
mode: agentic
domain: plan
enabled: true
---

POST to ${keys.NOTIFY_WEBHOOK} with a JSON body:
{"title": "<plan title>", "excerpt": "<comment excerpt>", "author": "<author email or null>", "url": "<app base url + path>"}
```

قم بتعيين `NOTIFY_WEBHOOK` على أي نقطة نهاية HTTP — خطاف ويب وارد Slack، وهو خطاف عام
خدمة إعلام، أو جهاز استقبال مخصص. تقوم أداة `web-request` بحل المشكلة
`${keys.NOTIFY_WEBHOOK}` من جانب الخادم؛ لا يظهر URL الخام أبدًا في
السياق. انظر [Visual Plans — Events and notifications](/docs/template-plan#events)
للاطلاع على مرجع الحمولة النافعة `plan.commented` الكامل وجميع أحداث الخطة الأربعة.

## ما هي الخطوة التالية

- [**Recurring Jobs**](/docs/recurring-jobs) — تعيد عمليات التشغيل الآلي التي يتم تشغيلها بالجدول الزمني استخدام نفس المجدول
- [**Actions**](/docs/actions) — يمكن للأتمتة استدعاء أي إجراء مسجل عبر حلقة الوكيل
- [**Security**](/docs/security) — التحقق من صحة الإدخال والمعالجة السرية
- [**Visual Plans — Events**](/docs/template-plan#events) — مرجع التخطيط للأحداث ووصفات التشغيل الآلي
