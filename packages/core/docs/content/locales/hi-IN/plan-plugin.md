---
title: "प्लान प्लगइन और मार्केटप्लेस"
description: "Agent-Native प्लान skills (/विजुअल-प्लान, /विजुअल-रीकैप) प्लस होस्टेड प्लान MCP कनेक्टर को Claude कोड या Codex प्लगइन के रूप में या यूनिवर्सल CLI के साथ इंस्टॉल करें। अपडेट कैसे काम करते हैं और क्या आपको कुछ भी सबमिट करने की आवश्यकता है।"
---

# प्लान प्लगइन और मार्केटप्लेस

Agent-Native **प्लान** ऐप एक इंस्टॉल करने योग्य बंडल के रूप में आता है। एक एकल इंस्टॉल प्लान स्लैश-कमांड skills ** दोनों को जोड़ता है और ** होस्ट किए गए प्लान MCP कनेक्टर को तार देता है, ताकि एजेंट प्लान तैयार कर सके और skills उन्हें सीधे प्लान ऐप में प्रकाशित कर सके।

## आपको क्या मिलता है {#what-you-get}

एक इंस्टॉल आपको देता है:

- **दो skills** - `/visual-plan` (विहित प्रवेश बिंदु) और `/visual-recap`।
- **प्लान MCP कनेक्टर** - `https://plan.agent-native.com` (MCP एंडपॉइंट `https://plan.agent-native.com/_agent-native/mcp`, सर्वर नाम `plan`) पर होस्ट किए गए ऐप के खिलाफ पंजीकृत है।

```an-diagram title="तीन मार्ग, एक बंडल" summary="यूनिवर्सल CLI, Claude Code प्लगइन, और Codex प्लगइन सभी समान दो कौशल और होस्टेड प्लान कनेक्टर स्थापित करते हैं।"
{
  "html": "<div class=\"diagram-routes\"><div class=\"diagram-col\"><div class=\"diagram-node\">Universal CLI<br><small class=\"diagram-muted\">skills add visual-plan</small></div><div class=\"diagram-node\">Claude Code प्लगइन<br><small class=\"diagram-muted\">/plugin install</small></div><div class=\"diagram-node\">Codex प्लगइन<br><small class=\"diagram-muted\">codex plugin add</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">/visual-plan</span><span class=\"diagram-pill accent\">/visual-recap</span><small class=\"diagram-muted\">two skills</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Plan MCP connector<br><small class=\"diagram-muted\">plan.agent-native.com/_agent-native/mcp</small></div></div>",
  "css": ".diagram-routes{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-routes .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-routes .diagram-arrow{font-size:22px;line-height:1}.diagram-routes .center{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}.diagram-routes .center .diagram-pill{margin:2px}"
}
```

डिफ़ॉल्ट रूप से, दोनों skills होस्ट किए गए प्लान ऐप पर प्रकाशित होते हैं - वे इसके माध्यम से एक प्लान बनाते हैं
MCP कनेक्टर और समीक्षा के लिए आपको एक लिंक या इनलाइन योजना सौंपें। वे कभी डंप नहीं करते
एक इनलाइन Markdown/ASCII योजना को चैट में डिलिवरेबल के रूप में पेश किया जाएगा। यदि एक योजना उपकरण
`needs auth`, `Unauthorized`, या `Session terminated` लौटाता है, पुनः प्रमाणित करें
कनेक्टर इनलाइन आउटपुट पर वापस आने के बजाय। एक्सेस टोकन हैं
दीर्घकालिक (30-दिन डिफ़ॉल्ट, स्लाइडिंग 365-दिन ताज़ा), इसलिए यह दुर्लभ होना चाहिए;
जब ऐसा होता है, तो हल्का समाधान यह होता है:

```bash
npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex
```

`reconnect` चयनित स्थानीय के लिए URL द्वारा कनेक्टर ढूंढता है और ताज़ा करता है
क्लाइंट - पुनः स्थापित करने की आवश्यकता नहीं है। पुनः कनेक्ट करने के बाद एक नया Codex थ्रेड प्रारंभ करें
टूल रजिस्ट्री पुनः लोड होती है। Claude कोड में, समतुल्य `/mcp` है →
**प्रमाणित करें / पुनः कनेक्ट करें**, या `--client claude-code` के साथ समान आदेश।

