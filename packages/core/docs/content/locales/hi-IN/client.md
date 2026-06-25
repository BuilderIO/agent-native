---
title: "क्लाइंट"
description: "एजेंट-नेटिव ऐप्स के लिए React हुक और उपयोगिताएँ: sentToAgentChat, वैकल्पिक एजेंट चैट संदर्भ स्थिति, useDbSync, useAgentChatGenerating, और cn।"
---

# ग्राहक

`@agent-native/core` एजेंट-नेटिव ऐप्स के ब्राउज़र-साइड के लिए React हुक और उपयोगिताएँ प्रदान करता है।

ये क्लाइंट/React APIs `@agent-native/core` और `@agent-native/core/client` दोनों से निर्यात किए जाते हैं। स्पष्टता और सही बंडलिंग के लिए उन्हें `@agent-native/core/client` (ब्राउज़र प्रविष्टि) से आयात करें, क्योंकि नंगे `@agent-native/core` रूट डिफ़ॉल्ट रूप से नोड बिल्ड का समाधान करता है।

फ़ाइल-आधारित रूटिंग के लिए - पेज, डायनामिक पैरामीटर और नेविगेशन जोड़ना - [Routing](/docs/routing) देखें।

## डेटा लाना और परिवर्तित करना {#fetching-mutating}

ब्राउज़र से ऐप डेटा को पढ़ने और लिखने का प्राथमिक तरीका एक्शन हुक के माध्यम से है। `/_agent-native/*` मार्गों पर `fetch` कॉल को कभी भी हाथ से न लिखें - इसके बजाय नामित सहायकों का उपयोग करें ([Actions](/docs/actions) देखें)।

```an-diagram title="ब्राउज़र डेटा लूप" summary="हुक क्रियाओं के माध्यम से पढ़ते और लिखते हैं; useDbSync डेटाबेस पर नज़र रखता है इसलिए एजेंट और बैकग्राउंड स्वचालित रूप से समान कैश पुनः प्राप्त करते हैं।"
{
  "html": "<div class=\"diagram-client\"><div class=\"diagram-col\"><div class=\"diagram-node\">useActionQuery<br><small class=\"diagram-muted\">cached read</small></div><div class=\"diagram-node\">useActionMutation<br><small class=\"diagram-muted\">write + invalidate</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-box\" data-rough>Actions<br><small class=\"diagram-muted\">/_agent-native/actions/*</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-panel\" data-rough><strong>SQL डेटाबेस</strong></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-pill ok\">useDbSync &rarr; refetch on change</div></div>",
  "css": ".diagram-client{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-client .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-client .diagram-arrow{font-size:22px;line-height:1}"
}
```

```tsx
import {
  useActionQuery,
  useActionMutation,
  callAction,
} from "@agent-native/core/client";

// Read: auto-cached, auto-invalidated on mutations
const { data, isLoading } = useActionQuery("get-lead", { leadId });

// Mutate: emits a change event so query caches refetch
const { mutate, isPending } = useActionMutation("create-lead");
mutate({ name: "Alice", company: "Acme" });

// Imperative: for one-off calls outside a component
await callAction("archive-lead", { leadId });
```

## sendToAgentChat(opts) {#sendtoagentchat}

पोस्टमैसेज के माध्यम से एजेंट चैट को एक संदेश भेजें - UI इंटरैक्शन से AI कार्य सौंपने का सामान्य तरीका। छिपे हुए मॉडल संदर्भ के लिए `context` और तुरंत भेजने के लिए `submit: true` पास करें, या उपयोगकर्ता द्वारा पहले समीक्षा किए गए ड्राफ्ट को प्रीफिल करने के लिए `submit: false` पास करें।

```ts
import { sendToAgentChat } from "@agent-native/core/client";

// Auto-submit a prompt with hidden context
sendToAgentChat({
  message: "Generate alt text for this image",
  context: "Image path: /api/projects/hero.jpg",
  submit: true,
});

// Prefill without submitting (user reviews first)
sendToAgentChat({
  message: "Rewrite this in a conversational tone",
  context: selectedText,
  submit: false,
});
```

