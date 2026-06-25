---
title: "स्लाइड"
description: "प्रॉम्प्ट से डेक बनाएं, दृश्य रूप से संपादित करें, और पूर्ण-स्क्रीन प्रस्तुत करें। Google स्लाइड, पिच और पॉवरपॉइंट के लिए एक ओपन-सोर्स प्रतिस्थापन।"
---

# स्लाइड

प्रॉम्प्ट से पूर्ण प्रेजेंटेशन डेक तैयार करें, स्लाइड्स को दृश्य रूप से संपादित करें, और पूर्ण-स्क्रीन प्रस्तुत करें। एजेंट से "कॉफी सदस्यता सेवा के लिए 10-स्लाइड पिच डेक" के लिए पूछें और इसे सेकंडों में संपादक में स्लाइड-दर-स्लाइड स्ट्रीम करते हुए देखें। Google स्लाइड, पिच और पॉवरपॉइंट के लिए एक ओपन-सोर्स प्रतिस्थापन।

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:12px;padding:16px;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Q3 बोर्ड अपडेट</h1><span class='wf-pill accent'>शीर्षक स्लाइड</span><div style='flex:1'></div><button>Preview</button><button>Present</button><button class='primary'>साझा करें</button></div><main style='display:grid;grid-template-columns:1fr 220px;gap:12px;flex:1;min-height:0'><section class='wf-card' style='display:flex;align-items:center;justify-content:center;text-align:center;padding:36px'><div><strong style='font-size:28px'>Q3 बोर्ड अपडेट</strong><br/><small>माया चेन · CEO</small><div style='height:46px'></div><span class='wf-pill'>उत्पाद की गति</span></div></section><section style='display:flex;flex-direction:column;gap:10px'><div class='wf-card'><strong>स्लाइड रूपरेखा</strong><div class='wf-box'>1 शीर्षक</div><div class='wf-box'>2 एजेंडा</div><div class='wf-box'>3 मेट्रिक्स</div><div class='wf-box'>4 शिप्ड</div></div><div class='wf-card' style='flex:1'><strong>स्पीकर नोट्स</strong><p class='wf-muted' style='margin:8px 0 0'>लॉन्च प्रगति और रिटेंशन कहानी से शुरू करें।</p></div></section></main><div style='display:grid;grid-template-columns:repeat(5,1fr);gap:8px'><div class='wf-box'>1 शीर्षक</div><div class='wf-box'>2 एजेंडा</div><div class='wf-box'>3 मेट्रिक्स</div><div class='wf-box'>4 शिप्ड</div><div class='wf-box'>5 जोखिम</div></div></div>"
}
```

जब आप एक डेक खोलते हैं, तो स्लाइड कैनवास, रूपरेखा, नोट्स और फिल्मस्ट्रिप एक संपादक सतह पर रहते हैं जबकि एजेंट अभी भी actions के माध्यम से स्लाइड बना, संशोधित और नेविगेट कर सकता है।

```an-diagram title="डेक के लिए संकेत" summary="एक डेक के लिए पूछें और एजेंट एक समय में उन्हीं क्रियाओं के माध्यम से स्लाइड स्ट्रीम करता है जिन्हें आप CLI से कॉल कर सकते हैं।"
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-node\">प्रॉम्प्ट<br><small class=\"diagram-muted\">\"10-slide pitch deck\"</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">लेआउट चुनता है</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">create-deck</div><div class=\"diagram-pill\">add-slide &#215; n</div><small class=\"diagram-muted\">समानांतर, स्ट्रीमिंग</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>decks (SQL)</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box\">संपादक लाइव रेंडर करता है</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:6px;align-items:center}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## आप इसके साथ क्या कर सकते हैं

