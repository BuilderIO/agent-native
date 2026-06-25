---
title: "वॉइस इनपुट"
description: "एजेंट चैट कंपोजर में वॉयस डिक्टेशन - Builder जेमिनी, BYOK प्रदाता, और ब्राउज़र वेब स्पीच फ़ॉलबैक।"
---

# ध्वनि इनपुट

प्रत्येक एजेंट-नेटिव ऐप में चैट कंपोज़र में एक माइक्रोफ़ोन होता है। इसे क्लिक करें, बात करें और आपके शब्द प्रॉम्प्ट में ट्रांसक्रिप्ट हो जाएंगे। मोबाइल पर उपयोगी, लंबे संकेतों के लिए उपयोगी, तब उपयोगी जब आपका हाथ किसी और चीज़ पर हो।

फ्रेमवर्क यह सब स्वचालित रूप से संभालता है। Builder-कनेक्टेड उपयोगकर्ताओं को डिफ़ॉल्ट रूप से Builder-होस्टेड जेमिनी फ्लैश-लाइट मिलता है; अन्यथा उपयोगकर्ता अपनी स्वयं की प्रदाता कुंजी ला सकते हैं या ब्राउज़र वाक् पहचान पर वापस आ सकते हैं।

## यह कैसे काम करता है {#how-it-works}

संगीतकार का आवाज बटन ब्राउज़र में ऑडियो रिकॉर्ड करता है, फिर एक प्रदाता चुनता है:

1. **Builder जेमिनी फ्लैश-लाइट (Builder कनेक्ट होने पर डिफ़ॉल्ट)।** ब्राउज़र `/_agent-native/transcribe-voice` पर ऑडियो पोस्ट करता है, जो जेमिनी फ्लैश-लाइट का उपयोग करके Builder.io के माध्यम से प्रॉक्सी करता है। किसी Google API कुंजी की आवश्यकता नहीं है।
2. **BYOK क्लाउड प्रदाता।** उपयोगकर्ता सेटिंग्स से Google जेमिनी, ग्रोक व्हिस्पर, या OpenAI व्हिस्पर चुन सकते हैं। मार्ग साझा परिनियोजन क्रेडेंशियल से पहले उपयोगकर्ता-स्कोप वाले एन्क्रिप्टेड रहस्यों को हल करता है।
3. **ब्राउज़र वेब स्पीच API (फ़ॉलबैक)।** यदि कोई सर्वर प्रदाता उपलब्ध नहीं है, तो कंपोज़र ब्राउज़र की अंतर्निहित वाक् पहचान का उपयोग कर सकता है। क्रोमियम-आधारित ब्राउज़र (क्रोम, एज, आर्क) और सफारी में काम करता है। कम सटीक; स्ट्रीम लाइव.

प्रदाता की पसंद को `voice-transcription-prefs` के तहत एप्लिकेशन स्थिति में संग्रहीत किया जाता है ताकि उपयोगकर्ता साइडबार सेटिंग्स में `"auto"` (डिफ़ॉल्ट - सर्वोत्तम उपलब्ध प्रदाता चुनता है), `"builder-gemini"`, `"builder"`, `"gemini"`, `"groq"`, `"openai"`, या `"browser"` को बाध्य कर सके।

```an-diagram title="वॉयस ट्रांसक्रिप्शन प्रदाता फ़ॉलबैक" summary="कंपोज़र ऑडियो रिकॉर्ड करता है, फिर सर्वर प्रदाताओं को क्रम में चलाता है, ब्राउज़र वेब स्पीच API पर तभी छोड़ता है जब कोई सर्वर प्रदाता उपलब्ध नहीं होता है।"
{
  "html": "<div class=\"diagram-voice\"><div class=\"diagram-node\">माइक बटन<br><small class=\"diagram-muted\">webm/opus रिकॉर्ड करता है</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill accent\">1 &middot; Builder Gemini</div><small class=\"diagram-muted\">Builder कनेक्ट होने पर डिफ़ॉल्ट</small><div class=\"diagram-pill\">2 &middot; BYOK cloud</div><small class=\"diagram-muted\">Gemini &middot; Groq &middot; OpenAI Whisper</small></div><div class=\"diagram-arrow diagram-warn\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box diagram-warn\" data-rough>3 &middot; Browser Web Speech<br><small class=\"diagram-muted\">fallback on 400 &middot; streams live</small></div></div>",
  "css": ".diagram-voice{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-voice .col{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-voice .diagram-arrow{font-size:22px;line-height:1}"
}
```

मार्ग **केवल समान-मूल** है - क्रॉस-साइट पोस्ट अस्वीकार कर दिए जाते हैं ताकि कोई हमलावर किसी बाहरी पृष्ठ से ट्रांसक्रिप्शन क्रेडिट को बर्न न कर सके।

## प्रदाताओं को सक्षम करना {#enabling-providers}

