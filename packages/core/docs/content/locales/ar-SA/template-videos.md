---
title: "فيديو"
description: "استديو فيديو برمجي للرسومات المتحركة والعروض التوضيحية للمنتجات والنص الحركي. قم بإنشاء رسوم متحركة من موجه وضبطها على مخطط زمني."
---

# فيديو

استوديو فيديو برمجي لنوع الرسومات المتحركة والعروض التوضيحية للمنتج ومقاطع الفيديو النصية الحركية التي تمثل صعوبة في استخدام الإطارات الرئيسية يدويًا. اطلب من الوكيل "إظهار شعار مدته 6 ثوانٍ يتلاشى خلال ثانيتين" وسيقوم بإنشاء الرسوم المتحركة. اضبط التوقيت والتخفيف وتحركات الكاميرا على مخطط زمني، ثم اعرضها على MP4 أو WebM.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:12px;padding:16px;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>إظهار الشعار</h1><span class='wf-pill accent'>6 seconds</span><div style='flex:1'></div><button>Preview</button><button class='primary'>Render</button></div><div class='wf-card' style='flex:1;display:flex;align-items:center;justify-content:center;min-height:250px'><div style='text-align:center'><strong>معاينة Remotion</strong><br/><small class='wf-muted'>logo scales in as the title fades</small></div></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><div style='display:flex;gap:8px;align-items:center'><span class='wf-pill'>0s</span><span class='wf-pill'>2s</span><span class='wf-pill'>4s</span><span class='wf-pill'>6s</span><div style='flex:1'></div><button>مسار جديد</button></div><div class='wf-box'>تلاشي العنوان · الإطارات 0-48</div><div class='wf-box'>تكبير الشعار · الإطارات 48-120</div><div class='wf-box'>دفع الكاميرا · الإطارات 72-144</div></div></div>"
}
```

عند فتح الاستوديو، سترى قائمة من المقطوعات الموسيقية على الشاشة الرئيسية. انقر فوق أحدها وستحصل على لاعب في الأعلى، ومخطط زمني في الأسفل، ولوحة خصائص على اليمين. يعرف الوكيل دائمًا التركيبة التي قمت بفتحها.

```an-diagram title="الرسوم المتحركة كبيانات" summary="التكوين هو مكون React؛ تتم قراءة كل رسم متحرك من المسار، لذا يقوم الوكيل والمخطط الزمني بتحرير نفس البيانات."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">Timeline<br><small class=\"diagram-muted\">سحب، تغيير حجم، تنقل زمني</small></div><div class=\"diagram-node\">Agent<br><small class=\"diagram-muted\">\"fade in at 2s\"</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">AnimationTrack</span><small class=\"diagram-muted\">startFrame / easing / animatedProps</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>تركيب React<br><small class=\"diagram-muted\">Remotion &lt;Player&gt;</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">MP4 / WebM</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## ما يمكنك فعله به

- **إنشاء رسوم متحركة من المطالبة.** "أضف بطاقة عنوان تتلاشى خلال ثانيتين وتستمر حتى 5." يقوم الوكيل بتحرير التركيبة.
- **ضبط التوقيت على مخطط زمني.** اسحب مسارات الرسوم المتحركة وقم بتغيير حجمها، وتصفح الإطارات، واضبط منحنيات التخفيف بشكل مرئي.
- **تحريك الكاميرا.** التحريك والتكبير/التصغير والإمالة باستخدام الأدوات التي تظهر على الشاشة. انقر على الأداة، واسحب للمعاينة، وسيتم إنشاء الإطار الرئيسي تلقائيًا.
- **ابدأ من تركيبة فارغة أو مثال.** يشحن القالب تركيبة واحدة في التعليمات البرمجية (`BlankComposition`) للبدء منها؛ يتم تحميل أمثلة التراكيب - النص الحركي، وكشف الشعار، ورشقات الجسيمات، وعروض UI التفاعلية، وعروض الشرائح - من قاعدة البيانات، ويمكنك إضافة ما تريده.
- **تعديل المنحنيات المخففة بصريًا.** تم شحن أكثر من 30 منحنيًا - الطاقة، والرجوع، والارتداد، والدائرة، والمرونة، والمعرض، والجيب، بالإضافة إلى فيزياء الربيع.
- **العرض إلى MP4 أو WebM** بمعدل 1x أو 2x أو 3x للحصول على نص واضح ومتجهات أثناء تكبير الكاميرا.

تعد هذه أداة خاصة بالمطورين أكثر من القوالب الأخرى - فالتركيبات عبارة عن مكونات React، لذا يمكن للمستخدمين المتميزين (أو الوكيل) كتابة أنواع رسوم متحركة جديدة بالكامل من البداية. لكن التعديلات اليومية ("جعل الكتابة أبطأ"، "خفض عدد الجسيمات إلى 12") هي مجرد دردشة.

