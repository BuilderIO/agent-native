---
title: "المقاطع"
description: "تسجيل الشاشة غير المتزامن، وملاحظات الاجتماع المتزامنة مع التقويم، والإملاء الصوتي بالضغط والتحدث - الصق روابط Clips في الوكلاء ويمكنهم قراءة النصوص والمرئيات والملخصات."
search: "سجلات متصفح Clips، سجلات المطورين، سجلات وحدة التحكم، سجلات الشبكة، جلب XHR تطبيق سطح المكتب المسجل لتشخيصات ملحق Chrome"
---

# المقاطع

تطبيق يلتقط كل شيء: تسجيلات الشاشة، وملاحظات الاجتماع من التقويم الخاص بك، والإملاء الصوتي مع الاستمرار على Fn. يقوم الوكيل بنسخ كل ذلك، وعناوينه، وتلخيصه، وفهرسته - ثم يتيح لك أن تطلب "العثور على المقطع الذي ناقشنا فيه خطة الطرح" والبحث عبر كل نص قمت بإنشائه على الإطلاق.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>مقاطع هندسية</h1><span class='wf-pill accent'>مكتبة</span><span class='wf-pill'>الاجتماعات</span><span class='wf-pill'>الإملاء</span><div style='flex:1'></div><button>يستورد</button><button class='primary'>سِجِلّ</button></div><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:12px'><div class='wf-card' style='height:120px;display:flex;flex-direction:column;justify-content:end'><strong>مراجعة OKR</strong><small>35 min</small></div><div class='wf-card' style='height:120px;display:flex;flex-direction:column;justify-content:end'><strong>مسار الإعداد</strong><small>12 min</small></div><div class='wf-card' style='height:120px;display:flex;flex-direction:column;justify-content:end'><strong>إعادة إنتاج الخطأ</strong><small>4 min</small></div></div><div class='wf-card' style='display:flex;gap:10px;align-items:center'><span class='wf-pill accent'>وكيل قابل للقراءة</span><span>النص والإطارات جاهزة لروابط المشاركة</span><div style='flex:1'></div><button>يشارك</button></div><div class='wf-card' style='flex:1;display:flex;flex-direction:column;gap:8px'><strong>بحث النص</strong><div class='wf-box'>الفصل المطابق 03:12 · مخاطر الطرح وتسليم المالك</div><div class='wf-box'>ملخص الاجتماع وبنود العمل</div></div></div>"
}
```

فكر على غرار Loom + Granola + Wispr Flow المدمجة في تطبيق واحد - ولكن الوكيل هو محرر من الدرجة الأولى عبر كل سطح، والتسجيلات والاجتماعات والإملاءات ملكك، وليس بائع SaaS. تجعل Clips أيضًا التسجيلات المشتركة قابلة للقراءة من قبل الوكيل: قم بلصق رابط مشاركة Clips عادي في الوكيل ويمكنه "سماع" النص كنص و"رؤية" إطارات الشاشة ذات الطوابع الزمنية كصور - لا حاجة إلى فيديو أولي. تعمل ميزة عرض الإطار في أي وكيل قادر على التقاط الصور (ChatGPT، Claude Code، Cursor، Codex)؛ لا تزال محادثات الويب النصية فقط تحصل على النص الكامل ويمكن أن تأخذ إطارًا تقوم بتحميله.

```an-diagram title="التقاط ونسخ وإعادة الاستخدام" summary="توجد ثلاثة أنواع من الالتقاط في مكتبة واحدة؛ يقوم الوكيل بنسخ النص، والعناوين، والتلخيص، ثم يصبح كل نص قابلاً للبحث والمشاركة."
{
  "html": "<div class=\"diagram-clips\"><div class=\"diagram-col\"><div class=\"diagram-node\">تسجيل الشاشة</div><div class=\"diagram-node\">اجتماع التقويم</div><div class=\"diagram-node\">Fn مع الاستمرار في الإملاء</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>مكتبة واحدة<br><small class=\"diagram-muted\">التسجيلات + النصوص (SQL)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">العنوان · الملخص · الفصول</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">يبحث</div><div class=\"diagram-pill\">يشارك</div><div class=\"diagram-pill\">روابط قابلة للقراءة من قبل الوكيل</div></div></div>",
  "css": ".diagram-clips{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-clips .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-clips .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-clips .diagram-arrow{font-size:22px;line-height:1}"
}
```

## ما يمكنك فعله به

- **سجل شاشتك** باستخدام مسجل مدمج وتراكب كاميرا الويب والتقاط الصوت والإيقاف المؤقت/الاقتطاع.
- **التقط الاجتماعات من التقويم الخاص بك.** قم بتوصيل Google Calendar، وشاهد الاجتماعات القادمة في الشريط الجانبي، ثم اضغط على تسجيل أي اجتماع. ستحصل على نص مباشر بالإضافة إلى ملخص AI وملاحظات نقطية وعناصر عمل بمجرد انتهاء النص.
- **إملاء الضغط والتحدث.** اضغط باستمرار على Fn على جهازك، وتحدث، وسيسقط النص المنظف في أي تطبيق تستخدمه. يتم الاحتفاظ بكل إملاء في سجل قابل للبحث مع النسخ الأصلية والإصدارات التي تم تنظيفها بواسطة الذكاء الاصطناعي جنبًا إلى جنب.
- **احصل على عنوان وملخص وعلامات فصول يتم إنشاؤها تلقائيًا** لكل تسجيل — يقوم الوكيل بملئها وتحديثها باستمرار.
- **البحث عبر كل نص** — تسجيلات الشاشة والاجتماعات والإملاءات، كل ذلك في مكتبة واحدة. "ابحث عن المقطع الذي ناقشنا فيه خطة الطرح."
- **مشاركة المقاطع** مع أذونات لكل مقطع (عام، جماعي، خاص). يعمل تتبع الروابط والتعليقات المترابطة أيضًا.
- **معاينة المقاطع العامة في Slack** مع إمكانية اللعب بنمط Loom بعد
  تقوم مساحة العمل بتثبيت تطبيق Clips Slack.
- **التقاط سجلات المتصفح باستخدام ملحق Chrome.** يمكن تسجيلات المتصفح
  أرفق سجلات وحدة التحكم المنقحة واجلب البيانات الوصفية/XHR، وهو أمر مفيد
  أخطاء المنتج والتصحيحات الخاصة بالمتصفح فقط.
- **الصق روابط Clips في الوكلاء** حتى يتمكنوا من اكتشاف السياق الذي يمكن قراءته من قبل الوكيل: البيانات الوصفية، وأجزاء النص، والإطارات الموصى بها، وصور الإطارات ذات الطابع الزمني دون تلقي ملف الفيديو الأولي.
- **عروض المكتبة الذكية.** التجميع حسب المشروع، والتصفية حسب المتحدث، ووضع العلامات التلقائية بناءً على المحتوى.
- **تحرير النص من خلال الدردشة.** "أصلح الكلمة التي تم كتابتها بشكل خاطئ في الدقيقة 1:42." "اسحب ثلاثة اقتباسات لمنشور مدونة." يقوم الوكيل بتحرير النص ويتم تحديث UI مباشرة.

## سجلات المتصفح وتشخيصات المطورين

استخدم ملحق Clips Chrome عندما تحتاج إلى تسجيل بالإضافة إلى سجلات المتصفح من
علامة التبويب التي تقوم بتصحيح أخطائها. يبدأ الملحق تسجيل علامة التبويب النشطة ويمكنه
حفظ سجلات وحدة التحكم المنقحة، واستثناءات JavaScript، وشبكة الجلب/XHR
بيانات التعريف مثل الطريقة وURL المنقحة والحالة والمدة ونص الفشل. إنه
لا يحفظ نصوص الطلب أو نصوص الاستجابة أو الرؤوس.

يمكن لصفحة مسجل المتصفح العادية حفظ التشخيصات من صفحة المسجل
نفسها. امتداد Chrome هو المسار لسجلات مطوري علامات التبويب النشطة و
النسخ للمتصفح فقط. في Clips UI، استخدم خيار Chrome لسجلات المتصفح و
تطبيق سطح المكتب لمسار الالتقاط اليومي الأكثر سلاسة.

قائمة ملحق Agent-Native Clips Chrome هي
`https://chromewebstore.google.com/detail/baoipacpchggcdigagnajakiidcgcffn`.
إذا كنت تستضيف خادم Clips الخاص بك، فاحتفظ بخيار ملحق Chrome مخفيًا حتى
قائمة بياناتك في السوق الإلكتروني متاحة الآن. اضبط `VITE_CLIPS_CHROME_EXTENSION_ENABLED=1`
بعد الموافقة على إظهار الامتداد بجانب مطالبات تنزيل تطبيقات سطح المكتب. تعيين
`VITE_CLIPS_CHROME_EXTENSION_URL` فقط إذا كنت بحاجة إلى تجاوز الإعداد الافتراضي
إدراج URL.

