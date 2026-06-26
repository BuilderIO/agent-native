---
title: "सीआई इवल गेट"
description: " *.eval.ts परीक्षण मामले लिखें जो वास्तविक एजेंट को निश्चित इनपुट के विरुद्ध चलाते हैं, कंपोज़ेबल स्कोरर के साथ आउटपुट स्कोर करते हैं, और गेट सीआई/थ्रेसहोल्ड पर तैनात करते हैं।"
---

# सीआई इवल गेट

इवल्स एक प्रथम श्रेणी परीक्षण आदिम है: आप एक संकेत और आपके द्वारा अपेक्षित व्यवहार की घोषणा करते हैं, रनर **वास्तव में उस इनपुट के खिलाफ एजेंट लूप** चलाता है, कंपोज़ेबल स्कोरर के साथ आउटपुट को स्कोर करता है, और यदि कोई भी मामला इसकी सीमा से नीचे स्कोर करता है तो गैर-शून्य से बाहर निकल जाता है। वह गैर-शून्य निकास `agent-native eval` को एक ड्रॉप-इन CI परिनियोजन गेट बनाता है।

यह [Observability](/docs/observability) में पोस्ट-हॉक स्कोरिंग का पूरक है:

- **अवलोकन का स्तर** (`observability/evals.ts`) - _"यह वास्तविक दौड़ कैसे हुई?"_ निष्क्रिय, नमूना, निशान के बगल में रहता है।
- **`*.eval.ts` (यह आदिम)** - _"क्या एजेंट इस निश्चित इनपुट पर सही काम करता है?"_ सक्रिय, नियतात्मक, CLI के माध्यम से चलने वाला एक सीआई गेट।

रनर मौजूदा रजिस्ट्री से एक प्रदाता-अज्ञेयवादी इंजन/मॉडल का समाधान करता है - कोई भी मॉडल हार्डकोड नहीं होता है - इसलिए ऐप जिस भी इंजन के लिए कॉन्फ़िगर किया गया है, वही सूट उसके विरुद्ध चलता है।

