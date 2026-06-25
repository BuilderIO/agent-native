---
title: "एजेंट उल्लेख"
description: "कस्टम एजेंटों, कनेक्टेड एजेंटों और चैट में फ़ाइलों को @-उल्लेख के साथ टैग करें।"
---

# एजेंट उल्लेख

कस्टम एजेंटों, कनेक्टेड एजेंटों, फ़ाइलों और संसाधनों का उल्लेख करने के लिए चैट कंपोज़र में `@` टाइप करें।

## अवलोकन {#overview}

`@`-उल्लेख प्रणाली चैट कंपोजर को व्यापक एजेंट पारिस्थितिकी तंत्र से जोड़ती है। जब आप `@` टाइप करते हैं, तो एक पॉपओवर उपलब्ध कस्टम एजेंटों, कनेक्टेड एजेंटों, कोडबेस फ़ाइलों और संसाधनों को सूचीबद्ध करता हुआ दिखाई देता है।

इस तरह आप एक ही चैट से मल्टी-एजेंट वर्कफ़्लो को व्यवस्थित करते हैं। अपने स्थानीय `@design` एजेंट से किसी लेआउट की समीक्षा करने के लिए कहें, `@analytics` से किसी अन्य ऐप से नवीनतम नंबर खींचने के लिए कहें, और मुख्य एजेंट दोनों को एक वार्तालाप में शामिल कर सकता है।

## एजेंटों का उल्लेख {#mentioning-agents}

चैट कंपोज़र में किसी एजेंट का उल्लेख करने के लिए:

1. उल्लेख पॉपओवर खोलने के लिए `@` टाइप करें
2. उपलब्ध एजेंटों की सूची ब्राउज़ करें या खोजें
3. एक एजेंट का चयन करें - यह आपके संदेश में एक टैग के रूप में दिखाई देता है
4. संदेश भेजें - सर्वर उल्लेख का समाधान करता है और बातचीत के संदर्भ में उस एजेंट की प्रतिक्रिया को शामिल करता है

दो एजेंट पथ हैं:

- **कस्टम एजेंट** - `agents/*.md` में स्थानीय कार्यस्थान एजेंट प्रोफाइल। ये एजेंट प्रोफ़ाइल के निर्देशों और वैकल्पिक मॉडल ओवरराइड का उपयोग करके वर्तमान ऐप/रनटाइम के अंदर चलते हैं।
- **कनेक्टेड एजेंट** - दूरस्थ A2A सहकर्मी। इन्हें [A2A protocol](/docs/a2a-protocol) के नाम से जाना जाता है।

दोनों ही मामलों में, आपका मुख्य एजेंट प्रतिक्रिया देखता है और उसका संदर्भ दे सकता है या उस पर निर्माण कर सकता है।

```an-diagram title="जहां एक @-उल्लेख मार्ग" summary="सर्वर प्रत्येक उल्लेख को प्रकार के आधार पर विभाजित करता है: कस्टम एजेंट स्थानीय रूप से चलते हैं, कनेक्टेड एजेंट A2A पर जाते हैं - दोनों प्रतिक्रियाएँ मुख्य एजेंट के संदर्भ में वापस आ जाती हैं।"
{
  "html": "<div class=\"diagram-mention\"><div class=\"diagram-node\">@-mention<br><small class=\"diagram-muted\">in the composer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">सर्वर हल करता है</span><small class=\"diagram-muted\">extract refs by type</small></div><div class=\"diagram-col\"><div class=\"row\"><span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box\">कस्टम एजेंट<br><small class=\"diagram-muted\">agents/*.md &middot; runs local</small></div></div><div class=\"row\"><span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</span><div class=\"diagram-box\">कनेक्टेड एजेंट<br><small class=\"diagram-muted\">A2A peer &middot; remote call</small></div></div></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box diagram-accent\">&lt;agent-response&gt;<br><small class=\"diagram-muted\">injected into main agent</small></div></div>",
  "css": ".diagram-mention{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-mention .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-mention .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-mention .row{display:flex;align-items:center;gap:8px}.diagram-mention .diagram-arrow{font-size:22px;line-height:1}"
}
```

