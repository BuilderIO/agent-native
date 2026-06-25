---
title: "المحولات"
description: "طبقتا محول إطار العمل: تقوم محولات وضع الحماية بتبديل الواجهة الخلفية التي تقوم بتشغيل أداة تشغيل التعليمات البرمجية الخاصة بالوكيل، وتمنح محولات CLI الوكيل وصولاً منظمًا إلى أدوات سطر الأوامر."
search: "المحولات، محول وضع الحماية، محول cli، رمز التشغيل، SandboxAdapter، CliAdapter، ShellCliAdapter، عداء متين، وضع الحماية عن بعد، حافة عملية بدون خادم"
---

# المحولات

> **من هو:** المؤلفون المضيفون الذين يقومون بتمديد وقت التشغيل. نادرًا ما يكون مطورو التطبيقات
> إلى هذا — فالإعدادات الافتراضية تعمل خارج الصندوق.

تحتوي Agent-Native على درزتي محول تعملان على إزالة المشكلة خلف فتحة ضيقة،
واجهة قابلة للتبديل:

- **محولات Sandbox** تقوم بتبديل الواجهة الخلفية التي تقوم بتشغيل أداة `run-code` الخاصة بالوكيل —
  عملية فرعية محلية بشكل افتراضي، أو مشغل Docker/بعيد/متين.
- **تمنح محولات CLI** الوكيل وصولاً منظمًا إلى أدوات سطر الأوامر
  (`gh`، `ffmpeg`، `stripe`) مع الاكتشاف والتحقق من التوفر و
  شكل نتيجة متسق.