अपवाद स्पष्ट है **स्थानीय-फ़ाइलें गोपनीयता मोड**। जब आप कोई डीबी नहीं मांगते
`AGENT_NATIVE_PLANS_MODE=local-files` लिखें या सेट करें, skills को कॉल नहीं करना चाहिए
प्लान MCP कनेक्टर। वे `plans/<slug>/plan.mdx` प्लस वैकल्पिक
`canvas.mdx`, `prototype.mdx`, और `.plan-state.json`, फिर स्थानीय रूप से पूर्वावलोकन करें:

```bash
npx @agent-native/core@latest plan local serve --dir plans/<slug> --kind plan --open
```

यह एक छोटा लोकलहोस्ट ब्रिज शुरू करता है और लोकल के विरुद्ध प्लान UI खोलता है
फ़ोल्डर. (`plan local preview` इसके बजाय एक स्थानीय प्लान डेव-सर्वर रूट चलाता है, और
`plan local preview --out preview.html` एक लीगेसी एस्केप हैच है जो एक लिखता है
स्टैंडअलोन स्थिर HTML फ़ाइल। `plan serve` को
`plan local serve`.)

जानने लायक कुछ स्थानीय-फ़ाइल-मोड गेटचा:

- **क्रोमियम ब्राउज़र का उपयोग करें।** Safari होस्ट किए गए HTTPS प्लान पेज को ब्लॉक कर देता है
  `http://127.0.0.1` लोकलहोस्ट ब्रिज को पढ़ना (मिश्रित-सामग्री/निजी
  नेटवर्क), इसलिए पेज "लोडिंग योजना" पर लटका रहता है। MacOS `--open` पर पहले से ही
  क्रोम/क्रोमियम/एज/ब्रेव को प्राथमिकता देता है; यदि सफ़ारी किसी भी तरह खुलती है, तो मुद्रित को फिर से खोलें
  क्रोमियम ब्राउज़र में URL.
- **प्रदत्त URL को `plans/<slug>/.plan-url`** लिखा गया है (इसके साथ ओवरराइड करें
  `--url-file`). एक पृष्ठभूमि वाला या बिना नेतृत्व वाला एजेंट
  लंबे समय से चल रहे `serve` stdout को स्क्रैप करना। इसे एक स्थानीय टोकन फ़ाइल के रूप में मानें और
  ऐसा न करें।
- **कोई ब्राउज़र उपलब्ध न होने पर बिना सोचे-समझे सत्यापित करें**:
  `npx @agent-native/core@latest plan local verify --dir plans/<slug>` प्रारंभ होता है
  ब्रिज, प्राइवेट-नेटवर्क प्रीफ्लाइट और JSON पेलोड की जांच करता है, प्रिंट करता है
  निदान, और विफलता पर गैर-शून्य से बाहर निकलता है - किसी मानव आंख की आवश्यकता नहीं है।
- **पहले `plan local check` चलाएँ।** यह योजना के विरुद्ध MDX को मान्य करता है
  रेंडरर का ब्लॉक स्कीमा (`checklist` आइटम जैसे आवश्यक फ़ील्ड सहित
  `id`/`label` और `question-form` प्रश्न `id`/`title`/`mode`), इसलिए संलेखन
  गलतियाँ अटके हुए लोडर के बजाय ब्राउज़र हैंडऑफ़ से पहले सामने आती हैं।

वर्तमान रेपो में फ़ोल्डरों के लिए, प्रत्यक्ष स्थानीय मार्ग में `?path=...` शामिल है
स्थानीय प्लान ऐप ब्राउज़र संपादन को रेपो फ़ोल्डर में सहेज कर रख सकता है। योजना
ऐप `agent-native.json` में `apps.plan.roots[0].path` को डिफ़ॉल्ट स्थान के रूप में उपयोग करता है
प्रचारित स्थानीय योजनाओं को सहेजने के लिए, `plans/` पर वापस जाएं।

यह योजना सामग्री को Agent-Native योजना डेटाबेस से बाहर रखता है। होस्ट किया गया साझाकरण,
टिप्पणियाँ, स्क्रीनशॉट और योजना इतिहास तब तक अनुपलब्ध हैं जब तक आप स्पष्ट रूप से नहीं बता देते
बाद में प्रकाशित करें।