## यह कैसे काम करता है {#how-it-works}

जब `@`-उल्लेख वाला एक संदेश भेजा जाता है, तो सर्वर पर निम्नलिखित होता है:

1. सर्वर संदेश से उल्लेखित संदर्भ निकालता है
2. प्रत्येक उल्लिखित एजेंट के लिए:
   - कस्टम एजेंट अपने प्रोफ़ाइल निर्देशों के साथ स्थानीय रूप से चलते हैं
   - जुड़े एजेंटों को A2A के माध्यम से कॉल किया जाता है
3. एजेंट की प्रतिक्रिया को `<agent-response>` XML ब्लॉक में लपेटा गया है और बातचीत के संदर्भ में इंजेक्ट किया गया है
4. मुख्य एजेंट उपयोगकर्ता के पाठ और उल्लिखित एजेंट की प्रतिक्रिया दोनों को देखकर समृद्ध संदेश को संसाधित करता है

मुख्य एजेंट इसके संदर्भ में क्या देखता है:

```text
User: Draft an email with the latest signup numbers. @analytics

<agent-response agent="analytics">
Last week's signups: 1,247 total
  - Organic: 623
  - Paid: 412
  - Referral: 212
</agent-response>
```

मुख्य एजेंट इस डेटा का उपयोग अपनी प्रतिक्रिया में स्वाभाविक रूप से कर सकता है - उदाहरण के लिए, संख्याओं को ईमेल ड्राफ्ट में शामिल करना।