يشترك كلاهما في قيد تشغيل واحد: يعتمدان على روابط نظام Node.js ويقومان بذلك
لا يتم تشغيله على أوقات تشغيل الحافة/العامل - راجع [Edge and serverless](#edge-serverless).

## ما هو مستند البرمجة الذي أريده؟ {#which-doc}

| تريد...                                                                        | استخدام                                      |
| ------------------------------------------------------------------------------ | -------------------------------------------- |
| قم بتبديل الواجهة الخلفية التي تقوم بتشغيل **أداة `run-code`** للوكيل          | **محولات وضع الحماية** (هذه الصفحة)          |
| قم بلف أداة CLI (`gh`، `ffmpeg`) ليتصل بها الوكيل                              | **محولات CLI** (هذه الصفحة)                  |
| عرض نمط Claude/Codex **مساحة عمل الترميز UI**                                  | [Agent-Native Code UI](/docs/code-agents-ui) |
| تشغيل Claude Code / Codex / Pi **كوكيل**، باستخدام الحلقة + الأدوات الخاصة بهم | [Harness Agents](/docs/harness-agents)       |

# محولات وضع الحماية

تقوم أداة `run-code` بتشغيل JavaScript الذي يوفره الوكيل في بيئة معزولة. **محولات Sandbox** تأخذ في الاعتبار مشكلة _التنفيذ_ من تلك الأداة بحيث يمكن تبديل الواجهة الخلفية - عملية فرعية محلية بشكل افتراضي، أو مشغل Docker / بعيد / دائم - دون لمس حلقة الوكيل، أو `run-code.ts`، أو جسر المضيف المحلي، أو env Scrub، أو تنسيق الإخراج.

## لماذا التماس {#why}

تنتج الواجهة الخلفية الافتراضية عملية فرعية محلية مؤمنة للعقدة. هذا مقيد بعملية الاستضافة: على النظام الأساسي المستضاف، فإنه يشارك سقف التنفيذ الناعم لحلقة الوكيل (حوالي 40 ثانية قبل انتهاء المهلة/الاستمرار). يعد المحول البعيد أو المتين بمثابة الرافعة لتجاوز هذا السقف - فهو يقوم بتشغيل مهام البيانات الكبيرة حتى اكتمالها بشكل مستقل عن دورة حياة الطلب.

يعني إبقاء العقد محدودًا أن المحول البعيد يرث نفس الوضع الأمني. تحافظ العملية الأصلية على ملكية كل شيء يحمل سرًا: فهي تبني وحدة وضع الحماية، وتدير جسر المضيف المحلي (الذي يحتفظ بسياق الطلب ويطبق قوائم المضيف المسموح بها + حراس SSRF)، وينظف البيئة، وينسق المخرجات. يتلقى المحول فقط مصدر وحدة **غير سري** تم إعداده بالفعل بالإضافة إلى حدود الموارد — فهو مسؤول فقط عن تشغيله والتقاط حالة stdout/stderr/exit.

```an-diagram title="يحتفظ الوالد بالأسرار؛ يقوم المحول بتشغيل التعليمات البرمجية فقط" summary="يقوم رمز التشغيل ببناء الوحدة وتشغيل جسر الاسترجاع؛ يتلقى المحول وحدة غير سرية + حدود ويعيد stdout/stderr/exit."
{
  "html": "<div class=\"diagram-sandbox\"><div class=\"diagram-box\" data-rough><strong>العملية الأم</strong><small class=\"diagram-muted\">يبني الوحدة · جسر loopback · تنظيف البيئة · تنسيق الإخراج</small></div><div class=\"diagram-col\"><div class=\"diagram-pill accent\">non-secret module + limits &rarr;</div><div class=\"diagram-pill ok\">&larr; stdout / stderr / exitCode</div><div class=\"diagram-pill\">&harr; bridge calls (127.0.0.1)</div></div><div class=\"diagram-panel center\" data-rough><strong>SandboxAdapter.run</strong><small class=\"diagram-muted\">عملية فرعية محلية · Docker · بعيد · دائم</small></div></div>",
  "css": ".diagram-sandbox{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-sandbox .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-sandbox .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## الواجهة {#interface}

يعيش خط التماس في قلب `packages/core/src/coding-tools/sandbox/` — `adapter.ts` (العقد)، `index.ts` (التحديد: `getSandboxAdapter()` / `registerSandboxAdapter()`)، و`local-child-process-adapter.ts` (الافتراضي). يتم توصيله داخل العبوة بواسطة `run-code.ts`؛ يقوم المضيف بتوصيل واجهة خلفية مختلفة من خلال مساعد التسجيل `index.ts` (أو، بالنسبة لواجهة Docker الخلفية, عبر [blueprint](/docs/blueprint-installer) الذي يحرر هذه الملفات مباشرة).

```an-file-tree title="نقطة وصل sandbox في core"
{
  "title": "packages/core/src/coding-tools/sandbox/",
  "entries": [
    { "path": "adapter.ts", "note": "عقد SandboxAdapter (SandboxRunRequest / SandboxRunResult)" },
    { "path": "index.ts", "note": "الاختيار: getSandboxAdapter() / registerSandboxAdapter()" },
    { "path": "local-child-process-adapter.ts", "note": "ال backend الافتراضي: Node child process مقيد" },
    { "path": "../run-code.ts", "note": "يوصل نقطة الربط؛ لا يتغير أبداً عند تبديل backends" }
  ]
}
```

تطبق كل واجهة خلفية `SandboxAdapter`:

```ts
interface SandboxAdapter {
  /** Stable id, surfaced for diagnostics and adapter selection. */
  readonly id: string;
  /** Execute one prepared sandbox module and capture its output. */
  run(request: SandboxRunRequest): Promise<SandboxRunResult>;
}
```

الطلب والنتيجة صغيرة ومبهمة عن عمد:

```ts
interface SandboxRunRequest {
  /**
   * The complete ESM module source to execute. Already wraps the user's code
   * and embeds the loopback bridge URL/token; the adapter does NOT parse or
   * rewrite it.
   */
  moduleSource: string;
  /**
   * Scrubbed environment — only safe POSIX vars (PATH/HOME/TMPDIR/…), never app
   * secrets. Adapters must not augment this with the parent's own environment.
   */
  env: Record<string, string>;
  /** Hard wall-clock timeout in milliseconds. The adapter must enforce it. */
  timeoutMs: number;
  /**
   * Loopback port of the parent's bridge server (reachable over 127.0.0.1). A
   * remote adapter that can't reach the parent's loopback must tunnel or proxy
   * this to support bridge-backed globals (`appAction`, `providerFetch`, …).
   */
  bridgePort: number;
}

interface SandboxRunResult {
  stdout: string;
  stderr: string;
  /** `0` on clean exit, non-zero on failure, `null` when killed by a signal. */
  exitCode: number | null;
  /** True when the run was killed for exceeding `timeoutMs`. */
  timedOut: boolean;
}
```

## الافتراضي: `LocalChildProcessAdapter` {#default}

بشكل جاهز، تقوم `getSandboxAdapter()` بإرجاع `LocalChildProcessAdapter` (`id: "local-child-process"`). وهو يحافظ على سلوك `run-code` التاريخي بايت مقابل بايت:

- تتم كتابة مصدر الوحدة المجهزة إلى مجلد مؤقت جديد.
- يركض الطفل مع البيئة المنظفة (بدون أسرار)، مع الإشارة إلى `TMPDIR`/`TEMP`/`TMP` داخل صندوق الرمل.
- عندما يكون نموذج إذن العقدة متاحًا (`--permission`، أو `--experimental-permission` على العقدة 20)، يُمنع الطفل من الوصول إلى نظام الملفات خارج الدليل المؤقت الخاص به، بالإضافة إلى العمليات الفرعية والعاملين والإضافات الأصلية. الشبكة الصادرة _ليست_ محظورة بواسطة نموذج الأذونات — ولكن فرك env يعني أن هذه الطلبات لا تحمل أي بيانات اعتماد، وجميع المكالمات التي تمت مصادقتها تمر عبر جسر الاسترجاع الخاص بالوالد.
- ترسل المهلة `SIGTERM`، ثم `SIGKILL` بعد فترة سماح مدتها ثانيتان.
- يتم تنظيف الملفات المؤقتة بأفضل جهد بعد التشغيل.

> [!WARNING]
> يستخدم المحول الافتراضي `node:child_process`، وهو غير موجود في أوقات تشغيل الحافة/العامل. قم بتشغيل `run-code` في بيئة Node.js القياسية، أو قم بتسجيل محول عن بعد — راجع [Edge and serverless](#edge-serverless).

## تحديد محول {#selection}

ترتيب الدقة - يفوز المحول المسجل بشكل صريح؛ وإلا فإن env var يحدد خيارًا مدمجًا؛ وإلا فسيتم استخدام الإعداد الافتراضي المحلي:

```text
registerSandboxAdapter(adapter)  →  AGENT_NATIVE_SANDBOX  →  local default
```

### `AGENT_NATIVE_SANDBOX` env var {#env}

يحدد المحول المضمن حسب المعرف. حاليًا يتم توصيل `local` (الافتراضي) فقط؛ تعود القيم غير المعروفة إلى المستوى المحلي بدلاً من فشل التشغيل.

```bash
AGENT_NATIVE_SANDBOX=local   # الافتراضي — صريح
```

### `registerSandboxAdapter()` {#register}

تتجاوز العملية المضيفة الواجهة الخلفية لجميع استدعاءات `run-code` اللاحقة من خلال `index.ts` الخاص بالوصلة - على سبيل المثال، لتشغيل كل استدعاء في حاوية بعيدة:

```ts
import {
  registerSandboxAdapter,
  type SandboxAdapter,
} from "./coding-tools/sandbox/index.js";

class RemoteSandboxAdapter implements SandboxAdapter {
  readonly id = "remote";
  async run(request) {
    // Ship request.moduleSource to the durable runner, enforce request.timeoutMs,
    // proxy bridge calls back to request.bridgePort, and return stdout/stderr/exitCode.
  }
}

registerSandboxAdapter(new RemoteSandboxAdapter());
// Pass `null` to clear the override and fall back to env-var / default resolution.
```

## التماس لعداء متين {#durable}

هذه الواجهة هي بمثابة التماس لصندوق الحماية البعيد/المتين في المستقبل. سيقوم المحول البعيد أو المتين (Docker، أو مشغل نمط Vercel-Sandbox، أو عامل الخلفية في قائمة الانتظار):

1. تنفيذ `SandboxAdapter.run` في وقت التشغيل خارج العملية.
2. قم بتوصيل جسر الاسترجاع (أو مكالمات الجسر الوكيل إلى الأصل).
3. السماح بتشغيل مهام البيانات الكبيرة حتى الاكتمال بشكل مستقل عن دورة حياة الطلب - بما يتجاوز الحد الأقصى المستضاف لبرنامج تنفيذ التعليمات البرمجية الذي يبلغ حوالي 40 ثانية والذي يحد محول العملية الفرعية المحلي.

قم بتسجيله تحت قيمة `AGENT_NATIVE_SANDBOX` جديدة (على سبيل المثال، `remote`) و/أو عبر `registerSandboxAdapter()`. لا تتغير حلقة الوكيل و`run-code.ts` أبدًا.

> [!TIP]
> يُصدر مخطط `agent-native add sandbox docker` وصفة كاملة ومكتفية ذاتيًا لتنفيذ محول Docker مقابل هذا التماس. انظر [Blueprint Installer](/docs/blueprint-installer).

# محولات CLI

تغطي وصلة المحول الأخرى أداة سطر أوامر واحدة (`gh`، `ffmpeg`، `stripe`، `aws`) حتى يتمكن الوكيل من اكتشافها والتحقق من تثبيتها وتشغيلها باستخدام نتيجة كود stdout/stderr/exit متسقة. يقوم كل محول CLI بتنفيذ `CliAdapter`:

```ts
import type { CliAdapter, CliResult } from "@agent-native/core/adapters/cli";

interface CliAdapter {
  name: string; // "gh", "stripe", "ffmpeg"
  description: string; // What the agent sees during discovery
  isAvailable(): Promise<boolean>;
  execute(args: string[]): Promise<CliResult>;
}

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
```

بالنسبة لمعظم CLI، تقوم `ShellCliAdapter` بتغليف أي ثنائي بافتراضيات معقولة، وتقوم `CliRegistry` بجمع المحولات لاكتشاف وقت التشغيل:

```ts
import { CliRegistry, ShellCliAdapter } from "@agent-native/core/adapters/cli";

const cliRegistry = new CliRegistry();
cliRegistry.register(
  new ShellCliAdapter({
    command: "gh",
    description: "GitHub CLI — manage repos, PRs, issues, and releases",
  }),
);

await cliRegistry.describe(); // [{ name, description, available }] for discovery
const gh = cliRegistry.get("gh");
const result = await gh?.execute(["pr", "list", "--json", "title,url"]);
```

قم بلف مكالمة CLI في `defineAction` لعرضها على سطح الحركة. راجع المرجع السريع [CLI Adapters](/docs/cli-adapters) للتعرف على خيارات `ShellCliAdapter` والمحولات المخصصة ونمط التفاف الإجراء.

## الحافة وبدون خادم {#edge-serverless}

> [!WARNING]
> تعتمد كل من طبقات المحول على روابط نظام Node.js. تستخدم محولات Sandbox `LocalChildProcessAdapter` وCLI (`ShellCliAdapter` والمحولات المخصصة) `node:child_process` (`execFile` / `spawn`)، والتي **غير موجودة** في أوقات تشغيل الحافة/العامل مثل Cloudflare Workers أو Netlify Edge Functions. إذا قمت بنشر مسارات الخادم إلى إعدادات الحافة المسبقة هذه، فإن تنفيذ هذه المحولات يؤدي إلى حدوث استثناء في وقت التشغيل. قم بتشغيل نقاط نهاية المحول ومهامه في بيئة Node.js القياسية (حاويات الخادم التقليدية أو وظائف Node بدون خادم) - أو، بالنسبة لوصلة وضع الحماية، سجل محولًا عن بعد يشحن العمل خارج العملية.

## ما هي الخطوة التالية

- [**CLI Adapters**](/docs/cli-adapters) — المرجع السريع لدرزة CLI
- [**Blueprint Installer**](/docs/blueprint-installer) — يطبع `agent-native add sandbox docker` وصفة محول Docker
- [**Agent Teams**](/docs/agent-teams) — تفويض العمل الثقيل إلى الوكلاء الفرعيين
- [**Security**](/docs/security) — وضع القائمة المسموح بها لفرك البيئة والجسر
