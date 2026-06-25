---
title: "الترحيل إلى Agent-Native (/الترحيل)"
description: "الترحيل هو هدف مضمن/ترحيل في مساحة عمل Agent-Native Code - وليس تطبيقًا منفصلاً. راجع رمز Agent-Native UI للحصول على الدليل الكامل."
---

# الترحيل إلى Agent-Native (/الترحيل)

الترحيل **ليس منتجًا أو قالبًا منفصلاً** — فهو مضمن
هدف `/migrate` داخل مساحة عمل [Agent-Native Code](/docs/code-agents-ui).
يتم تشغيله كجلسة تعليمات برمجية عادية يمكنك استئنافها والإرفاق بها وفحصها وإيقافها.

```an-diagram title="/migrate عبارة عن جلسة تعليمات برمجية، وليست تطبيقًا منفصلاً" summary="يتم إدخال المسار، URL، أو الوصف؛ يشترك التشغيل في نفس المخزن والنص وعناصر التحكم مثل أي جلسة تعليمات برمجية أخرى، ويمكن أن يصدر ملفًا محمولاً."
{
  "html": "<div class=\"diagram-migrate\"><div class=\"diagram-col\"><div class=\"diagram-pill\">./local-app</div><div class=\"diagram-pill\">https://example.com</div><div class=\"diagram-pill\">--describe \\\"...\\\"</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">/migrate goal</span><small class=\"diagram-muted\">نفس المخزن · النص · عناصر تشغيل التنفيذ</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\" data-rough>تطبيق مرحل</div><div class=\"diagram-pill ok\">--emit dossier</div></div></div>",
  "css": ".diagram-migrate{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-migrate .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-migrate .diagram-arrow{font-size:22px;line-height:1}.diagram-migrate .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

```bash
npx @agent-native/core@latest code /migrate ./my-next-app --out ../migrated-app
npx @agent-native/core@latest code /migrate https://example.com --describe "marketing site plus dashboard"
npx @agent-native/core@latest migrate ./my-next-app --out ../migrated-app   # shortcut into the same goal
```

الدليل الكامل — أشكال الإدخال (المسار / URL / الوصف)، ملفات `--emit`،
وضع التخطيط مقابل الوضع التلقائي، وعناصر التحكم في التشغيل، وبيانات الاعتماد، والروابط العميقة لسطح المكتب، و
صادرات الحزمة `@agent-native/migrate` — موجودة في
[Agent-Native Code UI → Migrating to Agent-Native](/docs/code-agents-ui#migrate).

> [!NOTE]
> تمت إزالة تطبيق تفاصيل `migration` القديم المخفي. استخدم الكود
> ، أو علامة التبويب Desktop Code، أو الملف المنبعث كالملف المدعوم
> الأسطح.