```an-callout
{
  "tone": "info",
  "body": "Mentioned-agent output arrives as an `<agent-response agent=\"…\">` block in the **main agent's** context — not as separate chat bubbles. The main agent decides how to weave it into the reply."
}
```

## एजेंट जोड़ना {#adding-agents}

एजेंट कई तंत्रों के माध्यम से उल्लेख के लिए उपलब्ध होते हैं:

- **कस्टम वर्कस्पेस एजेंट** - वर्कस्पेस टैब में `agents/*.md` के रूप में एजेंट प्रोफाइल बनाएं
- **ऑटो-डिस्कवरी** - फ्रेमवर्क स्वचालित रूप से ज्ञात पोर्ट या कॉन्फ़िगर किए गए URLs पर चलने वाले कनेक्टेड एजेंटों का पता लगाता है
- **रिमोट मैनिफ़ेस्ट** — कनेक्टेड-एजेंट मैनिफ़ेस्ट को `remote-agents/*.json` के रूप में जोड़ें

### कस्टम कार्यस्थान एजेंट

कस्टम एजेंट कार्यस्थल में संग्रहीत Markdown फ़ाइलें हैं:

```markdown
---
name: Design
description: Reviews layouts, product UX, and visual direction.
model: inherit
---

You are a focused design agent.
```

पूर्ण प्रारूप के लिए [Workspace — Custom Agents](/docs/workspace#custom-agents) देखें (`tools`, `delegate-default` और मॉडल ओवरराइड सहित)।

आप इन्हें निम्न का उपयोग करके वर्कस्पेस टैब से बना सकते हैं:

- `Create Agent` -> `Describe It`
- `Create Agent` -> `Fill Form`

### कनेक्टेड-एजेंट मैनिफ़ेस्ट

दूरस्थ A2A एजेंट अभी भी JSON मैनिफ़ेस्ट का उपयोग करते हैं:

```json
// remote-agents/analytics.json
{
  "name": "Analytics Agent",
  "url": "https://analytics.example.com",
  "apiKey": "env:ANALYTICS_A2A_KEY",
  "description": "Runs analytics queries and returns data",
  "skills": ["run-query", "generate-chart"]
}
```

---

## डेवलपर्स के लिए: विस्तृत उल्लेख {#extending-mentions}

टेम्पलेट्स एजेंटों और फ़ाइलों से परे डोमेन-विशिष्ट उल्लेख योग्य आइटम जोड़ने के लिए कस्टम उल्लेख प्रदाताओं को पंजीकृत कर सकते हैं। एक उल्लेख प्रदाता `MentionProvider` इंटरफ़ेस लागू करता है:

```an-annotated-code title="एक कस्टम उल्लेख प्रदाता"
{
  "filename": "server/mentions/contacts.ts",
  "language": "ts",
  "code": "import type { MentionProvider } from \"@agent-native/core/server\";\n\nconst contactsProvider: MentionProvider = {\n  id: \"contacts\",\n  label: \"Contacts\",\n\n  // खोजें for mentionable items\n  async search(query: string) {\n    const contacts = await db.query.contacts.findMany({\n      where: like(contacts.name, `%${query}%`),\n      limit: 10,\n    });\n    return contacts.map((c) => ({\n      id: c.id,\n      label: c.name,\n      description: c.email,\n      type: \"contact\",\n    }));\n  },\n\n  // Resolve a mention into context for the agent\n  async resolve(id: string) {\n    const contact = await db.query.contacts.findFirst({\n      where: eq(contacts.id, id),\n    });\n    return {\n      type: \"context\",\n      text: `Contact: ${contact.name} (${contact.email})`,\n    };\n  },\n};",
  "annotations": [
    { "lines": "4-5", "label": "पहचान", "note": "`id` namespaces the provider; `label` is the section heading shown in the `@` popover." },
    { "lines": "8-9", "label": "search", "note": "Runs as the user types after `@`. Return up to a handful of matches as `{ id, label, description, type }`." },
    { "lines": "23-24", "label": "resolve", "note": "Called when the message is sent. Turns a picked id into `{ type: \"context\", text }` that is injected into the agent's context." }
  ]
}
```

एजेंट-चैट प्लगइन कॉन्फ़िगरेशन में प्रदाताओं को पंजीकृत करें:

```ts
// server/plugins/agent-chat.ts
import { createAgentChatPlugin } from "@agent-native/core/server";

export default createAgentChatPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
  mentionProviders: { contacts: contactsProvider },
});
```

कस्टम उल्लेख प्रदाता उल्लेख पॉपओवर में अंतर्निहित एजेंट और फ़ाइल प्रदाताओं के साथ दिखाई देते हैं।

## संदर्भित फ़ाइलें {#referencing-files}

`@` पॉपओवर एजेंटों तक सीमित नहीं है। आप इसका संदर्भ भी दे सकते हैं:

- **कोडबेस फ़ाइलें** — `@` टाइप करें और फ़ाइल नाम खोजें। फ़ाइल सामग्री को एजेंट के संदर्भ में शामिल किया गया है ताकि वह फ़ाइल को पढ़ सके, उसका विश्लेषण कर सके या उसे संशोधित कर सके।
- **कार्यस्थान संसाधन** — कार्यस्थान टैब में परिभाषित संदर्भ फ़ाइलें। ये डेटा फ़ाइलें, कॉन्फ़िगरेशन, या कोई अन्य संरचित सामग्री हो सकती हैं।
- **Skills** — किसी कौशल का संदर्भ देने के लिए `/` टाइप करें। Skills संरचित निर्देश प्रदान करता है जो मार्गदर्शन करता है कि एजेंट किसी कार्य को कैसे पूरा करता है।

सभी संदर्भ प्रकार एक ही पैटर्न का पालन करते हैं: पॉपओवर से चयन करें, और संदर्भित सामग्री को हल किया जाता है और संदेश भेजे जाने पर एजेंट के संदर्भ में इंजेक्ट किया जाता है।

## उप-एजेंट चयन {#sub-agent-selection}

`agent-teams` (क्रिया: "स्पॉन") के साथ उप-एजेंटों को उत्पन्न करते समय मुख्य एजेंट कस्टम एजेंटों का भी उपयोग कर सकता है।

`agents/*.md` से प्रोफ़ाइल चुनने के लिए `agent` पैरामीटर पास करें। उस प्रोफ़ाइल के निर्देश प्रत्यायोजित रन में जोड़े जाते हैं, और इसका `model` फ्रंटमैटर उस उप-एजेंट के लिए डिफ़ॉल्ट मॉडल को ओवरराइड कर सकता है।
