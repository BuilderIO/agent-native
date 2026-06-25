---
title: "Actions"
description: "defineAction - एकल परिभाषा जो एक एजेंट टूल, टाइप किए गए फ्रंटएंड हुक, फ्रेमवर्क ट्रांसपोर्ट, एक MCP टूल और एक CLI कमांड बन जाती है।"
---

# Actions

Actions आपके ऐप द्वारा किए जाने वाले किसी भी काम के लिए सत्य का एकमात्र स्रोत है। `defineAction()` के साथ एक बार एक क्रिया को परिभाषित करें, इसे `actions/` में छोड़ें, और यह तुरंत इस रूप में उपलब्ध है:

- **एक एजेंट टूल** - एजेंट इसे राशि-व्युत्पन्न JSON स्कीमा के साथ देखता है और इसे चैट में कॉल कर सकता है।
- **टाइपसेफ React हुक** - फ्रंटएंड पर `useActionQuery("name")` और `useActionMutation("name")`, स्कीमा से अनुमानित प्रकार।
- **अनिवार्य क्लाइंट कॉल** - `callAction("name", params)` जब कोई हुक फिट नहीं होता है।
- **फ्रेमवर्क ट्रांसपोर्ट** - उन हुक के पीछे फ्रेमवर्क द्वारा स्वचालित रूप से माउंट किया गया और बाहरी HTTP क्लाइंट के लिए उपलब्ध है।
- **एक MCP टूल** - Claude, ChatGPT कस्टम MCP ऐप्स, Claude डेस्कटॉप/कोड, कर्सर, Codex और किसी अन्य MCP क्लाइंट के संपर्क में है।
- **एक A2A टूल** - जिसे A2A पर अन्य एजेंट-नेटिव ऐप्स द्वारा बुलाया जाता है।
- **एक CLI कमांड** - स्क्रिप्टिंग और डेव लूप के लिए `pnpm action <name>`।