`embedApp()` के साथ बनाए गए MCP ऐप एम्बेड के अंदर, स्वचालित रूप से सबमिट किए गए संदेश
(`submit` छोड़ा गया या `true`) MCP ऐप होस्ट ब्रिज पर अग्रेषित किया जाता है, जो
शामिल होस्ट को छिपा हुआ संदर्भ जोड़ने और दृश्यमान उपयोगकर्ता को भेजने के लिए कहता है।
`context` उपयोगकर्ता-सामना वाली चैट के रूप में पोस्ट किए बिना मॉडल-दृश्यमान रहता है।
`submit: false` स्थानीय प्रीफ़िल/समीक्षा व्यवहार को बनाए रखता है क्योंकि MCP ऐप्स ऐसा नहीं करते हैं
एक मानक ड्राफ्ट-प्रीफिल API को परिभाषित करें। आंतरिक रूप से यह सबमिट-चैट पथ
कभी-कभी `agentNative.submitChat` के रूप में सामने आता है; ऐप कोड को कॉल करना चाहिए
उस ईवेंट को सीधे पोस्ट करने के बजाय `sendToAgentChat()`।

### साइलेंट बैकग्राउंड भेजता है {#background-send}

`background: true` का उपयोग तब करें जब UI कार्रवाई के बिना वास्तविक एजेंट का काम शुरू हो जाए
साइडबार को खोलना या फोकस करना। यह अभी भी एक सामान्य चैट थ्रेड/रन बनाता है,
एजेंट के टूल/actions/संदर्भ का उपयोग करता है, और कार्य को इसके माध्यम से देखने योग्य रखता है
रन ट्रे; यह कोई कच्चा वन-शॉट मॉडल कॉल नहीं है।

```ts
const tabId = sendToAgentChat({
  message: "Analyze this import and create any missing records",
  context: `Import batch id: ${batchId}`,
  submit: true,
  newTab: true,
  background: true,
  openSidebar: false,
});
```

`background` को `newTab` के साथ जोड़ा जाना है ताकि छिपा हुआ काम न हो
overwrite the user's active conversation. Use the returned `tabId` if the UI
अनुवर्ती स्थिति को सहसंबंधित करने या बाद में चलने वाले डीप-लिंक की आवश्यकता है।

### एजेंटचैटमैसेज {#agentchatmessage}

| विकल्प                | प्रकार      | विवरण                                                                             |
| --------------------- | ----------- | --------------------------------------------------------------------------------- |
| `message`             | `string`    | चैट पर दृश्यमान संकेत भेजा गया                                                    |
| `context`             | `string?`   | छिपा हुआ संदर्भ जोड़ा गया (चैट UI में नहीं दिखाया गया)                            |
| `submit`              | `boolean?`  | सही = स्वतः-सबमिट, गलत = केवल पूर्व-भरण                                           |
| `newTab`              | `boolean?`  | इस प्रॉम्प्ट के लिए एक अलग चैट थ्रेड बनाएं                                        |
| `background`          | `boolean?`  | `newTab` के साथ, टैब पर ध्यान केंद्रित किए बिना चलाएं और `RunsTray` में रन दिखाएं |
| `openSidebar`         | `boolean?`  | साइडबार खोले बिना सबमिट/प्रीफ़िल करने के लिए गलत सेट करें                         |
| `projectSlug`         | `string?`   | संरचित संदर्भ के लिए वैकल्पिक प्रोजेक्ट स्लग                                      |
| `preset`              | `string?`   | डाउनस्ट्रीम उपभोक्ताओं के लिए वैकल्पिक पूर्व निर्धारित नाम                        |
| `referenceImagePaths` | `string[]?` | वैकल्पिक संदर्भ छवि पथ                                                            |

## एजेंट चैट संदर्भ स्थिति (उन्नत) {#agent-chat-context-state}

संदर्भ-स्थिति API, UI के लिए वैकल्पिक प्लंबिंग है जिसके साथ दो-तरफ़ा समन्वयन की आवश्यकता होती है
मंचित संदर्भ चिप्स: कंपोजर के बाहर वर्तमान स्टेज्ड आइटम को प्रस्तुत करना,
यह दर्शाता है कि क्या कोई आइटम पहले से ही संलग्न है, या स्पष्ट रूप से प्रदान कर रहा है
नियंत्रण हटाएं/साफ़ करें।

सरल "इसे एजेंट को भेजें" या
"prefill this draft for review" flows. Use `sendToAgentChat()` with `context`
और उनके लिए `submit`.

