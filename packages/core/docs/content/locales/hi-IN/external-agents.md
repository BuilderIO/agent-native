---
title: "बाहरी एजेंट: Claude, ChatGPT, Codex, कर्सर, सहकर्मी"
description: "Claude, ChatGPT, Codex, कर्सर, Claude कोवर्क, या किसी MCP-संगत होस्ट को होस्ट किए गए एजेंट-नेटिव ऐप से कनेक्ट करें - फिर MCP ऐप्स और डीप लिंक के साथ चल रहे UI में राउंड-ट्रिप कलाकृतियों को वापस लाएं।"
search: "Claude ChatGPT Claude कोड Codex कर्सर Claude कोवर्क MCP ऐप्स एजेंट-नेटिव कनेक्ट स्थानीय एजेंट टूल्स बाहरी एजेंट"
---

# बाहरी एजेंट

**यह पृष्ठ: किसी बाहरी एजेंट या MCP होस्ट को अपने ऐप से कनेक्ट करें।** इसका उपयोग तब करें जब Claude, ChatGPT, Codex, कर्सर, Claude कोवर्क, या किसी अन्य MCP-संगत होस्ट को होस्ट किए गए एजेंट-मूल ऐप को चलाना चाहिए और परिणाम को वापस चल रहे UI में राउंड-ट्रिप करना चाहिए।

| यदि आप चाहते हैं…                                               | पढ़ें                              |
| --------------------------------------------------------------- | ---------------------------------- |
| किसी बाहरी एजेंट/होस्ट को अपने ऐप से कनेक्ट करें                | **यह पृष्ठ** — बाहरी एजेंट         |
| अपने एजेंट को अधिक टूल दें (अन्य MCP सर्वर का उपभोग करें)       | [MCP Clients](/docs/mcp-clients)   |
| इनलाइन UI बनाएं जो Claude/ChatGPT में प्रस्तुत हों              | [MCP Apps](/docs/mcp-apps)         |
| निचले स्तर का MCP सर्वर संदर्भ (प्रमाणीकरण, उपकरण, कस्टम माउंट) | [MCP Protocol](/docs/mcp-protocol) |

एजेंट-नेटिव ऐप किसी भी MCP-संगत होस्ट द्वारा पहुंच योग्य है - Claude, Claude डेस्कटॉप, Claude कोड, ChatGPT कस्टम MCP ऐप्स, Codex, कर्सर, Claude कोवर्क, वीएस कोड GitHub कोपायलट, गूज, पोस्टमैन, MCPJam, और भविष्य के ग्राहक जो मानक लागू करते हैं। बाहरी एजेंट कलाकृतियाँ (ड्राफ्ट, इवेंट, डैशबोर्ड) तैयार करने में बहुत अच्छे होते हैं लेकिन वे अक्सर टर्मिनल या किसी अन्य ऐप में रहते हैं। पुल के बिना, उपयोगकर्ता को JSON की एक दीवार मिलती है और उसे चीज़ ढूंढने जाना पड़ता है।

बाहरी-एजेंट ब्रिज लूप को बंद कर देता है। सबसे पहले आप अपने एजेंट को **होस्टेड** ऐप से कनेक्ट करें - या तो ऐप के रिमोट MCP URL को Claude या ChatGPT जैसे चैट होस्ट में पेस्ट करके, या स्थानीय कोडिंग एजेंटों के लिए डेवलपर CLI फ्लो चलाकर। फिर एजेंट MCP पर काम करता है और उपयोगकर्ता को संगत होस्ट में एक इनलाइन **MCP ऐप** UI या एक एकल **"Open in <app> →"** लिंक सौंपता है जो वास्तविक ऐप को खोलता है जो वास्तव में उत्पादित किया गया था। यह मौजूदा `navigate` / `application_state` अनुबंध का पुन: उपयोग करता है, UI पहले से ही हर 2 सेकंड में समाप्त हो जाता है ([Context Awareness](/docs/context-awareness) देखें) - कोई दूसरा नेविगेशन तंत्र नहीं है।

```an-diagram title="बाह्य-एजेंट राउंड-ट्रिप" summary="एक बाहरी होस्ट MCP पर एक टूल को कॉल करता है; ऐप एक आर्टिफैक्ट और एक ओपन लिंक लौटाता है। इसे क्लिक करने से ब्राउज़र सत्र हल हो जाता है और चल रहे यूआई में आर्टिफैक्ट केंद्रित हो जाता है - लिंक में कोई विशेषाधिकार प्राप्त स्थिति नहीं होती है।"
{
  "html": "<div class=\"xa-trip\"><div class=\"diagram-box\" data-rough>बाहरी होस्ट<br><small class=\"diagram-muted\">Claude &middot; ChatGPT &middot; Codex &middot; Cursor</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">MCP टूल call</span><small class=\"diagram-muted\">e.g. <code>manage-draft</code></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>ऐप artifact बनाता है<br><small class=\"diagram-muted\">+ <code>Open in &lt;app&gt; &rarr;</code> deep link / MCP App</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>उपयोगकर्ता लिंक क्लिक करता है</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill ok\"><code>/_agent-native/open</code></span><small class=\"diagram-muted\">resolves the <strong>browser</strong> session</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Writes <code>navigate</code> app-state<br><small class=\"diagram-muted\">UI artifact पर फोकस करती है</small></div></div>",
  "css": ".xa-trip{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.xa-trip .center{display:flex;flex-direction:column;align-items:center;gap:4px}.xa-trip .diagram-arrow{font-size:22px;line-height:1}.xa-trip code{font-size:.85em}"
}
```

पहचान नियम सुरक्षा काज है: लिंक केवल `view` + रिकॉर्ड आईडी + फ़िल्टर है, और रिकॉर्ड-फ़ोकस `navigate` लेखन का दायरा उस व्यक्ति तक है जो **ब्राउज़र** में लॉग इन है - कभी भी बाहरी एजेंट का MCP टोकन नहीं। यही कारण है कि लिंक को टर्मिनल या चैट ट्रांसक्रिप्ट में चिपकाना सुरक्षित है।

## आपको किस एजेंट पथ की आवश्यकता है? {#which-agent-path}

