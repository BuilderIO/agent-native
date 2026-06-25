---
title: "मैसेजिंग"
description: "Slack, ईमेल, टेलीग्राम, या व्हाट्सएप से अपने एजेंट से बात करें - वही एजेंट, वही मेमोरी, वही टूल।"
---

# मैसेजिंग

अपने एजेंट को Slack, ईमेल, टेलीग्राम, या व्हाट्सएप से कनेक्ट करें ताकि आप पहले से उपयोग किए गए ऐप्स से उसके साथ चैट कर सकें। यह वही एजेंट है - वही मेमोरी, वही टूल, वही थ्रेड - बस अधिक स्थानों से पहुंच योग्य है।

> **डिस्पैच टेम्पलेट का उपयोग कर रहे हैं?** यह सब आपके लिए **सेटिंग्स → मैसेजिंग** में रखा गया है। प्रत्येक प्लेटफ़ॉर्म को कनेक्ट करने के लिए क्लिक करें - जब तक आप अपना स्वयं का टेम्पलेट कस्टमाइज़ या निर्मित नहीं कर रहे हों, तब तक आपको इस पृष्ठ के शेष भाग को पढ़ने की आवश्यकता नहीं है। [Dispatch](/docs/dispatch) या [Dispatch template reference](/docs/template-dispatch) देखें।

## आप क्या कर सकते हैं {#what-you-can-do}

- **अपने एजेंट को ईमेल करें** जैसे पते पर `agent@yourcompany.com` - यह थ्रेड में ही उत्तर देता है, बिल्कुल एक सहकर्मी की तरह।
- **अपने एजेंट को एक थ्रेड पर भेजें** - यह आपके पूछने पर पढ़ेगा और तुरंत शामिल हो जाएगा।
- **एजेंट को Slack** पर DM करें, या इसे किसी भी चैनल में `@mention` करें।
- \*\*एजेंट को अपने फोन से टेलीग्राम या व्हाट्सएप पर संदेश भेजें।
- **वही एजेंट, वही मेमोरी।** आप इसे Slack पर जो भी बताते हैं वह बाद में ईमेल करने पर याद रखा जाता है। वेब चैट और बाहरी संदेश एक थ्रेड इतिहास साझा करते हैं।
- एकतरफ़ा इन-ऐप अलर्ट (घंटी आइकन, webhooks) के लिए [Notifications](/docs/notifications) देखें।

