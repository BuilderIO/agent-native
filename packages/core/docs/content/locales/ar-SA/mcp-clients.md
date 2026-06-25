---
title: "عملاء MCP"
description: "قم بتوصيل تطبيق الوكيل الأصلي بخوادم MCP المحلية (clude-in-chrome، ونظام الملفات، والكاتب المسرحي، وما إلى ذلك) حتى يحصل الوكيل على أدواته."
---

# عملاء MCP

**هذه الصفحة: امنح وكيلك المزيد من الأدوات.** قم بتوجيه تطبيق الوكيل الأصلي إلى خوادم MCP - المحلية أو البعيدة - حتى تظهر أدواته في دردشة الوكيل. هذا هو اتجاه _client_، الصورة المعكوسة لـ [MCP Protocol](/docs/mcp-protocol) (مما يجعل تطبيقك MCP _server_).

| إذا كنت تريد...                                                     | اقرأ                                     |
| ------------------------------------------------------------------- | ---------------------------------------- |
| قم بتوصيل وكيل/مضيف خارجي بتطبيقك                                   | [External Agents](/docs/external-agents) |
| امنح وكيلك المزيد من الأدوات (استخدم خوادم MCP الأخرى)              | **هذه الصفحة** — عملاء MCP               |
| إنشاء UI المضمنة التي يتم عرضها في Claude/ChatGPT                   | [MCP Apps](/docs/mcp-apps)               |
| مرجع خادم MCP ذو المستوى الأدنى (المصادقة، الأدوات، التثبيت المخصص) | [MCP Protocol](/docs/mcp-protocol)       |

باستخدام ملف تكوين واحد، يتمكن كل تطبيق وكيل أصلي في مساحة العمل الخاصة بك من الوصول إلى الأدوات التي توفرها خوادم MCP على جهازك: `claude-in-chrome` لأتمتة المتصفح، و`@modelcontextprotocol/server-filesystem` لقراءة الملفات، و`@playwright/mcp` لاختبار المتصفح، وأي شيء آخر يتحدث MCP.

