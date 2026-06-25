---
title: "تطبيقات MCP"
description: "قم بتأليف تطبيقات MCP التفاعلية UI وتضمينها داخل Claude وChatGPT والمضيفين المتوافقين الآخرين - باستخدام مسارات التطبيق الحقيقية وجسر التضمين وجسر المضيف API."
---

# تطبيقات MCP

**هذه الصفحة: UIs المضمّنة في Claude/ChatGPT.** تأليف موارد تطبيق MCP وجسر التضمين الذي يعرض مسار تطبيق حقيقي داخل دردشة مضيف متوافق. هذه الصفحة هي أيضًا الصفحة الرئيسية الوحيدة لـ **مصفوفة دعم العميل** ([below](#client-support)).

| إذا كنت تريد...                                                     | اقرأ                                     |
| ------------------------------------------------------------------- | ---------------------------------------- |
| قم بتوصيل وكيل/مضيف خارجي بتطبيقك                                   | [External Agents](/docs/external-agents) |
| امنح وكيلك المزيد من الأدوات (استخدم خوادم MCP الأخرى)              | [MCP Clients](/docs/mcp-clients)         |
| إنشاء UI المضمنة التي يتم عرضها في Claude/ChatGPT                   | **هذه الصفحة** — تطبيقات MCP             |
| مرجع خادم MCP ذو المستوى الأدنى (المصادقة، الأدوات، التثبيت المخصص) | [MCP Protocol](/docs/mcp-protocol)       |

تطبيقات MCP هي امتداد `io.modelcontextprotocol/ui` الرسمي الذي يتيح للمضيفين المتوافقين - Claude وClaude Desktop وChatGPT وVS Code GitHub Copilot وGoose وPostman وMCPJam وCursor - عرض UI التفاعلية في الدردشة. في التطبيقات الأصلية للوكيل، يكون كل تطبيق MCP **مسار React حقيقي**، وليس عنصر واجهة مستخدم عادي منفصل لـ HTML.

داخل الدردشة الخاصة بتطبيق Agent-Native، تفضل [native chat renderers](/docs/native-chat-ui) لعناصر واجهة المستخدم الخاصة بالطرف الأول مثل الجداول والمخططات والنتائج المكتوبة وتكاليف الموافقة. استخدم تطبيقات MCP للمضيف الخارجي/المضيف المضمن UI في Claude، وChatGPT، وCopilot، وCursor، والمضيفين المتوافقين الآخرين، مع الإجراء `link` باعتباره الإجراء الاحتياطي العالمي للارتباط العميق.

## التأليف: تطبيقات MCP الاختيارية UI {#mcp-apps}

بالنسبة للمضيفين الذين يدعمون ملحق MCP Apps، يمكن للإجراء أيضًا الإعلان عن مورد UI المضمّن باستخدام `mcpApp`. يعد هذا تحسينًا تدريجيًا للتدفقات حيث يجب على الوكيل الخارجي أن يقدم للمستخدم سطحًا تفاعليًا بدلاً من النص فقط - على سبيل المثال، مراجعة مسودة بريد إلكتروني، أو تعديل دعوة تقويم، أو الاختيار بين متغيرات لوحة المعلومات التي تم إنشاؤها.

استخدم تطبيق React الحقيقي مع `embedRoute()` أو `embedApp()` عندما يحتاج المستخدم إلى UI. النموذج العقلي بسيط: هدف `link` للإجراء هو أيضًا هدف تضمين تطبيق MCP. اكشف عن العملية كإجراء/أداة عادية، وقم بإرجاع رابط عميق مركّز باستخدام `link`، وأضف `mcpApp.resource = embedApp(...)` بحيث يقوم المضيفون القادرون بتحميل نفس المسار المضمن بدلاً من فتح علامة تبويب جديدة. عندما يجب إنشاء كليهما من نفس المسار، تفضل `embedRoute({ title, openLabel, path })`: فهو برنامج تضمين ملائم يقوم بإرجاع حقول `link` و`mcpApp` المطابقة من استدعاء واحد, بينما `embedApp(...)` هو المورد ذو المستوى الأدنى الذي تقوم بتعيينه إلى `mcpApp.resource` مباشرة.

وهذا يعني أن عمليات تضمين التطبيق الكامل يمكنها فعل أي شيء يمكن أن يفعله المسار بمجرد فتحه: مراجعة مسودة بريد إلكتروني أو تحريرها، أو إظهار بريد وارد/بحث تمت تصفيته، أو فتح حدث تقويم أو مسودة حدث، أو تحميل صفحة ملحق، أو فحص لوحة معلومات التحليلات الكاملة أو التحليل المحفوظ، أو متابعة المجموعة في محرر الشرائح، أو فتح مشروع/محرر تصميم. تفضل معلمات URL/الارتباط العميق وجسر حالة التنقل/التطبيق `/_agent-native/open` الحالي على اختراع بروتوكول الحالة الثانية لتطبيقات MCP.

في حالات نادرة، يكون الهدف الصحيح هو مسار تطبيق مركّز يعرض مكون React مشتركًا واحدًا بدلاً من غلاف التطبيق بالكامل. يعد مسار `/chart` الخاص بـ Analytics هو النموذج: فهو يأخذ حمولة `SqlPanel` مدمجة في URL ويعرض نفس مكون المخطط الذي تستخدمه لوحة المعلومات. لا يزال هذا تطبيقًا مضمنًا، وليس تطبيق HTML MCP عادي. قم بكشفه أو استدعائه من خلال إجراء عادي / `open_app({ path, embed: true })`، واحتفظ بحتمية URL, واترك `embedApp()` يعرض هذا المسار في السطر.

لا تكتب بخط اليد تطبيقات HTML MCP العادية لمرة واحدة للمنتج UI؛ إذا كان الإجراء يحتاج إلى سطح مخصص، فأضف أو أعد استخدام مسار/مكون حقيقي للتطبيق أولاً وقم بتضمين هذا المسار.

```an-diagram title="MCP تضمين التطبيق ذهابًا وإيابًا" summary="هدف الارتباط الخاص بالإجراء هو أيضًا هدف التضمين. يقوم المضيفون القادرون بتحميل نفس مسار التطبيق الموقع بشكل مضمّن؛ يعود الجميع إلى الرابط العميق."
{
  "html": "<div class=\"diagram-embed\"><div class=\"diagram-card\" data-rough><strong>Action</strong><small class=\"diagram-muted\">`link` target = MCP App embed target</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\" data-rough><strong>embedApp()</strong><span class=\"diagram-pill accent\">create_embed_session</span><small class=\"diagram-muted\">mints short-lived embed session</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\" data-rough><strong>/_agent-native/embed/start</strong><small class=\"diagram-muted\">يتبادل تذكرة SQL لمرة واحدة</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\" data-rough><strong>Signed app route</strong><span class=\"diagram-pill ok\">مسار React حقيقي</span><small class=\"diagram-muted\">short-lived browser session</small></div><div class=\"diagram-fallback\"><span class=\"diagram-pill warn\">لا يوجد دعم MCP Apps</span><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>&quot;Open in … &rarr;&quot; deep link</div></div></div>",
"css": ".diagram-embed{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-embed .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;min-width:140px}.diagram-embed .diagram-arrow{font-size:22px;line-height:1}.diagram-embed .diagram-fallback{display:flex;flex-direction:column;align-items:center;gap:6px;margin-inline-start:8px}"
}

```

```ts
import { embedApp } from "@agent-native/core";

export default defineAction({
  // ...description, schema, run, link...
  mcpApp: {
    resource: embedApp({
      title: "Review draft",
      description: "Open the generated draft in the real Mail compose UI.",
      iframeTitle: "Agent-Native Mail",
      openLabel: "Open in Mail",
    }),
  },
});
```

```an-annotated-code title="تكوين موارد mcpApp"
{
  "filename": "actions/review-draft.ts",
  "language": "ts",
  "code": "import { embedApp } from \"@agent-native/core\";\n\nexport default defineAction({\n  // ...description, schema, run, link...\n  mcpApp: {\n    resource: embedApp({\n      title: \"Review draft\",\n      description: \"Open the generated draft in the real Mail compose UI.\",\n      iframeTitle: \"Agent-Native Mail\",\n      openLabel: \"Open in Mail\",\n    }),\n  },\n});",
  "annotations": [
    { "lines": "6", "label": "التحسين التدريجي", "note": "يعلن `mcpApp.resource` عن UI مضمن للمضيفين الذين يدعمون ملحق MCP Apps. احتفظ بمنشئ الإجراء `link` أيضًا - CLI - فقط والمضيفون الأقدم يتجاهلون البيانات التعريفية UI وما زالوا بحاجة إلى الرابط العميق." },
    { "lines": "7", "label": "Embed = the link target", "note": "`embedApp()` uses the action's `link` as its launch target: it calls `create_embed_session`, exchanges a one-time SQL ticket at `/_agent-native/embed/start`, and navigates the MCP App frame to the same signed app route." },
    { "lines": "11", "label": "تسمية احتياطية عالمية", "note": "`openLabel` is the visible `\"Open in … →\"` text used as the deep-link escape hatch when a host does not render the inline iframe." }
  ]
}
```

يعلن خادم MCP عن الامتداد `io.modelcontextprotocol/ui`، ويضيف `_meta.ui.resourceUri` بالإضافة إلى `_meta["ui/resourceUri"]` إلى `tools/list`، ويصدر أيضًا بيانات تعريف توافق ChatGPT Apps SDK (`openai/outputTemplate`، عنصر واجهة المستخدم CSP/الوصف/إمكانية الوصول). يعرض HTML حتى `resources/list` و`resources/templates/list` و`resources/read` باستخدام MIME `text/html;profile=mcp-app`. يقوم وكيل stdio بإعادة توجيه معالجات الموارد هذه من التطبيق المباشر، لذلك يرى عملاء سطح المكتب وعملاء CLI نفس الموارد التي يشاهدها عملاء HTTP.

احتفظ بمنشئ `link` الحالي حتى عند إضافة `mcpApp`. عملاء CLI فقط والمضيفون الأقدم وأي مضيف لا يعرض تطبيقات MCP سوف يتجاهلون البيانات التعريفية UI وسيظلون بحاجة إلى رابط `"Open in … →"`. يستخدم `embedApp()` هذا الارتباط كهدف إطلاق، ويستدعي مساعد `create_embed_session` للتطبيق فقط، ويتبادل تذكرة SQL لمرة واحدة في `/_agent-native/embed/start`, ويتنقل إطار تطبيق MCP إلى المسار المستهدف من خلال جلسة متصفح قصيرة الأجل بالإضافة إلى احتياطي حامل لعمليات الجلب من نفس المصدر. `open_app({ app, path, embed: true })` عبارة عن فتحة هروب عامة للمسارات مثل لوحات المعلومات الكاملة، وصناديق البريد الوارد المفلترة، وطرق عرض مسودة التقويم، والتحليلات، وصفحات الإضافات، ويجب استخدامها بحرية عندما يكون التطبيق الكامل هو أوضح سطح للمراجعة/التحرير.

يتضمن `embedApp()` أصل طلب MCP في المورد CSP حتى يتمكن المُشغل من جلب مسار تطبيق الطرف الأول الموقع، عند طلبه صراحةً، وتأطيره. تضيف Dispatch الأصول الدقيقة للتطبيقات الممنوحة إلى مورد `open_app` الخاص بها بحيث يمكن لموصل Dispatch واحد تضمين البريد والتقويم والشرائح والباقي دون السماح بكل أصل HTTPS. قم بتمرير إطار إضافي أو نطاقات موارد فقط لتطبيق MCP المخصص الذي يقوم بالفعل بتضمين مشغل طرف ثالث أو تحميل أصول طرف ثالث.

داخل مسارات `embedApp()` هذه, يكون `sendToAgentChat()` مدركًا للتضمين. يتم ترحيل المطالبات المقدمة تلقائيًا إلى مضيف MCP كـ `ui/update-model-context` بالإضافة إلى `ui/message`، بحيث يمكن للزر الموجود في التطبيق المضمن متابعة محادثة Claude/ChatGPT عن قصد من حالة التطبيق المحددة. يتم إرسال السياق المخفي كسياق نموذجي؛ يبقى دور المستخدم المرئي مجرد مطالبة التطبيق، مما يتجنب موافقة المضيف المخيفة حول مسارات ملفات حالة التطبيق الداخلية. يظل `submit: false` سلوك التعبئة المسبقة/المراجعة المحلي.

## جسر تطبيقات MCP من الدرجة الأولى {#mcp-app-bridge}

تضمينات تطبيق MCP عبارة عن تضمينات للمسار، وليست منتجات صغيرة منفصلة. يبدأ `embedApp()` من هدف `link` للإجراء، وينشئ جلسة تضمين قصيرة الأجل، ويطلق مسار التطبيق الموقع. يمكن لمضيفي MCP Apps القياسيين التنقل في إطار تطبيق MCP نفسه عندما يتمكن المضيف من ترطيب المسار مباشرة.

```an-diagram title="مساران للجسر المضيف، وطريق واحد موقّع" summary="يقوم كلود بزرع المسار المائي ويستخدم ui/_bridge المباشر؛ يحصل ChatGPT على إطار iframe يتم التحكم فيه عبر window.openai ويقوم بترحيل إجراءات المضيف عبر postMessage. كلاهما يشيران إلى نفس مسار التطبيق الموقع."
{
  "html": "<div class=\"diagram-bridge\"><div class=\"diagram-col\"><div class=\"diagram-card\" data-rough><strong>Claude web</strong><span class=\"diagram-pill accent\">single-frame transplant</span><small class=\"diagram-muted\">يروي HTML التطبيق الموقع داخل iframe في Claude، ثم جسر مضيف `ui/_` مباشر</small></div><div class=\"diagram-card\" data-rough><strong>ChatGPT web</strong><span class=\"diagram-pill accent\">controlled route iframe</span><small class=\"diagram-muted\">`window.openai`host APIs ·`agentNative.mcpHost.*` postMessage relay</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Same signed app route<br><small class=\"diagram-muted\">مسار عادي + مكونات React</small></div></div>",
"css": ".diagram-bridge{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-bridge .diagram-col{display:flex;flex-direction:column;gap:12px}.diagram-bridge .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;max-width:300px}.diagram-bridge .diagram-arrow{font-size:22px;line-height:1}.diagram-bridge .diagram-box{padding:16px 18px;text-align:center}"
}

