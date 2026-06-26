---
title: "वीडियो"
description: "मोशन ग्राफिक्स, उत्पाद डेमो और काइनेटिक टेक्स्ट के लिए एक प्रोग्रामेटिक वीडियो स्टूडियो। एक प्रॉम्प्ट से एनिमेशन उत्पन्न करें और उन्हें टाइमलाइन पर ट्यून करें।"
---

# वीडियो

मोशन ग्राफिक्स, उत्पाद डेमो और काइनेटिक-टेक्स्ट वीडियो के लिए एक प्रोग्रामेटिक वीडियो स्टूडियो, जिसे हाथ से कीफ़्रेम करने में कठिनाई होती है। एजेंट से "6-सेकंड का लोगो प्रकट करने के लिए कहें जो 2 सेकंड में फीका पड़ जाए" और यह एनीमेशन बनाता है। टाइमिंग, सहजता को ट्यून करें, और कैमरा टाइमलाइन पर चलता है, फिर MP4 या WebM पर रेंडर करें।

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:12px;padding:16px;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>लोगो रिवील</h1><span class='wf-pill accent'>6 seconds</span><div style='flex:1'></div><button>Preview</button><button class='primary'>Render</button></div><div class='wf-card' style='flex:1;display:flex;align-items:center;justify-content:center;min-height:250px'><div style='text-align:center'><strong>Remotion पूर्वावलोकन</strong><br/><small class='wf-muted'>logo scales in as the title fades</small></div></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><div style='display:flex;gap:8px;align-items:center'><span class='wf-pill'>0s</span><span class='wf-pill'>2s</span><span class='wf-pill'>4s</span><span class='wf-pill'>6s</span><div style='flex:1'></div><button>नया ट्रैक</button></div><div class='wf-box'>शीर्षक फेड · 0-48 फ्रेम</div><div class='wf-box'>लोगो स्केल · 48-120 फ्रेम</div><div class='wf-box'>कैमरा पुश · 72-144 फ्रेम</div></div></div>"
}
```

जब आप स्टूडियो खोलेंगे, तो आपको होम स्क्रीन पर रचनाओं की एक सूची दिखाई देगी। एक पर क्लिक करें और आपको शीर्ष पर एक प्लेयर, नीचे एक टाइमलाइन और दाईं ओर एक प्रॉपर्टी पैनल मिलेगा। एजेंट को हमेशा पता होता है कि आपने कौन सी रचना खुली है।

```an-diagram title="डेटा के रूप में एनीमेशन" summary="एक रचना एक React घटक है; प्रत्येक एनीमेशन एक ट्रैक से पढ़ता है इसलिए एजेंट और टाइमलाइन उसी डेटा को संपादित करते हैं।"
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">Timeline<br><small class=\"diagram-muted\">खींचें, आकार बदलें, स्क्रब करें</small></div><div class=\"diagram-node\">Agent<br><small class=\"diagram-muted\">\"fade in at 2s\"</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">AnimationTrack</span><small class=\"diagram-muted\">startFrame / easing / animatedProps</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>React कंपोजिशन<br><small class=\"diagram-muted\">Remotion &lt;Player&gt;</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">MP4 / WebM</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## आप इसके साथ क्या कर सकते हैं

- **एक प्रॉम्प्ट से एनिमेशन उत्पन्न करें।** "एक शीर्षक कार्ड जोड़ें जो 2 सेकंड में फीका पड़ जाता है और 5 तक बना रहता है।" एजेंट रचना का संपादन करता है।
- **समयरेखा पर समय को ट्यून करें।**एनिमेशन ट्रैक को खींचें और आकार बदलें, फ़्रेम के माध्यम से स्क्रब करें, दृश्य रूप से आसान वक्र सेट करें।
- **कैमरे को एनिमेट करें।** ऑन-स्क्रीन टूल से पैन करें, ज़ूम करें और झुकाएं। टूल पर क्लिक करें, पूर्वावलोकन में खींचें, और एक कीफ़्रेम स्वतः बन जाता है।
- **एक रिक्त रचना या एक उदाहरण से शुरू करें।** टेम्पलेट शुरू करने के लिए एक इन-कोड रचना (`BlankComposition`) भेजता है; उदाहरण रचनाएँ - गतिज पाठ, लोगो प्रकट, कण विस्फोट, इंटरैक्टिव UI डेमो, स्लाइड शो - डेटाबेस से लोड करें, और आप अपना खुद का जोड़ सकते हैं।
- **इज़िंग कर्व्स को दृश्य रूप से संपादित करें।** 30+ कर्व्स भेजे गए - पावर, बैक, बाउंस, सर्क, इलास्टिक, एक्सपो, साइन, प्लस स्प्रिंग फिजिक्स।
- **कैमरा ज़ूम के दौरान क्रिस्प टेक्स्ट और वैक्टर के लिए 1x, 2x, या 3x सुपरसैंपलिंग पर MP4 या WebM** पर रेंडर करें।

