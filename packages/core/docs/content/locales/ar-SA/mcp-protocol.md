---
title: "بروتوكول MCP"
description: "اكشف عن تطبيق الوكيل الأصلي كخادم MCP عن بعد حتى تتمكن Claude وChatGPT وClaude Code وCursor وأدوات الذكاء الاصطناعي الأخرى من الاتصال بـ actions لتطبيقك مباشرة."
---

# بروتوكول MCP

**هذه الصفحة: مرجع خادم MCP ذي المستوى الأدنى.** كيف يكشف كل تطبيق أصلي للوكيل عن actions الخاص به عبر MCP - نقطة النهاية المثبتة تلقائيًا، وأوضاع المصادقة، وسطح `tools/call` / `ask-agent`، والتثبيت المخصص. يمكنك الوصول إليه عندما تحتاج إلى الأجزاء الداخلية للخادم؛ لتوصيل المضيف، ابدأ بـ [External Agents](/docs/external-agents).

| إذا كنت تريد...                                                     | اقرأ                                     |
| ------------------------------------------------------------------- | ---------------------------------------- |
| قم بتوصيل وكيل/مضيف خارجي بتطبيقك                                   | [External Agents](/docs/external-agents) |
| امنح وكيلك المزيد من الأدوات (استخدم خوادم MCP الأخرى)              | [MCP Clients](/docs/mcp-clients)         |
| إنشاء UI المضمنة التي يتم عرضها في Claude/ChatGPT                   | [MCP Apps](/docs/mcp-apps)               |
| مرجع خادم MCP ذو المستوى الأدنى (المصادقة، الأدوات، التثبيت المخصص) | **هذه الصفحة** — بروتوكول MCP            |

يكشف كل تطبيق أصلي للوكيل تلقائيًا عن خادم MCP (بروتوكول سياق النموذج) عن بعد، لذلك يمكن لأدوات الذكاء الاصطناعي الخارجية مثل Claude وتطبيقات ChatGPT المخصصة MCP ورمز Claude وCursor وCodex وVS Code GitHub Copilot اكتشاف actions الخاص بتطبيقك واستدعاءه مباشرةً — بدون تعليمات برمجية إضافية مطلوب. إذا كان هدفك هو _ربط_ أحد هؤلاء المضيفين بتطبيق مستضاف، فإن [External Agents](/docs/external-agents) يغطي موصل Dispatch الفردي الموصى به، وتطبيقات URL، وOAuth، وMCP المضمنة، وUI، والروابط العميقة. توثق هذه الصفحة ما يكمن تحت ذلك.

## نظرة عامة {#overview}

MCP هو البروتوكول القياسي لتوصيل أدوات الذكاء الاصطناعي بالإمكانات الخارجية. عندما تقوم بنشر تطبيق وكيل أصلي، فإنه يقوم تلقائيًا بتثبيت نقطة نهاية MCP إلى جانب نقطة نهاية A2A الحالية. يمكن لأي عميل متوافق مع MCP الاتصال بأدوات تطبيقك واستخدامها.

المفاهيم الأساسية:

- **يتم التثبيت تلقائيًا** — يحصل كل تطبيق على `/_agent-native/mcp` مجانًا، دون الحاجة إلى أي إعداد
- **HTTP** قابل للبث\*\* — يستخدم نقل MCP الحديث عبر HTTP القياسي (POST + SSE)
- **نفس actions** — نفس سجل الإجراءات الذي يدعم دردشة الوكيل وA2A
- **أداة `ask-agent`** — أداة تعريفية تقوم بتفويض حلقة الوكيل الكاملة للمهام المعقدة
- **تطبيقات MCP** — يمكن لـ actions الإعلان عن موارد UI التفاعلية من خلال ملحق `io.modelcontextprotocol/ui` الرسمي
- **جهاز التحكم عن بعد القياسي MCP OAuth** — اكتشاف OAuth 2.1، تسجيل العميل الديناميكي، رمز التفويض + PKCE، تدوير رمز التحديث
- **الرجوع الاحتياطي لمصادقة الحامل** — يستخدم `ACCESS_TOKEN` أو `ACCESS_TOKENS` أو JWTs المتصلة للعملاء الذين لا يمكنهم تشغيل OAuth

