---
title: "مفاتيح الإعداد وAPI"
description: "قائمة التحقق من الإعداد للتهيئة التي يتم تشغيلها لأول مرة — مفاتيح API، وOAuth، واتصالات الموفر"
---

# التأهيل

عندما تفتح تطبيقًا مبنيًا على إطار عمل الوكيل الأصلي لأول مرة، سترى
**قائمة اختيار الإعداد** في الشريط الجانبي للوكيل. إنه يحافظ على إغلاق التكوين الذي يتم تشغيله لأول مرة
إلى دردشة الوكيل: قم بتوصيل محرك الذكاء الاصطناعي، واختياريًا قم بتوجيه التطبيق إلى مشترك
البنية الأساسية، وأضف مقدمي الخدمة فقط عندما تحتاج إليهم.

```an-diagram title="قائمة التحقق من الإعداد" summary="مطلوب فقط توصيل محرك AI. تقوم اللوحة بتتبع الإكمال والإخفاء التلقائي بمجرد الانتهاء من كل ما هو مطلوب."
{
  "html": "<div class=\"ob\"><div class=\"diagram-card\"><span class=\"diagram-pill warn\">required</span><strong>وصل محرك AI</strong><small class=\"diagram-muted\">Connect Builder (one click) or paste an LLM key</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">optional</span><strong>Database</strong><small class=\"diagram-muted\">set <code>DATABASE_URL</code></small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">optional</span><strong>Authentication</strong><small class=\"diagram-muted\">OAuth / access token</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">optional</span><strong>تسليم البريد الإلكتروني</strong><small class=\"diagram-muted\">Resend / SendGrid</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box ok\">all required done &rarr; panel auto-hides</div></div>",
  "css": ".ob{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.ob .diagram-card{display:flex;flex-direction:column;gap:3px;padding:12px 14px}.ob .diagram-arrow{font-size:22px}"
}
```

## للمستخدمين النهائيين

### ما ستراه

- لوحة **إعداد** أعلى دردشة الوكيل مع قائمة تحقق مثل "Connect an AI"
  المحرك"، "تسليم البريد الإلكتروني"، وما إلى ذلك.
- يوضح العداد الموجود في الأعلى (على سبيل المثال، "1 من 4") عدد الخطوات الجاهزة.
- تم توسيع الخطوة الحالية؛ تظهر الخطوات النهائية علامة الاختيار الخضراء والبقاء
  يمكن قراءتها إذا قمت بفتحها.
- تظهر الخطوات المطلوبة حبة حمراء صغيرة **مطلوبة**. تظل اللوحة مرئية
  حتى اكتمال كل الخطوات المطلوبة.
- بمجرد الانتهاء من كل ما هو مطلوب، تخفي اللوحة نفسها تلقائيًا.
- يمكن طي اللوحة بأكملها بحيث تكون الشيفرون في أعلى اليمين، أو
  مخفي بالكامل مع **إخفاء الإعداد** في الأسفل.

### كيفية إكمال كل خطوة

تقدم الخطوات واحدة أو أكثر من **الطرق** — طرق مختلفة لتحقيق نفس الهدف
المتطلبات. يظهر المسار الأساسي أولاً؛ يتم الاحتفاظ بالمسارات الثانوية مضغوطة
خلف المنتقي أو الكشف عندما تحتوي الخطوة على عدة موفري خدمات مكافئين.

- **الاتصال بخدمة (نقرة واحدة)** — على سبيل المثال. _قم بتوصيل Builder_ بالجهاز المُدار
  بوابة الذكاء الاصطناعي. انقر فوق الزر، وستفتح نافذة، وقم بتسجيل الدخول، وتغلق النافذة،
  وتم وضع علامة اكتمال على الخطوة. لا توجد مفاتيح للنسخ.
- **الصق مفتاح API أو املأ نموذجًا** — على سبيل المثال اختر موفر LLM وقاعدة البيانات
  موفر OAuth، أو موفر البريد الإلكتروني، الصق القيمة (القيم)، وانقر على **حفظ**.
  تستخدم الحقول السرية إدخال كلمة المرور، لذا لا تظهر القيمة على الشاشة. تم الحفظ
  تنتقل القيم إلى `.env` المحلي (أو إعدادات مساحة العمل) - راجع
  [Security](/docs/security) للمكان الذي يعيشون فيه.
- **فتح رابط** — تشير بعض الخطوات إلى صفحة تسجيل الدخول أو المستندات. انقر
  **تابع** وأكمل التدفق في علامة التبويب الجديدة.
- **اسأل الوكيل** — توفر بضع خطوات خيار "السماح للوكيل بإعداده".
  انقر عليه وسيقوم الوكيل بالرد عليك في الدردشة، ويرشدك خلال أي منها
  الإعداد الخارجي (إنشاء بيانات اعتماد OAuth، وما إلى ذلك).

### الخطوات المضمنة التي ستراها عادةً

- **توصيل محرك الذكاء الاصطناعي** (مطلوب) — الخطوة الإلزامية الوحيدة. الاتصال
  Builder لبوابة مُدارة بنقرة واحدة، أو افتح مفتاح الموفر الثانوي
  منتقي ولصق مفتاح LLM الخاص بك.
