---
title: "وكلاء تسخير"
description: "قم بتشغيل Claude Code، وCodex، وPi، وغيرها من أدوات الترميز الكاملة كوكلاء مضمنين داخل Agent-Native، مع الحلقة الخاصة بهم، ووضع الحماية، والأدوات الأصلية، وجلسات SQL المدعومة القابلة للاستئناف."
search: "وكلاء تسخير AgentHarness ai-sdk رمز HarnessAgent Claude Codex Pi Cursor Mastra وكيل الترميز المضمن ResolveAgentHarness startAgentHarnessRun أدوات مضيف وضع الحماية للجلسة القابلة للاستئناف"
---

# وكلاء تسخير

> **من هو هذا:** المؤلفون المضيفون يقومون بتوصيل وقت تشغيل كامل للترميز (رمز Claude،
> Codex, Pi) إلى Agent-Native كوكيل. بناء التطبيق؟ ابدأ بـ
> [Creating Templates](/docs/creating-templates).

وكيل التسخير هو وقت تشغيل كامل للوكيل — رمز Claude، وCodex، وPi، وما شابه ذلك —
يمتلك حلقة خاصة به، ومساحة عمل، وأدوات ملفات أصلية، وحالة الجلسة، والضغط،
نموذج الموافقة وسلوك وضع الحماية. يقوم Agent-Native بتشغيل هذه من خلال
**`AgentHarness`** الركيزة في `@agent-native/core/agent/harness`، تتدفق
تدرج الأحداث في النص العادي، وتستمر في جلستها الأصلية بحيث تكون سلسلة رسائل
يمكن إيقافه مؤقتًا واستئنافه.

يختلف هذا عن وكيل الدردشة المدمج وعن إحضار الدردشة الخاصة بك
وقت التشغيل. الوكيل المدمج و`AgentEngine` مخصصان لنموذج واحد ذهابًا وإيابًا
أسفل `runAgentLoop`. الحزام ليس مزود `AgentEngine` - فهو يقوم بتشغيل
حلقة خاصة بها من البداية إلى النهاية، لذا فإن Agent-Native يقودها كجلسة، وليس كجلسة واحدة
استدعاء النموذج.

