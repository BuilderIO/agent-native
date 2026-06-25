---
title: "الإطارات"
description: "إطار التطوير المحلي، ولوحة الوكيل المضمنة، والإطار السحابي - الطرق التي يعمل بها وكيل الذكاء الاصطناعي جنبًا إلى جنب مع تطبيقك."
---

# الإطارات

يتم تشغيل كل تطبيق أصلي للوكيل مع وكيل AI بجوار التطبيق UI. **الإطار** هو
المجمّع الذي يستضيف كليهما: فهو يعرض تطبيقك ويمنح الوكيل مكانًا
الدردشة والتشغيل وتحرير التعليمات البرمجية (في التطوير). هناك ثلاثة إطارات، تتشارك في وقت تشغيل واحد:

- **لوحة الوكيل المضمنة** — يتم تضمينها داخل كل تطبيق من `@agent-native/core`.
  هذا هو الشريط الجانبي الذي يعرضه تطبيقك بنفسه، أثناء التطوير والإنتاج.
- **إطار التطوير المحلي** — غلاف رفيع يقوم بتحميل تطبيقك قيد التشغيل في إطار iframe
  ويضيف نفس لوحة الوكيل بالإضافة إلى محطة CLI المدمجة بجانبها. مستخدم
  للتطوير المحلي للقوالب في هذا الريبو.
- **إطار سحابي Builder.io** — إطار مُدار ومستضاف بالتعاون،
  التحرير المرئي وتشغيل الوكيل الموازي.

رمز تطبيقك متطابق بغض النظر عن الإطار الذي يستضيفه. يتحدث الوكيل
إلى تطبيقك من خلال نفس actions وحالة التطبيق في كل حالة.

```an-diagram title="ثلاثة إطارات، وقت تشغيل واحد" summary="تطبيقك ولوحة الوكيل متماثلان في كل إطار؛ فقط الغلاف المحيط بهم يتغير."
{
  "html": "<div class=\"diagram-frames\"><div class=\"diagram-card\" data-rough><span class=\"diagram-pill accent\">لوحة مضمنة</span><small class=\"diagram-muted\">يأتي مع كل تطبيق · تطوير + إنتاج</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">إطار تطوير محلي</span><small class=\"diagram-muted\">تطبيق داخل iframe + لوحة + طرفية CLI</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">إطار سحابي Builder.io</span><small class=\"diagram-muted\">مستضاف: تعاون · تحرير مرئي · تشغيلات متوازية</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>نفس وقت التشغيل<br><small class=\"diagram-muted\">تطبيقك · الإجراءات · حالة التطبيق</small></div></div>",
  "css": ".diagram-frames{display:flex;flex-direction:column;gap:10px;align-items:stretch}.diagram-frames .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px}.diagram-frames .diagram-arrow{font-size:22px;line-height:1;align-self:center}"
}
```

## لوحة الوكيل المضمنة {#embedded-agent}

اللوحة المضمنة هي الشريط الجانبي للوكيل الذي يعرضه تطبيقك. يأتي مع
`@agent-native/core` - لا توجد حزمة منفصلة لتثبيتها - وهي نفسها
مكون في التطوير والإنتاج.

- تم التصدير بتنسيق `AgentPanel` من `@agent-native/core/client`، مع
  متغير الإنتاج فقط `ProductionAgentPanel`.
- يوفر سطح الدردشة / CLI / مساحة العمل الكامل، بحيث يظل إدخال الوكيل قيد التشغيل
  مكدس الملحن المشترك المستخدم في أي مكان آخر في إطار العمل.
- يقرأ `application_state.navigation` في كل دورة، لذا فهو يعرف بالفعل أي منها
  العرض الذي تتواجد فيه والأشياء المحددة - لا يتعين عليك إعادة شرح "هذا".

### أوضاع أداة التطبيق مقابل الكود {#tool-modes}

تعمل اللوحة في أحد وضعي الأداة:

- **وضع التطبيق** — يمتلك الوكيل فقط الأدوات الخاصة بتطبيقك: actions أنت
  محدد باستخدام `defineAction`، بالإضافة إلى التنقل والسياق. لا يوجد نظام ملفات أو
  الوصول إلى الصدفة. وهذا ما يحصل عليه المستخدمون النهائيون.