```an-diagram title="होस्टेड बनाम स्थानीय-फ़ाइलें मोड" summary="डिफ़ॉल्ट रूप से कौशल कनेक्टर के माध्यम से प्रकाशित होते हैं; लोकल-फ़ाइलें मोड डिस्क पर MDX लिखता है और इसके बजाय लोकलहोस्ट ब्रिज के माध्यम से पूर्वावलोकन करता है।"
{
  "html": "<div class=\"diagram-modes\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">डिफॉल्ट · होस्टेड</span><strong>Plan ऐप में प्रकाशित करें</strong><small class=\"diagram-muted\">MCP connector &rarr; hosted DB &rarr; share links, comments, history, screenshots</small></div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">स्थानीय फाइलों की गोपनीयता</span><strong>MDX को डिस्क पर लिखें</strong><small class=\"diagram-muted\">plan.mdx + canvas.mdx + prototype.mdx &rarr; localhost bridge &rarr; hosted Plan UI reads local source. No DB लेखनs until <code>publish-visual-plan</code>.</small></div></div>",
  "css": ".diagram-modes{display:flex;gap:14px;flex-wrap:wrap}.diagram-modes .diagram-card{flex:1 1 260px;display:flex;flex-direction:column;gap:6px;padding:16px 18px}"
}
```

Agent Native डेस्कटॉप में होस्ट की गई योजनाओं के लिए एक अलग स्थानीय-फ़ाइल सिंक पथ है:
डेस्कटॉप ऐप होस्ट किए गए प्लान को स्थानीय MDX फ़ाइलों में मिरर कर सकता है और संपादनों को वापस आयात कर सकता है
प्लान ऐप को क्लोन किए बिना या CLI चलाए बिना। वह वर्कफ़्लो होस्ट
सच्चाई के स्रोत के रूप में डेटाबेस की योजना बनाएं; लक्ष्य
क्या कोई प्लान डीबी नहीं लिखता है।

> प्लगइन (`agent-native-visual-plans`) में ऐप आईडी `visual-plans` है, यही कारण है कि Claude कोड प्लगइन नाम और Codex प्लगइन नाम दोनों `agent-native-visual-plans` हैं। प्लान ऐप का डिस्प्ले नाम "Agent-Native प्लान" है।

## मार्ग स्थापित करें {#install}

इसमें तीन तरीके हैं। **यूनिवर्सल CLI रूट** वह है जिसे हम डिफ़ॉल्ट रूप से अनुशंसित करते हैं, क्योंकि यह skills इंस्टॉल करता है **और** आपको एक प्रवाह में होस्टेड, लोकल-फ़ाइलें, या सेल्फ-होस्टेड मोड चुनने की सुविधा देता है। प्लगइन रूट प्रथम श्रेणी प्लगइन/मार्केटप्लेस सिस्टम वाले होस्ट के लिए हैं और डिफ़ॉल्ट रूप से होस्ट किए गए प्लान का उपयोग करते हैं।

### सार्वभौमिक कौशल मार्ग (कोई भी MCP होस्ट) {#universal}

किसी भी होस्ट के लिए काम करता है - Claude कोड, Codex, कर्सर, क्लाइन, गूज़, ChatGPT कस्टम MCP ऐप्स, Claude कोवर्क, और कुछ भी MCP-संगत। Agent-Native CLI दोनों skills को स्थापित करता है, होस्ट किए गए प्लान MCP कनेक्टर को पंजीकृत करता है, ** और एक ही चरण में चयनित स्थानीय क्लाइंट के लिए ऑथ चलाता है**, ताकि आपका पहला टूल कॉल OAuth दीवार से न टकराए:

```bash
npx @agent-native/core@latest skills add visual-plan
```

यह `visual-plan` प्लस साथी `visual-recap` कौशल स्थापित करता है, फिर `plan` कनेक्टर को पंजीकृत करता है, फिर ऑथ चलाता है (होस्टेड/खाता-समर्थित साझाकरण के लिए OAuth प्रॉम्प्ट)। उपयोगी झंडे:

- `--client codex|claude-code|claude-code-cli|cowork|all` - कौन से स्थानीय एजेंट MCP कॉन्फिगरेशन (डिफ़ॉल्ट `all`) के लिए लिखेंगे।
- `--no-connect` - प्रमाणीकरण के बिना कनेक्टर को पंजीकृत करें; बाद में `npx @agent-native/core@latest connect https://plan.agent-native.com --client all` चलाएँ, या एक संकीर्ण `--client` चुनें।
- `--mode hosted|local-files|self-hosted` - होस्टेड शेयरिंग, ऑल-लोकल MDX फ़ाइलें, या अपना खुद का प्लान ऐप चुनें।
- `--mcp-url <url>` - होस्ट किए गए डिफ़ॉल्ट के बजाय कनेक्टर को एक कस्टम मूल (एक ngrok सुरंग, एक स्थानीय डेव सर्वर, या एक स्व-होस्टेड परिनियोजन) पर इंगित करें।
- `--with-github-action` - पीआर विज़ुअल रिकैप GitHub एक्शन भी लिखें ([PR Visual Recap](/docs/pr-visual-recap) देखें)।

कोई वर्कफ़्लो न होने पर इंटरैक्टिव इंस्टाल पीआर विज़ुअल रिकैप एक्शन भी प्रदान करता है
वर्तमान। कौशल सेटअप के दौरान इसे जोड़ने के लिए हाँ कहें, या बाद में उपरोक्त कमांड चलाएँ
`--with-github-action` के साथ। वर्कफ़्लो लिखे जाने के बाद, चलाएँ:

```bash
npx @agent-native/core@latest recap setup
npx @agent-native/core@latest recap doctor
```

`recap setup` जहां संभव हो, GitHub एक्शन सीक्रेट्स और वेरिएबल्स को कॉन्फ़िगर करता है,
और `recap doctor` वर्कफ़्लो, स्थानीय प्रकाशन टोकन, GitHub रेपो का सत्यापन करता है
पहुँच, और आवश्यक Actions कॉन्फ़िगरेशन। इंस्टॉल समाप्त होने के बाद, पुनरारंभ करें या
एजेंट क्लाइंट को पुनः लोड करें ताकि नया skills और टूल लोड हो, फिर चलाएं
`/visual-plan`.

> नोट: बेयर `npx skills@latest add BuilderIO/agent-native --skill visual-plan` (वर्सेल/ओपन Skills CLI) **केवल निर्देश** स्थापित करता है - यह MCP कनेक्टर को पंजीकृत नहीं करता है। जब आप कनेक्टर को भी वायर्ड करना चाहते हैं तो ऊपर दिए गए Agent-Native CLI का उपयोग करें।

### Claude कोड (प्लगइन) {#claude-code}

सार्वजनिक `BuilderIO/agent-native` रेपो स्वयं एक Claude कोड प्लगइन मार्केटप्लेस है, इसलिए आप इसे सीधे जोड़ते हैं - कोई बिल्ड चरण नहीं। Claude कोड के अंदर:

```text
/plugin marketplace add BuilderIO/agent-native
/plugin install agent-native-visual-plans@agent-native-apps
/reload-plugins
/mcp        # authenticate the Plan connector (one OAuth approval)
```

`/plugin install` प्लान skills और **URL-केवल** MCP कॉन्फिगरेशन (पैकेज में कोई रहस्य नहीं) दोनों जोड़ता है; `/mcp` → **प्रमाणीकृत** OAuth हैंडशेक पूरा करता है। जब आप लोकल-फ़ाइलें या सेल्फ-होस्टेड मोड चाहते हैं तो इसके बजाय यूनिवर्सल CLI रूट का उपयोग करें।

> मार्केटप्लेस कैटलॉग का नाम `agent-native-apps` है और प्लान प्लगइन `agent-native-visual-plans` है, इसलिए इंस्टॉल लक्ष्य हमेशा `agent-native-visual-plans@agent-native-apps` है।

### Codex (प्लगइन) {#codex}

वही रेपो एक Codex प्लगइन मार्केटप्लेस है। इसे जोड़ें, प्लगइन इंस्टॉल करें, फिर कनेक्टर को प्रमाणित करें:

```bash
codex plugin marketplace add BuilderIO/agent-native
codex plugin add agent-native-visual-plans@agent-native-apps
codex mcp login plan   # OAuth ब्राउज़र में
```

