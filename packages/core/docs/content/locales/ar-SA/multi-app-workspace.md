---
title: "مساحات عمل متعددة التطبيقات"
description: "يمكنك استضافة العديد من تطبيقات الوكيل الأصلية في monorepo واحد مع المصادقة المشتركة، وRBAC، والتعليمات، وskills، والمكونات، وبيانات الاعتماد."
---

# مساحات عمل متعددة التطبيقات

> **ما هو مستند مساحة العمل؟** تغطي هذه الصفحة **شكل النشر** — monorepo واحد، والعديد من التطبيقات، والمصادقة المشتركة والنشر الموحد. لمعرفة ماهية مساحة العمل (طبقة التخصيص: `AGENTS.md`، `LEARNINGS.md`، الذاكرة الشخصية، skills، الوكلاء المخصصون) راجع [Workspace](/docs/workspace)؛ بالنسبة للحوكمة (من يراجع ويوافق ويمتلك ماذا) راجع [Workspace Governance](/docs/workspace-management).

عندما تستغرق عملية الترميز الديناميكي لأداة داخلية فترة ما بعد الظهر، فلا تتوقف عند واحدة. ينتهي الأمر بالفريق بالحصول على CRM، وصندوق بريد وارد للدعم، ولوحة معلومات، ووحدة تحكم للعمليات - عشرة تطبيقات صغيرة، كل منها مدعوم بشكل مستقل. يعد هذا أمرًا رائعًا حتى تحتاج إلى تغيير شيء ما فيها جميعًا.

في تلك المرحلة، يكون لكل تطبيق `AGENTS.md` خاص به، ومكون إضافي للمصادقة، ومكون تخطيط نسخ ولصق خاص به، ورمز Slack المميز المشفر، وفكرته الخاصة عن ماهية "المؤسسة". تغيير قاعدة الامتثال يعني عشرة ممثلين رئيسيين. إن تدوير مفتاح API يعني عشر عمليات إعادة توزيع. تحديث العلامة التجارية يعني خروج عشرة رؤوس مختلفة عن المزامنة. الشيء الذي جعل من السهل بنائها هو الآن ما جعل من الصعب إدارتها.

نمط **مساحة عمل التطبيقات المتعددة** هو الطريقة التي يحل بها الوكيل الأصلي هذه المشكلة. يمكنك استضافة جميع تطبيقاتك في monorepo واحد إلى جانب حزمة `packages/shared` الخاصة. يمتلك الإطار الإعدادات الافتراضية الشائعة؛ `packages/shared` مخصص فقط للتعليمات البرمجية أو التعليمات أو skills أو المكونات أو تجاوزات المكونات الإضافية المخصصة حقًا لمساحة العمل الخاصة بك. يتم تقليص كل تطبيق إلى عدد قليل من الشاشات وactions التي تجعله فريدًا.

## ما تتم مشاركته {#what-gets-shared}

أي شيء يجب أن يتفق عليه كل تطبيق في مؤسستك يمكن أن يكون موجودًا في `packages/shared`:

| الشيء المشترك                 | أين يعيش                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| تجاوز المصادقة / SSO          | تصدير `authPlugin` من `src/server/index.ts`                                             |
| قواعد المؤسسة / RBAC          | مؤسسات مصادقة أفضل، متضمنة اختياريًا بواسطة `authPlugin`                                |
| تجاوز محادثة الوكيل           | تصدير `agentChatPlugin` من `src/server/index.ts`                                        |
| تعليمات وكيل المؤسسة          | `AGENTS.md`                                                                             |
| الوكيل skills                 | `.agents/skills/<skill-name>/SKILL.md`                                                  |
| الوكيل المشترك actions        | `actions/*.ts`                                                                          |
| مكونات React المشتركة         | تصدير من `src/client/index.ts`                                                          |
| رموز التصميم/العلامة التجارية | أضف ملف CSS مشتركًا واستورده من كل تطبيق                                                |
| بيانات اعتماد API المشتركة    | تفضيل بيانات الاعتماد ذات النطاق الإطاري؛ أضف مساعدين فقط إذا كنت بحاجة إلى مساحة الاسم |