## البدء

عرض توضيحي مباشر: [videos.agent-native.com](https://videos.agent-native.com).

عند فتح الاستوديو:

1. اختر مقطوعة موسيقية من الشاشة الرئيسية.
2. جرّب الوكيل: "أضف كشفًا للشعار يختفي خلال ثانيتين." شاهد تحديث الجدول الزمني.
3. اسحب المسارات لإعادة الوقت، وانقر على أداة الكاميرا، وقم بمسح المشغل.

### مطالبات مفيدة

- "أضف بطاقة عنوان تتلاشى خلال ثانيتين وتستمر حتى 5."
- "قم بتغيير الكاميرا لتكبير الشعار مرتين بين الإطارات 60 و90."
- "اجعل عملية الكشف عن الكتابة أبطأ - 40% أطول."
- "انفجار الجسيمات كثيف للغاية. قم بإسقاط العدد إلى 12."
- "قم بإنشاء تركيبة جديدة تسمى حلقة المقدمة، 1080x1080، 6 ثوانٍ."
- "أضف رسمًا متحركًا للنقر على منطقة الزر وقم بتحريك المؤشر إليه."
- "امنح هذا المسار تخفيفًا ربيعيًا بدلاً من التخفيف."

إذا قمت بتحديد مسار في المخطط الزمني وضغطت على Cmd+I، فسيلتقط الوكيل هذا التحديد - فقط "اجعل هذا المسار أكثر سرعة".

## للمطورين

باقي هذا المستند مخصص لأي شخص يقوم بتعديل قالب الفيديو أو توسيعه. يعد هذا القالب أكثر قابلية لإعادة توجيه التعليمات البرمجية من القوالب الأخرى — كل مقطوعة موسيقية عبارة عن مكون React وكل رسم متحرك عبارة عن بيانات على مسار.

### الهندسة المعمارية

كل ما تراه في الاستوديو هو رمز. التركيب هو `CompositionEntry` في `app/remotion/registry.ts` والذي يشير إلى مكون React في `app/remotion/compositions/`. تتم قراءة كل رسم متحرك في هذا المكون من `AnimationTrack` حتى يتمكن المستخدمون من سحبه وتغيير حجمه وإعادة توقيته في المخطط الزمني UI. يمكن للوكيل إنشاء مقطوعات موسيقية جديدة وإضافة مسارات وتخفيف الضبط وكتابة مكونات React بالكامل التي يتم توصيلها بالسجل.

يعمل الاستوديو على `<Player>` الخاص بـ Remotion للمعاينة وRemotion CLI للعرض النهائي. يكون الإخراج الافتراضي هو 1920 × 1080 بمعدل 30 إطارًا في الثانية.

### بداية سريعة

دعم تطبيق فيديو جديد من CLI:

```bash
npx @agent-native/core@latest create my-video-app --standalone --template videos
cd my-video-app
pnpm install
pnpm dev
```

افتح الاستوديو في متصفحك، وقم بإنشاء مقطوعة موسيقية، وابدأ من فارغ. اطلب من الوكيل شيئًا مثل "أضف شعارًا يظهر ويختفي خلال ثانيتين" وسيقوم بتحرير التركيبة نيابةً عنك.

### الميزات الرئيسية

**المقطوعات المستندة إلى React.** مقاطع الفيديو هي مكونات React مدعومة بالحركة، مع مؤلفات مستخدم مدعومة بـ SQL وسجل رمز اختياري للإعدادات الافتراضية المحلية.

**الرسوم المتحركة التي تعطي الأولوية للمخطط الزمني.** تعمل مسارات المدة والإطارات الرئيسية ومنحنيات التخفيف وحركات الكاميرا ومسارات التعبير الآلي على تحرير نفس بيانات التركيب.

**أنظمة الحركة القابلة للتعديل.** المعلمات، ومسارات المؤشر، ومناطق التمرير التفاعلية، والتنقل عبر النطاق، والتشغيل المتكرر تجعل الرسوم المتحركة التي تم إنشاؤها قابلة للضبط بدون تعليمات برمجية.

**العرض والثبات.** تستمر إعدادات التركيب والجودة وعدد الإطارات في الثانية وقيم المسار والتجاوزات لكل تركيبة ويتم عرضها على MP4 أو WebM من خلال Remotion.

### العمل مع الوكيل

يعرف الوكيل دائمًا التركيبة التي قمت بفتحها. تتم كتابة حالة التنقل (`{ view, compositionId }`) في جدول `application_state` الخاص بإطار العمل، ويقوم الإجراء `view-screen` بإرجاعها بالإضافة إلى تلميح يشير إلى `app/remotion/registry.ts`. ليس عليك أن تخبر الوكيل بالتركيبة التي تعمل عليها - اطلب منه التصرف بناءً على "هذه التركيبة" وسوف يفعل ذلك.

تحت الغطاء، يقوم الوكيل باستدعاء actions مثل `navigate`، و`save-composition`، و`generate-animated-component`. يتم إنشاء أو تحديث سجلات التكوين المدعومة SQL من خلال `save-composition`؛ لا تزال مكونات Remotion المدعومة بالكود موجودة في `app/remotion/compositions/*.tsx` ومسجلة في `app/remotion/registry.ts`.

### نموذج البيانات

مخطط جانب الخادم موجود في `templates/videos/server/db/schema.ts`:

```an-schema title="نموذج بيانات الفيديو" summary="SQL المؤلفات المدعومة بالإضافة إلى أنظمة التصميم والمجلدات المتداخلة، كل منها مزود بجدول مشاركات إطار العمل."
{
  "entities": [
    {
      "id": "compositions",
      "name": "compositions",
      "note": "User-created compositions and overrides; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "title", "type": "text" },
        { "name": "type", "type": "text" },
        { "name": "data", "type": "text", "note": "التركيبة الكاملة JSON blob" },
        { "name": "created_at", "type": "text" },
        { "name": "updated_at", "type": "text" }
      ]
    },
    {
      "id": "design_systems",
      "name": "design_systems",
      "note": "Reusable brand tokens; ownableColumns",
      "fields": [
        { "name": "data", "type": "text", "note": "colors / typography / spacing" },
        { "name": "assets", "type": "text", "nullable": true },
        { "name": "custom_instructions", "type": "text", "nullable": true },
        { "name": "is_default", "type": "boolean" }
      ]
    },
    {
      "id": "folders",
      "name": "folders",
      "note": "Nestable folders; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "name", "type": "text" }
      ]
    },
    {
      "id": "folder_memberships",
      "name": "folder_memberships",
      "note": "انضمام متعدد إلى متعدد",
      "fields": [
        { "name": "folder_id", "type": "text", "fk": "folders.id" },
        { "name": "composition_id", "type": "text", "fk": "compositions.id" }
      ]
    }
  ],
  "relations": [
    { "from": "folders", "to": "folder_memberships", "kind": "1-n", "label": "members" },
    { "from": "compositions", "to": "folder_memberships", "kind": "1-n", "label": "in folders" }
  ]
}
```

يحتوي كل جدول أيضًا على جدول مشاركات إطار عمل مطابق (`composition_shares`، `design_system_shares`، `folder_shares`) من إنتاج `createSharesTable()`.

- `compositions` — المعرف، العنوان، النوع، `data` (تكوين كامل JSON blob)، أعمدة الملكية، الطوابع الزمنية.
- `composition_shares` — منح الأسهم القياسية التي تنتجها `createSharesTable()`.
- `design_systems` — الرموز المميزة للعلامة التجارية القابلة لإعادة الاستخدام (الألوان، الطباعة، المسافات، الأصول، التعليمات المخصصة، علامة `is_default`) مع `ownableColumns`.
- `design_system_shares` — مشاركة المنح لأنظمة التصميم.
- `folders` — مجلدات متداخلة لتنظيم المكتبة، باستخدام `ownableColumns`.
- `folder_shares` — مشاركة المنح للمجلدات.
- `folder_memberships` — انضمام متعدد إلى متعدد بين `folder_id` و`composition_id`.

### المجلدات وأنظمة التصميم

يمكن تنظيم المقطوعات الموسيقية في مجلدات وتصميمها باستخدام أنظمة التصميم. Actions: `create-folder`، `rename-folder`، `delete-folder`، `move-composition-to-folder`. نظام التصميم actions: `create-design-system`، `update-design-system`، `get-design-system`، `list-design-systems`، `set-default-design-system`، `apply-design-system`، `analyze-brand-assets`. استيراد actions: `import-github`، `import-from-url`، `import-document` (DOCX/PPTX/PDF).

التسجيل في `app/remotion/registry.ts` هو مصدر الحقيقة الموجود في التعليمات البرمجية لما يأتي مع القالب. يقوم جدول SQL بتخزين التركيبات والتجاوزات التي أنشأها المستخدم. يتم عكس حالة الاستوديو (عمليات تحرير المسار لكل مقطوعة موسيقية، وتجاوزات الخصائص، وإعدادات التركيب) على `localStorage` ضمن `videos-tracks:<id>`، و`videos-props:<id>`، و`videos-comp-settings:<id>`، ويتم دمجها مرة أخرى في إعدادات التسجيل الافتراضية عند التحميل.

الأشكال الأساسية TypeScript (`app/types.ts`):

- `AnimationTrack` — `id`, `label`, `startFrame`, `endFrame`, `easing`, `animatedProps[]`.
- `AnimatedProp` — `property`، `from`، `to`، `unit`، بالإضافة إلى `keyframes` الاختيارية، `programmatic`، `description`، `codeSnippet`، `parameters`، `parameterValues`.
- `CompositionEntry` — `id`, `title`, `description`, `component`, `durationInFrames`, `fps`, `width`, `height`, `defaultProps`, `tracks`.

المقطوعات الموسيقية خاصة بشكل افتراضي. يمكن أن تكون الرؤية `private`، أو `org`، أو `public`، وتمنح منح المشاركة أدوار `viewer`، أو `editor`، أو `admin` - والتي يتم ربطها من خلال المشاركة البدائية لإطار العمل.

### تخصيصه

مجلد القالب هو `templates/videos/` (الحلقة الثابتة التي تواجه المستخدم هي `video`، ولكن المجلد بصيغة الجمع).

**Actions** — `templates/videos/actions/`

- `view-screen.ts` — إرجاع حالة التنقل الحالية للوكيل.
- `navigate.ts` — انتقل إلى مقطوعة موسيقية (`--compositionId <id>`) أو عرض الصفحة الرئيسية (`--view home`).
- `save-composition.ts` — إنشاء أو تحديث سجل مقطوعة موسيقية مدعومة بـ SQL.
- `generate-animated-component.ts` — قم بإنشاء ملف مكون Remotion جديد باستخدام النموذج المعياري.
- `validate-compositions.ts` — التحقق من جميع التركيبات المسجلة للتأكد من عدم وجود مشاكل هيكلية.
- `list-compositions.ts`، `get-composition.ts`، `update-composition.ts`، `delete-composition.ts` - قراءة وتحديث وحذف سجلات المقطوعات الموسيقية المدعومة بـ SQL.

**المسارات** — `templates/videos/app/routes/`

- `_index.tsx` - استوديو منزلي؛ يعرض الصدفة وقائمة التركيب.
- `c.$compositionId.tsx` — محرر التكوين (الخط الزمني، المشغل، لوحة الخصائص).
- `components.tsx` — متصفح مكتبة المكونات.
- `team.tsx` — إدارة الفريق.

**الأجزاء الداخلية للحركة** — `templates/videos/app/remotion/`

- `registry.ts` — قائمة التكوينات الرسمية.
- `compositions/` — `.tsx` واحد لكل تركيبة، بالإضافة إلى برميل `index.ts`.
- `trackAnimation.ts` — `trackProgress`, `getPropValue`, `findTrack`, `getPropValueKeyframed`.
- `CameraHost.tsx` — يغلف محتوى التركيب باستخدام تحويل الكاميرا.
- `hooks/`، `ui-components/`، `components/` — مساعدات العناصر التفاعلية، عرض المؤشر، أغلفة العناصر المتحركة.

**استوديو UI** — `templates/videos/app/components/`

- `Timeline.tsx` — الجدول الزمني الذي يتم التحكم فيه بالكامل (`viewStart` / `viewEnd` لا يمتلك أي حالة داخليًا).
- `VideoPlayer.tsx` — غلاف Remotion `<Player>` مع تشغيل مقيد النطاق.
- `TrackPropertiesPanel.tsx`، `CompSettingsEditor.tsx`، `PropsEditor.tsx` — اللوحات الموجودة على الجانب الأيمن.
- `CameraToolbar.tsx`، `CameraControls.tsx` — أدوات الكاميرا وعناصر التحكم الرقمية.

**تعليمات الوكيل** — `templates/videos/AGENTS.md` هو الدليل الطويل الذي يقرأه الوكيل. ويغطي قاعدة الرسوم المتحركة كمسار، ونظام الكاميرا، ونظام المؤشر، ووحدات تصفية CSS، وتسجيل المكونات التفاعلية، وتباعد UI، وقوائم المراجعة لإنشاء التركيبات أو تحريرها.

**Skills** — `templates/videos/.agents/skills/`

- `composition-management/SKILL.md` — كيفية إنشاء المقطوعات الموسيقية وتسجيلها.
- `animation-tracks/SKILL.md` — كيفية تعديل المسارات والدعائم المتحركة.
- بالإضافة إلى الإطار القياسي skills: `actions`، `self-modifying-code`، `delegate-to-agent`، `storing-data`، `security`، `frontend-design`، `create-skill`، `capture-learnings`.

لإضافة تركيبة جديدة، اتبع قائمة التحقق في `AGENTS.md`: أنشئ المكون، وأعلن `FALLBACK_TRACKS`، واستخدم `findTrack` / `trackProgress` / `getPropValue` (لا تستخدم الإطارات ذات التعليمات البرمجية مطلقًا)، وقم بالتصدير من `compositions/index.ts`، وأضف `CompositionEntry` إلى السجل، وقم بتشغيل `pnpm typecheck`.
