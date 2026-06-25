---
title: "संदर्भ जागरूकता"
description: "एजेंट को कैसे पता चलता है कि उपयोगकर्ता क्या देख रहा है: नेविगेशन स्थिति, चयन संदर्भ, व्यू-स्क्रीन, सेंडटूएजेंटचैट हैंडऑफ़, नेविगेट कमांड और घबराहट की रोकथाम।"
---

# संदर्भ जागरूकता

> **डेवलपर पेज।** यह पेज ऐप की संदर्भ परत को वायरिंग करने वाले डेवलपर्स के लिए है। अंतिम-उपयोगकर्ता अनुभव के लिए - एजेंट बातचीत में उस संदर्भ का उपयोग कैसे करता है - [Using Your Agent](/docs/using-your-agent) देखें।

एजेंट को कैसे पता चलता है कि उपयोगकर्ता क्या देख रहा है -- और एजेंट कैसे नियंत्रित कर सकता है कि उपयोगकर्ता क्या देखता है।

## अवलोकन {#overview}

संदर्भ जागरूकता के बिना, एजेंट अंधा है। यह पूछता है "कौन सा ईमेल?" जब उपयोगकर्ता किसी एक को घूर रहा हो। यह वर्तमान चयन पर कार्य नहीं कर सकता, प्रासंगिक सुझाव नहीं दे सकता और उपयोगकर्ता जो देखता है उसे संशोधित नहीं कर सकता। संदर्भ जागरूकता के साथ, उपयोगकर्ता एक पंक्ति पर क्लिक कर सकता है, एक पैराग्राफ को हाइलाइट कर सकता है, एक स्लाइड तत्व का चयन कर सकता है, या Cmd+I दबा सकता है, फिर कह सकता है "इसे सारांशित करें" और एजेंट को पहले से ही पता है कि "इस" का क्या अर्थ है।