يصبح كل تطبيق فردي _مجرد مجموعة من الشاشات_ - المسارات ولوحات المعلومات وطرق العرض وactions الخاصة بالمجال. تغطي الإعدادات الافتراضية لإطار العمل الباقي حتى تقوم بإضافة تخصيص حقيقي لمساحة العمل.

ينطبق هذا الحد نفسه عندما يريد تطبيقك استخدام تطبيق آخر للطرف الأول. يجب على لوحة معلومات مساحة العمل الجديدة التي تحتاج إلى البريد الإلكتروني والتقويم والتحليلات وسياق ذاكرة الشركة أن تستخدم تطبيقات البريد والتقويم والتحليلات والدماغ الحالية كجيران متصلين عبر الروابط أو A2A. ولا ينبغي لها استنساخ هذه القوالب، أو إنشاء تطبيق مجمّع يدمجها، أو دعم التطبيقات الفرعية داخل نفسها فقط للوصول إلى بياناتها أو وكلائها. لا تُنسخ نسخة من هذا التطبيق إلا عندما تريد صراحةً تخصيص هذا التطبيق.

## البدء {#getting-started}

مساحة العمل هي الشكل الافتراضي لمشروع الوكيل الأصلي. سقالة واحدة مع:

```bash
npx @agent-native/core@latest create my-company-platform
```

يُظهر CLI منتقي متعدد التحديد لكل قالب طرف أول. اختر العدد الذي تريده - البريد + التقويم + النماذج، على سبيل المثال - وسيتم دمجها جميعًا في نفس مصادقة مشاركة مساحة العمل والإعدادات الافتراضية لقاعدة البيانات.

تحصل على pnpm monorepo مع الحزمة المشتركة الخاصة، و`package.json` الجذري الذي يربط اكتشاف مساحة العمل، و`.env` مشترك، ودليل فرعي واحد لكل تطبيق اخترته:

```an-file-tree title="workspace مولد"
{
  "entries": [
    { "path": "package.json", "note": "يعلن agent-native.workspaceCore" },
    { "path": "pnpm-workspace.yaml", "note": "packages: [\"packages/*\", \"apps/*\"]" },
    { "path": ".env.example", "note": "ANTHROPIC_API_KEY و A2A_SECRET و DATABASE_URL و ... مشتركة" },
    { "path": "packages/shared/", "note": "@my-company-platform/shared" },
    { "path": "packages/shared/src/server/", "note": "plugin overrides عند الحاجة فقط" },
    { "path": "packages/shared/src/client/", "note": "React code مشترك عند الحاجة فقط" },
    { "path": "packages/shared/AGENTS.md", "note": "تعليمات على مستوى workspace" },
    { "path": "apps/mail/" },
    { "path": "apps/calendar/" },
    { "path": "apps/forms/" }
  ]
}
```

ثم قم بتشغيله:

```bash
cd my-company-platform
cp .env.example .env             # املأ ANTHROPIC_API_KEY, BETTER_AUTH_SECRET,...
pnpm install
pnpm dev                         # opens Dispatch; other apps start on first visit
```

يعرف كل تطبيق بالفعل كيفية تسجيل الدخول ومشاركة نفس قاعدة البيانات وتحميل مساحة العمل `AGENTS.md`. لم تقم بتوصيل أي من ذلك - اكتشف إطار العمل تلقائيًا الحزمة المشتركة عبر حقل `agent-native.workspaceCore` في الجذر `package.json`:

```json
{
  "name": "my-company-platform",
  "agent-native": {
    "workspaceCore": "@my-company-platform/shared"
  }
}
```

## إضافة تطبيق آخر {#adding-a-new-app}

من أي مكان داخل مساحة العمل:

```bash
npx @agent-native/core@latest add-app
```

يعرض CLI منتقي القوالب مرة أخرى مع تصفية التطبيقات التي قمت بتثبيتها بالفعل. اختر واحدًا أو أكثر وسيتم تثبيتهم تحت `apps/`. البديل غير التفاعلي:

```bash
npx @agent-native/core@latest add-app crm --template content
```