يمكنك أيضًا استخدام [connect remote (HTTP) MCP servers at runtime](#remote-via-ui) — مستخدمون فرديون أو مؤسسات بأكملها — دون تعديل ملف التكوين.

يتم تحليل كل مصدر في وقت تشغيل واحد **مدير MCP**، وكل أداة يتعلمها يتم وضعها في سجل أدوات الوكيل تحت بادئة `mcp__<server-id>__<tool>` مقاومة للتصادم — يمكن البحث فيها عن طريق النية من خلال `tool-search`.

```an-diagram title="توجيه العميل: العديد من المصادر وسجل أداة واحد" summary="يتم دمج ملفات التكوين وenv وواجهة المستخدم الخاصة بوقت التشغيل في مدير MCP؛ تظهر أدواته مسبوقة وقابلة للبحث عن الأدوات جنبًا إلى جنب مع إجراءات تطبيقك. هذه هي مرآة اتجاه الخادم."
{
  "html": "<div class=\"mcp-merge\"><div class=\"diagram-col sources\"><div class=\"diagram-box\" data-rough>Workspace <code>mcp.config.json</code><br><small class=\"diagram-muted\">مشترك بين التطبيقات</small></div><div class=\"diagram-box\" data-rough>جذر التطبيق <code>mcp.config.json</code><br><small class=\"diagram-muted\">تجاوز لكل تطبيق</small></div><div class=\"diagram-box\" data-rough><code>MCP_SERVERS</code> env<br><small class=\"diagram-muted\">CI / الإنتاج</small></div><div class=\"diagram-box\" data-rough>بعيد عبر واجهة الإعدادات<br><small class=\"diagram-muted\">personal &amp; org scope</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">مدير MCP</span><small class=\"diagram-muted\">merge &middot; hot-reload</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col out\"><div class=\"diagram-node\">أداة الوكيل registry<br><small class=\"diagram-muted\"><code>mcp__&lt;server-id&gt;__&lt;tool&gt;</code></small></div><div class=\"diagram-node\"><code>tool-search</code><br><small class=\"diagram-muted\">اكتشاف حسب النية</small></div></div></div>",
  "css": ".mcp-merge{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.mcp-merge .diagram-col{display:flex;flex-direction:column;gap:8px}.mcp-merge .center{display:flex;flex-direction:column;align-items:center;gap:4px}.mcp-merge .diagram-arrow{font-size:22px;line-height:1}.mcp-merge code{font-size:.85em}"
}
```

> الاتجاه المعاكس - جعل _your_ app خادم MCP يستهلكه المضيفون الآخرون - موجود في [MCP Protocol](/docs/mcp-protocol) و[External Agents](/docs/external-agents).

## متصفح مدمج وإمكانات استخدام الكمبيوتر {#built-in-capabilities}

يتضمن Agent-native أدوات تبديل للتطوير المحلي لخوادم MCP الشائعة من stdio.
يتم إيقاف تشغيلها افتراضيًا ويمكن تمكينها لكل مستخدم أو لكل مؤسسة فقط
عندما يكون التطبيق قيد التشغيل محليًا. يتم تخطي الإنتاج وأوقات التشغيل المستضافة بدون خادم
هذه العناصر المضمنة حتى في حالة وجود صفوف الإعدادات القديمة، وموارد مساحة العمل
لا تعرضها الشجرة كموارد `mcp-servers/*.json` الافتراضية.

| القدرة               | معرف الخادم       | الأمر                                                                   |
| -------------------- | ----------------- | ----------------------------------------------------------------------- |
| أدوات تطوير Chrome   | `chrome-devtools` | `npx -y chrome-devtools-mcp@latest --autoConnect --no-usage-statistics` |
| متصفح الكاتب المسرحي | `playwright`      | `npx -y @playwright/mcp@latest`                                         |
| استخدام الكمبيوتر    | `computer-use`    | `npx -y computer-use-mcp@latest`                                        |

يمكن تمكين قدرة متصفح واحدة فقط في نطاق ما في المرة الواحدة. يؤدي تمكين Chrome DevTools إلى تعطيل Playwright لنفس المستخدم أو المؤسسة، كما يؤدي تمكين Playwright إلى تعطيل Chrome DevTools.

استخدام الكمبيوتر هو نظام التشغيل macOS فقط. وفي الأنظمة الأساسية الأخرى، يتم إدراجه على أنه غير متاح ويتم تخطيه حتى إذا كان صف الإعداد القديم يحتوي عليه.

يستخدم Chrome DevTools `--autoConnect` بشكل افتراضي. يرتبط ذلك بمثيل Chrome المؤهل قيد التشغيل؛ ولا يقوم بإنشاء ملف تعريف متصفح معزول أو تسجيل الدخول إلى الملف الشخصي العادي للمستخدم نيابةً عنك. يتطلب Chrome 144+ مع تمكين تصحيح الأخطاء عن بعد. يمكن إضافة التكوين اليدوي `browser-url` لاحقًا عندما يحتاج النشر إلى نقطة نهاية محددة لتصحيح الأخطاء.

يتم الاحتفاظ بالمكونات الإضافية في جدول `settings` الخاص بإطار العمل ضمن `u:<email>:mcp-builtin-capabilities` للتبديلات الشخصية و`o:<orgId>:mcp-builtin-capabilities` لتبديلات الفريق. عند تمكينها، يتم دمجها في مدير MCP لوقت التشغيل بنفس تنسيق الرؤية المحدد مثل الخوادم البعيدة، على سبيل المثال `mcp__user_<emailhash>_playwright__*` أو `mcp__org_<orgId>_chrome-devtools__*`.

### ملاحظات الإعداد التي تواجه المستخدم

استخدم نسخة إعداد موجزة وصريحة للمكونات الإضافية الحساسة:

- **يتم ربط Chrome DevTools** بهدف تصحيح أخطاء Chrome قيد التشغيل. أخبر المستخدمين
  مخصص لاختبار المتصفح والتحقق من تسجيل الدخول، وهو
  قد يتطلب تمكين تصحيح الأخطاء عن بعد في Chrome قبل ظهور الأدوات.
- **الكاتب المسرحي** يقوم بتشغيل متصفح معزول. أوصي به من أجل الحتمية
  سؤال وجواب عندما لا يكون الملف الشخصي المباشر للمستخدم في Chrome مطلوبًا.
- **استخدام الكمبيوتر** يمكنه تشغيل التطبيقات المحلية. قم بإيقاف تشغيله افتراضيًا، اشرح
  مطالبات تسجيل شاشة نظام التشغيل MacOS وإمكانية الوصول، واسأل قبل التقاطها
  actions الحساسة مثل عمليات الشراء أو التغييرات المالية أو تغييرات الحساب.

### نقاط النهاية المضمنة

| الطريقة | المسار                       | الغرض                                                                        |
| ------- | ---------------------------- | ---------------------------------------------------------------------------- |
| GET     | `/_agent-native/mcp/builtin` | سرد الإمكانات المضمنة والنطاقات الممكّنة والمعرفات المدمجة والحالة المباشرة. |
| POST    | `/_agent-native/mcp/builtin` | تحديث النطاق. الجسم: `{ scope, enabledIds }` أو `{ scope, id, enabled }`.    |

## إضافة خادم MCP محلي {#adding-a-server}

قم بإنشاء `mcp.config.json` على جذر مساحة العمل لديك (أو على جذر تطبيق فردي - يفوز جذر مساحة العمل عند وجودهما معًا):

```jsonc
{
  "$schema": "https://agent-native.com/schema/mcp.config.json",
  "servers": {
    "claude-in-chrome": {
      "command": "claude-in-chrome-mcp",
      "args": [],
      "env": { "LOG_LEVEL": "info" },
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"],
    },
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem@latest",
        "/Users/me/projects",
      ],
    },
  },
}
```

الشكل صغير: خريطة `servers` مرتبطة بمعرف الخادم، حيث يكون كل إدخال إما مشغل stdio (`command` + `args` + `env` اختياري) أو إدخال `{ "type": "http", "url", "headers" }` عن بعد.

```an-annotated-code title="mcp.config.json، مشروح"
{
  "filename": "mcp.config.json",
  "language": "jsonc",
  "code": "{\n  \"$schema\": \"https://agent-native.com/schema/mcp.config.json\",\n  \"servers\": {\n    \"claude-in-chrome\": {\n      \"command\": \"claude-in-chrome-mcp\",\n      \"args\": [],\n      \"env\": { \"LOG_LEVEL\": \"info\" }\n    },\n    \"filesystem\": {\n      \"command\": \"npx\",\n      \"args\": [\"-y\", \"@modelcontextprotocol/server-filesystem@latest\", \"/Users/me/projects\"]\n    }\n  }\n}",
  "annotations": [
    { "lines": "3", "label": "معرف الخادم", "note": "يصبح المفتاح هو بادئة الأداة: تظهر أدوات هذا الخادم كـ `mcp__claude-in-chrome__*` في سجل الوكيل، بحيث يمكنها 't collide with your template's الإجراءات." },
    { "lines": "4-6", "label": "stdio launcher", "note": "`command` + `args` يُنتج ثنائيًا محليًا. خوادم Stdio مخصصة **للتطوير المحلي** — وهي محظورة في أوقات تشغيل الحافة." },
    { "lines": "6", "label": "بيئة العملية", "note": "Optional `env` is passed to the spawned process. Keep secrets out of committed config; prefer `MCP_SERVERS` or the settings UI for tokens." }
  ]
}
```

عند بدء التطبيق التالي، سترى:

```
[mcp-client] loaded config from /path/to/mcp.config.json (3 server(s))
[mcp-client] connected to claude-in-chrome: 12 tools
[mcp-client] connected to playwright: 9 tools
[mcp-client] connected to filesystem: 4 tools
```

يتم تسجيل الأدوات في سجل أدوات الوكيل بالبادئة `mcp__<server-id>__<tool-name>` حتى لا تتعارض مع actions للقالب الخاص بك. تم تضمينها أيضًا في `tool-search`، بحيث يمكن للوكلاء اكتشاف إمكانات MCP المتصلة حديثًا عن طريق النية بدلاً من الحاجة إلى الاسم البادئ الدقيق مقدمًا.

## أسبقية التكوين {#precedence}

يتم حل تكوين MCP بهذا الترتيب، وتفوز المباراة الأولى:

1. **جذر مساحة العمل `mcp.config.json`** — تم اكتشافه عبر `agent-native.workspaceCore` في `package.json`. تتم مشاركتها عبر كل تطبيق في مساحة العمل.
2. **جذر التطبيق `mcp.config.json`** — يتم التجاوز لكل تطبيق إذا كنت لا تريد توفر خادم MCP في كل تطبيق.
3. **`MCP_SERVERS` env var** — سلسلة JSON بنفس الشكل، لـ CI/الإنتاج حيث لا يكون للملف معنى.

## نشر الإنتاج: `MCP_SERVERS` {#mcp-servers-env}

بالنسبة لعمليات نشر الإنتاج، فضل خوادم HTTP MCP البعيدة وقم بتعيين التكوين الكامل
الشكل (أو خريطة الخادم الداخلية) كمتغير بيئة:

```bash
MCP_SERVERS='{"servers":{"zapier":{"type":"http","url":"https://mcp.example.com/mcp","headers":{"Authorization":"Bearer paste-token-value-here"}}}}'
```

تم تحليل `MCP_SERVERS` كـ JSON، لذا لم يتم توسيع العناصر النائبة `${...}`
داخل السلسلة. إذا قمت بتخزين الرمز المميز في سر آخر، فقم بتوسيعه قبل
كتابة قيمة JSON النهائية.

تنتج خوادم Stdio MCP ثنائيات محلية وهي مخصصة للتطوير المحلي.
يتم تنشيط أدوات MCP فقط في أوقات تشغيل Node — Cloudflare Workers والحواف الأخرى
تتخطى الأهداف MCP بصمت وتستمر في عمل بقية التطبيق
عادة.

## الاكتشاف التلقائي: `claude-in-chrome` {#autodetect}

إذا كان لديك **لا** `mcp.config.json` وكان الملف الثنائي `claude-in-chrome-mcp` موجودًا على `PATH` (أو في موقع التثبيت المعروف `~/.claude-in-chrome/bin/claude-in-chrome-mcp`)، فسيقوم الوكيل الأصلي بتسجيله تلقائيًا كخادم MCP افتراضي. اضبط `AGENT_NATIVE_DISABLE_MCP_AUTODETECT=1` على إلغاء الاشتراك.

يعني هذا أن المستخدمين الذين قاموا بتثبيت ملحق claude-in-chrome سيحصلون على التحكم في المتصفح عبر كل تطبيق أصلي للوكيل يفتحونه دون أي تغييرات في التكوين.

## خوادم MCP البعيدة عبر إعدادات UI {#remote-via-ui}

تمنح خوادم MCP (نموذج سياق البروتوكول) وكيلك قدرات جديدة - مثل الاتصال بـ Zapier، أو Cloudflare، أو Composio، أو الأدوات الداخلية لشركتك. بمجرد الاتصال، يمكن للوكيل استخدام هذه الأدوات تمامًا مثل الأدوات المدمجة فيه.

### كيفية الاتصال بخادم MCP البعيد

1. **اسم الخادم** — تسمية قصيرة للرجوع إليها (على سبيل المثال، "zapier"، "slack-tools").
2. **URL** — نقطة النهاية HTTPS التي قدمها لك موفر خادم MCP (على سبيل المثال، `https://mcp.zapier.com/s/abc123/mcp`). يتم العثور على هذا عادةً في لوحة تحكم الموفر أو مستندات التكامل.
3. **الوصف** (اختياري) — ملاحظة حول ما يفعله هذا الخادم.
4. **الرؤوس** — بيانات اعتماد المصادقة التي يتطلبها الخادم، واحدة في كل سطر. تحتاج معظم الخوادم إلى رأس `Authorization`. مثال: `Authorization: Bearer sk-your-key-here`. ستخبرك مستندات الموفر بما يجب وضعه هنا.

انقر فوق **اختبار** للتحقق من الاتصال قبل الحفظ. إذا نجحت، سترى عدد الأدوات المتاحة. انقر **اتصال** لإضافته.

### النطاق الشخصي مقابل نطاق المؤسسة

يتم دعم نطاقين:

- **شخصي** — فقط المستخدم الذي سجل الدخول هو الذي يحصل على الأدوات. يتم تخزينه كإعداد لنطاق المستخدم.
- **الفريق** — يحصل كل فرد في المؤسسة النشطة على الأدوات. يمكن للمالكين والمشرفين إضافة؛ يرى الأعضاء القائمة للقراءة فقط. تم تخزينه كإعداد نطاق مؤسسي.

يضيف ويزيل التحميل السريع إلى مدير MCP قيد التشغيل - لا إعادة تشغيل للعملية، ولا إعادة تشغيل للخادم. تظهر أدوات `mcp__<scope>-<name>__*` الجديدة للوكيل في الرسالة التالية ويمكن البحث فيها عبر `tool-search`.

يتم قبول HTTPS URL في كل مكان؛ يُسمح فقط بـ `http://` العادي لـ `localhost` أثناء التطوير. يتم إدخال المصادقة الاختيارية كرمز مميز لحامل يتم إرساله عبر `Authorization: Bearer …` عند كل طلب.

تحت الغطاء، تظل هذه الخوادم موجودة في جدول `settings` الخاص بإطار العمل تحت المفتاح `u:<email>:mcp-servers-remote` (شخصي) أو `o:<orgId>:mcp-servers-remote` (فريق) ويتم دمجها مع `mcp.config.json` عند بدء التشغيل.

### نقاط نهاية HTTP

| الطريقة | المسار                                                | الغرض                                                               |
| ------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| GET     | `/_agent-native/mcp/servers`                          | قم بإدراج خوادم المؤسسة الشخصية للمستخدم الحالي مع الحالة المباشرة. |
| POST    | `/_agent-native/mcp/servers`                          | إضافة خادم. الجسم: `{ scope, name, url, headers?, description? }`.  |
| DELETE  | `/_agent-native/mcp/servers/:id?scope=user\|org`      | قم بإزالة الخادم وأعد تكوين المدير.                                 |
| POST    | `/_agent-native/mcp/servers/:id/test?scope=user\|org` | التشغيل التجريبي لأدوات الاتصال + القائمة الخاصة بالخادم الحالي.    |
| POST    | `/_agent-native/mcp/servers/test`                     | قم بتشغيل URL بشكل تعسفي قبل الاستمرار. الجسم: `{ url, headers? }`. |

لا تزال خوادم Stdio محظورة خارج أوقات تشغيل Node، لكن خوادم HTTP MCP البعيدة تعمل في أي بيئة مع `fetch` - بما في ذلك إصدارات إنتاج سطح المكتب.

## خوادم MCP المشتركة عبر المحور {#hub}

إذا كانت مساحة العمل الخاصة بك تقوم بتشغيل العديد من تطبيقات الوكيل الأصلية (على سبيل المثال، الإرسال + البريد + المقاطع)، فيمكنك تكوين تطبيق **واحد** كمركز وجعل الآخرين يسحبون خوادم MCP ذات النطاق المؤسسي تلقائيًا. لا يوجد نسخ ولصق لكل تطبيق لرموز URL والرموز المميزة لحاملها. راجع [Multi-App Workspace](/docs/multi-app-workspace) للتعرف على النهج الأساسي باستخدام موارد MCP لمساحة عمل Dispatch.

Dispatch هو المركز التقليدي - فهو ينسق بالفعل عبر التطبيقات.

```an-diagram title="نموذج Hub: يخدم تطبيق واحد خوادم MCP ذات النطاق التنظيمي" summary="Dispatch يحمل خوادم MCP ذات النطاق التنظيمي؛ تقوم تطبيقات المستهلك بسحبها ودمجها كـ mcp__hub_<orgId>_<name>__*. تتم مشاركة صفوف نطاق المؤسسة فقط، وتظل بيانات الاعتماد الشخصية في مكانها."
{
  "html": "<div class=\"mcp-hub\"><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Dispatch hub</span><small class=\"diagram-muted\">خوادم MCP على نطاق المؤسسة</small><small class=\"diagram-muted\"><code>GET /mcp/hub/servers</code></small></div><div class=\"diagram-col arrows\"><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div></div><div class=\"diagram-col consumers\"><div class=\"diagram-box\" data-rough>Mail<br><small class=\"diagram-muted\"><code>mcp__hub_&lt;orgId&gt;_&lt;name&gt;__*</code></small></div><div class=\"diagram-box\" data-rough>Clips<br><small class=\"diagram-muted\">سحب + دمج كل ~60 ثانية</small></div></div></div><p class=\"diagram-muted note\">Bearer-gated by <code>AGENT_NATIVE_MCP_HUB_TOKEN</code>. Personal (user-scope) servers are never re-exposed.</p>",
  "css": ".mcp-hub{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.mcp-hub .center{display:flex;flex-direction:column;align-items:center;gap:4px}.mcp-hub .diagram-col{display:flex;flex-direction:column;gap:10px}.mcp-hub .arrows .diagram-arrow{font-size:22px;line-height:1}.mcp-hub .note{margin:8px 0 0;font-size:.85em}.mcp-hub code{font-size:.85em}"
}
```

بالنسبة لإعدادات مساحة العمل الجديدة، تفضل **إرسال موارد مساحة العمل MCP** عندما
تريد نفس نموذج منح كل التطبيقات مقابل التطبيقات المحددة الذي تستخدمه مساحة العمل skills،
التعليمات والموارد المرجعية. أضف مورد مساحة عمل باستخدام:

```json
{
  "type": "http",
  "url": "https://example.com/mcp",
  "headers": {
    "Authorization": "Bearer ${keys.MCP_SERVER_TOKEN}"
  },
  "description": "Shared أداة MCPs for workspace apps"
}
```

احفظه تحت `mcp-servers/<name>.json` بالنوع `mcp-server`. كل التطبيقات
يتم تحميل الموارد بواسطة كل تطبيق مساحة عمل؛ يتم تحميل الموارد المحددة فقط في
التطبيقات ذات منحة Dispatch النشطة. يتم حل العناصر النائبة السرية من التطبيق
متجر سري، لذا ضع الرموز المميزة لحاملها في Dispatch Vault وقم بالإشارة إليها
باستخدام `${keys.NAME}` بدلاً من تخزينها في نص المورد.

تقوم التطبيقات بتحديث تكوين MCP المدمج الخاص بها مرة واحدة تقريبًا كل دقيقة، لذا فهو مورد مركزي
تسري عمليات التحرير ومنح التغييرات وعمليات الإزالة دون النشر. تعيين
`AGENT_NATIVE_MCP_CONFIG_REFRESH_MS=0` لتعطيل تحديث الخلفية، أو
اضبطها على قيمة لا تقل عن `5000` مللي ثانية لضبط الفاصل الزمني.

يظل الوضع المحوري الأقدم أدناه مفيدًا لـ "مشاركة كل نطاق مؤسسة MCP" الخشنة
إعدادات الخادم من Dispatch" وعمليات النشر التي تستخدم MCP بالفعل
إعدادات UI كمصدر للحقيقة.

### 1. قم بتمكين خدمة المركز على تطبيق المركز (الإرسال)

قم بتعيين env var في نشر الإرسال:

```bash
AGENT_NATIVE_MCP_HUB_TOKEN=<a-long-random-secret>
```

تقوم Dispatch الآن بتثبيت `GET /_agent-native/mcp/hub/servers` الذي يُرجع كل خادم MCP على مستوى المؤسسة مُخزن في جدول `settings` الخاص به، مع رؤوس URL + الكاملة، والتي تمت مصادقتها بواسطة الرمز المميز.

### 2. قم بتوجيه التطبيقات المستهلكة إلى المركز

تعيين على كل مستهلك (بريد، مقاطع، أي شيء):

```bash
AGENT_NATIVE_MCP_HUB_URL=https://dispatch.acme.com
AGENT_NATIVE_MCP_HUB_TOKEN=<the-same-secret>
```

عند بدء التشغيل، يقوم كل مستهلك بسحب قائمة خوادم المحور ودمجها في مدير MCP الخاص به. تظهر الأدوات للوكيل باسم `mcp__hub_<orgId>_<name>__*` — وهي مختلفة عن `mcp__org_…` المحلي الخاص بالمستهلك، لذلك لا يوجد تعارض.

### 3. ما تتم مشاركته

تتم مشاركة خوادم **org-scope** فقط. تظل خوادم نطاق المستخدم (الشخصي) مع المستخدم الذي أضافها - لا يعيد المركز أبدًا الكشف عن بيانات الاعتماد الشخصية عبر التطبيقات.

تتضمن استجابات المحور رؤوس المصادقة الكاملة (الرموز المميزة لحاملها، وما إلى ذلك). النقل هو HTTPS، وتتطلب نقطة النهاية السر المشترك، ولا تُرجع سوى صفوف نطاق المؤسسة - تعامل مع الرمز المميز URL + للمركز مثل بيانات اعتماد قاعدة البيانات.

### 4. إعادة التحميل السريع مقابل إعادة التشغيل

يضيف UI المحلي إمكانية إعادة التحميل السريع لكل تطبيق عبر `McpClientManager.reconfigure()` - دون إعادة التشغيل. يتم التقاط الخوادم ذات المصدر المحوري من خلال نفس التحديث الدوري للخلفية (حوالي 60 ثانية, يمكن ضبطه أو تعطيله عبر `AGENT_NATIVE_MCP_CONFIG_REFRESH_MS`) الذي يستخدمه مسار موارد مساحة العمل، لذلك يتم نشر التغييرات التي تم إجراؤها في Dispatch إلى جميع تطبيقات المستهلك في غضون دقيقة تقريبًا دون إعادة التشغيل. بالإضافة إلى ذلك، فإن أي تغيير محلي في تطبيق المستهلك يؤدي فورًا إلى إعادة تكوين ذلك التطبيق.

### ملخص نقاط النهاية

| الطريقة | المسار                           | الغرض                                                                                                                        |
| ------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| GET     | `/_agent-native/mcp/hub/servers` | خدمة جميع خوادم نطاق المؤسسة ببيانات الاعتماد الكاملة (بوابة حاملة، يتم تثبيتها فقط عند تعيين `AGENT_NATIVE_MCP_HUB_TOKEN`). |
| GET     | `/_agent-native/mcp/hub/status`  | إرجاع `{ serving, consuming, hubUrl }` لبطاقة الإعدادات UI.                                                                  |

## مسار الحالة {#status-route}

يكشف كل تطبيق عن `GET /_agent-native/mcp/status` للأدوات والإعداد:

```an-api
{
  "method": "GET",
  "path": "/_agent-native/mcp/status",
  "summary": "MCP حالة العميل للأدوات والإعداد",
  "description": "Reports which configured servers connected, the total live tool count, the merged prefixed tool list, and any per-server connection errors. Use it to build \"detected — your agent can now drive X\" hints or to debug connection problems.",
  "responses": [
    {
      "status": "200",
      "description": "Configured vs connected servers, tool inventory, and per-server errors.",
      "example": "{\n  \"configuredServers\": [\"claude-in-chrome\", \"playwright\"],\n  \"connectedServers\": [\"claude-in-chrome\", \"playwright\"],\n  \"totalTools\": 21,\n  \"tools\": [\n    {\n      \"source\": \"claude-in-chrome\",\n      \"name\": \"mcp__claude-in-chrome__navigate\",\n      \"description\": \"Navigate the browser to a URL\"\n    }\n  ],\n  \"errors\": {}\n}"
    }
  ]
}
```

```json
{
  "configuredServers": ["claude-in-chrome", "playwright"],
  "connectedServers": ["claude-in-chrome", "playwright"],
  "totalTools": 21,
  "tools": [
    {
      "source": "claude-in-chrome",
      "name": "mcp__claude-in-chrome__navigate",
      "description": "Navigate the browser to a URL"
    }
  ],
  "errors": {}
}
```

استخدم هذا لإنشاء "تم اكتشاف claude-in-chrome - يمكن لوكيلك الآن توجيه تلميحات إعداد Chrome" أو تصحيح مشكلات اتصال MCP.

## أوضاع الفشل {#failures}

لا تؤدي حالات فشل خادم MCP الفردية إلى إزالة الوكيل مطلقًا:

- تم تكوين `command` بشكل خاطئ → تم تخطي الخادم، ويظهر خطأه في `/mcp/status` ضمن `errors.<server-id>`، ويستمر كل خادم آخر في العمل.
- MCP SDK مفقود من `node_modules` → تم تخطي جميع وظائف MCP مع تحذير؛ تستمر دردشة الوكيل في العمل بدون أدوات MCP.
- التشغيل في وقت تشغيل الحافة ← عميل MCP غير متاح.

سيتم تشغيل Agent-Native دائمًا؛ تهيئة MCP المعطلة تعني عددًا أقل من الأدوات.

## الأمان {#security}

تعمل أدوات MCP على جهازك بأي أذونات تتمتع بها العملية الناتجة. تعامل مع `mcp.config.json` مثل أي قائمة أخرى من الملفات التنفيذية التي ترغب في السماح للوكيل بقيادةها. تظهر الأدوات من خوادم MCP في حلقة استخدام أداة الوكيل تمامًا مثل actions الخاص بالقالب الخاص بك، لذا تأكد من ثقتك في كل خادم تقوم بتكوينه.