| API                               | कब उपयोग करें                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `useAgentChatContext()`           | एक React घटक को लाइव चरणबद्ध संदर्भ सूची की आवश्यकता है                         |
| `setAgentChatContextItem(item)`   | अनिवार्य कोड को एक कुंजी वाले संदर्भ आइटम को चरणबद्ध या प्रतिस्थापित करना चाहिए |
| `listAgentChatContext()`          | गैर-React कोड को चरणबद्ध संदर्भ के एक बार के स्नैपशॉट की आवश्यकता है            |
| `removeAgentChatContextItem(key)` | UI को अपने स्थिर `key` द्वारा एक चरणबद्ध संदर्भ आइटम को हटा देना चाहिए          |
| `clearAgentChatContext()`         | UI को सभी चरणबद्ध संदर्भ साफ़ करना चाहिए, जैसे दृश्य या मोड रीसेट के बाद        |
| `refreshAgentChatContext()`       | अनिवार्य कोड को नवीनतम जारी संदर्भ स्नैपशॉट को फिर से पढ़ना चाहिए               |

`useAgentChatContext()`, `{ items, set, remove, clear, refresh }` लौटाता है।

## openAgentSettings(अनुभाग?) {#openagentsettings}

जब ऐप सेटिंग पेज या सेटअप कार्ड खुलना चाहिए तो `openAgentSettings()` का उपयोग करें
एजेंट साइडबार का सेटिंग टैब। एक सेक्शन आईडी जैसे `"llm"`, `"secrets"`,
किसी विशिष्ट अनुभाग को खोलने के लिए `"automations"`, `"voice"`, या `"limits"`।

```ts
import { openAgentSettings } from "@agent-native/core/client";

openAgentSettings();
openAgentSettings("secrets");
```

सीधे `agent-panel:open-settings` भेजने के बजाय इस सहायक को प्राथमिकता दें।

```tsx
import { useAgentChatContext } from "@agent-native/core/client";

function SelectionContextButton({ record }: { record: { id: string } }) {
  const chatContext = useAgentChatContext();
  const contextKey = `selected-record:${record.id}`;
  const isAttached = chatContext.items.some((item) => item.key === contextKey);

  return (
    <button
      type="button"
      onClick={() => {
        if (isAttached) {
          chatContext.remove(contextKey);
          return;
        }

        chatContext.set({
          key: contextKey,
          title: "Selected Record",
          context: JSON.stringify(record, null, 2),
          openSidebar: false,
        });
      }}
    >
      {isAttached ? "Remove from prompt context" : "Add to prompt context"}
    </button>
  );
}
```

`listAgentChatContext()` अनिवार्य कोड के लिए है जिसे केवल निरीक्षण करने की आवश्यकता है
वर्तमान चरणबद्ध आइटम एक बार। `clearAgentChatContext()` जानबूझकर व्यापक है; उपयोग करें
`removeAgentChatContextItem(key)` जब केवल एक चयन बदला गया।

### AgentChatContextSetOptions {#agentchatcontextsetoptions}

| विकल्प        | प्रकार     | विवरण                                                              |
| ------------- | ---------- | ------------------------------------------------------------------ |
| `key`         | `string`   | मौजूदा नगेट को बदलने के लिए स्थिर पहचानकर्ता का उपयोग किया जाता है |
| `title`       | `string`   | कंपोज़र चिप में दिखाया गया संक्षिप्त लेबल                          |
| `context`     | `string`   | अगले सबमिट किए गए संकेत के साथ छिपा हुआ संदर्भ शामिल है            |
| `openSidebar` | `boolean?` | डिफ़ॉल्ट सत्य पर; मंच के सन्दर्भ को चुपचाप पास करें                |

## askUserQuestion(opts) {#ask-user-question}

उपयोगकर्ता से ऐप कोड से बहुविकल्पीय प्रश्न पूछें, इसे इनलाइन में प्रस्तुत करें
एजेंट पैनल, और **उनके उत्तर की प्रतीक्षा करें**। यह
एजेंट का अंतर्निहित `ask-question` टूल: यह एक `GuidedQuestionPayload` लिखता है
`"guided-questions"` एप्लिकेशन-स्टेट कुंजी (जहां माउंट किया गया है
`GuidedQuestionFlow` इसे प्रस्तुत करता है) और एजेंट पैनल का खुलासा करता है इसलिए प्रश्न है
दृश्यमान. एजेंट टूल के विपरीत - जिसका उत्तर एजेंट के पास वापस प्रवाहित होता है -
`askUserQuestion()` **कॉल करने वाले के उत्तर के साथ समाधान करता है**, इसलिए UI कर सकता है
उस पर शाखा.