- **बाहरी MCP होस्ट:** इस पृष्ठ का उपयोग तब करें जब Claude, ChatGPT, Codex, कर्सर, ओपनकोड, GitHub कोपायलट / वीएस कोड, या कोई अन्य MCP-संगत होस्ट आपके होस्ट किए गए एजेंट-मूल ऐप को कॉल करे।
- **Agent-Native चैट के पीछे आपका अपना रनटाइम:** [Agent Surfaces](/docs/agent-surfaces#byo-agent) और [Native चैट UI](/docs/native-chat-ui#byo-agent-runtimes) देखें जब किसी अन्य ढांचे के साथ निर्मित एजेंट को `<AssistantChat runtime={...}>` को पावर देना चाहिए।
- **आपका ऐप MCP टूल का उपभोग कर रहा है:** जब एक एजेंट-नेटिव ऐप को किसी अन्य MCP सर्वर द्वारा उजागर किए गए टूल को कॉल करने की आवश्यकता होती है तो [MCP Clients](/docs/mcp-clients) देखें।
- **A2A के माध्यम से एक अन्य ऐप या एजेंट:** जब एजेंट-मूल ऐप्स को एक-दूसरे को खोजना और सौंपना हो तो [Agent Mentions](/docs/agent-mentions) और [A2A](/docs/a2a-protocol) का उपयोग करें।
- **स्थानीय कस्टम उप-एजेंट:** जब आप एजेंट-मूल कार्यक्षेत्र के अंदर ही कस्टम एजेंट प्रोफाइल चाहते हैं तो [Workspace](/docs/workspace) का उपयोग करें।

## आसान सेटअप {#easy-setup}

उस होस्ट में एक रिमोट MCP कनेक्टर जोड़ें जहां आप Agent-Native का उपयोग करना चाहते हैं।

कार्यस्थान या क्रॉस-ऐप कार्य के लिए, डिस्पैच का उपयोग करें:

```text
https://dispatch.agent-native.com/_agent-native/mcp
```

डिस्पैच मेल, कैलेंडर, एनालिटिक्स, ब्रेन और आपके लिए एकल गेटवे है
कार्यस्थान ऐप्स। डिस्पैच के **एजेंट** पृष्ठ में, चुनें कि गेटवे कर सकता है या नहीं
सभी ऐप्स या केवल चयनित ऐप्स तक पहुंचें। कनेक्टेड होस्ट को तब
`list_apps`, `ask_app`, और `open_app`, उस स्वीकृत सेट पर फ़िल्टर किए गए।

जानबूझकर अलग किए गए किसी ऐप के लिए, सीधे उस ऐप का उपयोग करें:

```text
https://mail.agent-native.com/_agent-native/mcp
https://<your-app>.agent-native.com/_agent-native/mcp
```

प्रत्येक होस्ट किए गए ऐप में एक सहायक पृष्ठ भी होता है
`https://<app>/_agent-native/mcp/connect` प्रतिलिपि योग्य URL और
Claude, ChatGPT, कर्सर, Claude कोड, Codex और अन्य के लिए होस्ट-विशिष्ट टैब।

### Claude और ChatGPT OAuth {#oauth}

Claude / Claude डेस्कटॉप: एक कस्टम कनेक्टर जोड़ें, MCP URL पेस्ट करें, क्लिक करें
**कनेक्ट**, अपने Agent-Native खाते से साइन इन करें, MCP दायरे को मंजूरी दें,
और चैट में कनेक्टर को सक्षम करें। Claude कोड समान URL का उपयोग करता है: इसे a
दूरस्थ HTTP MCP सर्वर, `/mcp` चलाएं, फिर **प्रमाणित करें** चुनें।

ChatGPT: ऐसे कार्यक्षेत्र का उपयोग करें जहां कस्टम MCP कनेक्टर या डेवलपर-मोड ऐप्स हों
सक्षम, एक कस्टम कनेक्टर/ऐप बनाएं, वही MCP URL पेस्ट करें, OAuth चुनें,
उपकरणों को स्कैन/खोजें, Agent-Native के साथ साइन इन करें, स्कोप स्वीकृत करें और सक्षम करें
चैट में कनेक्टर.

OAuth अनुदान प्रति होस्ट और प्रति उपयोगकर्ता है। होस्ट टोकन संग्रहीत करता है और
टूल/संसाधन कॉल में मध्यस्थता करता है, इसलिए इनलाइन MCP ऐप पूर्वावलोकन कभी भी कच्चा नहीं मिलता है
OAuth टोकन। ChatGPT एक समीक्षा की गई या प्रकाशित कनेक्टर का टूल
स्नैपशॉट जब तक आप इसे ताज़ा/समीक्षा नहीं करते, इसलिए MCP के बाद कनेक्टर को फिर से स्कैन करें
टूल या MCP ऐप मेटाडेटा बदलता है। यदि आपके पास अभी भी पुराने प्रति-ऐप कनेक्टर हैं
प्रत्येक पुराने कनेक्टर को डिस्पैच, रिफ्रेश या पुनः कनेक्ट करने के साथ सक्षम; अपडेट किया जा रहा है
डिस्पैच ChatGPT या Claude के कैश्ड कैलेंडर/मेल/आदि को दोबारा नहीं लिखता है।
स्नैपशॉट. दायरे हैं:

| दायरा       | यह क्या सक्षम बनाता है                               |
| ----------- | ---------------------------------------------------- |
| `mcp:read`  | केवल पढ़ने योग्य उपकरण और उपकरण/संसाधन खोज           |
| `mcp:write` | ड्राफ्टिंग, अद्यतनीकरण, और अन्य परिवर्तनकारी actions |
| `mcp:apps`  | इनलाइन MCP ऐप्स, चार्ट, डैशबोर्ड, ड्राफ्ट और UIs     |

कर्सर, गूज़, पोस्टमैन, MCPJam, और VS कोड GitHub कोपायलट एक ही रिमोट का उपयोग करते हैं
MCP URL अपने स्वयं के MCP-सर्वर UIs के माध्यम से जब उनका निर्माण रिमोट OAuth का समर्थन करता है
MCP सर्वर।

### त्वरित परीक्षण संकेत {#quick-test}

कनेक्ट करने के बाद, इनमें से कोई एक आज़माएँ:

```text
Use Agent-Native Analytics to generate a weekly conversion-rate bar chart and show it inline.
```

```text
Use Agent-Native Mail to draft a short follow-up email to me, but do not send it.
```

MCP ऐप्स का समर्थन करने वाले होस्ट में, एनालिटिक्स वास्तविक डैशबोर्ड और विश्लेषण मार्गों को इनलाइन प्रस्तुत कर सकता है, और मेल ड्राफ्ट समीक्षा के लिए वास्तविक कंपोज़ UI इनलाइन प्रस्तुत कर सकता है। उन होस्ट में जो MCP ऐप्स प्रस्तुत नहीं करते हैं, वही टूल कॉल अभी भी एक डीप लिंक लौटाता है जैसे **मेल में ड्राफ्ट खोलें →** या **एनालिटिक्स में डैशबोर्ड खोलें →**।

## उन्नत सेटअप: स्थानीय एजेंट {#connect}

अपनी मशीन पर स्थानीय एजेंट क्लाइंट के लिए इस प्रवाह का उपयोग करें - Claude कोड, Claude कोड CLI, Codex, Claude कोवर्क, कर्सर, ओपनकोड, और GitHub कोपायलट / वीएस कोड। कर्सर और अन्य OAuth-मूल ग्राहक उपरोक्त पेस्ट-URL प्रवाह का भी उपयोग कर सकते हैं जब उनका UI रिमोट MCP OAuth का समर्थन करता है।

npm के माध्यम से कनेक्ट कमांड चलाएँ:

```bash
npx @agent-native/core@latest connect https://dispatch.agent-native.com
```

कमांड पूछता है कि किस स्थानीय एजेंट क्लाइंट को MCP कॉन्फ़िगरेशन प्राप्त करना चाहिए। सभी ग्राहकों को पहली बार पूर्वचयनित किया जाता है; आपके द्वारा चुनने के बाद, चयन को `~/.agent-native/connect.json` में सहेजा जाता है ताकि अगला रन इसे Enter के साथ पुन: उपयोग कर सके, या आप चेक किए गए आइटम को संपादित कर सकें।

Claude कोड, Claude कोड CLI, कर्सर, ओपनकोड और GitHub कोपायलट/वीएस कोड के लिए, `connect` बिना किसी स्थिर हेडर के एक मानक रिमोट HTTP MCP प्रविष्टि लिखता है। क्लाइंट को पुनरारंभ करें और संकेत मिलने पर उसके MCP UI से प्रमाणित करें। Codex और Claude कोवर्क के लिए, `connect` संगतता डिवाइस-कोड प्रवाह का उपयोग करता है: यह ऐप पर आपका ब्राउज़र खोलता है, आप एक बार **अधिकृत** पर क्लिक करते हैं, और कमांड एक स्कोप्ड बियरर-टोकन प्रविष्टि लिखता है। यदि आप ग्राहकों का मिश्रण चुनते हैं, तो यह दोनों काम करता है।

ब्राउज़र अनुमोदन पूरा होने तक `connect` कमांड को चालू रखें। यदि
प्रतीक्षा प्रक्रिया जल्दी बंद कर दी गई है, ब्राउज़र में अनुमोदन सफल हो सकता है लेकिन
स्थानीय क्लाइंट कॉन्फ़िगरेशन को टोकन प्राप्त नहीं होगा।

यदि आपने पहले Claude कोड को पुराने बियरर-टोकन प्रवाह के माध्यम से कनेक्ट किया है, तो बस वही `npx @agent-native/core@latest connect ... --client claude-code` कमांड फिर से चलाएँ। CLI पुराने `Authorization` हेडर को केवल URL OAuth प्रविष्टि से बदल देता है और आपको `/mcp` से पुनः प्रमाणित करने के लिए कहता है।

| स्थानीय ग्राहक              | `connect` द्वारा लिखित कॉन्फिग                               | प्रामाणिक प्रवाह                             |
| --------------------------- | ------------------------------------------------------------ | -------------------------------------------- |
| Claude कोड / Claude कोड CLI | `.mcp.json` या `~/.claude.json`, `--scope` पर निर्भर करता है | Claude के `/mcp` UI में मानक रिमोट MCP OAuth |
| कर्सर                       | `.cursor/mcp.json` या `~/.cursor/mcp.json`                   | कर्सर के MCP UI में मानक रिमोट MCP OAuth     |
| ओपनकोड                      | `opencode.json` या `~/.config/opencode/opencode.json`        | ओपनकोड के MCP UI में मानक रिमोट MCP OAuth    |
| GitHub कोपायलट/वीएस कोड     | `.vscode/mcp.json` या VS कोड उपयोगकर्ता MCP कॉन्फिगरेशन      | वीएस कोड के MCP UI में मानक रिमोट MCP OAuth  |
| Codex                       | `$CODEX_HOME/config.toml` या `~/.codex/config.toml`          | ब्राउज़र-अधिकृत बियरर फ़ॉलबैक                |
| Claude सहकर्मी              | `~/.cowork/mcp.json` Claude कोड MCP आकार का उपयोग करते हुए   | ब्राउज़र-अधिकृत बियरर फ़ॉलबैक                |

कनेक्ट करने के बाद एजेंट क्लाइंट को पुनरारंभ करें ताकि वह नया MCP सर्वर उठा सके; OAuth-मूल ग्राहक आपको उनके MCP UI से प्रमाणित करने के लिए संकेत दे सकते हैं।

स्थानीय MCP कॉन्फ़िगरेशन का समस्या निवारण करते समय, `Authorization`, `http_headers` को पुनः संपादित करें
और लॉग साझा करने से पहले टोकन मान। ए
मेजबान MCP सत्र; कनेक्ट करने के बाद, होस्ट-एक्सपोज़्ड टूल का उपयोग करें या पुनः आरंभ करें
यदि नया सर्वर अभी तक दिखाई नहीं दे रहा है तो क्लाइंट।

स्क्रिप्ट या एकबारगी इंस्टॉल के लिए पिकर को छोड़ने के लिए `--client codex` (या `--client claude-code`, `--client claude-code-cli`, `--client cursor`, `--client opencode`, `--client github-copilot`, `--client cowork`, `--client all`) का उपयोग करें।

प्रथम-पक्ष ऐप skills निर्देशों और होस्ट किए गए MCP कनेक्टर को Agent Native CLI के साथ इंस्टॉल करें:

```bash
npx @agent-native/core@latest skills add assets              # alias: image-generation
```

जब आप केवल पोर्टेबल चाहते हैं तो वर्सेल/ओपन Skills CLI पथ भी उपलब्ध है
निर्देश:

```bash
npx skills@latest add BuilderIO/agent-native --skill assets
```

कच्चा `skills` CLI केवल `SKILL.md` फ़ाइलें स्थापित करता है; स्थानीय MCP ग्राहक अभी भी
`npx @agent-native/core@latest connect https://assets.agent-native.com` जैसे कनेक्टर की आवश्यकता है।

| कौशल     | उपनाम              | के लिए             |
| -------- | ------------------ | ------------------ |
| `assets` | `image-generation` | छवि/वीडियो निर्माण |

डिफ़ॉल्ट क्लाइंट चयन सभी स्थानीय क्लाइंट समर्थित है; सेटअप को संकीर्ण करने के लिए `--client codex`, `--client claude-code`, या कोई अन्य विशिष्ट लक्ष्य जोड़ें। इनलाइन होस्ट (ChatGPT, Claude.ai, Claude डेस्कटॉप मुख्य चैट) चैट में पिकर/वेरिएंट ग्रिड प्रस्तुत करते हैं; CLI/केवल-लिंक होस्ट (Codex, Claude कोड, Claude डेस्कटॉप "कोड" टैब) एक "ओपन इन ... →" लिंक लौटाता है जहां उपयोगकर्ता ब्राउज़र में चुनता है और एक हैंडऑफ़ सारांश वापस पेस्ट करता है।

जब आपको वास्तव में डिस्पैच के वर्कस्पेस गेटवे के बजाय एक अलग ऐप की आवश्यकता होती है,
उस ऐप के होस्ट के साथ वही कमांड चलाएँ:

```bash
npx @agent-native/core@latest connect https://mail.agent-native.com
```

`connect --all` अभी भी लीगेसी प्रति-ऐप क्लाइंट सेटअप के लिए मौजूद है, लेकिन नया है
कार्यस्थान सेटअप को एकल डिस्पैच कनेक्टर को प्राथमिकता देनी चाहिए।

कनेक्शन **प्रति-उपयोगकर्ता, स्कोप्ड, और प्रतिसंहरणीय** है। OAuth पथ में, होस्ट `/mcp` प्रमाणीकरण के बाद टोकन संग्रहीत करता है; फ़ॉलबैक पथ में, जिस ब्राउज़र सत्र को आपने अधिकृत किया है वह वह पहचान है जिसके रूप में एजेंट कार्य करता है। कुछ भी तैनाती के साझा रहस्य को उजागर नहीं करता है।

### 401 के बाद पुन:प्रमाणित किया जा रहा है {#reconnect}

एक बार कनेक्ट होने के बाद, ऑथ लंबे समय तक जारी रहना चाहिए - एक्सेस टोकन डिफ़ॉल्ट रूप से 30 दिनों तक चलते हैं (सर्वर पर `MCP_OAUTH_ACCESS_TOKEN_TTL` के साथ ओवरराइड, उदाहरण के लिए `7d` या `12h`) स्लाइडिंग 365-दिन की रिफ्रेश विंडो के साथ, इसलिए यादृच्छिक 401 दुर्लभ होना चाहिए। जब ऐसा होता है, तो पुनः इंस्टॉल करने के बजाय लाइटवेट रीकनेक्ट कमांड का उपयोग करें:

```bash
npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex
```

`reconnect` किसी भी MCP कॉन्फ़िगरेशन प्रविष्टि को ढूंढता है जिसका URL दिए गए होस्ट और चयनित क्लाइंट के लिए `/_agent-native/mcp` में समाप्त होता है (कनेक्टर नाम की परवाह किए बिना URL द्वारा मिलान), फिर आपके स्थापित skills को छूने या पूर्ण इंस्टॉल प्रवाह को फिर से चलाने के बिना प्रामाणिक सामग्री को ताज़ा या प्रतिस्थापित करता है। आधार ऐप URL (जैसे `https://plan.agent-native.com`) पास करें - `/_agent-native/mcp` प्रत्यय का अनुमान लगाया गया है। प्रमाणीकरण और टूल लोडिंग प्रति क्लाइंट है, इसलिए बाद में उस क्लाइंट को पुनरारंभ/पुनः लोड करें; नए लोड किए गए टूल प्रदर्शित होने से पहले Codex को एक नए सत्र की आवश्यकता है।

Claude कोड में, समतुल्य UI पथ है: `/mcp` चलाएं और प्रासंगिक कनेक्टर के लिए **प्रमाणीकृत** (या **पुन: कनेक्ट**) चुनें।

केवल 401 को ठीक करने के लिए कभी भी कौशल को दोबारा स्थापित न करें - `reconnect` सही उपकरण है।

### पेज फ़ॉलबैक कनेक्ट करें {#connect-page-fallback}

MCP क्लाइंट के लिए जो सीधे रिमोट OAuth URL नहीं जोड़ सकते हैं, अपने ब्राउज़र में ऐप खोलें और इसके **कनेक्ट** अफोर्डेंस (`https://<app>/_agent-native/mcp/connect` पर उपलब्ध) का उपयोग करें। लॉग इन करते समय, **कनेक्ट/अधिकृत** पर क्लिक करें। पेज आपको या तो एक-क्लिक डीप लिंक देता है जो किसी खोजे गए एजेंट को कॉन्फ़िगर करता है, या एक रेडी-टू-पेस्ट `.mcp.json` ब्लॉक देता है:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "mail": {
      "type": "http",
      "url": "https://mail.agent-native.com/_agent-native/mcp",
      "headers": { "Authorization": "Bearer <minted-token>" },
    },
  },
}
```

कनेक्ट करने के बाद एजेंट क्लाइंट को पुनरारंभ करें ताकि वह नया MCP सर्वर उठा सके।

इस मैनुअल बियरर ब्लॉक का उपयोग उन MCP क्लाइंट के लिए करें जो मानक रिमोट MCP OAuth प्रवाह को पूरा नहीं कर सकते हैं, या जब आप स्पष्ट रूप से एक टोकन पेस्ट करना चाहते हैं तो एक बार डिबगिंग के लिए।

### मानक रिमोट MCP OAuth {#standard-oauth}

होस्टेड एजेंट-नेटिव ऐप्स मानक रिमोट MCP OAuth प्रवाह का भी समर्थन करते हैं। उन ग्राहकों के लिए जो MCP OAuth लागू करते हैं, बिना किसी स्थिर हेडर के रिमोट HTTP सर्वर URL जोड़ें:

```bash
claude mcp add --transport http agent-native \
  https://dispatch.agent-native.com/_agent-native/mcp