```an-diagram title="تطبيقك كخادم MCP" summary="يتصل المضيفون الخارجيون عبر HTTP القابل للتدفق. كل عمل هو أداة واحدة؛ مندوبو Ask-agent إلى حلقة الوكيل الكاملة."
{
  "html": "<div class=\"diagram-mcp\"><div class=\"diagram-col\"><div class=\"diagram-node\">Claude</div><div class=\"diagram-node\">ChatGPT</div><div class=\"diagram-node\">Cursor · Codex</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\"><span class=\"diagram-pill accent\">POST /_agent-native/mcp</span><small class=\"diagram-muted\">Streamable HTTP</small><small class=\"diagram-muted\">initialize &rarr; tools/list &rarr; tools/call</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\" data-rough>each action<br><small class=\"diagram-muted\">= one tool</small></div><div class=\"diagram-box\" data-rough>ask-agent<br><small class=\"diagram-muted\">&rarr; full agent loop</small></div></div></div>",
  "css": ".diagram-mcp{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.diagram-mcp .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-mcp .diagram-panel{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-mcp .diagram-arrow{font-size:20px;line-height:1}"
}
```

## MCP ضد A2A {#mcp-vs-a2a}

تم تثبيت كلا البروتوكولين تلقائيًا. استخدم ما يناسب حالة الاستخدام الخاصة بك:

|                   | MCP                                                                     | A2A                                            |
| ----------------- | ----------------------------------------------------------------------- | ---------------------------------------------- |
| **الأفضل لـ**     | أدوات خارجية تتصل بتطبيقك                                               | الاتصال من وكيل إلى وكيل                       |
| **البروتوكول**    | MCP HTTP قابل للبث                                                      | JSON-RPC 2.0                                   |
| **اكتشاف الأداة** | `tools/list`                                                            | بطاقة الوكيل في `/.well-known/agent-card.json` |
| **نقطة النهاية**  | `/_agent-native/mcp`                                                    | `/_agent-native/a2a`                           |
| **بدعم من**       | Claude، ChatGPT، Claude Code، Cursor، Codex، Cowork، ومضيفو MCP الآخرون | تطبيقات أخرى خاصة بالوكيل                      |
| **التنفيذ**       | استدعاءات الأداة المباشرة (بدون LLM إضافية)                             | حلقة الوكيل الكاملة (استدلال LLM)              |

يمكنك أيضًا استخدام أداة `ask-agent` MCP للحصول على أفضل ما في العالمين - يمكنك تسميتها من Claude Code والسماح لوكيل تطبيقك بالتفكير في المهام المعقدة.

## التكوين اليدوي للعميل MCP {#manual-config}

للحصول على الإعداد الموصى به لأمر واحد، استخدم [External Agents](/docs/external-agents). إذا كنت تكتب يدويًا تهيئة MCP لعميل يدعم OAuth، فأضف تطبيقك كخادم MCP بعيد بدون رؤوس ثابتة:

```bash
claude mcp add --transport http mail https://mail.example.com/_agent-native/mcp
```

أو اكتب الإدخال يدويًا في `.mcp.json` (نطاق المشروع) أو `~/.claude.json` (نطاق المستخدم):

```jsonc
// .mcp.json
{
  "mcpServers": {
    "mail": {
      "type": "http",
      "url": "https://mail.example.com/_agent-native/mcp",
    },
  },
}
```

ثم قم بتشغيل `/mcp` في رمز Claude واختر **Authenticate**. بالنسبة للعملاء الذين لا يمكنهم تنفيذ MCP OAuth عن بعد، استخدم صفحة الاتصال أو إدخال الرمز المميز لحامل ثابت مع `headers.Authorization`. بمجرد المصادقة، يمكنك استخدام أدوات تطبيقك بشكل طبيعي:

```
> draft an email to John about the Q3 report

Claude Code calls: draft-email(to: "john@example.com", subject: "Q3 Report", body: "...")
```

## الاتصال من عملاء MCP الآخرين {#other-clients}

يمكن لأي عميل MCP يدعم النقل HTTP القابل للتدفق الاتصال. نقطة النهاية هي:

```
POST https://your-app.example.com/_agent-native/mcp
```

يدعم الخادم مصافحة MCP القياسية: `initialize` → `initialized` → `tools/list` → `tools/call`.

