---
title: "البريد"
description: "عميل بريد إلكتروني مدعوم من الوكيل. قم بتوصيل Gmail الخاص بك وسيتمكن الوكيل من قراءة البريد الإلكتروني وصياغته وإرساله وتنظيمه."
---

# البريد

عميل بريد إلكتروني مدعوم من الوكيل. قم بتوصيل حساب Gmail الخاص بك وسيتمكن الوكيل من قراءة البريد الإلكتروني وصياغته وإرساله وتنظيمه - جنبًا إلى جنب مع صندوق بريد وارد سريع يعتمد على لوحة المفاتيح ويمكنك التحكم فيه بنفسك. فكر في Superhuman، لكن الوكيل مواطن من الدرجة الأولى وقاعدة التعليمات البرمجية ملكك.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;min-height:500px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1.4px solid var(--wf-line)'><strong>صندوق الوارد 16</strong><div style='flex:1'></div><span data-icon='search' aria-label='بحث'></span><span data-icon='edit' aria-label='إنشاء'></span><span data-icon='bell' aria-label='إشعار'></span></div><div style='display:flex;flex-direction:column;padding:8px 14px;gap:6px'><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><strong>بريا ميهتا</strong><span><strong>إطلاق الربع الثالث</strong> — الأصول النهائية جاهزة للمراجعة</span><span>★</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><strong>فوترة Acme</strong><span>فاتورتك الشهرية جاهزة</span><span>11:10 AM</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>ماركوس تانغ</span><span>مسار الإعداد research findings</span><span>أمس</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>GitHub</span><span>[framework] PR جاهز للمراجعة</span><span>أمس</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>Linear</span><span>تم تعيين Issue ENG-1287 لك</span><span>2 مايو</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>Stripe</span><span>ملخص المدفوعات الأسبوعي</span><span>29 أبريل</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>Calendly</span><span>تم تأكيد حجز جديد</span><span>28 أبريل</span></div></div></div>"
}
```

عند فتح التطبيق، يظل صندوق الوارد الذي يحتوي على لوحة المفاتيح وعرض سلسلة الرسائل يركزان على البريد نفسه. يعرف الوكيل دائمًا العرض الذي أنت فيه والموضوع الذي قمت بفتحه، لذلك يمكنك أن تقول "أرشفة هذا" أو "صياغة رفض ودي" دون توضيح معنى "هذا".

```an-diagram title="كيف يتدفق طلب البريد" summary="تعمل اختصارات لوحة المفاتيح ومطالبات الوكيل على تشغيل نفس الإجراءات. البريد الإلكتروني موجود في Gmail؛ المسودات والأتمتة والتتبع مباشرة في SQL وapplication_state."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">أنت تقود<br><small class=\"diagram-muted\">J/K/E/R اختصارات</small></div><div class=\"diagram-node\">أنت تسأل الوكيل<br><small class=\"diagram-muted\">\"صياغة تراجع ودي\"</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Actions</span><small class=\"diagram-muted\">list-emails · get-thread · manage-draft · send</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Gmail<br><small class=\"diagram-muted\">حسابات متعددة، عبر OAuth</small></div><div class=\"diagram-box\">SQL + application_state<br><small class=\"diagram-muted\">مسودات · أتمتة · تتبع</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box\">يتم تحديث البريد الوارد مباشرة</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## ما يمكنك فعله به

