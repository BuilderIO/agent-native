---
title: "محولات CLI"
description: "امنح الوكيل وصولاً منظمًا إلى أي أداة CLI (gh، ffmpeg، stripe) من خلال واجهة محول قياسية — إحدى وصلتي المحول المشمولتين في دليل المحولات."
---

# محولات CLI

> **حيث يناسب ذلك:** محولات CLI هي إحدى درزتي المحول في
> الإطار. الدليل الأساسي هو [Adapters](/docs/sandbox-adapters)، والذي
> كلاً من هذا التماس وخط التماس `run-code` - بما في ذلك خط التماس المشترك
> قيد الحافة/بدون خادم. هذه الصفحة هي المرجع السريع لجانب CLI.

يحتوي محول CLI على أداة سطر أوامر واحدة (`gh`، `ffmpeg`، `stripe`، `aws`) حتى يتمكن الوكيل من اكتشافها والتحقق من تثبيتها وتشغيلها باستخدام نتيجة كود stdout/stderr/exit متسقة. بدون هذا التماس، يعيد كل نص برمجي اختراع كيفية استدعاء CLI وتحليل مخرجاته.

```an-diagram title="CLI محول → التسجيل → سطح العمل" summary="ShellCliAdapter يلتف ثنائي؛ يقوم CliRegistry بجمع المحولات لاكتشافها؛ يكشف defineAction عن مكالمة واحدة على سطح عمل الوكيل + واجهة المستخدم."
{
  "html": "<div class=\"diagram-cli\"><div class=\"diagram-node\" data-rough>gh · ffmpeg · الشريط<br><small class=\"diagram-muted\">أدوات سطر الأوامر</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>ShellCliAdapter<br><small class=\"diagram-muted\">متاح · تنفيذ</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough>كليريجستري<br><small class=\"diagram-muted\">وصف () للاكتشاف</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">defineAction</div></div>",
  "css": ".diagram-cli{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-cli .diagram-arrow{font-size:22px;line-height:1}.diagram-cli .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## الواجهة {#the-interface}

ينفذ كل محول CLI `CliAdapter`:

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

## شيلكلي أدابتر {#shell-adapter}

بالنسبة لمعظم CLI، لا تحتاج إلى فئة مخصصة — `ShellCliAdapter` يغلف أي ثنائي باستخدام إعدادات افتراضية معقولة:

```ts
import { ShellCliAdapter } from "@agent-native/core/adapters/cli";

const gh = new ShellCliAdapter({
  command: "gh",
  description: "GitHub CLI — manage repos, PRs, issues, and releases",
});

const ffmpeg = new ShellCliAdapter({
  command: "ffmpeg",
  description: "Audio/video processing and transcoding",
  timeoutMs: 120_000, // 2 min for long encodes
  env: { STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY! },
});
```

الخيارات: `command` (مطلوب)، `description` (مطلوب)، `name` (افتراضي `command`)، `env` (مدمج مع `process.env`)، `cwd` (افتراضي `process.cwd()`), و`timeoutMs` (افتراضي) `30000`).

للحصول على مصادقة مخصصة، أو تحليل المخرجات، أو المعالجة المسبقة/اللاحقة، قم بتنفيذ `CliAdapter` مباشرةً بدلاً من استخدام `ShellCliAdapter`.

## التسجيل {#registry}

تقوم `CliRegistry` بتجميع المحولات حتى يتمكن الوكيل من اكتشاف ما هو متاح في وقت التشغيل:

```ts
import { CliRegistry, ShellCliAdapter } from "@agent-native/core/adapters/cli";

const cliRegistry = new CliRegistry();
cliRegistry.register(
  new ShellCliAdapter({ command: "gh", description: "GitHub CLI" }),
);

cliRegistry.list(); // all registered
await cliRegistry.listAvailable(); // only installed
await cliRegistry.describe(); // [{ name, description, available }] for discovery

const gh = cliRegistry.get("gh");
const result = await gh?.execute(["pr", "list", "--json", "title,url"]);
```

## الاستخدام من actions {#from-actions}

قم بلف استدعاء CLI في `defineAction` لعرضه على سطح الإجراء - `defineAction` مطلوب عند تشغيل التعليمات البرمجية داخل سطح إجراء الخادم؛ استخدم محولًا مباشرةً في ملف `scripts/` بخلاف ذلك. لا تتصل أبدًا بـ `process.exit` أثناء إجراء ما؛ رمي خطأ بدلا من ذلك.

```ts
// actions/list-prs.ts
import { defineAction } from "@agent-native/core/action";
import { ShellCliAdapter } from "@agent-native/core/adapters/cli";
import { z } from "zod";

const gh = new ShellCliAdapter({ command: "gh", description: "GitHub CLI" });

export default defineAction({
  description: "List open pull requests via the GitHub CLI.",
  schema: z.object({}),
  async run() {
    if (!(await gh.isAvailable())) {
      throw new Error("GitHub CLI not installed. Run: brew install gh");
    }
    const result = await gh.execute([
      "pr",
      "list",
      "--json",
      "title,url,state",
      "--limit",
      "10",
    ]);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "gh pr list failed");
    }
    return JSON.parse(result.stdout);
  },
});
```

## الحافة وبدون خادم {#edge-serverless}

تستخدم محولات CLI `node:child_process`، وهو غير موجود في أوقات تشغيل الحافة/العامل (Cloudflare Workers، Netlify Edge Functions). قم بتشغيل نقاط نهاية محول CLI ومهامه في بيئة Node.js القياسية. تتم مشاركة هذا القيد مع خط الحماية - راجع المناقشة الكاملة في [Adapters](/docs/sandbox-adapters#edge-serverless).

## ما هي الخطوة التالية

- [**Adapters**](/docs/sandbox-adapters) — الدليل الأساسي لكلا وصلتي المحول.
- [**Actions**](/docs/actions) — عادةً ما يتم تضمين محولات CLI لسطح العمل.
