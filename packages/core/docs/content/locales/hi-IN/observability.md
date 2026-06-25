---
title: "अवलोकनशीलता"
description: "एजेंट ट्रेस, मूल्यांकन, फीडबैक, ए/बी प्रयोग और अंतर्निहित डैशबोर्ड - सभी शून्य कॉन्फ़िगरेशन के साथ।"
---

# एजेंट अवलोकनशीलता

प्रत्येक एजेंट-नेटिव ऐप को बॉक्स से बाहर अवलोकन क्षमता मिलती है। ट्रेस, स्वचालित मूल्यांकन, उपयोगकर्ता प्रतिक्रिया और ए/बी प्रयोग शून्य कॉन्फ़िगरेशन के साथ काम करते हैं - सभी डेटा ऐप के अपने SQL डेटाबेस में रहता है।

यह पेज _एजेंट गुणवत्ता_ मेट्रिक्स को कवर करता है: आपके डेटाबेस में संग्रहीत निशान, लागत, मूल्यांकन और फीडबैक। _उत्पाद_ विश्लेषण के लिए (आपके ऐप के इवेंट पोस्टहॉग/मिक्सपैनल/एम्प्लिट्यूड पर प्रवाहित हो रहे हैं), [Tracking](/docs/tracking) देखें।

## तीन चीजें जिन्हें "मूल्यांकन"/"अवलोकनशीलता" कहा जाता है - मैं क्या चाहता हूं? {#which}

इन तीन पृष्ठों को भ्रमित करना आसान है। आप जो प्रश्न पूछ रहे हैं उसके अनुसार चुनें:

| पेज                                                    | यह जिस प्रश्न का उत्तर देता है                         | जब यह चलता है                                   | चिंता       |
| ------------------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------- | ----------- |
| **अवलोकन योग्यता** (यह पृष्ठ, _Evals_ टैब)             | "मेरा वास्तविक उत्पादन कैसा रहा?"                      | निष्क्रिय, प्रत्येक रन के बाद (LLM-जज का नमूना) | गुणवत्ता    |
| **[CI Eval Gate](/docs/evals)** (`*.eval.ts`)          | "क्या एजेंट इस निश्चित इनपुट पर सही काम करता है?"      | सक्रिय, नियतात्मक, एक सीआई/तैनाती गेट           | गुणवत्ता    |
| **[Observational Memory](/docs/observational-memory)** | "क्या यह लंबा धागा सस्ता और खिड़की के अंदर रह रहा है?" | लंबे धागों पर पृष्ठभूमि संघनन                   | लागत/संदर्भ |

ऑब्जर्वेबिलिटी और सीआई इवल गेट दोनों _गुणवत्ता_ स्कोर करते हैं, लेकिन विपरीत छोर से - वास्तविक ट्रैफ़िक की निष्क्रिय पोस्ट-हॉक स्कोरिंग बनाम निश्चित इनपुट पर सक्रिय पास/असफल जांच। अवलोकन संबंधी स्मृति का गुणवत्ता से कोई संबंध नहीं है; यह टोकन लागत और संदर्भ-विंडो दबाव के बारे में है।

## क्या स्वचालित रूप से कैप्चर किया जाता है {#captured}

जब कोई उपयोगकर्ता संदेश भेजता है, तो फ्रेमवर्क स्वचालित रूप से रिकॉर्ड करता है:

- **टोकन उपयोग** - इनपुट, आउटपुट, कैश रीड, कैश राइट
- **लागत** - टोकन गणना और मॉडल मूल्य निर्धारण से गणना की गई
- **विलंबता** — प्रति टूल कॉल की कुल अवधि और समय
- **टूल कॉल** - कौन सा actions लागू किया गया, सफलता/त्रुटि स्थिति, अवधि
- **स्वचालित मूल्यांकन** - प्रत्येक रन के बाद 5 गुणवत्ता स्कोर की गणना की जाती है

कोई कोड परिवर्तन की आवश्यकता नहीं है। उपकरण पारदर्शी रूप से `production-agent.ts` से जुड़ जाता है।

