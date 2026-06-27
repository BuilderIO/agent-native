---
title: "المكون الإضافي للخطة والسوق"
description: "قم بتثبيت خطة Agent-Native skills (/visual-plan، /visual-recap) بالإضافة إلى موصل Plan MCP المستضاف كرمز Claude أو مكون إضافي Codex، أو باستخدام CLI العام. كيفية عمل التحديثات وما إذا كنت بحاجة إلى إرسال أي شيء."
---

# المكون الإضافي للخطة والسوق

يأتي تطبيق Agent-Native **Plan** كحزمة واحدة قابلة للتثبيت. يؤدي التثبيت الفردي إلى إضافة أمر الشرطة المائلة للخطة skills ** و** إلى موصل Plan MCP المستضاف، حتى يتمكن الوكيل من إنشاء الخطط ويمكن لـ skills نشرها مباشرة في تطبيق الخطة.

## ما تحصل عليه {#what-you-get}

تمنحك عملية التثبيت الواحدة ما يلي:

- **اثنان skills** — `/visual-plan` (نقطة الدخول الأساسية) و`/visual-recap`.
- **موصل Plan MCP** — مسجل في التطبيق المستضاف على `https://plan.agent-native.com` (نقطة نهاية MCP `https://plan.agent-native.com/_agent-native/mcp`، اسم الخادم `plan`).

```an-diagram title="ثلاث طرق، حزمة واحدة" summary="يقوم كل من المكون الإضافي CLI، وClaude Code، والمكون الإضافي Codex بتثبيت نفس المهارتين بالإضافة إلى موصل الخطة المستضاف."
{
  "html": "<div class=\"diagram-routes\"><div class=\"diagram-col\"><div class=\"diagram-node\">Universal CLI<br><small class=\"diagram-muted\">skills add visual-plan</small></div><div class=\"diagram-node\">إضافة Claude Code<br><small class=\"diagram-muted\">/plugin install</small></div><div class=\"diagram-node\">إضافة Codex<br><small class=\"diagram-muted\">codex plugin add</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">/visual-plan</span><span class=\"diagram-pill accent\">/visual-recap</span><small class=\"diagram-muted\">two skills</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Plan MCP connector<br><small class=\"diagram-muted\">plan.agent-native.com/_agent-native/mcp</small></div></div>",
  "css": ".diagram-routes{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-routes .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-routes .diagram-arrow{font-size:22px;line-height:1}.diagram-routes .center{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}.diagram-routes .center .diagram-pill{margin:2px}"
}
```

افتراضيًا، يقوم كل من skills بالنشر على تطبيق الخطة المستضاف - حيث يقومان بإنشاء خطة عبر
موصل MCP ويسلمك رابطًا أو خطة مضمنة للمراجعة. إنهم لا يتخلصون أبدًا
خطة Markdown/ASCII المضمنة في الدردشة باعتبارها التسليم. إذا كانت أداة الخطة
إرجاع `needs auth`، أو `Unauthorized`، أو `Session terminated`، وإعادة المصادقة
الموصل بدلاً من الرجوع إلى الإخراج المضمن. رموز الوصول هي
طويلة الأمد (افتراضي لمدة 30 يومًا، وتحديث متدرج لمدة 365 يومًا)، لذلك يجب أن يكون هذا نادرًا؛
عندما يحدث ذلك، يكون الإصلاح الخفيف هو:

```bash
npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex
```

يقوم `reconnect` بالبحث عن الموصل وتحديثه بواسطة URL للموضع المحلي المحدد
العميل — لا حاجة إلى إعادة التثبيت. ابدأ سلسلة Codex جديدة بعد إعادة الاتصال لذلك
يتم إعادة تحميل سجل الأداة. في رمز Claude، المعادل هو `/mcp` →
**المصادقة / إعادة الاتصال**، أو نفس الأمر مع `--client claude-code`.

الاستثناء صريح **وضع خصوصية الملفات المحلية**. عندما لا تطلب قاعدة بيانات
يكتب `AGENT_NATIVE_PLANS_MODE=local-files` أو يضبطه، ويجب ألا يتصل skills
موصل الخطة MCP. يكتبون `plans/<slug>/plan.mdx` بالإضافة إلى اختياري
`canvas.mdx`، و`prototype.mdx`، و`.plan-state.json`، ثم قم بالمعاينة محليًا باستخدام:

```bash
npx @agent-native/core@latest plan local serve --dir plans/<slug> --kind plan --open
```

يؤدي هذا إلى بدء جسر مضيف محلي صغير وفتح الخطة UI مقابل المضيف المحلي
المجلد. (يدير `plan local preview` مسارًا محليًا لخادم تطوير الخطة بدلاً من ذلك، و
`plan local preview --out preview.html` عبارة عن فتحة هروب قديمة تكتب
ملف HTML ثابت مستقل. يتم قبول `plan serve` كاسم مستعار قصير لـ
`plan local serve`.)

بعض الأخطاء التي تستحق المعرفة في وضع الملفات المحلية:

- **استخدم متصفح Chromium.** يحظر Safari صفحة خطة HTTPS المستضافة من
  قراءة جسر المضيف المحلي `http://127.0.0.1` (محتوى مختلط / خاص
  الشبكة)، لذلك تظل الصفحة معلقة في "تحميل الخطة". على نظام التشغيل macOS `--open` بالفعل
  يفضل Chrome/Chromium/Edge/Brave؛ إذا تم فتح Safari على أية حال، فأعد فتح الملف المطبوع
  URL في متصفح Chromium.
- **تم كتابة URL المقدم إلى `plans/<slug>/.plan-url`** (تجاوز بـ
  `--url-file`). يمكن للوكيل ذو الخلفية أو بدون رأس قراءة هذا الملف بدلاً من
  إلغاء stdout `serve` طويل الأمد. تعامل معه كملف رمزي محلي و
  لا ترتكبها.
- **التحقق بدون مراقبة** في حالة عدم توفر متصفح:
  يبدأ `npx @agent-native/core@latest plan local verify --dir plans/<slug>`
  الجسر، يتحقق من الاختبار المبدئي للشبكة الخاصة وحمولة JSON، ويطبع
  التشخيص، والخروج من الصفر عند الفشل - لا حاجة إلى عيون بشرية.
- **قم بتشغيل `plan local check` أولاً.** فهو يتحقق من صحة MDX مقابل الخطة
  مخطط كتلة العارض (بما في ذلك الحقول المطلوبة مثل عنصر `checklist`
  سؤال `id`/`label` و`question-form` `id`/`title`/`mode`)، إذن التأليف
  تظهر الأخطاء قبل تسليم المتصفح بدلاً من أن تكون أداة التحميل متوقفة.

بالنسبة للمجلدات الموجودة في الريبو الحالي، يتضمن المسار المحلي المباشر `?path=...` لذلك
يمكن لتطبيق Plan المحلي الاحتفاظ بتحريرات المتصفح محفوظة في مجلد الريبو. الخطة
يستخدم التطبيق `apps.plan.roots[0].path` في `agent-native.json` كمكان افتراضي
لحفظ الخطط المحلية التي تم الترويج لها، والرجوع إلى `plans/`.

يؤدي هذا إلى إبقاء محتوى الخطة خارج قاعدة بيانات خطة Agent-Native. المشاركة المستضافة،
لن تكون التعليقات ولقطات الشاشة وسجل الخطة متاحة إلا إذا قمت بذلك صراحةً
النشر لاحقًا.

```an-diagram title="وضع الملفات المستضافة مقابل وضع الملفات المحلية" summary="بشكل افتراضي، يتم نشر المهارات من خلال الموصل؛ يقوم وضع الملفات المحلية بكتابة MDX على القرص ومعاينته عبر جسر مضيف محلي بدلاً من ذلك."
{
  "html": "<div class=\"diagram-modes\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">افتراضي · مستضاف</span><strong>النشر إلى تطبيق Plan</strong><small class=\"diagram-muted\">MCP connector &rarr; hosted DB &rarr; share links, comments, history, screenshots</small></div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">خصوصية الملفات المحلية</span><strong>اكتب MDX إلى القرص</strong><small class=\"diagram-muted\">plan.mdx + canvas.mdx + prototype.mdx &rarr; localhost bridge &rarr; hosted Plan UI reads local source. No كتابة في قاعدة البياناتs until <code>publish-visual-plan</code>.</small></div></div>",
  "css": ".diagram-modes{display:flex;gap:14px;flex-wrap:wrap}.diagram-modes .diagram-card{flex:1 1 260px;display:flex;flex-direction:column;gap:6px;padding:16px 18px}"
}
```