```an-api title="MCP نقطة النهاية" summary="نقطة نهاية Streamable HTTP المثبتة تلقائيًا والتي يكشفها كل تطبيق أصلي للوكيل."
{
  "method": "POST",
  "path": "/_agent-native/mcp",
  "summary": "MCP نقطة النهاية HTTP القابلة للبث",
  "description": "Auto-mounted on every app. Speaks the standard MCP handshake (`initialize` → `initialized` → `tools/list` → `tools/call`) plus `resources/list`, `resources/templates/list`, and `resources/read` when an action declares `mcpApp`. Each action maps to one tool; `ask-agent` delegates to the full agent loop.",
  "auth": "Standard remote MCP OAuth (Bearer access token), connect-minted JWT, or static ACCESS_TOKEN/ACCESS_TOKENS",
  "params": [
    { "name": "Authorization", "in": "header", "type": "string", "required": false, "description": "Bearer access token. Required except for loopback local-dev probes." },
    { "name": "method", "in": "body", "type": "string", "required": true, "description": "MCP method, e.g. initialize, tools/list, tools/call." }
  ],
  "request": {
    "contentType": "application/json",
    "example": "{\n  \"jsonrpc\": \"2.0\",\n  \"id\": 1,\n  \"method\": \"tools/call\",\n  \"params\": {\n    \"name\": \"ask-agent\",\n    \"arguments\": { \"message\": \"Summarize Q3 signups by source\" }\n  }\n}"
  },
  "responses": [
    { "status": "200", "description": "MCP result (POST + SSE)." },
    { "status": "401", "description": "Unauthenticated — responds with a WWW-Authenticate header pointing at OAuth discovery." }
  ]
}
```

