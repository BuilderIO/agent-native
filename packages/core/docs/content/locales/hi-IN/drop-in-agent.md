---
title: "ड्रॉप-इन एजेंट"
description: "एजेंट चैट + वर्कस्पेस को <AgentPanel>, <AgentSidebar>, और sentToAgentChat() के साथ किसी भी React ऐप में माउंट करें।"
---

# ड्रॉप-इन एजेंट

> **डेवलपर पेज।** यह पेज एजेंट को React ऐप में एम्बेड करने वाले डेवलपर्स के लिए है। एजेंट के साथ काम करने के अंतिम-उपयोगकर्ता अनुभव के लिए, [Using Your Agent](/docs/using-your-agent) देखें।

आपको शुरुआत से एजेंट-नेटिव बनाने की आवश्यकता नहीं है। एजेंट चैट, वर्कस्पेस टैब, CLI टर्मिनल, वॉयस इनपुट, और सभी संबंधित बुनियादी ढांचे को मुट्ठी भर React घटकों के रूप में शिप किया जाता है जिन्हें आप किसी भी ऐप में डालते हैं।

> **पूर्वावश्यकता:** सर्वर को `agent-chat-plugin` चलाना होगा (यह प्रत्येक टेम्पलेट में स्वचालित रूप से माउंट होता है)। यदि आप शून्य से शुरू कर रहे हैं, तो [Server](/docs/server) देखें।
>
> ट्यूटोरियल के बजाय सार्वजनिक API मानचित्र की आवश्यकता है? [Component API](/docs/components) देखें.

## घटक एक नज़र में {#components}

| घटक                   | यह क्या है                                                                                 | इसका उपयोग तब करें जब                                         |
| --------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `<AgentSidebar>`      | आपके रूट ऐप लेआउट को लपेटता है और पूर्ण एजेंट युक्त एक टॉगल करने योग्य साइड पैनल जोड़ता है | आप चाहते हैं कि एजेंट आपके ऐप के साथ हर स्क्रीन पर उपलब्ध हो  |
| `<AgentToggleButton>` | `<AgentSidebar>` को खोलता/बंद करता है (इसे अपने हेडर में रखें)                             | `<AgentSidebar>` के साथ युग्मित करें                          |
| `<AgentPanel>`        | कच्चा पैनल स्वयं - चैट + CLI + कार्यस्थान टैब                                              | आप लेआउट, या एक समर्पित एजेंट पेज पर पूर्ण नियंत्रण चाहते हैं |
| `<AgentChatSurface>`  | एक पूर्व-वायर्ड पैनल/पेज चैट सतह                                                           | आप साइडबार रैपर के बिना चैट करना चाहते हैं                    |
| `<AssistantChat>`     | संगीतकार/इतिहास हुक के साथ निचले स्तर का चैट रेंडरर                                        | आपको मानक वार्तालाप UI                                        |
| `sendToAgentChat()`   | प्रोग्रामेटिक रूप से चैट पर एक संदेश भेजें                                                 | एक बटन जो इनलाइन चलने के बजाय एजेंट को काम सौंपता है          |
| `useActionMutation()` | किसी क्रिया के चारों ओर टाइपसेफ फ्रंटएंड रैपर                                              | UI को वही ऑपरेशन चलाने की ज़रूरत है जो एक एजेंट टूल चलाएगा    |

ये सभी `@agent-native/core/client` से निर्यात किए जाते हैं।