يحتوي Agent Native Desktop على مسار مزامنة ملف محلي منفصل للخطط المستضافة:
يمكن لتطبيق سطح المكتب عكس خطة مستضافة لملفات MDX المحلية واستيراد التعديلات مرة أخرى
بدون استنساخ تطبيق الخطة أو تشغيل CLI. يحافظ سير العمل هذا على الاستضافة
تخطيط قاعدة البيانات كمصدر للحقيقة؛ استخدم وضع خصوصية الملفات المحلية عند الهدف
لا تتم كتابة خطة قاعدة بيانات.

> يحمل المكون الإضافي (`agent-native-visual-plans`) معرف التطبيق `visual-plans`، ولهذا السبب فإن اسم المكون الإضافي Claude Code واسم المكون الإضافي Codex كلاهما `agent-native-visual-plans`. اسم العرض لتطبيق الخطة هو "Agent-Native Plan".

## تثبيت المسارات {#install}

هناك ثلاث طرق. **مسار CLI العالمي** هو الذي نوصي به افتراضيًا، لأنه يقوم بتثبيت skills **و** الذي يتيح لك اختيار الوضع المستضاف أو الملفات المحلية أو الاستضافة الذاتية في تدفق واحد. مسارات المكونات الإضافية مخصصة للمضيفين الذين لديهم نظام مكون إضافي/سوق من الدرجة الأولى ويستخدمون الخطط المستضافة بشكل افتراضي.

### مسار المهارة العالمي (أي مضيف MCP) {#universal}

يعمل مع أي مضيف - Claude Code، وCodex، وCursor، وCline، وGoose، وتطبيقات ChatGPT المخصصة MCP، وClaude Cowork، وأي شيء آخر متوافق مع MCP. يقوم Agent-Native CLI بتثبيت كل من skills، وتسجيل موصل الخطة المستضافة MCP، ** وتشغيل المصادقة للعميل (العملاء) المحليين المحددين في نفس الخطوة **، بحيث لا يصل استدعاء الأداة الأول إلى جدار OAuth:

```bash
npx @agent-native/core@latest skills add visual-plan
```

يؤدي هذا إلى تثبيت `visual-plan` بالإضافة إلى مهارة `visual-recap` المصاحبة، ثم تسجيل موصل `plan`، ثم تشغيل المصادقة (مطالبة OAuth بالمشاركة المستضافة/المدعومة بالحساب). إشارات مفيدة:

- `--client codex|claude-code|claude-code-cli|cowork|all` — أي الوكلاء المحليين سيكتبون تهيئة MCP لهم (`all` الافتراضي).
- `--no-connect` - تسجيل الموصل دون المصادقة؛ قم بتشغيل `npx @agent-native/core@latest connect https://plan.agent-native.com --client all` لاحقًا، أو اختر `--client` الأضيق.
- `--mode hosted|local-files|self-hosted` - اختر المشاركة المستضافة، أو ملفات MDX المحلية بالكامل، أو تطبيق الخطة الخاص بك.
- `--mcp-url <url>` — قم بتوجيه الموصل إلى أصل مخصص (نفق ngrok، أو خادم تطوير محلي، أو نشر مستضاف ذاتيًا) بدلاً من المصدر الافتراضي المستضاف.
- `--with-github-action` - اكتب أيضًا إجراء PR Visual Recap GitHub (راجع [PR Visual Recap](/docs/pr-visual-recap)).

تقدم عمليات التثبيت التفاعلية أيضًا إجراء PR Visual Recap عندما لا يكون هناك سير عمل
حاضر. قل نعم لإضافتها أثناء إعداد المهارة، أو قم بتشغيل الأمر أعلاه لاحقًا
مع `--with-github-action`. بعد كتابة سير العمل، قم بتشغيل:

```bash
npx @agent-native/core@latest recap setup
npx @agent-native/core@latest recap doctor
```

يقوم `recap setup` بتكوين أسرار إجراء GitHub ومتغيراته حيثما أمكن ذلك،
ويتحقق `recap doctor` من سير العمل، ورمز النشر المحلي، وGitHub repo
الوصول، وتكوين Actions المطلوب. بعد انتهاء التثبيت، أعد التشغيل أو
أعد تحميل العميل الوكيل حتى يتم تحميل skills الجديد والأدوات، ثم قم بتشغيله
`/visual-plan`.

