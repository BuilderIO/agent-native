---
title: "موافقات الإنسان في الحلقة"
description: "إيقاف الوكيل مؤقتًا قبل تشغيل الإجراء عالي العواقب — تُصدر بوابة needApproval الخاصة بـ defineAction حدث موافقة_مطلوب، ويوافق الإنسان، وعندها فقط يتم تنفيذ الأداة."
---

# موافقات الإنسان داخل الحلقة

يجب تشغيل معظم actions. القليل منها - إرسال بريد إلكتروني، وشحن البطاقة، وحذف الحساب - هي أمور خارجية ويصعب التراجع عنها، ولا تريد أن يقوم الوكيل بذلك بشكل مستقل. بالنسبة إلى هؤلاء، `defineAction` لديه **بوابة موافقة** للاشتراك: عندما يحاول الوكيل استدعاء الإجراء، تتوقف الحلقة مؤقتًا، وتظهر إمكانية الموافقة/الرفض للإنسان، وتشغيل الإجراء _فقط_ بعد موافقة الإنسان على هذا الاتصال المحدد.

> [!WARNING]
> حافظ على الموافقات نادرة. كل إجراء مسور يمثل نقطة توقف صعبة في حلقة العميل - فهو يقطع التشغيل ويتطلب رحلة ذهابًا وإيابًا من الإنسان. استخدم `needsApproval` فقط للعمليات ذات العواقب العالية، والتي يصعب التراجع عنها، والتي تواجه الخارج. إذا وجدت نفسك تتابع القراءة أو الكتابة الروتينية، فأنت مخطئ. الإعداد الافتراضي هو **إيقاف**، ويجب أن يتم إيقافه في كل إجراء تقريبًا.

## بوابة `needsApproval` {#needs-approval}

قم بتعيين `needsApproval` على `defineAction`. يقبل قيمة منطقية أو مسندًا:

```an-annotated-code title="بوابات العمل التبعي واحد"
{
  "filename": "actions/send-email.ts",
  "language": "ts",
  "code": "export default defineAction({\n  description: \"Send an email via Gmail.\",\n  schema: z.object({\n    to: z.string(),\n    subject: z.string(),\n    body: z.string(),\n  }),\n  // Sending is outward-facing and hard to undo, so the agent can never send\n  // without a human approving the specific call. Drafting/queueing is\n  // unaffected — only the real send is gated.\n  needsApproval: true,\n  run: async (args) => {\n    /* ...actually send... */\n  },\n});",
  "annotations": [
    { "lines": "10", "label": "الشارع كله", "note": "علم واحد. مع صدق المكالمة وعدم الموافقة على المكالمة، تتوقف الحلقة قبل `run` - لا يصل النموذج أبدًا إلى التأثير الجانبي من تلقاء نفسه." },
    { "lines": "11-13", "label": "run() is untouched", "note": "يظل المعالج كما هو. يتم فرض الموافقة من خلال الحلقة المحيطة بها، وليس من خلال أي شيء داخل `run`." }
  ]
}
```

- **`needsApproval: true`** — تتطلب الموافقة دائمًا.
- **`needsApproval: (args, ctx) => boolean | Promise<boolean>`** — لا تتطلب الموافقة إلا عندما يكون المسند صحيحًا. بوابة مشروطة، على سبيل المثال. فقط للمستلمين الخارجيين أو فقط فوق حد الدولار:

  ```النهاية
  يحتاج إلى موافقة: (args) => !args.to.endsWith("@your-company.com"),
  ```

  احتفظ بالمسند نقيًا وسريعًا. **فشل في الإغلاق**: إذا تم طرح المسند، فإن إطار العمل يعامل ذلك على أنه "موافقة مطلوبة" بدلاً من تشغيل إجراء عالي العواقب بصمت.

عند حذف `needsApproval`، يظل السلوك بايت مقابل بايت دون تغيير — لا توجد تكلفة إضافية على المسار المشترك.

يعمل هذا بنفس الطريقة مع actions بنمط `parameters` القديم وactions المستند إلى المخطط، وللوكيل داخل التطبيق، والوكلاء الفرعيين، والمتصلين A2A، وMCP (يمر كل سطح وكيل عبر نفس الحلقة).

## كيفية توقف الحلقة مؤقتًا {#loop}

عندما يستدعي الوكيل إجراءً مسورًا ولم تتم الموافقة على هذا الاستدعاء المحدد بالفعل، فإن الحلقة **لا** تنفذ `run()`. بدلا من ذلك:

1. يحل البوابة. بالنسبة للمسند، فإنه يستدعي `needsApproval(input, ctx)`؛ يتم التعامل مع الرمية على أنها "يجب الموافقة عليها" (تم إغلاق الفشل).
2. يُصدر حدث `tool_start` (بحيث يُظهر UI المكالمة) متبوعًا مباشرة بحدث **`approval_required`**، ثم يوقف الدور. لا يحدث التأثير الجانبي للإجراء أبدًا.