```an-diagram title="يمتلك الحزام حلقته. Agent-Native يقود الجلسة" summary="تقوم الركيزة AgentHarness creates/resumes بالجلسة الأصلية، بتدفق أحداثها إلى النص العادي، وتستمر في حالة الاستئناف في SQL بين المنعطفات."
{
  "html": "<div class=\"diagram-harness\"><div class=\"diagram-box\" data-rough><strong>AgentHarness substrate</strong><small class=\"diagram-muted\">@agent-native/core/agent/harness</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><strong>Native harness loop</strong><small class=\"diagram-muted\">Claude Code · Codex · Pi — own tools, sandbox, compaction</small></div><div class=\"diagram-col\"><div class=\"diagram-pill accent\">events &rarr; transcript</div><div class=\"diagram-pill ok\">resumeState &rarr; SQL session</div></div></div>",
  "css": ".diagram-harness{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-harness .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-harness .diagram-arrow{font-size:22px;line-height:1}.diagram-harness .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## ما هو مستند البرمجة الذي أريده؟ {#which-doc}

| تريد...                                                                        | استخدام                                      |
| ------------------------------------------------------------------------------ | -------------------------------------------- |
| تشغيل Claude Code / Codex / Pi **كوكيل**، باستخدام الحلقة + الأدوات الخاصة بهم | **وكلاء الاستفادة** (هذه الصفحة)             |
| عرض نمط Claude/Codex **مساحة عمل الترميز UI**                                  | [Agent-Native Code UI](/docs/code-agents-ui) |
| قم بتبديل الواجهة الخلفية التي تقوم بتشغيل **أداة `run-code`**                 | [Adapters](/docs/sandbox-adapters)           |
| قم بلف أداة CLI (`gh`، `ffmpeg`) ليتصل بها الوكيل                              | [Adapters](/docs/sandbox-adapters)           |

الأسطح المجاورة: ضع الوكيل الذي أنشأته في مكان آخر خلف دردشة Agent-Native
UI مع [`AgentChatRuntime`](/docs/native-chat-ui#byo-agent-runtimes)؛ دع
مكالمة مضيف MCP خارجية إلى تطبيقك عبر [External Agents](/docs/external-agents)؛
يتم تشغيل الخلفية/الوكيل الفرعي باستخدام [Custom Agents & Teams](/docs/agent-teams).

## أدوات مساعدة مدمجة {#built-in}

يسجل `registerBuiltinAgentHarnesses()` ثلاثة محولات مدعومة بـ AI SDK
`HarnessAgent`:

| الاسم                        | وقت التشغيل | وضع الحماية | الموافقات |
| ---------------------------- | ----------- | ----------- | --------- |
| `ai-sdk-harness:claude-code` | رمز Claude  | نعم         | نعم       |
| `ai-sdk-harness:codex`       | Codex       | نعم         | لا        |
| `ai-sdk-harness:pi`          | باي         | لا          | نعم       |

حزم وقت التشغيل الخاصة بها هي **تبعيات نظير اختيارية** ويتم تحميلها ببطء، لذا
التطبيق الذي لا يستخدم أداة التثبيت مطلقًا لا يدفع ثمنه. يحمل كل محول
تلميح `installPackage` (على سبيل المثال `@ai-sdk/harness@canary
@ai-sdk/harness-codex@canary`); `resolveAgentHarness` يُجري تثبيتًا واضحًا
خطأ إذا كانت الحزم مفقودة، و`isAgentHarnessPackageInstalled(entry)`
يتيح لك التحقق أولاً.

يسجل `registerBuiltinAgentHarnesses()` أيضًا أحزمة [ACP](#acp)
(`acp`, `acp:gemini`, `acp:claude-code`).

## وكلاء ACP {#acp}

يمكن أن يعمل Agent-Native كعميل [ACP](https://agentclientprotocol.com) (العميل
البروتوكول) **العميل** وقيادة وكيل الترميز المحلي — Gemini CLI، Claude Code،
أو أي وكيل متوافق مع ACP — من خلال نفس الركيزة. يعمل الوكيل باعتباره
عملية فرعية محلية تتحدث JSON-RPC مفصولة بسطر جديد عبر stdio؛ محرر ACP
↔ نموذج الوكيل هو هذا الشكل بالضبط.

تم تحديد نطاق هذا المحول لـ **الترميز المحلي**. ترث العملية الفرعية
البيئة الأصلية، لذلك يقوم الوكيل بإعادة استخدام أي معلومات تسجيل دخول CLI محلية لديه بالفعل
(على سبيل المثال، مصادقة `gemini` أو `claude` في الدليل الرئيسي للمستخدم). إنها ليست
نقل مستضاف أو في وضع الحماية، وهو ليس وسيلة نقل للدردشة/A2A - بالنسبة لهؤلاء،
راجع [Agent Surfaces](/docs/agent-surfaces).

| الاسم             | الأمر الافتراضي                                | قابل للاستئناف\* |
| ----------------- | ---------------------------------------------- | ---------------- |
| `acp`             | _(توريد `command`/`args` عبر التكوين)_         | نعم              |
| `acp:gemini`      | `npx -y @google/gemini-cli --experimental-acp` | نعم              |
| `acp:claude-code` | `npx -y @zed-industries/claude-code-acp`       | نعم              |

\*تعمل السيرة الذاتية عندما يعلن الوكيل عن قدرة `loadSession` و
سيتدهور إلى جلسة جديدة.

```ts
import {
  registerBuiltinAgentHarnesses,
  resolveAgentHarness,
} from "@agent-native/core/agent/harness";

registerBuiltinAgentHarnesses();

// A built-in preset (command/args are overridable through the resolve config):
const adapter = resolveAgentHarness("acp:gemini");