- **एक प्रॉम्प्ट से डेक बनाएं।** "कॉफी सदस्यता सेवा के लिए 10-स्लाइड पिच डेक बनाएं, दर्शक निवेशक हैं।"
- **स्लाइड को दृश्य रूप से संपादित करें** - संपादित करने के लिए टेक्स्ट पर डबल-क्लिक करें, बबल मेनू के लिए ब्लॉक पर क्लिक करें, ब्लॉक सम्मिलित करने के लिए स्लैश मेनू के लिए `/` का उपयोग करें।
- **एआई के साथ छवियां बनाएं।** हीरो छवियां, उत्पाद मॉकअप, चित्र - अधिमानतः एसेट्स को सौंपे गए, Builder-प्रबंधित छवि पीढ़ी के साथ एक बार तैनात होने और आज के फ़ॉलबैक के रूप में प्रदाता कुंजियों को सक्षम करने के लिए तैयार।
- **स्टॉक फ़ोटो और कंपनी लोगो खोजें।** "stripe.com के लिए लोगो ढूंढें और इसे स्लाइड 2 में जोड़ें।"
- **कीबोर्ड नेविगेशन, ऑटो-छिपाने के नियंत्रण और स्पीकर नोट्स के साथ पूर्ण-स्क्रीन प्रस्तुत करें**।
- **टिप्पणी करें, सहयोग करें और साझा करें।** कई लोग वास्तविक समय में एक ही डेक को संपादित कर सकते हैं। एक सार्वजनिक रीड-ओनली URL जेनरेट करें या विशिष्ट टीम साथियों के साथ साझा करें।
- **PDF से आयात करें।** एक PDF को स्टार्टर डेक में बदलें - एजेंट इसे पार्स करता है और सामग्री तैयार करता है।
- **अन्य प्रारूपों से आयात करें।** प्रारंभिक बिंदु के रूप में PPTX, DOCX, Google डॉक्स, GitHub रेपो, या किसी URL को आयात करें। PPTX, Google Slides, या HTML पर निर्यात करें।
- **डिज़ाइन सिस्टम लागू करें।** ब्रांड टोकन, कस्टम निर्देश और डिफ़ॉल्ट पैलेट डिज़ाइन सिस्टम के रूप में सहेजे जाते हैं और नए डेक पर लागू होते हैं।
- **पुराने संस्करणों को पुनर्स्थापित करें।** प्रत्येक डेक परिवर्तन का स्नैपशॉट लिया गया है; किसी भी पूर्व संस्करण को सूचीबद्ध करें या पुनर्स्थापित करें।

## आरंभ करना