إذا أعلن أحد الإجراءات عن `mcpApp`، فإن الخادم يعلن أيضًا عن ملحق تطبيقات MCP الرسمي (`io.modelcontextprotocol/ui`) ويدعم `resources/list`، و`resources/templates/list`، و`resources/read` لمورد التطبيق. يمكن للمضيفين الذين يعرضون تطبيقات MCP إظهار UI المضمنة؛ لا يزال بإمكان المضيفين الذين لا يستخدمون الأداة الاتصال بالأداة واستخدام البديل للارتباط العميق. يجب أن يستخدم منتج UI `embedApp()` بحيث يكون السطح المضمن هو مسار تطبيق React الحقيقي، أو مسار مركّز يعرض مكون React مشترك مثل مخطط Analytics، وليس تنفيذ HTML عادي منفصل. يصدر الخادم كلاً من بيانات تعريف تطبيقات MCP القياسية وبيانات تعريف توافق ChatGPT Apps SDK حتى يتمكن المضيفون القادرون على التطبيق من العثور على نفس مورد `ui://`. تتضمن مصفوفة الامتداد الرسمية الحالية Claude، وClaude Desktop، وVS Code GitHub Copilot، وGoose، وPostman، وMCPJam، وChatGPT، وCursor؛ يختلف دعم المضيف حسب الإصدار والخطة, لذا استخدم [External Agents MCP Apps notes](/docs/external-agents#mcp-apps-compatibility) للحصول على إرشادات موجهة للمستخدم.

### جسر تضمين التطبيق MCP {#mcp-app-embed-bridge}

`embedApp()` هو مساعد تطبيق URL الأول MCP ذو المستوى المنخفض: فهو يطلق تطبيقًا موقعًا
توجيه مضمّن من خلال عملية الزرع (Claude)، أو إطار متحكم فيه (ChatGPT)، أو مباشر
التنقل، يتوسط المضيف actions عبر جسر `ui/*` JSON-RPC (و
`agentNative.mcpHost.*` ترحيل postMessage لمسار الإطار المتحكم فيه)، و
يثبت ارتفاع غلاف المورد بحيث لا يتم عرض مسار التطبيق الكامل كـ
أداة دردشة كبيرة الحجم.

راجع [MCP Apps](/docs/mcp-apps#mcp-app-bridge) للحصول على تفاصيل الجسر المضمن بالكامل - الزرع مقابل الإطار المتحكم فيه، وجداول `ui/*` وpostMessage، و`create_embed_session` / `embedStartUrl`، وCSP وقواعد المجال، وتضمين الامتداد `srcDoc`، وتثبيت الارتفاع، وعميل الجسر المضيف API.

## الأدوات {#tools}

يحصل كل متصل على **كتالوج مضغوط بشكل افتراضي** (التطبيق المعلن عن القالب actions بالإضافة إلى المكونات المدمجة للتطبيقات المشتركة)، مع عرض سطح الإجراء الكامل فقط عند الاشتراك الصريح و`tool-search` متاح دائمًا للوصول إلى الباقي. راجع [External Agents → Catalog tiers](/docs/external-agents#catalog-tiers) للحصول على الشرح الكامل.

يتم ربط كل إجراء مباشرةً بأداة MCP واحدة:

| خاصية الإجراء      | خاصية الأداة MCP |
| ------------------ | ---------------- |
| `tool.description` | `description`    |
| `tool.parameters`  | `inputSchema`    |
| اسم الإجراء        | اسم الأداة       |

عند وجود `mcpApp`، يتضمن إدخال الأداة أيضًا `_meta.ui.resourceUri` و`_meta["ui/resourceUri"]` و`_meta["openai/outputTemplate"]`، ويتم إرجاع المورد `ui://` المقابل كـ `text/html;profile=mcp-app`.

### أداة `ask-agent` {#ask-agent}

بالإضافة إلى أدوات العمل الفردية، يتضمن كل خادم MCP أداة تعريف `ask-agent`. يؤدي هذا إلى إرسال رسالة باللغة الطبيعية إلى وكيل الذكاء الاصطناعي للتطبيق وإرجاع الرد.

استخدم `ask-agent` للمهام المعقدة التي تستفيد من منطق الوكيل وسياقه:

```json
{
  "name": "ask-agent",
  "arguments": {
    "message": "Draft a follow-up email to the Q3 planning thread with John, summarizing the action items we discussed"
  }
}
```

يُدير الوكيل نفس الحلقة مثل الدردشة التفاعلية — يمكنه استدعاء أدوات متعددة، والتفكير في السياق، وتقديم استجابة مدروسة.

## المصادقة {#authentication}

تدعم نقطة النهاية MCP MCP OAuth القياسي عن بعد بالإضافة إلى البديل الحالي للرمز المميز لحامله:

| الوضع                                | كيفية العمل                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| قياسي MCP OAuth                      | يكتشف العميل المصادقة من `WWW-Authenticate`، ويسجل، ويشغل PKCE، ويرسل `Authorization: Bearer <access-token>` |
| ربط JWT                              | `npx @agent-native/core@latest connect` / تقوم صفحة الاتصال بإصدار JWT قابل للإلغاء لكل مستخدم               |
| `ACCESS_TOKEN`                       | الرمز المميز لحامله الثابت — يرسل العميل `Authorization: Bearer <token>`                                     |
| `ACCESS_TOKENS`                      | قائمة مفصولة بفواصل من الرموز المميزة لحاملها الثابتة الصالحة                                                |
| `A2A_SECRET`                         | المصادقة المستندة إلى JWT - يتم التحقق من الرموز المميزة تشفيرًا                                             |
| _(لم يتم ضبط أي شيء, الاسترجاع فقط)_ | لا توجد مصادقة مطلوبة لتحقيقات التطوير المحلية                                                               |

بالنسبة للمضيفين MCP القادرين على OAuth، قم بتكوين الخادم البعيد URL بدون رؤوس ثابتة:

```bash
claude mcp add --transport http agent-native https://dispatch.agent-native.com/_agent-native/mcp
```

يتلقى أول طلب MCP غير مصادق عليه:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://dispatch.agent-native.com/.well-known/oauth-protected-resource", scope="mcp:read mcp:write mcp:apps"
```

اكتشاف نقاط النهاية:

| نقطة النهاية                              | الغرض                                       |
| ----------------------------------------- | ------------------------------------------- |
| `/.well-known/oauth-protected-resource`   | البيانات التعريفية للموارد المحمية RFC 9728 |
| `/.well-known/oauth-authorization-server` | البيانات التعريفية لخادم التخويل OAuth      |
| `/_agent-native/mcp/oauth/register`       | التسجيل الديناميكي للعميل العام             |
| `/_agent-native/mcp/oauth/authorize`      | تخويل المتصفح + الموافقة                    |
| `/_agent-native/mcp/oauth/token`          | منح رمز التفويض ورمز التحديث                |

```an-diagram title="OAuth تدفق الاكتشاف" summary="يبدأ 401 عملية الاكتشاف والتسجيل وتفويض PKCE → تبادل الرمز المميز. الرمز المميز لحامله مرتبط بالجمهور ومحدد النطاق."
{
  "html": "<div class=\"diagram-oauth\"><div class=\"diagram-box\" data-rough>first request<br><small class=\"diagram-muted\">no token</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill warn\">401 · WWW-Authenticate</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\"><span class=\"diagram-pill\">/.well-known/oauth-protected-resource</span><span class=\"diagram-pill\">/.well-known/oauth-authorization-server</span><small class=\"diagram-muted\">discover</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">register</div><div class=\"diagram-pill\">authorize (PKCE)</div><div class=\"diagram-pill\">token</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Bearer access token<br><small class=\"diagram-muted\">مرتبط بالجمهور · mcp:read / write / apps</small></div></div>",
  "css": ".diagram-oauth{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-oauth .diagram-panel{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-oauth .diagram-col{display:flex;flex-direction:column;gap:6px}.diagram-oauth .diagram-arrow{font-size:20px;line-height:1}"
}
```

رموز الوصول المميزة هي JWTs موقعة وجمهورها هو مورد MCP الدقيق URL. يقبل الخادم فقط الرموز المميزة الصادرة لنفسه ويطبق النطاقات قبل أدوات الإدراج/الاتصال:

| النطاق      | يسمح                                   |
| ----------- | -------------------------------------- |
| `mcp:read`  | actions للقراءة فقط                    |
| `mcp:write` | تحور actions و`ask-agent`              |
| `mcp:apps`  | موارد تطبيقات MCP (موارد `ui://` HTML) |

يتم تخزين الرموز المميزة للتحديث فقط على هيئة تجزئات ويتم تدويرها عند كل تحديث. يقوم `npx @agent-native/core@latest connect` بكتابة إدخال OAuth URL فقط لعملاء Claude Code بشكل افتراضي؛ احتفظ بصفحة الاتصال، و`npx @agent-native/core@latest connect --token <token>`، وتكوين الحامل الثابت لوكيل stdio المحلي، والعملاء الأقدم، وتدفقات الطوارئ/تصحيح الأخطاء.

## إعداد MCP مخصص {#custom-setup}

يتم تثبيت خادم MCP تلقائيًا بواسطة البرنامج الإضافي لدردشة الوكيل. بالنسبة لمعظم التطبيقات، لا توجد حاجة إلى أي تكوين. إذا كنت بحاجة إلى سلوك مخصص، فيمكنك تثبيته يدويًا في مكون إضافي للخادم:

```ts
// server/plugins/mcp.ts
import { mountMCP } from "@agent-native/core/mcp";
import { autoDiscoverActions } from "@agent-native/core/server";

export default defineNitroPlugin(async (nitro) => {
  const actions = await autoDiscoverActions(import.meta.url);

  mountMCP(nitro, {
    name: "My App",
    description: "Custom MCP server",
    actions,
    // Optional: provide ask-agent handler
    askAgent: async (message) => {
      // Your custom agent logic
      return "Response";
    },
    // Optional: override the route prefix (default "/_agent-native")
    // routePrefix: "/_agent-native",
  });
});
```

## مثال: التحليلات من كود Claude {#example}

لديك تطبيق تحليلات منشور على `analytics.example.com`. من كود Claude:

```bash
claude mcp add --transport http analytics https://analytics.example.com/_agent-native/mcp
```

أو أضفه يدويًا في `.mcp.json`:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "analytics": {
      "type": "http",
      "url": "https://analytics.example.com/_agent-native/mcp",
    },
  },
}
```

الآن في كود Claude:

```
> How many signups did we get last week?

Claude Code calls: run-query(sql: "SELECT count(*) FROM signups WHERE created_at > now() - interval '7 days'")
→ "1,247 signups last week"
```

لمزيد من التحليل المعقد:

```
> Ask the analytics agent to prepare a full breakdown of Q3 signups by source, with trends

Claude Code calls: ask-agent(message: "Prepare a full breakdown of Q3 signups by source, with trends")
→ The analytics agent runs multiple queries, reasons about the data, and returns a formatted report
```
