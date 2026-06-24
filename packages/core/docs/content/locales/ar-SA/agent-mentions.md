---
title: "إشارات الوكيل"
description: "ضع علامة على الوكلاء المخصصين والوكلاء المتصلين والملفات في الدردشة باستخدام الإشارات @."
---

# إشارات الوكيل

اكتب `@` في مؤلف الدردشة لذكر الوكلاء المخصصين والوكلاء المتصلين والملفات والموارد.

## نظرة عامة {#overview}

يقوم نظام الإشارة `@` بربط مؤلف الدردشة بالنظام البيئي للوكيل الأوسع. عندما تكتب `@`، تظهر نافذة منبثقة تدرج الوكلاء المخصصين المتاحين والوكلاء المتصلين وملفات قاعدة التعليمات البرمجية والموارد.

هذه هي الطريقة التي تقوم بها بتنسيق سير العمل متعدد الوكلاء من دردشة واحدة. اطلب من وكيل `@design` المحلي مراجعة التصميم، ومن `@analytics` الحصول على أحدث الأرقام من تطبيق آخر، ويمكن للوكيل الرئيسي دمج كليهما في محادثة واحدة.

## ذكر الوكلاء {#mentioning-agents}

للإشارة إلى وكيل في مؤلف الدردشة:

1. اكتب `@` لفتح القائمة المنبثقة للإشارة
2. تصفح أو ابحث في قائمة الوكلاء المتاحين
3. حدد وكيلًا — يظهر كعلامة في رسالتك
4. أرسل الرسالة — يقوم الخادم بحل الإشارة ويتضمن استجابة ذلك الوكيل في سياق المحادثة

هناك مساران للوكيل:

- **الوكلاء المخصصون** — ملفات تعريف وكيل مساحة العمل المحلية في `agents/*.md`. يتم تشغيلها داخل التطبيق/وقت التشغيل الحالي باستخدام تعليمات ملف تعريف الوكيل وتجاوز النموذج الاختياري.
- **الوكلاء المتصلون** — أقران A2A عن بعد. يتم استدعاؤها عبر [A2A protocol](/docs/a2a-protocol).

في كلتا الحالتين، يرى وكيلك الرئيسي الاستجابة ويمكنه الرجوع إليها أو البناء عليها.

```an-diagram title="Where an @-mention routes" summary="The server splits each mention by type: custom agents run locally, connected agents go over A2A — both responses fold back into the main agent's context."
{
  "html": "<div class=\"diagram-mention\"><div class=\"diagram-node\">@-mention<br><small class=\"diagram-muted\">in the composer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Server resolves</span><small class=\"diagram-muted\">extract refs by type</small></div><div class=\"diagram-col\"><div class=\"row\"><span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box\">Custom agent<br><small class=\"diagram-muted\">agents/*.md &middot; runs local</small></div></div><div class=\"row\"><span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box\">Connected agent<br><small class=\"diagram-muted\">A2A peer &middot; remote call</small></div></div></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box diagram-accent\">&lt;agent-response&gt;<br><small class=\"diagram-muted\">injected into main agent</small></div></div>",
  "css": ".diagram-mention{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-mention .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-mention .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-mention .row{display:flex;align-items:center;gap:8px}.diagram-mention .diagram-arrow{font-size:22px;line-height:1}"
}
```

## كيفية العمل {#how-it-works}

عند إرسال رسالة تحتوي على إشارة `@`، يحدث ما يلي على الخادم:

1. يستخرج الخادم المراجع المذكورة من الرسالة
2. لكل وكيل مذكور:
   - يعمل الوكلاء المخصصون محليًا باستخدام تعليمات ملفاتهم الشخصية
   - يتم استدعاء الوكلاء المتصلين عبر A2A
3. يتم تغليف استجابة الوكيل في كتلة `<agent-response>` XML وإدراجها في سياق المحادثة
4. يقوم الوكيل الرئيسي بمعالجة الرسالة المثرية، ويرى كلاً من نص المستخدم واستجابة الوكيل المذكور

ما يراه الوكيل الرئيسي في سياقه:

```text
User: Draft an email with the latest signup numbers. @analytics

<agent-response agent="analytics">
Last week's signups: 1,247 total
  - Organic: 623
  - Paid: 412
  - Referral: 212
</agent-response>
```

يمكن للوكيل الرئيسي بعد ذلك استخدام هذه البيانات بشكل طبيعي في استجابته - على سبيل المثال، دمج الأرقام في مسودة بريد إلكتروني.