```an-diagram title="माउंट मॉडल" summary="<AgentSidebar> आपके मौजूदा लेआउट को लपेटता है। आपके मार्ग मुख्य क्षेत्र में प्रस्तुत होते हैं; एजेंट पैनल उनके बगल में लगा होता है। <AgentPanel> बिना रैपर वाला वही पैनल है।"
{
  "html": "<div class=\"diagram-mount\"><div class=\"diagram-box sidebar\" data-rough><span class=\"diagram-pill accent\">&lt;AgentSidebar&gt;</span><div class=\"inner\"><div class=\"diagram-node main\">आपका ऐप<br><small class=\"diagram-muted\">children: header + &lt;Outlet/&gt;</small></div><div class=\"diagram-node panel\">एजेंट पैनल<br><small class=\"diagram-muted\">chat &middot; CLI &middot; workspace</small></div></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-card alt\"><span class=\"diagram-pill\">&lt;AgentPanel&gt;</span><small class=\"diagram-muted\">same panel, no wrapper &mdash; you own the layout</small></div></div>",
  "css": ".diagram-mount{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-mount .sidebar{display:flex;flex-direction:column;gap:8px;padding:14px}.diagram-mount .inner{display:flex;gap:10px}.diagram-mount .main{flex:2}.diagram-mount .panel{flex:1}.diagram-mount .alt{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-mount .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 80% मामला: `<AgentSidebar>` {#sidebar}

सबसे आम सेटअप एक साइडबार है जो किसी भी स्क्रीन पर दाईं ओर से खुलता है।
अपने मौजूदा रूट लेआउट को `<AgentSidebar>` के साथ लपेटें; जिसे भी आप
बच्चे मुख्य ऐप क्षेत्र में रहते हैं। एजेंट चैट साइड पैनल है।

```an-annotated-code title="रूट लेआउट को <AgentSidebar> के साथ लपेटना"
{
  "filename": "app/root.tsx",
  "language": "tsx",
  "code": "import { Outlet } from \"react-router\";\nimport { AgentSidebar, AgentToggleButton } from \"@agent-native/core/client\";\n\nexport default function Root() {\n  return (\n    <AgentSidebar\n      emptyStateText=\"मैं कैसे मदद कर सकता हूं?\"\n      suggestions={[\n        \"Summarize my inbox\",\n        \"Draft a reply to the latest email\",\n        \"Show me yesterday's signup numbers\",\n      ]}\n      dynamicSuggestions\n      defaultSidebarWidth={420}\n      position=\"right\"\n    >\n      <header>\n        <AgentToggleButton />\n      </header>\n\n      <main>\n        <Outlet />\n      </main>\n    </AgentSidebar>\n  );\n}",
  "annotations": [
    { "lines": "6", "label": "आवरण", "note": "`<AgentSidebar>` wraps your whole layout. It adds the toggleable side panel; everything you pass as children stays in the main app area." },
    { "lines": "8-12", "label": "संकेत प्रारंभ करता है", "note": "`suggestions` खाली चैट पर क्लिक करने योग्य चिप्स के रूप में प्रस्तुत करें।" },
    { "lines": "13", "label": "संदर्भ-जागरूक चिप्स", "note": "`dynamicSuggestions` merges screen-aware prompts (e.g. \"Summarize this selection\") with your static ones. On by default." },
    { "lines": "18-20", "label": "टॉगल बटन", "note": "Put `<AgentToggleButton />` anywhere in your header to open and close the panel." },
    { "lines": "22-24", "label": "आपका ऐप", "note": "`<Outlet/>` (your routes) renders in the main area, untouched." }
  ]
}
```

बस इतना ही। उपयोगकर्ता के पास अब प्रत्येक पृष्ठ पर एक टॉगल करने योग्य एजेंट है - चैट इतिहास, कार्यक्षेत्र टैब, CLI टर्मिनल, वॉयस इनपुट और एक फुलस्क्रीन मोड के साथ। स्थिति `localStorage` के माध्यम से पुनः लोड करने पर बनी रहती है।

### प्रॉप्स

- **`children`** - आपके ऐप का सामान्य लेआउट और रूट। मुख्य क्षेत्र में प्रस्तुत; एजेंट पैनल डेस्कटॉप पर इसके बगल में और मोबाइल/फुलस्क्रीन पर इसके ऊपर लगा होता है।
- **`emptyStateText`** — जब चैट में कोई संदेश न हो तो अभिवादन दिखाया जाता है। डिफ़ॉल्ट: `"How can I help you?"`.
- **`suggestions`** - खाली होने पर स्टार्टर संकेत क्लिक करने योग्य चिप्स के रूप में प्रस्तुत किया जाता है।
- **`dynamicSuggestions`** - संदर्भ-जागरूक प्रॉम्प्ट चिप्स को `suggestions` के साथ विलय कर दिया गया। डिफ़ॉल्ट रूप से सक्षम; केवल स्थिर सुझाव दिखाने के लिए `false` पास करें, या अनुकूलित करने के लिए `{ max, includeStatic, getSuggestions }` पास करें।
- **`defaultSidebarWidth`** - प्रारंभिक पिक्सेल चौड़ाई (केवल माउंट; उपयोगकर्ता का आकार और सहेजा गया मान ओवरराइड)। डिफ़ॉल्ट: `380`.
- **`position`** — `"left"` या `"right"`। डिफ़ॉल्ट: `"right"`.
- **`defaultOpen`** — क्या साइडबार खुलना शुरू होता है (केवल डेस्कटॉप)। डिफ़ॉल्ट: `false`.

## अन्य 20%: `<AgentPanel>` {#panel}

जब आपको लेआउट पर पूर्ण नियंत्रण की आवश्यकता होती है - एक समर्पित `/chat` मार्ग, आपके द्वारा प्रबंधित साइड कॉलम में एक एम्बेडेड पैनल, या एक पॉपअप - सीधे `<AgentPanel>` प्रस्तुत करें:

```tsx
// app/routes/agent.tsx
import { AgentPanel } from "@agent-native/core/client";

