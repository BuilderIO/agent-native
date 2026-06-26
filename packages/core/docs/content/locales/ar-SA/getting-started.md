---
title: "الخطوات الأولى"
description: "قم بإنشاء تطبيق وكيل، وافهم التعليمات، وskills، وactions، ثم شاهد الوكيل وهو يستدعي الإجراء الأول."
---

# البدء

توفر تطبيقات Agent-Native لوكيل الذكاء الاصطناعي وUI نفس actions والبيانات
الحالة. يتم إنشاء الوكيل الأساسي من التعليمات التي ترشده، skills التي تعلم
السلوك القابل للتكرار، وactions الذي يتيح له القيام بعمل حقيقي.

**هل تريد تطبيقًا كاملاً للبدء منه؟** استنساخ أحد نماذجنا الغنية —
[Chat](/docs/template-chat), [Mail](/docs/template-mail),
[Calendar](/docs/template-calendar), [Content](/docs/template-content),
[Analytics](/docs/template-analytics)، و[many more](/docs/cloneable-saas) —
كل تطبيق كامل المواصفات تقوم بتخصيصه.

هل تريد البناء من الصفر؟ الخيار الوحيد أمامك هو ما إذا كنت تريد UI —
كل شيء بعد (كتابة التعليمات، إضافة skills، تعريف actions، التشغيل
الوكيل) هو نفسه في كلتا الحالتين.

```an-file-tree title="agent أساسي من Agent-Native"
{
  "entries": [
    { "path": "AGENTS.md", "note": "تعليمات دائمة: الهدف، القواعد، النبرة، وخريطة ما يستطيع agent فعله" },
    { "path": ".agents/skills/customer-research/SKILL.md", "note": "playbook قابل لإعادة الاستخدام يحمّله agent عندما تطابق المهمة" },
    { "path": "actions/summarize-week.ts", "note": "code typed يمكن لل agent و UI و CLI و HTTP و MCP و A2A و jobs و webhooks تشغيله" }
  ]
}
```

هذا صحيح سواء بدأت بالدردشة UI، أو وكيل بلا رأس، أو تطبيق كامل.
يغير UI السطح؛ التعليمات، skills، وactions تعطي الوكيل
التوجيه والسلوك.

## 1. أنشئ تطبيقك