```

يستخدم الويب Claude مسار زرع إطار واحد: يجلب مستند المورد التطبيق الموقع HTML ويرطبه داخل إطار iframe لتطبيق MCP الخاص بـ Claude لأن Claude لا يسمح بشكل موثوق بإطارات iframe الفرعية المملوكة للتطبيق أو التنقل في الإطارات الخارجية. تحصل شبكة ChatGPT على مسار iframe يمكن التحكم فيه لأن جسر Apps الخاص بها يمنحنا مضيف `window.openai` المستقر API والتحكم في الارتفاع المحدود. تشير جميع المسارات إلى نفس مسار التطبيق الموقع وتعرض المسار العادي ومكونات React. صمم المسارات المضمنة بحيث تؤدي إعادة التحميل باستخدام نفس URL الموقعة إلى إعادة بناء نفس العرض.

بالنسبة إلى `open_app({ embed: true })` لنفس التطبيق، يقوم إطار العمل بإصدار تذكرة بدء التضمين أثناء استدعاء الأداة الأصلية ويخزن البداية الموقعة URL في بيانات تعريف الأداة المخفية. يمكن لـ actions المخصص إرجاع `embedStartUrl` لنفس المسار السريع؛ تقوم طبقة MCP بإزالة URL الحاملة للتذكرة من `structuredContent` المرئية بالنموذج والبيانات الوصفية العادية للارتباط المفتوح. في حالة عدم وجود بداية تضمين URL، يعود المورد إلى مساعد `create_embed_session` الخاص بالتطبيق فقط. يؤدي هذا إلى إبقاء مضيفي الإنتاج الذين يقيدون استدعاءات الأداة التي يبدأها iframe على المسار المباشر دون تسريب جلسة التطبيق لمرة واحدة URLs في النص. إذا قام المستخدم بإعادة فتح محادثة قديمة بعد انتهاء صلاحية تذكرة البدء لمرة واحدة, فسيقوم مسار البداية بإرجاع صفحة تحديث صغيرة ونشر `agentNative.embedSessionExpired` في الغلاف؛ يقوم `embedApp()` بمسح البداية القديمة URL ويصدر تذكرة جديدة عبر `create_embed_session` عندما لا يزال لديه مسار التطبيق الأصلي.

يحصل ChatGPT على مسار توافق مخصص من خلال `window.openai`: يقرأ مستند الإطلاق `toolInput` و`toolOutput` و`toolResponseMetadata` مباشرة، ثم يستدعي `create_embed_session` عبر `window.openai.callTool(...)`. يستخدم مضيفو MCP Apps القياسيون الجسر `ui/*` JSON-RPC. يمكن للمسارات الرطبة مباشرة استدعاء `ui/update-model-context`، و`ui/message`، و`ui/open-link`، و`ui/request-display-mode` من خلال مساعدي الجسر المضيف. يستخدم المسار المزروع لـ Claude نفس الجسر المضيف المباشر `ui/*` بعد الترطيب. عند استخدام ChatGPT أو مسار iframe التشخيصي الصريح، يقوم المجمّع بترحيل نفس المضيف actions عبر طلبات `agentNative.mcpHost.*` postMessage. حافظ على شكل النتيجة متطابقًا لكلا المسارين: قم بإرجاع `link` مركّز ومحتوى منظم موجز.

لا تقم بتعيين `_meta.ui.domain` القياسي لتطبيق URL. تتعامل تطبيقات MCP مع هذا الحقل باعتباره خاصًا بالمضيف: يتحقق Claude من صحة نطاقات وضع الحماية بنمط `{hash}.claudemcpcontent.com`، بينما يستخدم ChatGPT بيانات تعريف `openai/widgetDomain` الخاصة به. احذف `ui.domain` إلا إذا كنت تقوم عمدًا بإصدار قيمة خاصة بالمضيف؛ سيختار المضيف أصل وضع الحماية الافتراضي.

تحتفظ صفحات الامتدادات بوضع الحماية الخاص بها في تضمينات الدردشة MCP دون التنقل في إطار iframe للمسار الثاني. يؤدي الاستخدام العادي للتطبيق إلى عرض `/_agent-native/extensions/:id/render` كإطار iframe فرعي في وضع الحماية. في وضع جسر الدردشة MCP، يعرض إطار العمل نفس مستند الامتداد مثل وضع الحماية `srcDoc` داخل مسار iframe، مع تجنب فشل المضيف `frame-ancestors` / `X-Frame-Options` مع الحفاظ على `sandbox="allow-scripts allow-forms"`.

تمتلك قذيفة المورد حجم المضيف الخارجي. يتم تعيين `embedApp({ height })` افتراضيًا على `560px`، ويربط الصدفة بـ `320-900px`، ويحتفظ بـ `44px` لشريط الأدوات الصغير، وبالتالي فإن منفذ عرض المسار هو `height - 44px`. احتفظ بمسارات التطبيق المضمنة قابلة للتمرير داخليًا واسمح للمشغل بالإبلاغ عن الارتفاع الجوهري المحدد بدلاً من ارتفاع المستند بالكامل؛ وإلا فإن تغيير الحجم التلقائي للمضيف يمكن أن يحول صفحة التطبيق العادية إلى قطعة أثرية طويلة جدًا للدردشة. يؤثر الغلاف المتغير فقط على موارد تطبيق MCP الجديدة واستدعاءات الأدوات الجديدة. يمكن أن تحتفظ إطارات المحادثة ChatGPT/Claude القديمة بسلوك المورد السابق، لذا تحقق من الحجم باستخدام عرض مضمن جديد قبل الحكم على الإصلاح.

### أوضاع التضمين {#embed-modes}

يستخدم Claude مسار زرع الإطار الفردي بشكل افتراضي. يمكنك أيضًا فرضه على المضيفين الآخرين باستخدام `embedMode: "transplant"` أو `frame: "transplant"` عند تصحيح سلوك تحميل الوحدة النمطية للمضيف. يمكنك فرض إطار iframe التشخيصي المتداخل باستخدام `embedMode: "iframe"` أو `renderMode: "iframe"` أو `nested: true` أو `frame: "iframe"`. إذا تم حظر إطار iframe، فإن `embedApp()` يستبدله بخيار احتياطي للتطبيق المفتوح: يمكن للمستخدم إعادة المحاولة مضمنًا، أو فتح جلسة تضمين حديثة من خلال المضيف، أو استخدام المسار المرئي URL. اجعل هدف الإجراء `link` مفيدًا في حد ذاته لأنه لا يزال بمثابة فتحة الهروب العالمية.

عند اختبار Claude من خلال ngrok، استخدم إصدار الإنتاج (`npx @agent-native/core@latest build` ثم `npx @agent-native/core@latest start`) أو معاينة/إنتاج منشور URL. يعمل مسار الزرع أحادي الإطار Claude مع قطع أصول الإنتاج؛ يمكن حماية وحدات تطوير Vite الخام مثل `/app/root.tsx` من خلال مصادقة التطبيق وفشل عمليات الاستيراد الديناميكية من أصل مورد Claude.

## الجسر المضيف API {#host-bridge}

الجسر المضيف صغير عن عمد:

| الوضع                 | نوع الرسالة                           | استخدمه من أجل                                 |
| --------------------- | ------------------------------------- | ---------------------------------------------- |
| مسار المضيف المباشر   | `ui/update-model-context`             | السياق المخفي للنموذج المضيف                   |
| مسار المضيف المباشر   | `ui/message`                          | انشر تحول مستخدم مرئي إلى المضيف               |
| مسار المضيف المباشر   | `ui/open-link`                        | افتح تطبيقًا خارجيًا أو URL عبر المضيف         |
| مسار المضيف المباشر   | `ui/request-display-mode`             | اطلب `inline` أو `fullscreen` أو `pip`         |
| زرع Claude            | `ui/*`                                | نفس الجسر المضيف المباشر بعد الترطيب           |
| مسار ChatGPT / iframe | `agentNative.mcpHostContext`          | الموضوع، اللغة، النظام الأساسي المضيف، الأبعاد |
| مسار ChatGPT / iframe | `agentNative.embeddedAppReady`        | تأكد من تحميل مسار iframe                      |
| مسار ChatGPT / iframe | `agentNative.mcpHost.*` / `.response` | ترحيل المجمع لطلبات المضيف                     |

يمكن للمسارات المضمنة استخدام `updateMcpAppModelContext()` و`openMcpAppHostLink()` و`requestMcpAppDisplayMode()` و`getMcpAppHostContext()` و`useMcpAppHostContext()` من `@agent-native/core/client`. يستخدم `sendToAgentChat()` نفس المسار من عمليات تضمين التطبيق الكامل للمطالبات المقدمة تلقائيًا.

وضع العرض هو أفضل جهد. يُبلغ `McpAppRenderer` داخل التطبيق حاليًا عن سياق مضيف ويب مضمن ووضع عرض مضمن فقط؛ قد تستجيب المضيفات الخارجية لطلبات العرض الأكبر حجمًا، أو تتجاهلها، أو ترد بخطأ في الوضع غير المدعوم. اجعل المسار المضمن قابلاً للاستخدام دائمًا.

## دعم العملاء والتخزين المؤقت {#client-support}

تتضمن قائمة عملاء MCP Apps الرسمية الحالية Claude وClaude Desktop وVS Code GitHub Copilot وGoose وPostman وMCPJam وChatGPT وCursor؛ لا يزال دعم المضيف يختلف حسب الخطة وقناة الإصدار وإصدار العميل، لذا تحقق من [MCP extension support matrix](https://modelcontextprotocol.io/extensions/client-matrix). تتوفر تطبيقات ChatGPT المخصصة MCP من خلال وضع المطور لمساحات عمل Business وEnterprise/Edu على الويب ChatGPT؛ راجع ملاحظات OpenAI على [developer mode and MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-apps-in-chatgpt-beta).

لا يزال Claude Code وCodex وعملاء CLI/محرر التعليمات البرمجية الآخرين يتلقون نفس الموارد وبيانات التعريف عندما يدعمون تطبيقات MCP، ولكن يتم معاملتهم كمضيفين للارتباط الخارجي إلا إذا قمت بالتحقق من عرض iframe المضمن في هذا السطح المحدد. يظل الرابط العميق هو الحل الاحتياطي الموثوق به عندما يختار المضيف عدم عرض إطار iframe. من الناحية العملية، يجب تأليف كل تطبيق أصلي للوكيل باستخدام كليهما: تطبيقات MCP للمراجعة/التحرير المضمن في الأجهزة المضيفة القادرة، و`link` للعودة الشاملة إلى التطبيق الكامل.

يمكن لـ Claude وChatGPT تخزين البيانات التعريفية للأداة والموارد لموصل مخصص موجود. بعد تغيير البيانات التعريفية لتطبيق MCP، تحقق من خلال استدعاء أداة جديدة؛ إذا كان المضيف لا يزال يستخدم الواصف القديم، فأعد توصيل موصل Claude أو أعد فحص/مراجعة موصل ChatGPT حتى يتم تحديث الكتالوج. إذا سجل Claude تحذيرًا بشأن `_meta.ui.csp` أو `_meta.ui.permissions` الموجود في واصف الأداة بعد النشر، فإن هذا الموصل يستخدم بيانات تعريف قديمة: احذف/أعد توصيل موصل Claude وابدأ محادثة جديدة.

## الاختبار {#testing}

اختبر تطبيقات MCP باستخدام التركيبات خفيفة الوزن حول `embedApp()` و`McpAppRenderer`؛ فهي تغطي CSP وسياق المضيف وتشغيل التطبيق وسلوك الرسائل الجسرية دون الحاجة إلى مضيف خارجي حقيقي. عند التحقق من صحة الويب ChatGPT أو Claude، قم بتشغيل استدعاء أداة جديد بعد تغيير الصدفة وقياس إطار iframe المرئي. قد تستمر الإطارات التي تم عرضها مسبقًا في نفس المحادثة في إظهار الارتفاع المخزن مؤقتًا أو سلوك التشغيل.

## ذات صلة {#related}

- [External Agents](/docs/external-agents) — توصيل Claude وChatGPT وCodex وCursor بالتطبيقات المستضافة؛ مصفوفة توافق التطبيقات MCP؛ طبقات الكتالوج؛ روابط عميقة.
- [MCP Protocol](/docs/mcp-protocol) — خادم MCP المثبت تلقائيًا والمصادقة والأدوات و`ask-agent`.
- [Actions](/docs/actions) — `defineAction`، منشئ `link`، `publicAgent`.

```

```