```an-diagram title="चैनल अनेक, एजेंट एक" summary="प्रत्येक प्लेटफ़ॉर्म एक ही एजेंट लूप और एक ही SQL थ्रेड इतिहास को पसंद करता है - इसलिए एक Slack DM संदेश और एक ईमेल समान वार्तालाप जारी रखते हैं।"
{
  "html": "<div class=\"msg-fanin\"><div class=\"diagram-col\"><div class=\"diagram-node\">Slack</div><div class=\"diagram-node\">Email</div><div class=\"diagram-node\">Telegram</div><div class=\"diagram-node\">WhatsApp</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">एक एजेंट लूप</span><small class=\"diagram-muted\">वही memory · वही tools</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>एक SQL थ्रेड इतिहास<br><small class=\"diagram-muted\">web chat + external messages share it</small></div></div>",
  "css": ".msg-fanin{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.msg-fanin .diagram-col{display:flex;flex-direction:column;gap:8px}.msg-fanin .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Slack सेट करें {#slack}

### आपको क्या चाहिए

- एक Slack कार्यक्षेत्र जहां आप ऐप्स इंस्टॉल कर सकते हैं (एडमिन एक्सेस)
- लगभग 5 मिनट

### कदम

1.  **[api.slack.com/apps](https://api.slack.com/apps)** पर जाएं और **नया ऐप बनाएं** → **स्क्रैच से** पर क्लिक करें। इसे नाम दें (उदाहरण के लिए "एजेंट") और अपना कार्यक्षेत्र चुनें।
2.  बाएँ साइडबार में, **OAuth और अनुमतियाँ** खोलें। **बॉट टोकन स्कोप्स** के अंतर्गत, जोड़ें:
    - `chat:write` - एजेंट को संदेश भेजने देता है
    - `app_mentions:read` - एजेंट को यह देखने देता है कि यह कब @-उल्लेखित है (वैकल्पिक)
    - `im:history` - एजेंट को भेजे गए डीएम को पढ़ने देता है
    - `assistant:write` - वैकल्पिक; Slack को सहायक थ्रेड में मूल "सोच रहा है..." स्थिति दिखाने देता है
    - `users:read.email` - वैकल्पिक; ड्राफ्ट-क्यू पहचान के लिए Slack प्रेषक ईमेल को सत्यापित करने वाले मेल जैसे टेम्प्लेट की मदद करता है
3.  उस पेज के शीर्ष पर **वर्कस्पेस पर इंस्टॉल करें** पर क्लिक करें। Slack आपको एक **बॉट उपयोगकर्ता OAuth टोकन** देगा जो `xoxb-` से शुरू होता है। इसे कॉपी करें.
4.  साइडबार में **बुनियादी जानकारी** पर जाएं और **हस्ताक्षर करने का रहस्य** कॉपी करें।
5.  अपने ऐप की सेटिंग (या अपने होस्टिंग प्रदाता का पर्यावरण चर पैनल) खोलें और पेस्ट करें:
    - `SLACK_BOT_TOKEN` - `xoxb-…` टोकन
    - `SLACK_SIGNING_SECRET` - हस्ताक्षर करने का रहस्य
    - `SLACK_ALLOWED_TEAM_IDS` - उत्पादन में अनुशंसित; अल्पविराम से अलग किए गए Slack कार्यक्षेत्र/टीम आईडी को ईवेंट भेजने की अनुमति है
    - `SLACK_ALLOWED_API_APP_IDS` - मल्टी-वर्कस्पेस ऐप्स के लिए अनुशंसित; अल्पविराम से अलग किए गए Slack ऐप आईडी को इस हस्ताक्षर रहस्य का उपयोग करने की अनुमति है
6.  Slack में वापस, **इवेंट सब्सक्रिप्शन** खोलें, इसे चालू करें, और इस अनुरोध URL को पेस्ट करें:

    ```पाठ
    https://your-app.example.com/_agent-native/integrations/slack/webhook
    ```

    फिर **बॉट इवेंट की सदस्यता लें** के अंतर्गत, `message.im` (डीएम के लिए) और वैकल्पिक रूप से `app_mention` (चैनल उल्लेखों के लिए) जोड़ें। सहेजें.

7.  अपने बॉट को Slack में एक DM भेजें। इसका जवाब देना चाहिए.

### वैकल्पिक: ऐप खुलता है

Slack ऐप खुल गया है, जिससे एक ऐप Slack के सामान्य लिंक पूर्वावलोकन को एक बेहतर लिंक पूर्वावलोकन से बदल देता है
पूर्वावलोकन. क्लिप्स इसका उपयोग लूम-शैली के बजाने योग्य वीडियो पूर्वावलोकन के लिए करता है।

जब आपके ऐप को खोलने की आवश्यकता हो तो ये अतिरिक्त बॉट स्कोप जोड़ें:

- `links:read` - पंजीकृत डोमेन पोस्ट होने पर Slack ऐप को सूचित करता है
- `links:write` - ऐप को Slack के डिफ़ॉल्ट पूर्वावलोकन को बदलने देता है
- `links.embed:write` - ऐप को स्वीकृत मीडिया/प्लेयर URLs को एम्बेड करने देता है

फिर `link_shared` इवेंट की सदस्यता लें और अपने सार्वजनिक ऐप डोमेन को पंजीकृत करें
**ऐप अनफ़र्ल डोमेन** के अंतर्गत। केवल-क्लिप्स चलाने योग्य पूर्वावलोकन के लिए, Slack
इवेंट सदस्यता के लिए URL का अनुरोध करें:

```text
https://your-clips.example.com/api/slack/unfurl
```

एक Slack ऐप में एक इवेंट API अनुरोध URL है। यदि वही Slack ऐप संभालना चाहिए
एजेंट चैट इवेंट और क्लिप्स दोनों खुलते हैं, Slack इवेंट को एक छोटे से रूट करते हैं
प्रेषक जो `/_agent-native/integrations/slack/webhook` को संदेश ईवेंट भेजता है
और क्लिप्स के लिए `link_shared` ईवेंट हैंडलर को खोल देते हैं।

### टिप्स

- **चैनल उल्लेख** - शोर से बचने के लिए, बॉट केवल तभी प्रतिक्रिया देता है जब @-उल्लेख किया जाता है।
- **डीएम** - प्रत्येक डीएम को एजेंट के साथ एक निजी बातचीत के रूप में माना जाता है।
- **समान पहचान, सभी चैनल** - यदि किसी Slack उपयोगकर्ता का ईमेल आपके ऐप में पंजीकृत उपयोगकर्ता के समान है, तो एजेंट उनके साथ एक ही व्यक्ति के रूप में व्यवहार करता है।
- **उत्पादन अनुमति सूचियाँ** - `SLACK_ALLOWED_TEAM_IDS` सेट करें और, साझा Slack ऐप्स के लिए, `SLACK_ALLOWED_API_APP_IDS` ताकि एक वैध हस्ताक्षर रहस्य का अप्रत्याशित कार्यक्षेत्र द्वारा पुन: उपयोग न किया जा सके।
- **क्लिप्स ऐप खुलता है** - Slack के लिए इंस्टॉल करने योग्य Agent-Native क्लिप्स `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` और `/api/slack/oauth/callback` का उपयोग करता है। प्रत्येक कनेक्टेड Slack कार्यक्षेत्र को `app_secrets` में अपना स्वयं का एन्क्रिप्टेड बॉट टोकन मिलता है; `SLACK_BOT_TOKEN` केवल एक लीगेसी सिंगल-वर्कस्पेस फ़ॉलबैक है।

## टेलीग्राम सेट करें {#telegram}

### आपको क्या चाहिए

- आपके फ़ोन पर टेलीग्राम ऐप
- लगभग 3 मिनट

### कदम

1. टेलीग्राम खोलें और **[@BotFather](https://t.me/BotFather)** संदेश भेजें।
2. `/newbot` भेजें और अपने बॉट को नाम देने के लिए संकेतों का पालन करें। BotFather **HTTP API टोकन** के साथ उत्तर देगा। इसे कॉपी करें.
3. अपने ऐप के परिवेश चर में, सेट करें:
   - `TELEGRAM_BOT_TOKEN` - BotFather की ओर से टोकन
4. तैनाती के बाद, वेबहुक को `POST`ing द्वारा अपने ऐप पर पंजीकृत करें:

   ```पाठ
   POST https://your-app.example.com/_agent-native/integrations/telegram/setup
   ```

   यह टेलीग्राम को आपके ऐप के वेबहुक पर संदेश भेजने के लिए कहता है। आपको इसे प्रति परिनियोजन केवल एक बार करना होगा।

5. टेलीग्राम में अपना बॉट ढूंढें (बॉटफादर द्वारा आपको दिया गया उपयोगकर्ता नाम खोजें) और उसे एक संदेश भेजें।

## ईमेल सेट करें {#email}

ईमेल सबसे शक्तिशाली एकीकरण है - आपके एजेंट को अपना पता मिलता है, थ्रेड में उत्तर देता है, बातचीत पर सीसी किया जा सकता है, और प्रेषक के ईमेल को अपनी पहचान के रूप में उपयोग करता है। कोई `/link` कमांड की आवश्यकता नहीं है।

### आपको क्या चाहिए

- एक डोमेन जिसे आप नियंत्रित करते हैं (या आप एक निःशुल्क पुनः भेजें उपडोमेन का उपयोग कर सकते हैं - नीचे देखें)
- इनबाउंड + आउटबाउंड मेल को संभालने के लिए **रीसेंड** या **सेंडग्रिड** वाला एक खाता
- लगभग 10 मिनट

### चरण (पुनः भेजें - सबसे आसान)

1. **[resend.com](https://resend.com)** पर साइन अप करें। आरंभ करने के लिए निःशुल्क टियर पर्याप्त है।
2. चुनें कि एजेंट का ईमेल पता कैसा दिखेगा:
   - **सबसे आसान:** निःशुल्क `<your-slug>.resend.app` पते का उपयोग करें - कोई DNS की आवश्यकता नहीं है।
   - **ब्रांडेड:** पुनः भेजें के **डोमेन** पृष्ठ में एक कस्टम डोमेन (जैसे `yourcompany.com`) जोड़ें और DNS चरणों का पालन करें।
3. पुनः भेजें में, **Webhooks** → **एंडपॉइंट जोड़ें** खोलें और इसे यहां इंगित करें:

   ```पाठ
   https://your-app.example.com/_agent-native/integrations/email/webhook
   ```

   **`email.received`** इवेंट की सदस्यता लें। पुनः भेजें आपको एक हस्ताक्षरित रहस्य मिलेगा - इसे कॉपी करें।

4. अपने ऐप के परिवेश चर में, सेट करें:
   - `EMAIL_AGENT_ADDRESS` - वह पता जिस पर एजेंट को मेल प्राप्त होता है (जैसे `agent@yourcompany.com`)
   - `RESEND_API_KEY` - आपकी पुनः भेजें API कुंजी
   - `EMAIL_INBOUND_WEBHOOK_SECRET` - पुनः भेजें से हस्ताक्षर रहस्य (अनुशंसित; हस्ताक्षर सत्यापन के लिए उपयोग किया जाता है)

5. एजेंट के पते पर एक ईमेल भेजें। यह उसी थ्रेड में उत्तर देगा.

### चरण (सेंडग्रिड के साथ)

1. **[sendgrid.com](https://sendgrid.com)** पर साइन अप करें।
2. अपने डोमेन के लिए एमएक्स रिकॉर्ड जोड़ें ताकि इनबाउंड मेल सेंडग्रिड में प्रवाहित हो:
   ```पाठ
   MX yourcompany.com → mx.sendgrid.net (प्राथमिकता 10)
   ```
3. **सेटिंग्स → इनबाउंड पार्स** खोलें, **होस्ट और URL जोड़ें** पर क्लिक करें, और गंतव्य को यहां सेट करें:

```पाठ
https://your-app.example.com/_agent-native/integrations/email/webhook
```

4. पर्यावरण चर सेट करें:
   - `EMAIL_AGENT_ADDRESS` - वह पता जिस पर एजेंट को प्राप्त होता है
   - `SENDGRID_API_KEY` - आपकी सेंडग्रिड API कुंजी
   - `EMAIL_INBOUND_WEBHOOK_SECRET` - यदि आपने हस्ताक्षरित webhooks को कॉन्फ़िगर किया है तो वैकल्पिक Svix हस्ताक्षर रहस्य

5. एजेंट के पते पर एक ईमेल भेजें।

### टिप्स

- **इसे एक सूत्र में लाने के लिए एजेंट को सीसी** करें। जब एजेंट को CC'd किया जाता है तो वह उत्तर देगा-सब ताकि पूरा थ्रेड प्रतिक्रिया देख सके।
- **थ्रेडिंग बस काम करती है** - एजेंट मानक `Message-ID` / `In-Reply-To` / `References` हेडर का उपयोग करता है, इसलिए किसी भी ईमेल क्लाइंट में उत्तर सही थ्रेड में रहते हैं।
- **पहचान प्रेषक का ईमेल है।** यदि `alice@acme.com` एजेंट को ईमेल करता है, तो यह उसकी पहचान है - कोई लिंक या साइनअप प्रवाह नहीं।
- **समृद्ध प्रतिक्रियाएं** - एजेंट की प्रतिक्रिया में मार्कडाउन को ईमेल में HTML के रूप में प्रस्तुत किया गया है।
- **अनुमत डोमेन** - एकीकरण की कॉन्फ़िगरेशन में `allowedDomains` सेट करके एजेंट को कौन ईमेल कर सकता है, इसे प्रतिबंधित करें; अन्य डोमेन से संदेश हटा दिए जाते हैं।
- **दर सीमा** - प्रति प्रेषक प्रति घंटे 20 इनबाउंड संदेश।

## व्हाट्सएप सेट करें {#whatsapp}

### आपको क्या चाहिए

- एक मेटा (फेसबुक) डेवलपर खाता
- एक फ़ोन नंबर जिसे आप बॉट को समर्पित कर सकते हैं
- लगभग 15 मिनट (मेटा के सेटअप में सबसे अधिक चरण हैं)

### कदम

1. **[Meta Developer Portal](https://developers.facebook.com/)** पर जाएं, **ऐप बनाएं** पर क्लिक करें, और **व्यवसाय** प्रकार चुनें।
2. **व्हाट्सएप** उत्पाद को अपने ऐप में जोड़ें और प्रेषक के रूप में उपयोग करने के लिए एक फ़ोन नंबर कॉन्फ़िगर करें।
3. व्हाट्सएप सेटअप पेज से, पकड़ें:
   - **एक्सेस टोकन** (अस्थायी टोकन परीक्षण के लिए ठीक है; लाइव होने से पहले एक स्थायी टोकन जेनरेट करें)
   - **फ़ोन नंबर आईडी**
4. सत्यापित टोकन के रूप में उपयोग करने के लिए कोई भी यादृच्छिक स्ट्रिंग चुनें - आप नीचे दो स्थानों पर समान मान दर्ज करेंगे।
5. अपने ऐप के परिवेश चर में, सेट करें:
   - `WHATSAPP_ACCESS_TOKEN` - आपका एक्सेस टोकन
   - `WHATSAPP_PHONE_NUMBER_ID` - फ़ोन नंबर आईडी
   - `WHATSAPP_VERIFY_TOKEN` - आपके द्वारा चुनी गई यादृच्छिक स्ट्रिंग
6. मेटा के व्हाट्सएप कॉन्फ़िगरेशन में वापस, वेबहुक अनुभाग खोलें और सेट करें:

   ```पाठ
   कॉलबैक URL: https://your-app.example.com/_agent-native/integrations/whatsapp/webhook
   टोकन सत्यापित करें: वही यादृच्छिक स्ट्रिंग जिसे आपने WHATSAPP_VERIFY_TOKEN के रूप में सेट किया है
   ```

   `messages` फ़ील्ड की सदस्यता लें।

7. बॉट के फ़ोन नंबर पर एक व्हाट्सएप संदेश भेजें।

## डिस्पैच को अपने एजेंट के केंद्रीय इनबॉक्स के रूप में उपयोग करें {#dispatch}

यदि आप एकाधिक एजेंट-नेटिव ऐप्स (मेल, कैलेंडर, एनालिटिक्स इत्यादि) चला रहे हैं, तो अनुशंसित पैटर्न **[Dispatch](/docs/dispatch)** पर मैसेजिंग सेट करना है ([template reference](/docs/template-dispatch) भी देखें) और इसे [A2A](/docs/a2a-protocol) पर अपने डोमेन ऐप्स पर रूट करने दें।

यह अच्छा क्यों है:

- **एक एजेंट, एक इनबॉक्स।** आपके सभी चैनल (Slack, ईमेल, टेलीग्राम, व्हाट्सएप) डिस्पैच में प्रवाहित होते हैं। आप एकीकरण केवल एक बार सेट करते हैं.
- **डिस्पैच प्रतिनिधि।** पूछें "पिछले सप्ताह के साइनअप को सारांशित करें" - डिस्पैच एनालिटिक्स एजेंट को कॉल करता है। पूछें "ऐलिस को उत्तर का मसौदा तैयार करें" - डिस्पैच मेल एजेंट को कॉल करता है।
- **क्लिक्स, कॉन्फिगरेशन नहीं।** डिस्पैच की **सेटिंग्स → मैसेजिंग** पेज में हर प्लेटफॉर्म के लिए कनेक्ट बटन हैं जिनमें एनवी-वेर फ़ील्ड्स अंतर्निहित हैं।

यदि आपको ऑर्केस्ट्रेटर की आवश्यकता नहीं है, तो कोई भी एकल टेम्पलेट इस पृष्ठ पर env vars का उपयोग करके सीधे संदेश भेज सकता है।

---

## डेवलपर्स के लिए {#for-developers}

नीचे दी गई हर चीज़ तकनीकी संदर्भ है। यदि आपने उपरोक्त सेटअप चरण पूरे कर लिए हैं, तो आप यहां रुक सकते हैं जब तक कि आप एकीकरण प्लगइन को कस्टमाइज़ नहीं कर रहे हों या अपना स्वयं का एडॉप्टर नहीं बना रहे हों।

### यह कैसे काम करता है {#how-it-works}

इनबाउंड प्लेटफ़ॉर्म webhooks एक क्रॉस-प्लेटफ़ॉर्म SQL-क्यू पैटर्न का उपयोग करता है ताकि वे प्लेटफ़ॉर्म-विशिष्ट पृष्ठभूमि-निष्पादन APIs पर भरोसा किए बिना प्रत्येक सर्वर रहित होस्ट (नेटलिफाई, वर्सेल, क्लाउडफ्लेयर वर्कर्स, फ्लाई, रेंडर, नोड) पर काम करें।

1. प्लेटफ़ॉर्म `POST`s से `/_agent-native/integrations/<platform>/webhook` तक। हैंडलर हस्ताक्षर को सत्यापित करता है, पेलोड को `IncomingMessage` में पार्स करता है, और **`status='pending'` के साथ `integration_pending_tasks`** में एक पंक्ति सम्मिलित करता है।
2. हैंडलर आग लगाओ और भूल जाओ `POST /_agent-native/integrations/process-task` फायर करता है और तुरंत `200` लौटाता है, Slack के 3-सेकंड SLA के अंदर।
3. प्रोसेसर एंडपॉइंट अपने स्वयं के पूर्णकालिक बजट के साथ **ताज़ा फ़ंक्शन निष्पादन** में चलता है। यह परमाणु रूप से कार्य का दावा करता है (`pending` → `processing` `claimPendingTask` के माध्यम से), एजेंट लूप चलाता है, एडाप्टर के माध्यम से उत्तर पोस्ट करता है, और कार्य को `completed` चिह्नित करता है।
4. एक आवर्ती पुनः प्रयास कार्य (`startPendingTasksRetryJob`, प्रत्येक 60 के दशक में) `pending` >90 या `processing` >5 मिनट में अटके कार्यों को साफ़ करता है और प्रोसेसर को फिर से सक्रिय करता है। 3 प्रयासों पर कैप किया गया, फिर `failed` चिह्नित किया गया।

```an-diagram title="इनबाउंड वेबहुक जीवनचक्र" summary="वेबहुक केवल 200 को सत्यापित करता है, कतारबद्ध करता है और लौटाता है। एक ताजा फ़ंक्शन निष्पादन कतार को हटा देता है और सुरक्षा जाल के रूप में 60s पुनः प्रयास कार्य के साथ एजेंट लूप चलाता है।"
{
  "html": "<div class=\"msg-flow\"><div class=\"msg-row\"><div class=\"diagram-node\">Platform<br><small class=\"diagram-muted\">Slack · ईमेल · आदि</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><strong>/webhook</strong><br><small class=\"diagram-muted\">verify signature + parse</small><br><span class=\"diagram-pill\">INSERT लंबित कार्य</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">return 200</div></div><div class=\"msg-fire\"><span class=\"diagram-muted\">fire-and-forget</span> <span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</span></div><div class=\"msg-row\"><div class=\"diagram-box\" data-rough><strong>/process-task</strong><br><small class=\"diagram-muted\">नया execution · अपना timeout</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">claim</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">agent loop</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">adapter.sendResponse</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">completed</div></div><div class=\"diagram-panel msg-retry\" data-rough><span class=\"diagram-pill warn\">every 60s</span> <span class=\"diagram-muted\">retry job sweeps stuck tasks (pending &gt;90s · processing &gt;5min) and re-fires /process-task &mdash; capped at 3 attempts, then <strong>failed</strong></span></div></div>",
  "css": ".msg-flow{display:flex;flex-direction:column;gap:12px}.msg-flow .msg-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.msg-flow .msg-fire{display:flex;align-items:center;gap:8px;padding-inline-start:12px}.msg-flow .msg-retry{display:flex;align-items:center;gap:8px;flex-wrap:wrap}"
}
```

इनबाउंड और आउटबाउंड वार्तालाप एक ही SQL थ्रेड में रहते हैं, इसलिए आप वेब UI से Slack DM संदेश जारी रख सकते हैं या इसके विपरीत।

```an-api
{
  "method": "POST",
  "path": "/_agent-native/integrations/slack/webhook",
  "summary": "Slack इवेंट API इनबाउंड वेबहुक",
  "description": "Receives Slack events (DMs and channel `app_mention`s). Verifies the request signature, parses the payload into an `IncomingMessage`, inserts a `pending` row into `integration_pending_tasks`, fires the fresh-execution processor, and returns **200 immediately** — well inside Slack's 3-second SLA. The same route shape exists per platform under `/_agent-native/integrations/<platform>/webhook`.",
  "auth": "HMAC-SHA256 of the raw body using `SLACK_SIGNING_SECRET`, checked against the `X-Slack-Signature` header. In production also gated by `SLACK_ALLOWED_TEAM_IDS` / `SLACK_ALLOWED_API_APP_IDS`.",
  "params": [
    { "name": "X-Slack-Signature", "in": "header", "type": "string", "required": true, "description": "Slack request signature, verified before any processing." },
    { "name": "X-Slack-Request-Timestamp", "in": "header", "type": "string", "required": true, "description": "Timestamp used in the signature base string." }
  ],
  "request": {
    "contentType": "application/json",
    "example": "{\n  \"type\": \"event_callback\",\n  \"team_id\": \"T0123\",\n  \"api_app_id\": \"A0123\",\n  \"event\": {\n    \"type\": \"message\",\n    \"channel_type\": \"im\",\n    \"user\": \"U0123\",\n    \"text\": \"summarize last week's signups\"\n  }\n}"
  },
  "responses": [
    { "status": "200", "description": "Acknowledged immediately. The agent loop runs in the separate /process-task execution. The first time a Request URL is saved, Slack POSTs a `url_verification` challenge and the adapter replies with the `challenge` value automatically.", "example": "{ \"ok\": true }" },
    { "status": "401", "description": "Signature verification failed, or the team/app id is not in the production allowlist." }
  ]
}
```

#### यह पैटर्न क्यों (और प्लेटफ़ॉर्म-मूल शॉर्टकट नहीं) {#why-this-pattern}

प्रतिक्रिया भेजते ही सर्वर रहित फ़ंक्शन रुक जाते हैं। जो कुछ भी अभी भी चल रहा है - जिसमें आग लगाओ और भूल जाओ वादा, एक स्थगित LLM कॉल, या एक इन-फ़्लाइट टूल शामिल है - निष्पादन के बीच में बंद हो जाता है। एजेंट लूप को जीवित रखने का एकमात्र तरीका इसके लिए **नया** फ़ंक्शन निष्पादन शुरू करना है, जो कि स्व-चालित `/process-task` POST करता है।

क्या NOT इनमें से किसी भी विकल्प का उपयोग करता है:

- **नेटलिफाई बैकग्राउंड फ़ंक्शंस** - केवल-नेटलिफ़ाई के लिए, एक `-background.ts` फ़ाइल नाम प्रत्यय की आवश्यकता होती है, जो हर दूसरे होस्ट पर टूट जाता है।
- **क्लाउडफ्लेयर `event.waitUntil()`** - केवल सीएफ कर्मचारी, पोर्टेबल नहीं।
- **वर्सेल `after()` / फ्लूइड** - केवल वर्सेल, विशिष्ट रनटाइम के पीछे गेटेड।
- **`return` के बाद नग्न आग लगाओ और भूल जाओ** - फ़ंक्शन फ़्रीज़ होने पर चुपचाप समाप्त हो जाता है; लॉग में कोई त्रुटि नहीं, उपयोगकर्ता को कभी कोई उत्तर नहीं मिलता।

SQL-क्यू + सेल्फ-वेबहुक + रिट्री-जॉब संयोजन एकमात्र ऐसी चीज है जो प्रत्येक समर्थित होस्ट पर समान रूप से काम करती है। पुन: प्रयास कार्य सुरक्षा जाल है - यह कभी न मानें कि फ़ंक्शन फ़्रीज़ होने से पहले प्रारंभिक डिस्पैच फ़्लश हो गया।

### एकीकरण प्लगइन {#plugin}

कोई कस्टम संस्करण मौजूद नहीं होने पर प्लगइन स्वतः माउंट हो जाता है। अनुकूलित करने के लिए, बनाएं:

```ts
// server/plugins/integrations.ts
import { createIntegrationsPlugin } from "@agent-native/core/server";
import { scriptRegistry } from "../../agent.config";