```

यह वही URL-केवल प्रविष्टि है जिसे `npx @agent-native/core@latest connect https://dispatch.agent-native.com --client claude-code` आपके लिए लिखता है। फिर Claude कोड में `/mcp` चलाएं और **प्रमाणित करें** चुनें। क्लाइंट MCP सर्वर के `401 WWW-Authenticate` चुनौती से प्रमाणीकरण खोजता है, `/.well-known/oauth-protected-resource` और `/.well-known/oauth-authorization-server` प्राप्त करता है, गतिशील रूप से एक सार्वजनिक OAuth क्लाइंट पंजीकृत करता है, ऐप का प्राधिकरण पृष्ठ खोलता है, और परिणामी टोकन को सुरक्षित रूप से संग्रहीत करता है। ChatGPT डेवलपर-मोड कनेक्टर एक ही सर्वर URL का उपयोग करते हैं:

```text
https://dispatch.agent-native.com/_agent-native/mcp
```

OAuth प्रवाह ताज़ा-टोकन रोटेशन के साथ प्राधिकरण-कोड + PKCE है। एक्सेस टोकन सटीक MCP संसाधन URL के लिए ऑडियंस-बाउंड हैं और हस्ताक्षरित उपयोगकर्ता/संगठन पहचान रखते हैं, इसलिए टूल कॉल, `resources/read`, और MCP ऐप iframe-आरंभित `tools/call` सभी मौजूदा कनेक्ट-मिंटेड JWT पथ के समान `runWithRequestContext` किरायेदार स्कोपिंग के माध्यम से चलते हैं। iframe को कभी भी कच्चा OAuth टोकन प्राप्त नहीं होता है; होस्ट प्रमाणित MCP कनेक्शन के माध्यम से कॉल में मध्यस्थता करता है।

वर्तमान दायरे हैं:

| दायरा       | अनुमति देता है                                                    |
| ----------- | ----------------------------------------------------------------- |
| `mcp:read`  | केवल पढ़ने योग्य MCP actions और सामान्य उपकरण/संसाधन खोज          |
| `mcp:write` | actions और `ask-agent` मेटा-टूल को परिवर्तित करना                 |
| `mcp:apps`  | MCP ऐप्स संसाधन सूची/रीडिंग और इनलाइन UI रेंडरिंग जहां समर्थित है |

जब क्लाइंट किसी स्पष्ट दायरे का अनुरोध नहीं करता है, तो ऐप तीनों को अनुदान देता है ताकि कनेक्टर ब्राउज़र-अधिकृत कनेक्ट प्रवाह की तरह व्यवहार करे। स्थानीय डेव, फ़ॉलबैक होस्ट और क्लाइंट के लिए बियरर-टोकन कनेक्ट पेज और `npx @agent-native/core@latest connect --token <token>` फ़ॉलबैक रखें, जहां आपको रेडी-टू-पेस्ट कॉन्फ़िगरेशन ब्लॉक की आवश्यकता है।

## कैटलॉग स्तर {#catalog-tiers}

यह MCP कैटलॉग स्तरों की विहित व्याख्या है - अन्य पेज यहां लिंक हैं।

MCP सर्वर प्रत्येक कॉलर को डिफ़ॉल्ट रूप से एक **कॉम्पैक्ट कैटलॉग प्रदान करता है** - होस्ट किए गए कनेक्टर (ChatGPT, Claude), कोड क्लाइंट (Claude कोड, कर्सर, Codex), और स्थानीय CLI/stdio प्रॉक्सी समान रूप से। पूर्ण कार्रवाई सतह केवल स्पष्ट ऑप्ट-इन पर ही प्रस्तुत की जाती है। कैटलॉग का अनुमान कभी भी ग्राहक के नाम या उपयोगकर्ता-एजेंट से नहीं लगाया जाता है।

