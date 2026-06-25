---
title: "आरंभ करना"
description: "एक एजेंट ऐप बनाएं, निर्देशों, skills और actions को समझें, फिर एजेंट को उसकी पहली कार्रवाई को कॉल करते हुए देखें।"
---

# आरंभ करना

Agent-Native ऐप्स एक AI एजेंट और आपके UI को समान actions, डेटा और देते हैं
स्थिति. एक बुनियादी एजेंट उन निर्देशों से बनता है जो उसे निर्देशित करते हैं, skills जो सिखाते हैं
दोहराने योग्य व्यवहार, और actions जो इसे वास्तविक कार्य करने देता है।

**शुरू करने के लिए एक संपूर्ण ऐप चाहते हैं?** हमारे समृद्ध टेम्पलेट्स में से एक को क्लोन करें -
[Chat](/docs/template-chat), [Mail](/docs/template-mail),
[Calendar](/docs/template-calendar), [Content](/docs/template-content),
[Analytics](/docs/template-analytics), और [many more](/docs/cloneable-saas) —
प्रत्येक पूर्ण-विशेषताओं वाला ऐप जिसे आप अनुकूलित करते हैं।

शुरुआत से निर्माण? सामने एकमात्र विकल्प यह है कि क्या आप UI —
इसके बाद सब कुछ (निर्देश लिखना, skills जोड़ना, actions को परिभाषित करना, चलाना
एजेंट) किसी भी तरह से एक ही है।

```an-file-tree title="एक बुनियादी Agent-Native agent"
{
  "entries": [
    { "path": "AGENTS.md", "note": "always-on instructions: purpose, rules, tone, और agent क्या कर सकता है उसका map" },
    { "path": ".agents/skills/customer-research/SKILL.md", "note": "task match होने पर agent जो reusable playbook load करता है" },
    { "path": "actions/summarize-week.ts", "note": "typed code जिसे agent, UI, CLI, HTTP, MCP, A2A, jobs, और webhooks चला सकते हैं" }
  ]
}
```

यह सच है चाहे आप चैट UI से शुरू करें, एक हेडलेस एजेंट से, या एक पूर्ण ऐप से।
UI सतह को बदलता है; निर्देश, skills, और actions एजेंट को इसका
मार्गदर्शन और व्यवहार.

## 1. अपना ऐप बनाएं