// Or any ACP agent by command:
const custom = resolveAgentHarness("acp", {
  command: "gemini",
  args: ["--experimental-acp"],
});
```

يعد نقل البروتوكول (`@zed-industries/agent-client-protocol`) اختياريًا
يتم تحميل التبعيات ببطء من خلال تلميح `installPackage`، تمامًا مثل AI SDK
يسخر. الوكيل الثنائي نفسه (`@google/gemini-cli`،
`@zed-industries/claude-code-acp`,...) هو CLI خارجي منفصل؛ الإعدادات المسبقة
قم بتشغيله من خلال `npx` وسيظل الأمر/الوسائط قابلة للتجاوز لأن الوكيل ACP
لا تزال إشارات الإدخال تتطور.

يتم تعيين `permissionMode` إلى ACP `session/request_permission` باستخدام استدعاء الأداة
اكتب تقارير الوكيل: يتم تشغيل القراءات دائمًا، ويتم تشغيل التعديلات ضمن `allow-edits`، و
كل شيء محفوف بالمخاطر يطالب إلا `allow-all`. تظهر الموافقات كالمعتاد
أحداث `approval-request`. يخدم المحول `fs/read_text_file` و
`fs/write_text_file` مقابل مساحة عمل الجلسة (رفض المسارات التي تهرب
it) ويكتب أحداث `file-change`؛ لا يتم الإعلان عن الطرق الطرفية،
لذلك يستخدم الوكيل غلافه الخاص.

## مصادقة Codex: الكود UI مقابل أدوات الحماية {#codex-auth}

يوجد سطحان Codex، ويتم المصادقة عليهما بشكل مختلف:

- **Agent-Native Code / Desktop** يقوم بتشغيل `codex exec` على جهاز المستخدم. إذا
  قام المستخدم بتشغيل `codex login`، وهذا التشغيل المحلي يعيد استخدام ChatGPT
  الاشتراك أو مفتاح API يصادق على تقارير Codex CLI المثبتة من خلال
  `codex login status`.
- **`ai-sdk-harness:codex`** يقوم بتحميل `@ai-sdk/harness-codex`، الذي يقوم بتشغيل Codex
  داخل صندوق الحماية الخاص بالحزام من خلال `@openai/codex-sdk`. لا يحدث ذلك بصمت
  ارث تسجيل دخول `~/.codex` لسطح المكتب الخاص بالمستخدم لأن وضع الحماية قد يكون بعيدًا
  أو معزولة. بالنسبة إلى صناديق الحماية الموثوقة/الخاصة، يمكنك الاشتراك باستخدام `codexCliAuth: true`;
  ينسخ Agent-Native ملف المصادقة Codex CLI المحلي إلى وضع الحماية قبل
  يبدأ الحزام. بالنسبة لصناديق الحماية المستضافة أو المشتركة، قم بتكوين مفتاح/بوابة API
  المصادقة بدلاً من ذلك.

لذلك إذا سأل شخص ما عن الحزمة التي تحمل مسار Codex OAuth: للتشفير المحلي
الجلسات، استخدم `@agent-native/core` / Desktop بالإضافة إلى المثبت
`@openai/codex` CLI و`codex login`. بالنسبة إلى وضع الحماية `ai-sdk-harness:codex`،
استخدم الاشتراك الصريح `codexCliAuth` عند نسخ تسجيل الدخول هذا إلى وضع الحماية
مقبول.

```ts
const adapter = resolveAgentHarness("ai-sdk-harness:codex", {
  codexCliAuth: true,
});
```

`codexCliAuth: true` يقرأ `CODEX_HOME/auth.json` أو `~/.codex/auth.json`. إلى
أشر إلى تسجيل دخول محلي مختلف، وقم بالتمرير
`{ codexCliAuth: { codexHome: "/path/to/.codex" } }` أو
`{ codexCliAuth: { authJsonPath: "/path/to/auth.json" } }`.

## التسجيل والحل {#register-resolve}

```ts
import {
  registerBuiltinAgentHarnesses,
  resolveAgentHarness,
} from "@agent-native/core/agent/harness";

registerBuiltinAgentHarnesses();
const adapter = resolveAgentHarness("ai-sdk-harness:codex");
```

ترجع `resolveAgentHarness(name, config?)` `AgentHarnessAdapter`. ال
تتم إعادة توجيه `config` الاختياري إلى مصنع المحولات — لمحولات AI SDK
الذي يتم تعيينه إلى `AiSdkHarnessAdapterOptions` (`label`، `description`،
`permissionMode`، و`harnessOptions`، و`agentOptions`، وCodex فقط
`codexCliAuth`). استخدم `listAgentHarnesses()` لتعداد ما تم تسجيله من أجله
منتقي.

## أجري دورة {#run-a-turn}

`startAgentHarnessRun` بتوصيل جلسة تسخير إلى مدير التشغيل المشترك
دورة الحياة. فهو ينشئ (أو يعيد استخدام) الجلسة الأصلية، ويستمر فيها، ويبث
يحول كل حدث تسخير ويترجمه إلى أحداث نصية ويفصل
حالة قابلة للاستئناف عند اكتمال الدور.

```ts
import { startAgentHarnessRun } from "@agent-native/core/agent/harness";