export default createIntegrationsPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
});
```

कौन से प्लेटफ़ॉर्म सक्रिय हैं यह इस बात पर निर्भर करता है कि कौन से एनवी वर्र्स सेट हैं। प्लगइन `/_agent-native/integrations/` के अंतर्गत प्रत्येक के लिए वेबहुक रूट पंजीकृत करता है।

### वेबहुक URLs {#webhook-urls}

```text
/_agent-native/integrations/slack/webhook
/_agent-native/integrations/telegram/webhook
/_agent-native/integrations/whatsapp/webhook
/_agent-native/integrations/email/webhook
```

टेलीग्राम एक बार के सेटअप समापन बिंदु को भी उजागर करता है:

```text
POST /_agent-native/integrations/telegram/setup
```

### पर्यावरण चर {#env-vars}

| प्लेटफ़ॉर्म | आवश्यक                                                                       | वैकल्पिक                                              |
| ----------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| Slack       | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`                                    | `SLACK_ALLOWED_TEAM_IDS`, `SLACK_ALLOWED_API_APP_IDS` |
| टेलीग्राम   | `TELEGRAM_BOT_TOKEN`                                                         | —                                                     |
| ईमेल        | `EMAIL_AGENT_ADDRESS`, प्लस `RESEND_API_KEY` या `SENDGRID_API_KEY` में से एक | `EMAIL_INBOUND_WEBHOOK_SECRET`                        |
| व्हाट्सएप   | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | —                                                     |