> ملاحظة: يقوم `npx skills@latest add BuilderIO/agent-native --skill visual-plan` (Vercel/open Skills CLI) بتثبيت **التعليمات فقط** - ولا يسجل موصل MCP. استخدم Agent-Native CLI أعلاه عندما تريد توصيل الموصل أيضًا.

### رمز Claude (مكون إضافي) {#claude-code}

إن مستودع `BuilderIO/agent-native` العام هو في حد ذاته سوق للمكونات الإضافية لـ Claude Code، لذا يمكنك إضافته مباشرة - دون الحاجة إلى خطوة إنشاء. داخل رمز Claude:

```text
/plugin marketplace add BuilderIO/agent-native
/plugin install agent-native-visual-plans@agent-native-apps
/reload-plugins
/mcp        # authenticate the Plan connector (one OAuth approval)
```

يضيف `/plugin install` كلاً من الخطة skills وتكوين **URL فقط** MCP (لا توجد أسرار في الحزمة)؛ `/mcp` → **المصادقة** تكمل مصافحة OAuth. استخدم المسار CLI العالمي بدلاً من ذلك عندما تريد ملفات محلية أو وضع الاستضافة الذاتية.

> يُسمى كتالوج السوق `agent-native-apps` والمكون الإضافي للخطة هو `agent-native-visual-plans`، لذا يكون هدف التثبيت دائمًا هو `agent-native-visual-plans@agent-native-apps`.

### Codex (مكون إضافي) {#codex}

نفس الريبو هو سوق المكونات الإضافية Codex. قم بإضافته، وتثبيت المكون الإضافي، ثم قم بمصادقة الموصل:

```bash
codex plugin marketplace add BuilderIO/agent-native
codex plugin add agent-native-visual-plans@agent-native-apps
codex mcp login plan   # OAuth في المتصفح
```

بعد التثبيت، **ابدأ سلسلة Codex جديدة** حتى يتم تحميل الأدوات skills وMCP في الجلسة. يشحن البرنامج المساعد موصل URL فقط (`[mcp_servers.plan]` → `https://plan.agent-native.com/_agent-native/mcp`)؛ يقوم `codex mcp login plan` بتشغيل التدفق OAuth. يعمل مسار CLI العالمي أعلاه أيضًا مع Codex (`npx @agent-native/core@latest skills add visual-plan --client codex`) إذا كنت تفضل أمرًا واحدًا يتم تثبيته والمصادقة عليه معًا، أو عندما تريد الملفات المحلية أو وضع الاستضافة الذاتية.

> **عمليات التثبيت الأقدم:** إذا كان التكوين الخاص بك لا يزال يحتوي على إدخال `agent-native-plans` يشير إلى نفس URL، أو تشغيل `npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex` لـ Codex، أو نفس الأمر مع هدفك `--client`، فسيتم دمجه في اسم `plan` المتعارف عليه.

## التحديثات {#updates}

يقوم البرنامج الإضافي بتوجيه التحديث التلقائي - لا يمكنك إعادة تعبئة السوق أو إعادة إضافته لتغييرات روتينية في المهارات:

- **Claude Code** — يقوم إدخال السوق بتعيين `autoUpdate: true` ويستخدم المكون الإضافي إصدار الالتزام-SHA، لذلك يسحب كود Claude الإصدارات الجديدة من الريبو عند بدء التشغيل؛ قم بتشغيل `/reload-plugins` للتنشيط. كل دفعة إلى فرع الريبو الافتراضي تصل إلى المستخدمين المثبتين تلقائيًا.
- **Codex** — يقوم المكون الإضافي `version` بتضمين تجزئة محتوى لنقطة النهاية skills وMCP المجمعة (على سبيل المثال، `1.0.0+codex.<hash>`)، لذا فإن أي تغيير في المهارة أو نقطة النهاية يؤدي إلى إصدار جديد. تعمل الترقية التلقائية لبدء التشغيل Codex على إعادة تثبيت أسواق git التي تم تكوينها من تلقاء نفسها؛ ما عليك سوى **بدء موضوع جديد** لمتابعة التغيير. ليست هناك حاجة إلى دليل `codex plugin marketplace upgrade` للتحديثات الروتينية.
- **مسار CLI العالمي** — قم بتشغيل `npx @agent-native/core@latest skills status visual-plan` للتحقق من مجلدات المهارات المنسوخة، أو `npx @agent-native/core@latest skills update visual-plan` لتحديثها في مكانها. لا تزال إعادة تشغيل `skills add visual-plan` تعمل عندما تريد أيضًا إعادة تسجيل/مصادقة الموصل. يقوم `@latest` دائمًا بسحب skills الحالي من حزمة `@agent-native/core` المنشورة.

