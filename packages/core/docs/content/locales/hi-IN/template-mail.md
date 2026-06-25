---
title: "मेल"
description: "एक एजेंट-संचालित ईमेल क्लाइंट। अपना Gmail कनेक्ट करें और एजेंट आपके लिए ईमेल पढ़ सकता है, ड्राफ्ट कर सकता है, भेज सकता है और व्यवस्थित कर सकता है।"
---

# मेल

एजेंट-संचालित ईमेल क्लाइंट। अपने Gmail खाते को कनेक्ट करें और एजेंट आपके लिए ईमेल पढ़ सकता है, ड्राफ्ट कर सकता है, भेज सकता है और व्यवस्थित कर सकता है - एक तेज़, कीबोर्ड-फर्स्ट इनबॉक्स के साथ जिसे आप स्वयं चला सकते हैं। सुपरह्यूमन के बारे में सोचें, लेकिन एजेंट प्रथम श्रेणी का नागरिक है और कोडबेस आपका है।

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;min-height:500px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1.4px solid var(--wf-line)'><strong>इनबॉक्स 16</strong><div style='flex:1'></div><span data-icon='search' aria-label='खोजें'></span><span data-icon='edit' aria-label='लिखें'></span><span data-icon='bell' aria-label='सूचित करें'></span></div><div style='display:flex;flex-direction:column;padding:8px 14px;gap:6px'><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><strong>प्रिया मेहता</strong><span><strong>Q3 लॉन्च</strong> — अंतिम assets समीक्षा के लिए तैयार</span><span>★</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><strong>Acme बिलिंग</strong><span>आपका मासिक invoice तैयार है</span><span>11:10 AM</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>मार्कस टैंग</span><span>ऑनबोर्डिंग प्रवाह research findings</span><span>कल</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>GitHub</span><span>[framework] PR समीक्षा के लिए तैयार</span><span>कल</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>Linear</span><span>Issue ENG-1287 आपको असाइन किया गया</span><span>2 मई</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>Stripe</span><span>साप्ताहिक payments summary</span><span>29 अप्रैल</span></div><div class='wf-box' style='display:grid;grid-template-columns:155px 1fr auto;gap:12px;align-items:center'><span>Calendly</span><span>नई बुकिंग की पुष्टि हुई</span><span>28 अप्रैल</span></div></div></div>"
}
```

जब आप ऐप खोलते हैं, तो कीबोर्ड-फर्स्ट इनबॉक्स और थ्रेड व्यू मेल पर ही केंद्रित रहता है। एजेंट को हमेशा पता होता है कि आप किस दृश्य में हैं और आपने कौन सा थ्रेड खोला है, इसलिए आप "यह" क्या है, यह बताए बिना "इसे संग्रहीत करें" या "दोस्ताना गिरावट का मसौदा तैयार करें" कह सकते हैं।

```an-diagram title="मेल अनुरोध कैसे प्रवाहित होता है" summary="कीबोर्ड शॉर्टकट और एजेंट प्रॉम्प्ट समान क्रियाएँ चलाते हैं। ईमेल Gmail में रहता है; ड्राफ्ट, ऑटोमेशन और ट्रैकिंग SQL और application_state में लाइव होते हैं।"
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">आप नियंत्रित करते हैं<br><small class=\"diagram-muted\">J/K/E/R शॉर्टकट</small></div><div class=\"diagram-node\">आप एजेंट से पूछते हैं<br><small class=\"diagram-muted\">\"एक विनम्र अस्वीकार लिखें\"</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Actions</span><small class=\"diagram-muted\">list-emails · get-thread · manage-draft · send</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Gmail<br><small class=\"diagram-muted\">कई खाते, OAuth के माध्यम से</small></div><div class=\"diagram-box\">SQL + application_state<br><small class=\"diagram-muted\">ड्राफ्ट · ऑटोमेशन · ट्रैकिंग</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box\">इनबॉक्स लाइव रीफ़्रेश होता है</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## आप इसके साथ क्या कर सकते हैं