सभी क्रेडेंशियल env vars में रहते हैं - कभी डेटाबेस नहीं, कभी स्रोत कोड नहीं। साइडबार सेटिंग्स UI या अपने होस्टिंग प्रदाता के env पैनल का उपयोग करें।

### थ्रेडिंग और पहचान {#threading-and-identity}

प्रत्येक बाहरी वार्तालाप एजेंट-मूल डेटाबेस में एक सतत थ्रेड पर मैप होता है:

- **Slack DM संदेश** → प्रति Slack उपयोगकर्ता एक थ्रेड।
- **Slack चैनल @उल्लेख** → प्रति चैनल एक थ्रेड।
- **टेलीग्राम चैट** → प्रति टेलीग्राम चैट एक थ्रेड।
- **व्हाट्सएप वार्तालाप** → प्रति व्हाट्सएप नंबर एक थ्रेड।
- **ईमेल** → थ्रेडिंग `Message-ID` / `In-Reply-To` / `References` हेडर से प्राप्त हुई।

बाहरी थ्रेड वेब UI में वेब-उत्पन्न थ्रेड के साथ दिखाई देते हैं, जो उनके स्रोत प्लेटफ़ॉर्म के साथ टैग किए गए हैं। पहचान समाधान: जब कोई Slack/ईमेल उपयोगकर्ता किसी पंजीकृत उपयोगकर्ता से मेल खाता है (आमतौर पर ईमेल द्वारा), तो वे उस खाते से लिंक हो जाते हैं।