इंस्टॉल करने के बाद, **एक नया Codex थ्रेड शुरू करें** ताकि skills और MCP टूल सत्र में लोड हो जाएं। प्लगइन एक URL-केवल कनेक्टर (`[mcp_servers.plan]` → `https://plan.agent-native.com/_agent-native/mcp`) शिप करता है; `codex mcp login plan` OAuth प्रवाह चलाता है। उपरोक्त सार्वभौमिक CLI मार्ग Codex (`npx @agent-native/core@latest skills add visual-plan --client codex`) के लिए भी काम करता है यदि आप एक कमांड पसंद करते हैं जो एक साथ स्थापित और प्रमाणित करता है, या जब आप स्थानीय-फ़ाइलें या स्वयं-होस्टेड मोड चाहते हैं।

> **पुराने इंस्टॉल:** यदि आपके कॉन्फिगरेशन में अभी भी URL पर इंगित करने वाली `agent-native-plans` प्रविष्टि है, तो Codex के लिए `npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex` चला रहा है, या आपके लक्ष्य `--client` के साथ एक ही कमांड चल रहा है, इसे कैनोनिकल `plan` नाम में समेकित करता है।

## अपडेट {#updates}

प्लगइन ऑटो-अपडेट को रूट करता है - आप नियमित कौशल परिवर्तनों के लिए मार्केटप्लेस को दोबारा पैक या दोबारा नहीं जोड़ते हैं:

- **Claude कोड** - मार्केटप्लेस प्रविष्टि `autoUpdate: true` सेट करती है और प्लगइन कमिट-SHA वर्जनिंग का उपयोग करता है, इसलिए Claude कोड स्टार्टअप पर रेपो से नए संस्करण खींचता है; सक्रिय करने के लिए `/reload-plugins` चलाएँ। रेपो की डिफ़ॉल्ट शाखा का प्रत्येक पुश स्वचालित रूप से इंस्टॉल किए गए उपयोगकर्ताओं तक पहुंचता है।
- **Codex** - प्लगइन `version` बंडल किए गए skills और MCP एंडपॉइंट (जैसे `1.0.0+codex.<hash>`) के कंटेंट हैश को एम्बेड करता है, इसलिए कोई भी कौशल या एंडपॉइंट परिवर्तन एक नया संस्करण उत्पन्न करता है। Codex का स्टार्टअप ऑटो-अपग्रेड कॉन्फ़िगर किए गए गिट मार्केटप्लेस को अपने आप पुनः इंस्टॉल करता है; परिवर्तन प्राप्त करने के लिए बस **एक नया थ्रेड प्रारंभ करें**। नियमित अपडेट के लिए किसी मैन्युअल `codex plugin marketplace upgrade` की आवश्यकता नहीं है।
- **यूनिवर्सल CLI रूट** - कॉपी किए गए कौशल फ़ोल्डरों की जांच करने के लिए `npx @agent-native/core@latest skills status visual-plan` चलाएं, या उन्हें जगह में ताज़ा करने के लिए `npx @agent-native/core@latest skills update visual-plan` चलाएं। `skills add visual-plan` को फिर से चलाना तब भी काम करता है जब आप कनेक्टर को फिर से पंजीकृत/प्रमाणीकृत करना चाहते हैं। `@latest` हमेशा प्रकाशित `@agent-native/core` पैकेज से वर्तमान skills को खींचता है।

कनेक्टर एक **होस्टेड** ऐप पर इंगित करता है, इसलिए प्लान ऐप की actions और लाइव टूल सतह हमेशा तैनात संस्करण को प्रतिबिंबित करती है, चाहे आपने इसे कब भी इंस्टॉल किया हो; केवल बंडल किए गए कौशल निर्देश उपरोक्त अद्यतन तंत्र का पालन करते हैं।

> **रखरखावकर्ता:** मार्केटप्लेस बंडल (`.claude-plugin/`, `.agents/plugins/`) `pnpm sync:plan-marketplace` द्वारा कैनोनिकल प्लान skills से तैयार किया गया है और `pnpm guard:plan-marketplace` द्वारा CI में सत्यापित किया गया है, इसलिए प्रकाशित मार्केटप्लेस हमेशा कैनोनिकल skills से मेल खाता है। कौशल संपादित करें, `pnpm sync:plan-marketplace` चलाएँ, और प्रतिबद्ध करें।