const run = startAgentHarnessRun({
  runId,
  threadId,
  adapter,
  input: { prompt },
  createSession: {
    sessionId,
    resumeState, // opaque value from a previous turn, if resuming
    instructions,
    sandbox, // required for sandboxed harnesses — see Sandbox Adapters
    permissionMode: "allow-reads",
    tools, // a narrow, intentional set of host tools (see below)
  },
  ownerEmail,
  orgId,
});
```

يرجع `startAgentHarnessRun` `ActiveRun` من مدير التشغيل، وبالتالي فإن الدور
يظهر من خلال مسارات التشغيل الحالية والنص والإلغاء تمامًا مثل
تشغيل أي وكيل آخر. قم بتمرير `session` الذي تم إنشاؤه بالفعل بدلاً من `createSession`
لمتابعة الجلسة التي تحتفظ بها في الذاكرة.

## الجلسات والاستئناف {#sessions}

يمتلك الحزام حالة جلسة أصلية طويلة الأمد. يستمر Agent-Native في SQL
حتى يتمكن الخيط من البقاء عبر المنعطفات والعمليات والنشر. `resumeState`
**غير شفاف** — يقوم Agent-Native بتخزينه وإعادته، ولكن لا يتم فحصه أو فحصه مطلقًا
يفسرها.

```an-diagram title="الاستئناف عبر المنعطفات والعمليات والنشر" summary="يقوم كل دور بفصل حالة السيرة الذاتية المبهمة إلى SQL؛ المنعطف التالي يعيده مرة أخرى إلى createSession بدلاً من إعادة تشغيل سجل الدردشة."
{
  "html": "<div class=\"diagram-resume\"><div class=\"diagram-node\" data-rough>الدور N<br><small class=\"diagram-muted\">streamTurn</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>detach &rarr; resumeState<br><small class=\"diagram-muted\">معتم · جلسة حاضنة SQL</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\" data-rough>الدور N+1<br><small class=\"diagram-muted\">createSession.resumeState</small></div></div>",
  "css": ".diagram-resume{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-resume .diagram-arrow{font-size:22px;line-height:1}"
}
```

```ts
import {
  getLatestAgentHarnessSessionForThread,
  listAgentHarnessSessions,
} from "@agent-native/core/agent/harness";

const last = await getLatestAgentHarnessSessionForThread(threadId);
// Feed last?.resumeState into createSession.resumeState on the next turn.
```

يكشف المتجر أيضًا عن `saveAgentHarnessSession`، `updateAgentHarnessSession`،
`getAgentHarnessSession`, `getAgentHarnessSessionByRunId`,
`markAgentHarnessSessionStopped`، و`ensureAgentHarnessSessionTables`.
`startAgentHarnessRun` يستدعي مسارات الحفظ/التحديث/الإيقاف نيابةً عنك؛ الوصول إليهم
مباشرة فقط في مضيف مخصص.

## أدوات وأذونات المضيف {#host-tools}

يجلب الحزام أدواته الأصلية (القراءة، والتحرير، والكتابة، والصدفة، وما إلى ذلك)، وهكذا
لا يمكنك **إعادة عرض تحرير الملفات كأدوات مضيفة. قم بتمرير **ضيق فقط،
المجموعة المقصودة\*\* من Agent-Native actions حتى `createSession.tools` عندما
تريد أن يصل الحزام إلى عمليات تطبيق معينة - واحتفظ بـ `defineAction`
المصادقة وسياق الطلب والمهلات والاقتطاع وبيانات التعريف للقراءة فقط سليمة عندما
أنت تفعل ذلك.

يحدد `permissionMode` ما قد يفعله الحزام دون موافقة:

| الوضع         | المعنى                                                               |
| ------------- | -------------------------------------------------------------------- |
| `allow-reads` | افتراضي. تشغيل القراءات؛ التعديلات ومطالبة actions المحفوفة بالمخاطر |
| `allow-edits` | تشغيل عمليات القراءة والتحرير؛ موجه actions الخطير الآخر             |
| `allow-all`   | لا توجد بوابة موافقة                                                 |

عندما يتوقف الحزام مؤقتًا للموافقة عليه، فإنه يصدر حدث `approval-request` و
تم وضع علامة `idle` على الجلسة مع تسجيل الموافقة المعلقة، لذا يمكن لـ UI
أبرزها واستأنفها بناءً على قرار المستخدم. انظر
[Human Approval](/docs/human-approval) لسطح الموافقة.

## الأحداث {#events}

تقوم جلسة تسخير ببث قيم `AgentHarnessEvent`، والتي Agent-Native
يترجم إلى دفق `AgentChatEvent` القياسي باستخدام
`agentHarnessEventToAgentChatEvents`. The event union covers `text-delta`,
`thinking-delta`، `activity`، `tool-start`، `tool-done` (والتي يمكنها حمل
حمولة `mcpApp` للأدوات الأصلية)، `approval-request`، `file-change`،
`compaction`، و`usage`، و`error`، و`done`. لأن نتائج الأداة تتدفق عبر
نفس الترجمة، ولا تزال الأدوات الأصلية التي تم الإعلان عنها عن إجراء تعرض - راجع
[Native واجهة الدردشة](/docs/native-chat-ui).

## يعمل في الخلفية وUI {#background-runs}

يقوم Harness بتشغيل المشروع في شكل `BackgroundAgentRun` المشترك مع
`createAgentHarnessBackgroundAgentController()` ومتاح من خلال
مسارات التشغيل الموجودة كـ `goalId=agent-harness`. وهذا يعني Claude طويل الأمد
تظهر جلسة التعليمات البرمجية أو Codex في نفس أسطح التشغيل في الخلفية والنص
مثل فرق الوكلاء والمحولات الأخرى، باستخدام `listAgentHarnessBackgroundRuns`،
`listAgentHarnessBackgroundTranscriptEvents`، `getAgentHarnessBackgroundRun`، و
`stopAgentHarnessBackgroundRun` متاح للمضيفين المخصصين.

## المحولات المخصصة {#custom-adapters}

لتغليف وقت تشغيل ليس أحد العناصر المضمنة، قم بتنفيذ
`AgentHarnessAdapter` وقم بتسجيله. يعلن المحول عن إمكانياته و
ينشئ جلسات؛ تعرض الجلسة `streamTurn` و`continueTurn` الاختيارية،
`approve`، و`detach`، و`stop`، و`destroy`.

```ts
import {
  registerAgentHarness,
  type AgentHarnessAdapter,
} from "@agent-native/core/agent/harness";