- **قراءة البريد الإلكتروني وفرزه** باستخدام اختصارات لوحة المفاتيح (`J`/`K` للتنقل، `E` للأرشفة، `R` للرد، `C` للإنشاء).
- **ربط حسابات Gmail المتعددة** — شخصية والعمل في بريد وارد واحد.
- **اطلب من الوكيل القيام بأي شيء يمكنك القيام به.** "تلخيص رسائل البريد الإلكتروني غير المقروءة." "قم بصياغة رد يرفض بأدب." "يمكنك أرشفة جميع رسائل البريد الإلكتروني لروبوت Netlify الأقدم من أسبوع."
- **وضع المسودات في قائمة الانتظار للمراجعة.** يمكن لزملاء الفريق ومستخدمي Slack أن يطلبوا من الوكيل إعداد بريد إلكتروني لأحد أعضاء المؤسسة؛ يقوم المالك بمراجعتها وتعديلها وإرسالها من البريد.
- **الفرز التلقائي باستخدام القواعد.** قم بإعداد قواعد التشغيل الآلي باللغة الإنجليزية البسيطة ("من رسالة إخبارية") باستخدام actions (التسمية، والأرشيف، ووضع علامة على المقروء، والنجمة، والمهملات).
- **تتبع عمليات الفتح والنقرات** على رسائل البريد الإلكتروني التي ترسلها.
- **البحث في كل بريد وارد متصل** باستخدام استعلام واحد.
- **الأرشفة المجمعة والتصدير والتسمية** — مفيدة لتنظيف البريد الوارد.

## البدء