ستحتاج إلى [Node.js 22+](https://nodejs.org) و[pnpm](https://pnpm.io).

قم بتشغيل `create` بدون أي علامات وسيسألك عن الطريقة التي تريد البدء بها (قالب كامل،
الدردشة أو مقطوعة الرأس) قبل أي شيء آخر:

```bash
npx @agent-native/core@latest create my-app
```

أو قم بتمرير علامة لتخطي المطالبة:

**هل تريد UI؟** ابدأ من قالب الدردشة. تحصل على وكيل عامل بالإضافة إلى
دردشة قابلة للتخصيص UI، وكل إجراء تضيفه يظهر فيها تلقائيًا:

```bash
npx @agent-native/core@latest create my-app --template chat
```

**فقط البدائي بلا رأس؟** ابدأ بلا رأس — نفس actions والوكيل
حلقة، بدون غلاف UI:

```bash
npx @agent-native/core@latest create my-agent --headless
```

ثم قم بالتثبيت من المجلد الذي قمت بإنشائه:

```bash
cd my-agent # أو تطبيقي إذا اخترت قالب الدردشة
pnpm install
```

من الآن فصاعدًا، أصبح الاثنان متطابقين.

## 2. أضف إجراءً

الإجراء هو عملية واحدة يمكن لوكيلك — وUI — الاتصال بها. كلا السقالات
اشحن بهذا المثال:

```an-annotated-code title="أول action لك"
{
  "filename": "actions/hello.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { z } from \"zod\";\n\nexport default defineAction({\n  description: \"قل مرحبًا من الوكيل المحلي.\",\n  schema: z.object({\n    name: z.string().default(\"world\"),\n  }),\n  http: { method: \"GET\" },\n  readOnly: true,\n  run: async ({ name }) => {\n    return { message: `Hello, ${name}!` };\n  },\n});",
  "annotations": [
    { "lines": "5", "label": "وصف الأداة", "note": "يقرأ الوكيل `description` ليقرر متى يستدعيه كأداة." },
    { "lines": "6-8", "label": "عقد typed", "note": "يتحقق zod `schema` واحد من الإدخال من كل سطح: الوكيل، UI، HTTP، MCP وA2A." },
    { "lines": "9", "label": "فعل HTTP", "note": "اجعل هذا الإجراء متاحًا كنقطة نهاية HTTP تُركّب تلقائيًا." },
    { "lines": "10", "label": "للقراءة فقط", "note": "تشير `readOnly` إلى أن الإجراء آمن للاستدعاء دون موافقة وقابل للتخزين المؤقت للاستعلامات." },
    { "lines": "11-13", "label": "تنفيذ واحد", "note": "جسم `run` هو مصدر الحقيقة الوحيد الذي تنفذه كل الواجهات." }
  ]
}
```

استبدل `hello` بالعملية الحقيقية الأولى في مجالك. قمت بتعريفه مرة واحدة؛
يلتقطه كل سطح.

استخدم `AGENTS.md` للحصول على إرشادات يجب تطبيقها في كل دورة. استخدم مهارة عندما
إلى سير عمل أو إجراء مجال قابل لإعادة الاستخدام. استخدم الإجراء عندما يكون
يحتاج الوكيل إلى طريقة مكتوبة وقابلة للاختبار لقراءة البيانات أو كتابتها أو الاتصال بـ API أو
إجراء الموافقة.

## 3. قم بتشغيله

استدعاء الإجراء مباشرة:

```bash
pnpm action hello --name Steve
```

أو اطلب من الوكيل أن يتصل بك:

```bash
pnpm agent "Call the hello action for Steve and explain what happened."
```

إذا بدأت من قالب الدردشة، فقم بتشغيل التطبيق واستخدم نفس الوكيل في
المتصفح - يمكنه بالفعل استدعاء كل إجراء تحدده:

```bash
pnpm dev
```

يمكن الآن الوصول إلى هذا الإجراء الواحد من خلال الدردشة UI، وCLI، وHTTP، وMCP، وA2A،
المهام المجدولة، وwebhooks. حدد مرة واحدة، اتصل من أي مكان.

```an-diagram title="إجراء واحد، على كل سطح" summary="يتم إرسال ملف defineAction واحد إلى كل مستهلك بدون أي أسلاك إضافية."
{
  "html": "<div class=\"diagram-fan\"><div class=\"diagram-box\" data-rough>defineAction</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-surfaces\"><span class=\"diagram-pill\">واجهة الدردشة</span><span class=\"diagram-pill\">CLI</span><span class=\"diagram-pill\">HTTP</span><span class=\"diagram-pill\">MCP</span><span class=\"diagram-pill\">A2A</span><span class=\"diagram-pill\">مهام مجدولة</span><span class=\"diagram-pill\">Webhooks</span></div></div>",
  "css": ".diagram-fan{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-fan .diagram-surfaces{display:flex;flex-wrap:wrap;gap:8px;max-width:420px}.diagram-fan .diagram-arrow{font-size:22px;line-height:1}"
}
```

## تم بناء الحالة في

لا يعني مقطوع الرأس أنه عديم الجنسية. Actions، الجلسات، حالة التطبيق، المواضيع،
سجل التشغيل وبيانات الاعتماد كلها موجودة في SQL. محليًا، هذا هو SQLite في
`data/app.db`; in production you set `DATABASE_URL`. See
[Deployment](/docs/deployment).

```an-callout
{
  "tone": "info",
  "body": "**لا يزال تطبيق Headless تطبيقًا حقيقيًا.** تستمر حلقة وكيل التطبيق في الجلسات والسلاسل وعمليات التشغيل والإعدادات وبيانات الاعتماد في SQL — وهي ليست مطالبة عديمة الحالة. يمكنك إضافة UI لاحقًا دون لمس أفعالك أو حالتك."
}
```

## تخصيص UI

إذا بدأت من قالب الدردشة، فإن UI متاح لك لتحريره. الدردشة نفسها
هو مسار صغير مبني على مكون `<AgentChatSurface>`:

```tsx
// app/routes/_index.tsx
import { AgentChatSurface } from "@agent-native/core/client";

export default function ChatRoute() {
  return <AgentChatSurface mode="page" className="h-full" />;
}
```

- **`app/routes/_index.tsx`** — صفحة الدردشة. تغيير الاقتراحات، فارغ
  الحالة والتخطيط.
- **`app/root.tsx`** — غلاف التطبيق. أضف مساراتك وشاشاتك الخاصة حول
  الوكيل.
- أسقط الوكيل في أي شاشة باستخدام `<AgentSidebar>`، واعمل عليه يدويًا من
  مع `sendToAgentChat()`، أو قم بتشغيل الإجراء مباشرة باستخدام
  `useActionMutation()`.

راجع [Drop-in Agent](/docs/drop-in-agent) للتعرف على مجموعة المكونات الكاملة، و
[Native واجهة الدردشة](/docs/native-chat-ui) لعرض نتائج الإجراء على هيئة جداول
المخططات والبطاقات المكتوبة بدلاً من النص العادي.

**بدأت بدون رأس وتريد UI لاحقًا؟** قالب الدردشة _هو_ UI على الطريق المنحدر —
طبقة `app/` (جهاز التوجيه React + Vite) هي بالضبط ما تمثله السقالة مقطوعة الرأس
يترك. أنظف خطوة هي البدء (أو إعادة السقالة) من الدردشة
قالب; يتم ترحيل حالة `actions/` والوكيل وحالة SQL دون تغيير. انظر
[Agent Surfaces](/docs/agent-surfaces) لكل سطح بينهما.

## بنية المشروع

```text
my-app/
  actions/         # إجراءات يمكن للوكيل استدعاؤها
  app/             # واجهة React أمامية (لقوالب UI فقط؛ تُحذف في وضع headless)
  server/          # خادم Nitro API (مسارات، إضافات)
  AGENTS.md        # تعليمات الوكيل الدائمة
  .agents/         # مهارات يمكن للوكيل جلبها عند الحاجة
  data/app.db      # حالة SQLite محلية عند عدم ضبط DATABASE_URL
```

## إلى أين ستتجه بعد ذلك

- **[Key Concepts](/docs/key-concepts)** — البنية الأساسية: SQL، actions،
  المزامنة والوعي بالسياق.
- **[Actions](/docs/actions)** — الإجراء الكامل API: المخططات، وHTTP، والمصادقة، و
  الموافقة.
- **[Agent Surfaces](/docs/agent-surfaces)** — بدون رأس، دردشة، عربة جانبية مدمجة،
  والتطبيق الكامل.
- **[Drop-in Agent](/docs/drop-in-agent)** — أضف دردشة الوكيل إلى أي تطبيق React.
- **[Deployment](/docs/deployment)** — ضع تطبيقك على نطاقك الخاص.
- **[FAQ](/docs/faq)** — أسئلة حول الإعداد والمنتج.