```an-diagram title="प्रत्येक रन लूप को फीड करता है" summary="एक एजेंट रन एक ट्रेस, स्वचालित स्कोर और एक फीडबैक हुक उत्पन्न करता है - सभी ऐप के अपने SQL में संग्रहीत होते हैं और डैशबोर्ड पर सामने आते हैं। प्रयोगों ने ट्रैफ़िक को कॉन्फ़िग वेरिएंट में विभाजित कर दिया।"
{
  "html": "<div class=\"obs-loop\"><div class=\"diagram-node\">एजेंट रन<br><small class=\"diagram-muted\">production-agent.ts</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">स्वचालित रूप से कैप्चर</span><small class=\"diagram-muted\">tokens &middot; cost &middot; latency &middot; tool calls</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Traces &amp; spans</div><div class=\"diagram-box\">Evals (5 scorers + LLM judge)</div><div class=\"diagram-box\">Feedback &amp; frustration index</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node ok\">Dashboard<br><small class=\"diagram-muted\">scoped to the signed-in user</small></div></div>",
  "css": ".obs-loop{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.obs-loop .diagram-col{display:flex;flex-direction:column;gap:8px}.obs-loop .diagram-arrow{font-size:22px;line-height:1}.obs-loop .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## डैशबोर्ड {#dashboard}

एकल रूट वाले किसी भी टेम्पलेट में डैशबोर्ड जोड़ें:

```tsx
// app/routes/observability.tsx
import { ObservabilityDashboard } from "@agent-native/core/client";

export default function ObservabilityPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <ObservabilityDashboard />
    </div>
  );
}
```

सारा डेटा साइन-इन उपयोगकर्ता के दायरे में है; आज कोई क्रॉस-यूज़र एडमिन व्यू नहीं है।

डैशबोर्ड में 5 टैब हैं:

| टैब             | यह क्या दिखाता है                                                              |
| --------------- | ------------------------------------------------------------------------------ |
| **अवलोकन**      | मुख्य मेट्रिक्स - रन, लागत, विलंबता, उपकरण सफलता दर, संतुष्टि, मूल्यांकन स्कोर |
| **बातचीत**      | अलग-अलग स्पैन (एजेंट*रन, एलएलएम*कॉल, टूल_कॉल) में ड्रिल-डाउन के साथ ट्रेस सूची |
| **इवल्स**       | मानदंडों, समय के साथ रुझानों के आधार पर स्वचालित मूल्यांकन स्कोर               |
| **प्रयोग**      | स्थिति बैज के साथ ए/बी परीक्षण सूची, आत्मविश्वास अंतराल के साथ भिन्न परिणाम    |
| **प्रतिक्रिया** | अंगूठे ऊपर/नीचे स्ट्रीम, श्रेणी विश्लेषण, हताशा स्कोर                          |

## उपयोगकर्ता प्रतिक्रिया {#feedback}

### स्पष्ट प्रतिक्रिया

अंगूठे ऊपर/नीचे बटन UI चैट में प्रत्येक एजेंट संदेश पर इनलाइन प्रस्तुत करते हैं। थम्स डाउन एक श्रेणी पॉपओवर खोलता है (गलत, मददगार नहीं, गलत टूल, बहुत धीमा)। यह स्वचालित रूप से `AssistantChat.tsx` में वायर्ड हो जाता है।

### अंतर्निहित प्रतिक्रिया (निराशा सूचकांक)

फ्रेमवर्क वार्तालाप संकेतों से निराशा सूचकांक (0-100) की गणना करता है:

| सिग्नल                  | वजन | यह क्या पता लगाता है                            |
| ----------------------- | --- | ----------------------------------------------- |
| रीफ़्रेज़िंग            | 30% | उपयोगकर्ता समान संदेश दोहराता है                |
| पैटर्न पुनः प्रयास करें | 20% | "पुनः प्रयास करें", "नहीं, यह गलत है"           |
| परित्याग                | 20% | प्रतिक्रिया के तुरंत बाद सत्र समाप्त हो जाता है |
| भावना                   | 15% | नकारात्मक भाषा पैटर्न                           |
| लंबाई प्रवृत्ति         | 15% | संदेश की लंबाई कम करना                          |

स्कोर व्याख्या: 0-20 = स्वस्थ, 20-40 = घर्षण, 40-60 = असंतुष्ट, 60+ = टूटा हुआ सत्र।

## स्वचालित मूल्यांकन {#evals}

प्रत्येक एजेंट के दौड़ने के बाद पांच नियतात्मक स्कोरर दौड़ते हैं:

| मानदंड              | यह क्या मापता है                                                | स्कोर रेंज |
| ------------------- | --------------------------------------------------------------- | ---------- |
| `tool_success_rate` | % टूल कॉल बिना त्रुटियों के                                     | 0-1        |
| `step_efficiency`   | टूल-उपयोग रन के लिए अत्यधिक LLM पुनरावृत्तियों को दंडित करता है | 0-1        |
| `latency_score`     | 10s/टूल बेसलाइन के विरुद्ध सामान्यीकृत                          | 0-1        |
| `cost_efficiency`   | लागत आधार रेखा के विरुद्ध सामान्यीकृत                           | 0-1        |
| `error_recovery`    | क्या एजेंट टूल त्रुटियों से उबर गया?                            | 0 या 1     |

### LLM-न्यायाधीश के रूप में (वैकल्पिक)

`evalSampleRate` सेट करके नमूना LLM-आधारित मूल्यांकन सक्षम करें:

```ts
import { putSetting } from "@agent-native/core/settings";