लाइव डेमो: [slides.agent-native.com](https://slides.agent-native.com).

जब आप ऐप खोलते हैं:

1.  **नया डेक** पर क्लिक करें।
2.  एजेंट से पूछें: "कॉफी सदस्यता सेवा के लिए 10-स्लाइड पिच डेक तैयार करें, दर्शक निवेशक हैं।"
3.  स्लाइड्स को स्ट्रीम होते हुए देखें। संपादित करने के लिए किसी भी स्लाइड पर क्लिक करें, या एजेंट से परिष्कृत करने के लिए कहते रहें।

### उपयोगी संकेत

- "कॉफी सदस्यता सेवा के लिए 10-स्लाइड पिच डेक तैयार करें, दर्शक निवेशक हैं।"
- "स्लाइड 3 के बाद मूल्य निर्धारण स्लाइड जोड़ें।"
- "इस स्लाइड पर शीर्षक को बड़ा करें और उच्चारण का रंग बदलकर हरा कर दें।"
- "वर्तमान स्लाइड के लिए एक नायक छवि बनाएं - गहरा, न्यूनतम, सिनेमाई।"
- "stripe.com के लिए लोगो ढूंढें और इसे स्लाइड 2 में जोड़ें।"
- "इस डेक में हर जगह 'ग्राहक' शब्द को 'सदस्यों' से बदलें।"
- "इस PDF को 6-स्लाइड डेक के रूप में सारांशित करें।" (PDF संलग्न करें)

स्लाइड पर टेक्स्ट का चयन करें और उस चयन के साथ एजेंट पर ध्यान केंद्रित करने के लिए Cmd+I दबाएं - यह केवल आपके द्वारा चुने गए पर कार्य करेगा।

## डेवलपर्स के लिए

इस दस्तावेज़ का शेष भाग स्लाइड टेम्पलेट को फोर्क करने वाले या उसका विस्तार करने वाले किसी भी व्यक्ति के लिए है।

### त्वरित शुरुआत

CLI से एक नया स्लाइड ऐप बनाएं:

```bash
npx @agent-native/core@latest create my-slides --standalone --template slides
cd my-slides
pnpm install
pnpm dev
```

### मुख्य विशेषताएं {#key-features}

**प्रॉम्प्ट-टू-डेक जेनरेशन।** एक डेक के लिए पूछें और एजेंट स्ट्रीम संपादक में उसी क्रिएट और एडिट actions का उपयोग करके स्लाइड करता है जिसे आप स्वयं चला सकते हैं।

**संपादन योग्य स्लाइड कैनवास।** इनलाइन टेक्स्ट संपादन, स्लैश इंसर्ट, कोड संपादन, ड्रैग-एंड-ड्रॉप ऑर्डरिंग, पूर्ववत/पुनः करें, टिप्पणियाँ और प्रेजेंटेशन मोड सभी डेक सतह पर रहते हैं।

**आयात और निर्यात।** PPTX, DOCX, Google डॉक्स, PDF, URLs, और GitHub रेपो लाएं; PPTX, Google Slides, HTML, या किसी शेयर लिंक पर निर्यात करें।

**डिज़ाइन सिस्टम और मीडिया।** सहेजे गए ब्रांड सिस्टम, छवि निर्माण, स्टॉक खोज और लोगो लुकअप डेक को इच्छित दृश्य दिशा के करीब रखते हैं।

**सहयोग और इतिहास।** रीयल-टाइम Yjs संपादन, थ्रेडेड टिप्पणियाँ, शेयर भूमिकाएँ और डेक संस्करण स्नैपशॉट अंतर्निहित हैं।

### एजेंट के साथ काम करना

एजेंट चैट साइडबार में रहती है। यह डेक बना सकता है, अलग-अलग स्लाइड संपादित कर सकता है, चित्र बना सकता है, लोगो खोज सकता है और UI को नेविगेट कर सकता है - यह सब उसी actions का उपयोग करके किया जा सकता है जिसे आप CLI से चलाएंगे।

#### एजेंट क्या देखता है

जब कोई डेक खुला होता है, तो एजेंट स्वचालित रूप से देखता है:

- वर्तमान `deckId` और `slideIndex`।
- खुले डेक में स्लाइडों की पूरी सूची।
- वर्तमान में चयनित स्लाइड की HTML सामग्री।

इसे प्रत्येक संदेश में `current-screen` ब्लॉक के रूप में इंजेक्ट किया जाता है, इसलिए एजेंट को कभी भी यह अनुमान नहीं लगाना पड़ता है कि "इस स्लाइड" का क्या अर्थ है। डेटा `navigation` एप्लिकेशन-स्टेट कुंजी से आता है, जिसे UI प्रत्येक नेविगेशन पर लिखता है। `templates/slides/actions/view-screen.ts` देखें.

#### केंद्रित संपादनों के लिए पाठ का चयन करना

स्लाइड पर टेक्स्ट का चयन करें और पहले से लोड किए गए उस चयन के साथ एजेंट पर ध्यान केंद्रित करने के लिए Cmd+I दबाएं। एजेंट केवल आपके द्वारा चुने गए पर ही कार्य करेगा।

#### चैट में इनलाइन स्लाइड पूर्वावलोकन

एजेंट फ्रेमवर्क के एंबेड फेंस का उपयोग करके लाइव स्लाइड पूर्वावलोकन को सीधे चैट उत्तर में एम्बेड कर सकता है। यह `app/routes/slide.tsx` के माध्यम से एक क्रोमलेस आईफ्रेम प्रस्तुत करता है ताकि आप बातचीत छोड़े बिना परिणाम देख सकें।

### डेटा मॉडल

सभी डेक डेटा Drizzle ORM के माध्यम से SQL में रहते हैं। स्कीमा: `templates/slides/server/db/schema.ts`.

```an-schema title="डेटा मॉडल स्लाइड करता है" summary="A deck owns its slides as JSON in decks.data; comments, versions, shares, and design systems hang off it."
{
  "entities": [
    {
      "id": "decks",
      "name": "decks",
      "note": "Slides live as JSON in data; carries ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true, "note": "e.g. deck-1712345-abc" },
        { "name": "title", "type": "text" },
        { "name": "data", "type": "text", "note": "JSON: { title, slides: [{ id, content, layout }] }" },
        { "name": "created_at", "type": "text" },
        { "name": "updated_at", "type": "text" }
      ]
    },
    {
      "id": "slide_comments",
      "name": "slide_comments",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "deck_id", "type": "text", "fk": "decks.id" },
        { "name": "slide_id", "type": "text", "note": "टिप्पणी को स्लाइड करें" },
        { "name": "thread_id", "type": "text", "note": "सूत्रण" },
        { "name": "parent_id", "type": "text", "nullable": true },
        { "name": "content", "type": "text" },
        { "name": "quoted_text", "type": "text", "nullable": true },
        { "name": "author_email", "type": "text" },
        { "name": "author_name", "type": "text" },
        { "name": "resolved", "type": "boolean" }
      ]
    },
    {
      "id": "deck_versions",
      "name": "deck_versions",
      "note": "पुनर्स्थापना के लिए पॉइंट-इन-टाइम स्नैपशॉट",
      "fields": [
        { "name": "deck_id", "type": "text", "fk": "decks.id" },
        { "name": "title", "type": "text" },
        { "name": "data", "type": "text", "note": "पूर्ण डेक JSON" },
        { "name": "change_label", "type": "text", "nullable": true }
      ]
    },
    {
      "id": "design_systems",
      "name": "design_systems",
      "note": "Reusable brand tokens; ownableColumns",
      "fields": [
        { "name": "data", "type": "text", "note": "colors / typography / spacing" },
        { "name": "assets", "type": "text", "nullable": true },
        { "name": "custom_instructions", "type": "text", "nullable": true },
        { "name": "is_default", "type": "boolean" }
      ]
    },
    {
      "id": "deck_share_links",
      "name": "deck_share_links",
      "note": "लगातार सार्वजनिक शेयर-लिंक स्नैपशॉट",
      "fields": [
        { "name": "token", "type": "text", "pk": true },
        { "name": "title", "type": "text" },
        { "name": "slides", "type": "text", "note": "JSON स्लाइड स्नैपशॉट" },
        { "name": "aspect_ratio", "type": "text", "nullable": true },
        { "name": "created_at", "type": "text" }
      ]
    }
  ],
  "relations": [
    { "from": "decks", "to": "slide_comments", "kind": "1-n", "label": "comments" },
    { "from": "decks", "to": "deck_versions", "kind": "1-n", "label": "snapshots" }
  ]
}
```

फ़्रेमवर्क तालिकाओं (`deck_shares`, `design_system_shares`) को प्रति संसाधन दर्शक/संपादक/व्यवस्थापक भूमिकाओं के लिए मानचित्र सिद्धांतों को साझा करता है।

#### डेक

| कॉलम         | प्रकार | नोट्स                                                      |
| ------------ | ------ | ---------------------------------------------------------- |
| `id`         | पाठ    | प्राथमिक कुंजी, उदा. `deck-1712345-abc`                    |
| `title`      | पाठ    | डेक शीर्षक                                                 |
| `data`       | पाठ    | JSON ब्लॉब: `{ title, slides: [{ id, content, layout }] }` |
| `created_at` | पाठ    | टाइमस्टैम्प                                                |
| `updated_at` | पाठ    | टाइमस्टैम्प                                                |

प्रत्येक डेक में मानक `ownableColumns` (मालिक, दृश्यता, शेयर टोकन) भी होता है, इसलिए यह फ्रेमवर्क के शेयरिंग मॉडल में फिट हो जाता है।

#### स्लाइड_टिप्पणियाँ

| कॉलम                          | नोट्स                                    |
| ----------------------------- | ---------------------------------------- |
| `id`                          | प्राथमिक कुंजी                           |
| `deck_id`                     | पैरेंट डेक                               |
| `slide_id`                    | टिप्पणी को स्लाइड करें                   |
| `thread_id`, `parent_id`      | थ्रेडिंग                                 |
| `content`, `quoted_text`      | टिप्पणी का मुख्य भाग और वैकल्पिक पाठ अंश |
| `author_email`, `author_name` | लेखक                                     |
| `resolved`                    | बूलियन ध्वज                              |

#### डेक_शेयर

फ्रेमवर्क-प्रदत्त शेयर तालिका (`createSharesTable` के माध्यम से बनाई गई) जो प्रिंसिपलों (उपयोगकर्ताओं या संगठनों) को भूमिकाओं (दर्शक, संपादक, व्यवस्थापक) प्रति डेक पर मैप करती है।

#### डेक_संस्करण

एक डेक के पॉइंट-इन-टाइम स्नैपशॉट - `deck_id`, `title`, `data` (पूर्ण डेक JSON), और एक वैकल्पिक `change_label`। `list-deck-versions` / `restore-deck-version` द्वारा प्रयुक्त।

#### design_systems

पुन: प्रयोज्य ब्रांड टोकन - `data` (रंग/टाइपोग्राफी/स्पेसिंग), `assets`, `custom_instructions`, और एक `is_default` ध्वज। `ownableColumns` का उपयोग करता है ताकि डिज़ाइन सिस्टम को प्रति-उपयोगकर्ता या प्रति-संगठन साझा किया जा सके।

#### design_system_shares

डिजाइन सिस्टम के लिए फ्रेमवर्क शेयर तालिका, भूमिकाओं के लिए प्रिंसिपलों की मैपिंग (दर्शक, संपादक, व्यवस्थापक)।

#### डेक*शेयर*लिंक्स

`token` द्वारा कुंजीबद्ध लगातार सार्वजनिक शेयर-लिंक स्नैपशॉट। प्रत्येक पंक्ति एक `title`, एक JSON `slides` सरणी स्नैपशॉट, एक वैकल्पिक `aspect_ratio` और `created_at` संग्रहीत करती है। यहां लगातार शेयर लिंक का मतलब है कि वे सर्वर पुनरारंभ से बचे रहते हैं और सर्वर रहित इंस्टेंस पर काम करते हैं।

#### स्लाइड संरचना

`decks.data` के अंदर प्रत्येक स्लाइड है:

```json
{
  "id": "slide-1",
  "layout": "title",
  "content": "<div class=\"fmd-slide\" style=\"...\">...</div>"
}
```

`content` कच्चा HTML है - रेंडरर (`app/components/deck/SlideRenderer.tsx`) काली पृष्ठभूमि और निश्चित पहलू अनुपात प्रदान करता है, और HTML अंदर सब कुछ प्रदान करता है। रिच एम्बेडिंग भी समर्थित है: `ExcalidrawSlide.tsx` के माध्यम से एक्सकैलिड्रा आरेख और `MermaidRenderer.tsx` के माध्यम से मरमेड चार्ट।

### इसे अनुकूलित करना {#customizing}

स्लाइड्स टेम्प्लेट पूरी तरह से फोर्क करने योग्य है। इसका विस्तार करते समय ध्यान देने योग्य मुख्य स्थान:

#### Actions — `templates/slides/actions/`

प्रत्येक एजेंट-कॉल करने योग्य ऑपरेशन यहां TypeScript फ़ाइल के रूप में रहता है। कुछ जिन्हें आप अक्सर छूएंगे:

- `create-deck.ts` - स्क्रैच से नया डेक या थोक में बदलें।
- `add-slide.ts` - एक स्लाइड जोड़ें; स्ट्रीमिंग जेनरेशन के लिए इसे प्राथमिकता दें।
- `update-slide.ts` - सर्जिकल खोज/प्रतिस्थापन या पूर्ण सामग्री स्वैप।
- `view-screen.ts` - उपयोगकर्ता जो देखता है उसका स्नैपशॉट।
- `generate-image.ts`, `edit-image.ts`, `image-search.ts`, `logo-lookup.ts` — छवि टूलींग।
- `extract-pdf.ts` - PDF अंतर्ग्रहण।

प्रत्येक क्रिया `POST /_agent-native/actions/:name` पर ऑटो-माउंटेड है और CLI से `pnpm action <name>` के रूप में कॉल करने योग्य है। एजेंट को नई क्षमता देने के लिए यहां एक नई फ़ाइल जोड़ें।

#### मार्ग — `templates/slides/app/routes/`

- `_index.tsx` - डेक सूची।
- `deck.$id.tsx` - संपादक.
- `deck.$id_.present.tsx` — प्रेजेंटेशन मोड।
- `share.$token.tsx` - सार्वजनिक रीड-ओनली शेयर पेज।
- `slide.tsx` — चैट पूर्वावलोकन में सिंगल-स्लाइड एंबेड का उपयोग किया जाता है।
- `settings.tsx` — टेम्पलेट सेटिंग्स।
- `team.tsx` - संगठन और टीम प्रबंधन।

#### संपादक घटक — `templates/slides/app/components/editor/`

अधिकांश UI अनुकूलन यहां होता है: `SlideEditor.tsx`, `EditorToolbar.tsx`, `EditorSidebar.tsx`, बबल मेनू, स्लैश मेनू और छवि निर्माण, खोज और इतिहास के लिए पैनल।

#### Skills — `templates/slides/.agents/skills/`

एजेंट skills जो पैटर्न की व्याख्या करता है जब एजेंट को कोड को संशोधित करने की आवश्यकता होती है:

- `create-deck/` - स्लाइड के साथ एक नया डेक कैसे बनाएं।
- `slide-editing/` — अलग-अलग स्लाइडों को कैसे संपादित करें।
- `deck-management/` - डेक को कैसे संग्रहित और एक्सेस किया जाता है।
- `slide-images/` - छवि निर्माण और खोज वर्कफ़्लो।

#### AGENTS.md

`templates/slides/AGENTS.md` वह छोटा राउटर है जिसे एजेंट हर बातचीत पर पढ़ता है। यह `.agents/skills/` के अंतर्गत skills को इंगित करता है और मुख्य नियम, एप्लिकेशन-स्टेट अनुबंध और कौशल सूचकांक बताता है। हर लेआउट के लिए सटीक स्लाइड HTML टेम्पलेट `.agents/skills/create-deck/SKILL.md` में रहते हैं - जब भी आप स्लाइड लेआउट पैटर्न जोड़ते या बदलते हैं तो उस कौशल को अपडेट करें।

#### API मार्ग

ऐसे मामलों के लिए जहां actions सही फिट नहीं है (फ़ाइल अपलोड, स्ट्रीमिंग), टेम्पलेट REST एंडपॉइंट के एक छोटे सेट को उजागर करता है: `GET/POST /api/decks`, `GET/PUT/DELETE /api/decks/:id`। `templates/slides/server/routes/api/` देखें.
