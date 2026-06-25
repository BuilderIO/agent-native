---
title: "मूल चैट UI"
description: "एक्शन-घोषित देशी चैट रेंडरर्स, पुन: प्रयोज्य डेटाटेबल/डेटाचार्ट आउटपुट, और BYO एजेंट रनटाइम को Agent-Native चैट से कैसे कनेक्ट होना चाहिए।"
---

# मूल चैट UI

नेटिव चैट UI प्रथम-पक्ष एजेंट आउटपुट के लिए इन-ऐप रेंडरिंग पथ है। एक
एक्शन रिटर्न संरचित JSON, चैट रनटाइम एक स्पष्ट विजेट को पहचानता है
विभेदक, और `<AssistantChat>` एक वास्तविक React घटक प्रस्तुत करता है
बातचीत। आप
सामान्य ऐप चैट।

जब उपयोगकर्ता को आउटपुट का निरीक्षण करना चाहिए कि एजेंट कहां है तो मूल चैट UI का उपयोग करें
पहले से ही बोल रहा हूँ: क्वेरी परिणाम, प्रतिक्रिया अंतर्दृष्टि, सेटअप सारांश,
अनुमोदन/अस्वीकृति नियंत्रण, या ऐप दृश्यों में लिंक। [MCP Apps](/docs/mcp-apps)
जब किसी बाहरी होस्ट जैसे Claude, ChatGPT, Copilot, या कर्सर को रेंडर करना चाहिए
आपके ऐप से एक इनलाइन रूट।

```an-diagram title="मूल रेंडर पथ" summary="एक क्रिया रिटर्न JSON; रनटाइम एक स्पष्ट विजेट विवेचक या चैटयूआई.रेंडरर से मेल खाता है; AssistantChat एक वास्तविक React घटक स्थापित करता है। कोई आईफ्रेम नहीं, कोई HTML निष्पादन नहीं।"
{
  "html": "<div class=\"diagram-render\"><div class=\"diagram-node\">Action चलता है<br><small class=\"diagram-muted\">संरचित JSON लौटाता है</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Match</span><small class=\"diagram-muted\">explicit widget &middot; chatUI.renderer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">&lt;AssistantChat&gt;<br><small class=\"diagram-muted\">React widget माउंट करता है</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill ok\">DataTable</div><div class=\"diagram-pill ok\">DataChart</div><div class=\"diagram-pill ok\">DataInsights</div></div></div>",
  "css": ".diagram-render{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-render .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-render .col{display:flex;flex-direction:column;gap:6px;padding:12px}.diagram-render .diagram-arrow{font-size:22px;line-height:1}"
}
```

## कार्रवाई-घोषित विजेट {#action-declared-widgets}

मूल पथ के दो स्पष्ट भाग हैं:

- `outputSchema` क्रिया की प्रतिक्रिया आकृति को मान्य करता है।
- `chatUI.renderer` मान्य परिणाम के लिए मूल React रेंडरर का चयन करता है।

अंतर्निहित डेटा रेंडरर्स `widget` प्लस के साथ एक सादे JSON परिणाम का उपयोग करते हैं
मिलान पेलोड:

| विजेट             | आवश्यक पेलोड                | के रूप में प्रस्तुत करता है                           |
| ----------------- | --------------------------- | ----------------------------------------------------- |
| `"data-table"`    | `table`                     | एक मूल, पुन: प्रयोज्य डेटा तालिका                     |
| `"data-chart"`    | `chartSeries`               | एक मूल बार, रेखा, या क्षेत्र चार्ट                    |
| `"data-insights"` | `table` और/या `chartSeries` | चार्ट/टेबल आउटपुट के साथ एक संयुक्त अंतर्दृष्टि कार्ड |

सर्वर actions को सर्वर-सुरक्षित सहायक और स्कीमा आयात करना चाहिए
`@agent-native/core/data-widgets`; क्लाइंट कोड
`@agent-native/core/client/chat` या `@agent-native/core/client`.

```ts
import { defineAction } from "@agent-native/core/action";
import { ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER } from "@agent-native/core/action-ui";
import {
  createDataInsightsWidgetResult,
  dataInsightsWidgetResultSchema,
} from "@agent-native/core/data-widgets";

export default defineAction({
  description: "Analyze form responses.",
  readOnly: true,
  outputSchema: dataInsightsWidgetResultSchema,
  chatUI: {
    renderer: ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER,
    title: "Response insights",
  },
  run: async () =>
    createDataInsightsWidgetResult({
      title: "Response insights",
      display: {
        title: "42 responses",
        description: "Completion rate rose this week.",
        primaryAction: {
          label: "Open response insights",
          href: "/response-insights",
        },
      },
      chartSeries: {
        type: "bar",
        title: "Responses by day",
        xKey: "day",
        series: [{ key: "responses", label: "Responses" }],
        data: [
          { day: "Mon", responses: 8 },
          { day: "Tue", responses: 13 },
        ],
      },
      table: {
        title: "Top answers",
        columns: [
          { key: "answer", label: "Answer" },
          { key: "count", label: "Count", align: "right" },
        ],
        rows: [
          { answer: "Yes", count: 31 },
          { answer: "No", count: 11 },
        ],
        totalRows: 2,
      },
    }),
});
```