### सुरक्षा {#security}

प्रत्येक आने वाले वेबहुक को प्रसंस्करण से पहले हस्ताक्षर-सत्यापित किया जाता है:

- **Slack** - `SLACK_SIGNING_SECRET` का उपयोग करके बॉडी का HMAC-SHA256, `X-Slack-Signature` हेडर के विरुद्ध जांचा गया। जब आप पहली बार Slack के इवेंट सब्सक्रिप्शन पैनल में एक अनुरोध URL सहेजते हैं, तो Slack उस पर एक `url_verification` चुनौती पोस्ट करता है; फ्रेमवर्क का एडॉप्टर इसका पता लगाता है और स्वचालित रूप से `challenge` मान के साथ उत्तर देता है, इसलिए URL आपके अंत में किसी भी अतिरिक्त काम के बिना Slack में हरे रंग में बदल जाता है।
- **टेलीग्राम** - वेबहुक पंजीकृत करते समय गुप्त टोकन सेट।
- **व्हाट्सएप** - मेटा की सत्यापन चुनौती (`WHATSAPP_VERIFY_TOKEN` का उपयोग करके) प्लस पेलोड हस्ताक्षर।
- **ईमेल** - `EMAIL_INBOUND_WEBHOOK_SECRET` सेट होने पर स्विक्स-शैली हस्ताक्षर सत्यापन (पुनः भेजें और भेजेंग्रिड दोनों इस प्रारूप का उपयोग करते हैं)। यदि रहस्य अनिश्चित है, तो वेबहुक स्वीकार कर लिया जाता है लेकिन एक चेतावनी लॉग की जाती है।