- **ईमेल पढ़ें और ट्राइएज करें** कीबोर्ड शॉर्टकट के साथ (स्थानांतरित करने के लिए `J`/`K`, संग्रह करने के लिए `E`, उत्तर देने के लिए `R`, लिखने के लिए `C`)।
- **एकाधिक Gmail खाते कनेक्ट करें** — व्यक्तिगत और एक इनबॉक्स में काम करें।
- **एजेंट से वह सब कुछ करने के लिए कहें जो आप कर सकते हैं।** "मेरे अपठित ईमेल का सारांश प्रस्तुत करें।" "ऐसा उत्तर लिखें जो विनम्रतापूर्वक अस्वीकार कर दे।" "एक सप्ताह से अधिक पुराने सभी Netlify बॉट ईमेल संग्रहीत करें।"
- **समीक्षा के लिए ड्राफ्ट कतारबद्ध करें।** टीम के साथी और Slack उपयोगकर्ता एजेंट से किसी संगठन सदस्य के लिए एक ईमेल तैयार करने के लिए कह सकते हैं; स्वामी इसकी समीक्षा करता है, संपादन करता है और मेल से भेजता है।
- **नियमों के साथ ऑटो-ट्राइएज।** actions (लेबल, संग्रह, मार्क रीड, स्टार, ट्रैश) के साथ सादे अंग्रेजी ("न्यूज़लेटर से") में स्वचालन नियम सेट करें।
- \*\*ट्रैक खुलता है और आपके द्वारा भेजे गए ईमेल पर क्लिक करता है।
- **प्रत्येक कनेक्टेड इनबॉक्स में खोजें** एक प्रश्न के साथ।
- **बल्क संग्रह, निर्यात और लेबल** — इनबॉक्स क्लीनअप के लिए उपयोगी।

## आरंभ करना