عرض توضيحي مباشر: [mail.agent-native.com](https://mail.agent-native.com).

> **قد تعرض Google تحذيرًا:** يستخدم العرض التوضيحي المستضاف تطبيق Google المشترك الخاص بـ Agent-Native للوصول إلى Gmail، لذلك قد تطلب منك Google التأكيد قبل المتابعة. قم بالتشغيل محليًا لاستخدام عميل Google OAuth الخاص بك.

عند فتح التطبيق لأول مرة:

1. انقر على **الإعدادات** في الشريط الجانبي.
2. انقر فوق **الاتصال بحساب Google**، وقم بتسجيل الدخول إلى Gmail، ثم قم بالموافقة.
3. (اختياري) قم بتوصيل حساب Google ثانٍ للعمل + الشخصي.
4. عد إلى البريد الوارد — ستتم مزامنة Gmail الحقيقي.

بدون اتصال حساب Google، يعمل التطبيق على صندوق بريد محلي فارغ (مفيد لالتقاط لقطات الشاشة والعروض التوضيحية، وليس أي شيء آخر).

## التحدث إلى الوكيل

يقرأ الوكيل `application_state.navigation` في كل منعطف، لذا فهو يعرف بالفعل العرض الذي أنت فيه، وأي سلسلة رسائل مفتوحة، والرسالة التي يتم التركيز عليها - ليس عليك أن تخبرها. يمكنك فقط قول أشياء مثل:

- "تلخيص رسائل البريد الإلكتروني غير المقروءة."
- "ابحث عن أحدث سلسلة رسائل من أليس حول الميزانية."
- "قم بصياغة رد يرفض بأدب."
- "أرشفة جميع رسائل البريد الإلكتروني لروبوت Netlify الأقدم من أسبوع."
- "افتح رسائل البريد الإلكتروني المميزة بنجمة."
- "اجعل هذه المسودة أكثر رسمية."
- "هل فتحوا بريدي الإلكتروني؟"

إذا حددت نصًا وضغطت على Cmd+I، فسينتقل هذا التحديد مع رسالتك التالية - لذا فإن "اجعل هذا أكثر تأثيرًا" يعمل على ما حددته بالضبط.

## اختصارات لوحة المفاتيح

| المفتاح   | الإجراء                                        |
| --------- | ---------------------------------------------- |
| `J`       | البريد الإلكتروني التالي                       |
| `K`       | البريد الإلكتروني السابق                       |
| `Up/Down` | مثل J/K                                        |
| `Enter`   | فتح البريد الإلكتروني المركز                   |
| `E`       | أرشفة البريد الإلكتروني أو سلسلة المحادثات     |
| `D`       | البريد الإلكتروني أو سلسلة الرسائل في المهملات |
| `S`       | تمييز بنجمة أو إلغاء تمييزها                   |
| `R`       | الرد                                           |
| `U`       | تبديل القراءة/غير المقروءة                     |
| `C`       | إنشاء بريد إلكتروني جديد                       |
| `/`       | تركيز شريط البحث                               |
| `Cmd+K`   | افتح لوحة الأوامر                              |
| `G I`     | انتقل إلى البريد الوارد                        |
| `G S`     | انتقل إلى المميزة بنجمة                        |
| `G T`     | انتقل إلى "المرسلة"                            |
| `G D`     | انتقل إلى المسودات                             |
| `G A`     | انتقل إلى الأرشيف                              |
| `Esc`     | إغلاق الموضوع / مسح البحث                      |

## للمطورين

باقي هذا المستند مخصص لأي شخص يقوم بتعديل قالب البريد أو توسيعه.

### بداية سريعة

قم بإنشاء مساحة عمل جديدة باستخدام قالب البريد:

```bash
npx @agent-native/core@latest create my-mail --standalone --template mail
cd my-mail
pnpm install
pnpm dev
```

أو قم بإضافة البريد إلى مساحة عمل الوكيل الأصلية الموجودة:

```bash
npx @agent-native/core@latest add-app
```

لربط Gmail في جهاز التطوير، تحتاج إلى عميل Google OAuth:

1. افتح [Google Cloud Console](https://console.cloud.google.com/) وأنشئ مشروعًا.
2. قم بتمكين **Gmail API** ضمن APIs & Services → المكتبة.
3. إنشاء بيانات اعتماد OAuth 2.0 (النوع: تطبيق ويب). أضف `http://localhost:8085/_agent-native/google/callback` كإعادة توجيه معتمدة URI.
4. انسخ معرف العميل وسر العميل إلى صفحة الإعدادات الخاصة بالتطبيق قيد التشغيل، ثم انقر فوق **الاتصال بحساب Google**.

يتم تخزين الرموز المميزة في جدول `oauth_tokens` SQL ويتم تحديثها تلقائيًا. يمكنك ربط عدة حسابات Gmail بمجرد إعداد الحساب الأول.

### الميزات الرئيسية

**حسابات متعددة Gmail.** قم بتوصيل حساب واحد أو أكثر من حسابات Google، ثم قم بإدراج أو بحث أو صياغة أو إرسال أو تصنيف أو أرشفة أو تمييز بنجمة أو إرسال سلة المهملات عبر صناديق البريد الوارد المتصلة.

**مسودة مسارات العمل.** تتم مزامنة مسودات الإنشاء المتعددة من خلال حالة التطبيق، وتسمح مسودات SQL الموضوعة في قائمة الانتظار لزملاء الفريق أو مستخدمي Slack بطلب البريد للمالك لمراجعته وإرساله.

**الأتمتة والتتبع.** يمكن لقواعد الفرز باللغة الطبيعية التصنيف أو الأرشفة أو وضع علامة على القراءة أو وضع نجمة أو المهملات أو التشغيل يدويًا؛ يمكن للرسائل المرسلة تتبع عمليات الفتح والنقرات.

**البحث، actions المجمع، والمعاينات.** البحث المشترك في البريد الوارد actions، والأرشفة/التصدير المجمع، ومعاينات سلسلة المحادثات المضمنة التي يمكن للوكيل تضمينها في الدردشة.

### كيف يرى الوكيل سياقك

- **العرض الحالي والموضوع** — يكتب UI `navigation` (عرض، معرف خيط، معرف بريد إلكتروني مركز، بحث، تسمية) كلما قمت بالتنقل. يقرأها الوكيل عبر `readAppState("navigation")` أو `pnpm action view-screen`.
- **افتح المسودة** — إذا كنت تكتب ردًا وتطلب "مساعدتي في كتابة هذا"، فسيقرأ الوكيل إدخال `compose-{id}` المطابق لرؤية موضوعك الحالي ونصه، ثم يكتب مسودة محدثة مرة أخرى. تلتقط UI التعديل مباشرة.
- **سجل سلسلة المحادثات** — بالنسبة للسياق في منتصف الرد، يقوم الوكيل بجلب سلسلة المحادثات الكاملة باستخدام `pnpm action get-thread --id=<threadId>`.

### كيفية اتخاذ الوكيل للإجراء

- **عمليات البريد** — الأرشيف، المهملات، النجمة، وضع علامة للقراءة، الإرسال، المسودة — كلها تعمل كبرامج نصية `pnpm action <name>` ضمن `templates/mail/actions/`.
- **التنقل** — لفتح موضوع أو تبديل طرق العرض لك، يكتب الوكيل `application_state.navigate`، والذي يستهلكه UI ويحذفه. يختتم البرنامج النصي `pnpm action navigate` هذا.
- **تحديث** — بعد أي تغيير، يقوم الوكيل بتشغيل `pnpm action refresh-list` حتى تتم إعادة جلب UI.

### نموذج البيانات

عند الاتصال بحساب Google، يظل البريد الإلكتروني موجودًا في Gmail — ويكون التطبيق بمثابة عرض في الأعلى. عندما لا يكون هناك أي حساب متصل، يتم حفظ رسائل البريد الإلكتروني في مخزن إعدادات SQL ضمن `getSetting("local-emails")` (فارغ بشكل افتراضي).

| مخزن/طاولة                    | ما يحمله                                                          |
| ----------------------------- | ----------------------------------------------------------------- |
| `getSetting("local-emails")`  | الاحتياطي للبريد الإلكتروني المحلي في حالة عدم ربط أي حساب Google |
| `getSetting("labels")`        | تصنيفات النظام والمستخدم، مع أعداد غير مقروءة                     |
| `getSetting("mail-settings")` | ملف تعريف المستخدم، تفضيلات التتبع، التوقيع، الأسماء المستعارة    |
| `getSetting("aliases")`       | الأسماء المستعارة للبريد الإلكتروني                               |
| جدول `queued_email_drafts`    | المسودات التي طلبها زميل الفريق في انتظار مراجعة/إرسال المالك     |
| جدول `email_tracking`         | أحداث البكسل المفتوحة للرسائل المرسلة                             |
| جدول `email_link_tracking`    | أحداث النقر على الرابط للرسائل المرسلة                            |
| جدول `application_state`      | إدخالات `navigation` و`navigate` و`compose-{id}` (عابرة)          |
| جدول `oauth_tokens`           | رموز Google OAuth المميزة (الموفر `"google"`، صف واحد لكل حساب)   |

تتخذ رسائل البريد الإلكتروني التي تتدفق عبر API الشكل `{ id, threadId, from, to, cc, subject, snippet, body, date, isRead, isStarred, isArchived, isTrashed, labelIds, accountEmail, attachments }`.

```an-schema title="جداول البريد SQL" summary="البريد الإلكتروني نفسه موجود في Gmail. تحتوي جداول SQL على ما لا يحتوي عليه Gmail: المسودات الموضوعة في قائمة الانتظار، وأحداث تتبع الإرسال، والرموز المميزة OAuth. الإعدادات والحالة المؤقتة موجودة في الإعدادات ومتاجر application_state."
{
  "entities": [
    {
      "id": "queued_email_drafts",
      "name": "queued_email_drafts",
      "note": "مسودات طلبها زميل الفريق/Slack بانتظار مراجعة المالك",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "assignedTo", "type": "string", "note": "org member who reviews/sends" },
        { "name": "subject", "type": "string" },
        { "name": "body", "type": "markdown" },
        { "name": "status", "type": "enum", "note": "review at /draft-queue/<id>" }
      ]
    },
    {
      "id": "email_tracking",
      "name": "email_tracking",
      "note": "أحداث البكسل المفتوحة للرسائل المرسلة",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "messageId", "type": "string" },
        { "name": "openedAt", "type": "datetime" }
      ]
    },
    {
      "id": "email_link_tracking",
      "name": "email_link_tracking",
      "note": "أحداث النقر على الرابط للرسائل المرسلة",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "messageId", "type": "string", "fk": "email_tracking.messageId" },
        { "name": "url", "type": "string" },
        { "name": "clickedAt", "type": "datetime" }
      ]
    },
    {
      "id": "oauth_tokens",
      "name": "oauth_tokens",
      "note": "جدول الإطار — صف واحد لكل حساب Google متصل",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "provider", "type": "string", "note": "\"google\"" },
        { "name": "accountEmail", "type": "string" },
        { "name": "accessToken", "type": "string" },
        { "name": "refreshToken", "type": "string" }
      ]
    }
  ],
  "relations": [
    { "from": "email_tracking", "to": "email_link_tracking", "kind": "1-n", "label": "click events" }
  ]
}
```

الطرق في UI:

- `/_index.tsx` — يعيد التوجيه إلى عرض البريد الوارد الافتراضي.
- `/$view.tsx` — عرض القائمة (`inbox`، `starred`، `sent`، `drafts`، `archive`، `trash`، وما إلى ذلك).
- `/$view.$threadId.tsx` — عرض قائمة بموضوع مفتوح محدد.
- `/email` — معاينة سلسلة المحادثات المضمنة المستخدمة في دردشة الوكيل.
- `/settings` — اتصالات الحساب، والتتبع، والأتمتة.
- `/team` — أعضاء الفريق والموارد المشتركة.

### تخصيصه

البريد متاح لك للتغيير. كل شيء مهم يعيش في عدد قليل من الأماكن - ابدأ هناك.

**إضافة قدرة الوكيل.** أضف ملفًا جديدًا ضمن `templates/mail/actions/` باستخدام `defineAction`. يصبح الإجراء الخاص بك أداة وكيل، وأمر CLI (`pnpm action <name>`)، وسطح ربط أمامي مكتوب من خلال `useActionQuery` / `useActionMutation`. انظر إلى `templates/mail/actions/star-email.ts` للحصول على مثال قصير أو `templates/mail/actions/manage-automations.ts` لواحد يحتوي على عدة actions. راجع مستندات [actions](/docs/actions) للتعرف على النمط الكامل.

**تغيير UI.** المسارات موجودة في `templates/mail/app/routes/` والمكونات في `templates/mail/app/components/email/` و`templates/mail/app/components/layout/`. يستخدم التطبيق عناصر shadcn/ui الأولية من `app/components/ui/` وأيقونات Tabler - التزم بها.

**تغيير كيفية تصرف الوكيل.** توجد إرشادات الوكيل في `templates/mail/AGENTS.md` وskills في `templates/mail/.agents/skills/` (`email-drafts`، `real-time-sync`، `security`، `self-modifying-code`، وغيرها). يتم تغيير سلوك الوكيل عن طريق تعديل Markdown - وليس التعليمات البرمجية.

**تغيير البيانات أو الإعدادات.** توجد مخططات جداول التتبع والهياكل ذات الصلة في `templates/mail/server/db/`. تمر إعدادات القراءة والكتابة عبر `readSetting` / `writeSetting` من `@agent-native/core/settings`. تستخدم حالة التطبيق (التنقل، والمسودات، والأوامر المفردة) `readAppState` / `writeAppState` من `@agent-native/core/application-state`.

**إضافة نوع إجراء أتمتة جديد.** توسيع مخطط الإجراء في `templates/mail/actions/manage-automations.ts` والمنفذ في `templates/mail/actions/trigger-automations.ts`.

**تغيير اختصارات لوحة المفاتيح.** توجد معالجات Keybind في `templates/mail/app/components/email/` — ابحث عن `useHotkeys` أو `addEventListener("keydown"` للعثور على مكان توصيل كل مفتاح.

اطلب من الوكيل إجراء أي من هذه التغييرات نيابةً عنك. يمكن للوكيل تعديل المصدر الخاص به — راجع [Self-Modifying Code](/docs/key-concepts#agent-modifies-code).