export default function AgentRoute() {
  return (
    <div className="h-screen">
      <AgentPanel defaultMode="chat" className="h-full" />
    </div>
  );
}
```

`<AgentPanel>` आपको साइडबार रैपर, कोलैप्स बटन या किसी भी स्टेट पर्सिस्टेंस के बिना रॉ टैब (चैट / CLI / वर्कस्पेस) देता है। जहां चाहो वहां रख दो; आप लेआउट संभालें.

### चयनित प्रॉप्स

- **`defaultMode`** — `"chat"` या `"cli"`। डिफ़ॉल्ट: `"chat"`.
- **`className`** - बाहरी कंटेनर के लिए CSS वर्ग।
- **`onCollapse`** - यदि प्रदान किया गया है, तो हेडर में एक संक्षिप्त बटन दिखाई देता है।
- **`isFullscreen`** / **`onToggleFullscreen`** - यदि आप Claude-शैली केंद्रित कॉलम चाहते हैं तो बाहरी पूर्णस्क्रीन स्थिति को तार दें।
- **`storageKey`** — `localStorage` कुंजियों के लिए नामस्थान। तब उपयोगी होता है जब आप एक ही पेज में एकाधिक पैनल (अलग-अलग ऐप इंस्टेंस या वर्कस्पेस) प्रस्तुत करते हैं।

पूर्ण प्रॉप्स: `@agent-native/core/client` में `AgentPanelProps`।

## प्रोग्रामेटिक संदेश: `sendToAgentChat()` {#send}

एक बटन जो एजेंट को काम सौंपता है (इनलाइन `llm()` कॉल चलाने के बजाय - [ladder](/docs/what-is-agent-native#the-ladder) से एंटी-पैटर्न):

```tsx
import { sendToAgentChat } from "@agent-native/core/client";

<Button
  onClick={() =>
    sendToAgentChat({
      message: "Generate a chart showing signups by source",
      context: `Dashboard ID: ${dashboardId}, date range: last 30 days`,
      submit: true,
    })
  }
>
  Generate chart