## مقاطع قابلة للقراءة من قبل الوكيل

الصق رابط مشاركة Clips العام العادي في الوكيل. تعلن صفحة المشاركة
سياق الوكيل المضغوط URL، ويشير هذا السياق إلى النص والإطار
API، لذا فإن النماذج التي تقبل النص أو الصور الثابتة فقط لا تزال قادرة على فهم ما
حدث في التسجيل.

أي وكيل يمكنه جلب صورة URL إلى رؤيته - ChatGPT، رمز Claude،
المؤشر، Codex، والوكلاء المتصلون بـ MCP - يقرأ النص ويرى
إطارات. تقوم بعض محادثات الويب النصية فقط بقراءة النص ولكنها لا تسحب صور الإطار
يدخلون بمفردهم؛ هناك، قم بتحميل إطار رئيسي أو افتح المقطع في صورة قادرة على التقاط الصور
الوكيل.

| نقطة النهاية                                      | ما يحصل عليه الوكلاء                                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/api/agent-context.json?id=<recordingId>`        | مقطع البيانات الوصفية، وحالة النص، والفصول، وعبارات الحث على اتخاذ إجراء، والإطارات الموصى بها، والروابط إلى النص/الإطار APIs |
| `/api/agent-transcript.json?id=<recordingId>`     | أجزاء النص ذات الطابع الزمني مع `startMs`، `endMs`، والطوابع الزمنية القابلة للقراءة، والنص، وتسميات المصدر الاختيارية        |
| `/api/agent-frame.jpg?id=<recordingId>&atMs=<ms>` | إطار JPEG مستخرج من الفيديو بطابع زمني للفيديو الأصلي                                                                         |

تتبع نقاط النهاية نفس القواعد العامة/كلمة المرور/انتهاء الصلاحية مثل صفحة المشاركة.
تتطلب المقاطع المحمية بكلمة مرور كلمة المرور مرة واحدة؛ تعود الاستجابات الناجحة
روابط رمزية قصيرة العمر بحيث لا يحتاج وكلاء المراحل النهائية إلى النص العادي
كلمة المرور.

تستخدم معاينات Slack نفس حدود المشاركة. خطاف الويب `/api/slack/unfurl`
يُرجع فقط كتلة Slack `video` القابلة للتشغيل للمقاطع الجاهزة والعامة بدون
كلمة المرور، أو نتيجة انتهاء الصلاحية، أو علامة الأرشيف، أو علامة سلة المهملات. لا تزال المقاطع الأخرى تحصل على
البيانات الوصفية العادية لعنوان الصفحة/الصورة المصغرة وتتطلب فتح المقاطع.

```an-api title="نقطة إدخال سياق الوكيل"
{
  "method": "GET",
  "path": "/api/agent-context.json",
  "summary": "وصف مضغوط وسهل القراءة للمقطع المشترك",
  "description": "Returns clip metadata, transcript status, chapters, CTAs, recommended frames, and links to the transcript and frame APIs. Advertised by the public share page so a text- or image-only agent can understand a recording without ingesting raw video.",
  "auth": "Same public / password / expiry rules as the share page",
  "params": [
    { "name": "id", "in": "query", "type": "string", "required": true, "description": "Recording id" }
  ],
  "responses": [
    { "status": "200", "description": "Clip metadata plus transcript and frame API links" }
  ]
}
```

```an-api title="نص ذو طابع زمني"
{
  "method": "GET",
  "path": "/api/agent-transcript.json",
  "summary": "مقاطع نصية ذات طابع زمني لمقطع مشترك",
  "params": [
    { "name": "id", "in": "query", "type": "string", "required": true, "description": "Recording id" }
  ],
  "responses": [
    { "status": "200", "description": "Segments with startMs, endMs, readable timestamps, text, and optional source labels" }
  ]
}
```

```an-api title="إطار في طابع زمني"
{
  "method": "GET",
  "path": "/api/agent-frame.jpg",
  "summary": "إطار JPEG مستخرج من الفيديو بطابع زمني للفيديو الأصلي",
  "params": [
    { "name": "id", "in": "query", "type": "string", "required": true, "description": "Recording id" },
    { "name": "atMs", "in": "query", "type": "integer", "required": true, "description": "Original-video timestamp in milliseconds" }
  ],
  "responses": [
    { "status": "200", "description": "image/jpeg frame" }
  ]
}
```

## البدء

عرض توضيحي مباشر: [clips.agent-native.com](https://clips.agent-native.com).

1. **افتح المكتبة.** تصفح تسجيلات الشاشة، وتسجيلات الاجتماعات، والإملاءات،
   المجلدات والمسافات من مكان واحد.
2. **التسجيل أو الاستيراد.** التقط تسجيلًا للشاشة، وابدأ من التقويم
   الاجتماع، أو استخدام ميزة الضغط والتحدث.
3. **دع الوكيل ينظف الأمر.** أنشئ عنوانًا وملخصًا وفصولًا وإجراءً
   العناصر أو نص النص المنظف.
4. **البحث وإعادة الاستخدام.** اطلب المقطع أو الاقتباس أو عنصر العمل أو القرار الذي اتخذته
   الحاجة، ثم شارك النتيجة مع الرؤية الصحيحة.

### مطالبات مفيدة

- "تلخيص هذا المقطع لتحديث المنتج."
- "ابحث عن الاجتماع الذي ناقشنا فيه خطة الطرح."
- "استخرج ثلاثة عروض أسعار للعملاء من هذا النص."
- "إنشاء عناصر عمل من مكالمة المبيعات الأخيرة."
- "قم بتنظيف هذا الإملاء وتحويله إلى تذكرة Linear."

## للمطورين

باقي هذا المستند مخصص لأي شخص يقوم بتعديل قالب Clips أو توسيعه.

### بداية سريعة

```bash
npx @agent-native/core@latest create my-clips --standalone --template clips
cd my-clips
pnpm install
pnpm dev
```

Clips عبارة عن قالب أكبر حجمًا يحتوي على مسجل أصلي (وهو يأتي مصحوبًا بسطح المكتب لالتقاط الصور المحلية). هناك ثلاث خطوات إعداد مطلوبة قبل أن تتمكن من تحميل التسجيلات:

1. **وحدة تخزين الفيديو (مطلوبة).** قم بتوصيل واجهة التخزين الخلفية من خلال معالج الإعداد. أسهل مسار هو Builder.io (مجاني خلال النسخة التجريبية، بنقرة واحدة). بالنسبة للتخزين المستضاف ذاتيًا، قم بتعيين `S3_ENDPOINT` و`S3_BUCKET` و`S3_ACCESS_KEY_ID` و`S3_SECRET_ACCESS_KEY` واختياريًا `S3_REGION` و`S3_PUBLIC_BASE_URL`. يستخدم Cloudflare R2 وDigitalOcean Spaces نفس متغيرات env مع البادئة `R2_*`.
2. **Google Calendar (اختياري).** لمزامنة الاجتماعات القادمة، قم بتوصيل حساب Google Calendar من الإعدادات. رد الاتصال OAuth URL في المطور هو `http://localhost:8094/_agent-native/google/callback`. قم بإعداد عميل Google OAuth في [Google Cloud Console](https://console.cloud.google.com/) مع تمكين Gmail وGoogle Calendar API.
3. **أذونات التقاط الشاشة.** على نظام التشغيل macOS، امنح إذن تسجيل الشاشة للمتصفح (أو التطبيق المصاحب لسطح المكتب) في إعدادات النظام ← الخصوصية والأمان ← تسجيل الشاشة. يمكن لتسجيلات المتصفح حفظ وحدة التحكم المنقحة وجلب تشخيصات/XHR من صفحة المسجل. بمجرد توفر قائمة ملحقات Chrome، قم بتمكين `VITE_CLIPS_CHROME_EXTENSION_ENABLED=1` حتى يتمكن المستخدمون من اختيار الامتداد لسجلات متصفح علامة التبويب النشطة أو تطبيق سطح المكتب للحصول على مسار الالتقاط الأصلي الأكثر سلاسة.
4. **معاينات Slack (اختيارية).** أنشئ تطبيق Slack باستخدام `links:read` و`links:write` و`links.embed:write`؛ الاشتراك في `link_shared`. أضف نطاق مشاركة Clips الخاص بك ضمن **App Unfurl Domains**؛ اضبط طلب URL على `https://your-clips.example.com/api/slack/unfurl`؛ وأضف إعادة توجيه OAuth URL `https://your-clips.example.com/api/slack/oauth/callback`. قم بتكوين `SLACK_CLIENT_ID`، و`SLACK_CLIENT_SECRET`، و`SLACK_SIGNING_SECRET`، ثم قم بتوصيل مساحات العمل من إعدادات Clips.