يحمل حدث `approval_required` كل ما يحتاجه العميل لتوفير التكلفة:

| الحقل         | اكتب     | ملاحظات                                                                             |
| ------------- | -------- | ----------------------------------------------------------------------------------- |
| `tool`        | `string` | اسم الإجراء الذي حاول الوكيل الاتصال به.                                            |
| `input`       | كائن     | الوسيطات التي مررها الوكيل.                                                         |
| `approvalKey` | `string` | **المفتاح الثابت** يقوم العميل بالتردد مرة أخرى للموافقة على _هذه المكالمة بالضبط_. |
| `toolCallId`  | `string` | معرف استدعاء الأداة من جانب النموذج، عندما يكون متاحًا.                             |

يتم اشتقاق `approvalKey` بشكل حتمي من اسم الأداة بالإضافة إلى مدخلاتها، لذا فإن نفس الاستدعاء المنطقي ينتج دائمًا نفس المفتاح. النموذج لا يراه أو يحدده أبدًا - فهو مجرد مصافحة بين إطار العمل وقدرة الموافقة البشرية.

ترجع أداة الإيقاف المؤقت نتيجة تخبر النموذج بتوقف الدور مؤقتًا وعدم إعادة المحاولة، وبالتالي لا يدور النموذج.

## كيف يوافق الإنسان {#approve}

في `approval_required`، تعرض الدردشة UI قبول / رفض \*\* في استدعاء الأداة المتوقف مؤقتًا. يتم ربط هذا تلقائيًا في `AssistantChat` — ولا يمكنك إنشاءه لكل قالب.

- **الموافقة** تعيد إصدار الدور (رسالة متابعة عادية) التي تحمل مفتاح المكالمة في `approvedToolCalls: [approvalKey]`. في المنعطف المُعاد إصداره، ترى البوابة المفتاح في المجموعة المعتمدة وتسمح بإجراء المكالمة المحددة بشكل طبيعي.
- **الرفض** يرفض القدرة على التحمل محليًا؛ لا يتم إعادة إصدار أي شيء، لذلك لا يتم تشغيل الإجراء أبدًا.

`approvedToolCalls` هو حقل في طلب الدردشة (`AgentChatRequest.approvedToolCalls`). تظل المفاتيح غير الموجودة فيه متوقفة مؤقتًا - فالموافقة على مكالمة واحدة لا توافق مطلقًا على المكالمات الأخرى بشكل صريح. نظرًا لأن المفتاح موجه للمحتوى، فإن الموافقة تسمح _بالاستدعاء بهذه الوسائط_؛ إذا اقترح النموذج لاحقًا إرسالًا مختلفًا، فهذا مفتاح جديد وموافقة جديدة.

## من النهاية إلى النهاية {#flow}

```an-diagram title="مقاطعة الموافقة" summary="تقوم المكالمة المسورة بإيقاف الدور مؤقتًا قبل تشغيل run(). الموافقة تعيد إصدار الدور الذي يحمل مفتاح الاتصال؛ عندها فقط يحدث التأثير الجانبي."
{
  "html": "<div class=\"diagram-approve\"><div class=\"diagram-box\" data-rough>الوكيل يستدعي send-email</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel warn\" data-rough><strong>البوابة صحيحة، والاستدعاء لم يوافق عليه بعد</strong><small class=\"diagram-muted\">loop emits tool_start + approval_required { tool, input, approvalKey }</small><span class=\"diagram-pill warn\">turn pauses &mdash; run() did NOT execute</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>ينقر الإنسان موافقة في الدردشة<br><small class=\"diagram-muted\">يعيد العميل إرسال الدور مع approvedToolCalls: [approvalKey]</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel ok\" data-rough><span class=\"diagram-pill ok\">Gate sees the key &rarr; run() executes &rarr; email sends</span></div></div>",
  "css": ".diagram-approve{display:flex;flex-direction:column;align-items:center;gap:8px}.diagram-approve .diagram-panel{display:flex;flex-direction:column;gap:6px;align-items:center;padding:12px 16px;text-align:center}.diagram-approve .diagram-arrow{font-size:22px;line-height:1}"
}
```

الاستخدام الأساسي (والنادر عمدًا) لهذه البوابة في إطار العمل هو إجراء `send-email` لقالب البريد، والذي يقوم بتعيين `needsApproval: true` بحيث يتمكن الوكيل من الصياغة والانتظار بحرية ولكن لا يمكنه أبدًا إرسال رسالة دون موافقة الإنسان على الإرسال المحدد.

## ذات صلة

- [**Actions**](/docs/actions#needs-approval) — سطح `defineAction` الكامل، بما في ذلك `outputSchema` للتحقق من صحة القيم المرجعة.
- [**Security**](/docs/security) — متى يتم الوصول إلى بوابة الموافقة مقابل إخفاء إجراء من النموذج.
- [**Mail template**](/docs/template-mail) — `send-email` هو المثال المرجعي.