यह अन्य टेम्प्लेट की तुलना में अधिक डेवलपर-स्वाद वाला टूल है - रचनाएँ React घटक हैं, इसलिए पावर उपयोगकर्ता (या एजेंट) स्क्रैच से पूरे नए एनीमेशन प्रकार लिख सकते हैं। लेकिन रोजमर्रा के बदलाव ("टाइपिंग धीमी करें," "कणों की गिनती 12 तक कम करें") सिर्फ चैट हैं।

## आरंभ करना

लाइव डेमो: [videos.agent-native.com](https://videos.agent-native.com).

जब आप स्टूडियो खोलते हैं:

1. होम स्क्रीन से एक रचना चुनें।
2. एजेंट को आज़माएं: "एक ऐसा लोगो जोड़ें जो 2 सेकंड में फीका पड़ जाए।" टाइमलाइन अपडेट देखें।
3. रीटाइम के लिए ट्रैक खींचें, कैमरा टूल पर क्लिक करें, प्लेयर को स्क्रब करें।

### उपयोगी संकेत

- "एक शीर्षक कार्ड जोड़ें जो 2 सेकंड में फीका पड़ जाए और 5 सेकंड तक बना रहे।"
- "फ़्रेम 60 और 90 के बीच लोगो पर 2x ज़ूम करने के लिए कैमरे को बदलें।"
- "टाइपिंग को धीमा बनाएं - 40% अधिक लंबा।"
- "कण विस्फोट बहुत सघन है। गिनती घटाकर 12 कर दें।"
- "इंट्रो-लूप नामक एक नई रचना बनाएं, 1080x1080, 6 सेकंड।"
- "बटन ज़ोन पर एक क्लिक एनीमेशन जोड़ें और उस पर कर्सर को एनिमेट करें।"
- "इस ट्रैक को ईज़-आउट के बजाय स्प्रिंग ईज़िंग दें।"

यदि आप टाइमलाइन में एक ट्रैक चुनते हैं और Cmd+I दबाते हैं, तो एजेंट उस चयन को चुनता है - "इसे अधिक तेज़ बनाएं" बस काम करता है।

## डेवलपर्स के लिए

इस दस्तावेज़ का शेष भाग वीडियो टेम्प्लेट बनाने या उसका विस्तार करने वाले किसी भी व्यक्ति के लिए है। यह टेम्प्लेट दूसरों की तुलना में अधिक कोड-फ़ॉरवर्ड है - प्रत्येक रचना एक React घटक है और प्रत्येक एनीमेशन एक ट्रैक पर डेटा है।

### आर्किटेक्चर

स्टूडियो में आप जो कुछ भी देखते हैं वह कोड है। एक रचना `app/remotion/registry.ts` में एक `CompositionEntry` है जो `app/remotion/compositions/` में एक React घटक की ओर इशारा करती है। उस घटक का प्रत्येक एनीमेशन `AnimationTrack` से पढ़ता है ताकि उपयोगकर्ता इसे टाइमलाइन UI में खींच सकें, आकार बदल सकें और पुनः टाइम कर सकें। एजेंट नई रचनाएँ बना सकता है, ट्रैक जोड़ सकता है, धुन आसान कर सकता है, और पूरे React घटकों को लिख सकता है जो रजिस्ट्री में प्लग होते हैं।

स्टूडियो पूर्वावलोकन के लिए रेमोशन के `<Player>` और अंतिम रेंडर के लिए रेमोशन CLI पर चलता है। 30fps पर आउटपुट डिफ़ॉल्ट रूप से 1920x1080 हो जाता है।

### त्वरित शुरुआत

CLI से एक नया वीडियो ऐप तैयार करें:

```bash
npx @agent-native/core@latest create my-video-app --standalone --template videos
cd my-video-app
pnpm install
pnpm dev
```

अपने ब्राउज़र में स्टूडियो खोलें, एक रचना बनाएं और रिक्त से प्रारंभ करें। एजेंट से कुछ ऐसा पूछें जैसे "एक लोगो जोड़ें जो 2 सेकंड में फीका पड़ जाए" और यह आपके लिए रचना को संपादित कर देगा।

### मुख्य विशेषताएं

**React-आधारित रचनाएँ।** वीडियो रेमोशन-समर्थित React घटक हैं, जिनमें SQL-समर्थित उपयोगकर्ता रचनाएँ और स्थानीय डिफ़ॉल्ट के लिए एक वैकल्पिक कोड रजिस्ट्री है।

**टाइमलाइन-पहला एनीमेशन।** अवधि ट्रैक, कीफ़्रेम, ईज़िंग कर्व्स, कैमरा मूव्स और प्रोग्रामेटिक एक्सप्रेशन ट्रैक सभी एक ही कंपोज़िशन डेटा को संपादित करते हैं।

**एडजस्टेबल मोशन सिस्टम।** पैरामीटर, कर्सर ट्रैक, इंटरैक्टिव होवर जोन, रेंज नेविगेशन और रिपीट प्लेबैक जेनरेट किए गए एनिमेशन को बिना कोड के ट्यून करने योग्य बनाते हैं।

**रेंडर और दृढ़ता।** रचना सेटिंग्स, गुणवत्ता, एफपीएस, ट्रैक मान और ओवरराइड प्रति रचना बनी रहती हैं और रिमोशन के माध्यम से MP4 या WebM पर प्रस्तुत होती हैं।

### एजेंट के साथ काम करना

एजेंट को हमेशा पता होता है कि आपने कौन सी रचना खोली है। नेविगेशन स्थिति (`{ view, compositionId }`) को फ्रेमवर्क की `application_state` तालिका में लिखा जाता है, और `view-screen` कार्रवाई इसे `app/remotion/registry.ts` पर इंगित करने वाले संकेत के साथ लौटाती है। आपको एजेंट को यह बताने की ज़रूरत नहीं है कि आप किस रचना पर हैं - उसे "इस पर" कार्रवाई करने के लिए कहें और वह ऐसा करेगा।

हुड के तहत एजेंट `navigate`, `save-composition`, और `generate-animated-component` जैसे actions को कॉल करता है। SQL-समर्थित रचना रिकॉर्ड `save-composition` के माध्यम से बनाए या अद्यतन किए जाते हैं; कोड-समर्थित रेमोशन घटक अभी भी `app/remotion/compositions/*.tsx` में मौजूद हैं और `app/remotion/registry.ts` में पंजीकृत हैं।

### डेटा मॉडल

सर्वर-साइड स्कीमा `templates/videos/server/db/schema.ts` में है:

```an-schema title="वीडियो डेटा मॉडल" summary="SQL-समर्थित रचनाएँ प्लस डिज़ाइन सिस्टम और नेस्टेबल फ़ोल्डर्स, प्रत्येक एक फ्रेमवर्क शेयर तालिका के साथ।"
{
  "entities": [
    {
      "id": "compositions",
      "name": "compositions",
      "note": "User-created compositions and overrides; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "title", "type": "text" },
        { "name": "type", "type": "text" },
        { "name": "data", "type": "text", "note": "पूर्ण रचना JSON ब्लॉब" },
        { "name": "created_at", "type": "text" },
        { "name": "updated_at", "type": "text" }
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
      "id": "folders",
      "name": "folders",
      "note": "Nestable folders; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "name", "type": "text" }
      ]
    },
    {
      "id": "folder_memberships",
      "name": "folder_memberships",
      "note": "अनेक-से-अनेक जुड़ते हैं",
      "fields": [
        { "name": "folder_id", "type": "text", "fk": "folders.id" },
        { "name": "composition_id", "type": "text", "fk": "compositions.id" }
      ]
    }
  ],
  "relations": [
    { "from": "folders", "to": "folder_memberships", "kind": "1-n", "label": "members" },
    { "from": "compositions", "to": "folder_memberships", "kind": "1-n", "label": "in folders" }
  ]
}
```

प्रत्येक तालिका में `createSharesTable()` द्वारा निर्मित एक मिलान फ्रेमवर्क शेयर तालिका (`composition_shares`, `design_system_shares`, `folder_shares`) भी है।

- `compositions` - आईडी, शीर्षक, प्रकार, `data` (पूर्ण रचना JSON ब्लॉब), स्वामित्व कॉलम, टाइमस्टैम्प।
- `composition_shares` - `createSharesTable()` द्वारा निर्मित मानक शेयर अनुदान।
- `design_systems` - `ownableColumns` के साथ पुन: प्रयोज्य ब्रांड टोकन (रंग, टाइपोग्राफी, रिक्ति, संपत्ति, कस्टम निर्देश, `is_default` ध्वज)।
- `design_system_shares` - डिज़ाइन सिस्टम के लिए शेयर अनुदान।
- `folders` - `ownableColumns` के साथ लाइब्रेरी संगठन के लिए नेस्टेबल फ़ोल्डर।
- `folder_shares` - फ़ोल्डरों के लिए अनुदान साझा करें।
- `folder_memberships` - `folder_id` और `composition_id` के बीच मैनी-टू-मैनी जुड़ते हैं।

### फ़ोल्डर और डिज़ाइन सिस्टम

रचनाओं को फ़ोल्डरों में व्यवस्थित किया जा सकता है और डिज़ाइन सिस्टम के साथ स्टाइल किया जा सकता है। Actions: `create-folder`, `rename-folder`, `delete-folder`, `move-composition-to-folder`। डिज़ाइन प्रणाली actions: `create-design-system`, `update-design-system`, `get-design-system`, `list-design-systems`, `set-default-design-system`, `apply-design-system`, `analyze-brand-assets`। आयात actions: `import-github`, `import-from-url`, `import-document` (DOCX/PPTX/PDF).

`app/remotion/registry.ts` में रजिस्ट्री टेम्पलेट के साथ जो भी भेजा जाता है उसके लिए सत्य का इन-कोड स्रोत है। SQL तालिका उपयोगकर्ता द्वारा बनाई गई रचनाओं और ओवरराइड को संग्रहीत करती है। स्टूडियो स्थिति (प्रति-कंपोज़िशन ट्रैक संपादन, प्रोप ओवरराइड, कंपोज़िशन सेटिंग्स) को `videos-tracks:<id>`, `videos-props:<id>`, और `videos-comp-settings:<id>` के तहत `localStorage` पर प्रतिबिंबित किया जाता है, और लोड पर रजिस्ट्री डिफॉल्ट्स पर गहराई से विलय कर दिया जाता है।

कोर TypeScript आकार (`app/types.ts`):

- `AnimationTrack` — `id`, `label`, `startFrame`, `endFrame`, `easing`, `animatedProps[]`.
- `AnimatedProp` - `property`, `from`, `to`, `unit`, प्लस वैकल्पिक `keyframes`, `programmatic`, `description`, `codeSnippet`, `parameters`, `parameterValues`।
- `CompositionEntry` — `id`, `title`, `description`, `component`, `durationInFrames`, `fps`, `width`, `height`, `defaultProps`, `tracks`.

रचनाएँ डिफ़ॉल्ट रूप से निजी होती हैं। दृश्यता `private`, `org`, या `public` हो सकती है, और शेयर अनुदान `viewer`, `editor`, या `admin` भूमिकाएँ देते हैं - फ्रेमवर्क के साझाकरण आदिम के माध्यम से वायर्ड।

### इसे अनुकूलित करना

टेम्पलेट फ़ोल्डर `templates/videos/` है (उपयोगकर्ता-सामना वाला स्लग `video` है, लेकिन फ़ोल्डर बहुवचन है)।

**Actions** — `templates/videos/actions/`

- `view-screen.ts` - एजेंट के लिए वर्तमान नेविगेशन स्थिति लौटाता है।
- `navigate.ts` - किसी रचना (`--compositionId <id>`) या होम व्यू (`--view home`) पर नेविगेट करें।
- `save-composition.ts` — SQL-समर्थित कंपोज़िशन रिकॉर्ड बनाएं या अपडेट करें।
- `generate-animated-component.ts` - बॉयलरप्लेट के साथ एक नई रेमोशन घटक फ़ाइल उत्पन्न करें।
- `validate-compositions.ts` - संरचनात्मक समस्याओं के लिए सभी पंजीकृत रचनाओं की जाँच करें।
- `list-compositions.ts`, `get-composition.ts`, `update-composition.ts`, `delete-composition.ts` - SQL-समर्थित रचना रिकॉर्ड पढ़ें, अपडेट करें और हटाएं।

**मार्ग** — `templates/videos/app/routes/`

- `_index.tsx` — स्टूडियो होम; शेल और संरचना सूची प्रस्तुत करता है।
- `c.$compositionId.tsx` - रचना संपादक (समयरेखा, प्लेयर, गुण पैनल)।
- `components.tsx` — घटक लाइब्रेरी ब्राउज़र।
- `team.tsx` — टीम प्रबंधन।

**रिमोशन इंटरनल्स** — `templates/videos/app/remotion/`

- `registry.ts` - आधिकारिक रचना सूची।
- `compositions/` - प्रति रचना एक `.tsx`, प्लस एक `index.ts` बैरल।
- `trackAnimation.ts` — `trackProgress`, `getPropValue`, `findTrack`, `getPropValueKeyframed`.
- `CameraHost.tsx` - कैमरा ट्रांसफ़ॉर्म के साथ कंपोज़िशन सामग्री को रैप करता है।
- `hooks/`, `ui-components/`, `components/` - इंटरैक्टिव तत्व सहायक, कर्सर रेंडरिंग, एनिमेटेड तत्व रैपर।

**स्टूडियो UI** — `templates/videos/app/components/`

- `Timeline.tsx` - पूरी तरह से नियंत्रित समयरेखा (`viewStart` / `viewEnd` का आंतरिक रूप से कोई राज्य नहीं है)।
- `VideoPlayer.tsx` - रेंज-बाधित प्लेबैक के साथ रेमोशन `<Player>` रैपर।
- `TrackPropertiesPanel.tsx`, `CompSettingsEditor.tsx`, `PropsEditor.tsx` - दाईं ओर के पैनल।
- `CameraToolbar.tsx`, `CameraControls.tsx` — कैमरा उपकरण और संख्यात्मक नियंत्रण।

**एजेंट निर्देश** — `templates/videos/AGENTS.md` वह लंबी-फ़ॉर्म मार्गदर्शिका है जिसे एजेंट पढ़ता है। इसमें एनिमेशन-एज़-ट्रैक नियम, कैमरा सिस्टम, कर्सर सिस्टम, CSS फ़िल्टर इकाइयाँ, इंटरैक्टिव घटक पंजीकरण, UI रिक्ति, और रचनाएँ बनाने या संपादित करने के लिए चेकलिस्ट शामिल हैं।

**Skills** — `templates/videos/.agents/skills/`

- `composition-management/SKILL.md` — रचनाएँ कैसे बनाएं और पंजीकृत करें।
- `animation-tracks/SKILL.md` - ट्रैक और एनिमेटेड प्रॉप्स को कैसे संपादित करें।
- साथ ही मानक ढांचा skills: `actions`, `self-modifying-code`, `delegate-to-agent`, `storing-data`, `security`, `frontend-design`, `create-skill`, `capture-learnings`।

नई रचना जोड़ने के लिए, `AGENTS.md` में चेकलिस्ट का पालन करें: घटक बनाएं, `FALLBACK_TRACKS` घोषित करें, `findTrack` / `trackProgress` / `getPropValue` (कभी हार्डकोड फ्रेम नहीं) का उपयोग करें, `compositions/index.ts` से निर्यात करें, रजिस्ट्री में एक `CompositionEntry` जोड़ें, और `pnpm typecheck` चलाएं।
