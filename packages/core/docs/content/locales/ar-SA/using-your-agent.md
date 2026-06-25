---
title: "استخدام الوكيل الخاص بك"
description: "الحلقة اليومية للعمل مع الوكيل: فهو يرى ما تنظر إليه، وتقوم بتوجيهه، وتضمينه، واستخدام واجهة خفيفة، والمشاركة في التحرير بجانبه."
---

# استخدام الوكيل الخاص بك

الفكرة المحددة وراء Agent-Native هي أن الوكيل وUI **شريكان متساويان** — راجع [What Is Agent-Native?](/docs/what-is-agent-native) لمعرفة السبب. يتناول هذا القسم النصف الآخر من هذا الوعد: ما تشعر به عند العمل فعليًا مع الوكيل بمجرد تثبيته بجوار تطبيقك.

هناك خط اتصال بسيط. يرى الوكيل ما تنظر إليه، وتوجهه نحو ما تريد، ويمكنك **تضمينه** في أي مكان، ويمكنك الانتقال بالكامل **واجهة خفيفة** عندما يكون ذلك مناسبًا بشكل أفضل، ويمكنك **المشاركة في تحرير** نفس المستندات في نفس الوقت. كل منها عبارة عن صفحة في هذا القسم.

```an-diagram title="الحلقة اليومية" summary="خمس طرق للعمل مع وكيل مُرسى — كل منها عبارة عن صفحة في هذا القسم."
{
  "html": "<div class=\"diagram-loop\"><div class=\"diagram-card\"><strong>Sees</strong><small class=\"diagram-muted\">your view &amp; selection</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><strong>Direct</strong><small class=\"diagram-muted\">@-mentions &amp; voice</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><strong>Embed</strong><small class=\"diagram-muted\">drop into any app</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><strong>واجهة خفيفة</strong><small class=\"diagram-muted\">chat is the product</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card accent-card\"><span class=\"diagram-pill accent\">تحرير مشترك</span><small class=\"diagram-muted\">مباشر، جنبا إلى جنب</small></div></div>",
  "css": ".diagram-loop{display:flex;align-items:stretch;gap:10px;flex-wrap:wrap}.diagram-loop .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;min-width:130px;flex:1}.diagram-loop .diagram-arrow{align-self:center;font-size:22px;line-height:1}"
}
```

## يرى ما تنظر إليه {#it-sees}

الوكيل ليس غافلًا عن شاشتك. افتح بريدًا إلكترونيًا ويعرف أي موضوع. حدد مخططًا ويعرف أي مخطط. قم بتمييز فقرة ويمكنها العمل على هذا النطاق فقط. وهذا الوعي المشترك هو ما يتيح لك قول "الرد على هذا" أو "تلخيص التحديد" دون توضيح السياق في كل مرة.

يعمل هذا لأن التنقل والتحديد الحالي موجودان في `application_state` SQL، والذي يقرأه الوكيل كجزء من سياقه. يمكن للوكيل أيضًا استعادة نفس الحالة - فتح عرض، وتحديد صف - بحيث تشاهده وهو يعمل في UI الحقيقي بدلاً من النص.

```an-callout
{
  "tone": "info",
  "body": "**Shared awareness is two-way.** You and the agent both read and write `application_state`, so \"reply to this\" or \"summarize the selection\" just works — and when the agent navigates, the real UI moves with it."
}
```

← [**Context Awareness**](/docs/context-awareness) — حالة التنقل، وشاشة العرض، وأوامر التنقل، وكيف يظل الوكيل متزامنًا مع شاشتك.

## أنت تقوم بتوجيهه {#you-direct-it}

في أغلب الأحيان، تقوم بتوجيه الوكيل عن طريق الكتابة في الدردشة. هناك شيئان يجعلان ذلك أسرع.

