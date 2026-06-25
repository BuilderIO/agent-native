---
title: "تطبيقات Pure-Agent"
description: "التطبيقات التي يكون فيها الوكيل هو المنتج بالكامل: حلقة وكيل التطبيق هي الباب الأمامي، وتتم إضافة UI فقط عندما يحتاج إليه البشر."
---

# تطبيقات Pure-Agent

تطبيق الوكيل النقي هو الحد الأدنى من تطبيق الوكيل الأصلي: حلقة وكيل التطبيق هي
منتج، وليس لوحة معلومات. يمكنك إرسال طلب من المحطة، Slack، عبر البريد الإلكتروني،
مهمة مجدولة، أو وكيل آخر، أو الدردشة — "تلخيص رسائل البريد الإلكتروني غير المقروءة"، أو "نشر
المقاييس اليومية إلى Slack" - ويعمل الوكيل ويعيد النتيجة أينما كانت
ينتمي. لا يزال تطبيقًا حقيقيًا: actions، الجلسات، حالة التطبيق، السجل،
الإعدادات وبيانات الاعتماد وسجلات المشاركة كلها موجودة في SQL.

```an-diagram title="حلقة وكيل التطبيق هي الباب الأمامي" summary="تصل العديد من نقاط الدخول إلى حلقة وكيل واحدة عبر إجراءات وحالة SQL-backed؛ تعود النتائج إلى المكان الذي جاء منه الطلب. تتم إضافة واجهة المستخدم فقط عندما يحتاج البشر إلى الإشراف."
{
  "html": "<div class=\"diagram-pure\"><div class=\"diagram-col\"><div class=\"diagram-pill\">Terminal</div><div class=\"diagram-pill\">Slack · بريد</div><div class=\"diagram-pill\">مهمة مجدولة</div><div class=\"diagram-pill\">Another agent (A2A)</div><div class=\"diagram-pill\">Chat</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">حلقة وكيل التطبيق</span><small class=\"diagram-muted\">الإجراءات · الجلسات · حالة التطبيق في SQL</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>تعود النتيجة<br><small class=\"diagram-muted\">to where it belongs</small></div></div>",
  "css": ".diagram-pure{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-pure .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-pure .diagram-arrow{font-size:22px;line-height:1}.diagram-pure .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

قم بالوصول إلى هذا الشكل عند تشغيل العمل في الخلفية، ويترك الإخراج
، فإن المجال عبارة عن طلقة واحدة، أو أنك تقوم بإنشاء نموذج أولي. لا يزال الوكيل بحاجة إلى UI —
ليست لوحة تحكم، ولكنها مكان يمكن للبشر الإشراف عليه وتكوينه وتوجيهه —
وهذا هو السبب وراء قيام تطبيقات الوكيل الخالص عادةً بتثبيت غلاف الدردشة المدمج.

هذا هو شكل المنتج **بدون رأس**. دليل القرار الكامل، ما يأتي
يتوفر الآن الصندوق والسقالة والوصول إلى الريبو وتشغيل المشاركة في مكان واحد:

→ [**Agent Surfaces — Headless agent**](/docs/agent-surfaces#headless)

## ما هي الخطوة التالية

- [**Agent Surfaces — Headless**](/docs/agent-surfaces#headless) — دليل القرار الكامل بدون رأس وAPIs
- [**Getting Started**](/docs/getting-started) — قم بإنشاء تطبيق دردشة أو وكيل بلا رأس أولاً
- [**Dispatch**](/docs/template-dispatch) — قالب مساحة العمل الذي يمثل نقطة بداية رائعة للوكيل النقي
- [**Messaging the agent**](/docs/messaging) — كيف يتحدث المستخدمون مع الوكيل عبر الويب، Slack، Telegram، البريد الإلكتروني
- [**Recurring Jobs**](/docs/recurring-jobs) — المطالبات المجدولة التي يعمل الوكيل من تلقاء نفسه
- [**Actions**](/docs/actions) — الأدوات التي سيتصل بها وكيلك النقي