await putSetting("observability-config", {
  enabled: true,
  evalSampleRate: 0.05, // 5% of runs
});
```

कस्टम मानदंड प्राकृतिक भाषा रूब्रिक्स का उपयोग करते हैं:

```ts
const criteria = {
  name: "helpfulness",
  description: "Was the response helpful and complete?",
  rubric: "0.0 = unhelpful, 0.5 = partially helpful, 1.0 = fully resolved",
};
```

## ए/बी प्रयोग {#experiments}

विभिन्न मॉडलों, तापमानों या एजेंट कॉन्फ़िगरेशन का परीक्षण करें:

```ts
// Create via API
POST /_agent-native/observability/experiments
{
  "name": "model-a-vs-b",
  "variants": [
    { "id": "control", "weight": 50, "config": { "model": "<your-model-id>" } },
    { "id": "treatment", "weight": 50, "config": { "model": "<other-model-id>" } }
  ],
  "metrics": ["cost", "latency", "satisfaction"]
}

// Start the experiment
PUT /_agent-native/observability/experiments/:id
{ "status": "running" }
```

`<your-model-id>` / `<other-model-id>` के स्थान पर आपके इंजन द्वारा स्वीकार किए जाने वाले वास्तविक मॉडल पहचानकर्ताओं का उपयोग करें (मॉडल नाम अक्सर बदलते रहते हैं - वर्तमान आईडी के लिए अपने प्रदाता/इंजन की जांच करें)। एजेंट लूप स्वचालित रूप से उपयोगकर्ता के वेरिएंट का समाधान करता है और कॉन्फ़िगरेशन ओवरराइड लागू करता है। असाइनमेंट लगातार हैशिंग का उपयोग करता है - एक ही उपयोगकर्ता को हमेशा एक ही प्रकार मिलता है।

```an-diagram title="सुसंगत-हैश वैरिएंट असाइनमेंट" summary="प्रत्येक उपयोगकर्ता एक स्थिर वैरिएंट के लिए हैश करता है, लूप उस वैरिएंट की कॉन्फ़िगरेशन ओवरराइड को लागू करता है, और परिणाम विश्वास अंतराल के साथ प्रति वैरिएंट रोल अप करते हैं।"
{
  "html": "<div class=\"exp\"><div class=\"diagram-node\">यूजर ID<br><small class=\"diagram-muted\">consistent hash</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-card\"><span class=\"diagram-pill\">control &middot; 50%</span><small class=\"diagram-muted\">कॉन्फिग override A</small></div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">treatment &middot; 50%</span><small class=\"diagram-muted\">कॉन्फिग override B</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">परिणाम per variant<br><small class=\"diagram-muted\">cost &middot; latency &middot; satisfaction</small></div></div>",
  "css": ".exp{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.exp .diagram-col{display:flex;flex-direction:column;gap:8px}.exp .diagram-card{display:flex;flex-direction:column;gap:2px;padding:8px 12px}.exp .diagram-arrow{font-size:22px;line-height:1}"
}
```

## कॉन्फ़िगरेशन {#config}

सभी सेटिंग्स `observability-config` कुंजी में संग्रहीत हैं:

```ts
{
  enabled: true,           // Master switch
  capturePrompts: false,   // Store prompt content in traces
  captureToolArgs: false,  // Store action input arguments
  captureToolResults: false, // Store action results
  evalSampleRate: 0,       // 0-1, fraction of runs to LLM-judge
  exporters: []            // OTLP export targets
}
```

```an-callout
{
  "tone": "info",
  "body": "Content is **redacted by default** — only token counts, costs, and timing are stored. `capturePrompts`, `captureToolArgs`, and `captureToolResults` are opt-in; turn them on only when you need prompt/argument content for debugging."
}
```

## API समापन बिंदु {#api}

`/_agent-native/observability/` पर सभी ऑटो-माउंटेड:

| विधि | पथ                         | उद्देश्य                       |
| ---- | -------------------------- | ------------------------------ |
| GET  | `/`                        | अवलोकन आँकड़े                  |
| GET  | `/traces`                  | सूची ट्रेस सारांश              |
| GET  | `/traces/:runId`           | ट्रेस विवरण (सारांश + विस्तार) |
| GET  | `/traces/:runId/evals`     | एक रन के लिए मूल्यांकन         |
| POST | `/feedback`                | प्रतिक्रिया सबमिट करें         |
| GET  | `/feedback`                | प्रतिक्रिया सूचीबद्ध करें      |
| GET  | `/feedback/stats`          | प्रतिक्रिया एकत्रीकरण          |
| GET  | `/satisfaction`            | संतुष्टि स्कोर                 |
| GET  | `/evals/stats`             | समान आँकड़े                    |
| POST | `/experiments`             | प्रयोग बनाएं                   |
| GET  | `/experiments`             | प्रयोगों की सूची बनाएं         |
| GET  | `/experiments/:id`         | प्रयोग विवरण प्राप्त करें      |
| PUT  | `/experiments/:id`         | अद्यतन प्रयोग                  |
| POST | `/experiments/:id/results` | परिणामों की गणना करें          |
| GET  | `/experiments/:id/results` | परिणाम प्राप्त करें            |

सभी समापन बिंदु `?since=N` (एमएस टाइमस्टैम्प) और `?limit=N` क्वेरी पैरामीटर का समर्थन करते हैं।

## बाहरी प्लेटफ़ॉर्म पर निर्यात करें {#export}

लैंगफ्यूज, डेटाडॉग, ग्राफाना, या किसी ओटेल-संगत बैकएंड पर निशान भेजें:

```ts
await putSetting("observability-config", {
  enabled: true,
  exporters: [
    {
      type: "otlp",
      endpoint: "https://cloud.langfuse.com/api/public/otel",
      headers: { Authorization: "Bearer sk-..." },
    },
  ],
});
```

फ्रेमवर्क ओपनटेलीमेट्री जेनएआई स्पेक के साथ संगत `gen_ai.*` सिमेंटिक कन्वेंशन स्पैन का उत्सर्जन करता है।

## ओपनटेलीमेट्री स्पैन {#otel}

उपरोक्त `exporters` कॉन्फ़िगरेशन से अलग (जो इन-हाउस ट्रेस को OTLP एंडपॉइंट पर भेजता है), एजेंट लूप प्रत्येक रन, मॉडल कॉल और टूल कॉल के लिए **लाइव ओपनटेलीमेट्री स्पैन** भी उत्सर्जित कर सकता है - इसलिए एक होस्ट जो पहले से ही एक ओटेल कलेक्टर चलाता है, उसके बाकी वितरित ट्रेस के साथ एजेंट गतिविधि देखता है।

यह परत **वैकल्पिक है और डिफ़ॉल्ट रूप से नो-ऑप है**:

- `@opentelemetry/api` एक **वैकल्पिक निर्भरता** है। यदि इसे स्थापित नहीं किया गया है, तो हेल्पर्स साइलेंट नो-ऑप्स में बदल जाते हैं - यहां कुछ भी कभी भी एजेंट लूप में नहीं जाता है।
- यहां तक कि जब एपीआई पैकेज मौजूद होता है, तब भी यह एक डिफ़ॉल्ट नो-ऑप ट्रेसर भेजता है। स्पैन तभी वास्तविक हो जाते हैं जब **होस्ट एक `TracerProvider`** पंजीकृत करता है (`@opentelemetry/sdk-node` या इसी तरह के माध्यम से)। फ्रेमवर्क जानबूझकर भारी SDK/निर्यातक पैकेजों पर निर्भर **नहीं** करता है या प्रदाता को स्वयं पंजीकृत नहीं करता है - इंस्ट्रुमेंटेशन एम्बेडिंग ऐप द्वारा ऑप्ट-इन किया जाता है।

इसलिए जब आपने ओटेल को वायर्ड नहीं किया है तो प्रति कॉल कुछ कैश्ड प्रॉपर्टी पढ़ने की लागत आती है। इसे चालू करने के लिए, एपीआई पैकेज और अपना SDK इंस्टॉल करें और सर्वर स्टार्टअप पर एक प्रदाता को उसी तरह पंजीकृत करें जैसे आप किसी अन्य नोड सेवा के लिए करते हैं।

एजेंट लूप तीन प्रकार के स्पैन उत्सर्जित करता है:

| विस्तार     | कब                         | गुण                                                               |
| ----------- | -------------------------- | ----------------------------------------------------------------- |
| `agent.run` | प्रति एजेंट एक बार चलाएं   | `agent.run_id`, `agent.thread_id`, `agent.user_id`, `agent.model` |
| `tool.call` | प्रति क्रिया एक बार आह्वान | `tool.name`, प्लस सफलता/त्रुटि स्थिति                             |
| `llm.call`  | प्रति मॉडल कॉल             | समय + ठीक/त्रुटि स्थिति                                           |

ओके/ERROR स्थिति के साथ स्पैन समाप्त हो जाते हैं और विफलता पर त्रुटि संदेश रिकॉर्ड करते हैं। शून्य/प्रहरी विशेषता मानों को काट दिया जाता है ताकि स्पैन शोर से अव्यवस्थित न हों। यह ओटेल परत पूरी तरह से इन-हाउस `agent_trace_spans` / `agent_trace_summaries` तालिकाओं से जुड़ी हुई है जो ऊपर डैशबोर्ड को शक्ति प्रदान करती हैं - दोनों एक ही रन इवेंट से निर्मित होते हैं।

## त्रुटि रिपोर्टिंग (Sentry) {#sentry}

DSN कॉन्फ़िगर होने पर Nitro रूट हैंडलर से बचने वाली सर्वर-साइड त्रुटियां Sentry को रिपोर्ट की जाती हैं। इसके बिना SDK चुपचाप नो-ऑप्स करता है, इसलिए env vars को dev में अनसेट छोड़ना सुरक्षित है। ब्राउज़र और सर्वर इवेंट एक ही Sentry प्रोजेक्ट पर जा सकते हैं; उन्हें अलग-अलग प्रोजेक्ट में तभी विभाजित करें जब आप स्वामित्व, वॉल्यूम, कोटा या अलर्ट रूटिंग के लिए परिचालन पृथक्करण चाहते हों।

| सतह                | SDK               | पर्यावरण संस्करण                                               | नोट्स                                                                                  |
| ------------------ | ----------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ब्राउज़र / SPA     | `@sentry/browser` | `VITE_SENTRY_CLIENT_DSN`, `SENTRY_CLIENT_DSN`, या `SENTRY_DSN` | क्लाइंट में अनहैंडल की गई त्रुटियों और रूट-चेंज ब्रेडक्रंब को कैप्चर करता है।          |
| Nitro सर्वर        | `@sentry/node`    | `SENTRY_SERVER_DSN` या `SENTRY_DSN`                            | 5xx प्रतिक्रियाएँ और Nitro जीवनचक्र त्रुटियाँ कैप्चर करता है। प्रति-अनुरोध उपयोगकर्ता. |
| `agent-native` CLI | `@sentry/node`    | _हार्डकोडेड_                                                   | प्रकाशित CLI बाइनरी से क्रैश रिपोर्ट; उपयोगकर्ता-कॉन्फ़िगर करने योग्य नहीं।            |

### सर्वर-साइड कॉन्फ़िगरेशन {#sentry-config}

परिनियोजन परिवेश में `SENTRY_SERVER_DSN` या साझा `SENTRY_DSN` सेट करें (नेटलिफाई डैशबोर्ड, क्लाउडफ्लेयर रहस्य, आदि)। फ्रेमवर्क एक Nitro प्लगइन को ऑटो-माउंट करता है जो:

1. स्टार्टअप पर एक बार `Sentry.init` पर कॉल करता है (आइडेम्पोटेंट - कई प्लगइन्स से कॉल करने के लिए सुरक्षित)।
2. प्रत्येक API/फ्रेमवर्क अनुरोध पर `getSession(event)` के माध्यम से उपयोगकर्ता का समाधान करता है और Sentry के प्रति-अनुरोध अलगाव दायरे में `id` / `email` / `username` प्लस एक `orgId` टैग जोड़ता है। अतिरिक्त DB हिट से बचने के लिए स्टेटिक-एसेट पथ को छोड़ दिया जाता है।
3. हर फ्रेमवर्क-रूट 5xx को खोजने योग्य `route`, `method`, और `userAgent` टैग के साथ कैप्चर करता है।

वैकल्पिक नॉब्स:

- `SENTRY_SERVER_TRACES_SAMPLE_RATE` (फ्लोट `0`-`1`) - प्रदर्शन अनुरेखण में ऑप्ट इन करें। डिफ़ॉल्ट रूप से `0` (केवल त्रुटियाँ)। अमान्य मान `0` पर चिपक जाते हैं।
- `AGENT_NATIVE_RELEASE` - `release` टैग को ओवरराइड करता है। डिफ़ॉल्ट रूप से `agent-native-server@<core-version>`.

### टेम्पलेट्स

प्रत्येक टेम्पलेट इसे स्वचालित रूप से प्राप्त करता है - आयात करने के लिए कुछ भी नहीं है। SSR ऐप्स के लिए, जब `SENTRY_CLIENT_DSN`, `VITE_SENTRY_CLIENT_DSN`, या साझा `SENTRY_DSN` रनटाइम पर उपलब्ध होता है, तो सर्वर एक छोटी ब्राउज़र कॉन्फिग स्क्रिप्ट इंजेक्ट करता है, इसलिए ब्राउज़र कैप्चर Vite बिल्ड-टाइम एनवी तक सीमित नहीं है। जो टेम्पलेट कस्टम व्यवहार चाहते हैं (अतिरिक्त टैग, प्रति टेम्पलेट अलग DSN, हार्ड-अक्षम Sentry) वे `server/plugins/sentry.ts` से अपना स्वयं का प्लगइन निर्यात करके ओवरराइड कर सकते हैं:

```ts
// server/plugins/sentry.ts
import { createSentryPlugin } from "@agent-native/core/server";
export default createSentryPlugin();
```

CLI का हार्डकोडेड DSN जानबूझकर किया गया है - प्रकाशित बाइनरी को होम क्रैश को फ़ोन करने की आवश्यकता है, चाहे कोई भी वातावरण इसे चलाता हो। सर्वर मॉड्यूल कभी भी DSN को हार्डकोड नहीं करता है क्योंकि यह ग्राहक वातावरण के अंदर चलता है जहां ऑपरेटर तय करते हैं कि त्रुटियां Sentry तक पहुंचनी चाहिए या नहीं।

### गोपनीयता और PII {#privacy}

सर्वर और CLI दोनों `sendDefaultPii: false` और एक `beforeSend` हुक के साथ प्रारंभ होते हैं जो स्ट्रिप करता है:

- `request.headers.authorization`, `cookie`, `set-cookie`, `proxy-authorization`
- `request.cookies`
- `user.ip_address` (सहमति के बिना स्वतः एकत्रित)
- `contexts.runtime_env` (प्रक्रिया env स्नैपशॉट)
- कोई भी घटना जिसका शीर्ष-स्तरीय अपवाद प्रकार `ValidationError` है (अपेक्षित उपयोगकर्ता-इनपुट अस्वीकृति के रूप में माना जाता है, बग नहीं)।

`setUser({ id, email, username })` के माध्यम से स्पष्ट रूप से निर्धारित पहचान फ़ील्ड संरक्षित हैं।

## आगे क्या है

- [**Tracking**](/docs/tracking) - आपके ऐप के अपने इवेंट के लिए उत्पाद विश्लेषण (पोस्टहॉग, मिक्सपैनल, एम्प्लिट्यूड)
- [**Actions**](/docs/actions) - वे ऑपरेशन जो ट्रेस में टूल कॉल के रूप में दिखाई देते हैं
- [**Security**](/docs/security) - डेटा स्कोपिंग और क्रेडेंशियल हैंडलिंग