```an-diagram title="दो कैटलॉग स्तर" summary="प्रत्येक कॉल करने वाले को डिफ़ॉल्ट रूप से कॉम्पैक्ट टियर मिलता है; पूर्ण ~105-टूल सतह केवल ऑप्ट-इन है। टूल-सर्च अंतर को पाटता है इसलिए कुछ भी वास्तव में छिपा नहीं है।"
{
  "html": "<div class=\"xa-tiers\"><div class=\"diagram-card\" data-rough><span class=\"diagram-pill ok\">Compact / connector tier &middot; default</span><strong>~20&ndash;30 tools</strong><small class=\"diagram-muted\">Template-declared app actions + cross-app builtins (<code>list_apps</code>, <code>open_app</code>, <code>ask_app</code>, <code>create_embed_session</code>) + always-present <code>tool-search</code>.</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill accent\">Full tier &middot; opt-in</span><strong>~105 टूल</strong><small class=\"diagram-muted\">Explicit opt-in only: <code>--full-catalog</code> token or <code>AGENT_NATIVE_MCP_FULL_CATALOG=1</code>.</small></div></div><p class=\"diagram-muted note\"><code>tool-search</code> reaches any full-tier tool on demand &mdash; so the compact default keeps context small without hiding capability.</p>",
  "css": ".xa-tiers{display:flex;align-items:stretch;gap:14px;flex-wrap:wrap}.xa-tiers .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;flex:1;min-width:240px}.xa-tiers .diagram-arrow{align-self:center;font-size:24px;line-height:1}.xa-tiers .note{flex-basis:100%;margin:4px 0 0;font-size:.85em}.xa-tiers code{font-size:.85em}"
}
```

### कॉम्पैक्ट / कनेक्टर टियर (डिफ़ॉल्ट) {#connector-tier}

डिफ़ॉल्ट रूप से प्रत्येक कनेक्टेड एजेंट एक छोटा, क्यूरेटेड कैटलॉग देखता है (~20-30 टूल बनाम पूर्ण सतह में ~105):

- **टेम्पलेट-घोषित ऐप actions** — सुरक्षित ऐप-स्तरीय अनुमति-सूची। योजना के लिए जो `create-visual-plan`, `get-visual-plan`, `share-resource`, `navigate`, `tool-search`, और समान है।
- **अंतर्निहित क्रॉस-ऐप टूल** - `list_apps`, `open_app`, `ask_app`, `create_embed_session`।
- **`tool-search`** हमेशा मौजूद रहता है, इसलिए सूची के बाहर की कोई भी चीज़ मांग पर उपलब्ध रहती है (नीचे देखें)।

सूची से बाहर के उपकरण - उदाहरण के लिए `db-exec`, `seed-*`, एक्सटेंशन सूट, ब्राउज़र-सत्र उपकरण और संदर्भ-एक्सरे उपकरण - विज्ञापित नहीं किए जाते हैं, और जब तक कॉल करने वाले ने पूरी सूची में शामिल नहीं किया है, तब तक उन पर कॉल को "अज्ञात टूल" के साथ अस्वीकार कर दिया जाता है। यह प्रत्येक कनेक्टेड एजेंट की संदर्भ विंडो को छोटा रखता है और फ़ुटगन को हटा देता है जो केवल एकल-किरायेदार स्थानीय विकास के लिए सुरक्षित हैं। कनेक्टर टियर सक्रिय है **जब भी कोई टेम्प्लेट `connectorCatalog` घोषित करता है** - यह किसी पर्यावरण चर के पीछे गेट नहीं किया जाता है।

`tool-search` दो तरीकों से काम करता है: इसे टूल नामों के पूर्ण मेनू और एक-पंक्ति विवरण (सस्ता, कोई स्कीमा नहीं) के लिए **कोई क्वेरी नहीं** के साथ कॉल करें, या पैरामीटर सारांश के साथ रैंक किए गए मिलान के लिए एक क्वेरी के साथ। इस प्रकार एक कॉम्पैक्ट क्लाइंट किसी भी पूर्ण-सतह टूल को खोजता है और लोड करता है जब उसे इसकी आवश्यकता होती है।

### पूर्ण स्तरीय (केवल स्पष्ट ऑप्ट-इन) {#full-tier}

पूर्ण ~105-टूल एक्शन सतह केवल स्पष्ट ऑप्ट-इन पर दो तरीकों से प्रस्तुत की जाती है:

- **प्रति टोकन** - `--full-catalog` के साथ टकसाल, जो JWT में `catalog_scope: "full"` दावा एम्बेड करता है। बाद के अनुरोध उस टोकन के लिए कॉम्पैक्ट फ़िल्टर को बायपास करते हैं:

  ```बैश
  npx @agent-native/core@latest कनेक्ट https://plan.agent-native.com --क्लाइंट कोडेक्स --फुल-कैटलॉग
  ```

- **प्रति परिनियोजन** - सभी कॉल करने वालों को पूर्ण सतह प्रदान करने के लिए `AGENT_NATIVE_MCP_FULL_CATALOG=1` (सर्वर प्रक्रिया env) सेट करें। इसका उपयोग एकल-किरायेदार द्वारा होस्ट किए गए उदाहरणों के लिए करें जो प्रति-टोकन ऑप्ट-अप के बिना पूर्ण सतह चाहते हैं।

### टेम्पलेट घोषणा {#catalog-declaration}

टेम्पलेट्स `createAgentChatPlugin` विकल्पों में अपने कनेक्टर कैटलॉग की घोषणा करते हैं:

```ts
export default createAgentChatPlugin({
  appId: "plan",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  connectorCatalog: [
    "create-visual-plan",
    "get-visual-plan",
    "list-visual-plans",
    "update-visual-plan",
    // … other safe app-level actions
    "set-resource-visibility",
    "share-resource",
    "upload-image",
    "navigate",
    "view-screen",
    "manage-automations",
    "tool-search",
  ],
});
```

अंतर्निहित क्रॉस-ऐप टूल (`list_apps`, `open_app`, `ask_app`,
`create_embed_session`, `create_workspace_app`, `list_templates`) हमेशा होते हैं
घोषित सूची की परवाह किए बिना शामिल किया गया।

## कनेक्ट होने के बाद आप क्या कर सकते हैं {#what-you-can-do}