इसका उपयोग तब करें जब UI को इससे पहले ठीक एक छोटे निर्णय (2-4 विकल्प) की आवश्यकता हो
कस्टम मोडल बनाने के बजाय एजेंट का काम शुरू करता है। के लिए पहुंचें
फ्रीफॉर्म विवरण के लिए कंपोजर, और मल्टी-फील्ड इनपुट के लिए एक फॉर्म/पॉपओवर।

```tsx
import { askUserQuestion, sendToAgentChat } from "@agent-native/core/client";

const length = await askUserQuestion({
  question: "How long should this deck be?",
  header: "Deck length", // optional short chip/heading (≈12 chars)
  options: [
    { label: "Short (3–5 slides)", value: "short" },
    { label: "Medium (6–10 slides)", value: "medium", recommended: true },
    { label: "Long (11+ slides)", value: "long" },
  ],
  allowFreeText: false, // omit the "Other" free-text option (default adds it)
  allowMultiple: false, // single-select (default)
});

if (length) {
  sendToAgentChat({ message: `Generate a ${length} deck.`, submit: true });
}
```

प्रत्येक विकल्प `{ label, value?, description?, preview?, recommended? }` है; `value`
`label` पर डिफ़ॉल्ट होता है, और `preview` के अंतर्गत एक छोटा मॉकअप/कोड स्निपेट प्रस्तुत करता है
विकल्प। वादा चयनित `value` (या `value[]` जब
`allowMultiple`), जब उपयोगकर्ता "अन्य", या `null` चुनता है तो फ्री-टेक्स्ट स्ट्रिंग
यदि वे छोड़ देते हैं - यह तब तक लंबित रहता है जब तक उपयोगकर्ता उत्तर नहीं देता। एजेंट पैनल की आवश्यकता है
माउंट किया जाना है (यह हर टेम्पलेट में है)।

एजेंट अपने `ask-question` टूल के माध्यम से उसी UI तक पहुंचता है: इसे देना पसंद करें
एजेंट पूछता है कि जब _it_ वास्तविक कांटे से टकराता है तो यह संदर्भ से हल नहीं हो पाता है; उपयोग करें
`askUserQuestion()` जब _UI_ को किसी विकल्प पर कार्रवाई करने की आवश्यकता होती है।

## MCP ऐप होस्ट ब्रिज {#mcp-app-host-bridge}

MCP ऐप्स के रूप में एम्बेड किए गए रूट URL-पहले होने चाहिए: वर्तमान आर्टिफैक्ट को यहां से लोड करें
पथ/क्वेरी पैरामीटर, वास्तविक React मार्ग या एक केंद्रित साझा घटक प्रस्तुत करें,
और होस्ट ब्रिज का उपयोग केवल होस्ट-स्वामित्व वाले व्यवहार के लिए करें। `@agent-native/core/client`
सहायक एम्बेडेड रूट कॉल निर्यात करता है:

```ts
import {
  getMcpAppHostContext,
  openMcpAppHostLink,
  requestMcpAppDisplayMode,
  updateMcpAppModelContext,
  useMcpAppHostContext,
} from "@agent-native/core/client";
```

`getMcpAppHostContext()` नवीनतम पुश किए गए होस्ट संदर्भ स्नैपशॉट को पढ़ता है;
`useMcpAppHostContext()` परिवर्तनों के लिए React घटकों की सदस्यता लेता है। अनुरोध
सहायक (`openMcpAppHostLink`, `requestMcpAppDisplayMode`,
`updateMcpAppModelContext`) एम्बेडेड MCP ऐप फ्रेम के बाहर `false` लौटाएं, या
एक फ्रेम के अंदर `Promise<boolean>`। `sendToAgentChat()`
एम्बेडेड मार्गों से स्वतः सबमिट किए गए संकेत।