- **قاعدة البيانات** (اختياري) — قم بتعيين `DATABASE_URL` عندما تريد استخدام محدد
  سلسلة اتصال قاعدة البيانات SQL.
- **المصادقة** (اختياري) — تعمل حسابات البريد الإلكتروني/كلمة المرور المضمنة بواسطة
  افتراضي. قم بإضافة OAuth أو تسجيل الدخول برمز الوصول فقط عندما تريد هذه المسارات.
- **تسليم البريد الإلكتروني** (اختياري) — مفيد قبل النشر لإعادة تعيين كلمة المرور،
  دعوات الفريق وإشعارات المشاركة. استخدم الموفر الذي تستخدمه بالفعل؛
  يمكن تحقيق التنمية المحلية بدونها.

يمكن للقوالب إضافة خطواتها الخاصة فوق هذه الخطوات - على سبيل المثال. قد يكون قالب CRM
أضف "Connect Gmail"، وقد يضيف قالب المستندات "اختر مساحة عمل افتراضية". انظر
[Authentication](/docs/authentication) للحصول على تفاصيل إعداد تسجيل الدخول.

### الرجوع إلى قائمة التحقق

إذا قمت بالضغط على **إخفاء الإعداد**، فستختفي اللوحة في جلسة المتصفح تلك.
ستظهر الخطوات المطلوبة التي لم تكتمل بعد مرة أخرى عند التحميل التالي. مرة واحدة
تم تنفيذ كل ما هو مطلوب، ويتم إخفاء اللوحة تلقائيًا نهائيًا - ولا يوجد شيء
ما بقي للقيام به.

## للمطورين

إذا كنت تقوم بإنشاء نموذج، فعليك تسجيل خطوات الإعداد حتى تظهر في
قائمة التحقق من الشريط الجانبي للمستخدم. يعالج الإطار العرض والإكمال
التتبع والفصل - ما عليك سوى الإعلان عن الخطوة وكيف تتم
راضي.

النظام **مثبت تلقائيًا**. لا تحتاج القوالب إلى توصيل أي شيء للحصول عليها
الخطوات الأربع المضمنة (LLM، قاعدة البيانات، المصادقة، البريد الإلكتروني). لإضافة تطبيق محدد
الخطوات (Gmail، Slack، Notion، وما إلى ذلك)، اتصل بـ `registerOnboardingStep()` من
المكون الإضافي للخادم.

### المسارات المثبتة تلقائيًا

جميع المسارات موجودة ضمن `/_agent-native/onboarding/`:

| المسار                                              | الغرض                               |
| --------------------------------------------------- | ----------------------------------- |
| `GET /_agent-native/onboarding/steps`               | أدرج الخطوات مع حالة الإكمال        |
| `POST /_agent-native/onboarding/steps/:id/complete` | وضع علامة على الخطوة مكتملة (تجاوز) |
| `POST /_agent-native/onboarding/dismiss`            | رفض شعار الإعداد                    |
| `POST /_agent-native/onboarding/reopen`             | مسح الرفض (إعادة إظهار اللوحة)      |
| `GET /_agent-native/onboarding/dismissed`           | قراءة الفصل + العلامة الكاملة       |

```an-api title="قم بإدراج خطوات الإعداد"
{
  "method": "GET",
  "path": "/_agent-native/onboarding/steps",
  "summary": "قم بإدراج جميع الخطوات المسجلة مع حالة اكتمالها",
  "description": "Drives the sidebar checklist — returns each step's id, title, methods, required flag, and whether `isComplete` currently passes.",
  "responses": [
    { "status": "200", "description": "Array of steps with completion status for the current user/app." }
  ]
}
```

### إضافة خطوة من القالب