एक बार जब आपका एजेंट कनेक्ट हो जाता है, तो प्रत्येक कॉलर को डिफ़ॉल्ट रूप से कॉम्पैक्ट कैटलॉग मिलता है
([Catalog tiers](#catalog-tiers) देखें) - कोड/एसटीडियो डेवलपर क्लाइंट, स्थानीय
CLI प्रॉक्सी, और Claude और ChatGPT जैसे चैट होस्ट। वह सतह है
टेम्पलेट-घोषित ऐप actions प्लस अंतर्निहित क्रॉस-ऐप क्रियाएं (`list_apps`,
`open_app`, `ask_app`, and the app-only embed helper). Use `ask_app` to route a
एक ऐप एजेंट के माध्यम से प्राकृतिक-भाषा कार्य (समान क्रॉस-ऐप प्रविष्टि बिंदु
[A2A](/docs/a2a-protocol) उपयोग)। `tool-search` हमेशा मौजूद रहता है, इसलिए कोई भी टूल
कॉम्पैक्ट सूची के बाहर मांग पर पहुंच योग्य रहती है। संपूर्ण ~105-टूल
सामने की सतह, `--full-catalog` या
`AGENT_NATIVE_MCP_FULL_CATALOG=1`. सभी मामलों में, एजेंट से वास्तविक कार्य करने के लिए कहें
और यह सीधे चल रहे ऐप में एक लिंक भेजता है:

```
> draft an email to John about the Q3 report

Claude Code calls: manage-draft(to: "john@example.com", subject: "Q3 Report", body: "…")
→ Open draft in Mail → https://mail.agent-native.com/_agent-native/open?app=mail&view=inbox&compose=…
```

उस लिंक पर क्लिक करें और मेल पुनर्स्थापित ड्राफ्ट के साथ खुलता है - ठीक उसी स्थान पर केंद्रित है जहां आप, लॉग-इन उपयोगकर्ता हैं। एजेंट को कभी भी आपके सत्र के बारे में जानने की ज़रूरत नहीं पड़ी; इसने सिर्फ कलाकृतियों का निर्माण किया।

### MCP ऐप्स अनुकूलता {#mcp-apps-compatibility}

एजेंट-नेटिव ऐप्स आधिकारिक MCP ऐप्स एक्सटेंशन भी बोलते हैं। जब कोई क्रिया
`mcpApp` घोषित करता है, सर्वर विज्ञापन देता है
`extensions["io.modelcontextprotocol/ui"]`, में `_meta.ui.resourceUri` /
`tools/list` में `_meta["ui/resourceUri"]`, और HTML UI के माध्यम से कार्य करता है
`resources/list` + `resources/read` `text/html;profile=mcp-app` के रूप में। संसाधन
सुरक्षा मेटाडेटा जैसे CSP और सैंडबॉक्स अनुमतियाँ संसाधन पर रहती हैं
प्रविष्टियां और `resources/read` सामग्री, टूल डिस्क्रिप्टर पर नहीं।

ChatGPT/Claude-शैली OAuth ऐप होस्ट के लिए, खोज सतह डिफ़ॉल्ट रूप से कॉम्पैक्ट है: `tools/list` और `resources/list` प्रत्येक क्रिया-विशिष्ट MCP ऐप संसाधन के बजाय सामान्य `open_app` एम्बेड पथ का विज्ञापन करते हैं ([Catalog tiers](#catalog-tiers) देखें)। किसी व्यक्तिगत कार्रवाई को `mcpApp.compactCatalog: true` के साथ तभी चिह्नित करें जब उसे वास्तव में चैट-होस्ट खोज में दृश्यमान रहने की आवश्यकता हो।

यह प्रति-क्लाइंट शिम बनाने के बजाय प्रत्येक संगत होस्ट के लिए समान ऐप सतह उपलब्ध कराता है। कौन सा होस्ट MCP ऐप्स इनलाइन प्रस्तुत करता है (और मेटाडेटा परिवर्तन के बाद कनेक्टर-कैश गोचा) [MCP Apps → Client support and caching](/docs/mcp-apps#client-support) में रहता है - वह पेज क्लाइंट मैट्रिक्स के लिए एकल होम है।

व्यवहार में, प्रत्येक एजेंट-नेटिव ऐप को दोनों के साथ लिखा जाना चाहिए: सक्षम होस्ट में इनलाइन समीक्षा/संपादन के लिए MCP ऐप्स, और पूर्ण ऐप पर यूनिवर्सल राउंड-ट्रिपिंग के लिए `link`। CLI/कोड-एडिटर क्लाइंट जो आईफ्रेम प्रस्तुत नहीं करते हैं वे डीप लिंक पर वापस आ जाते हैं। मानव-चयन उपकरण उस फ़ॉलबैक में एक पेस्ट-बैक चरण जोड़ सकते हैं: उदाहरण के लिए, एसेट पिकर फ़ॉलबैक लिंक से खुलता है, उपयोगकर्ता को ब्राउज़र में मीडिया चुनने देता है, फिर एक हैंडऑफ़ सारांश कॉपी करता है जिसे उपयोगकर्ता चैट में वापस पेस्ट करता है।

### प्रथम श्रेणी MCP ऐप ब्रिज {#mcp-app-bridge}

`embedApp()` कार्रवाई के `link` लक्ष्य से शुरू होता है, एक अल्पकालिक एम्बेड सत्र बनाता है, और उस हस्ताक्षरित ऐप रूट को लॉन्च करता है। Claude वेब एकल-फ़्रेम ट्रांसप्लांट पथ का उपयोग करता है; ChatGPT को `window.openai` होस्ट APIs के साथ एक नियंत्रित रूट आईफ्रेम मिलता है। सभी पथ सामान्य React मार्ग प्रस्तुत करते हैं। सीधे हाइड्रेटेड मार्ग होस्ट ब्रिज के माध्यम से `ui/update-model-context`, `ui/message`, `ui/open-link`, और `ui/request-display-mode` पर कॉल करते हैं; ChatGPT पथ `agentNative.mcpHost.*` पोस्टमैसेज पर समान अनुरोधों को रिले करता है। `embedApp({ height })` डिफ़ॉल्ट रूप से `560px` पर और `320-900px` पर चिपक जाता है।

पूरे ब्रिज विवरण के लिए [MCP Apps](/docs/mcp-apps) देखें - ट्रांसप्लांट बनाम नियंत्रित-फ्रेम, एंबेड मोड, `ui/*` और पोस्टमैसेज टेबल, `embedStartUrl`, CSP नियम, एक्सटेंशन `srcDoc` एम्बेडिंग, ऊंचाई क्लैंपिंग, और संपूर्ण होस्ट ब्रिज क्लाइंट API।

### जेनेरिक क्रॉस-ऐप क्रियाएँ {#cross-app}

प्रति-क्रिया टूल के शीर्ष पर MCP सर्वर एक स्थिर क्रिया सेट को उजागर करता है, इसलिए एक बाहरी एजेंट के पास प्रति-ऐप कार्रवाई नामों का अनुमान लगाए बिना एक पूर्वानुमानित सतह होती है:

| उपकरण                                              | दुष्प्रभाव | रिटर्न                                                                                              |
| -------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `list_apps`                                        | कोई नहीं   | कार्यस्थान ऐप्स + उनकी URLs/चलने की स्थिति                                                          |
| `open_app({ app, view?, path?, params?, embed? })` | कोई नहीं   | एक गहरा लिंक या समान मूल मार्ग; `embed: true` जहां समर्थित है वहां पूर्ण ऐप इनलाइन प्रस्तुत करता है |
| `ask_app({ app, message })`                        | एजेंट लूप  | एक प्राकृतिक-भाषा कार्य को उस ऐप के इन-ऐप एजेंट (`ask-agent` को प्रतिनिधि) तक पहुंचाता है           |
| `create_workspace_app({ name, template })`         | मचान       | कार्यस्थान पथ के माध्यम से बूट किया गया एक नया ऐप, साथ ही इसका चल रहा URL + डीप लिंक                |
| `list_templates`                                   | कोई नहीं   | केवल अनुमति-सूचीबद्ध टेम्पलेट                                                                       |

`create_workspace_app` किसी भी गैर-अनुमति-सूचीबद्ध टेम्पलेट को अस्वीकार करता है - `packages/shared-app-config/templates.ts` में सार्वजनिक टेम्पलेट अनुमति-सूची आधिकारिक और सीआई-संरक्षित है; कोई बाहरी एजेंट इसे चौड़ा नहीं कर सकता. एक समान-नामित टेम्पलेट क्रिया एक बिल्टिन (टेम्पलेट-ओवर-कोर प्राथमिकता) को ओवरराइड करती है। `MCPConfig.builtinCrossAppTools: false` के साथ पूरे सेट को अक्षम करें।

ऐप होस्ट के लिए टूल और संसाधन कैटलॉग डिफ़ॉल्ट रूप से कॉम्पैक्ट होते हैं - [Catalog tiers](#catalog-tiers) देखें। `publicAgent.expose` उस कॉम्पैक्ट कैटलॉग के बाहर सुरक्षित पढ़ने/निगलने वाले टूल के लिए ऑप्ट-इन बना हुआ है; `mcpApp.compactCatalog: true` को केवल actions के लिए एक दुर्लभ अपवाद के रूप में सेट करें जिसे चैट-होस्ट डिस्कवरी में प्रदर्शित होना चाहिए।

तेज़ ChatGPT/Claude हैंडऑफ़ के लिए, आदर्श पथ सीधा है: उस क्रिया को कॉल करें जो आर्टिफैक्ट बनाता है या खोलता है, फिर MCP ऐप को रूट लॉन्च करने दें। एक मेल अनुरोध को `manage_draft` पर कॉल करना चाहिए और वास्तविक कंपोज़ रूट प्रस्तुत करना चाहिए। डैशबोर्ड अनुरोध को `open_app({ path, embed: true })` या `mcpApp` के साथ डैशबोर्ड कार्रवाई को कॉल करना चाहिए और संपूर्ण एनालिटिक्स रूट प्रस्तुत करना चाहिए। कैलेंडर, फॉर्म, सामग्री, स्लाइड, डिज़ाइन और क्लिप्स को अपने ड्राफ्ट/निर्माण/खोज actions के साथ समान पैटर्न का पालन करना चाहिए। `list_apps` तब उपयोगी होता है जब मॉडल को स्वीकृत ऐप्स में से चयन करना होता है; व्यापक `resources/list`, पूर्ण-कैटलॉग खोज, या `ask_app` प्रतिनिधिमंडल स्पष्ट UI हैंडऑफ़ के लिए सामान्य मार्ग नहीं होना चाहिए।

### प्रति-ऐप टूर {#tour}

प्रत्येक अनुमति-सूचीबद्ध टेम्पलेट जो एक नेविगेशन योग्य संसाधन का उत्पादन या सूचीबद्ध करता है, एक `link` बिल्डर को शिप करता है, और अंतर्ग्रहण-भारी वाले एक GET + `publicAgent` कार्रवाई को शिप करते हैं ताकि एक कनेक्टेड एजेंट लाइव स्थिति खींच सके:

- **मेल** — `manage-draft` एक `compose`-एन्कोडेड डीप लिंक लौटाता है; इसे क्लिक करने से इनबॉक्स खुल जाता है जिसमें ड्राफ्ट `compose-<id>` में पुनर्स्थापित हो जाता है। `list-emails` / `search-emails` फ़िल्टर किए गए इनबॉक्स दृश्य पर इंगित करें।
- **कैलेंडर** — `manage-event-draft` एक `calendarDraft` + `eventDraftId` डीप लिंक लौटाता है; इसे क्लिक करने से समीक्षा/भेजने के लिए मूल ईवेंट संपादक के साथ कैलेंडर पर एक दृश्यमान ड्राफ्ट प्लेसहोल्डर खुल जाता है। `create-event` अभी भी `buildDeepLink({ app: "calendar", view: "calendar", params: { eventId, date } })` लौटाता है; क्लिक कैलेंडर पर आता है और घटना उसकी तारीख पर केंद्रित होती है।
- **एनालिटिक्स** — `update-dashboard` / `save-analysis` रिटर्न `buildDeepLink({ app: "analytics", view: "adhoc", params: { dashboardId } })`; एजेंट MCP पर एक डैशबोर्ड बनाता है और "एनालिटिक्स में ओपन डैशबोर्ड" सौंपता है।
- **डिज़ाइन** - `get-design-snapshot` GET + `publicAgent` अंतर्ग्रहण कार्रवाई है: यह **लाइव** Yjs फ़ाइल सामग्री और साथ ही हल किए गए ट्विक मान लौटाता है ताकि एजेंट ट्यून किए गए डिज़ाइन से जारी रहे, न कि मूल टोकन से। `apply-tweaks` "ओपन डिज़ाइन" संपादक लिंक के साथ वापस राउंड-ट्रिप करता है।
- **सामग्री** - `pull-document` GET + `publicAgent` अंतर्ग्रहण क्रिया है: यह किसी भी खुले लाइव सहयोगी सत्र को पहले SQL में फ्लश करता है ताकि बाहरी एजेंट बिल्कुल वही ग्रहण कर सके जो उपयोगकर्ता देखता है, फिर दस्तावेज़ के लिए एक गहरा लिंक सामने लाता है।
- **ब्रेन** - `ask-brain` / `search-everything` एक उद्धृत उत्तर और अंतर्निहित ज्ञान/कैप्चर के लिए एक गहरा लिंक लौटाता है, इसलिए टर्मिनल एजेंट का लुक सीधे चल रहे ऐप में स्रोत में लिंक हो जाता है।

## लेखन (टेम्पलेट लेखकों के लिए) {#authoring}

उपरोक्त सब कुछ **अंतिम उपयोगकर्ताओं** के लिए है जो किसी ऐप को कनेक्ट कर रहे हैं और उसका उपयोग कर रहे हैं। इस पेज का बाकी हिस्सा **टेम्पलेट लेखकों** के लिए है जो एक अच्छा बाहरी-एजेंट नागरिक बनने के लिए एक ऐप तैयार कर रहा है: `link` बिल्डर, वैकल्पिक MCP ऐप्स UI, `/_agent-native/open` रूट इंटरनल्स, और actions को निगलना।

### `link` बिल्डर {#link-builder}

`defineAction` एक वैकल्पिक `link` बिल्डर स्वीकार करता है। सेट होने पर, उस टूल के लिए प्रत्येक MCP/A2A परिणाम एक मार्कडाउन `[label →](absoluteUrl)` ब्लॉक और एक संरचित `_meta["agent-native/openLink"] = { label, view, webUrl, desktopUrl, vscodeUrl }` को स्वचालित रूप से जोड़ता है। `tools/list` `annotations["agent-native/producesOpenLink"]` और एक विवरण प्रत्यय जोड़ता है ताकि बाहरी एजेंट को पता चले कि उपकरण एक खोलने योग्य लिंक देता है और उसे इसे सतह पर लाना चाहिए।

`buildDeepLink(...)` के साथ URL बनाएं - यह ओपन-रूट प्रारूप के लिए सत्य का एकल स्रोत है। `/_agent-native/open` URL को कभी भी हाथ से फ़ॉर्मेट न करें।

वास्तविक उदाहरण - मेल का `manage-draft` (`templates/mail/actions/manage-draft.ts`):

```ts
import { buildDeepLink } from "@agent-native/core/server";

function composeDeepLink(draft: Record<string, string>): string {
  return buildDeepLink({
    app: "mail",
    view: "inbox",
    compose: encodeComposerDraft(draft), // base64url JSON → compose-<id> draft
  });
}

export default defineAction({
  // ...schema, run...
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const draft = (result as { draft?: Record<string, string> }).draft;
    const id = (result as { id?: string }).id;
    if (!draft || !id) return null;
    return {
      url: composeDeepLink(draft),
      label: "Open draft in Mail",
      view: "inbox",
    };
  },
});
```

रिकॉर्ड-केंद्रित दृश्य पर actions बिंदु को उसी तरह सूचीबद्ध/खोजें - उदाहरण के लिए कैलेंडर का `create-event`, `"Open event in Calendar"` लेबल के साथ `buildDeepLink({ app: "calendar", view: "calendar", params: { eventId, date } })` लौटाता है। कैलेंडर ड्राफ्ट actions समान पैटर्न का उपयोग करता है: `manage-event-draft` लेबल `"Review invite in Calendar"` के साथ `buildDeepLink({ app: "calendar", view: "calendar", to: "/", params: { eventDraftId, calendarDraft, date } })` लौटाता है, ताकि बाहरी एजेंट पहले ईवेंट बनाए बिना सीधे ड्राफ्ट-समीक्षा लिंक वापस कर सकें।

### वैकल्पिक MCP ऐप्स UI {#mcp-apps}

Actions उन होस्ट के लिए `mcpApp` के साथ एक इनलाइन UI संसाधन का विज्ञापन कर सकता है जो MCP ऐप्स एक्सटेंशन का समर्थन करते हैं। सुविधा रैपर के रूप में `embedRoute({ title, openLabel, path })` का उपयोग करें, या सीधे `mcpApp.resource` को `embedApp(...)` असाइन करें। प्रत्येक MCP ऐप एक वास्तविक React रूट है, न कि एक अलग सादा-HTML विजेट। हमेशा `link` बिल्डर रखें - CLI-केवल होस्ट, पुराने क्लाइंट और गैर-MCP-ऐप्स होस्ट इसे फ़ॉलबैक के रूप में उपयोग करते हैं।

पूर्ण संलेखन मार्गदर्शिका के लिए [MCP Apps](/docs/mcp-apps) देखें - `embedRoute` बनाम `embedApp`, `mcpApp` कॉन्फिग आकार, CSP, ऊंचाई, `sendToAgentChat()` एम्बेड पथ और होस्ट ब्रिज क्लाइंट हेल्पर्स।

### `link` अनुबंध {#link-contract}

`link` बिल्डर **शुद्ध और सिंक्रोनस है - कोई I/O नहीं, कोई प्रतीक्षा नहीं**। यह सर्वोत्तम प्रयास से चलता है: एक थ्रो, `null`, या `undefined` निगल लिया जाता है और **कभी** टूल कॉल विफल नहीं होती है। यह केवल कॉल के `args` और `result` को पढ़ता है; इसे DB से पूछताछ नहीं करनी चाहिए, ऐप-स्टेट नहीं पढ़ना चाहिए, या अन्य actions को कॉल नहीं करना चाहिए। जब खोलने के लिए कुछ न हो तो `null` लौटाएँ।

`buildDeepLink({ app, view, params?, to?, compose? })` ऐप-सापेक्ष पथ `/_agent-native/open?app=…&view=…&<recordId>=…` लौटाता है। MCP परत इसे एक पूर्ण वेब URL (`toAbsoluteOpenUrl`, अनुरोध मूल का उपयोग करके), एक डेस्कटॉप `agentnative://open?…` URL (`toDesktopOpenUrl`), और `vscode://builder.agent-native/open?url=…` के लिए एक VS कोड एक्सटेंशन URL (`toVsCodeOpenUrl`) में बदल देती है; जब क्लाइंट `target: "desktop"` का संकेत देता है तो मार्कडाउन लिंक डेस्कटॉप URL का उपयोग करता है।

### `/_agent-native/open` मार्ग {#open-route}

जब उपयोगकर्ता किसी ब्राउज़र या इनलाइन वेबव्यू में लिंक पर क्लिक करता है, तो `GET /_agent-native/open` (`createOpenRouteHandler`, कोर रूट्स प्लगइन द्वारा माउंटेड) नीचे दिए गए चरणों को चलाता है।

```an-api
{
  "method": "GET",
  "path": "/_agent-native/open",
  "summary": "डीप-लिंक ओपन रूट - ब्राउज़र UI को रिकॉर्ड पर केंद्रित करता है",
  "description": "Resolves the browser session, writes a one-shot `navigate` application-state command scoped to that session, and 302-redirects to a safe same-origin path. Always build the URL with `buildDeepLink(...)`; never hand-format it. Can be disabled per app with `disableOpenRoute`.",
  "auth": "Browser session via `getSession`. The auth guard bypasses this exact path; if unauthenticated it serves login HTML at the same URL, and the form reload re-enters authenticated (no `?next=` plumbing).",
  "params": [
    { "name": "app", "in": "query", "type": "string", "description": "Target app id (e.g. `mail`)." },
    { "name": "view", "in": "query", "type": "string", "description": "View to focus; also folded into the `navigate` payload." },
    { "name": "to", "in": "query", "type": "string", "description": "Optional explicit same-origin relative redirect target. Falls back to `/<view>`, then a per-template `resolveOpenPath`." },
    { "name": "compose", "in": "query", "type": "string", "description": "base64url-encoded draft, decoded into a `compose-<id>` application-state key." },
    { "name": "f_*", "in": "query", "type": "string", "description": "Filter params forwarded to the redirect so lists/dashboards open pre-filtered." }
  ],
  "responses": [
    { "status": "302", "description": "Redirect to a safe same-origin relative path. Cross-origin, scheme-relative `//host`, and control-char redirects are rejected (open-redirect guard)." },
    { "status": "200", "description": "Login HTML served at the same URL when the browser session is unauthenticated." }
  ]
}
```

1. `getSession` के माध्यम से **ब्राउज़र** सत्र को हल करता है (ऑथ गार्ड सटीक पथ `/_agent-native/open` को बायपास करता है)।
2. यदि अप्रमाणित है, तो कॉन्फ़िगर किया गया लॉगिन HTML **उसी URL** पर कार्य करता है; फॉर्म का सफल हैंडलर `window.location` को पुनः लोड करता है, प्रमाणित मार्ग को फिर से दर्ज करता है - कोई `?next=` प्लंबिंग नहीं।
3. `requestSource: "deep-link"` के साथ ब्राउज़र सत्र के ईमेल के दायरे में मौजूद मौजूदा एक-शॉट `navigate` एप्लिकेशन-स्टेट कमांड (पेलोड = प्रत्येक गैर-आरक्षित क्वेरी पैरामीटर + `view`) लिखता है, और एक `compose` बेस 64url ड्राफ्ट को `compose-<id>` कुंजी में डीकोड करता है।
4. 302-एक सुरक्षित समान-मूल सापेक्ष पथ (`to=`, अन्यथा `/<view>`, अन्यथा एक प्रति-टेम्पलेट `resolveOpenPath`) पर रीडायरेक्ट करता है, `f_*` फ़िल्टर पैरामीटर को अग्रेषित करता है ताकि सूचियां/डैशबोर्ड `navigate` कमांड के खत्म होने से पहले ही पूर्व-फ़िल्टर होकर खुल जाएं।

क्रॉस-ओरिजिन, स्कीम-रिलेटिव `//host`, और कंट्रोल-चार रीडायरेक्ट अस्वीकार कर दिए गए हैं (ओपन-रीडायरेक्ट गार्ड)। मार्ग को `disableOpenRoute` के माध्यम से प्रति ऐप अक्षम किया जा सकता है।

#### ब्राउज़र-सत्र पहचान नियम {#identity-rule}

लिंक में **कोई विशेषाधिकार प्राप्त स्थिति नहीं** है - यह सिर्फ `view` + रिकॉर्ड आईडी + फिल्टर है। रिकॉर्ड-फ़ोकस `navigate` लेखन का दायरा उस व्यक्ति तक होता है जो **ब्राउज़र** में लॉग इन है, बाहरी एजेंट के MCP टोकन पर कभी नहीं। इसलिए एक पहचान के रूप में प्रमाणित एक एजेंट उपयोगकर्ता को एक लिंक दे सकता है, और जब वह उपयोगकर्ता उस पर क्लिक करता है तो रिकॉर्ड खुल जाता है जहां _उपयोगकर्ता_ लॉग इन होता है। यही वह चीज़ है जो डीप लिंक को टर्मिनल या चैट ट्रांसक्रिप्ट में सतह पर सुरक्षित बनाती है। इस ब्रिज के लिए `navigate` / `application_state` अनुबंध के लिए [Context Awareness](/docs/context-awareness) देखें।

### actions निगलें {#ingest}

लाइव ऐप स्थिति को अपने संदर्भ में खींचने के लिए बाहरी एजेंट द्वारा पढ़ी जाने वाली कार्रवाई यह होनी चाहिए:

```ts
export default defineAction({
  description: "…",
  schema: z.object({ id: z.string() }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ id }) => {
    /* read LIVE state, not the stale DB snapshot column */
  },
});
```

`GET` + `readOnly` क्रिया को दुष्प्रभाव-मुक्त और स्क्रीन-रिफ्रेश परिवर्तन इवेंट से बाहर रखता है। `publicAgent` **स्पष्ट ऑप्ट-इन** है - एक सार्वजनिक वेब रूट का तात्पर्य कभी भी सार्वजनिक MCP/A2A एक्सपोजर नहीं है; [Actions](/docs/actions) देखें। डिज़ाइन/सामग्री actions MUST को पढ़ें **लाइव** स्थिति (Yjs सहयोगी दस्तावेज़, पुराना DB स्नैपशॉट कॉलम नहीं) ताकि बाहरी एजेंट देख सके कि उपयोगकर्ता के पास वास्तव में स्क्रीन पर क्या है। सामग्री का `pull-document` किसी भी खुले लाइव कोलाब सत्र को पहले SQL पर फ्लश करता है; डिज़ाइन का `get-design-snapshot` लाइव Yjs फ़ाइल सामग्री और उपयोगकर्ता द्वारा हल किए गए ट्विक मान लौटाता है।

## उन्नत: स्थानीय विकास और मैन्युअल सेटअप {#advanced}

ऊपर होस्ट किया गया `connect` प्रवाह अनुशंसित पथ है। नीचे दिए गए विकल्प स्थानीय विकास और हाथ से तैयार किए गए सेटअप के लिए हैं।

### स्थानीय विकास {#local-dev}

अपना ऐप स्थानीय रूप से चलाएं (`pnpm dev` / `npx @agent-native/core@latest dev`), फिर एक आदेश के साथ उस पर एक स्थानीय एजेंट को इंगित करें:

```bash
npx @agent-native/core@latest mcp install --client claude-code|claude-code-cli|codex|cowork \
  [--app <id>] [--scope user|project]
```

यह एक टोकन का प्रावधान करता है (स्थानीय विकास के लिए कार्यक्षेत्र `.env` में एक यादृच्छिक `ACCESS_TOKEN`, या यदि यह एक होस्टेड मूल का पता लगाता है तो एक हस्ताक्षरित JWT) और एक इडेम्पोटेंट stdio सर्वर प्रविष्टि लिखता है:

- **क्लाउड-कोड / क्लाउड-कोड-सीएलआई** - `.mcp.json` (प्रोजेक्ट स्कोप, डिफ़ॉल्ट) या `~/.claude.json` (`--scope user`) में एक `mcpServers` प्रविष्टि।
- **सहकर्मी** - `~/.cowork/mcp.json` में समान Claude कोड JSON आकार।
- **कोडेक्स** - `~/.codex/config.toml` में एक `[mcp_servers.<name>]` ब्लॉक।

प्रविष्टि `npx @agent-native/core@latest mcp serve --app <id>` चलाती है, जो डिफ़ॉल्ट रूप से चल रहे स्थानीय ऐप के `/_agent-native/mcp` के लिए एक **पतली stdio प्रॉक्सी** है - इसलिए लाइव एक्शन रजिस्ट्री, HMR और सही डीप लिंक सत्य का एकल स्रोत बने रहते हैं। इसके बजाय प्रक्रिया में रजिस्ट्री बनाने के लिए `--standalone` पास करें। जब `npx @agent-native/core@latest mcp install` एक होस्टेड मूल (कार्यस्थान `.env` में एक गैर-लोकलहोस्ट `APP_URL` / `BETTER_AUTH_URL` / `AGENT_NATIVE_MCP_URL`) का पता लगाता है, तो यह एक stdio प्रविष्टि के बजाय `Bearer` JWT के साथ `<origin>/_agent-native/mcp` की ओर इशारा करते हुए एक `http` क्लाइंट प्रविष्टि लिखता है।

सहयोगी उपकमांड:

| कमांड                                                      | यह क्या करता है                                                               |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `npx @agent-native/core@latest mcp serve [--app <id>]`     | MCP stdio ट्रांसपोर्ट चलाएं (क्लाइंट कॉन्फिगरेशन क्या पैदा करता है)।          |
| `npx @agent-native/core@latest mcp install --client <c>`   | एक टोकन प्रदान करें + क्लाइंट का MCP कॉन्फिगरेशन लिखें (इडेम्पोटेंट)।         |
| `npx @agent-native/core@latest mcp uninstall --client <c>` | क्लाइंट के कॉन्फिगरेशन (इडेम्पोटेंट) से नामित MCP प्रविष्टि को हटा दें।       |
| `npx @agent-native/core@latest mcp status`                 | समाधान किए गए MCP URL/पोर्ट, टोकन स्थिति और प्रति-ग्राहक प्रविष्टियां दिखाएं। |
| `npx @agent-native/core@latest mcp token [--rotate]`       | कार्यस्थान `.env` में स्थानीय `ACCESS_TOKEN` को प्रिंट करें (या घुमाएँ)।      |

`install` के बाद क्लाइंट को पुनरारंभ करें ताकि यह नया MCP सर्वर उठा सके।

### मैन्युअल `.mcp.json` HTTP प्रविष्टि {#manual-entry}

आप MCP क्लाइंट कॉन्फिगरेशन को किसी भी तैनात एंडपॉइंट पर हाथ से एक टोकन के साथ लिख सकते हैं जो आप स्वयं प्रदान करते हैं (एक `ACCESS_TOKEN`, या एक `A2A_SECRET`-हस्ताक्षरित JWT जिसमें कॉलर का `sub` + `org_domain` होता है ताकि टूल टेनेंट-स्कोप्ड रहे):

```jsonc
// .mcp.json
{
  "mcpServers": {
    "analytics": {
      "type": "http",
      "url": "https://analytics.agent-native.com/_agent-native/mcp",
      "headers": { "Authorization": "Bearer <ACCESS_TOKEN-or-JWT>" },
    },
  },
}
```

यह `connect` आपके लिए जो लिखता है उसका अप्रबंधित समकक्ष है। पूर्ण प्रामाणिक env-var मैट्रिक्स के लिए [MCP Protocol](/docs/mcp-protocol) देखें।

### विकास बनाम उत्पादन उपकरण सतह {#dev-vs-prod}

सादे स्थानीय विकास (`NODE_ENV=development` और `AGENT_MODE !== "production"`) में MCP `tools/list` जानबूझकर केवल `publicAgent.requiresAuth === false` के साथ जेनेरिक बिल्टिन प्लस actions को उजागर करता है - प्रति-ऐप actions (`requiresAuth: true`) को निगलता है और actions (नहीं) को परिवर्तित करता है `publicAgent`) को फ़िल्टर किया जाता है (`filterPublicAgentActions`)। कॉम्पैक्ट कैटलॉग प्रमाणीकरण के बाद प्रत्येक कॉलर के लिए डिफ़ॉल्ट है - `agent-native` प्रॉक्सी, स्थानीय CLI और चैट-शैली रिमोट HTTP कॉलर्स का उपयोग करने वाले stdio/कोड क्लाइंट - इसलिए ChatGPT/Claude (या कोई भी क्लाइंट) बातचीत में एक विशाल पूर्ण एक्शन कैटलॉग को डंप नहीं कर सकता है। पूर्ण डेवलपर कैटलॉग केवल स्पष्ट ऑप्ट-इन (`--full-catalog` टोकन या `AGENT_NATIVE_MCP_FULL_CATALOG=1`) पर परोसा जाता है; `tool-search` इस बीच हर उपकरण को पहुंच योग्य रखता है।

### उत्पाद और विकास के बीच प्रथम-पक्ष ऐप्स को स्विच करना {#dev-switch}

जब आपके पास पहले से ही प्रथम-पक्ष होस्ट किए गए ऐप्स कनेक्ट हों और `pnpm dev:lazy` के माध्यम से स्थानीय फ्रेमवर्क परिवर्तनों का परीक्षण करना चाहते हों, तो डेवलपर स्विचर का उपयोग करें:

```bash
pnpm dev:lazy -- --apps mail,calendar,analytics

npx @agent-native/core@latest connect dev --apps mail,calendar,analytics --client codex
```

`connect dev` स्थानीय देव-आलसी गेटवे पर समान स्थिर MCP सर्वर नाम (`agent-native-mail`, `agent-native-calendar`, आदि) को फिर से लिखता है, इसलिए टूल नाम नहीं बदलते हैं। यह डेव प्रविष्टियाँ लिखने से पहले `~/.agent-native/connect-profiles.json` में वर्तमान उत्पादन प्रविष्टियों का बैकअप लेता है। डिफ़ॉल्ट गेटवे `http://127.0.0.1:8080` है; यदि आपका गेटवे स्थानांतरित हो गया है तो `--gateway <url>` या `--port <n>` का उपयोग करें।

इसके साथ वापस स्विच करें:

```bash
npx @agent-native/core@latest connect prod --apps mail,calendar,analytics --client codex
```

यदि `connect dev` मौजूदा कनेक्टेड JWT से आपके स्थानीय मालिक की पहचान का अनुमान नहीं लगा सकता है, तो `--owner-email you@example.com` पास करें; यह स्थानीय डेव टूल्स को विरल अप्रमाणित देव सतह के बजाय पूर्ण प्रमाणित MCP सतह पर रखता है।

## यह कैसे काम करता है और सुरक्षा {#how-it-works}

मानक OAuth पथ कभी भी MCP ऐप्स के लिए टोकन को उजागर नहीं करता है: होस्ट OAuth एक्सेस/रीफ्रेश टोकन संग्रहीत करता है और प्रमाणित MCP कनेक्शन पर टूल कॉल और `resources/read` में मध्यस्थता करता है। एंबेडेड आईफ्रेम ऐप डेटा और टूल परिणाम प्राप्त करते हैं, बियरर रहस्य नहीं।

पूर्ण-ऐप एम्बेड ब्राउज़र को MCP बियरर टोकन सौंपने से भी बचते हैं। MCP कॉलर SQL में एक बार एम्बेड टिकट बनाता है; आईफ्रेम लॉन्च रूट इसका उपभोग करता है और एक अल्पकालिक, आईफ्रेम-सुरक्षित ब्राउज़र सत्र कुकी सेट करता है। लैंडिंग URL में एक अस्थायी `__an_embed_token` क्वेरी पैरामीटर होता है जो क्लाइंट के लिए इसे कैप्चर करने, एड्रेस बार से हटाने और तृतीय-पक्ष कुकीज़ अवरुद्ध होने पर इसे समान-मूल `fetch` कॉल में संलग्न करने के लिए पर्याप्त होता है। एंबेड सत्र रूट-स्कोप वाले होते हैं; ऐप फ़ेच में वर्तमान एम्बेडेड लक्ष्य शामिल होता है, और सर्वर खनन किए गए रूट के बाहर टोकन के पुन: उपयोग को अस्वीकार कर देता है। ऐप पेज जानबूझकर `X-Frame-Options` या CSP `frame-ancestors` उत्सर्जित नहीं करते हैं, इसलिए Builder, डिज़ाइन और MCP ऐप होस्ट उन्हें आईफ्रेम कर सकते हैं। क्रॉस-ओरिजिनल पृथक होस्ट के लिए आवश्यकता पड़ने पर ब्राउज़र iframe नेविगेशन COEP/CORP में भी ऑप्ट इन करता है।

फ़ॉलबैक होस्ट किया गया `connect` प्रवाह कभी भी परिनियोजन के साझा रहस्य की प्रतिलिपि नहीं बनाता है। इसके बजाय:

- एक लॉग-इन ब्राउज़र सत्र एक **प्रति-उपयोगकर्ता, स्कोप्ड, रिवोकेबल** टोकन बनाता है - एक `A2A_SECRET`-हस्ताक्षरित JWT जिसमें कॉलर का `sub` + `org_domain` और एक अद्वितीय `jti` होता है, इसलिए प्रत्येक टूल रन `runWithRequestContext` के माध्यम से टेनेंट-स्कोप्ड रहता है।
- मौजूदा `/_agent-native/mcp` एंडपॉइंट किसी भी अन्य वाहक की तरह उस टोकन को स्वीकार करता है ([MCP Protocol](/docs/mcp-protocol) देखें) - कोई नया एंडपॉइंट नहीं, कोई नया ट्रांसपोर्ट नहीं।
- वही कनेक्ट पेज आपके द्वारा बनाए गए प्रत्येक टोकन को सूचीबद्ध करता है और आपको `jti` द्वारा उनमें से किसी को **निरस्त** करने देता है। उनके साथ व्यक्तिगत एक्सेस टोकन की तरह व्यवहार करें: प्रति एजेंट क्लाइंट के लिए एक, मशीन बंद होने पर रद्द कर दें।
- एजेंट जिस डीप लिंक को वापस सौंपता है उसमें कोई विशेषाधिकार प्राप्त स्थिति नहीं होती है। रिकॉर्ड-फ़ोकस करने वाला `navigate` लेखन हमेशा **ब्राउज़र** सत्र तक सीमित होता है, एजेंट का टोकन कभी नहीं - इसलिए एक लिंक टर्मिनल या चैट ट्रांसक्रिप्ट में पेस्ट करना सुरक्षित होता है।

## करें / न करें {#do-dont}

**करें**

- `npx @agent-native/core@latest connect https://dispatch.agent-native.com` के साथ प्रेषण के लिए अपने स्वयं के एजेंट को कनेक्ट करें; डायरेक्ट ऐप URL का उपयोग केवल तभी करें जब आपको एक अलग ऐप चाहिए।
- किसी भी कार्रवाई में एक `link` बिल्डर जोड़ें जो नेविगेशन योग्य संसाधन (ड्राफ्ट, ईवेंट, डैशबोर्ड, दस्तावेज़) तैयार या सूचीबद्ध करता है।
- `buildDeepLink(...)` के साथ URL बनाएं - ओपन-रूट प्रारूप के लिए सत्य का एकल स्रोत।
- `link` को शुद्ध और समकालिक रखें; जब खोलने के लिए कुछ न हो तो `null` लौटाएँ।
- बाहरी-एजेंट को actions GET + `readOnly` + `publicAgent` बनाएं और लाइव (Yjs) स्थिति पढ़ें, पुराने DB कॉलम को नहीं।
- खुले मार्ग को ब्राउज़र सत्र का समाधान करने दें; रिकॉर्ड आईडी को डीप-लिंक पैरामीटर के रूप में पास करें और UI को पोल किए गए `navigate` कमांड के माध्यम से उन पर ध्यान केंद्रित करने दें।
- एजेंट क्लाइंट के सेवामुक्त होने पर `jti` द्वारा खनन किए गए कनेक्ट टोकन को रद्द करें।
- `embedApp()` और आसपास हल्के फिक्स्चर के साथ MCP ऐप्स का परीक्षण करें
  `McpAppRenderer`; वे CSP, होस्ट संदर्भ, ऐप लॉन्च और ब्रिज
  वास्तविक बाहरी होस्ट की आवश्यकता के बिना संदेश व्यवहार।
- ChatGPT या Claude वेब को मान्य करते समय, शेल के बाद एक ताज़ा टूल कॉल ट्रिगर करें
  दृश्यमान iframe को बदलता है और मापता है।
  वही वार्तालाप अभी भी कैश्ड ऊंचाई या लॉन्च व्यवहार दिखा सकता है।
- ChatGPT/Claude ऐप-होस्ट कैटलॉग को कॉम्पैक्ट रखें। डिस्पैच और
  पूर्ण-ऐप पूर्वावलोकन के लिए `open_app({ embed: true })`; केवल एक विशिष्ट को चिह्नित करें
  कार्रवाई `mcpApp.compactCatalog: true` जब यह सीधे
  कॉम्पैक्ट होस्ट खोज सतह।

**नहीं**

- किसी परिनियोजन के साझा `ACCESS_TOKEN` / `A2A_SECRET` को क्लाइंट कॉन्फ़िगरेशन में कॉपी करें जब `connect` इसके बजाय प्रति-उपयोगकर्ता, प्रतिसंहरणीय टोकन बना सकता है।
- `/_agent-native/open` URL को हाथ से प्रारूपित करें - हमेशा `buildDeepLink` से गुजरें।
- क्या I/O, waits, DB पढ़ता है, या ऐप-स्टेट `link` बिल्डर के अंदर पढ़ता है।
- `navigate` लिखने का दायरा एजेंट टोकन पर रखें, या डीप लिंक के माध्यम से विशेषाधिकार प्राप्त स्थिति को पास करें - यह एक शुद्ध सूचक है।
- एक नए नेविगेशन तंत्र का आविष्कार; मौजूदा `navigate` / `application_state` अनुबंध पर पुल।
- किसी बाहरी एजेंट से किसी ऐप को जोड़ते समय सार्वजनिक टेम्पलेट अनुमति-सूची का विस्तार करें - अनुमति-सूची आधिकारिक और संरक्षित है।

## संबंधित {#related}

- [MCP Apps](/docs/mcp-apps) - MCP ऐप UIs, एंबेड ब्रिज और होस्ट ब्रिज API का लेखन।
- [MCP Protocol](/docs/mcp-protocol) - ऑटो-माउंटेड MCP सर्वर और `ask-agent` मेटा-टूल।
- [MCP Clients](/docs/mcp-clients) - सममित दिशा: आपका ऐप स्थानीय/दूरस्थ MCP सर्वर का उपभोग करता है।
- [A2A Protocol](/docs/a2a-protocol) - `ask-agent` मेटा-टूल और JSON-RPC सहकर्मी कॉल।
- [Actions](/docs/actions) - actions, `publicAgent`, GET / `readOnly` को परिभाषित करना।
- [Context Awareness](/docs/context-awareness) - `navigate` / `application_state` खुले मार्ग पुलों का अनुबंध करता है।