Builder सबसे आसान रास्ता है: सेटिंग्स से Builder.io कनेक्ट करें और डिफ़ॉल्ट प्रदाता Builder जेमिनी फ्लैश-लाइट बन जाता है। BYOK प्रदाताओं के लिए, सेटिंग्स → API कुंजी में मिलान कुंजी जोड़ें।

### प्रति-उपयोगकर्ता (सास के लिए अनुशंसित)

उपयोगकर्ता एजेंट साइडबार सेटिंग्स UI के माध्यम से अपनी स्वयं की कुंजी सेट करता है। इसे उपयोगकर्ता-स्कोप्ड एन्क्रिप्टेड रहस्य (`readAppSecret` के माध्यम से) के रूप में संग्रहीत किया जाता है। प्रत्येक उपयोगकर्ता अपने स्वयं के प्रतिलेखन के लिए भुगतान करता है; मेज़बान के लिए शून्य लागत.

### साझा (आंतरिक टूल के लिए)

`GEMINI_API_KEY`, `GROQ_API_KEY`, या `OPENAI_API_KEY` को एक पर्यावरण चर के रूप में या `settings` तालिका में सेट करें। प्रत्येक उपयोगकर्ता का प्रतिलेखन साझा कुंजी को हिट करता है।

```an-callout
{
  "tone": "info",
  "body": "**क्रेडेंशियल रिज़ॉल्यूशन ऑर्डर:** रूट पहले उपयोगकर्ता के स्वयं के एन्क्रिप्टेड रहस्य की जांच करता है, फिर साझा परिनियोजन कुंजी की। अपनी स्वयं की कुंजी वाला पावर उपयोगकर्ता हमेशा साझा की गई कुंजी को ओवरराइड कर देता है। यदि कोई मौजूद नहीं है, तो रूट 400 लौटाता है जिसे कंपोजर पहचानता है और चुपचाप ब्राउज़र Web Speech पर वापस आ जाता है।"
}
```

## रास्ता {#route}

```an-api title="ध्वनि प्रतिलेखन मार्ग"
{
  "method": "POST",
  "path": "/_agent-native/transcribe-voice",
  "summary": "रिकॉर्ड किए गए ऑडियो क्लिप को प्रॉम्प्ट टेक्स्ट में ट्रांसक्राइब करें",
  "auth": "Active session (Better Auth cookie). Same-origin only.",
  "description": "The composer POSTs the recorded clip here; the route resolves a provider and returns the transcribed text. You should not call this directly.",
  "params": [
    { "name": "audio", "in": "body", "type": "file", "required": true, "description": "The recorded clip, webm/opus by default. Max 25 MB." },
    { "name": "provider", "in": "body", "type": "string", "required": false, "description": "Optional override, e.g. gemini, groq, openai, builder." }
  ],
  "request": { "contentType": "multipart/form-data" },
  "responses": [
    { "status": "200", "description": "Transcription succeeded", "example": "{ \"text\": \"reply to Sara that I'll be there by 3\" }" },
    { "status": "400", "description": "No server provider configured — the composer recognizes this and falls back to Web Speech", "example": "{ \"error\": \"no_provider\" }" }
  ]
}
```

आपको इसे सीधे कॉल करने की आवश्यकता नहीं है - संगीतकार करता है। यदि आप एक कस्टम इनपुट सतह बना रहे हैं, तो पहले `@agent-native/core/client` से साझा कंपोजर/वॉयस क्लाइंट टुकड़ों का पुन: उपयोग करें। इस मार्ग को उन कस्टम सहायकों के लिए निम्न-स्तरीय परिवहन सीमा के रूप में मानें जिन्हें मल्टीपार्ट ऑडियो भेजने की आवश्यकता है।

## प्रदाता को अनुकूलित करना {#customizing}

प्रदाता फ़ील्ड एक सादा एप्लिकेशन-स्टेट कुंजी है, इसलिए एजेंट अनुरोध पर इसे बदल सकता है (`"use the browser speech recognizer instead"`)। यदि आप विभिन्न आवश्यकताओं के साथ एक टेम्पलेट बना रहे हैं - मान लीजिए, एक ऑन-प्रिमाइसेस व्हिस्पर परिनियोजन - फ्रेमवर्क के डिफ़ॉल्ट माउंट होने से पहले अपना खुद का `transcribe-voice` रूट पंजीकृत करके रूट हैंडलर को स्वैप करें।

## आगे क्या है

- [**Drop-in Agent**](/docs/drop-in-agent) - कंपोजर जो वॉयस बटन को उजागर करता है
- [**Onboarding**](/docs/onboarding) - प्रदाता कुंजियों को सेटअप चरणों के रूप में पंजीकृत करना
- [**Security & Data Scoping**](/docs/security) - प्रति उपयोगकर्ता एन्क्रिप्टेड रहस्य कैसे संग्रहीत किए जाते हैं