- **وضع الكود** — يضيف أدوات الترميز المشتركة (`bash`، `read`، `edit`، `write`)
  والوصول إلى قاعدة البيانات أعلى أدوات التطبيق، حتى يتمكن الوكيل من تغيير التطبيق
  المصدر الخاص. تكون طلبات التعليمات البرمجية محظورة: عندما تتطلب الرسالة رمزًا
  (`type: "code"`) ولم يتم توصيل أي إطار قادر على تشغيل التعليمات البرمجية، تعرض اللوحة
  مربع حوار يوضح أن تغييرات التعليمات البرمجية تحتاج إلى Agent Native Desktop أو Builder؛
  عندما يكون الإطار متصلاً، يتم توجيه الطلب إليه وإلى وكيل التعليمات البرمجية
  يظهر المؤشر أثناء عمله (`useSendToAgentChat`). بالنسبة للملف الأساسي
  قائمة أدوات الترميز وعقود UI المشتركة، راجع
  [Agent-Native Code UI](/docs/code-agents-ui).

```an-diagram title="بوابة طلب الكود" summary="تحتاج الرسالة المكتوبة بالرمز إلى إطار قادر على البرمجة. مع اتصال واحد، يتم توجيه الطلب إلى هناك؛ بدون واحد، تشرح اللوحة أن تغييرات التعليمات البرمجية تحتاج إلى Desktop أو Builder."
{
  "html": "<div class=\"diagram-gate\"><div class=\"diagram-node\" data-rough>message<br><small class=\"diagram-muted\">type: \\\"code\\\"</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough>code-capable frame connected?</div><div class=\"diagram-col\"><div class=\"diagram-pill ok\">yes &rarr; route to frame, show code-agent indicator</div><div class=\"diagram-pill warn\">no &rarr; dialog: needs Desktop or Builder</div></div></div>",
  "css": ".diagram-gate{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-gate .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-gate .diagram-arrow{font-size:22px;line-height:1}.diagram-gate .center{text-align:center}"
}
```