```an-annotated-code title="تسجيل خطوة تأهيل مخصصة"
{
  "filename": "server/plugins/my-onboarding.ts",
  "language": "ts",
  "code": "import { defineNitroPlugin } from \"@agent-native/core/server\";\nimport { registerOnboardingStep } from \"@agent-native/core/onboarding\";\nimport { listOAuthAccounts } from \"@agent-native/core/oauth-tokens\";\n\nexport default defineNitroPlugin(() => {\n  registerOnboardingStep({\n    id: \"gmail\",\n    order: 100,\n    title: \"Connect Gmail\",\n    description: \"Grant read/send access so the agent can work with email.\",\n    methods: [\n      {\n        id: \"oauth\",\n        kind: \"link\",\n        primary: true,\n        label: \"Sign in with Google\",\n        payload: { url: \"/_agent-native/google/auth-url?scope=mail\", external: false },\n      },\n      {\n        id: \"delegate\",\n        kind: \"agent-task\",\n        label: \"Let the agent set it up\",\n        badge: \"beta\",\n        payload: { prompt: \"Walk me through connecting Gmail. Set env vars as needed.\" },\n      },\n    ],\n    isComplete: async () => {\n      const accounts = await listOAuthAccounts(\"google\");\n      return accounts.length > 0;\n    },\n  });\n});",
  "annotations": [
    { "lines": "5", "label": "مثبتة تلقائيًا", "note": "قم بالتسجيل من مكون إضافي Nitro - يعالج إطار العمل العرض وتتبع الإكمال والفصل." },
    { "lines": "7", "label": "معرف المكدس", "note": "إعادة التسجيل بنفس `id` بعد تحميل الإعدادات الافتراضية يتجاوز خطوة مضمنة." },
    { "lines": "12-19", "label": "الطريقة الأساسية", "note": "`primary: true` marks the big CTA. `kind: \"link\"` sends the user into the OAuth flow." },
    { "lines": "20-26", "label": "مسار التفويض", "note": "`kind: \"agent-task\"` hands the setup to the agent chat with a prompt." },
    { "lines": "28-31", "label": "التحقق من الإكمال", "note": "`isComplete` يعمل من جانب الخادم. رموز OAuth موجودة في متجر `oauth_tokens` - تحقق منها، وليس `process.env.GMAIL_REFRESH_TOKEN`." }
  ]
}
```

### التحقق من اتصالات مساحة العمل أثناء الإعداد

عند إنشاء قوالب تتفاعل مع الخدمات الخارجية (مثل Slack أو Google Workspace أو GitHub أو HubSpot)، يجب عليك التحقق مما إذا كانت مساحة العمل متصلة بالفعل ومنحت اتصال الموفر هذا بتطبيقك. وهذا يمنع المستخدمين من الاضطرار إلى تكرار بيانات الاعتماد (مثل مفاتيح API أو الرموز المميزة للتحديث) في متغيرات البيئة المحلية الخاصة بهم عند وجود اتصال مركزي مُدار.

يمكنك التحقق من جاهزية الاتصال في رد الاتصال `isComplete` باستخدام كتالوج الاتصال APIs:

```ts
import { listWorkspaceConnectionProviderCatalogForApp } from "@agent-native/core/workspace-connections";

// Inside registerOnboardingStep:
isComplete: async () => {
  // Check if a managed workspace connection exists and is ready
  const catalog = await listWorkspaceConnectionProviderCatalogForApp({
    appId: "mail",
    templateUse: "mail",
    provider: "gmail",
  });
  const connection = catalog.providers[0];

  if (
    connection?.readiness.status === "ready" &&
    connection.workspaceConnection.grantState === "granted"
  ) {
    return true;
  }

  // Fall back to local environment variable check
  return !!process.env.GMAIL_REFRESH_TOKEN;
};
```

راجع وثائق [Workspace Connections](/docs/workspace-connections) للحصول على القائمة الكاملة لطرق كتالوج موفر الاتصال.

### أنواع الطرق

| النوع              | الحمولة                                               | يستخدم لـ                                        |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------ |
| `link`             | `{ url, external? }`                                  | أرسل المستخدم إلى صفحة التدفق أو المستندات OAuth |
| `form`             | `{ fields, writeScope? }`                             | اجمع env vars (المفاتيح، الأسرار، URLs)          |
| `builder-cli-auth` | `{ scope: "llm" \| "browser" \| "image-generation" }` | Connect Builder (unlocks shared infra)           |
| `agent-task`       | `{ prompt }`                                          | أرسل مطالبة إلى دردشة الوكيل للتعامل معها        |

تشير علامة `primary: true` إلى الطريقة باعتبارها CTA الكبيرة لخطوتها.
استخدم `badge: "soon"` بالإضافة إلى `disabled: true` عندما يكون مسار الإعداد مرئيًا
قبل أن يصبح متاحًا.

### الخطوات المضمنة

| المعرف     | مطلوب | الوصف                                                      |
| ---------- | ----- | ---------------------------------------------------------- |
| `llm`      | نعم   | اتصال Builder أو مفتاح LLM للموفر                          |
| `database` | لا    | قاعدة البيانات الافتراضية أو أي SQL `DATABASE_URL`         |
| `auth`     | لا    | حسابات مدمجة، OAuth اختياري أو رمز وصول                    |
| `email`    | لا    | إعادة إرسال أو SendGrid للبريد الإلكتروني الخاص بالمعاملات |

يمكن تجاوز أي من هذه العناصر عن طريق إعادة التسجيل بنفس `id` بعد
التحميل الافتراضي.

### استخدام العميل

اللوحة موجودة بالفعل داخل `<AgentPanel>`. لإنشاء تخطيط مخصص:

```tsx
import {
  OnboardingPanel,
  OnboardingBanner,
  useOnboarding,
} from "@agent-native/core/client/onboarding";

function MySidebar() {
  const { allComplete, dismissed, currentStepId } = useOnboarding();
  if (allComplete || dismissed) return <Chat />;
  return (
    <>
      <OnboardingPanel />
      <Chat />
    </>
  );
}
```

للحصول على معلومات أساسية عن مكان تخزين قيم الخطوات وكيفية التعامل مع الأسرار،
راجع [Security](/docs/security). بالنسبة لنقاط اتصال مراسلة المستخدم النهائي (الدعوات،
إعادة تعيين كلمة المرور) التي تعتمد على خطوة **تسليم البريد الإلكتروني**، راجع
[Messaging](/docs/messaging).