```an-diagram title="निश्चित इनपुट से लेकर तैनाती गेट तक" summary="रनर वास्तव में प्रत्येक मामले पर एजेंट लूप चलाता है, आउटपुट स्कोर करता है, और यदि कोई स्कोरर सीमा से नीचे आता है तो गैर-शून्य से बाहर निकल जाता है - जिससे यह ड्रॉप-इन सीआई गेट बन जाता है।"
{
  "html": "<div class=\"eval-flow\"><div class=\"diagram-node\">*.eval.ts<br><small class=\"diagram-muted\">prompt + expected behavior</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">एजेंट लूप चलाएँ<br><small class=\"diagram-muted\">real engine/model</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">Scorers<br><small class=\"diagram-muted\">every one must pass threshold</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box ok\">exit 0 &rarr; deploy</div><div class=\"diagram-box warn\">exit 1 &rarr; block</div></div></div>",
  "css": ".eval-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.eval-flow .diagram-node{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.eval-flow .diagram-col{display:flex;flex-direction:column;gap:8px}.eval-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## एक मूल्यांकन लिखना {#writing}

एक `*.eval.ts` फ़ाइल को ऐप में कहीं भी छोड़ें (या एक `evals/*.ts` फ़ाइल)। प्रत्येक फ़ाइल `export default defineEval(...)` (या उनमें से एक सरणी निर्यात करती है):

```ts
// evals/greeting.eval.ts
import { defineEval, contains, llmJudge } from "@agent-native/core/eval";

export default defineEval({
  name: "greets the user by name",
  input: { prompt: "Say hi to Ada." },
  threshold: 0.7, // per-scorer pass bar; default 0.5
  scorers: [
    contains("Ada"),
    llmJudge({ criteria: "friendliness", rubric: "1.0 = warm greeting" }),
  ],
});
```

ईवल तभी पास होता है जब **प्रत्येक** स्कोरर सीमा को पूरा करता है। कुंजी `defineEval` फ़ील्ड:

| फ़ील्ड      | प्रकार                | नोट्स                                                       |
| ----------- | --------------------- | ----------------------------------------------------------- |
| `name`      | स्ट्रिंग              | आवश्यक. रिपोर्ट में दिखाया गया है.                          |
| `input`     | `{ prompt, history }` | आवश्यक `prompt`; `{ role, text }` मोड़ से पहले वैकल्पिक।    |
| `scorers`   | `Scorer[]`            | आवश्यक है, कम से कम एक।                                     |
| `threshold` | नंबर `0..1`           | प्रति-स्कोरर पास बार। डिफ़ॉल्ट `0.5`; CLI से अतिरंजित।      |
| `run`       | फ़ंक्शन               | कस्टम सेटअप के लिए वैकल्पिक ओवरराइड (बीज डेटा, मल्टी-टर्न)। |

स्कोरर्स को सौंपा गया एजेंट छोटा और परिवहन-अज्ञेयवादी है:

```ts
interface AgentRunOutput {
  text: string; // concatenated assistant text
  toolCalls: readonly string[]; // tool/action names, in call order
  ok: boolean; // completed without a terminal error
  error?: string;
  runId: string;
  durationMs: number;
}
```

## अंतर्निहित स्कोरर {#built-in}

`@agent-native/core/eval` से आयातित:

| स्कोरर                   | स्कोर                                                                  | मॉडल? |
| ------------------------ | ---------------------------------------------------------------------- | ----- |
| `exactMatch(expected)`   | `1.0` यदि टेक्स्ट `expected` के बराबर है (छंटनी की गई, केस-असंवेदनशील) | नहीं  |
| `contains(needles)`      | आवश्यक सबस्ट्रिंग का अंश मौजूद है (इसलिए आंशिक हिट सतह)                | नहीं  |
| `usesTool(toolName)`     | `1.0` यदि एजेंट ने उस टूल/कार्रवाई को कम से कम एक बार लागू किया है     | नहीं  |
| `llmJudge({ criteria })` | LLM-ए-जज ने प्राकृतिक-भाषा रूब्रिक के विरुद्ध स्कोर किया, → `0..1`     | हां   |

`exactMatch` और `contains` एक वैकल्पिक `{ caseSensitive }` लें। `llmJudge` `{ criteria, rubric?, name?, scoreRange? }` लेता है - इसका आउटपुट `[0, 1]` के लिए सामान्यीकृत होता है, और जज मॉडल वही होता है जो धावक ने हल किया हो (हार्डकोडेड प्रदाता कभी नहीं)।

## कस्टम स्कोरर: 4-चरणीय पाइपलाइन {#custom}

`createScorer` मास्ट्रा-शैली 4-चरणीय पाइपलाइन से एक स्कोरर बनाता है। केवल `generateScore` आवश्यक है:

```an-diagram title="4-चरणीय स्कोरर पाइपलाइन" summary="पहचान के लिए पूर्वप्रक्रिया और डिफ़ॉल्ट का विश्लेषण; केवल जेनरेटस्कोर आवश्यक है। विश्लेषण सादा JS चला सकता है या ctx के माध्यम से LLM जज को कॉल कर सकता है।"
{
  "html": "<div class=\"scorer\"><div class=\"diagram-card\"><span class=\"diagram-pill\">preprocess(run)</span><small class=\"diagram-muted\">transform the run/output &middot; optional</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">analyze(x, ctx)</span><small class=\"diagram-muted\">plain JS or LLM judge &middot; optional</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">generateScore(a)</span><small class=\"diagram-muted\">&rarr; 0..1 normalized &middot; <strong>required</strong></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">generateReason</span><small class=\"diagram-muted\">human-readable why &middot; optional</small></div></div>",
  "css": ".scorer{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.scorer .diagram-card{display:flex;flex-direction:column;gap:2px;padding:8px 12px}.scorer .diagram-arrow{font-size:20px;line-height:1}"
}
```

```text
preprocess(run)     → x          transform the run/output (optional)
analyze(x, ctx)     → analysis   plain JS OR an LLM judge (optional)
generateScore(a)    → 0..1       REQUIRED, normalized
generateReason(...) → string     human-readable why (optional)
```

`preprocess` और `analyze` पहचान के लिए डिफ़ॉल्ट हैं (स्कोरर कच्चा `AgentRunOutput` देखता है)। `analyze` चरण को LLM-समर्थित स्कोरिंग के लिए प्रदाता-अज्ञेयवादी `judge()` सहायक के साथ एक `ctx` प्राप्त होता है:

```ts
import { createScorer, clamp01 } from "@agent-native/core/eval";

// A scorer that rewards short, tool-using answers.
const concise = createScorer({
  name: "concise_with_tool",
  analyze(run) {
    return {
      words: run.text.trim().split(/\s+/).length,
      usedTool: run.toolCalls.length > 0,
    };
  },
  generateScore({ words, usedTool }) {
    if (!usedTool) return 0;
    return clamp01(1 - Math.max(0, words - 40) / 200);
  },
  generateReason({ analysis }) {
    return `${analysis.words} words, tool used: ${analysis.usedTool}`;
  },
});
```

## गेट चलाना {#cli}

```bash
agent-native eval                    # run every *.eval.ts; non-zero exit on failure
agent-native eval billing            # केवल फ़ाइलें जिनके पथ में "billing" है
agent-native eval --json             # machine-readable report (for CI)
agent-native eval --threshold 0.8    # override every eval's pass threshold (0..1)
```

कमांड मौजूदा ऐप के तहत `**/*.eval.ts` और `evals/*.ts` की खोज करता है, प्रत्येक इनपुट के लिए एजेंट चलाता है, इसे स्कोर करता है, एक पढ़ने योग्य तालिका (या JSON) प्रिंट करता है, और **यदि इसकी सीमा से नीचे कोई भी ईवल स्कोर है तो गैर-शून्य से बाहर निकल जाता है**।

निकास कोड:

| कोड | अर्थ                                                                |
| --- | ------------------------------------------------------------------- |
| `0` | सभी ईवल पास हो गए - _या_ कोई ईवल फाइल नहीं मिली (सीआई-अनुकूल)।      |
| `1` | कम से कम एक ईवल ने सीमा से नीचे स्कोर किया, या सुइट में त्रुटि हुई। |
| `2` | खराब तर्क (उदाहरण के लिए `[0, 1]` के बाहर `--threshold`)।           |

### सीआई परिनियोजन गेट के रूप में {#ci}

इसे उस पाइपलाइन में जोड़ें जो परिनियोजन से पहले चलती है:

```yaml
# .github/workflows/deploy.yml (excerpt)
- run: npx agent-native eval --json
```

एक प्रतिगमन जो किसी भी स्कोरर को सीमा से नीचे गिरा देता है वह चरण विफल हो जाता है और तैनाती को अवरुद्ध कर देता है। बिना eval फ़ाइलों वाला ऐप `0` से बाहर निकल जाता है, इसलिए evals को अपनाना प्रति ऐप ऑप्ट-इन है।

## आगे क्या

- [**Observability**](/docs/observability) - वास्तविक उत्पादन रन (पूरक परत) की पोस्ट-हॉक स्कोरिंग
- [**Actions**](/docs/actions) - उपकरण/actions जो `toolCalls` में दिखाई देते हैं
- [**Agent Teams**](/docs/agent-teams) - उप-एजेंट एक eval व्यायाम कर सकते हैं