يعمل أي قالب للطرف الأول كتطبيق مساحة عمل - يقوم CLI بتشغيل تحويل صغير **workspacify** على القالب الذي يضيف الحزمة المشتركة كإقلاع ويحل مراجع `workspace:*`. لا توجد سقالة موازية "لتطبيق مساحة العمل" يجب صيانتها.

```bash
pnpm install                     # at the workspace root
pnpm dev
```

هذا كل شيء. يحتوي التطبيق الجديد على نفس تعليمات تسجيل الدخول ومساحة العمل مثل أي تطبيق آخر. قم بإضافة العلامة التجارية المشتركة، actions، أو بيانات الاعتماد فقط عندما تحتاج مساحة العمل إليها فعليًا.

## ما قمت بتجاوزه حيث {#layering}

تعمل التطبيقات الأصلية للوكيل داخل مساحة العمل على حل السلوك الشامل من ثلاثة أماكن، بهذا الترتيب:

1. **التطبيق المحلي** — الملفات الموجودة داخل `apps/<name>/` (الأولوية العليا)
2. **مساحة العمل المشتركة** — الملفات الموجودة داخل `packages/shared/` (الطبقة المتوسطة المشتركة)
3. **الإطار الافتراضي** — `@agent-native/core` (الأدنى)

يتم الدمج حسب اسم الملف. إذا كان التطبيق يوفر ملفًا محليًا موجودًا أيضًا في المنبع، فسيفوز الملف المحلي. إذا لم يحدث ذلك، فسيتم تطبيق الإصدار المشترك لمساحة العمل. إذا لم توفر المشاركة واحدًا أيضًا، فسيتم تفعيل إطار العمل الافتراضي. وينطبق هذا على المكونات الإضافية، skills، وactions، و`AGENTS.md`.

```an-diagram title="ثلاث طبقات، مدمجة حسب اسم الملف" summary="يحل كل تطبيق المكونات الإضافية والمهارات والإجراءات وAGENTS.md من التطبيق المحلي أولاً، ثم الحزمة المشتركة، ثم إطار العمل الافتراضي."
{
  "html": "<div class=\"layer\"><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">1 &middot; App local</span><small class=\"diagram-muted\"><code>apps/&lt;name&gt;/</code> &mdash; highest priority</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">2 &middot; Workspace shared</span><small class=\"diagram-muted\"><code>packages/shared/</code> &mdash; the mid-layer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">3 &middot; Framework default</span><small class=\"diagram-muted\"><code>@agent-native/core</code> &mdash; lowest</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box ok\">first match wins</div></div>",
  "css": ".layer{display:flex;flex-direction:column;align-items:center;gap:6px}.layer .diagram-card{display:flex;flex-direction:column;gap:3px;padding:12px 16px;width:320px}.layer .diagram-arrow{font-size:18px;line-height:1}.layer .diagram-box{margin-top:2px}"
}
```

عندما يحتاج أحد التطبيقات إلى شيء مختلف، قم بإسقاط ملف محلي:

| شيء يجب تجاوزه                  | الملف المطلوب إنشاؤه داخل التطبيق                    |
| ------------------------------- | ---------------------------------------------------- |
| ملحق المصادقة                   | `apps/<name>/server/plugins/auth.ts`                 |
| البرنامج المساعد للدردشة الوكيل | `apps/<name>/server/plugins/agent-chat.ts`           |
| مهارة محددة                     | `apps/<name>/.agents/skills/<skill-name>/SKILL.md`   |
| إجراء محدد                      | `apps/<name>/actions/<action-name>.ts`               |
| تعليمات الوكيل الإضافية         | `apps/<name>/AGENTS.md` (يدمج مع مساحة العمل الأولى) |

لا توجد أسلاك ولا تكوين. أنشئ الملف وسيتولى الأمر.

## تحرير السلوك المشترك {#editing-shared-behavior}

كل شيء شامل يمكنك تخصيصه للحياة في `packages/shared/`. قم بتصدير `authPlugin` من `src/server/index.ts` وسيلتقطه كل تطبيق في عملية إعادة التحميل التالية للمطور. أضف مهارة ضمن `.agents/skills/` وسيراها وكيل كل تطبيق. أضف إجراءً إلى `actions/` ويمكن لكل وكيل تطبيق الاتصال به.