</Button>;
```

### विकल्प

- **`message`** — चैट में दिखाया गया दृश्य संकेत।
- **`context`** - छिपा हुआ संदर्भ प्रॉम्प्ट से जुड़ा हुआ है (चयनित पाठ, कर्सर स्थिति, वर्तमान इकाई आईडी - कुछ भी एजेंट को पता होना चाहिए लेकिन उपयोगकर्ता को दो बार नहीं देखना चाहिए)।
- **`submit`** - `true` ऑटो-रन के लिए, `false` प्रीफिल करने के लिए लेकिन प्रतीक्षा करें। प्रोजेक्ट डिफ़ॉल्ट का उपयोग करना छोड़ें.
- **`newTab`** — इस प्रॉम्प्ट के लिए एक अलग चैट थ्रेड बनाएं।
- **`background`** - `newTab` के साथ, नए थ्रेड पर ध्यान केंद्रित किए बिना चलाएं। छिपे हुए रन को `RunsTray` में ट्रैक किया जाता है।
- **`openSidebar`** - पृष्ठभूमि/मूक प्रेषण के लिए `false` पर सेट करें। डिफ़ॉल्ट रूप से साइडबार खुलता है ताकि उपयोगकर्ता प्रतिक्रिया देख सके।
- **`type`** — `"content"` (डिफ़ॉल्ट) कार्य को एम्बेडेड ऐप एजेंट में रखता है। `"code"` कोड-संपादन फ़्रेम तक रूट करता है (एजेंट-लिखित कोड परिवर्तनों के लिए, [Frames](/docs/frames) देखें)।

`sendToAgentChat` एक स्थिर `tabId` लौटाता है जिसका उपयोग आप चैट रन को ट्रैक करने के लिए कर सकते हैं।

मौन कार्य के लिए, `newTab`, `background`, और `openSidebar: false` को जोड़ें:

```ts
sendToAgentChat({
  message: "Summarize the selected thread and save the summary",
  context: `Thread id: ${threadId}`,
  submit: true,
  newTab: true,
  background: true,
  openSidebar: false,
});
```

यह अभी भी टूल, actions, थ्रेड स्टेट और रन के साथ एक पूर्ण एजेंट रन है
ट्रैकिंग। यह उपयोगकर्ता की वर्तमान साइडबार स्थिति से फोकस चुराता नहीं है।

जब उसी रूट को MCP ऐप के रूप में एम्बेड किया जाता है, सबमिट किया जाता है
`sendToAgentChat()` कॉल होस्ट चैट पर अग्रेषित की जाती हैं जहां समर्थित है; देखें
MCP ऐप ब्रिज व्यवहार के लिए [Client](/docs/client#sendtoagentchat)।

यदि आप लोडिंग स्थिति चाहते हैं, तो `useSendToAgentChat()` हुक का उपयोग करें - यह `send` और `isGenerating` दोनों लौटाता है:

```ts
import { useSendToAgentChat } from "@agent-native/core/client";

const { send, isGenerating } = useSendToAgentChat();
```

## जब स्टॉक साइडबार उपयुक्त न हो {#custom-chat-ui}

`<AgentSidebar>` और `<AgentPanel>` अधिकांश ऐप्स को कवर करते हैं। जब आपको
एजेंट के इर्द-गिर्द लेआउट, या आप किसी एजेंट के साथ बातचीत को सशक्त बनाना चाहते हैं
आपने कहीं और निर्माण किया है, एक परत नीचे गिराएं - लेकिन ढांचे को अपने स्वामित्व में रखें
रनटाइम, actions, और SQL-समर्थित स्थिति:

- **मानक रनटाइम के आसपास क्रोम का स्वामित्व।** के लिए `<AgentChatSurface>` का उपयोग करें
  एक समर्पित चैट मार्ग, या `<AssistantChat>` जब आप कस्टम हेडर चाहते हैं,
  टैब, और मानक वार्तालाप के आसपास खाली स्थितियाँ। पूर्ण परत मानचित्र—
  प्रत्येक घटक, हुक, कंपोज़र और एडाप्टर, आयात पथ के साथ - में रहता है
  [Component API](/docs/components#agent-chat-ui).
- **अपना स्वयं का एजेंट रनटाइम लाएँ।** यदि आपने कोई एजेंट कहीं और बनाया है तो उसे लाना चाहिए
  बातचीत को सशक्त बनाएं जबकि Agent-Native कंपोजर, ट्रांसक्रिप्ट, टूल रखता है
  कार्ड, अनुमोदन और मूल विजेट, एक `AgentChatRuntime` पास करें
  `<AssistantChat runtime={...} />`. कनेक्टर्स
  (`createHttpAgentChatRuntime()` और OpenAI / Claude / Vercel AI / AG-UI
  सहायक) और इवेंट अनुबंध को
  [Native चैट UI — BYO agent runtimes](/docs/native-chat-ui#byo-agent-runtimes).

आप जो भी परत चुनें, actions और SQL-समर्थित ऐप स्थिति को अनुबंध के रूप में रखें,
और उत्पाद UI से सीधे `/_agent-native/agent-chat` पर पोस्ट करने से बचें। यदि ए
वास्तविक कस्टम सतह के लिए नामित सहायक गायब है, इसलिए पहले उस सहायक को जोड़ें
क्लाइंट कोड दूसरा, तदर्थ परिवहन नहीं सीखता।

## UI से टाइपसेफ actions: `useActionMutation()` {#use-action-mutation}

जब UI को समान ऑपरेशन चलाने की आवश्यकता होती है तो एक एजेंट टूल चलेगा - [ladder](/docs/what-is-agent-native#rung-three) का क्रमांक 3 - `useActionMutation` का उपयोग करें:

```tsx
import { useActionMutation } from "@agent-native/core/client";