ईमेल एडाप्टर यह भी लागू करता है:

- **अनुमत डोमेन** - एकीकरण की `integration_configs` पंक्ति में वैकल्पिक `allowedDomains` सरणी; सूची से बाहर के प्रेषक हटा दिए जाते हैं।
- **दर सीमा** - SQL-कतार-समर्थित दर सीमा प्रति प्रेषक प्रति घंटे 20 इनबाउंड संदेशों की।

### प्रोएक्टिव भेजता है {#proactive-sends}

एजेंट `"slack"`, `"telegram"`, `"whatsapp"`, या `"email"` के `platform` फ़ील्ड के साथ `send-platform-message` कार्रवाई को कॉल करके अपनी पहल पर संदेश (सूचनाएं, अनुस्मारक, निर्धारित सारांश) भेज सकता है। कार्रवाई `packages/dispatch/src/actions/send-platform-message.ts` पर डिस्पैच पैकेज में रहती है और आप इसे किसी भी टेम्पलेट के लिए कॉपी/अनुकूलित कर सकते हैं।

### कस्टम एडाप्टर {#custom-adapters}

नया मैसेजिंग प्लेटफ़ॉर्म जोड़ने के लिए, `PlatformAdapter` इंटरफ़ेस लागू करें:

```ts
import type { H3Event } from "h3";
import type {
  PlatformAdapter,
  IncomingMessage,
  OutgoingMessage,
} from "@agent-native/core/server";
import type { EnvKeyConfig } from "@agent-native/core/server";

const myAdapter: PlatformAdapter = {
  platform: "discord",
  label: "Discord",

  // Env keys this adapter needs (rendered in the settings UI)
  getRequiredEnvKeys(): EnvKeyConfig[] {
    return [
      { key: "DISCORD_BOT_TOKEN", label: "Discord Bot Token", required: true },
    ];
  },

  // Handle platform-specific verification challenges (e.g. Slack's
  // url_verification). Return { handled: true, response } to short-circuit.
  async handleVerification(event: H3Event) {
    return { handled: false };
  },

  // Validate the webhook request signature
  async verifyWebhook(event: H3Event): Promise<boolean> {
    // Validate signature headers; return true if authentic
    return true;
  },

  // Parse the webhook payload into a normalized IncomingMessage.
  // Return null to silently ignore the event (bot messages, edits, etc.).
  async parseIncomingMessage(event: H3Event): Promise<IncomingMessage | null> {
    return {
      platform: "discord",
      externalThreadId: "channel-or-thread-id",
      text: "the user's message",
      senderId: "discord-user-id",
      platformContext: { channelId: "channel-id" },
      timestamp: Date.now(),
    };
  },

  // Format plain agent text into a platform-appropriate OutgoingMessage.
  // opts.threadDeepLinkUrl, when provided, is a URL back to the originating
  // thread in the dispatch UI — render it as a button (Slack) or inline link.
  formatAgentResponse(
    text: string,
    opts?: { threadDeepLinkUrl?: string },
  ): OutgoingMessage {
    return { text, platformContext: {} };
  },

  // Post the agent's response back to the platform
  async sendResponse(
    message: OutgoingMessage,
    context: IncomingMessage,
  ): Promise<void> {
    // Call the platform's API, using context.platformContext for routing
  },

  // Return current connection/configuration status for the settings UI.
  // baseUrl is the app's public URL, used for status checks that need it.
  async getStatus(baseUrl?: string) {
    return {
      platform: "discord",
      label: "Discord",
      enabled: true,
      configured: !!process.env.DISCORD_BOT_TOKEN,
    };
  },
};
```