एक परिभाषा, सात उपभोक्ता। यह [ladder](/docs/what-is-agent-native#the-ladder) का तीसरा पायदान है।
यदि आप निर्णय ले रहे हैं कि किसी ऑपरेशन को बिना सोचे-समझे, चैट में, किसी में उजागर करना है या नहीं
एम्बेडेड साइडकार, या पूर्ण ऐप स्क्रीन के रूप में, [Agent Surfaces](/docs/agent-surfaces) देखें।

```an-diagram title="एक परिभाषा, सात उपभोक्ता" summary="एक मान्य स्कीमा और एक रन() बॉडी के साथ एक एकल defineAction() हर सतह - एजेंट, UI, HTTP, MCP, A2A, और CLI को संचालित करता है।"
{
  "html": "<div class=\"diagram-fanout\"><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">defineAction()</span><small class=\"diagram-muted\">schema + run(), एक बार परिभाषित</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-grid\"><div class=\"diagram-node\">एजेंट टूल<br><small class=\"diagram-muted\">संदर्भ में JSON Schema</small></div><div class=\"diagram-node\">React हुक्स हुक<br><small class=\"diagram-muted\">useActionQuery/Mutation</small></div><div class=\"diagram-node\">callAction()<br><small class=\"diagram-muted\">इम्पेरेटिव क्लाइंट</small></div><div class=\"diagram-node\">HTTP<br><small class=\"diagram-muted\">/_agent-native/actions/:name</small></div><div class=\"diagram-node\">MCP टूल<br><small class=\"diagram-muted\">बाहरी होस्ट</small></div><div class=\"diagram-node\">A2A टूल<br><small class=\"diagram-muted\">अन्य agent-native ऐप्स</small></div><div class=\"diagram-node\">CLI<br><small class=\"diagram-muted\">pnpm action &lt;name&gt;</small></div></div></div>",
  "css": ".diagram-fanout{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-fanout .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 16px}.diagram-fanout .diagram-arrow{font-size:22px;line-height:1}.diagram-fanout .diagram-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}"
}
```

यदि UI और एजेंट दोनों को कुछ करने की ज़रूरत है, तो कार्रवाई के लिए पहुंचें - कस्टम नहीं
मार्ग. जब रूट-आकार का प्रोटोकॉल सही कॉल होता है, तो देखें [Actions को प्राथमिकता दें
ऐप संचालन के लिए](/docs/server#actions-first).

## एक क्रिया से प्रारंभ करें {#hello-action}

आदिम-प्रथम ऑन-रैंप एक क्रिया है, कोई टेम्पलेट नहीं। बिना सिर के
मचान जैसे `agent-native create my-agent --headless`, यह हो सकता है
संपूर्ण पहला ऐप:

```ts
// actions/hello.ts
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description: "Local agent से hello कहें।",
  schema: z.object({
    name: z.string().default("world"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ name }) => {
    return { message: `Hello, ${name}!` };
  },
});
```

इसे उसी फ़ोल्डर से चलाएँ:

```bash
pnpm action hello '{"name":"Steve"}'
```

CLI एक JSON ऑब्जेक्ट को एक्शन इनपुट के रूप में स्वीकार करता है, जो संरचित से मेल खाता है
टूल कॉल एजेंट पहले ही कर देते हैं। त्वरित मैन्युअल रन के लिए सरल झंडे अभी भी काम करते हैं:

```bash
pnpm action hello --name Steve
```

फिर फ़ोल्डर के विरुद्ध ऐप-एजेंट लूप चलाएँ:

```bash
pnpm agent "Call hello for Steve and explain the result"
```

यह वही ऐप-एजेंट लूप है जो आपकी निर्धारित नौकरियां, चैट UI, बाहरी MCP
उपकरण, और भविष्य की स्क्रीन का उपयोग किया जाएगा। चैट और डोमेन टेम्प्लेट UI
actions के आसपास, कार्रवाई के लिए कोई आवश्यक शर्त नहीं है।

## किसी क्रिया को परिभाषित करना {#defining}

```an-annotated-code title="किसी क्रिया की शारीरिक रचना"
{
  "filename": "actions/reply-to-email.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { z } from \"zod\";\n\nexport default defineAction({\n  description: \"Reply to an email thread in the user's voice.\",\n  schema: z.object({\n    emailId: z.string().describe(\"The id of the email to reply to.\"),\n    body: z.string().describe(\"The reply body, in markdown.\"),\n  }),\n  run: async ({ emailId, body }) => {\n    await db.insert(replies).values({ emailId, body });\n    return { ok: true, emailId };\n  },\n});",
  "annotations": [
    { "lines": "5", "label": "टूल सतह", "note": "`description` वह पाठ है जिसे एजेंट यह तय करने के लिए पढ़ता है कि इसे कब कॉल करना है। हर फ़ील्ड की `.describe()` कॉल JSON Schema में भी जाती है।" },
    { "lines": "6-9", "label": "टाइप किया हुआ अनुबंध", "note": "एक schema **हर** सतह से आने वाले input को validate करता है और model के लिए JSON Schema में बदलता है। अमान्य input कभी `run` तक नहीं पहुंचते।" },
    { "lines": "10-13", "label": "एक कार्यान्वयन", "note": "`run` का मुख्य भाग ही भरोसेमंद स्रोत है — UI बटन और एजेंट टूल दोनों यही चलाते हैं।" }
  ]
}
```

बस इतना ही। फ्रेमवर्क `actions/` में प्रत्येक फ़ाइल को स्वतः खोजता है और उन्हें स्टार्टअप पर माउंट करता है।

### स्कीमा विकल्प {#schemas}

`schema` किसी भी [Standard Schema](https://standardschema.dev)-संगत लाइब्रेरी को स्वीकार करता है:

- **Zod** (v4) - सबसे आम, सबसे अच्छा प्रकार का अनुमान, JSON स्कीमा में स्वचालित रूप से परिवर्तित होता है।
- **Valibot** — यदि यह मायने रखता है तो न्यूनतम बंडल आकार।
- **आर्कटाइप** — यदि आपको वाक्यविन्यास पसंद है।

स्कीमा को Claude API टूल परिभाषा के लिए JSON स्कीमा में परिवर्तित किया जाता है, _and_ का उपयोग `run()` के सक्रिय होने से पहले इनपुट को सत्यापित करने के लिए रनटाइम पर किया जाता है। अमान्य इनपुट कभी भी आपके हैंडलर तक नहीं पहुंचते।

### वापसी मान को मान्य किया जा रहा है {#output-schema}

`schema` _इनपुट_ को मान्य करता है। यह सत्यापित करने के लिए कि कोई क्रिया क्या लौटाती है\*\*, एक `outputSchema` (कोई भी मानक स्कीमा-संगत स्कीमा - Zod, Valibot, ArkType, `schema` के समान सतह) पास करें। फ्रेमवर्क _after_ `run()` समाधानों के परिणाम को सत्यापित करता है, इनपुट सत्यापन के साथ रचना करता है: इनपुट `run` से पहले मान्य होता है, आउटपुट बाद में मान्य होता है।

```ts
export default defineAction({
  description: "Summarize a thread.",
  schema: z.object({ threadId: z.string() }),
  outputSchema: z.object({
    summary: z.string(),
    messageCount: z.number(),
  }),
  outputErrorStrategy: "warn", // default
  run: async ({ threadId }) => {
    /* ...returns { summary, messageCount } ... */
  },
});
```

`outputErrorStrategy` नियंत्रित करता है कि बेमेल होने पर क्या होता है:

| रणनीति       | बेमेल होने पर व्यवहार                                                                    |
| ------------ | ---------------------------------------------------------------------------------------- |
| `"warn"`     | **डिफ़ॉल्ट.** `console.warn` समस्याएँ और **मूल** परिणाम अपरिवर्तित लौटाएँ। न टूटने वाला. |
| `"strict"`   | एक स्पष्ट त्रुटि फेंकें ताकि एक गड़बड़ क्रिया जोर से सामने आए।                           |
| `"fallback"` | अमान्य परिणाम के स्थान पर प्रदान किया गया `outputFallback` मान लौटाएँ।                   |

सफलता पर, **मान्य** मान वापस कर दिया जाता है, इसलिए `outputSchema` पर परिभाषित कोई भी जबरदस्ती या डिफ़ॉल्ट प्रभावी होता है (इनपुट पथ को प्रतिबिंबित करता है)। जब कोई `outputSchema` आपूर्ति नहीं की जाती है, तो व्यवहार बाइट-दर-बाइट अपरिवर्तित होता है - कोई रैपिंग नहीं होती है। इसे मास्ट्रा/फ्लू स्ट्रक्चर्ड-आउटपुट से उधार लिया गया है और एक्शन लेयर पर निर्भरता-मुक्त रखा गया है।

### HTTP कॉन्फिगरेशन {#http}

डिफ़ॉल्ट रूप से प्रत्येक क्रिया `POST /_agent-native/actions/<name>` के रूप में प्रदर्शित होती है। `http` विकल्प के साथ ओवरराइड करें:

```ts
export default defineAction({
  description: "Get details for a lead.",
  schema: z.object({ leadId: z.string() }),
  http: { method: "GET" },
  run: async ({ leadId }) => {
    return await db.select().from(leads).where(eq(leads.id, leadId));
  },
});
```

`GET` कार्रवाई के लिए, `leadId` को क्वेरी पैरामीटर के रूप में पारित किया जाता है: `/_agent-native/actions/get-lead?leadId=abc`।

```an-api title="अपने आप mount हुआ action endpoint" method="GET" path="/_agent-native/actions/get-lead"
{
  "method": "GET",
  "path": "/_agent-native/actions/get-lead",
  "summary": "हर action यहां अपने आप mount होता है - filename ही action name है।",
  "description": "Default POST है; `http: { method: \"GET\" }` इसे GET बनाता है। React हुक्स हुक और `callAction` हमेशा इस path को name से call करते हैं, चाहे कोई भी `http.path` override हो।",
  "auth": "Session cookie; frontend calls `X-Agent-Native-Frontend: 1` लेकर चलते हैं",
  "params": [
    { "name": "leadId", "in": "query", "type": "string", "required": true, "description": "GET args query params के रूप में आते हैं; POST args JSON body में आते हैं।" }
  ],
  "responses": [
    { "status": "200", "description": "Action का return value JSON के रूप में।" },
    { "status": "400", "description": "run() चलने से पहले input schema validation में fail हुआ।" }
  ]
}
```

- **`http: { method: "GET" | "POST" | "PUT" | "DELETE" }`** — डिफ़ॉल्ट `POST`. `GET` actions स्वतः-चिह्नित `readOnly` हैं, इसलिए सफल कॉल UI पोल-रीफ्रेश को ट्रिगर नहीं करते हैं।
- **`http: { path: "..." }`** — `/_agent-native/actions/` के अंतर्गत माउंटेड URL को ओवरराइड करें। फ़ाइल नाम पर डिफ़ॉल्ट. **पथ ओवरराइड केवल प्रत्यक्ष HTTP कॉलर्स के लिए URL को बदलता है** - `useActionQuery`, `useActionMutation`, और `callAction` हमेशा इस ओवरराइड की परवाह किए बिना `/_agent-native/actions/<name>` को कॉल करते हैं, इसलिए पथ को ओवरराइड करने से वे हुक 404 हो जाते हैं। पथ ओवरराइड का उपयोग केवल बाहरी HTTP कॉलर्स के लिए करें। यह भी ध्यान दें कि ओवरराइड पथ में `:param` रूट सेगमेंट को `run()` आर्ग्स में **नहीं** पार्स किया गया है - केवल क्वेरी-स्ट्रिंग पैरामीटर और JSON बॉडी फ़ील्ड हैं।
- **`http: false`** - HTTP एंडपॉइंट को पूरी तरह से अक्षम करें। केवल एजेंट + CLI.
- **`readOnly: true`** - स्पष्ट रूप से उन POST actions के लिए भी पोल-रीफ्रेश को छोड़ दें जो उत्परिवर्तन नहीं करते हैं।
- **`parallelSafe: true`** - एक परिवर्तनशील क्रिया को अन्य समान-टर्न टूल कॉल के साथ समवर्ती रूप से चलाने की अनुमति दें। इसे केवल तभी सेट करें जब कार्रवाई आंतरिक रूप से समवर्ती-सुरक्षित और ऑर्डर-स्वतंत्र हो; actions को डिफ़ॉल्ट रूप से क्रमबद्ध रूप से बदलना।

### कार्य सतह को छोटा रखें {#small-surface}

एजेंट जो भी क्रिया देख सकता है वह मॉडल की संदर्भ विंडो में एक उपकरण है, और एक लंबी, ओवरलैपिंग टूल सूची मॉडल की टूल-चयन गुणवत्ता को खराब कर देती है। एक्शन सतह को आपके द्वारा बनाए गए API की तरह डिज़ाइन करें, प्रति UI खर्च पर एक एक्शन नहीं:

- **एक CRUD-शैली `update`** को प्राथमिकता दें जो N प्रति-फ़ील्ड actions (`update-name`, `update-order`, `update-color`,…) पर वैकल्पिक फ़ील्ड का एक पैच लेता है। कॉल करने वाला केवल वही भेजता है जो बदला है।
- प्रति क्वेरी/फ़िल्टर में एक नई पढ़ने की क्रिया जोड़ने से पहले, एक सामान्य एस्केप हैच तक पहुंचें: प्रदाता डेटा के लिए [provider API trio](/docs/template-dispatch) (`provider-api-catalog` / `provider-api-docs` / `provider-api-request`), या ऐप डेटा के लिए डेव `db-query` टूल।
- केवल UI या प्रोग्रामेटिक actions [`agentTool: false`](#agent-tool) को चिह्नित करें ताकि वे मॉडल की टूल सूची में एक स्लॉट खर्च किए बिना फ्रंटएंड/HTTP-कॉल करने योग्य बने रहें।
- actions को हटा दें या छिपा दें, UI अब उन्हें मॉडल के सामने खुला छोड़ देने के बजाय उपयोग नहीं करता है।

एक रेपो-स्तरीय सलाहकार सहायक, `node scripts/audit-template-actions.mjs [template ...]` (उर्फ `pnpm actions:audit`), टेम्पलेट के `actions/` को स्थिर रूप से स्कैन करता है और संभावित UI-मृत actions और अनावश्यक प्रति-फ़ील्ड क्लस्टर को चिह्नित करता है। यह केवल सलाहकारी है (हमेशा 0 से बाहर निकलता है, सीआई कभी विफल नहीं होता है) और रूढ़िवादी अनुमान का उपयोग करता है, इसलिए उन्हें त्रुटियों के रूप में मानने के बजाय इसके सुझावों की समीक्षा करें।

### एक्सपोज़र फ़्लैग {#exposure-flags}

चार झंडे नियंत्रित करते हैं कि कौन कार्रवाई शुरू कर सकता है। सभी डिफ़ॉल्ट अनुमेय मान पर हैं, इसलिए आप केवल एक विशिष्ट सतह को कसने के लिए सेट करते हैं। यह तालिका देखने योग्य सारांश है; उप-अनुभाग प्रत्येक के लिए आवश्यक एक विवरण जोड़ते हैं।

| झंडा            | डिफ़ॉल्ट   | प्रतिबंधात्मक मान → कौन अभी भी कॉल कर सकता है                                     | सामान्य उपयोग                                                       |
| --------------- | ---------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `agentTool`     | `true`     | `false` → UI, HTTP, CLI केवल - **मॉडल से छिपा हुआ**, MCP, और A2A                  | UI-केवल / प्रोग्रामेटिक actions जिसे टूल स्लॉट खर्च नहीं करना चाहिए |
| `toolCallable`  | `true`     | `false` → सब कुछ **सैंडबॉक्स्ड एक्सटेंशन आईफ्रेम ब्रिज (403) को छोड़कर**          | प्रामाणिक-आसन्न ऑप्स (खाता हटाएं, संगठन सदस्यता/भूमिकाएं बदलें)     |
| `publicAgent`   | बंद (निजी) | `{ expose: true }` → कार्रवाई को **सार्वजनिक** MCP/A2A/OpenAPI सतहों पर जोड़ता है | बिना प्रमाणीकरण के पहुंच योग्य सुरक्षित पढ़ने/निगलने वाले उपकरण     |
| `needsApproval` | `false`    | `true` → एजेंट **रुकता है**; एक इंसान को विशिष्ट कॉल को मंजूरी देनी होगी          | परिणामी दुष्प्रभाव (ईमेल भेजें, कार्ड चार्ज करें, हटाएं)            |

ये स्वतंत्र हैं: `agentTool` मॉडल के दृश्य को नियंत्रित करता है, `toolCallable` केवल एक्सटेंशन iframe को नियंत्रित करता है, `publicAgent` एक ऑप्ट-इन सार्वजनिक सतह जोड़ता है (सार्वजनिक वेब रूट कभी भी सार्वजनिक टूल एक्सपोज़र का संकेत नहीं देते हैं), और `needsApproval` कॉल करने के बाद निष्पादन को गेट करता है - नीचे [Human-in-the-loop approval](#needs-approval) देखें।

#### `agentTool` — मॉडल से छिपाएँ {#agent-tool}

डिफ़ॉल्ट रूप से प्रत्येक क्रिया एक कॉल करने योग्य एजेंट टूल है। प्रत्येक एजेंट टूल सूची से इसे हटाते समय इसे फ्रेमवर्क के ऑथ + एक्शन सतह के पीछे रखने के लिए `agentTool: false` सेट करें - यह UI (`useActionMutation` / `callAction`), CLI, और `/_agent-native/actions/<name>` से कॉल करने योग्य रहता है:

```ts
export default defineAction({
  description: "Persist the user's sidebar width.",
  agentTool: false, // UI-only — not a tool in the model's context window
  schema: z.object({ widthPx: z.number() }),
  http: { method: "PUT" },
  run: async ({ widthPx }) => {
    /* ... */
  },
});
```

जब आप केवल UI-या पूरी तरह से प्रोग्रामेटिक क्रिया जोड़ते हैं, या जब UI किसी ऐसी क्रिया का उपयोग करना बंद कर देता है जिसे आप अन्यथा मॉडल के संपर्क में छोड़ देते हैं, तो उस तक पहुंचें।

#### `toolCallable` - एक्सटेंशन आईफ्रेम को ब्लॉक करें {#tool-callable}

एक्सटेंशन ([Alpine.js mini-apps in sandboxed iframes](/docs/extensions)) `appAction(name, params)` के माध्यम से actions को कॉल करते हैं, जो दर्शक की अनुमतियों, रहस्यों और SQL दायरे के साथ चल रहा है। उच्च-विस्फोट-त्रिज्या संचालन के लिए यह डिफ़ॉल्ट रूप से बहुत अधिक भरोसेमंद है। UI, एजेंट, CLI, MCP, और A2A से कार्रवाई को कॉल करने योग्य रखते हुए एक्सटेंशन ब्रिज को 403 पर वापस लाने के लिए `toolCallable: false` सेट करें:

```ts
export default defineAction({
  description: "Delete the current user's account.",
  toolCallable: false, // never callable from an extension iframe
  schema: z.object({ confirm: z.literal("yes") }),
  run: async () => {
    /* ... */
  },
});
```

actions के लिए इसका उपयोग करें जो खातों/संगठनों को हटाता है या स्थानांतरित करता है, प्रमाणीकरण स्थिति बदलता है, संगठन सदस्यता को संशोधित करता है, या शेयर पहुंच प्रदान करता है। फ़्रेमवर्क के अंतर्निहित `share-resource`, `unshare-resource`, और `set-resource-visibility` पहले से ही ऑप्ट आउट हैं। प्रवर्तन आईफ्रेम कॉल पर एक अचूक होस्ट-सेट हेडर द्वारा होता है; नियमित UI/एजेंट/CLI/MCP/A2A कॉल अप्रभावित हैं - विवरण के लिए [Security](/docs/security) देखें।

### संदर्भ चलाएँ (दूसरा तर्क) {#run-context}

`run` को एक वैकल्पिक दूसरा तर्क, `ctx` प्राप्त होता है, जिसमें हल किए गए अनुरोध की पहचान और कार्रवाई को लागू करने वाली सतह होती है। `getRequestUserEmail()` / `getRequestOrgId()` को हाथ से कॉल करने के बजाय इसे पढ़ें, और संपूर्ण `ctx` को ट्रैकिंग पर पास करें:

```ts
export default defineAction({
  description: "Log an audit entry for the current request.",
  schema: z.object({ event: z.string() }),
  run: async (args, ctx) => {
    // ctx is undefined-safe: a 1-arg `run(args)` is still valid.
    const actor = ctx?.userEmail ?? "system";
    if (ctx?.caller === "frontend") {
      // tighter rules for browser-initiated calls, looser for "tool"/"cli"
    }
    await db.insert(audit).values({
      actor,
      orgId: ctx?.orgId ?? null,
      source: ctx?.caller ?? "unknown",
      event: args.event,
    });
    return { ok: true };
  },
});
```

`ActionRunContext` फ़ील्ड:

| फ़ील्ड        | प्रकार                  | नोट्स                                                                                                                                                           |
| ------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `userEmail`   | `string \| undefined`   | Resolved request user. **Never defaulted to a dev identity** — `undefined` when the request has no authenticated user. Apply your own fallback if you need one. |
| `orgId`       | `string \| null`        | Resolved org id, or `null` when the request has no org.                                                                                                         |
| `caller`      | `ActionCaller`          | कार्रवाई कैसे लागू की गई (नीचे देखें)।                                                                                                                          |
| `send`        | `(event) => void`       | वैकल्पिक. क्लाइंट को एक SSE ईवेंट भेजें। केवल एजेंट टूल लूप (`caller: "tool"`) के अंदर मौजूद है; `undefined` अन्यत्र।                                           |
| `attachments` | `AgentChatAttachment[]` | वर्तमान एजेंट टर्न के साथ सबमिट की गई फ़ाइलें, छवियां और चिपकाए गए टेक्स्ट ब्लॉक। केवल तभी आबाद हुआ जब `caller: "tool"`; अन्य सभी सतहों पर `undefined`.         |

`caller` संघ `"tool" | "http" | "frontend" | "cli" | "mcp" | "a2a"` है:

| `caller`     | सेट करें जब...                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `"tool"`     | इन-ऐप एजेंट लूप, एक उप-एजेंट / एजेंट टीम, या एक A2A अनुरोध (A2A एक ही एजेंट लूप चलाता है, इसलिए इसके टूल कॉल `"tool"` हैं)।                 |
| `"frontend"` | `useActionMutation` / `useActionQuery` / `callAction` के माध्यम से एक ब्राउज़र कॉल (`X-Agent-Native-Frontend: 1` हेडर के साथ टैग किया गया)। |
| `"http"`     | फ्रंटएंड मार्कर के बिना एक नंगे प्रोग्रामेटिक `POST` / `GET` से `/_agent-native/actions/<name>` तक।                                         |
| `"cli"`      | `pnpm action <name>` (CLI धावक)।                                                                                                            |
| `"mcp"`      | MCP `tools/call` समापन बिंदु पर एक बाहरी एजेंट।                                                                                             |
| `"a2a"`      | भविष्य में प्रत्यक्ष A2A कार्रवाई प्रेषण के लिए आरक्षित। आज A2A एजेंट लूप के माध्यम से चलता है, इसलिए वे कॉल `"tool"` हैं।                  |

`run` पिछड़े संगत रहता है: मौजूदा 1-तर्क हैंडलर और हैंडलर जो केवल `{ send }` को नष्ट करते हैं, अपरिवर्तित काम करना जारी रखते हैं।

### actions में अभिगम नियंत्रण {#access-control}

उपयोगकर्ता के स्वामित्व वाली तालिकाओं को `accessFilter` के माध्यम से पढ़ना चाहिए और `assertAccess` के माध्यम से लिखना चाहिए - वही सहायक जो फ्रेमवर्क के साझाकरण सिस्टम का उपयोग करता है। यहां एक संपूर्ण, पेस्ट-तैयार उदाहरण है:

```ts
// actions/create-lead.ts
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import * as schema from "../server/db/schema.js";

export default defineAction({
  description: "Create a lead in the CRM.",
  schema: z.object({ name: z.string(), company: z.string() }),
  run: async ({ name, company }, ctx) => {
    const db = getDb();
    await db.insert(schema.leads).values({
      id: crypto.randomUUID(),
      name,
      company,
      ownerEmail: ctx?.userEmail ?? "system",
    });
    return { ok: true };
  },
});
```

actions को सूचीबद्ध करने और पढ़ने के लिए, मौजूदा उपयोगकर्ता और संगठन तक क्वेरी का दायरा बढ़ाने के लिए `accessFilter` का उपयोग करें। actions के लिए जो किसी विशिष्ट पंक्ति को अद्यतन या हटाता है, लिखने से पहले कॉलर को अनुमति की पुष्टि करने के लिए `assertAccess` का उपयोग करें। पूर्ण सहायक API के लिए [Security](/docs/security#access-guards) और [Sharing](/docs/sharing) देखें।

### मानव-इन-द-लूप अनुमोदन {#needs-approval}

मुट्ठी भर actions एजेंट को स्वायत्त रूप से चलने देने के लिए बहुत अधिक परिणामी हैं - एक ईमेल भेजना, एक कार्ड चार्ज करना, एक खाता हटाना। उनके लिए, लूप को रोकने के लिए `needsApproval` सेट करें और `run()` निष्पादित होने से पहले एक मानव को विशिष्ट कॉल को मंजूरी देने की आवश्यकता है:

```ts
export default defineAction({
  description: "Send an email via Gmail.",
  schema: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
  needsApproval: true, // pause; a human must approve this specific send
  run: async (args) => {
    /* ...actually send... */
  },
});
```

`needsApproval` भी सशर्त रूप से गेट करने के लिए एक विधेय `(args, ctx) => boolean | Promise<boolean>` स्वीकार करता है (उदाहरण के लिए केवल बाहरी प्राप्तकर्ता, केवल एक सीमा से ऊपर); यह **बंद होने में विफल रहता है**, इसलिए एक थ्रो को "अनुमोदन आवश्यक" के रूप में गिना जाता है। जब गेट सत्य और अस्वीकृत होता है, तो लूप टर्न बंद कर देता है और साइड इफेक्ट तब तक सक्रिय नहीं होता जब तक कोई मानव चैट UI में अनुमोदन नहीं कर देता।

> [!WARNING]
> स्वीकृतियां दुर्लभ रखें। प्रत्येक गेटेड कार्रवाई एजेंट लूप में एक कठिन पड़ाव है। डिफ़ॉल्ट **बंद** है, और लगभग हर कार्रवाई में इसे बंद रहना चाहिए। विधेय API, `approval_required` घटना और पूर्ण प्रवाह के लिए [Human-in-the-Loop Approvals](/docs/human-approval) देखें।

### ऑडिट लॉगिंग {#audit}

प्रत्येक परिवर्तनशील कार्रवाई का **स्वचालित रूप से ऑडिट किया जाता है** - फ्रेमवर्क रिकॉर्ड करता है कि इसे किसने, कब, किस सतह से चलाया, और (जब यह एजेंट था) कौन सा थ्रेड/टर्न, क्रेडेंशियल-रिडक्टेड इनपुट के साथ। केवल पढ़ने योग्य (`GET`) actions को छोड़ दिया गया है। आप इसके लिए कोई कोड नहीं लिखते; यह `defineAction` सीम पर होता है।

एक `audit` ब्लॉक को केवल _tune_ कैप्चर में जोड़ें - यह संसाधन को घोषित करने के लिए सबसे उपयोगी है कि कार्रवाई बदल गई है ताकि परिवर्तन उस संसाधन के मालिक के निशान में दिखाई दे:

```ts
export default defineAction({
  description: "Delete a recording.",
  schema: z.object({ id: z.string() }),
  audit: {
    target: (args, result) => ({ type: "recording", id: args.id }),
    summary: (args) => `Deleted recording ${args.id}`,
  },
  run: async (args, ctx) => {
    /* ...delete... */
  },
});
```

अन्य नॉब्स: `audit: { onRead: true }` एक संवेदनशील रीड (गुप्त पहुंच, थोक निर्यात) का ऑडिट करता है; `audit: { enabled: false }` शोर-शराबे वाले लेखन का विकल्प चुनता है; `audit: { recordInputs: false }` तर्कों को कैप्चर करना छोड़ देता है। अंतर्निहित `list-audit-events` / `get-audit-event` actions के साथ ट्रेल को पढ़ें। [Audit Log](/docs/audit-log) में पूरी जानकारी।

## इसे UI से कॉल कर रहा हूं {#ui}

दो हुक, दोनों `@agent-native/core/client` में। प्रकार का अनुमान आपके `defineAction` स्कीमा से लगाया जाता है - कोई मैन्युअल प्रकार की घोषणा नहीं।

### `useActionMutation` {#use-action-mutation}

actions के लिए जो स्थिति बदलता है:

```tsx
import { useActionMutation } from "@agent-native/core/client";

const { mutate, isPending } = useActionMutation("reply-to-email");

<Button
  disabled={isPending}
  onClick={() => mutate({ emailId, body: "Thanks!" })}
>
  Send Reply
</Button>;
```

सफलता पर, फ्रेमवर्क `source: "action"` के साथ एक परिवर्तन घटना उत्सर्जित करता है ताकि `useActionQuery` उपभोक्ता और सक्रिय क्वेरी पर्यवेक्षक स्वचालित रूप से पुनः प्राप्त हो जाएं। [Live Sync](/docs/key-concepts#polling-sync) देखें.

### `useActionQuery` {#use-action-query}

केवल पढ़ने के लिए GET actions के लिए:

```ts
import { useActionQuery } from "@agent-native/core/client";

const { data, isLoading } = useActionQuery("get-lead", { leadId });
```

क्वेरी को `["action", "get-lead", { leadId }]` के अंतर्गत कैश किया जाता है और किसी भी परिवर्तनशील कार्रवाई के पूरा होने पर स्वतः-अमान्य कर दिया जाता है।

## मूल चैट UI प्रस्तुत करना {#native-chat-ui}

Actions संरचित विजेट डेटा लौटा सकता है जो इन-ऐप चैट प्रस्तुत करता है
मूल रूप से। यह पुन: प्रयोज्य तालिकाओं, चार्ट, सेटअप के लिए प्रथम-पक्ष चैट पथ है
summaries, and insight cards; use [MCP Apps](/docs/mcp-apps) for inline UI in
बाहरी MCP होस्ट।

```ts
import { defineAction } from "@agent-native/core/action";
import { ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER } from "@agent-native/core/action-ui";
import {
  createDataInsightsWidgetResult,
  dataInsightsWidgetResultSchema,
} from "@agent-native/core/data-widgets";

export default defineAction({
  description: "Summarize response trends.",
  readOnly: true,
  outputSchema: dataInsightsWidgetResultSchema,
  chatUI: { renderer: ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER },
  run: async () =>
    createDataInsightsWidgetResult({
      title: "Response trends",
      chartSeries: {
        type: "line",
        xKey: "day",
        series: [{ key: "responses", label: "Responses" }],
        data: [
          { day: "Mon", responses: 12 },
          { day: "Tue", responses: 18 },
        ],
      },
      table: {
        columns: [
          { key: "day", label: "Day" },
          { key: "responses", label: "Responses", align: "right" },
        ],
        rows: [
          { day: "Mon", responses: 12 },
          { day: "Tue", responses: 18 },
        ],
      },
    }),
});
```

अंतर्निहित विभेदक `"data-table"`, `"data-chart"`, और
`"data-insights"`, सर्वर-सुरक्षित बिल्डरों और स्कीमा के साथ
`@agent-native/core/data-widgets`. [Native चैट UI](/docs/native-chat-ui)
पूर्ण परिणाम अनुबंध और BYO रनटाइम मार्गदर्शन के लिए, या
[Agent Surfaces](/docs/agent-surfaces) कि समान क्रिया कैसे बनी रह सकती है
हेडलेस, चैट में प्रस्तुत करना, या पूर्ण स्क्रीन में विकसित होना।

## इसे CLI से कॉल किया जा रहा है {#cli}

प्रत्येक क्रिया `pnpm action` के माध्यम से चलने योग्य है:

```bash
pnpm action reply-to-email '{"emailId":"thread-123","body":"Thanks!"}'
```

JSON इनपुट एजेंटों और जटिल वस्तुओं के लिए पसंदीदा आकार है। झंडे हैं
सरल मैन्युअल रन और मौजूदा के लिए अभी भी उसी स्कीमा आकार में पार्स किया गया है
स्क्रिप्ट. एजेंट-डेव लूप, स्क्रिप्ट और क्रॉन के लिए उपयोगी।

## इसे किसी अन्य एजेंट से कॉल करना (A2A) {#a2a}

यदि आपका ऐप एक [A2A](/docs/a2a-protocol) सहकर्मी है, तो अन्य एजेंट-मूल ऐप्स आपके actions को स्वचालित रूप से खोजते हैं और उन्हें नाम से कॉल कर सकते हैं। समान-मूल परिनियोजन JWT हस्ताक्षर करना छोड़ देते हैं; क्रॉस-ओरिजिन एक साझा `A2A_SECRET` का उपयोग करता है।

## इसे MCP पर उजागर करना {#mcp}

MCP सक्षम होने पर, आपका actions फ्रेमवर्क के MCP सर्वर में `/_agent-native/mcp` पर दिखाई देता है। प्रत्येक कॉल करने वाले को डिफ़ॉल्ट रूप से एक कॉम्पैक्ट कैटलॉग मिलता है - ऐप-फेसिंग बिल्टिन और टेम्पलेट-घोषित ऐप actions - और `tool-search` हमेशा मौजूद रहता है ताकि कोई भी अन्य टूल मांग पर उपलब्ध रहे। पूर्ण क्रिया सतह केवल स्पष्ट ऑप्ट-इन (`--full-catalog` टोकन या `AGENT_NATIVE_MCP_FULL_CATALOG=1`) पर प्रदान की जाती है, और `publicAgent.expose` सार्वजनिक सतह पर एक सुरक्षित रीड/इन्जेस्ट टूल का विकल्प चुनता है। कैटलॉग टियर, ऑथ और `mcpApp` संसाधन विवरण के लिए [MCP Protocol](/docs/mcp-protocol) देखें।

UI-सक्षम MCP होस्ट के लिए, एक क्रिया `mcpApp` फ़ील्ड (साथ ही एक मिलान `link`) के माध्यम से एक वैकल्पिक MCP ऐप्स संसाधन घोषित कर सकती है ताकि सक्षम होस्ट परिणाम इनलाइन प्रस्तुत कर सकें। जब `link` और `mcpApp` को एक ही मार्ग पर इंगित करना चाहिए, तो `embedRoute()` दोनों को एक शुद्ध पथ बिल्डर से बनाता है:

```ts
import { embedRoute } from "@agent-native/core";

export default defineAction({
  description: "Create an email draft for review.",
  schema: z.object({ body: z.string() }),
  run: async ({ body }) => ({ body }),
  ...embedRoute({
    title: "Review draft",
    openLabel: "Open in Mail",
    path: ({ result }) => ({
      label: "Open draft in Mail",
      url: "/_agent-native/open?app=mail&view=inbox",
    }),
  }),
});
```

CLI और गैर-UI MCP ग्राहकों के लिए `link` को फ़ॉलबैक के रूप में रखें; यह एंबेड का लॉन्च लक्ष्य भी है। एंबेड ब्रिज - हस्ताक्षरित एंबेड-स्टार्ट सत्र, ट्रांसप्लांट बनाम नियंत्रित-फ़्रेम रेंडरिंग, `ui/*` होस्ट ब्रिज, CSP, और ऊंचाई क्लैंपिंग - [External Agents](/docs/external-agents#mcp-app-bridge) के स्वामित्व में है।

## मानक actions {#standard-actions}

प्रत्येक टेम्पलेट में [context awareness](/docs/context-awareness) के लिए ये दोनों शामिल होने चाहिए:

### व्यू-स्क्रीन {#view-screen}

वर्तमान नेविगेशन स्थिति को पढ़ता है, प्रासंगिक डेटा लाता है, और उपयोगकर्ता जो देखता है उसका एक स्नैपशॉट लौटाता है। एजेंट इसे तब कॉल करता है जब उसे स्क्रीन पर नए सिरे से देखने की आवश्यकता होती है।

```ts
// actions/view-screen.ts
import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description: "Read the current screen state for context.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const navigation = await readAppState("navigation");
    const screen: Record<string, unknown> = { navigation };

    if (navigation?.view === "inbox") {
      screen.emailList = await listEmailsForLabel(navigation.label);
    }

    return screen;
  },
});
```

### नेविगेट करें {#navigate}

एप्लिकेशन स्थिति के लिए एक-शॉट नेविगेशन कमांड लिखता है। UI इसे पढ़ता है, नेविगेट करता है, और प्रविष्टि को हटा देता है।

```ts
// actions/navigate.ts
import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description: "Navigate the user to a view.",
  schema: z.object({
    view: z.string(),
    threadId: z.string().optional(),
  }),
  run: async (args) => {
    await writeAppState("navigate", args);
    return { ok: true };
  },
});
```

## विरासत CLI-शैली actions {#legacy-cli-actions}

फ्रेमवर्क अभी भी पुराने `export default async function(args)` actions का समर्थन करता है जो `defineAction` में लिपटे नहीं हैं - एक-ऑफ़ देव स्क्रिप्ट के लिए उपयोगी है जिन्हें एजेंट/HTTP एक्सपोज़र की आवश्यकता नहीं है। ये केवल CLI हैं; वे एजेंट टूल के रूप में प्रकट नहीं होते हैं, HTTP एंडपॉइंट को माउंट नहीं करते हैं, और उन्हें टाइपसेफ फ्रंटएंड हुक नहीं मिलते हैं।

```ts
// actions/debug-dump.ts — CLI-only
import { parseArgs } from "@agent-native/core";

export default async function main(args: string[]) {
  const { table } = parseArgs(args);
  // one-off script you wouldn't want the agent to call
}
```

नया कोड `defineAction()` को प्राथमिकता देना चाहिए। इस पैटर्न तक तभी पहुंचें जब आप जानबूझकर नहीं चाहते कि कार्रवाई एजेंटों या UI के संपर्क में आए।

### `parseArgs(args)` {#parseargs}

विरासत-शैली actions के लिए सहायक। `--key value` या `--key=value` प्रारूप में CLI तर्कों को पार्स करता है:

```ts
import { parseArgs } from "@agent-native/core";

const args = parseArgs(["--name", "Steve", "--verbose", "--count=3"]);
// { name: "Steve", verbose: "true", count: "3" }
```

## उपयोगिता कार्य {#utility-functions}

| फ़ंक्शन                 | रिटर्न    | विवरण                                                                  |
| ----------------------- | --------- | ---------------------------------------------------------------------- |
| `loadEnv(path?)`        | `void`    | प्रोजेक्ट रूट (या कस्टम पथ) से `.env` लोड करें।                        |
| `camelCaseArgs(args)`   | `Record`  | कबाब-केस कुंजियों को कैमलकेस में बदलें।                                |
| `isValidPath(p)`        | `boolean` | किसी सापेक्ष पथ को मान्य करें (कोई ट्रैवर्सल नहीं, कोई निरपेक्ष नहीं)। |
| `isValidProjectPath(p)` | `boolean` | प्रोजेक्ट स्लग को मान्य करें (जैसे `my-project`)।                      |
| `ensureDir(dir)`        | `void`    | `mkdir -p` सहायक।                                                      |
| `fail(message)`         | `never`   | stderr और `exit(1)` पर प्रिंट करें।                                    |

## आगे क्या

- [**Audit Log**](/docs/audit-log) - प्रत्येक क्रिया के इर्द-गिर्द स्वचालित किसने-क्या परिवर्तन किया
- [**Human-in-the-Loop Approvals**](/docs/human-approval) - गहराई में `needsApproval` गेट
- [**Drop-in Agent**](/docs/drop-in-agent) - React में `useActionMutation` / `useActionQuery`
- [**Context Awareness**](/docs/context-awareness) - गहराई में `view-screen` + `navigate` पैटर्न
- [**A2A Protocol**](/docs/a2a-protocol) - अन्य एजेंट आपके actions को कैसे खोजते हैं और कॉल करते हैं
- [**MCP Protocol**](/docs/mcp-protocol) - MCP पर actions को उजागर करना