पुल स्वयं - `ui/*` JSON-RPC संदेश, `agentNative.mcpHost.*`
रैपर रिले, ट्रांसप्लांट बनाम नियंत्रित-फ़्रेम रेंडरिंग, होस्ट संदर्भ, और
डिस्प्ले-मोड अनुरोध - स्वामित्व
[External Agents](/docs/external-agents#mcp-app-bridge).

## गतिशील सुझाव {#dynamic-suggestions}

`<AgentSidebar>`, `<AgentPanel>`, और `<AssistantChat>` डिफ़ॉल्ट रूप से संदर्भ-जागरूक सुझावों के साथ स्थिर `suggestions` को मर्ज करते हैं। फ्रेमवर्क एप्लिकेशन स्थिति से `navigation`, `selection`, `pending-selection-context` और वर्तमान URL को पढ़ता है, जबकि एक खाली चैट दिखाई देती है, फिर वर्तमान स्क्रीन से मेल खाने वाले त्वरित चिप्स प्रदान करता है।

```tsx
<AgentSidebar
  suggestions={["Summarize my inbox"]}
  dynamicSuggestions={{ max: 4 }}
>
  <App />
</AgentSidebar>
```

केवल स्थिर चिप्स रखने के लिए `dynamicSuggestions={false}` सेट करें। जब कोई ऐप समान एप्लिकेशन-स्टेट संदर्भ से नियतात्मक डोमेन-विशिष्ट चिप्स चाहता है तो `getSuggestions` पास करें।

## useAgentChatGenerating() {#useagentchatgenerating}

React हुक जो लोडिंग स्थिति ट्रैकिंग के साथ sentToAgentChat को लपेटता है:

```ts
import { useAgentChatGenerating } from "@agent-native/core/client";

function GenerateButton() {
  const [isGenerating, send] = useAgentChatGenerating();

  return (
    <button
      disabled={isGenerating}
      onClick={() => send({
        message: "Generate a summary",
        context: documentContent,
        submit: true,
      })}
    >
      {isGenerating ? "Generating..." : "Generate"}
    </button>
  );
}
```

जब आप `send()` पर कॉल करते हैं तो `isGenerating` सत्य हो जाता है और जब एजेंट जनरेट करना समाप्त कर देता है तो स्वचालित रूप से गलत पर रीसेट हो जाता है।

## useDbSync(विकल्प?) {#usedbsync}

React हुक (पूर्व में `useFileWatcher`) जो SSE पर डेटाबेस परिवर्तनों को सुनता है, पोलिंग पर वापस आ जाता है, और फ्रेमवर्क क्वेरी कैश को अमान्य कर देता है जो UI को एजेंट राइट्स के साथ संरेखित रखता है:

```ts
import { useDbSync } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";

function App() {
  const queryClient = useQueryClient();

  useDbSync({
    queryClient,
    pollUrl: "/_agent-native/poll",
    onEvent: (data) => console.log("Data changed:", data),
  });

  return <div>...</div>;
}
```

### विकल्प {#usedbsync-options}

| विकल्प             | प्रकार             | विवरण                                                                                      |
| ------------------ | ------------------ | ------------------------------------------------------------------------------------------ |
| `queryClient`      | `QueryClient?`     | कैश अमान्यकरण के लिए React-क्वेरी क्लाइंट                                                  |
| `queryKeys`        | `string[]?`        | बहिष्कृत और उपेक्षित; पुरानी कॉल साइटों के लिए रखा गया                                     |
| `pollUrl`          | `string?`          | पोल समापन बिंदु URL। डिफ़ॉल्ट: `"/_agent-native/poll"`                                     |
| `sseUrl`           | `string \| false?` | SSE endpoint URL. Default: `"/_agent-native/events"`; pass `false` to use polling only     |
| `interval`         | `number?`          | मतदान अंतराल एमएस में। डिफ़ॉल्ट: `2000`                                                    |
| `fallbackInterval` | `number?`          | SSE अनुपलब्ध होने पर फ़ॉलबैक मतदान अंतराल। डिफ़ॉल्ट: `15000`                               |
| `pauseWhenHidden`  | `boolean?`         | ब्राउज़र टैब छिपा होने पर मतदान रोकें। डिफ़ॉल्ट: `true`                                    |
| `ignoreSource`     | `string?`          | प्रति-टैब अनुरोध स्रोत को अनदेखा करें ताकि कोई टैब अपने स्वयं के लेखन से पुनः प्राप्त न हो |
| `onEvent`          | `(data) => void`   | वैकल्पिक कॉलबैक जब SSE/पोलिंग को एक परिवर्तन ईवेंट प्राप्त होता है                         |

सामान्य CRUD के लिए, `useActionQuery` और `useActionMutation` को प्राथमिकता दें; actions को उत्परिवर्तित करने से `source: "action"` उत्सर्जित होता है और वे हुक स्वचालित रूप से पुनः प्राप्त हो जाते हैं।

## यूजचेंजवर्जन / यूजचेंजवर्जन {#use-change-version}

फ़्रेमवर्क React क्वेरी कैश को बैकग्राउंड एजेंटों, क्रॉन जॉब्स या अन्य उपयोगकर्ताओं द्वारा किए गए परिवर्तनों के साथ सिंक करने के लिए परिवर्तन संस्करणों का उपयोग करता है।

जब कोई सर्वर-साइड डेटाबेस उत्परिवर्तन होता है, तो सर्वर एक विशिष्ट `source` कुंजी के साथ एक परिवर्तन ईवेंट रिकॉर्ड करता है। क्लाइंट का `useDbSync` श्रोता इन घटनाओं को प्राप्त करता है और उस स्रोत के लिए स्थानीय परिवर्तन संस्करण काउंटर को बंद कर देता है। संस्करण काउंटर को अपनी React क्वेरी कुंजियों में मोड़ने से, जब भी बैकएंड क्लाइंट को नई गतिविधि के बारे में सूचित करता है तो क्वेरीज़ स्वचालित रूप से पुनः प्राप्त हो जाती हैं।

- **`useChangeVersion(source: string): number`** - एक काउंटर लौटाता है जो निर्दिष्ट `source` के उत्परिवर्तित होने पर बढ़ता है।
- **`useChangeVersions(sources: readonly string[]): number`** - एकाधिक स्रोतों के लिए संस्करण काउंटरों का योग लौटाता है।

### उदाहरण: डेटाबेस के साथ एक कच्ची क्वेरी को समन्वयित करना

```tsx
import { useQuery } from "@tanstack/react-query";
import { useChangeVersion } from "@agent-native/core/client";

function DashboardView({ id }) {
  // Get version for dashboards domain source
  const v = useChangeVersion("dashboards");

  const { data } = useQuery({
    queryKey: ["dashboard", id, v], // Invalidate automatically when version bumps
    queryFn: () => fetchDashboard(id),
    placeholderData: (prev) => prev, // Prevent layout flicker during refetch
  });

  return <div>{data?.title}</div>;
}
```

### विलंबता मॉडल और अमान्य व्यवहार

- **UI-आरंभित उत्परिवर्तन:** जब आप `useActionMutation` का उपयोग करके UI से एक क्रिया निष्पादित करते हैं, तो उत्परिवर्तन तुरंत सफलता पर `source: "action"` के साथ एक स्थानीय घटना को सक्रिय करता है। यह उस क्रिया के आधार पर सभी क्वेरी कुंजियों का **तत्काल, आशावादी रीफ़ेच** ट्रिगर करता है, जिससे दृश्य विलंब से बचा जा सकता है।
- **बैकग्राउंड या एजेंट म्यूटेशन:** जब एआई एजेंट, वेबहुक या बैकग्राउंड वर्कर डेटा को म्यूट करता है, तो अपडेट क्लाइंट को प्रसारित किया जाता है। क्लाइंट का `useDbSync` इसे या तो तुरंत SSE (सर्वर-भेजे गए इवेंट) पर कैप्चर करता है या **2-सेकंड पोलिंग टिक** पर वापस आ जाता है। इसके बाद क्वेरी कुंजी संस्करण चालू हो जाता है, जिससे पृष्ठभूमि रीफ़ेच ट्रिगर हो जाता है।

```an-diagram title="रीफ़ेच के लिए दो रास्ते" summary="एक स्थानीय उत्परिवर्तन अपने स्वयं के कैश को तुरंत अमान्य कर देता है; एक दूरस्थ लेखन इस टैब पर SSE, या फ़ॉलबैक के रूप में पोलिंग टिक तक पहुंचता है।"
{
  "html": "<div class=\"diagram-latency\"><div class=\"diagram-col\"><div class=\"diagram-card\" data-rough><span class=\"diagram-pill ok\">यह टैब</span><strong>useActionMutation</strong><small class=\"diagram-muted\">fires source: \"action\" on success &rarr; instant local refetch</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill accent\">एजेंट · webhook · दूसरा टैब</span><strong>रिमोट लेखन</strong><small class=\"diagram-muted\">SSE push, or the ~2s polling tick as fallback &rarr; version bumps &rarr; background refetch</small></div></div></div>",
  "css": ".diagram-latency .diagram-col{display:flex;flex-direction:column;gap:12px}.diagram-latency .diagram-card{display:flex;flex-direction:column;gap:4px;padding:14px 16px}"
}
```

## cn(...इनपुट) {#cn}

वर्ग नामों को मर्ज करने की उपयोगिता (clsx + टेलविंड-मर्ज):

```ts
import { cn } from "@agent-native/core/client";

<div className={cn(
  "px-4 py-2 rounded",
  isActive && "bg-primary text-primary-foreground",
  className
)} />
```
