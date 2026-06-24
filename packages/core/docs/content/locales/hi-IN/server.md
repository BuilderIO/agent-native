---
title: "सर्वर"
description: "Nitro सर्वर रूट, प्लगइन्स, फ्रेमवर्क-माउंटेड रूट, अनुरोध संदर्भ, और SQL-समर्थित सिंक।"
---

# सर्वर

एजेंट-नेटिव ऐप्स सर्वर रूट और प्लगइन्स के लिए [Nitro](https://nitro.build) का उपयोग करते हैं। अधिकांश उत्पाद व्यवहार [Actions](/docs/actions) में रहना चाहिए; कस्टम रूट उन प्रोटोकॉल सतहों के लिए हैं जो actions में फिट नहीं होते हैं: अपलोड, स्ट्रीमिंग, सार्वजनिक पेज, webhooks, OAuth कॉलबैक और प्रदाता-विशिष्ट APIs।

```an-diagram title="What runs on the server" summary="Actions are the default. Custom file routes and framework-mounted routes share the same Nitro app and the same SQL database."
{
  "html": "<div class=\"diagram-server\"><div class=\"diagram-col entry\"><div class=\"diagram-node\">Browser / UI</div><div class=\"diagram-node\">Agent loop</div><div class=\"diagram-node\">External clients<br><small class=\"diagram-muted\">HTTP · MCP · A2A</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\" data-rough><strong>Nitro server</strong><div class=\"diagram-row\"><span class=\"diagram-pill accent\">Actions</span><small class=\"diagram-muted\">default surface</small></div><div class=\"diagram-row\"><span class=\"diagram-pill\">/_agent-native/*</span><small class=\"diagram-muted\">framework routes</small></div><div class=\"diagram-row\"><span class=\"diagram-pill\">/api/*</span><small class=\"diagram-muted\">custom file routes</small></div><div class=\"diagram-row\"><span class=\"diagram-pill\">plugins</span><small class=\"diagram-muted\">startup: migrations, jobs</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>SQL database<br><small class=\"diagram-muted\">Drizzle · the coordination point</small></div></div>",
  "css": ".diagram-server{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-server .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-server .diagram-panel{display:flex;flex-direction:column;gap:8px;padding:14px 16px}.diagram-server .diagram-row{display:flex;align-items:center;gap:8px}.diagram-server .diagram-arrow{font-size:22px;line-height:1}"
}
```

## फ़ाइल-आधारित रूट {#file-based-routes}

मार्ग `server/routes/` में रहते हैं और Nitro फ़ाइल नामों को विधियों और पथों में मैप करते हैं:

```text
server/routes/
  api/
    health.get.ts              -> GET  /api/health
    uploads.post.ts            -> POST /api/uploads
    webhooks/
      stripe.post.ts           -> POST /api/webhooks/stripe
  [...page].get.ts             -> SSR catch-all for public pages
```

प्रत्येक मार्ग एक `defineEventHandler` निर्यात करता है:

```ts
// server/routes/api/health.get.ts
import { defineEventHandler } from "h3";

export default defineEventHandler(() => ({
  ok: true,
  service: "my-template",
}));
```

### मार्ग नामकरण परंपराएँ {#route-naming-conventions}

| फ़ाइल नाम पैटर्न   | HTTP विधि | उदाहरण पथ                |
| ------------------ | --------- | ------------------------ |
| `index.get.ts`     | GET       | `/api/items`             |
| `index.post.ts`    | POST      | `/api/items`             |
| `[id].get.ts`      | GET       | `/api/items/:id`         |
| `[id].patch.ts`    | PATCH     | `/api/items/:id`         |
| `[id].delete.ts`   | DELETE    | `/api/items/:id`         |
| `[...slug].get.ts` | GET       | `/api/items/*` या कैच-ऑल |

## ऐप संचालन के लिए Actions को प्राथमिकता दें {#actions-first}

यदि UI और एजेंट दोनों को कुछ करने की आवश्यकता है, तो कस्टम API रूट के बजाय एक क्रिया को परिभाषित करें। Actions स्वचालित रूप से बन जाता है:

- एजेंट टूल्स.
- टाइप किए गए फ्रंटएंड हुक।
- `/_agent-native/actions/:name` के अंतर्गत HTTP समापन बिंदु।
- MCP और A2A-कॉल करने योग्य उपकरण।
- CLI विकास के लिए आदेश।

कस्टम `/api/*` रूट का उपयोग केवल तभी करें जब आपको रूट-आकार वाले प्रोटोकॉल या बाइनरी/स्ट्रीमिंग व्यवहार की आवश्यकता हो। [Actions](/docs/actions) देखें.

## एक-शॉट पाठ समापन {#complete-text}

अधिकांश AI कार्य एजेंट चैट के माध्यम से होना चाहिए ताकि उपयोगकर्ता देख सकें, संचालन कर सकें और ऑडिट कर सकें
क्या हुआ. संकीर्ण सर्वर-साइड परिवर्तनों के लिए जिनकी जानबूझकर आवश्यकता नहीं है
उपकरण, चैट इतिहास, या रन स्थिति, स्पष्ट एस्केप के रूप में `completeText()` का उपयोग करें
हैच.

```ts
// actions/classify-message.ts
import { defineAction } from "@agent-native/core/action";
import { completeText } from "@agent-native/core/server";
import { z } from "zod";

export default defineAction({
  description: "Classify a short message",
  schema: z.object({ body: z.string() }),
  run: async ({ body }) => {
    const result = await completeText({
      systemPrompt:
        "Return exactly one label: urgent, follow-up, waiting, or archive.",
      input: body,
      maxOutputTokens: 16,
      temperature: 0,
    });

    return { label: result.text.trim() };
  },
});
```

`completeText()` एजेंट के समान कॉन्फ़िगर इंजन परत के माध्यम से चलता है
चैट, जिसमें Builder, एंथ्रोपिक, AI SDK प्रदाता, उपयोगकर्ता/ऐप मॉडल डिफ़ॉल्ट शामिल हैं,
अनुरोध-दायरे वाले रहस्य, और इंजन-सामान्यीकृत त्रुटियाँ। यह केवल सर्वर है; मत करो
क्लाइंट कोड से मॉडल प्रदाताओं को कॉल करें। यदि ऑपरेशन उपयोगकर्ता-सामना वाला है, तो इसे लपेटें
एक कार्रवाई में इसलिए UI और एजेंट समान क्षमता साझा करते हैं।

## संदर्भ और पहुंच का अनुरोध करें {#request-context}

फ़्रेमवर्क द्वारा माउंट किया गया Actions स्वचालित रूप से अनुरोध संदर्भ के साथ चलता है। कस्टम मार्ग नहीं हैं. यदि कोई कस्टम रूट स्वामित्व योग्य संसाधनों को पढ़ता या लिखता है, तो सत्र लोड करें और कार्य को लपेटें:

```an-annotated-code title="Scoping a custom route to the request user"
{
  "filename": "server/routes/api/projects.get.ts",
  "language": "ts",
  "code": "import { defineEventHandler, createError } from \"h3\";\nimport { getSession, runWithRequestContext } from \"@agent-native/core/server\";\nimport { getDb } from \"../../db/index.js\";\nimport { accessFilter } from \"@agent-native/core/sharing\";\nimport * as schema from \"../../db/schema\";\n\nexport default defineEventHandler(async (event) => {\n  const session = await getSession(event);\n  if (!session?.email) {\n    throw createError({ statusCode: 401, statusMessage: \"Unauthorized\" });\n  }\n\n  return runWithRequestContext(\n    { userEmail: session.email, orgId: session.orgId },\n    async () => {\n      const db = getDb();\n      return db\n        .select()\n        .from(schema.projects)\n        .where(accessFilter(schema.projects, schema.projectShares));\n    },\n  );\n});",
  "annotations": [
    { "lines": "7-10", "label": "Custom routes have no auto-context", "note": "Unlike actions, a file route must load the session itself and fail closed when there is no authenticated user." },
    { "lines": "12-13", "label": "Establish request context", "note": "`runWithRequestContext` makes the user/org available to scoping helpers for the duration of the work." },
    { "lines": "18-19", "label": "Scope ownable reads", "note": "`accessFilter` constrains the query to rows the caller may see. Never run an unscoped `db.select().from(ownableTable)` here." }
  ]
}
```

`server/db/index.ts` में `createGetDb(schema)` के माध्यम से प्रति ऐप `getDb` बनाया जाता है, इसलिए कस्टम रूट इसे टेम्पलेट (`../../db/index.js`) से आयात करते हैं, `@agent-native/core/db` से नहीं; [Database — Where the DB Client Lives](/docs/database#db-client) देखें। कस्टम मार्गों में बिना दायरे वाले `db.select().from(ownableTable)` को न चलाएं।

## सर्वर प्लगइन्स {#server-plugins}

प्लगइन्स `server/plugins/` में रहते हैं और स्टार्टअप पर चलते हैं। माइग्रेशन, प्रदाता सेटअप, आवर्ती नौकरियों, एकीकरण एडाप्टर और फ्रेमवर्क प्लगइन कॉन्फ़िगरेशन के लिए उनका उपयोग करें।

```ts
// server/plugins/db.ts
import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    },
  ],
  { table: "my_app_migrations" },
);
```

माइग्रेशन योगात्मक होना चाहिए। स्टार्टअप प्लगइन्स में कभी भी विनाशकारी SQL न डालें।

## फ्रेमवर्क-माउंटेड रूट {#framework-routes}

फ्रेमवर्क `/_agent-native/` के तहत अपने स्वयं के मार्गों को माउंट करता है। उस नामस्थान को आरक्षित मानें।

| रूट उपसर्ग                       | उद्देश्य                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `/_agent-native/actions/:name`   | कार्रवाई HTTP समापन बिंदु                                                       |
| `/_agent-native/agent-chat`      | एजेंट चैट लूप                                                                   |
| `/_agent-native/poll`            | SQL-समर्थित UI सिंक                                                             |
| `/_agent-native/resources/*`     | कार्यस्थान संसाधन                                                               |
| `/_agent-native/extensions/*`    | रनटाइम एक्सटेंशन और एक्सटेंशन प्रॉक्सी (विरासत उपनाम: `/_agent-native/tools/*`) |
| `/_agent-native/integrations/*`  | मैसेजिंग/वेबहुक एकीकरण                                                          |
| `/_agent-native/a2a`             | एजेंट-से-एजेंट JSON-RPC                                                         |
| `/_agent-native/mcp`             | MCP समापन बिंदु                                                                 |
| `/_agent-native/onboarding/*`    | सेटअप चेकलिस्ट                                                                  |
| `/_agent-native/observability/*` | निशान, फीडबैक, मूल्यांकन, प्रयोग                                                |
| `/_agent-native/file-upload`     | फ़ाइल अपलोड प्रदाता समापन बिंदु                                                 |

कस्टम ऐप रूट को `/api/*`, सार्वजनिक ऐप पथ, या प्रदाता-विशिष्ट कॉलबैक पथ का उपयोग करना चाहिए जो `/_agent-native/` से नहीं टकराते।

## SQL-समर्थित सिंक {#sync}

एजेंट-नेटिव फ़ाइल सिस्टम पर नजर रखने वालों या स्टिकी इन-मेमोरी स्थिति पर भरोसा नहीं करता है। जब actions या फ्रेमवर्क सहायक डेटा को बदलते हैं, तो डेटाबेस सिंक संस्करण बढ़ता है। क्लाइंट `useDbSync()` हुक पोल `/_agent-native/poll` करता है और React क्वेरी कैश को अमान्य कर देता है।

यह सर्वर रहित और मल्टी-इंस्टेंस परिनियोजन पर काम करता है क्योंकि डेटाबेस समन्वय बिंदु है। यदि आप actions के बाहर कस्टम म्यूटेशन लिखते हैं, तो फ्रेमवर्क हेल्पर्स का उपयोग करें या उचित सिंक अमान्यकरण का उत्सर्जन करें, इसलिए UIs रिफ्रेश खोलें।

```an-diagram title="SQL-backed sync loop" summary="No watchers, no sticky state. A write bumps a version in SQL; every client polls the version and refetches."
{
  "html": "<div class=\"diagram-sync\"><div class=\"diagram-box\" data-rough>Action / helper<br><small class=\"diagram-muted\">mutates data</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\" data-rough><strong>SQL database</strong><small class=\"diagram-muted\">sync version increments</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&larr;</div><div class=\"diagram-col\"><div class=\"diagram-node\">useDbSync()<br><small class=\"diagram-muted\">polls /_agent-native/poll</small></div><div class=\"diagram-pill ok\">invalidate caches &rarr; UI refreshes</div></div></div>",
  "css": ".diagram-sync{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-sync .diagram-col{display:flex;flex-direction:column;gap:8px;align-items:flex-start}.diagram-sync .diagram-arrow{font-size:22px;line-height:1}"
}
```

```an-api title="The poll endpoint" method="GET" path="/_agent-native/poll"
{
  "method": "GET",
  "path": "/_agent-native/poll",
  "summary": "Return the current per-source database sync versions so the client can detect changes.",
  "description": "`useDbSync()` calls this on an interval (and falls back to it when SSE is unavailable). When a returned version is higher than the client's last-seen value, the matching React Query caches are invalidated and refetch.",
  "auth": "Session cookie (request-scoped identity)",
  "responses": [
    { "status": "200", "description": "Current sync versions keyed by source." }
  ]
}
```

## Webhooks {#webhooks}

इनबाउंड webhooks को सत्यापित करना चाहिए, जारी रखना चाहिए और जल्दी वापस लौटना चाहिए। लंबे समय तक चलने वाले एजेंट कार्य को एकीकरण कतार पैटर्न का उपयोग करना चाहिए:

1. प्लेटफ़ॉर्म हस्ताक्षर या चुनौती को सत्यापित करें।
2. SQL में टिकाऊ कार्य डालें।
3. हस्ताक्षरित प्रोसेसर रूट को स्वयं सक्रिय करें।
4. तुरंत 200 वापस करें।
5. ताजा प्रोसेसर निष्पादन को एजेंट लूप चलाने दें और परिणाम पोस्ट करें।

```an-diagram title="Integration queue pattern" summary="The webhook handler returns in milliseconds; a separate signed execution runs the slow agent work."
{
  "html": "<div class=\"diagram-webhook\"><div class=\"diagram-box\" data-rough>Inbound webhook<br><small class=\"diagram-muted\">Slack · Stripe · email</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\" data-rough><strong>Handler</strong><div class=\"diagram-step\"><span class=\"diagram-pill\">1</span><small class=\"diagram-muted\">verify signature</small></div><div class=\"diagram-step\"><span class=\"diagram-pill\">2</span><small class=\"diagram-muted\">insert work into SQL</small></div><div class=\"diagram-step\"><span class=\"diagram-pill\">3</span><small class=\"diagram-muted\">self-fire processor</small></div><div class=\"diagram-step\"><span class=\"diagram-pill ok\">4</span><small class=\"diagram-muted\">return 200 now</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Signed processor<br><small class=\"diagram-muted\">runs agent loop, posts result</small></div></div>",
  "css": ".diagram-webhook{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-webhook .diagram-panel{display:flex;flex-direction:column;gap:6px;padding:14px 16px}.diagram-webhook .diagram-step{display:flex;align-items:center;gap:8px}.diagram-webhook .diagram-arrow{font-size:22px;line-height:1}"
}
```

> [!WARNING]
> प्रतिक्रिया देने के बाद अप्रतीक्षित वादों पर भरोसा न करें - सर्वर रहित होस्ट निष्पादन को रोक देते हैं। विहित एकीकरण कतार के लिए [Messaging](/docs/messaging) देखें।

## उन्नत: एस्केप हैच {#advanced-escape-hatches}

अधिकांश टेम्प्लेट को कभी भी इनकी आवश्यकता नहीं होती है। Nitro फ़ाइल रूट और फ़्रेमवर्क का एजेंट
चैट प्लगइन पहले से ही ऐप सर्वर और प्रोडक्शन एजेंट हैंडलर को वायर अप कर देता है।
केवल तभी उन तक पहुंचें जब आप
मानक टेम्पलेट प्लगइन स्टैक।

### प्रोग्रामेटिक H3 सर्वर {#create-server}

कस्टम पैकेज या परीक्षणों के लिए जिन्हें सीधे H3 ऐप की आवश्यकता होती है, `createServer()`
एक पूर्व-कॉन्फ़िगर किया गया ऐप और राउटर लौटाता है:

```ts
import { createServer } from "@agent-native/core/server";
import { defineEventHandler } from "h3";

const { app, router } = createServer();

router.get(
  "/api/health",
  defineEventHandler(() => ({ ok: true })),
);
```

### प्रोडक्शन एजेंट हैंडलर {#agent-handler}

फ्रेमवर्क का एजेंट चैट प्लगइन पहले से ही प्रोडक्शन एजेंट हैंडलर को माउंट करता है
टेम्प्लेट के लिए। निर्माण करते समय केवल `createProductionAgentHandler()` पर सीधे कॉल करें
मानक टेम्पलेट प्लगइन स्टैक के बाहर एक कस्टम सर्वर एकीकरण -
अन्यथा एजेंट को `AGENTS.md`, skills, actions, और के माध्यम से अनुकूलित करें
एजेंट चैट प्लगइन.

```ts
import { createProductionAgentHandler } from "@agent-native/core/server";

const handler = createProductionAgentHandler({
  scripts,
  systemPrompt: "You are the app agent...",
});
```