```an-callout
{
  "tone": "success",
  "body": "रेंडरर तभी कार्यभार संभालता है जब कार्रवाई `chatUI` घोषित करती है **या** परिणाम में एक स्पष्ट ज्ञात `widget` विभेदक होता है। यह कभी भी मनमानी वस्तुओं को आकार नहीं देता है और टूल परिणामों से कभी भी HTML या JavaScript निष्पादित नहीं करता है - इसलिए एक मूल विजेट एक इंजेक्शन वेक्टर नहीं बन सकता है।"
}
```

जब कोई उपयोगकर्ता चार्ट, ग्राफ़, तालिका, प्रवृत्ति, या कॉम्पैक्ट रिपोर्ट, ऐप एजेंट मांगता है
ऐसी कार्रवाई को प्राथमिकता देनी चाहिए जो इन मूल रेंडरर्स में से किसी एक को घोषित करती हो। अंतिम
सहायक पाठ संक्षिप्त रहना चाहिए और विजेट को डेटा ले जाने देना चाहिए; कॉपी न करें
मार्कडाउन तालिका में समान पंक्तियाँ, जब तक कि उपयोगकर्ता स्पष्ट रूप से पाठ न माँगे
निर्यात.

जब कोई डोमेन कार्रवाई मौजूद नहीं है लेकिन एजेंट ने पहले ही कॉम्पैक्ट पुनर्प्राप्त कर लिया है,
सच्चा डेटा, यह फ्रेमवर्क को `render-data-widget` एक्शन के साथ कॉल कर सकता है
वही `data-table`, `data-chart`, या `data-insights` JSON आकार। यह क्रिया केवल
विजेट को सत्यापित और प्रस्तुत करता है; यह एक डेटा स्रोत नहीं है और इसका उपयोग नहीं किया जाना चाहिए
प्लेसहोल्डर मेट्रिक्स का आविष्कार करने के लिए।

## डेटाटेबल आउटपुट {#data-table}

`table` जानबूझकर सरल है इसलिए सूची, SQL, विश्लेषण और सेटअप actions कर सकते हैं
इसे पुन: उपयोग करें:

```ts
{
  title?: string;
  columns: Array<{ key: string; label: string; align?: "left" | "right" }>;
  rows: Array<Record<string, unknown>>;
  totalRows?: number;
  sampledRows?: number;
  truncated?: boolean;
}
```

स्थिर कॉलम कुंजियाँ और JSON-सुरक्षित पंक्ति मान को प्राथमिकता दें। `totalRows` का प्रयोग करें,
`sampledRows`, और `truncated` जब क्रिया एक बड़े टुकड़े को दिखा रही हो
परिणाम सेट.

## डेटाचार्ट आउटपुट {#data-chart}

`chartSeries` बिना एजेंट उत्तरों में उपयोग किए जाने वाले सामान्य चार्ट आकारों का समर्थन करता है
प्रत्येक टेम्प्लेट को अपना स्वयं का चैट रेंडरर भेजना आवश्यक है:

```ts
{
  type: "bar" | "line" | "area";
  title?: string;
  xKey: string;
  series: Array<{ key: string; label: string; color?: string }>;
  data: Array<Record<string, unknown>>;
  sampled?: boolean;
}
```

चार्ट डेटा को संक्षिप्त रखें। बड़े डेटासेट के लिए, क्रिया और लिंक में एकत्र करें
`display.primaryAction` या कार्रवाई `link` मेटाडेटा के साथ पूर्ण ऐप दृश्य के लिए।

## नेटिव विजेट बनाम MCP ऐप्स {#native-vs-mcp-apps}

नेटिव चैट विजेट और MCP ऐप्स पूरक हैं:

- **नेटिव विजेट** ऐप के अपने चैट रनटाइम के लिए हैं। कार्रवाई का परिणाम है
  JSON, और फ्रेमवर्क अंतर्निहित React विजेट प्रस्तुत करता है।
- **MCP ऐप्स** बाहरी होस्ट के लिए हैं। क्रिया `mcpApp` घोषित करती है और आमतौर पर
  `link`, और होस्ट समर्थित होने पर एक वास्तविक ऐप रूट इनलाइन प्रस्तुत करता है।