**الإشارات.** ضع علامة على وكيل مخصص، أو وكيل متصل، أو ملف باستخدام `@` لسحبه إلى المحادثة - "اسمح لـ `@analytics` بسحب أرقام الأسبوع الماضي، ثم قم بصياغة الملخص." الإشارات هي كيفية الوصول إلى المتخصص المناسب أو إرفاق السياق الصحيح دون مغادرة الملحن.

**الصوت.** الملحن لديه ميكروفون. قم بإملاء طلب بدلاً من كتابته، مع خيارات الموفر التي تتراوح بين النسخ المستضاف لـ Builder وإحضار مفتاحك الخاص إلى خيار احتياطي للمتصفح.

← [**Agent Mentions**](/docs/agent-mentions) — `@` - الوكلاء المخصصون والوكلاء المتصلون والملفات في الدردشة.
← [**Voice Input**](/docs/voice-input) — الإملاء في مؤلف الدردشة وكيفية توجيه النسخ.

## قمت بتضمينه {#you-embed-it}

الوكيل ليس تطبيقًا منفصلاً يمكنك الانتقال إليه. إنه يأتي كمجموعة من مكونات React - شريط جانبي، ولوحة أولية، ومكالمة `sendToAgentChat()` - التي تضعها في أي تطبيق. اعرض `<AgentSidebar>` لمنح كل شاشة وكيلًا قابلاً للتبديل، أو قم بتوصيل زر لتسليم مهمة معينة إلى الدردشة بدلاً من تشغيل مكالمة LLM لمرة واحدة.

← [**Drop-in Agent**](/docs/drop-in-agent) - قم بتثبيت `<AgentPanel>` و`<AgentSidebar>` و`sendToAgentChat()` في أي تطبيق React.
← [**Agent Surfaces**](/docs/agent-surfaces) - اختر ما إذا كان سير العمل يجب أن يكون بدون رأس، أو الدردشة أولاً، أو مضمنًا، أو تطبيقًا كاملاً.

## يمكنك استخدام واجهة خفيفة {#ui-light}

لا يحتاج كل تطبيق إلى لوحة تحكم كاملة. عندما يكون الوكيل هو المنتج، يمكنك تخطي معظم UI المخصصة: افتح التطبيق، واطلب ما تريد، واترك الوكيل يقوم بالباقي. لا يزال لدى الوكيل سطح الإدارة الخاص به - السجل ومساحة العمل والإعدادات - ولكن التفاعل الأساسي هو المحادثة وليس النقرات.

← [**Pure-Agent Apps**](/docs/pure-agent-apps) — التطبيقات التي يكون فيها الوكيل هو المنتج بالكامل.

## يمكنك المشاركة في التحرير معه {#you-co-edit}

عندما تعمل أنت والوكيل على نفس المستند، لا تتناوبان. من خلال التعاون في الوقت الفعلي، يتم بث تعديلات الوكيل جنبًا إلى جنب مع تعديلاتك - مؤشرات مباشرة، بدون استبدال - بنفس الطريقة التي يقوم بها زميل الفريق. يمكنك الاستمرار في الكتابة أثناء العمل، وسيرى التغييرات فور حدوثها.

← [**Real-Time Collaboration**](/docs/real-time-collaboration) — تحرير تعاوني متعدد المستخدمين باستخدام المؤشرات المباشرة وتحريرات الوكيل في نفس المستند.

## ما هي الخطوة التالية {#whats-next}

- [**Context Awareness**](/docs/context-awareness) — يعرف الوكيل ما تنظر إليه
- [**Agent Mentions**](/docs/agent-mentions) - قم بتوجيهه باستخدام إشارات `@`
- [**Voice Input**](/docs/voice-input) — قم بتوجيهه عن طريق التحدث
- [**Drop-in Agent**](/docs/drop-in-agent) - قم بتضمينه في أي تطبيق React
- [**Pure-Agent Apps**](/docs/pure-agent-apps) - انتقل إلى UI عندما يكون الوكيل هو المنتج
- [**Real-Time Collaboration**](/docs/real-time-collaboration) — تحرير نفس المستند معًا