```an-callout
{
  "tone": "info",
  "body": "Mentioned-agent output arrives as an `<agent-response agent=\"…\">` block in the **main agent's** context — not as separate chat bubbles. The main agent decides how to weave it into the reply."
}
```

## إضافة وكلاء {#adding-agents}

يصبح الوكلاء متاحين للإشارة من خلال عدة آليات:

- **وكلاء مساحة العمل المخصصة** — أنشئ ملفات تعريف الوكلاء في علامة تبويب مساحة العمل باسم `agents/*.md`
- **الاكتشاف التلقائي** — يكتشف إطار العمل تلقائيًا الوكلاء المتصلين الذين يعملون على منافذ معروفة أو URLs التي تم تكوينها
- **البيانات البعيدة** — إضافة بيانات الوكيل المتصل كـ `remote-agents/*.json`

### وكلاء مساحة العمل المخصصة

الوكلاء المخصصون هم ملفات Markdown مخزنة في مساحة العمل:

```markdown
---
name: Design
description: Reviews layouts, product UX, and visual direction.
model: inherit
---

You are a focused design agent.
```

راجع [Workspace — Custom Agents](/docs/workspace#custom-agents) للتعرف على التنسيق الكامل (بما في ذلك `tools`، و`delegate-default`، وتجاوزات النماذج).

يمكنك إنشاؤها من علامة التبويب "مساحة العمل" باستخدام:

- `Create Agent` -> `Describe It`
- `Create Agent` -> `Fill Form`

### بيانات الوكيل المتصل

لا يزال وكلاء A2A البعيدون يستخدمون بيانات JSON:

```json
// remote-agents/analytics.json
{
  "name": "Analytics Agent",
  "url": "https://analytics.example.com",
  "apiKey": "env:ANALYTICS_A2A_KEY",
  "description": "Runs analytics queries and returns data",
  "skills": ["run-query", "generate-chart"]
}
```

---

## للمطورين: توسيع الإشارات {#extending-mentions}

يمكن للقوالب تسجيل موفري الإشارات المخصصة لإضافة عناصر قابلة للذكر خاصة بالمجال بخلاف الوكلاء والملفات. يقوم موفر الإشارة بتنفيذ واجهة `MentionProvider`:

```an-annotated-code title="A custom MentionProvider"
{
  "filename": "server/mentions/contacts.ts",
  "language": "ts",
  "code": "import type { MentionProvider } from \"@agent-native/core/server\";\n\nconst contactsProvider: MentionProvider = {\n  id: \"contacts\",\n  label: \"Contacts\",\n\n  // Search for mentionable items\n  async search(query: string) {\n    const contacts = await db.query.contacts.findMany({\n      where: like(contacts.name, `%${query}%`),\n      limit: 10,\n    });\n    return contacts.map((c) => ({\n      id: c.id,\n      label: c.name,\n      description: c.email,\n      type: \"contact\",\n    }));\n  },\n\n  // Resolve a mention into context for the agent\n  async resolve(id: string) {\n    const contact = await db.query.contacts.findFirst({\n      where: eq(contacts.id, id),\n    });\n    return {\n      type: \"context\",\n      text: `Contact: ${contact.name} (${contact.email})`,\n    };\n  },\n};",
  "annotations": [
    { "lines": "4-5", "label": "Identity", "note": "`id` namespaces the provider; `label` is the section heading shown in the `@` popover." },
    { "lines": "8-9", "label": "search", "note": "Runs as the user types after `@`. Return up to a handful of matches as `{ id, label, description, type }`." },
    { "lines": "23-24", "label": "resolve", "note": "Called when the message is sent. Turns a picked id into `{ type: \"context\", text }` that is injected into the agent's context." }
  ]
}
```

تسجيل الموفرين في تكوين البرنامج المساعد للدردشة الوكيل:

```ts
// server/plugins/agent-chat.ts
import { createAgentChatPlugin } from "@agent-native/core/server";

export default createAgentChatPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
  mentionProviders: { contacts: contactsProvider },
});
```

يظهر موفرو الإشارات المخصصة جنبًا إلى جنب مع الوكيل المضمن وموفري الملفات في القائمة المنبثقة للإشارة.

## الملفات المرجعية {#referencing-files}

لا يقتصر العنصر المنبثق `@` على الوكلاء. يمكنك أيضًا الرجوع إلى:

- **ملفات Codebase** — اكتب `@` وابحث عن اسم ملف. يتم تضمين محتويات الملف في سياق الوكيل حتى يتمكن من قراءة الملف أو تحليله أو تعديله.
- **موارد مساحة العمل** — الملفات المرجعية المحددة في علامة التبويب مساحة العمل. يمكن أن تكون هذه ملفات بيانات، أو تكوينات، أو أي محتوى منظم آخر.
- **Skills** — اكتب `/` للإشارة إلى إحدى المهارة. توفر Skills تعليمات منظمة ترشد كيفية تعامل الوكيل مع المهمة.

تتبع جميع أنواع المراجع نفس النمط: حدد من القائمة المنبثقة، وسيتم حل المحتوى المشار إليه وإدخاله في سياق الوكيل عند إرسال الرسالة.

## اختيار الوكيل الفرعي {#sub-agent-selection}

يمكن للوكيل الرئيسي أيضًا استخدام الوكلاء المخصصين عند نشر الوكلاء الفرعيين باستخدام `agent-teams` (الإجراء: "النشر").

قم بتمرير المعلمة `agent` لاختيار ملف تعريف من `agents/*.md`. تتم إضافة تعليمات ملف التعريف هذا إلى التشغيل المفوض، ويمكن للمادة الأمامية `model` الخاصة به تجاوز النموذج الافتراضي لذلك الوكيل الفرعي.