- **गहरे लिंक** सार्वभौमिक फ़ॉलबैक बने हुए हैं। क्रिया `link` या
  `display.primaryAction` इसलिए CLI क्लाइंट, पुराने MCP होस्ट और सादा ट्रांसक्रिप्ट
  पाठक संपूर्ण ऐप दृश्य खोल सकते हैं।

जब एक देशी विजेट पेलोड और MCP ऐप्स मेटाडेटा दोनों मौजूद हों, तो इन-ऐप
चैट मूल विजेट को प्राथमिकता देता है। बाहरी होस्ट MCP ऐप्स संसाधन या
डीप लिंक फ़ॉलबैक.

## कस्टम देशी रेंडरर्स {#custom-native-renderers}

सटीक रेंडरर आईडी द्वारा उत्पाद-विशिष्ट घटकों को पंजीकृत करें, फिर उस आईडी को घोषित करें
कार्रवाई पर:

```tsx
import { registerActionChatRenderer } from "@agent-native/core/client/chat";

registerActionChatRenderer({
  id: "crm.deal-card",
  renderer: "crm.deal-card",
  Component: ({ context }) => <DealCard result={context.resultJson} />,
});
```

```ts
export default defineAction({
  description: "Show a deal card.",
  outputSchema: dealCardSchema,
  chatUI: { renderer: "crm.deal-card" },
  run: async () => ({ dealId: "deal_123", amount: 42000 }),
});
```

प्रथम-पक्ष ऐप UI के लिए इसका उपयोग करें। `mcpApp` में क्रॉस-होस्ट iframe UI रखें, और
चैट में कच्चे SQL के बजाय टाइप किए गए actions को पढ़ने के पीछे मनमाना क्वेरी निष्पादन।

## BYO एजेंट रनटाइम {#byo-agent-runtimes}