const myHarness: AgentHarnessAdapter = {
  name: "acme:my-coder",
  label: "Acme Coder",
  description: "Runs the Acme coding agent.",
  installPackage: "@acme/coder",
  capabilities: {
    sandbox: true,
    resumable: true,
    approvals: true,
    hostTools: true,
    fileEvents: true,
  },
  async createSession(opts) {
    // Build your native session and adapt it to AgentHarnessSession.
    return createAcmeSession(opts);
  },
};

registerAgentHarness({
  name: myHarness.name,
  label: myHarness.label,
  description: myHarness.description,
  installPackage: myHarness.installPackage,
  capabilities: myHarness.capabilities,
  create: () => myHarness,
});
```

احتفظ بحزمة وقت التشغيل اختيارية من خلال الاستيراد الديناميكي في `createSession` و
تلميح `installPackage`. بالنسبة إلى أدوات الترميز المدعومة بالجسر، يلزم وجود
موفر وضع الحماية/مساحة العمل بدلاً من تشغيل وكيل ترميز عشوائي في
عملية المضيف — راجع [Sandbox Adapters](/docs/sandbox-adapters). محول AI SDK
(`createAiSdkHarnessAdapter`، مدعوم بـ `HarnessAgent` من `@ai-sdk/harness`) هو
تنفيذ واحد لهذا العقد، وليس التجريد العام.

## لا تفعل ذلك {#donts}

- لا تقم بإضافة رمز Claude أو Codex أو Cursor أو Mastra أو Pi كـ `AgentEngine`. هم
  تملك الحلقة الخاصة بهم؛ يؤدي تشغيل واحدة تحت `AgentEngine.stream()` إلى تشغيل الحلقة بشكل مزدوج
  ويفقد دلالات دورة حياة الجلسة.
- لا تقم بإعادة تشغيل سجل الدردشة Agent-Native الكامل في كل دورة. استئناف
  جلسة الحزام باستخدام `resumeState` بدلاً من ذلك.
- لا تقم بتخزين `resumeState` في `application_state`. إنه ينتمي إلى الحزام
  جدول SQL للجلسة.
- لا تعرض كل إجراء من إجراءات التطبيق لكل جلسة استخدام بشكل افتراضي. سلمها
  مجموعة أدوات صغيرة ومتعمدة.

## المستندات ذات الصلة {#related-docs}

- [Native واجهة الدردشة](/docs/native-chat-ui) — ضع وكيلك الخاص خلف الدردشة UI مع `AgentChatRuntime`.
- [Agent Surfaces](/docs/agent-surfaces) - اختر التطبيق بلا رأس، أو الدردشة، أو السيارة الجانبية، أو التطبيق الكامل.
- [Agent-Native Code UI](/docs/code-agents-ui) — سطح مساحة عمل البرمجة القابلة لإعادة الاستخدام.
- [Custom Agents & Teams](/docs/agent-teams) — عمليات التشغيل في الخلفية وتفويض الوكيل الفرعي.
- [Sandbox Adapters](/docs/sandbox-adapters) — واجهات خلفية قابلة للتنفيذ لأدوات البرمجة.
- [Human Approval](/docs/human-approval) — يتم استخدام مجموعة أحزمة السطح المعتمدة.