आपको [Node.js 22+](https://nodejs.org) और [pnpm](https://pnpm.io) की आवश्यकता होगी।

बिना किसी झंडे के `create` चलाएं और यह पूछता है कि आप कैसे शुरू करना चाहते हैं (एक पूर्ण टेम्पलेट,
चैट, या हेडलेस) किसी भी अन्य चीज़ से पहले:

```bash
npx @agent-native/core@latest create my-app
```

या प्रॉम्प्ट को छोड़ने के लिए फ़्लैग पास करें:

**UI चाहते हैं?** चैट टेम्पलेट से प्रारंभ करें। आपको एक वर्किंग एजेंट और एक
अनुकूलन योग्य चैट UI, और आपके द्वारा जोड़ी गई प्रत्येक क्रिया स्वचालित रूप से इसमें दिखाई देती है:

```bash
npx @agent-native/core@latest create my-app --template chat
```

**सिर्फ बिना सिर वाला आदिम?** बिना सिर के शुरू करें - वही actions और एजेंट
लूप, कोई UI शेल नहीं:

```bash
npx @agent-native/core@latest create my-agent --headless
```

फिर आपके द्वारा बनाए गए फ़ोल्डर से इंस्टॉल करें:

```bash
cd my-agent # या my-app यदि आपने चैट टेम्पलेट चुना है
pnpm install
```

यहाँ से, दोनों समान हैं।

## 2. एक क्रिया जोड़ें

एक कार्रवाई एक ऐसा ऑपरेशन है जिसे आपका एजेंट - और आपका UI - कॉल कर सकता है। दोनों मचान
इस उदाहरण के साथ शिप करें:

```an-annotated-code title="आपका पहला action"
{
  "filename": "actions/hello.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { z } from \"zod\";\n\nexport default defineAction({\n  description: \"Local agent से hello कहें।\",\n  schema: z.object({\n    name: z.string().default(\"world\"),\n  }),\n  http: { method: \"GET\" },\n  readOnly: true,\n  run: async ({ name }) => {\n    return { message: `Hello, ${name}!` };\n  },\n});",
  "annotations": [
    { "lines": "5", "label": "टूल विवरण", "note": "Agent `description` पढ़कर तय करता है कि इसे tool के रूप में कब call करना है।" },
    { "lines": "6-8", "label": "टाइप किया हुआ अनुबंध", "note": "एक zod `schema` हर surface से input validate करता है: agent, UI, HTTP, MCP और A2A।" },
    { "lines": "9", "label": "HTTP क्रिया", "note": "इस action को अपने-आप mount होने वाले HTTP endpoint में शामिल करें।" },
    { "lines": "10", "label": "केवल पढ़ने योग्य", "note": "`readOnly` action को बिना approval सुरक्षित रूप से call करने योग्य और queries के लिए cacheable बताता है।" },
    { "lines": "11-13", "label": "एक implementation", "note": "`run` body वही single source of truth है जिसे हर surface चलाता है।" }
  ]
}
```

`hello` को अपने डोमेन में पहले वास्तविक ऑपरेशन से बदलें। आप इसे एक बार परिभाषित करें;
हर सतह इसे उठाती है।

निर्देशन के लिए `AGENTS.md` का उपयोग करें जो हर मोड़ पर लागू होना चाहिए। एक कौशल का प्रयोग करें जब
एजेंट को पुन: प्रयोज्य वर्कफ़्लो या डोमेन प्रक्रिया की आवश्यकता होती है। किसी क्रिया का उपयोग करें जब
एजेंट को डेटा पढ़ने, डेटा लिखने, API पर कॉल करने, या
अनुमोदन करें।

## 3. इसे चलाएं

कार्रवाई को सीधे कॉल करें:

```bash
pnpm action hello --name Steve
```

या एजेंट से इसे आपके लिए कॉल करने के लिए कहें:

```bash
pnpm agent "Call the hello action for Steve and explain what happened."
```

यदि आपने चैट टेम्पलेट से शुरुआत की है, तो ऐप चलाएं और उसी एजेंट का उपयोग करें
ब्राउज़र - यह आपके द्वारा परिभाषित प्रत्येक क्रिया को पहले से ही कॉल कर सकता है:

```bash
pnpm dev
```

वह एक क्रिया अब चैट UI, CLI, HTTP, MCP, A2A, से उपलब्ध है
अनुसूचित नौकरियां, और webhooks। एक बार परिभाषित करें, कहीं से भी कॉल करें।

```an-diagram title="एक क्रिया, हर सतह" summary="एक defineAction फ़ाइल प्रत्येक उपभोक्ता को बिना किसी अतिरिक्त वायरिंग के प्रदान करती है।"
{
  "html": "<div class=\"diagram-fan\"><div class=\"diagram-box\" data-rough>defineAction</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-surfaces\"><span class=\"diagram-pill\">चैट UI</span><span class=\"diagram-pill\">CLI</span><span class=\"diagram-pill\">HTTP</span><span class=\"diagram-pill\">MCP</span><span class=\"diagram-pill\">A2A</span><span class=\"diagram-pill\">शेड्यूल किए गए जॉब</span><span class=\"diagram-pill\">Webhooks</span></div></div>",
  "css": ".diagram-fan{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-fan .diagram-surfaces{display:flex;flex-wrap:wrap;gap:8px;max-width:420px}.diagram-fan .diagram-arrow{font-size:22px;line-height:1}"
}
```

## राज्य का निर्माण हुआ है

हेडलेस का मतलब स्टेटलेस नहीं है। Actions, सत्र, एप्लिकेशन स्थिति, थ्रेड्स,
रन इतिहास, और क्रेडेंशियल सभी SQL में रहते हैं। स्थानीय रूप से यह SQLite है
`data/app.db`; उत्पादन में आपने `DATABASE_URL` सेट किया है। देखें
[Deployment](/docs/deployment).

```an-callout
{
  "tone": "info",
  "body": "**हेडलेस अभी भी एक वास्तविक ऐप है।** ऐप-एजेंट लूप SQL में सत्र, थ्रेड, रन, सेटिंग्स और क्रेडेंशियल्स को बनाए रखता है - यह एक स्टेटलेस प्रॉम्प्ट नहीं है। आप बाद में अपने कार्यों या स्थिति को छुए बिना UI जोड़ सकते हैं।"
}
```

## UI को अनुकूलित करें

यदि आपने चैट टेम्पलेट से शुरुआत की है, तो संपादित करने के लिए UI आपका है। चैट ही
`<AgentChatSurface>` घटक पर निर्मित एक छोटा मार्ग है:

```tsx
// app/routes/_index.tsx
import { AgentChatSurface } from "@agent-native/core/client";

export default function ChatRoute() {
  return <AgentChatSurface mode="page" className="h-full" />;
}
```

- **`app/routes/_index.tsx`** — चैट पेज। सुझाव बदलें, रिक्त
  स्थिति, और लेआउट.
- **`app/root.tsx`** - ऐप शेल।
  एजेंट.
- एजेंट को `<AgentSidebar>` के साथ किसी भी स्क्रीन पर छोड़ें, उस पर हाथ से काम करें
  `sendToAgentChat()` के साथ बटन, या सीधे
  `useActionMutation()`.

पूर्ण घटक सेट के लिए [Drop-in Agent](/docs/drop-in-agent) देखें, और
[Native चैट UI](/docs/native-chat-ui) क्रिया परिणामों को तालिकाओं के रूप में प्रस्तुत करने के लिए,
चार्ट, और सादे पाठ के बजाय टाइप किए गए कार्ड।

**बिना सोचे-समझे शुरू कर दिया और बाद में UI चाहिए?** चैट टेम्पलेट UI ऑन-रैंप है -
इसकी `app/` परत (React राउटर + Vite) बिल्कुल बिना सिर वाले मचान के समान है
बाहर निकल जाता है। सबसे साफ कदम चैट
टेम्पलेट; आपकी `actions/`, एजेंट और SQL स्थिति अपरिवर्तित बनी रहेगी। देखें
बीच में प्रत्येक सतह के लिए [Agent Surfaces](/docs/agent-surfaces)।

## परियोजना संरचना

```text
my-app/
  actions/         # Agent द्वारा call की जा सकने वाली actions
  app/             # React फ्रंटएंड (केवल UI templates; headless में हटाया जाता है)
  server/          # Nitro API सर्वर (routes, plugins)
  AGENTS.md        # हमेशा लागू रहने वाले agent instructions
  .agents/         # ज़रूरत पड़ने पर agent द्वारा लाए जा सकने वाले skills
  data/app.db      # DATABASE_URL न होने पर local SQLite state
```

## आगे कहां जाना है

- **[Key Concepts](/docs/key-concepts)** - मुख्य वास्तुकला: SQL, actions,
  सिंक, और संदर्भ जागरूकता।
- **[Actions](/docs/actions)** - पूर्ण क्रिया API: स्कीमा, HTTP, प्रमाणीकरण, और
  अनुमोदन.
- **[Agent Surfaces](/docs/agent-surfaces)** - हेडलेस, चैट, एंबेडेड साइडकार,
  और पूरा ऐप।
- **[Drop-in Agent](/docs/drop-in-agent)** - एजेंट चैट को किसी भी React ऐप में जोड़ें।
- **[Deployment](/docs/deployment)** — अपने ऐप को अपने डोमेन पर रखें।
- **[FAQ](/docs/faq)** — सेटअप और उत्पाद प्रश्न।