"وضع التعليمات البرمجية" هو تبديل قدرة الوكيل - وهو يختلف عن وضع مطور البيئة
(`NODE_ENV` / Vite). ربط العميل هو `useCodeMode()`. (انظر
[Compatibility notes](#compatibility) للأسماء المستعارة المتوافقة مع الخلف.)

في إطار التطوير المحلي، يقوم ترس الإعدادات بالتبديل بين هذه الأوضاع. التبديل
يُخفي وضع Code off الشريط الجانبي الخاص بالإطار ويعرض وكيل التطبيق داخل التطبيق
الشريط الجانبي داخل إطار iframe بدلاً من ذلك، حتى تتمكن من معاينة ما يراه المستخدمون بالضبط.

## محطة متكاملة وتبديل CLI {#cli-terminal}

تتضمن اللوحة قيد التطوير محطة طرفية مضمنة (`AgentTerminal`، أيضًا
من `@agent-native/core/client`) مدعومًا بخادم PTY. يمكنك تشغيل
ترميز CLI بجوار التطبيق مباشرةً والتبديل بينهما؛ تتم إعادة تشغيل الجهاز
باستخدام CLI المحدد.

تأتي CLI المدعومة من سجل CLI الأساسي
(`packages/core/src/terminal/cli-registry.ts`). يُسمح فقط بهذه الأوامر
للنشر - يتحقق خادم PTY من صحة الأمر المطلوب مقابل السجل
القائمة المسموح بها لمنع الحقن:

| CLI           | الأمر      | تثبيت الحزمة                |
| ------------- | ---------- | --------------------------- |
| رمز Claude    | `claude`   | `@anthropic-ai/claude-code` |
| Builder.io    | `builder`  | (مدمج)                      |
| Codex         | `codex`    | `@openai/codex`             |
| الجوزاء CLI   | `gemini`   | `@google/gemini-cli`        |
| الرمز المفتوح | `opencode` | `opencode-ai`               |

إذا لم يتم العثور على CLI المحدد في `PATH`، فستعود الوحدة الطرفية إلى تشغيلها
من خلال `npx --yes <install-package>@latest` (حيث توجد حزمة التثبيت). ال
الأمر الافتراضي هو `claude`. قم بتبديل CLIs من إعدادات لوحة الوكيل في أي
الوقت.

## إطار سحابي Builder.io {#cloud-frame}

يوفر [Builder.io](https://www.builder.io) إطارًا مُدارًا يستضيف
نفس التطبيق ونفس لوحة الوكيل، في السحابة:

- التعاون في الوقت الفعلي — يمكن لعدة مستخدمين المشاهدة والتفاعل في الوقت نفسه.
- التحرير المرئي والأدوار والأذونات.
- تنفيذ الوكيل الموازي لتكرار أسرع.
- مناسب للاستخدام الجماعي، حيث يتشارك الجميع في بيئة مستضافة واحدة.

طلبات التعليمات البرمجية من مسار اللوحة المضمنة إلى إطار Builder بنفس الطريقة
إنهم يوجهون إلى إطار التطوير المحلي، لذا فإن سلوك dev-vs-prod أعلاه هو
متسق في كليهما.

## وقت التشغيل APIs {#runtime-apis}

تأتي هذه العناصر مع `@agent-native/core` وهي ما يستخدمه تطبيقك للتحدث مع
الوكيل، بغض النظر عن الإطار الذي يستضيفه:

1. **إرسال رسالة** — يرسل `sendToAgentChat()` رسالة إلى الوكيل. ال
   يغلفه خطاف `useSendToAgentChat()` ببوابة طلب الكود الموصوفة
   أعلاه ويعيد عنصر `codeRequiredDialog` لعرضه. انظر
   [Drop-in Agent](/docs/drop-in-agent) للاستخدام الكامل والخيارات.
2. **حالة الجيل** — يتتبع `useAgentChatGenerating()` وقت وجود الوكيل
   قيد التشغيل، لذا يمكن لـ UI إظهار التقدم دون استقصاء الوكيل مباشرةً.
3. **مزامنة الاستقصاء** — تحافظ المزامنة المدعومة بقاعدة البيانات على ذاكرات التخزين المؤقت UI محدثة عندما يكون الوكيل
   يغير البيانات أو حالة التطبيق.
4. **نظام العمل** — يرسل `pnpm action <name>` إلى نفس الشخص القابل للاستدعاء
   actions يستدعي الوكيل كأدوات، لذا يمكنك القيام بأي شيء يمكن للوكيل القيام به
   النص البرمجي.

## تشغيله {#running}

تعد لوحة الوكيل المضمنة جزءًا من كل تطبيق - قم ببناء قالب وهي
هناك بالفعل:

```bash
npx @agent-native/core@latest create my-app --template mail --standalone
cd my-app
pnpm dev
```

إطار التطوير المحلي (حزمة `@agent-native/frame` الخاصة في مستودع الإطار) عبارة عن حزمة أدوات داخلية لم يتم نشرها على npm. يقوم بتحميل خادم تطوير التطبيق النشط في إطار iframe وتثبيت اللوحة المضمنة بجانبه، وتحديد التطبيق عبر معلمة الاستعلام `app`. تتطلب محطة CLI المتكاملة سطح المكتب Agent Native، الذي يوفر الكود المحلي والوصول إلى PTY لاحتياجات المحطة؛ وبدون ذلك، تعرض اللوحة سطح الدردشة وتطلب منك فتح سطح المكتب لاستخدام CLI.

## ملاحظات التوافق {#compatibility}

كان مفهوم "وضع التعليمات البرمجية" يُسمى سابقًا "وضع التطوير"، لذا فإن القليل منه متوافق مع الإصدارات السابقة
تستمر الأسماء. يمكنك تجاهل هذه الأمور إلا إذا كنت تحافظ على التكامل الأقدم
الكود:

- متغير البيئة `AGENT_MODE` الأساسي، `/_agent-native/agent-chat/mode`
  نقطة النهاية (التي لا يزال مفتاح الحمولة الخاص بها هو `devMode`)، و`agent-chat.mode`
  مفتاح الإعدادات لم يتغير.
- يظل `useDevMode()` كاسم مستعار مهمل لـ `useCodeMode()`.