इसे अपने एकीकरण प्लगइन में पंजीकृत करें:

```ts
export default createIntegrationsPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
  adapters: [myAdapter],
});
```

संदर्भ कार्यान्वयन `packages/core/src/integrations/adapters/` (`slack.ts`, `telegram.ts`, `whatsapp.ts`, `email.ts`) में रहते हैं - ईमेल एडाप्टर सबसे पूर्ण उदाहरण है, जिसमें हस्ताक्षर सत्यापन, थ्रेडिंग, रेट लिमिटिंग और HTML रेंडरिंग शामिल है।

### डिस्पैच + A2A निरंतरता के माध्यम से विश्वसनीयता {#reliability}

जब [Dispatch](/docs/dispatch) [A2A](/docs/a2a-protocol#continuations) पर किसी अन्य ऐप को अनुरोध सौंपता है, तो निरंतरता-पुनर्प्राप्ति प्रवाह गारंटी देता है कि उपयोगकर्ता को Slack/ईमेल उत्तर मिलता है, भले ही डाउनस्ट्रीम एजेंट निष्पादन के बीच में क्रैश हो जाए। मूल वेबहुक कार्य `processing` में तब तक रहता है जब तक कि निरंतरता या तो हल नहीं हो जाती या पुनः प्रयास स्वीप इसे अटका हुआ नहीं दर्शाता; किसी भी तरह से, प्लेटफ़ॉर्म थ्रेड को चुप रहने के बजाय अंतिम उत्तर मिलता है।

इसका मतलब है कि डिस्पैच द्वारा संचालित मल्टी-ऐप वर्कस्पेस सीधे मैसेजिंग के लिए वायर्ड एकल टेम्पलेट की तुलना में अधिक लचीला है - किसी भी एक डाउनस्ट्रीम ऐप में विफलता एक गिराए गए उत्तर के बजाय एक सुंदर त्रुटि संदेश में बदल जाती है। संपूर्ण डिलीवरी-गारंटी कहानी के लिए [A2A continuations](/docs/a2a-protocol#continuations) देखें।

### सामान्य नुकसान {#pitfalls}

- **अनुरोध बॉडी को दोबारा न पढ़ें।** h3 v2 की बॉडी स्ट्रीम उपभोग-एक बार है: यदि आप फ्रेमवर्क `event.node.req.body` (या इसके विपरीत) को पहले ही पार्स करने के बाद `readBody(event)` को कॉल करते हैं, तो दूसरा रीड अनुरोध को अनिश्चित काल के लिए लटका देता है। यह रीसेंड और सेंडग्रिड के साथ सबसे अधिक बार दिखाई देता है - दोनों इनबाउंड पेलोड को स्ट्रीम करते हैं और लटकता हुआ रीड कभी भी हल नहीं होता है, प्लेटफ़ॉर्म का समय समाप्त हो जाता है, और वेबहुक को तब तक पुनः प्रयास किया जाता है जब तक कि यह समाप्त न हो जाए। यदि आप फ्रेमवर्क के वेबहुक हैंडलर को अपने मिडलवेयर में लपेटते हैं, तो हैंडलर को दोबारा पार्स करने देने के बजाय पहले से पार्स किए गए `IncomingMessage` को `incoming` विकल्प के माध्यम से पास करें।
- **वेबहुक हैंडलर के अंदर एजेंट लूप न चलाएं।** हैंडलर को कतारबद्ध होकर वापस लौटना होगा - एजेंट लूप प्रोसेसर के ताज़ा निष्पादन में चलता है। इसे इनलाइन डालने से यह गारंटी मिलती है कि सर्वर रहित फ़्रीज़ रन को ख़त्म कर देता है। इसके अलावा, सार्वजनिक-सामना वाले गेटवे एकीकरण (जैसे कि नेटलिफाई या वर्सेल) सख्त HTTP टाइमआउट सीमाएं लागू करते हैं (उदाहरण के लिए, नेटलिफाई की 10-सेकंड अनुरोध सीमा)। क्योंकि एजेंट चलता है और उपकरण अक्सर इस विंडो से अधिक समय लेते हैं, वेबहुक अनुरोध के भीतर लूप को समकालिक रूप से चलाने का प्रयास करने से गेटवे कनेक्शन समाप्त कर देगा, जिसके परिणामस्वरूप निष्पादन निरस्त हो जाएगा और उत्तर ड्रॉप हो जाएंगे। HMAC-हस्ताक्षरित स्व-वेबहुक `/process-task` कतार पैटर्न पूर्ण एजेंट लूप को सुरक्षित रूप से निष्पादित करते समय गेटवे सीमा को संतुष्ट करने का एकमात्र तरीका है।
- **कोल्ड स्टार्ट के दौरान डिडअप मेमोरी पर भरोसा न करें।** डिडअप कुंजी SQL `(platform, external_event_key)` यूनिक इंडेक्स में रहती है, इन-प्रोसेस मैप में नहीं। यदि आप कतार को प्रतिस्थापित करते हैं, तो SQL-स्तर डिडअप रखें या डुप्लिकेट Slack पुनः प्रयास डुप्लिकेट एजेंट रन को ट्रिगर करेगा।
- **सेल्फ-वेबहुक URL को पहुंच योग्य रखें।** प्रोसेसर URL को `APP_URL` / `URL` / `DEPLOY_URL` / `BETTER_AUTH_URL` से बनाया गया है, जो इनबाउंड रिक्वेस्ट हेडर पर आधारित है। पुनर्लिखित होस्टनामों के साथ पूर्वावलोकन परिनियोजन पर, इनमें से किसी एक को स्पष्ट रूप से सेट करें या प्रेषण 404 पर पहुंच जाएगा।

### यह भी देखें {#see-also}

- [Dispatch](/docs/dispatch) - सभी ऐप्स में एक केंद्रीय इनबॉक्स का उपयोग करने के लिए अवधारणा अवलोकन
- [Dispatch template reference](/docs/template-dispatch) — मल्टी-ऐप कार्यस्थानों के लिए अनुशंसित केंद्रीय इनबॉक्स
- [A2A Protocol](/docs/a2a-protocol) - निरंतरता पुनर्प्राप्ति सहित, डिस्पैच प्रतिनिधि अन्य एजेंटों के लिए कैसे काम करते हैं
- [Agent Mentions](/docs/agent-mentions) - वेब चैट के अंदर `@`-उल्लेख करने वाले एजेंट