const { mutate, isPending } = useActionMutation("reply-to-email");

<Button onClick={() => mutate({ emailId, body: "Thanks!" })}>
  Send Reply
</Button>;
```

टाइप-सुरक्षित तर्क आपके `defineAction()` में ज़ोड स्कीमा से आते हैं। संपूर्ण कार्य प्रणाली के लिए [Actions](/docs/actions) देखें।

```an-callout
{
  "tone": "decision",
  "body": "**`useActionMutation` vs `sendToAgentChat`.** Run the operation directly with `useActionMutation` when the user clicked a deterministic button (\"Send reply\"). Hand it to `sendToAgentChat` when the work needs the agent's reasoning, tools, or multi-step planning. Never call an inline `llm()` from UI — that is rung 1 of the [ladder](/docs/what-is-agent-native#the-ladder)."
}
```

## चयन + कर्सर जागरूकता {#selection}

एजेंट यह देख सकता है कि उपयोगकर्ता ने क्या चुना है - टेक्स्ट, सेल, स्लाइड, संपर्क - एप्लिकेशन स्थिति में `navigation` और `selection` कुंजियों के माध्यम से। खाली चैट उन कुंजियों का उपयोग गतिशील सुझाव देने के लिए भी करती है जैसे "इस चयन को सारांशित करें" या "इस स्लाइड को सुधारें" जब वर्तमान स्क्रीन उन्हें प्रासंगिक बनाती है। यदि आप चाहते हैं कि Cmd-I (या समान) संदर्भ के रूप में चैट में एक चयनित रेंज भेजे, तो [Context Awareness](/docs/context-awareness) देखें।

## यह सब एक साथ रखना {#putting-it-together}

एक सामान्य ड्रॉप-इन सेटअप:

```tsx
// app/root.tsx
import {
  AgentSidebar,
  AgentToggleButton,
  sendToAgentChat,
} from "@agent-native/core/client";

export default function Root() {
  return (
    <AgentSidebar suggestions={["Draft a reply", "Summarize selection"]}>
      <Header>
        <AgentToggleButton />
      </Header>

      <Main>
        <YourRoutes />
      </Main>
    </AgentSidebar>
  );
}
```

```tsx
// Anywhere else in the app
<Button
  onClick={() =>
    sendToAgentChat({
      message: "Summarize this thread",
      context: `Thread id: ${threadId}`,
      submit: true,
    })
  }
>
  Summarize
</Button>
```

उपयोगकर्ता हेडर में एक चैट बटन देखता है, उसे खोल सकता है, और एजेंट से बात कर सकता है। आपके बटन एक-शॉट LLM कॉल चलाने के बजाय उसी एजेंट को सौंप देते हैं।

## आगे क्या

- [**Actions**](/docs/actions) - `defineAction()` और `useActionMutation()`
- [**Context Awareness**](/docs/context-awareness) - चयन, नेविगेशन, व्यू-स्क्रीन
- [**Workspace**](/docs/workspace) - वर्कस्पेस टैब में क्या शामिल है (skills, मेमोरी, MCP सर्वर, शेड्यूल किए गए कार्य)
- [**Voice Input**](/docs/voice-input) - चैट कंपोजर में माइक्रोफोन