लाइव डेमो: [mail.agent-native.com](https://mail.agent-native.com).

> **Google एक चेतावनी दिखा सकता है:** होस्ट किया गया डेमो Gmail एक्सेस के लिए Agent-Native के साझा Google ऐप का उपयोग करता है, इसलिए Google आपको जारी रखने से पहले पुष्टि करने के लिए कह सकता है। अपने स्वयं के Google OAuth क्लाइंट का उपयोग करने के लिए स्थानीय रूप से चलाएं।

जब आप पहली बार ऐप खोलते हैं:

1. साइडबार में **सेटिंग्स** पर क्लिक करें।
2. **Google खाता कनेक्ट करें** पर क्लिक करें, Gmail में साइन इन करें और स्वीकृत करें।
3. (वैकल्पिक) कार्य + व्यक्तिगत के लिए दूसरा Google खाता कनेक्ट करें।
4. इनबॉक्स पर वापस जाएं - आपका वास्तविक Gmail सिंक हो जाएगा।

Google खाता कनेक्ट किए बिना, ऐप एक खाली स्थानीय मेलबॉक्स पर चलता है (स्क्रीनशॉट और डेमो के लिए उपयोगी, और कुछ नहीं)।

## एजेंट से बात हो रही है

एजेंट हर मोड़ पर `application_state.navigation` पढ़ता है, इसलिए यह पहले से ही जानता है कि आप किस दृश्य में हैं, कौन सा थ्रेड खुला है, और कौन सा संदेश केंद्रित है - आपको यह बताने की ज़रूरत नहीं है। आप बस ऐसी बातें कह सकते हैं:

- "मेरे अपठित ईमेल को संक्षेप में प्रस्तुत करें।"
- "बजट के बारे में ऐलिस से नवीनतम सूत्र ढूंढें।"
- "ऐसा उत्तर लिखें जो विनम्रतापूर्वक अस्वीकार कर दे।"
- "एक सप्ताह से अधिक पुराने सभी Netlify बॉट ईमेल को संग्रहीत करें।"
- "मेरे तारांकित ईमेल खोलें।"
- "इस मसौदे को और अधिक औपचारिक बनाएं।"
- "क्या उन्होंने मेरा ईमेल खोला?"

यदि आप टेक्स्ट का चयन करते हैं और Cmd+I दबाते हैं, तो वह चयन आपके अगले संदेश के साथ चला जाता है - इसलिए "इसे अधिक प्रभावी बनाएं" ठीक उसी पर काम करता है जिसे आपने हाइलाइट किया है।

## कीबोर्ड शॉर्टकट

| कुंजी     | कार्रवाई                        |
| --------- | ------------------------------- |
| `J`       | अगला ईमेल                       |
| `K`       | पिछला ईमेल                      |
| `Up/Down` | जे/के के समान                   |
| `Enter`   | केंद्रित ईमेल खोलें             |
| `E`       | ईमेल या थ्रेड को संग्रहीत करें  |
| `D`       | ट्रैश ईमेल या थ्रेड             |
| `S`       | तारांकित करें या अतारांकित करें |
| `R`       | उत्तर दें                       |
| `U`       | पठित/अपठित टॉगल करें            |
| `C`       | नया ईमेल लिखें                  |
| `/`       | फोकस सर्च बार                   |
| `Cmd+K`   | कमांड पैलेट खोलें               |
| `G I`     | इनबॉक्स पर जाएं                 |
| `G S`     | तारांकित पर जाएं                |
| `G T`     | भेजे गए पर जाएं                 |
| `G D`     | ड्राफ्ट पर जाएं                 |
| `G A`     | संग्रह पर जाएं                  |
| `Esc`     | थ्रेड बंद करें / खोज साफ़ करें  |

## डेवलपर्स के लिए

इस दस्तावेज़ का शेष भाग मेल टेम्पलेट को फोर्क करने वाले या इसे विस्तारित करने वाले किसी भी व्यक्ति के लिए है।

### त्वरित शुरुआत

मेल टेम्पलेट के साथ एक नया कार्यक्षेत्र बनाएं:

```bash
npx @agent-native/core@latest create my-mail --standalone --template mail
cd my-mail
pnpm install
pnpm dev
```

या किसी मौजूदा एजेंट-मूल कार्यस्थान में मेल जोड़ें:

```bash
npx @agent-native/core@latest add-app
```

Gmail को डेव में कनेक्ट करने के लिए, आपको एक Google OAuth क्लाइंट की आवश्यकता है:

1. [Google Cloud Console](https://console.cloud.google.com/) खोलें और एक प्रोजेक्ट बनाएं।
2. APIs और सेवाओं → लाइब्रेरी के अंतर्गत **Gmail API** को सक्षम करें।
3. OAuth 2.0 क्रेडेंशियल बनाएं (प्रकार: वेब एप्लिकेशन)। `http://localhost:8085/_agent-native/google/callback` को अधिकृत रीडायरेक्ट URI के रूप में जोड़ें।
4. क्लाइंट आईडी और क्लाइंट सीक्रेट को रनिंग ऐप के सेटिंग पेज में कॉपी करें, फिर **Google अकाउंट कनेक्ट करें** पर क्लिक करें।

टोकन `oauth_tokens` SQL तालिका में संग्रहीत होते हैं और स्वचालित रूप से ताज़ा होते हैं। पहला सेट अप होने के बाद आप एकाधिक Gmail खाते कनेक्ट कर सकते हैं।

### मुख्य विशेषताएं

**मल्टी-अकाउंट Gmail.** एक या अधिक Google खातों को कनेक्ट करें, फिर कनेक्टेड इनबॉक्स में सूचीबद्ध करें, खोजें, ड्राफ्ट करें, भेजें, लेबल करें, संग्रहित करें, स्टार बनाएं या ट्रैश करें।

**ड्राफ्ट वर्कफ़्लोज़।** एकाधिक कंपोज़ ड्राफ्ट एप्लिकेशन स्थिति के माध्यम से सिंक होते हैं, और कतारबद्ध SQL ड्राफ्ट टीम के साथियों या Slack उपयोगकर्ताओं को समीक्षा करने और भेजने के लिए मालिक के लिए मेल का अनुरोध करने देते हैं।

**स्वचालन और ट्रैकिंग।** प्राकृतिक-भाषा ट्राइएज नियम लेबल, संग्रह, मार्क रीड, स्टार, ट्रैश या मैन्युअल रूप से ट्रिगर कर सकते हैं; भेजे गए संदेश ओपन और क्लिक को ट्रैक कर सकते हैं।

**खोज, बल्क actions, और पूर्वावलोकन।** साझा actions पावर इनबॉक्स खोज, बल्क संग्रह/निर्यात, और इनलाइन थ्रेड पूर्वावलोकन एजेंट चैट में एम्बेड कर सकते हैं।

### एजेंट आपके संदर्भ को कैसे देखता है

- **वर्तमान दृश्य और थ्रेड** - जब भी आप नेविगेट करते हैं तो UI `navigation` (देखें, थ्रेडआईडी, फोकस्डईमेलआईडी, खोज, लेबल) लिखता है। एजेंट इसे `readAppState("navigation")` या `pnpm action view-screen` के माध्यम से पढ़ता है।
- **ड्राफ्ट खोलें** - यदि आप एक उत्तर लिख रहे हैं और पूछते हैं "इसे कहने में मेरी मदद करें", तो एजेंट आपके वर्तमान विषय और मुख्य भाग को देखने के लिए मिलान करने वाली `compose-{id}` प्रविष्टि को पढ़ता है, फिर एक अद्यतन ड्राफ्ट वापस लिखता है। UI संपादन को लाइव शुरू करता है।
- **थ्रेड इतिहास** - संदर्भ मध्य-उत्तर के लिए, एजेंट `pnpm action get-thread --id=<threadId>` के साथ पूरा थ्रेड लाता है।

### एजेंट कैसे कार्रवाई करता है

- **मेल संचालन** - संग्रह, ट्रैश, स्टार, मार्क रीड, सेंड, ड्राफ्ट - सभी `templates/mail/actions/` के तहत `pnpm action <name>` स्क्रिप्ट के रूप में चलते हैं।
- **नेविगेशन** - आपके लिए थ्रेड खोलने या दृश्य स्विच करने के लिए, एजेंट `application_state.navigate` लिखता है, जिसे UI उपभोग करता है और हटा देता है। `pnpm action navigate` स्क्रिप्ट इसे लपेटती है।
- **रीफ्रेश** - किसी भी बदलाव के बाद, एजेंट `pnpm action refresh-list` चलाता है ताकि UI पुनः प्राप्त हो।

### डेटा मॉडल

जब कोई Google खाता कनेक्ट होता है, तो ईमेल Gmail में रहता है - ऐप शीर्ष पर एक दृश्य है। जब कोई खाता कनेक्ट नहीं होता है, तो ईमेल `getSetting("local-emails")` (डिफ़ॉल्ट रूप से खाली) के तहत SQL सेटिंग स्टोर में रहते हैं।

| स्टोर/टेबल                    | इसमें क्या है                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `getSetting("local-emails")`  | कोई Google खाता कनेक्ट न होने पर स्थानीय ईमेल फ़ॉलबैक                             |
| `getSetting("labels")`        | सिस्टम और उपयोगकर्ता लेबल, अपठित गणनाओं के साथ                                    |
| `getSetting("mail-settings")` | उपयोगकर्ता प्रोफ़ाइल, ट्रैकिंग प्राथमिकताएं, हस्ताक्षर, उपनाम                     |
| `getSetting("aliases")`       | ईमेल उपनाम                                                                        |
| `queued_email_drafts` तालिका  | टीम-साथी द्वारा अनुरोधित ड्राफ्ट स्वामी की समीक्षा/भेजे जाने की प्रतीक्षा में हैं |
| `email_tracking` तालिका       | भेजे गए संदेशों के लिए ओपन-पिक्सेल ईवेंट                                          |
| `email_link_tracking` तालिका  | भेजे गए संदेशों के लिए लिंक-क्लिक इवेंट                                           |
| `application_state` तालिका    | `navigation`, `navigate`, `compose-{id}` प्रविष्टियाँ (अल्पकालिक)                 |
| `oauth_tokens` तालिका         | Google OAuth टोकन (प्रदाता `"google"`, प्रति खाता एक पंक्ति)                      |

API के माध्यम से आने वाले ईमेल का आकार `{ id, threadId, from, to, cc, subject, snippet, body, date, isRead, isStarred, isArchived, isTrashed, labelIds, accountEmail, attachments }` होता है।

```an-schema title="मेल SQL टेबल" summary="ईमेल स्वयं Gmail में रहता है। SQL तालिकाएँ वही रखती हैं जो Gmail नहीं रखती: कतारबद्ध ड्राफ्ट, भेजने-ट्रैकिंग ईवेंट, और OAuth टोकन। सेटिंग्स और अल्पकालिक स्थिति सेटिंग्स और एप्लिकेशन_स्टेट स्टोर में रहती हैं।"
{
  "entities": [
    {
      "id": "queued_email_drafts",
      "name": "queued_email_drafts",
      "note": "टीम-साथी/Slack द्वारा अनुरोधित ड्राफ्ट स्वामी की समीक्षा की प्रतीक्षा में हैं",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "assignedTo", "type": "string", "note": "org member who reviews/sends" },
        { "name": "subject", "type": "string" },
        { "name": "body", "type": "markdown" },
        { "name": "status", "type": "enum", "note": "review at /draft-queue/<id>" }
      ]
    },
    {
      "id": "email_tracking",
      "name": "email_tracking",
      "note": "भेजे गए संदेशों के लिए ओपन-पिक्सेल ईवेंट",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "messageId", "type": "string" },
        { "name": "openedAt", "type": "datetime" }
      ]
    },
    {
      "id": "email_link_tracking",
      "name": "email_link_tracking",
      "note": "भेजे गए संदेशों के लिए ईवेंट लिंक-क्लिक करें",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "messageId", "type": "string", "fk": "email_tracking.messageId" },
        { "name": "url", "type": "string" },
        { "name": "clickedAt", "type": "datetime" }
      ]
    },
    {
      "id": "oauth_tokens",
      "name": "oauth_tokens",
      "note": "फ्रेमवर्क तालिका - प्रति कनेक्टेड Google खाते में एक पंक्ति",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "provider", "type": "string", "note": "\"google\"" },
        { "name": "accountEmail", "type": "string" },
        { "name": "accessToken", "type": "string" },
        { "name": "refreshToken", "type": "string" }
      ]
    }
  ],
  "relations": [
    { "from": "email_tracking", "to": "email_link_tracking", "kind": "1-n", "label": "click events" }
  ]
}
```

UI में रूट:

- `/_index.tsx` - डिफ़ॉल्ट इनबॉक्स दृश्य पर रीडायरेक्ट करता है।
- `/$view.tsx` - एक सूची दृश्य (`inbox`, `starred`, `sent`, `drafts`, `archive`, `trash`, आदि)।
- `/$view.$threadId.tsx` - एक सूची दृश्य जिसमें एक विशिष्ट थ्रेड खुला हो।
- `/email` - एजेंट चैट में उपयोग किया जाने वाला एम्बेडेड थ्रेड पूर्वावलोकन।
- `/settings` - खाता कनेक्शन, ट्रैकिंग, ऑटोमेशन।
- `/team` - टीम के सदस्य और साझा संसाधन।

### इसे अनुकूलित करना

मेल बदलना आपका है। हर महत्वपूर्ण चीज़ कुछ स्थानों पर रहती है - वहीं से शुरू करें।

**एक एजेंट क्षमता जोड़ना।** `defineAction` का उपयोग करके `templates/mail/actions/` के अंतर्गत एक नई फ़ाइल जोड़ें। आपकी कार्रवाई एक एजेंट टूल, एक CLI कमांड (`pnpm action <name>`), और `useActionQuery` / `useActionMutation` के माध्यम से एक टाइप की गई फ्रंटएंड हुक सतह बन जाती है। एक संक्षिप्त उदाहरण के लिए `templates/mail/actions/star-email.ts` या एकाधिक उप-actions वाले एक के लिए `templates/mail/actions/manage-automations.ts` देखें। पूर्ण पैटर्न के लिए [actions](/docs/actions) दस्तावेज़ देखें।

**UI को बदलना।** रूट `templates/mail/app/routes/` में हैं और घटक `templates/mail/app/components/email/` और `templates/mail/app/components/layout/` में हैं। ऐप `app/components/ui/` और टेबलर आइकॉन से shadcn/ui प्रिमिटिव का उपयोग करता है - उन्हीं पर कायम रहें।

**एजेंट के व्यवहार को बदलना।** एजेंट मार्गदर्शन `templates/mail/AGENTS.md` में रहता है और skills `templates/mail/.agents/skills/` (`email-drafts`, `real-time-sync`, `security`, `self-modifying-code`, और अन्य) में रहता है। एजेंट का व्यवहार मार्कडाउन संपादित करके बदला जाता है - कोड नहीं।

**डेटा या सेटिंग्स बदलना।** ट्रैकिंग तालिकाओं और संबंधित संरचनाओं के लिए स्कीमा `templates/mail/server/db/` में हैं। पढ़ने और लिखने की सेटिंग्स `@agent-native/core/settings` से `readSetting` / `writeSetting` के माध्यम से जाती हैं। एप्लिकेशन स्थिति (नेविगेशन, ड्राफ्ट, वन-शॉट कमांड) `@agent-native/core/application-state` से `readAppState` / `writeAppState` का उपयोग करती है।

**एक नया स्वचालन क्रिया प्रकार जोड़ना।** `templates/mail/actions/manage-automations.ts` में क्रिया स्कीमा और `templates/mail/actions/trigger-automations.ts` में निष्पादक का विस्तार करें।

**कीबोर्ड शॉर्टकट बदलना।** कीबाइंड हैंडलर `templates/mail/app/components/email/` में रहते हैं - प्रत्येक कुंजी कहां वायर्ड है यह जानने के लिए `useHotkeys` या `addEventListener("keydown"` खोजें।

एजेंट से आपके लिए इनमें से कोई भी बदलाव करने के लिए कहें। एजेंट अपने स्वयं के स्रोत को संपादित कर सकता है - [Self-Modifying Code](/docs/key-concepts#agent-modifies-code) देखें।