### استضافة خادم Clips الخاص بك

تطبيق Clips المستضاف على [clips.agent-native.com](https://clips.agent-native.com)
هو مجرد نسخة منشورة من قالب Clips. لتشغيل الخادم الخاص بك، سقالة
القالب، ونشره مثل أي تطبيق وكيل آخر، ثم قم بتوجيه سطح المكتب
تطبيق الدرج عند النشر.

1. **إنشاء التطبيق.**

   ```باش
   npx @agent-native/core@latest قم بإنشاء مقاطعي --standalone --template clips
   قرص مضغوط خاص بي
   تثبيت pnpm
   ```

2. **تكوين حالة الإنتاج.** تعيين `DATABASE_URL` المستمر، العادي
   متغيرات مصادقة/أسرار الإنتاج من [Deployment](/docs/deployment)، و
   موفر تخزين الفيديو. Builder.io Connect هو أسهل مسار للتخزين؛ ل
   وحدة تخزين ذاتية الاستضافة، استخدم متغيرات `S3_*` أو `R2_*` لوحدة تخزين متوافقة مع S3
   دلو.

3. **نشر تطبيق الويب.** لنشر عقدة عادية:

   ```باش
   بناء pnpm
   العقدة .output/server/index.mjs
   ```

   يمكنك أيضًا استخدام أي هدف Nitro من [Deployment](/docs/deployment)، مثل
   مثل Netlify أو Vercel أو Cloudflare Pages أو AWS Lambda أو Deno Deploy. تأكد
   `BETTER_AUTH_URL` هو أصل المقاطع العامة، على سبيل المثال
   `https://clips.example.com`.

4. **قم بتوصيل تطبيق علبة سطح المكتب.** افتح إعدادات Clips Desktop وقم بتعيينها
   **يقوم Clips server URL** بالقاعدة العامة URL للنشر، على سبيل المثال
   `https://clips.example.com`. إذا تم تثبيت التطبيق ضمن مسار مساحة عمل،
   تضمين هذا المسار، مثل `https://example.com/clips`. انقر على **اتصال**،
   ثم قم بتسجيل الدخول باستخدام حساب على خادم Clips هذا.

5. **تمكين ملحق Chrome بعد النشر.** الاحتفاظ
   يتم إلغاء تعيين `VITE_CLIPS_CHROME_EXTENSION_ENABLED` حتى يتم إدراجه في قائمة سوق Chrome الإلكتروني
   . ثم اضبطه على `1` للكشف عن خيار سجل المتصفح بجانب
   مطالبات تطبيق سطح المكتب. القائمة الافتراضية URL هي
   `https://chromewebstore.google.com/detail/baoipacpchggcdigagnajakiidcgcffn`;
   قم بتعيين `VITE_CLIPS_CHROME_EXTENSION_URL` فقط إذا كان النشر الخاص بك يستخدم
   قائمة ملحقات مختلفة.

6. **الاتصال بعمليات التكامل الاختيارية.** تعمل Google Calendar على تشغيل علامة التبويب "الاجتماعات"،
   يعمل `GEMINI_API_KEY` أو Builder.io Connect على تشغيل تنظيف النص والعناوين،
   يمكن أن يوفر `GROQ_API_KEY` خاصية تحويل الكلام إلى نص، وSlack OAuth
   يتيح الاتصال في الإعدادات إمكانية فتح Slack القابلة للتشغيل.

للتطوير المحلي، قم بتشغيل تطبيق الويب باستخدام `pnpm dev` وقم بتوجيه سطح المكتب
تطبيق الدرج على `http://localhost:8094`.

### الميزات الرئيسية

**مكتبة واحدة، وثلاثة أنواع التقاط.** تشترك تسجيلات الشاشة، واجتماعات التقويم، وإملاءات الضغط والتحدث في مكتبة واحدة قابلة للبحث.

**النص والذكاء الاصطناعي.** تحصل التسجيلات على أجزاء النص ذات الطابع الزمني والعناوين التي تم إنشاؤها والملخصات وعلامات الفصل.

**التحرير غير المدمر.** يظل القطع والتقسيم وإزالة كلمات الحشو وإزالة الصمت والدمج في `edits_json` بحيث تظل الوسائط الأصلية سليمة.

**روابط المشاركة القابلة للقراءة من قبل الوكيل.** تعرض روابط المشاركة العامة النص وتأطير API حتى يتمكن الوكلاء من فهم التسجيلات دون استيعاب الفيديو الأولي.

**نشر Slack القابل للتشغيل.** يمكن أن تعرض روابط المشاركة العامة كتلة Slack `video`
يشير إلى مشغل `/embed/:id` الموجود. هذا هو تطبيق Slack لمساحة العمل
التثبيت، وليس سلوك الزاحف العام: البيانات الوصفية العادية لـ Open Graph/Twitter هي
الإجراء الاحتياطي عند عدم تثبيت التطبيق.

### نموذج البيانات

تعيش جميع البيانات في SQL عبر Drizzle ORM. المخطط: `templates/clips/server/db/schema.ts`. تحمل التسجيلات والاجتماعات والإملاءات وحسابات التقويم والمفردات معيار `ownableColumns` ولها جدول مشاركات إطار عمل مطابق، لذا يتم إدخالها في نموذج المشاركة لكل مستخدم / لكل مؤسسة.

```an-schema title="نموذج البيانات الأساسية للمقاطع" summary="recordings is the source of truth for media; transcripts, meetings, and dictations compose with it rather than duplicating video. (Engagement and org tables omitted for clarity — see the full table below.)"
{
  "entities": [
    {
      "id": "recordings",
      "name": "recordings",
      "note": "Core resource; source of truth for media. ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "title", "type": "text" },
        { "name": "video_url", "type": "text", "note": "plus format / size / duration / thumbnails" },
        { "name": "status", "type": "text" },
        { "name": "edits_json", "type": "text", "note": "تعديلات غير مدمرة" },
        { "name": "chapters_json", "type": "text", "nullable": true },
        { "name": "password", "type": "text", "nullable": true, "note": "الخصوصية: كلمة المرور / انتهاء الصلاحية" }
      ]
    },
    {
      "id": "recording_transcripts",
      "name": "recording_transcripts",
      "note": "قم بالتقسيم بحيث يتم عرض طرق عرض المكتبة والنص بسرعة",
      "fields": [
        { "name": "recording_id", "type": "text", "fk": "recordings.id" },
        { "name": "segments_json", "type": "text", "note": "{ startMs, endMs, text }" },
        { "name": "full_text", "type": "text" },
        { "name": "language", "type": "text" },
        { "name": "status", "type": "text" }
      ]
    },
    {
      "id": "clips_meetings",
      "name": "clips_meetings",
      "note": "Calendar-sourced or ad-hoc; owns a recording",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "recording_id", "type": "text", "fk": "recordings.id", "nullable": true },
        { "name": "summary_md", "type": "text", "nullable": true },
        { "name": "bullets_json", "type": "text", "nullable": true },
        { "name": "action_items_json", "type": "text", "nullable": true }
      ]
    },
    {
      "id": "clips_dictations",
      "name": "clips_dictations",
      "note": "Push-to-talk dictation history; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "full_text", "type": "text", "note": "الخام" },
        { "name": "cleaned_text", "type": "text", "nullable": true },
        { "name": "source", "type": "text", "note": "فريق الجبهة الوطنية، وما إلى ذلك." },
        { "name": "target_app", "type": "text", "nullable": true }
      ]
    }
  ],
  "relations": [
    { "from": "recordings", "to": "recording_transcripts", "kind": "1-1", "label": "transcript" },
    { "from": "recordings", "to": "clips_meetings", "kind": "1-1", "label": "captured by" }
  ]
}
```

| الجدول                                          | ما يحمله                                                                                                                                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recordings`                                    | المورد الأساسي — العنوان، والفيديو URL/التنسيق/الحجم، والمدة، والصور المصغرة، والحالة، و`edits_json`، و`chapters_json`، والخصوصية (كلمة المرور، وانتهاء الصلاحية)، وتبديل المشغل                         |
| `recording_transcripts`                         | النص لكل تسجيل: `segments_json` (`{startMs,endMs,text}`)، `full_text`، اللغة، والحالة                                                                                                                    |
| `recording_tags`                                | علامات ذات شكل حر على التسجيل                                                                                                                                                                            |
| `recording_ctas`                                | أزرار الحث على اتخاذ إجراء (التسمية، وعنوان URL، واللون، والموضع) المتراكبة على التسجيل                                                                                                                  |
| `recording_comments`                            | تعليقات متسلسلة ومختومة بالوقت مع خريطة تفاعل الرموز التعبيرية وعلامة الحل                                                                                                                               |
| `recording_reactions`                           | تم تثبيت الرمز التعبيري reactions على الطابع الزمني للفيديو (يُسمح بالمشاهدين المجهولين)                                                                                                                 |
| `recording_viewers` / `recording_events`        | عرض التحليلات: وقت المشاهدة لكل مشاهد واكتماله، بالإضافة إلى الأحداث التفصيلية (بدء العرض، تقدم المشاهدة، البحث، الإيقاف المؤقت، النقر على CTA، التفاعل)                                                 |
| `clips_meetings`                                | الاجتماعات المستندة إلى التقويم أو المخصصة - جدول زمني/امتدادات فعلية، والنظام الأساسي، وملاحظات المستخدم، وAI `summary_md`، و`bullets_json`، و`action_items_json`، والرابط إلى `recording_id` الخاص بها |
| `meeting_participants` / `meeting_action_items` | الحاضرون وبنود العمل المستخرجة للاجتماع                                                                                                                                                                  |
| `calendar_accounts` / `calendar_events`         | حسابات التقويم المتصلة (رموز OAuth موجودة في `app_secrets`، والمشار إليها هنا فقط) ولقطات الأحداث التي تمت مزامنتها                                                                                      |
| `clips_dictations`                              | سجل إملاء الضغط والتحدث - `full_text` الأولي، و`cleaned_text` الاختياري، والمصدر (`fn-hold`، وما إلى ذلك)، والتطبيق المستهدف                                                                             |
| `clips_vocabulary`                              | تصحيحات المفردات الشخصية (المصطلح ← الاستبدال المفضل) التي تؤثر على الإملاءات المستقبلية                                                                                                                 |
| `spaces` / `space_members` / `folders`          | تنظيم المكتبة — المسافات (الحاويات ذات النطاق الموضوعي)، وأعضائها، والمجلدات القابلة للتداخل                                                                                                             |
| `organization_settings`                         | الملف الجانبي للمقاطع حسب المؤسسة: لون العلامة التجارية، والشعار، والرؤية الافتراضية                                                                                                                     |

التسجيلات والنصوص عبارة عن جداول منفصلة عمدًا بحيث يمكن عرض كل من عرضي المكتبة والنص بسرعة. يتم إنشاء الاجتماعات باستخدام التسجيلات بدلاً من الوسائط المكررة: يمتلك الاجتماع التسجيل الذي يلتقطه، ولكن يظل الصف `recordings` هو مصدر الحقيقة للفيديو والنص لكل مقطع.

توجد المسارات في UI ضمن `templates/clips/app/routes/` - يقع التطبيق المعتمد ضمن `_app.*` (المكتبة والمساحات والمجلدات والاجتماعات والإملاء والرؤى والمهملات والإعدادات)، مع الأسطح العامة في `r.$recordingId` و`share.$shareId` و`embed.$shareId` و`invite.$token`.

### مفتاح actions

كل عملية قابلة للاستدعاء للوكيل هي ملف TypeScript في `templates/clips/actions/`، مثبت تلقائيًا في `POST /_agent-native/actions/:name` وقابل للتشغيل من CLI كـ `pnpm action <name>`. هناك ~ 80 actions؛ المجموعات المفيدة:

- **دورة حياة التسجيل** — `create-recording`، `finalize-recording`، `update-recording`، `set-thumbnail`، `archive-recording` / `restore-recording` / `trash-recording` / `delete-recording-permanent`، `move-recording`، `tag-recording`.
- **النص والذكاء الاصطناعي** — `request-transcript`، `cleanup-transcript`، `regenerate-title` / `regenerate-summary` / `regenerate-chapters`، `set-chapters`، `generate-workflow`. (`cleanup-transcript` و`finalize-meeting` عبارة عن مكالمات عبر قنوات الوسائط من جانب الخادم؛ وتفوض معظم ميزات الذكاء الاصطناعي الأخرى إلى دردشة الوكيل.)
- **التحرير** — `trim-recording`، `split-recording`، `remove-filler-words`، `remove-silences`، بالإضافة إلى `stitch-recordings`، `undo-edit`، `clear-edits`. تتراكم التعديلات في `edits_json`؛ يقوم العميل بالتسلسل/التصدير عبر ffmpeg.wasm.
- **الاجتماعات** — `create-meeting`، `start-meeting-recording` / `stop-meeting-recording`، `finalize-meeting`، `update-meeting`، `get-meeting`، `list-meetings`، بالإضافة إلى أسلاك التقويم `connect-calendar` / `disconnect-calendar` / `sync-calendars` / `list-calendar-accounts`.
- **الإملاء** — `create-dictation`، و`cleanup-dictation`، و`update-dictation`، و`list-dictations`، و`add-vocabulary-term` / `list-vocabulary` لانحياز المفردات الشخصية.
- **تنظيم المكتبة** — `create-space` / `rename-space` / `delete-space`، `add-space-member` / `remove-space-member`، `create-folder` / `rename-folder` / `delete-folder`، `add-recording-to-space`.
- **المشاركة والتعليقات والمشاركة** — مشاركة إطار العمل actions plus `create-cta` / `update-cta` / `delete-cta`, `add-comment` / `reply-to-comment` / `resolve-comment` / `react-to-comment` / `delete-comment`, `react-to-recording`, `list-viewers`.
- **المؤسسات والأعضاء** — `create-organization`، `set-organization-branding`، `invite-member` / `accept-invite` / `decline-invite` / `get-invite`، `remove-member`، `update-member-role`، `list-organization-state`، `list-notifications`.
- **البحث والرؤى والتصدير** — `search-recordings` (يطابق العناوين والأوصاف والنص النصي والتعليقات، مع الطوابع الزمنية)، `get-recording-insights`، `get-organization-insights`، `export-insights-csv`، `export-to-brain`.
- **السياق والتنقل** — `view-screen` (المقطع الحالي، رأس التشغيل، نطاق النص المحدد) و`navigate`؛ `refresh-list` بعد الطفرات.

### تخصيصه

إن Clips عبارة عن قالب كامل وقابل للاستنساخ - قم بتقسيمه واطلب من الوكيل توسيعه. بعض الأمثلة:

- "أضف زر إزالة كلمات الحشو الذي يزيل ums وuhs من النص ويعيد دمج الفيديو."
- "نشر ملاحظاتي الاحتياطية تلقائيًا على Slack #eng عند انتهاء الاجتماع." (قم بتوصيل Slack أولاً عبر [Messaging](/docs/messaging).)
- "أضف مفتاح التشغيل السريع الذي يسقط الإملاء الأخير في Linear كتذكرة جديدة."
- "قم بتجميع المكتبة حسب المشروع - اكتشف المشروع من الكلمات الأولى لكل نص."
- "أضف زر "إنشاء مشاركة مدونة من هذا المقطع" الذي يقوم بصياغة مشاركة من النص وحفظها كمسودة."
- "السماح للمشاهدين بترك reactions ذو الطابع الزمني على مقطع مشترك."

يقوم الوكيل بتحرير المسارات والمكونات ومسار النص والمخطط حسب الحاجة. راجع [Templates](/docs/cloneable-saas) للاطلاع على الاستنساخ الكامل والتخصيص والنشر و[Getting Started](/docs/getting-started) إذا كان هذا هو أول قالب أصلي للوكيل.

## ما هي الخطوة التالية

- [**Templates**](/docs/cloneable-saas) — نموذج الاستنساخ والتملك
- [**Context Awareness**](/docs/context-awareness) — كيف يعرف الوكيل المقطع الحالي ورأس التشغيل
- [**Agent Teams**](/docs/agent-teams) — تفويض عملية تنظيف النص إلى وكيل فرعي متخصص
