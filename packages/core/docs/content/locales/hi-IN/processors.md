---
title: "इन-लूप प्रोसेसर"
description: "लूप-आंतरिक पर्यवेक्षक/रेलिंग हुक जो मॉडल के स्ट्रीम किए गए आउटपुट और टूल कॉल को मध्य-रन पर नज़र रखते हैं और इसे निरस्त कर सकते हैं - वास्तविक समय रेलिंग और प्रूफ़-ऑफ़-डन गेट्स के लिए सीम।"
---

# इन-लूप प्रोसेसर

ए `Processor` एजेंट रन के लिए एक लूप-आंतरिक **ऑब्जर्वर/रेलिंग** है। यह मॉडल के स्ट्रीम किए गए आउटपुट को देखता है और टूल इसे अनुरोध कहता है _जैसे-जैसे रन आगे बढ़ता है_, अपनी स्वयं की स्क्रैच स्थिति रखता है, और "पूर्ण" का दावा करने से पहले रन को **निरस्त** कर सकता है। यह वास्तविक समय रेलिंग (मध्य-धारा में अस्वीकृत आउटपुट को ब्लॉक करें) और एक प्रूफ-ऑफ-डन/कवरेज गेट (मॉडल क्या करने वाला है और इसे रोकें) के लिए संरचनात्मक शर्त है।

```an-diagram title="जहां तीन हुक दौड़कर फायर करते हैं" summary="processOutputStream प्रत्येक भाग को देखता है, processOutputStep प्रति प्रतिक्रिया के लिए टूल कॉल को गेट करता है, processOutputResult अंत में एक निर्णय रिकॉर्ड करता है। कोई भी हुक TripWire के साथ समाप्त हो सकता है।"
{
  "html": "<div class=\"diagram-proc\"><div class=\"diagram-node\" data-rough>stream chunks<br><small class=\"diagram-muted\">processOutputStream</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\" data-rough>per model response<br><small class=\"diagram-muted\">processOutputStep — टूल कॉल गेट करता है</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\" data-rough>run end<br><small class=\"diagram-muted\">processOutputResult — निर्णय</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-pill warn\">abort() &rarr; TripWire &rarr; tripwire event</div></div>",
  "css": ".diagram-proc{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-proc .diagram-arrow{font-size:22px;line-height:1}.diagram-proc .diagram-pill{flex-basis:100%}"
}
```

> [!WARNING]
> एक प्रोसेसर **कॉन्फिगरेशन** है, एक उपकरण नहीं, एक क्रिया नहीं, और एक संलेखन DSL नहीं है। प्रोसेसर केवल अपने स्वयं के स्ट्रीम-स्कोप्ड राज्य और `abort()` का निरीक्षण करते हैं, उन्हें बदलते हैं। वे कभी भी ऐप व्यवहार को परिभाषित नहीं करते हैं, actions को प्रतिस्थापित नहीं करते हैं, या मॉडल में दिखाई नहीं देते हैं। ऐप संचालन [actions](/docs/actions) से संबंधित है।

## हुक {#hooks}

एक प्रोसेसर तीन वैकल्पिक जीवनचक्र हुक के किसी भी सबसेट को लागू करता है (आकार मास्ट्रा के आउटपुट प्रोसेसर से उधार लिया गया है):

| हुक                   | आग...                                                        | इसका उपयोग करें...                                       |
| --------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| `processOutputStream` | प्रति स्ट्रीम खंड (पाठ/सोच डेल्टा) जबकि मॉडल उत्पन्न होता है | पूरा टर्न आने से पहले आउटपुट पर प्रतिक्रिया करें         |
| `processOutputStep`   | प्रति मॉडल प्रतिक्रिया में एक बार, टूल निष्पादन के आसपास     | मॉडल चलने वाले टूल कॉल का निरीक्षण करें; उन्हें गेट करें |
| `processOutputResult` | एक बार रन समाप्ति पर, अंतिम सहायक पाठ के साथ                 | पूर्ण उत्तर पर निर्णय / किए गए सबूत को रिकॉर्ड करें      |

प्रत्येक प्रोसेसर को अपना स्वयं का परिवर्तनशील, रन-स्कोप्ड `state` ऑब्जेक्ट मिलता है जो एक ही रन के भीतर उसके प्रत्येक हुक इनवोकेशन में बना रहता है और अन्य प्रोसेसर की स्थिति से **पृथक** होता है।