यह समझने के लिए कि किस सतह पर क्या डालना है (AGENTS.md बनाम skills बनाम application_state), [Writing Agent Instructions — The four surfaces the agent sees](/docs/writing-agent-instructions#four-surfaces) देखें।

छह पैटर्न इसे हल करते हैं:

1. **नेविगेशन स्थिति** - UI प्रत्येक मार्ग परिवर्तन पर एप्लिकेशन-स्थिति के लिए एक `navigation` कुंजी लिखता है
2. **वर्तमान URL** - फ्रेमवर्क `__url__` लिखता है ताकि क्वेरी पैरामीटर एजेंट द्वारा दृश्यमान और संपादन योग्य हों
3. **चयन स्थिति** -- जब उपयोगकर्ता किसी सार्थक चीज़ पर ध्यान केंद्रित करता है, चयन करता है, या बहु-चयन करता है तो UI एक `selection` कुंजी लिखता है
4. **`view-screen`** -- एक क्रिया जो एप्लिकेशन स्थिति को पढ़ती है, प्रासंगिक डेटा प्राप्त करती है, और उपयोगकर्ता जो देखता है उसका एक स्नैपशॉट लौटाता है
5. **प्रॉम्प्ट हैंडऑफ़** -- UI कॉल `sendToAgentChat()` को नियंत्रित करता है जब एक क्लिक एजेंट टर्न बन जाना चाहिए
6. **`navigate`** -- एजेंट का एक-शॉट कमांड जो UI को बताता है कि कहां जाना है

```an-diagram title="आप जो देखते हैं उसे एजेंट कैसे देखता है" summary="यूआई हल्के राज्य कुंजी लिखता है; व्यू-स्क्रीन उन्हें वास्तविक रिकॉर्ड में हाइड्रेट करता है; एजेंट यूआई को स्थानांतरित करने के लिए वापस नेविगेट लिख सकता है।"
{
  "html": "<div class=\"diagram-ctx\"><div class=\"diagram-card col\"><span class=\"diagram-pill\">UI लिखता है</span><div class=\"diagram-node\">navigation<br><small class=\"diagram-muted\">व्यू, खुले ID</small></div><div class=\"diagram-node\">__url__<br><small class=\"diagram-muted\">shareable filters</small></div><div class=\"diagram-node\">selection<br><small class=\"diagram-muted\">पंक्तियां, ब्लॉक, आकृतियां</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">view-screen</span><small class=\"diagram-muted\">reads state &middot; fetches records</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">एजेंट कार्य करता है<br><small class=\"diagram-muted\">on the real object</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box diagram-accent\">navigate<br><small class=\"diagram-muted\">एजेंट UI को चलाता है</small></div></div>",
  "css": ".diagram-ctx{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-ctx .col{display:flex;flex-direction:column;gap:8px;padding:14px}.diagram-ctx .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-ctx .diagram-arrow{font-size:22px;line-height:1}"
}
```

## संदर्भ परतें {#context-layers}

विभिन्न कार्यों के लिए विभिन्न संदर्भ चैनलों का उपयोग करें:

| परत                                        | मालिक             | इसके लिए इसका उपयोग करें                                                        |
| ------------------------------------------ | ----------------- | ------------------------------------------------------------------------------- |
| `navigation` ऐप-स्टेट कुंजी                | UI                | सिमेंटिक रूट स्थिति: वर्तमान दृश्य, खुला रिकॉर्ड, सक्रिय टैब, स्थिर आईडी        |
| `__url__` ऐप-स्टेट कुंजी                   | फ्रेमवर्क UI      | वर्तमान पथनाम, खोज स्ट्रिंग, हैश, और पार्स किए गए URL क्वेरी पैरामीटर           |
| `__set_url__` ऐप-स्टेट कुंजी               | एजेंट/ढांचा       | `set-search-params` और `set-url-path` से एक-शॉट URL संपादन                      |
| `selection` ऐप-स्टेट कुंजी                 | UI                | टिकाऊ अर्थ चयन: पंक्तियाँ, ब्लॉक, आकार, संपत्ति, संदेश                          |
| `pending-selection-context` ऐप-स्टेट कुंजी | UI / `AgentPanel` | एक-शॉट चयनित पाठ अगले चैट मोड़ से जुड़ा होता है, आमतौर पर Cmd+I से              |
| `view-screen` कार्रवाई                     | एजेंट             | ऐप-स्टेट कुंजियों को वास्तविक रिकॉर्ड और स्क्रीन सारांश में हाइड्रेट करना       |
| `sendToAgentChat()`                        | UI                | किसी क्लिक, कमांड, टिप्पणी पिन या चयनित आइटम को चैट प्रॉम्प्ट में बदलना         |
| `navigate` ऐप-स्टेट कुंजी                  | एजेंट             | UI को दूसरे मार्ग पर जाने या किसी अन्य वस्तु पर ध्यान केंद्रित करने के लिए कहना |

संक्षिप्त संस्करण: URL क्वेरी पैरामीटर साझा करने योग्य फ़िल्टर के लिए सत्य का स्रोत हैं, `navigation` सिमेंटिक आईडी और दृश्य नाम संग्रहीत करता है, `view-screen` उन राज्य परतों को उपयोगी डेटा में बदल देता है, और `sendToAgentChat()` UI इरादे को एक चैट संदेश में बदल देता है जब उपयोगकर्ता एक कमांड पर क्लिक करता है।

## नेविगेशन स्थिति {#navigation-state}

UI प्रत्येक रूट परिवर्तन पर एप्लिकेशन-स्टेट के लिए एक `navigation` कुंजी लिखता है। यह एजेंट को बताता है कि उपयोगकर्ता किस दृश्य पर है, कौन सा आइटम खुला है, और कौन सी सिमेंटिक UI स्थिति मायने रखती है।

```json
{
  "view": "inbox",
  "threadId": "thread-123",
  "focusedEmailId": "msg-456",
  "label": "important"
}
```

नेविगेशन स्थिति में क्या शामिल करें:

- `view` - वर्तमान पृष्ठ/अनुभाग, जैसे "इनबॉक्स", "फॉर्म-बिल्डर", या "डैशबोर्ड"
- आइटम आईडी - चयनित/खुला आइटम, जैसे `threadId` या `formId`
- सिमेंटिक उपनाम - सक्रिय टैब, लेबल नाम, या अन्य स्थिर ऐप अवधारणाएं जो एजेंट को मदद करती हैं
- प्रकाश फोकस स्थिति--केंद्रित पंक्ति, सक्रिय टैब, वर्तमान पैनल

`navigation` को छोटा और अर्थपूर्ण रखें। इसे वर्तमान स्क्रीन की पहचान करनी चाहिए, पूरे रिकॉर्ड की नकल नहीं करनी चाहिए या प्रत्येक क्वेरी पैरामीटर को मिरर नहीं करना चाहिए। `view-screen` में रिकॉर्ड प्राप्त करें ताकि एजेंट को हमेशा ताज़ा डेटा मिले।

एजेंट कार्रवाई करने से पहले इसे पढ़ता है:

```ts
import { readAppState } from "@agent-native/core/application-state";

const navigation = await readAppState("navigation");
// { view: "inbox", threadId: "thread-123", label: "important" }
```

## वर्तमान URL और फ़िल्टर {#current-url}

`AgentPanel` स्वचालित रूप से वर्तमान React राउटर URL को `__url__` एप्लिकेशन-स्टेट कुंजी में सिंक करता है। अंतर्निहित एजेंट इसे `<current-url>` ब्लॉक के रूप में प्रत्येक मोड़ में शामिल करता है:

```text
<current-url>
pathname: /adhoc/revenue
search: ?f_region=west&q=renewal
searchParams:
  f_region: west
  q: renewal
</current-url>
```

यह साझा करने योग्य फ़िल्टर स्थिति के लिए विहित परत है। यदि उपयोगकर्ता URL की प्रतिलिपि बना सकता है और उसी फ़िल्टर की गई सूची पर वापस आ सकता है, तो फ़िल्टर क्वेरी स्ट्रिंग में होता है। एजेंट उन फ़िल्टर को अंतर्निहित `set-search-params` टूल से बदल सकता है:

```text
set-search-params({ "params": { "f_region": "east", "q": null } })
```

`navigation` का उपयोग केवल सिमेंटिक उपनामों के लिए करें जो `view-screen` को सही डेटा लाने या सारांशित करने में मदद करते हैं। एक डैशबोर्ड `navigation.dashboardId` रख सकता है जबकि `__url__.searchParams` के पास `f_region`, `f_dateStart` और `q` है।

जब `view-screen` एक समृद्ध स्नैपशॉट लौटाता है, तो यह महत्वपूर्ण URL फ़िल्टर को एक अनुकूल `activeFilters` ऑब्जेक्ट में कॉपी कर सकता है:

```ts
const url = (await readAppState("__url__")) as {
  searchParams?: Record<string, string>;
} | null;

if (url?.searchParams) {
  screen.activeFilters = Object.fromEntries(
    Object.entries(url.searchParams).filter(
      ([key, value]) => key.startsWith("f_") && value,
    ),
  );
}
```

## चयन स्थिति {#selection-state}

चयन सिमेंटिक UI स्थिति है। इस प्रकार "मैंने जिस चार्ट पर क्लिक किया", "ये तीन पंक्तियाँ", "यह स्लाइड शीर्षक", या "वर्तमान ईमेल ड्राफ्ट रेंज" मॉडल-दृश्यमान संदर्भ बन जाता है।

टिकाऊ चयन के लिए `selection` ऐप-स्टेट कुंजी का उपयोग करें जो नेविगेशन, खाली-चैट सुझावों या बाद में `view-screen` कॉल के क्षण तक जीवित रहना चाहिए:

```json
{
  "kind": "slide.elements",
  "deckId": "deck-123",
  "slideId": "slide-4",
  "items": [
    {
      "id": "hero-title",
      "selector": "[data-block-id='hero-title']",
      "label": "Hero title",
      "text": "Q3 लॉन्च plan"
    }
  ],
  "capturedAt": 1780332977027
}
```

जब उपयोगकर्ता सार्थक वस्तुओं का चयन, फोकस, या बहु-चयन करता है तो इसे UI से लिखें:

```tsx
import { setClientAppState } from "@agent-native/core/client";

async function syncSelection(selection: unknown | null) {
  await setClientAppState("selection", selection, { keepalive: true });
}
```

अच्छी चयन स्थिति में शामिल हैं:

- स्थिर आईडी एजेंट actions में उपयोग कर सकते हैं, जैसे `threadId`, `slideId`, या `assetId`
- एक छोटा मानव लेबल ताकि संकेत और सुझाव पढ़ने योग्य हों
- वस्तु को स्पष्ट करने के लिए पर्याप्त पाठ या मेटाडेटा
- वैकल्पिक UI लोकेटर जैसे चयनकर्ता या निर्देशांक जब एजेंट को किसी दृश्य तत्व को वापस संदर्भित करने की आवश्यकता होती है
- `capturedAt` जब पुराना चयन हानिकारक होगा

`selection` में रहस्य, पूर्ण दस्तावेज़, बड़े बाइनरी पेलोड, या संपूर्ण API प्रतिक्रियाओं को संग्रहीत करने से बचें। स्टोर आईडी और संक्षिप्त अंश, फिर `view-screen` को सत्य का वर्तमान स्रोत प्राप्त करने दें।

### एक-शॉट चयनित पाठ {#pending-selection-context}

`AgentPanel` पहले से ही सामान्य पाठ-चयन प्रवाह को संभालता है। जब उपयोगकर्ता पृष्ठ पर चयनित पाठ के साथ Cmd+I (या Ctrl+I) दबाता है, तो यह:

1. `window.getSelection()` पढ़ता है
2. `{ text, capturedAt }` को `pending-selection-context` लिखता है
3. एजेंट चैट पर ध्यान केंद्रित करता है

उत्पादन एजेंट उस कुंजी को तत्काल चयन संदर्भ के रूप में अगले मोड़ में इंजेक्ट करता है और एक बार पुराना हो जाने पर उसे अनदेखा कर देता है। यह वह पथ है जो उपयोगकर्ता द्वारा चयन को प्रॉम्प्ट में कॉपी किए बिना "टेक्स्ट का चयन करें, Cmd+I दबाएँ, पूछें 'इसे और बेहतर बनाएं'" कार्य करता है।

कस्टम संपादक वही कुंजी लिख सकते हैं जब उनका चयन मूल ब्राउज़र चयन द्वारा दर्शाया नहीं जाता है:

```tsx
import { setClientAppState } from "@agent-native/core/client";

await setClientAppState(
  "pending-selection-context",
  {
    text: selectedMarkdown,
    capturedAt: Date.now(),
  },
  { keepalive: true },
);
```

एक-शॉट "इस सटीक हाइलाइट किए गए टेक्स्ट पर कार्य करें" प्रवाह के लिए `pending-selection-context` का उपयोग करें। टिकाऊ वस्तु चयन के लिए `selection` का उपयोग करें जिसे `view-screen` और गतिशील सुझावों को देखते रहना चाहिए।

## व्यू-स्क्रीन क्रिया {#view-screen-action}

प्रत्येक टेम्पलेट में `view-screen` क्रिया होनी चाहिए। यह नेविगेशन और चयन स्थिति को पढ़ता है, प्रासंगिक डेटा लाता है, और उपयोगकर्ता जो देखता है उसका एक स्नैपशॉट लौटाता है। यह एजेंट की नजर है।

```an-annotated-code title="व्यू-स्क्रीन - एजेंट की आंखें"
{
  "filename": "actions/view-screen.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { readAppState } from \"@agent-native/core/application-state\";\nimport { eq, inArray } from \"drizzle-orm\";\nimport { z } from \"zod\";\nimport { getDb, schema } from \"../server/db/index.js\";\n\nexport default defineAction({\n  description:\n    \"See what the user is currently looking at on screen.\",\n  schema: z.object({}),\n  http: false,\n  run: async () => {\n    const navigation = (await readAppState(\"navigation\")) as any;\n    const selection = (await readAppState(\"selection\")) as any;\n    const screen: Record<string, unknown> = {};\n    if (navigation) screen.navigation = navigation;\n    if (selection) screen.selection = selection;\n\n    const db = getDb();\n\n    // Fetch data based on what the user is viewing\n    if (navigation?.view === \"inbox\") {\n      screen.emailList = await db\n        .select()\n        .from(schema.emails)\n        .where(eq(schema.emails.label, navigation.label));\n    }\n    if (navigation?.threadId) {\n      screen.thread = await db\n        .select()\n        .from(schema.threads)\n        .where(eq(schema.threads.id, navigation.threadId));\n    }\n    if (selection?.kind === \"email.messages\") {\n      screen.selectedMessages = await db\n        .select()\n        .from(schema.emails)\n        .where(inArray(schema.emails.id, selection.messageIds));\n    }\n\n    if (Object.keys(screen).length === 0) {\n      return \"No application state found. Is the app running?\";\n    }\n    return screen;\n  },\n});",
  "annotations": [
    { "lines": "10-11", "label": "उपकरण सतह", "note": "एजेंट इस विवरण को यह जानने के लिए पढ़ता है कि वह वर्तमान UI को देखने के लिए `view-screen` पर कॉल कर सकता है।" },
    { "lines": "13", "label": "http: false", "note": "आंतरिक कार्रवाई - HTTP पर उजागर नहीं हुई। एजेंट और `pnpm action` इसे कॉल करते हैं, ब्राउज़र नहीं।" },
    { "lines": "15-16", "label": "स्थिति पढ़ें", "note": "UI द्वारा लिखी गई हल्की `navigation` और `selection` कुंजियाँ खींचता है।" },
    { "lines": "23-37", "label": "हाइड्रेट", "note": "उन आईडी को SQL से सीधे **ताजा** रिकॉर्ड में बदल देता है, इसलिए एजेंट कार्य करने से पहले लाइव ऑब्जेक्ट को सत्यापित करता है।" }
  ]
}
```

वर्तमान UI पर कार्रवाई करने से पहले एजेंट को `pnpm action view-screen` पर कॉल करना चाहिए। यह सभी टेम्पलेट्स में एक कठिन परिपाटी है। नई सुविधाएँ जोड़ते समय, नए दृश्य और किसी भी नए चयन आकार के लिए डेटा वापस करने के लिए `view-screen` को अपडेट करें।

```an-callout
{
  "tone": "info",
  "body": "**`navigation` और `selection` को छोटा रखें।** स्टोर आईडी और छोटे लेबल, संपूर्ण रिकॉर्ड नहीं। `view-screen` मांग पर सत्य का स्रोत लाता है, इसलिए बासी या भारी स्थिति कभी भी एजेंट तक नहीं पहुंचती है।"
}
```

## `sendToAgentChat()` के साथ शीघ्र हैंडऑफ़ {#send-to-agent-chat}

कभी-कभी संदर्भ केवल ऐप स्थिति में नहीं रहना चाहिए। उपयोगकर्ता एक बटन क्लिक करता है, एक टिप्पणी पिन छोड़ता है, एक आइटम का चयन करता है और "एजेंट से पूछें" चुनता है, या टूलबार में एआई कमांड दबाता है। वह क्लिक एक निर्देश है. ब्राउज़र UI में, इसे `sendToAgentChat()` वाले एजेंट को सौंप दें।

```tsx
import { sendToAgentChat } from "@agent-native/core/client";

function askAgentAboutSelection(selection: {
  documentId: string;
  blockId: string;
  label: string;
  text: string;
}) {
  sendToAgentChat({
    message: `Improve the selected block: ${selection.label}`,
    context: [
      `Document id: ${selection.documentId}`,
      `Block id: ${selection.blockId}`,
      "Current selected text:",
      selection.text,
    ].join("\n"),
    submit: false,
    openSidebar: true,
  });
}
```

फ़ील्ड का जानबूझकर उपयोग करें:

| फ़ील्ड              | अर्थ                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `message`           | चैट में दिखाई देने वाला दृश्यमान टेक्स्ट                                                       |
| `context`           | छिपा हुआ मॉडल-दृश्यमान संदर्भ, उपयोगकर्ता-सामना वाले चैट टेक्स्ट के रूप में नहीं दिखाया गया है |
| `submit: true`      | तुरंत भेजें; "लेआउट ठीक करें"                                                                  |
| `submit: false`     | उपयोगकर्ता समीक्षा के लिए प्रीफ़िल; "एजेंट से इस बारे में पूछें" या अस्पष्ट चयन                |
| `openSidebar: true` | पैनल ढह जाने पर भी एजेंट की प्रतिक्रिया को दृश्यमान बनाएं                                      |
| `newTab: true`      | बड़े निर्माण कार्य के लिए एक अलग चैट थ्रेड प्रारंभ करें                                        |
| `type: "code"`      | जब अनुरोध ऐप स्रोत बदलने के बारे में हो तो कोड-संपादन फ़्रेम पर रूट करें                       |

`sendToAgentChat()` सबमिट किए गए चैट पथ के लिए समर्थित ब्राउज़र रैपर है जिसे कभी-कभी आंतरिक रूप से `agentNative.submitChat` के रूप में देखा जाता है। ऐप UI को सीधे `agentNative.submitChat` पोस्ट करने के बजाय रैपर को कॉल करना चाहिए क्योंकि रैपर स्थानीय साइडबार, Builder/फ़्रेम रूटिंग, MCP ऐप होस्ट रूटिंग, टैब आईडी और कोड-अनुरोध रूटिंग को संभालता है।

नोड/स्क्रिप्ट संदर्भों के लिए `agentChat.submit()` या `agentChat.prefill()` का उपयोग करें जहां कोई ब्राउज़र साइडबार नहीं है। सर्वर actions को आमतौर पर केवल ब्राउज़र `sendToAgentChat()` को कॉल नहीं करना चाहिए; यदि किसी कार्रवाई के लिए एजेंट से कुछ पूछने के लिए खुले UI की आवश्यकता है, तो `application_state` में एक छोटा सा अनुरोध लिखें और UI ब्रिज को ब्राउज़र से इसे भेजने दें।

### प्रॉम्प्ट में आइटम पर क्लिक किया गया {#clicked-items-in-prompt}

"UI में आइटम पर क्लिक करें और वे प्रॉम्प्ट का हिस्सा बन जाते हैं" अनुभव के लिए, चयन स्थिति को प्रॉम्प्ट हैंडऑफ़ के साथ संयोजित करें:

1. क्लिक या बहु-चयन पर, सिमेंटिक `selection` स्थिति लिखें ताकि `view-screen`, गतिशील सुझाव और भविष्य के मोड़ इसे देख सकें।
2. यदि क्लिक भी एक कमांड है, तो संक्षिप्त दृश्यमान `message` और अधिक छिपे हुए `context` के साथ `sendToAgentChat()` पर कॉल करें।
3. `view-screen` में, चयनित आईडी को वर्तमान रिकॉर्ड में हाइड्रेट करें ताकि एजेंट ऑब्जेक्ट को म्यूट करने से पहले उसे सत्यापित कर सके।
4. जब ऑब्जेक्ट अब चयनित नहीं है, हटा दिया गया है, या प्रासंगिक नहीं है तो `selection` साफ़ करें।

यह उपयोगकर्ता को प्रत्येक संकेत को भारी दृश्य संदर्भ से भरे बिना जादुई "मेरा मतलब यही था" व्यवहार देता है।

## नेविगेट क्रिया {#navigate-action}

`navigate` `navigation` की दर्पण छवि है। जहां `navigation` UI एजेंट को बता रहा है कि उपयोगकर्ता कहां है, `navigate` एजेंट है जो UI को बता रहा है कि कहां जाना है। एजेंट एप्लिकेशन-स्टेट के लिए एक-शॉट `navigate` कमांड लिखता है; UI इसे पढ़ता है, नेविगेशन करता है, फिर प्रविष्टि हटा देता है।

```ts
// Agent side -- write a navigate command
import { writeAppState } from "@agent-native/core/application-state";

await writeAppState("navigate", { view: "inbox", threadId: "thread-123" });
```

UI की तरफ आप कभी भी इस कुंजी को हाथ से पोल या डिलीट नहीं करेंगे। दोनों दिशाएँ - प्रत्येक मार्ग परिवर्तन पर `navigation` लिखना और एजेंट के `navigate` कमांड का उपभोग करना - एक ही हुक, [`useNavigationState`](#use-navigation-state) द्वारा नियंत्रित किया जाता है, जिसे अगले भाग में शामिल किया गया है।

`navigation` कुंजी UI से संबंधित है; एजेंट को कभी भी इसे सीधे नहीं लिखना चाहिए। एजेंट `navigate` लिखता है, UI चाल निष्पादित करता है, और वह चाल `navigation` को अपडेट करती है।

जब गंतव्य पर वास्तविक URL हो, तो उसी मूल `path` को शामिल करें
`navigate` कमांड और UI पर वापस जाने से पहले उस पथ को प्राथमिकता दें
शब्दार्थ क्षेत्र। ऐप नेविगेशन को सिंगल-चैनल रखें: दोनों न लिखें
`navigate` और `__set_url__` एक ही चाल के लिए। `__set_url__`
फ्रेमवर्क URL टूल (`set-url-path`, `set-search-params`) और URL-केवल फ़िल्टर
परिवर्तन। उन आदेशों के लिए जो चैट स्ट्रीमिंग के दौरान आ सकते हैं, रूट प्रतिबद्ध करें
इसे लपेटने के बजाय `navigate(path, { replace: true, flushSync: true })` के साथ
एक दृश्य परिवर्तन में ताकि पता बार और दृश्यमान पृष्ठ एक साथ रहें।

## यूज़नेविगेशनस्टेट हुक {#use-navigation-state}

`useNavigationState` **आपके ऐप का हुक है, फ्रेमवर्क आयात नहीं।** प्रत्येक टेम्पलेट `app/hooks/use-navigation-state.ts` पर एक शिप करता है और इसे ऐप शेल (`root.tsx`) से एक बार कॉल करता है। यह एकमात्र स्थान है जो दोनों दिशाओं में नेविगेशन को तारित करता है:

- **आउटबाउंड (UI → एजेंट):** जब भी मार्ग बदलता है तो `navigation` कुंजी लिखता है, इसलिए एजेंट को हमेशा वर्तमान दृश्य पता होता है।
- **इनबाउंड (एजेंट → UI):** `navigate` कमांड को पोल करता है, नेविगेशन चलाता है, और कमांड को हटा देता है।

यह छोटा रहता है क्योंकि यह वास्तविक फ्रेमवर्क आदिम, `useAgentRouteState` (`@agent-native/core/client` से निर्यातित) के चारों ओर एक पतला आवरण है। आप दो ऐप-विशिष्ट फ़ंक्शन प्रदान करते हैं और फ़्रेमवर्क बाकी काम करता है:

```tsx
// app/hooks/use-navigation-state.ts -- this file lives in YOUR app
import { useAgentRouteState } from "@agent-native/core/client";
import { TAB_ID } from "@/lib/tab-id";

interface NavigationState {
  view: "inbox" | "thread";
  threadId?: string;
  path?: string;
}

export function useNavigationState() {
  useAgentRouteState<NavigationState>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,

    // UI → agent: derive semantic state from the current URL.
    getNavigationState: ({ pathname }) => {
      const match = pathname.match(/^\/thread\/([^/]+)/);
      return match ? { view: "thread", threadId: match[1] } : { view: "inbox" };
    },

    // agent → UI: turn a `navigate` command into a route to push.
    getCommandPath: (command) =>
      command.path ??
      (command.view === "thread" && command.threadId
        ? `/thread/${command.threadId}`
        : "/"),
    navigateOptions: { replace: true, flushSync: true },
  });
}
```

| आप लिखें                                                   | फ्रेमवर्क हैंडल                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `getNavigationState` - URL को सिमेंटिक स्थिति में मैप करें | `navigation` लिखता है, टैब-स्कोप्ड प्लस एक वैश्विक फ़ॉलबैक कुंजी            |
| `getCommandPath` - एक `navigate` कमांड को रूट पर मैप करें  | कमांड पोलिंग, डिलीट-आफ्टर-रीड, डुप्लिकेट-कमांड सुरक्षा, अनुरोध-स्रोत टैगिंग |

`useAgentRouteState` React राउटर मानता है। जब नेविगेशन URL में नहीं रहता है - एक विज़ार्ड चरण, एक कैनवास चयन, एक गैर-राउटर शेल - इसके बजाय निचले स्तर `useSemanticNavigationState` पर जाएं: आप इसे एक तैयार `state` मान प्लस `navigationKeys`/`commandKeys` और एक `onCommand` कॉलबैक सौंपते हैं, और यह React के बारे में पूरी तरह से अज्ञेयवादी रहता है राउटर.

## घबराहट की रोकथाम {#jitter-prevention}

जब एजेंट एप्लिकेशन-स्टेट पर लिखता है, तो सिंक सिस्टम UI को उसके द्वारा अभी लिखे गए डेटा को दोबारा लाने का कारण बन सकता है। इससे घबराहट पैदा होती है. समाधान स्रोत टैगिंग है:

ब्राउज़र-साइड एप्लिकेशन-स्टेट एक्सेस के लिए `@agent-native/core/client` से `setClientAppState`, `writeClientAppState`, `readClientAppState` और `deleteClientAppState` का उपयोग करें। UI पर `{ requestSource: TAB_ID }` पास करें, `useDbSync({ ignoreSource: TAB_ID })` के साथ युग्मित होने पर लिखता है; अनलोड के दौरान चयन सफाई जैसे अल्पकालिक लेखन के लिए `{ keepalive: true }` पास करें।

```ts
// app/root.tsx
import { TAB_ID } from "@/lib/tab-id";

useDbSync({
  queryClient,
  ignoreSource: TAB_ID, // ignore events from this tab's own writes
});
```

यह कैसे काम करता है:

- एजेंट लेखन को `requestSource: "agent"` के साथ टैग किया गया है (कार्रवाई सहायक स्वचालित रूप से ऐसा करते हैं)
- UI लेखन में `X-Request-Source` हेडर के माध्यम से टैब की विशिष्ट आईडी शामिल है
- सर्वर प्रत्येक ईवेंट पर स्रोत संग्रहीत करता है
- सिंक ईवेंट को संसाधित करते समय, UI अपने स्वयं के `ignoreSource` मान से मेल खाने वाले ईवेंट को फ़िल्टर करता है - इसलिए यह अभी लिखे गए डेटा को दोबारा प्राप्त नहीं करता है
- एजेंटों, अन्य टैब और actions से ईवेंट अभी भी सामान्य रूप से आते हैं

```an-diagram title="सोर्स टैगिंग सेल्फ-रिफ़ेच घबराहट को रोकता है" summary="एक टैब अपने स्वयं के TAB_ID से मुद्रित सिंक घटनाओं को अनदेखा करता है, लेकिन फिर भी एजेंट और अन्य-टैब लिखने पर प्रतिक्रिया करता है।"
{
  "html": "<div class=\"diagram-jitter\"><div class=\"diagram-node\">यह टैब लिखता है<br><small class=\"diagram-muted\">X-Request-Source: TAB_ID</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>सर्वर स्रोत सहेजता है<br>on the event</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill warn\">source == TAB_ID &rarr; ignored</div><small class=\"diagram-muted\">कोई refetch नहीं, कोई flicker नहीं</small><div class=\"diagram-pill ok\">agent / other tab &rarr; applied</div><small class=\"diagram-muted\">UI लाइव अपडेट होती है</small></div></div>",
  "css": ".diagram-jitter{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-jitter .col{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-jitter .diagram-arrow{font-size:22px;line-height:1}"
}
```