يشير الموصل إلى تطبيق **مستضاف**، وبالتالي فإن actions لتطبيق Plan وسطح الأداة المباشرة يعكسان دائمًا الإصدار المنشور بغض النظر عن وقت تثبيتك؛ فقط تعليمات المهارات المجمعة تتبع آليات التحديث المذكورة أعلاه.

> **المشرفون:** يتم إنشاء حزمة السوق (`.claude-plugin/`، `.agents/plugins/`) من الخطة الأساسية skills بواسطة `pnpm sync:plan-marketplace` وتم التحقق منها في CI بواسطة `pnpm guard:plan-marketplace`، وبالتالي فإن السوق المنشورة تتطابق دائمًا مع الخطة الأساسية skills. قم بتحرير المهارة، وتشغيل `pnpm sync:plan-marketplace`، والالتزام.

## هل تحتاج إلى إرسال أي شيء؟ {#submission}

**لا يلزم تقديم أو مراجعة لتوزيع هذا أو تثبيته.** `BuilderIO/agent-native` هو سوق git عام مستضاف ذاتيًا، لذلك يضيفه المستخدمون مباشرة باستخدام الأوامر المذكورة أعلاه على **كل من Claude Code وCodex** — بدون طلب أو موافقة. لا يحتاج مسار CLI العالمي إلى سوق على الإطلاق.

قابلية الاكتشاف الاختيارية، إذا كنت تريد قائمة عامة:

- **Claude Code** على سوق مجتمعي يمكنك _اختياريًا_ الإرسال إليه للإدراج (الإرسال بالإضافة إلى المراجعة التلقائية). يتم إدراج السوق الرسمي المنسق من قبل Anthropic وفقًا لتقدير Anthropic - ولا يوجد تطبيق مفتوح للخدمة الذاتية. ولا يلزم استخدام أي منهما لأوامر التثبيت المذكورة أعلاه.
- **Codex** يحتوي على كتالوج المكونات الإضافية المنسق بواسطة OpenAI (قائمة السماح مغلقة، مصدرها شراكة وليس تقديم خدمة ذاتية). لا تحتاج أسواق git المستضافة ذاتيًا ومسار CLI إلى إرسال للعمل.

باختصار: قم بشحنه كسوق git مستضاف ذاتيًا/عامًا ويقوم المستخدمون بتثبيته مباشرةً؛ أرسل إلى كتالوج منسق فقط إذا كنت تريد إدراجه للاكتشاف.

## المكون الإضافي مقابل المهارة {#plugin-vs-skill}

**المهارة** هي ملف تعليمات `SKILL.md` واحد يقرأه الوكيل عند تطابق المهمة. **المكون الإضافي** (المكون الإضافي لسوق Claude أو المكون الإضافي Codex) عبارة عن حزمة تضم واحدًا أو أكثر من skills **زائد** موصل وبيانات وصفية MCP، بحيث يمكن للمضيف تثبيت كل شيء في خطوة واحدة.

تحت الغطاء، يتم إنتاج جميع المسارات الثلاثة من نفس المصدر بواسطة `npx @agent-native/core@latest app-skill` CLI: `app-skill pack` يبني محولات السوق/المكونات الإضافية، و`skills add` هو برنامج التثبيت السهل بخطوة واحدة الذي يقوم أيضًا بتسجيل موصل MCP والمصادقة عليه. راجع [Skills Guide](/docs/skills-guide) للتعرف على تنسيق بيان مهارات التطبيق، و[External Agents](/docs/external-agents) لتوصيل أي مضيف MCP وتدفق `npx @agent-native/core@latest connect`.

## ما هي الخطوة التالية {#whats-next}

- [**Visual Plans**](/docs/template-plan) — ما تفعله skills وكيفية استخدامها
- [**PR Visual Recap**](/docs/pr-visual-recap) - تشغيل `/visual-recap` تلقائيًا عند كل طلب سحب
- [**Skills Guide**](/docs/skills-guide) — skills المدعوم بالتطبيق وتنسيق البيان
- [**External Agents**](/docs/external-agents) — قم بتوصيل أي مضيف MCP وعناصر رحلة الذهاب والإياب