## क्या आपको कुछ भी सबमिट करने की आवश्यकता है? {#submission}

**इसे वितरित या स्थापित करने के लिए किसी सबमिशन या समीक्षा की आवश्यकता नहीं है।** `BuilderIO/agent-native` एक स्व-होस्टेड, सार्वजनिक गिट मार्केटप्लेस है, इसलिए उपयोगकर्ता इसे सीधे ऊपर दिए गए कमांड के साथ **Claude कोड और Codex** दोनों पर जोड़ते हैं - कोई आवेदन या अनुमोदन नहीं। सार्वभौमिक CLI मार्ग को किसी बाज़ार की आवश्यकता नहीं है।

यदि आप सार्वजनिक सूची चाहते हैं तो वैकल्पिक खोज योग्यता:

- **Claude कोड** में एक सामुदायिक बाज़ार है जिसे आप वैकल्पिक रूप से लिस्टिंग (प्रस्तुति और एक स्वचालित समीक्षा) के लिए सबमिट कर सकते हैं। आधिकारिक, एंथ्रोपिक-क्यूरेटेड मार्केटप्लेस एंथ्रोपिक के विवेक पर सूचीबद्ध है - कोई खुला स्व-सेवा एप्लिकेशन नहीं है। ऊपर दिए गए इंस्टॉल कमांड का उपयोग करना भी आवश्यक नहीं है।
- **Codex** में एक OpenAI-क्यूरेटेड प्लगइन कैटलॉग है (एक बंद अनुमति-सूची, स्व-सेवा सबमिशन के बजाय साझेदारी के रूप में सोर्स की गई)। स्व-होस्टेड गिट मार्केटप्लेस और CLI रूट को काम करने के लिए किसी सबमिशन की आवश्यकता नहीं है।

संक्षेप में: इसे स्व-होस्टेड/सार्वजनिक गिट बाज़ार के रूप में शिप करें और उपयोगकर्ता सीधे इंस्टॉल करें; किसी क्यूरेटेड कैटलॉग को केवल तभी सबमिट करें यदि आप उसे खोज के लिए सूचीबद्ध करना चाहते हैं।

## प्लगइन बनाम कौशल {#plugin-vs-skill}

ए **कौशल** एक एकल `SKILL.md` अनुदेश फ़ाइल है जिसे एजेंट किसी कार्य से मेल खाने पर पढ़ता है। एक **प्लगइन** (Claude कोड मार्केटप्लेस प्लगइन या Codex प्लगइन) एक पैकेज है जो एक या अधिक skills **प्लस** एक MCP कनेक्टर और मेटाडेटा को बंडल करता है, ताकि एक होस्ट एक चरण में सब कुछ इंस्टॉल कर सके।

हुड के तहत, सभी तीन रूट `npx @agent-native/core@latest app-skill` CLI द्वारा एक ही स्रोत से तैयार किए जाते हैं: `app-skill pack` मार्केटप्लेस/प्लगइन एडेप्टर बनाता है, और `skills add` फ्रेंडली वन-स्टेप इंस्टॉलर है जो MCP कनेक्टर को पंजीकृत और प्रमाणित भी करता है। ऐप-स्किल मेनिफेस्ट प्रारूप के लिए [Skills Guide](/docs/skills-guide) और किसी भी MCP होस्ट और `npx @agent-native/core@latest connect` प्रवाह को जोड़ने के लिए [External Agents](/docs/external-agents) देखें।

## आगे क्या {#whats-next}

- [**Visual Plans**](/docs/template-plan) - skills क्या करता है और उनका उपयोग कैसे करें
- [**PR Visual Recap**](/docs/pr-visual-recap) - प्रत्येक पुल अनुरोध पर स्वचालित रूप से `/visual-recap` चलाएं
- [**Skills Guide**](/docs/skills-guide) - ऐप-समर्थित skills और मेनिफेस्ट प्रारूप
- [**External Agents**](/docs/external-agents) - किसी भी MCP होस्ट और राउंड-ट्रिप कलाकृतियों को कनेक्ट करें