`AgentChatRuntime` चैट शेल के लिए अपना एजेंट लाने का अनुबंध है, और
यह अनुभाग इसका विहित संदर्भ है। यह आपको एक एजेंट देता है जिसे आपने कहीं और बनाया है
रखते हुए सामान्यीकृत घटनाओं को Agent-Native की बातचीत UI में स्ट्रीम करें
साझा कंपोजर, ट्रांसक्रिप्ट रेंडरिंग, टूल कार्ड, अनुमोदन, मूल विजेट,
और आसपास का ऐप लेआउट। [Drop-in Agent](/docs/drop-in-agent#custom-chat-ui)
रनटाइम कहानी के लिए यहां ट्यूटोरियल बिंदु, और [Component API](/docs/components#agent-chat-ui)
प्रत्येक कनेक्टर और एडाप्टर को उसके आयात पथ के साथ सूचीबद्ध करता है; अनुबंध स्वयं
नीचे वर्णित है।

```an-diagram title="BYO रनटाइम Agent-Native चैट शेल रखता है" summary="आपका बाहरी एजेंट एक कनेक्टर के माध्यम से सामान्यीकृत घटनाओं को स्ट्रीम करता है; Agent-Native कंपोज़र, ट्रांसक्रिप्ट, टूल कार्ड, अनुमोदन और मूल विजेट रखता है।"
{
  "html": "<div class=\"diagram-byo\"><div class=\"diagram-box\" data-rough>आपका एजेंट<br><small class=\"diagram-muted\">OpenAI &middot; Claude &middot; Vercel AI &middot; AG-UI &middot; HTTP</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">connector</span><small class=\"diagram-muted\">सामान्यीकृत message-* / tool-* इवेंट</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill\">&lt;AssistantChat runtime=&hellip; /&gt;</div><small class=\"diagram-muted\">composer &middot; transcript &middot; tool cards</small><small class=\"diagram-muted\">approvals &middot; native widgets</small></div></div>",
  "css": ".diagram-byo{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-byo .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-byo .col{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-byo .diagram-arrow{font-size:22px;line-height:1}"
}
```

सभी कनेक्टर `@agent-native/core/client/chat` (और रूट
`@agent-native/core/client` प्रविष्टि)। जब आपका एजेंट
एक POST एंडपॉइंट को उजागर कर सकता है जो SSE या NDJSON रनटाइम इवेंट लौटाता है:

```tsx
import {
  AssistantChat,
  createHttpAgentChatRuntime,
} from "@agent-native/core/client/chat";

const runtime = createHttpAgentChatRuntime({
  id: "external:mastra",
  label: "Mastra",
  endpoint: "/api/mastra/chat",
  headers: async () => ({
    Authorization: `Bearer ${await getAgentToken()}`,
  }),
});

export function SupportChat() {
  return <AssistantChat runtime={runtime} threadId="support" />;
}
```

यदि आपका एंडपॉइंट पहले से ही एक सामान्य एजेंट प्रोटोकॉल स्ट्रीम करता है, तो मिलान का उपयोग करें
कनेक्टर और एक कस्टम मैपर लिखना छोड़ें:

```ts
import {
  createAgUiChatRuntime,
  createClaudeAgentChatRuntime,
  createOpenAIAgentsChatRuntime,
  createOpenAIResponsesChatRuntime,
  createVercelAiChatRuntime,
} from "@agent-native/core/client/chat";

const openAiAgentsRuntime = createOpenAIAgentsChatRuntime({
  endpoint: "/api/openai-agents/chat",
});

const openAiResponsesRuntime = createOpenAIResponsesChatRuntime({
  endpoint: "/api/openai-responses/chat",
});

const claudeAgentRuntime = createClaudeAgentChatRuntime({
  endpoint: "/api/claude-agent/chat",
});

const vercelAiRuntime = createVercelAiChatRuntime({
  endpoint: "/api/vercel-ai/chat",
});

const agUiRuntime = createAgUiChatRuntime({
  endpoint: "/api/ag-ui/chat",
});
```

समापन बिंदु सामान्यीकृत घटना आकार को सीधे स्ट्रीम कर सकता है:

```text
data: {"type":"message-start","message":{"id":"m1","role":"assistant","content":[]}}
data: {"type":"message-delta","messageId":"m1","delta":{"type":"text","text":"Hello"}}
data: {"type":"tool-start","toolCall":{"id":"t1","name":"query","input":{"q":"forms"}}}
data: {"type":"tool-done","toolCallId":"t1","toolName":"query","status":"completed","resultText":"34 rows"}
data: {"type":"done","reason":"complete"}
```

बहुत सरल एजेंटों के लिए, एक JSON प्रतिक्रिया `{ "text": "..." }` स्वीकार की जाती है और
एकल सहायक संदेश में परिवर्तित। अमीर एजेंटों के लिए, स्ट्रीम करें
`message-*`, `tool-*`, `approval-request`, `status`, `artifact`, `file`,
`usage`, `error`, और `done` इवेंट। टूल परिणाम `mcpApp` या
`chatUI` मेटाडेटा, इसलिए एक्शन-घोषित देशी विजेट अभी भी बिना प्रस्तुत होते हैं
iframes.

जब आप रनटाइम ऑब्जेक्ट के रूप में अंतर्निहित Agent-Native ट्रांसपोर्ट चाहते हैं, तो इसका उपयोग करें:

```ts
import { createAgentNativeChatRuntime } from "@agent-native/core/client/chat";

const runtime = createAgentNativeChatRuntime({
  threadId: "forms-chat",
  mode: "act",
});
```

`<AssistantChat createAdapter={...} />` का उपयोग केवल तभी करें जब आपको पूर्ण की आवश्यकता हो
assistant-ui adapter control. Use `PromptComposer` by itself when your product
संपूर्ण बाहरी प्रतिलेख का स्वामी है और केवल Agent-Native का कंपोजर चाहता है
फ़ील्ड.

OpenAI, AG-UI, Claude एजेंट SDK, और वर्सेल AI SDK स्ट्रीम मानक का उपयोग कर सकते हैं
कनेक्टर सहायक। ACP कोडिंग-एजेंट/एडिटर इंटरऑपरेबिलिटी बनी हुई है,
अंतिम उपयोगकर्ताओं के लिए सामान्य ऐप-चैट रनटाइम। यहां A2UI के समर्थित होने का दावा नहीं किया गया है;
यदि यह परिपक्व हो जाता है, तो इसे इसी स्पष्ट रनटाइम/विजेट अनुबंध में अनुकूलित होना चाहिए।

## संबंधित दस्तावेज़ {#related-docs}

- [Actions](/docs/actions) - उन ऑपरेशनों को परिभाषित करें जो मूल विजेट डेटा लौटाते हैं।
- [Agent Surfaces](/docs/agent-surfaces) - तय करें कि आपको हेडलेस, चैट, साइडकार या पूर्ण ऐप की आवश्यकता है या नहीं।
- [Drop-in Agent](/docs/drop-in-agent) - मानक चैट रनटाइम को माउंट करने के लिए ट्यूटोरियल।
- [Component API](/docs/components) - चैट लेयर्स, रनटाइम और टूल रेंडरर्स के लिए प्रति-निर्यात API मानचित्र।
- [MCP Apps](/docs/mcp-apps) - बाहरी MCP होस्ट के लिए इनलाइन UI।
- [Key Concepts](/docs/key-concepts#protocols) - प्रोटोकॉल स्थिति और स्थिति।