نظرًا لأن الحزمة المشتركة هي تبعية `workspace:*`، يقوم pnpm بربطها في `node_modules/` لكل تطبيق. لا يمكنك إنشاءه أو نشره أبدًا - فالتطبيقات تجمع كل ما تحتاج إليه منه في وقت الإنشاء.

## الموارد العالمية لوقت التشغيل {#runtime-global-resources}

استخدم `packages/shared` للإعدادات الافتراضية على مستوى التعليمات البرمجية التي يجب أن تأتي مع الريبو: المكونات الإضافية، وactions المشتركة، ورمز React المشترك، ونظام الملفات `AGENTS.md`، ونظام الملفات skills. استخدم موارد مساحة عمل Dispatch للسياق العام القابل للتحرير في وقت التشغيل والذي يرغب المسؤولون في إدارته دون تغيير التعليمات البرمجية.

يتم تحديد نطاق موارد الإرسال **جميع التطبيقات** (يرثها كل تطبيق في وقت التشغيل، بدون خطوة النسخ أو المزامنة) أو **التطبيقات المحددة** (تُمنح لكل تطبيق لسياق خاص بالتطبيق). راجع [Workspace](/docs/workspace#global-resources) للحصول على جدول نموذج الموارد الكامل واصطلاحات المسار وحزمة البداية الموصى بها.

## المصادقة وRBAC {#auth-and-rbac}

يأتي كل تطبيق أصلي للوكيل مزودًا بالفعل بـ [Better Auth](/docs/authentication) بالإضافة إلى نظام التنظيم المدمج في إطار العمل. وفي مساحة العمل، يمكنك الحصول على ذلك مجانًا في كل تطبيق، مدعومًا بقاعدة البيانات نفسها. للحصول على نموذج الإيجار المتعدد الكامل - المؤسسات والأدوار وعزل البيانات - راجع [Multi-Tenancy](/docs/multi-tenancy).

بالنسبة للقواعد الخاصة بالمؤسسة (نطاقات القائمة المسموح بها، فرض SSO، عمليات التحقق من الأدوار الإضافية)، قم بتصدير `authPlugin` من `packages/shared/src/server/index.ts`. يفرض كل تطبيق في مساحة العمل الآن هذه القواعد.

يتدفق التنظيم النشط تلقائيًا: `session.orgId` → `AGENT_ORG_ID` → SQL نطاق الصف، لذا فإن البيانات التي تم وضع علامة عليها بـ `org_id` تكون غير مرئية للمؤسسات الأخرى حتى للوكيل. راجع [Security & Data Scoping](/docs/security) للاطلاع على النموذج الكامل.

## خوادم MCP المشتركة {#shared-mcp}

الخيارات الموصى بها لمشاركة خوادم MCP عبر تطبيقات مساحة العمل، حسب التفضيل:

1. **إرسال موارد MCP لمساحة العمل** — أضف موارد `mcp-servers/<name>.json` في Dispatch في نطاق **جميع التطبيقات**. يرث كل تطبيق في مساحة العمل خادم MCP في وقت التشغيل دون الحاجة إلى إجراء تعديلات على الملفات أو إعادة نشرها. منح للتطبيقات المحددة فقط عندما يكون الخادم خاصًا بالتطبيق. الرموز موجودة في قبو الإرسال؛ يمكنك الرجوع إليها من المورد JSON باستخدام `${keys.NAME}`.

2. **Root `mcp.config.json`** — قم بإسقاط ملف في جذر مساحة العمل وسيتصل كل تطبيق في مساحة العمل بنفس خوادم MCP. يمكن للتطبيقات الفردية تجاوز `mcp.config.json` الخاصة بها (فوز جذر التطبيق). استخدم هذا لخوادم MCP المحلية/نظام الملفات (`@modelcontextprotocol/server-filesystem`، `claude-in-chrome`، Playwright) التي لا تحتاج إلى بيانات اعتماد مخزن لكل مستخدم.

3. **إعدادات UI (النطاق الشخصي/المؤسسي)** — لخوادم HTTP MCP البعيدة، يمكن للمستخدمين إضافتها من الإعدادات UI في النطاق الشخصي أو الفريق (org) — لا توجد تعديلات على الملفات، ويتم إعادة تحميلها بسرعة في الوكيل قيد التشغيل.

راجع [MCP Clients](/docs/mcp-clients) للتعرف على مخطط التكوين وقواعد الأسبقية وإعداد المحور.

## متغيرات البيئة المشتركة {#shared-env}

The workspace root `.env` is loaded into every app automatically for deployment-level configuration such as `A2A_SECRET`, `BETTER_AUTH_SECRET`, and `DATABASE_URL`. User, org, and workspace API keys should be saved as scoped DB secrets instead of being written into `.env`. Per-app deploy-time overrides can still go in `apps/<name>/.env` and win on conflict.

بالنسبة لبيانات اعتماد تطبيق وقت التشغيل، تفضل Dispatch vault على تحرير ملفات `.env` يدويًا. يتم تعيين الوصول الافتراضي للمخزن إلى جميع التطبيقات، لذلك يكون كل مفتاح مخزن محفوظ متاحًا لكل تطبيق مساحة عمل ويمكن دفعه باستخدام `sync-vault-to-app`. قم بتبديل المخزن إلى الوضع اليدوي فقط عندما تحتاج التطبيقات إلى منح صريحة لكل مفتاح.

```text
my-company-platform/
├── .env                           # shared: ANTHROPIC_API_KEY=... , A2A_SECRET=... , ...
└── apps/
    └── mail/
        └── .env                   # optional overrides just for mail
```

هناك عدد قليل من عمليات الإعداد التي تكون جاهزة للاستخدام في مساحة العمل:

- **Builder `/cli-auth`**: clicking "Connect Builder" from any app writes `BUILDER_PRIVATE_KEY` and related metadata to scoped DB secrets, so every app can resolve the connection without sharing a deploy-global key.
- **Compatibility key route** (`POST /_agent-native/env-vars`): older onboarding forms still call this route name, but it now saves values as scoped DB secrets. Pass `scope: "workspace"` to share with the active org, or omit it for a per-user key.

## بيانات الاعتماد المشتركة {#shared-credentials}

تشير التطبيقات الموجودة في نفس مساحة العمل إلى نفس `DATABASE_URL` بشكل افتراضي، لذلك يمكن لتخزين بيانات اعتماد إطار العمل إتاحة بيانات الاعتماد لكل تطبيق دون تكوين لكل تطبيق. استخدم `@agent-native/core/credentials` مباشرة، أو قم بإضافة مساعد رفيع في `packages/shared` إذا كانت مساحة العمل الخاصة بك تريد اصطلاح تسمية أكثر صرامة.

## رموز التصميم المشتركة {#design-tokens}

إطار العمل موجود على Tailwind v4. قم بإضافة ملف CSS مشترك إلى `packages/shared` فقط عندما تحتوي مساحة العمل على رموز مميزة للعلامة التجارية الحقيقية لمشاركتها، ثم قم باستيراده من `app/global.css` لكل تطبيق:

```css
@import "tailwindcss";
@import "@my-company-platform/shared/styles/tokens.css";
@source "./**/*.{ts,tsx}";

:root {
  --background: 0 0% 100%; /* ...brand tokens... */
}
.dark {
  --background: 220 6% 6%; /* ... */
}
```

يمكن أن توجد ألوان العلامة التجارية والطباعة ومقاييس التباعد وأي فئات مكونات مشتركة في ملف CSS هذا. قم بتحديثه في `packages/shared` وسيتم تغيير العلامة التجارية لكل تطبيق في الإصدار التالي.

## النشر {#deployment}

أمامك خياران: **النشر الموحد** (الإعداد الافتراضي لمساحات العمل) أو النشر المستقل لكل تطبيق.

### النشر الموحد (مستحسن)

ينشئ أمر واحد كل تطبيق في مساحة العمل ويشحنه خلف أصل واحد، ومسار واحد لكل تطبيق:

```bash
npx @agent-native/core@latest deploy
# https://your-agents.com/mail/*       → apps/mail
# https://your-agents.com/calendar/*   → apps/calendar
# https://your-agents.com/forms/*      → apps/forms
```

تم إنشاء كل تطبيق باستخدام `APP_BASE_PATH=/<name>` و`VITE_APP_BASE_PATH=/<name>` ويتم إصداره من خلال الإعداد المسبق المحدد Nitro. يعد Cloudflare Pages هو الإعداد المسبق الافتراضي ويستخدم عامل إرسال في `dist/_worker.js` بالإضافة إلى `_routes.json`. Netlify مدعوم مع `npx @agent-native/core@latest deploy --preset netlify`؛ فهو يصدر وظائف التطبيق ضمن `.netlify/functions-internal/<app>-server` ويقوم بإنشاء عمليات إعادة توجيه تترك الأصول الثابتة غير قسرية بحيث يخدم CDN الملفات أولاً. Vercel مدعوم بـ `npx @agent-native/core@latest deploy --preset vercel`؛ فهو يكتب حزمة `.vercel/output` الجذرية باستخدام Vercel’s Build Output API.

```an-diagram title="النشر الموحد: أصل واحد ومسار واحد لكل تطبيق" summary="يأتي كل تطبيق من مصدر واحد، لذا فإن جلسات تسجيل الدخول والتطبيقات المشتركة A2A مجانية."
{
  "html": "<div class=\"deploy\"><div class=\"diagram-box accent\">your-agents.com<br><small class=\"diagram-muted\">one DNS record &middot; one cert &middot; one CDN</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"deploy-apps\"><div class=\"diagram-box\">/mail/*</div><div class=\"diagram-box\">/calendar/*</div><div class=\"diagram-box\">/forms/*</div></div><div class=\"diagram-pill ok\">shared login cookie on the apex &bull; same-origin A2A, no CORS</div></div>",
  "css": ".deploy{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.deploy .deploy-apps{display:flex;flex-direction:column;gap:8px}.deploy .diagram-arrow{font-size:24px}.deploy .diagram-pill{flex-basis:100%}"
}
```

التواجد على **نفس الأصل** هو المكان الذي تعيش فيه المكافأة الحقيقية:

- **جلسة تسجيل الدخول المشتركة.** تقوم Better Auth بتعيين ملف تعريف الارتباط الخاص بها على المجال الرئيسي، لذا فإن تسجيل الدخول إلى أي تطبيق يؤدي إلى تسجيل دخولك إلى كل تطبيق. لا توجد رقصة SSO عبر النطاقات.
- **A2A عبر التطبيقات ذات التكوين الصفري.** يصبح وضع علامات `@mail` على `@calendar` جلبًا من نفس المصدر — بدون CORS، ولا يوجد توقيع JWT بين الأشقاء. لا يزال A2A الخارجي يستخدم JWT كما هو الحال اليوم.
- **سجل DNS واحد، وشهادة واحدة، وذاكرة تخزين مؤقت CDN واحدة.**

انشر مخرجات `dist/`:

```bash
wrangler pages deploy dist
```

بالنسبة لـ Netlify:

```bash
npx @agent-native/core@latest deploy --preset netlify --build-only
```

بالنسبة لعمليات نشر Vercel Git، قم بتعيين أمر الإنشاء على:

```bash
npx @agent-native/core@latest deploy --preset vercel --build-only
```

### مسارات التطبيقات العامة

تعتبر تطبيقات مساحة العمل داخلية بشكل افتراضي. بالنسبة إلى موقع عام يحتوي على صفحات إدارية لتسجيل الدخول فقط، قم بتعيين جمهور عام وحماية بادئة المسؤول في `package.json` لهذا التطبيق:

```json
{
  "agent-native": {
    "workspaceApp": {
      "audience": "public",
      "protectedPaths": ["/admin"]
    }
  }
}
```

بالنسبة للتطبيقات الداخلية في الغالب والتي تحتوي على عدد قليل من الصفحات العامة، اترك الجمهور داخليًا وبادئات صفحة القائمة:

```json
{
  "agent-native": {
    "workspaceApp": {
      "publicPaths": ["/", "/share"]
    }
  }
}
```

تؤثر هذه الإعدادات فقط على التنقل في الصفحة للقراءة فقط. تظل أدوات إطار العمل، ودردشة الوكيل، وA2A، والوصول إلى المخزن، وAPIs التعسفية مصادق عليها ما لم يعلن التطبيق صراحة عن البادئات العامة باستخدام `createAuthPlugin({ publicPaths: [...] })`.

### النشر المستقل لكل تطبيق

هل تفضل كل تطبيق في نطاقه الخاص (`mail.company.com`، `calendar.company.com`)؟ لا يزال كل تطبيق في مساحة العمل قابلاً للنشر بشكل مستقل — يتصرف `cd apps/mail && npx @agent-native/core@latest build` تمامًا مثل السقالة المستقلة. يمر A2A عبر التطبيق بعد ذلك عبر المسار القياسي الموقع بـ JWT مع `A2A_SECRET` المشترك. تتم معالجة SSO عبر المجال بين التطبيقات المنشورة بشكل منفصل عن طريق اتحاد الهوية مع Dispatch كمحور - راجع [Cross-App SSO](/docs/cross-app-sso)؛ يتجنب النشر الموحد ذو الأصل الواحد الحاجة إليه.

### قاعدة بيانات مشتركة، بيانات اعتماد مشتركة

مهما كان اختيارك، قم بتوجيه كل تطبيق إلى نفس `DATABASE_URL` للحصول على حالة التطبيقات المشتركة خارج الصندوق: مجموعة واحدة من حسابات المستخدمين، ومجموعة واحدة من المؤسسات، ومجموعة واحدة من الإعدادات المشتركة. إذا كان لكل تطبيق قاعدة بيانات خاصة به، فسيظل نمط مساحة العمل يعمل - وستفقد قصة الحالة المشتركة تلك.

لا يتم نشر الحزمة المشتركة نفسها بشكل مستقل أبدًا. إنه قسم `workspace:*` الذي يرتبط pnpm به في `node_modules/` لكل تطبيق، بحيث يقوم كل تطبيق بتجميع كل ما يحتاج إليه بشفافية في وقت الإنشاء.

## خارج النطاق (في الوقت الحالي) {#out-of-scope}

نمط مساحة العمل ضيق عن عمد. بعض الأشياء التي لم يتعامل معها عمدًا حتى الآن:

- **خزنة بيانات الاعتماد المشفرة.** تفضل مخزن الإرسال لبيانات اعتماد تطبيقات وقت التشغيل (راجع [Shared environment variables](#shared-env)). المسار الاحتياطي غير المخزن - بيانات الاعتماد المشتركة المكتوبة مباشرة في جدول إطار العمل `settings` - يخزنها كنص عادي اليوم، لذا قم بالتدوير بشكل مسؤول عند الاعتماد عليها.
- **نشر التعليمات البرمجية المشتركة إلى npm الخاص.** الحزمة المشتركة هي `workspace:*` فقط؛ تعد مشاركة عمليات الريبو المتعددة عبر سجل خاص أمرًا ممكنًا، ولكنها ليست مدعومة.
- **مكتبة المكونات ذات الرأي.** `packages/shared` هو المكان الذي تضع فيه المكونات المشتركة. لا يفرض إطار العمل shadcn/ui أو أي نظام آخر على تلك الفتحة.

## انظر أيضًا {#see-also}

- [Workspace](/docs/workspace) — طبقة التخصيص (`AGENTS.md`، `LEARNINGS.md`، الذاكرة الشخصية، skills، الوكلاء المخصصون) يشاركها كل تطبيق في مساحة العمل.
- [Workspace Governance](/docs/workspace-management) — التفرع، CODEOWNERS، مراجعة العلاقات العامة عبر العديد من التطبيقات في مستودع واحد.
- [Multi-Tenancy](/docs/multi-tenancy) — المؤسسات، والأدوار، وعزل البيانات لكل مؤسسة.
- [Cross-App SSO](/docs/cross-app-sso) — اتحاد الهوية لعمليات نشر المجال المنفصل.
- [Dispatch](/docs/dispatch) — مستوى التحكم في وقت التشغيل الذي يوجد عادةً داخل مساحة عمل متعددة التطبيقات مثل مخزن الأسرار وكتالوج التكامل ومركز الموافقات.