```ts
import type { Processor } from "@agent-native/core";

const noSecretsInOutput: Processor = {
  name: "no-secrets",
  processOutputStream({ part, abort }) {
    if (part.type === "text" && /sk-live_/.test(part.text)) {
      abort("Model attempted to emit a live secret token.", {
        kind: "secret-leak",
      });
    }
  },
};

const coverageGate: Processor = {
  name: "proof-of-done",
  processOutputStep({ toolCalls, state }) {
    // Track what the model has actually done this run...
    for (const call of toolCalls) {
      (state.ran ??= new Set<string>()).add(call.name);
    }
  },
  processOutputResult({ text, state }) {
    // ...and record a verdict over the final answer.
    const ran = state.ran as Set<string> | undefined;
    state.verdict = ran?.has("run-tests") ? "verified" : "unverified";
  },
};
```

## `TripWire` के साथ गर्भपात {#tripwire}

एक हुक `abort(reason, meta?)` को कॉल करके रन को रोक देता है, जो **`TripWire`** फेंकता है। लूप इसे पकड़ता है, एक एकल **`tripwire` ईवेंट** उत्सर्जित करता है, सफाई से रोकता है, और अंतिम सहायक संदेश के रूप में कारण सामने लाता है।

```ts
import { TripWire } from "@agent-native/core";
```

`tripwire` इवेंट में शामिल हैं:

| फ़ील्ड      | प्रकार   | नोट्स                                                     |
| ----------- | -------- | --------------------------------------------------------- |
| `reason`    | `string` | मानव-पठनीय कारण `abort` को दिया गया।                      |
| `processor` | `string` | उस प्रोसेसर का नाम जो `name` घोषित होने पर निरस्त हो गया। |

`TripWire` वैकल्पिक संरचित `meta` और प्रोग्रामेटिक उपभोक्ताओं के लिए मूल `processor` नाम भी रखता है जो `instanceof`-चेक करते हैं। चूँकि रुकना सुशोभित होता है, `processOutputResult` अभी भी (रुके हुए) अंतिम पाठ पर सक्रिय होता है ताकि प्रूफ-ऑफ-डन प्रोसेसर रन निरस्त होने पर भी अपना फैसला रिकॉर्ड कर सके।

## वायरिंग प्रोसेसर {#wiring}

प्रोसेसर को `runAgentLoop` पर `processors` सरणी के माध्यम से कोड में कॉन्फ़िगर किया गया है:

```ts
await runAgentLoop({
  engine,
  model,
  systemPrompt,
  tools,
  messages,
  actions,
  send,
  signal,
  processors: [noSecretsInOutput, coverageGate],
});
```

**अप्रयुक्त होने पर शून्य-ओवरहेड।** लूप प्रोसेसर श्रृंखला केवल तभी बनाता है जब कम से कम एक प्रोसेसर की आपूर्ति की जाती है; जब `processors` छोड़ा या खाली होता है, तो कोई भी सीम कोड नहीं चलता है और लूप बाइट-दर-बाइट अपरिवर्तित रहता है। हुक पंजीकरण क्रम में चलते हैं और सिंक या एसिंक हो सकते हैं।

> [!NOTE]
> लूप-लेवल सीम आज डिलिवरेबल है और उप-एजेंटों, A2A, MCP और परीक्षणों द्वारा सीधे कॉल करने योग्य है। HTTP चैट हैंडलर के माध्यम से `processors` को थ्रेड करना (ताकि एक प्रति-अनुरोध रिज़ॉल्वर सीधे `runAgentLoop` को कॉल किए बिना उन्हें कॉन्फ़िगर कर सके) सुविधा प्लंबिंग है जो अभी तक वायर्ड नहीं है - अभी के लिए `runAgentLoop` कॉल साइट पर प्रोसेसर कॉन्फ़िगर करें।

## संबंधित

- [**Durable Resume**](/docs/durable-resume) - कैसे लूप पूर्ण दुष्प्रभावों को दोबारा चलाए बिना रुकावटों से बचता है।
- [**Custom Agents & Teams**](/docs/agent-teams) - उप-एजेंट एक ही लूप चलाते हैं और अपने स्वयं के प्रोसेसर ले जा सकते हैं।
- [**Observability**](/docs/observability) - रन ट्रेस के साथ प्रोसेसर के फैसले रिकॉर्ड करें।
