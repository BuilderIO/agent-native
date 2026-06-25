---
title: "फ़ॉर्म"
description: "एजेंट-नेटिव फॉर्म बिल्डर - प्राकृतिक भाषा और एक विज़ुअल संपादक के माध्यम से फॉर्म सबमिशन बनाएं, संपादित करें, प्रकाशित करें और रूट करें।"
---

# फॉर्म

फॉर्म एक एजेंट-नेटिव फॉर्म बिल्डर है। अपने इच्छित फॉर्म का वर्णन करें, इसे संपादक में परिष्कृत करें, और एक सार्वजनिक फॉर्म प्रकाशित करें जो आपके अपने SQL डेटाबेस में सबमिशन संग्रहीत करता है।

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1.4px solid var(--wf-line)'><strong>बीटा साइनअप</strong><span class='wf-pill accent'>published</span><div style='flex:1'></div><button>साझा करें</button><button class='primary'>अप्रकाशित करें</button></div><div style='display:flex;gap:8px;padding:12px 16px;border-bottom:1.4px solid var(--wf-line)'><span class='wf-pill accent'>संपादित करें</span><span class='wf-pill'>परिणाम 187</span><span class='wf-pill'>सेटिंग्स</span><span class='wf-pill'>इंटीग्रेशन</span></div><div style='display:flex;flex-direction:column;gap:12px;padding:30px 78px;overflow:hidden'><h2 style='margin:0'>बीटा साइनअप</h2><p class='wf-muted' style='margin:0'>आने वाले private beta cohort में जगह आरक्षित करें।</p><div class='wf-card'><strong>पूरा नाम</strong><input value='Ada Lovelace'/></div><div class='wf-card'><strong>कार्य ईमेल</strong><input value='you@company.com'/></div><div class='wf-card'><strong>आपकी भूमिका</strong><input value='Select...'/></div><div class='wf-card'><strong>टीम का आकार</strong><input value='Select...'/></div></div></div>"
}
```

जब आप ऐप खोलते हैं, तो आपको अपने फॉर्म, वर्तमान संपादक और एक लाइव पूर्वावलोकन दिखाई देता है। एजेंट प्रॉम्प्ट से एक फॉर्म बना सकता है, फ़ील्ड लेबल और विकल्प अपडेट कर सकता है, सत्यापन बदल सकता है, और UI द्वारा उपयोग किए जाने वाले समान actions का उपयोग करके सबमिशन गंतव्यों को कनेक्ट कर सकता है।

```an-diagram title="निर्माण करें, प्रकाशित करें, संग्रह करें" summary="एजेंट और विज़ुअल एडिटर एक SQL-backed फॉर्म परिभाषा को संपादित करते हैं। सार्वजनिक भरण पृष्ठ अप्रमाणित है, और सबमिशन सर्वर-साइड को आपके गंतव्य तक ले जाता है।"
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">एजेंट प्रॉम्प्ट<br><small class=\"diagram-muted\">\"add an NPS question\"</small></div><div class=\"diagram-node\">विजुअल एडिटर<br><small class=\"diagram-muted\">लेबल, वैलिडेशन, क्रम</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">create-form · update-form</span><small class=\"diagram-muted\">fields JSON और settings JSON सेटिंग्स</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">forms table<br><small class=\"diagram-muted\">Drizzle के ज़रिए SQL</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">सार्वजनिक भरने वाला पेज<br><small class=\"diagram-muted\">unauthenticated</small></div><div class=\"diagram-box\">responses<br><small class=\"diagram-muted\">Slack / webhook / Sheets जोड़ें</small></div></div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## आप इसके साथ क्या कर सकते हैं

- **संवादात्मक रूप से फॉर्म बनाएं।** "एक संपर्क फ़ॉर्म बनाएं," "एक NPS स्कोर प्रश्न जोड़ें," "ईमेल फ़ील्ड को आवश्यक बनाएं।" एजेंट SQL-समर्थित स्थिति से फॉर्म स्कीमा और पूर्वावलोकन अपडेट अपडेट करता है।
- **विज़ुअली फाइन-ट्यून करें।** जब आप सीधे नियंत्रण चाहते हैं तो बिल्डर UI से लेबल, प्लेसहोल्डर, आवश्यक स्थिति, विकल्प और फ़ील्ड ऑर्डर संपादित करें।
- **शिप किए गए फ़ील्ड प्रकारों का उपयोग करें।** टेक्स्ट, ईमेल, संख्या, लंबा टेक्स्ट, चयन, बहु-चयन, चेकबॉक्स, रेडियो, दिनांक, रेटिंग और स्केल फ़ील्ड बॉक्स से बाहर समर्थित हैं।
- **प्रतिक्रियाएँ एकत्र करें।** प्रत्येक सबमिशन SQL में प्रति-प्रतिक्रिया विवरण दृश्य और प्रविष्टियों की समीक्षा के लिए एक डैशबोर्ड के साथ संग्रहीत किया जाता है।
- **रूट सबमिशन।** बिल्ट-इन इंटीग्रेशन का उपयोग करके webhooks, Slack, Discord, या Google शीट्स पर सबमिशन पेलोड भेजें।
- **सार्वजनिक फ़ॉर्म प्रकाशित करें।** एक सार्वजनिक फ़ॉर्म URL साझा करें और सबमिट करने के बाद एक धन्यवाद संदेश दिखाएं।

## आरंभ करना

लाइव डेमो: [forms.agent-native.com](https://forms.agent-native.com).

1. **प्रॉम्प्ट से एक फॉर्म बनाएं।** आप जो फॉर्म चाहते हैं, उसके लिए पूछें
   दर्शक और सबमिशन के बाद क्या होना चाहिए।
2. **संपादक में परिष्कृत करें।** लेबल, सत्यापन, विकल्प और क्रम समायोजित करें
   प्रत्यक्ष संपादन तेज होने पर विज़ुअल बिल्डर।
3. **प्रकाशित करें और साझा करें।** उत्तरदाताओं के लिए सार्वजनिक फॉर्म URL का उपयोग करें, फिर देखें
   परिणाम प्रतिक्रिया दृश्य में आते हैं।
4. **गंतव्यों को कनेक्ट करें।** नए सबमिशन को Slack, Discord, Google पर रूट करें
   शीट्स, webhooks, या आपका अपना एक्सटेंशन बिंदु।

### उपयोगी संकेत

- "भूमिका, टीम आकार और प्राथमिकता उपयोग के मामले के साथ एक बीटा साइनअप फॉर्म बनाएं।"
- "एक आवश्यक NPS प्रश्न और एक निःशुल्क-पाठ अनुवर्ती जोड़ें।"
- "उत्पाद Slack चैनल पर प्रत्येक नई प्रतिक्रिया पोस्ट करें।"
- "इस सप्ताह के सबमिशन को सारांशित करें और उन्हें ग्राहक खंड के अनुसार समूहित करें।"
- "रूटिंग के लिए आवश्यक फ़ील्ड खोए बिना इस फॉर्म को छोटा करें।"

## डेवलपर्स के लिए

इस दस्तावेज़ का शेष भाग फ़ॉर्म टेम्प्लेट की खोज करने वाले या उसका विस्तार करने वाले किसी भी व्यक्ति के लिए है।

### त्वरित शुरुआत

```bash
npx @agent-native/core@latest create my-forms --standalone --template forms
cd my-forms
pnpm install
pnpm dev
```

अन्य ऐप्स के साथ-साथ फ़ॉर्म वाले कार्यक्षेत्र के लिए:

```bash
npx @agent-native/core@latest create my-platform
```

कार्यस्थान सेटअप के दौरान इच्छित फ़ॉर्म और कोई अन्य टेम्पलेट चुनें।

### मुख्य विशेषताएं {#key-features}

**JSON फॉर्म परिभाषाएँ।** फ़ील्ड एक `fields` JSON कॉलम में रहते हैं, इसलिए एजेंट प्रत्येक फ़ील्ड प्रकार के लिए स्कीमा परिवर्तन के बिना सर्जिकल संपादन कर सकता है।

**सार्वजनिक रूप से पेज भरें।** उत्तरदाता अप्रमाणित फॉर्म जमा कर सकते हैं, जबकि डेटा ब्राउज़र तक पहुंचने से पहले निजी सेटिंग्स हटा दी जाती हैं।

**सर्वर-साइड गंतव्य।** Slack, डिस्कॉर्ड, Google शीट्स और वेबहुक एकीकरण फॉर्म सेटिंग्स में रहते हैं और सबमिशन के बाद चलते हैं।

### डेटा मॉडल

सभी डेटा Drizzle ORM के माध्यम से SQL में रहता है। स्कीमा: `templates/forms/server/db/schema.ts`. फॉर्म में मानक `ownableColumns` और एक मेल खाता फ्रेमवर्क शेयर तालिका होती है, इसलिए वे प्रति-उपयोगकर्ता/प्रति-संगठन साझाकरण मॉडल में फिट हो जाते हैं।

| तालिका        | इसमें क्या है                                                                                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forms`       | एक फॉर्म परिभाषा - `title`, `description`, अद्वितीय `slug`, `fields` (`FormField` की JSON सरणी), `settings` (JSON `FormSettings`), `status` (`draft` / `published` / `closed`), और एक सॉफ्ट-डिलीट `deleted_at` |
| `responses`   | प्रति पंक्ति एक सबमिशन - `form_id`, `data` (JSON `{ fieldId: value }`), `submitted_at`, वैकल्पिक `ip` और `submitter_email`                                                                                     |
| `form_shares` | फ्रेमवर्क टेबल मैपिंग प्रिंसिपलों (उपयोगकर्ताओं या संगठनों) को प्रति फॉर्म भूमिकाओं (दर्शक, संपादक, व्यवस्थापक) के साथ साझा करता है                                                                            |

`fields` और `settings` JSON आकृतियों को `templates/forms/shared/types.ts` (`FormField`, `FormSettings`) में परिभाषित किया गया है। किसी भी डेटा को `toPublicFormSettings` के माध्यम से सार्वजनिक भरण पृष्ठ तक पहुंचने से पहले मालिक-निजी सेटिंग्स जैसे एकीकरण वेबहुक URLs और अनुमत मूल हटा दिए जाते हैं।

```an-schema title="डेटा मॉडल बनाता है" summary="तीन टेबल। फ़ील्ड और एकीकरण प्रपत्रों पर JSON कॉलम हैं, इसलिए एजेंट के संपादन क्रॉस-टेबल पंक्ति परिवर्तनों के बजाय सर्जिकल पैच हैं।"
{
  "entities": [
    {
      "id": "forms",
      "name": "forms",
      "note": "A form definition (ownable)",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "title", "type": "string" },
        { "name": "description", "type": "string", "nullable": true },
        { "name": "slug", "type": "string", "note": "unique; public URL" },
        { "name": "fields", "type": "json", "note": "फॉर्मफ़ील्ड[] - सभी फ़ील्ड प्रकार" },
        { "name": "settings", "type": "json", "note": "फॉर्मसेटिंग्स - एकीकरण, आदि।" },
        { "name": "status", "type": "enum", "note": "ड्राफ्ट | प्रकाशित | बंद" },
        { "name": "deleted_at", "type": "datetime", "nullable": true, "note": "soft delete" },
        { "name": "owner_email", "type": "string" },
        { "name": "org_id", "type": "id", "nullable": true }
      ]
    },
    {
      "id": "responses",
      "name": "responses",
      "note": "प्रति पंक्ति एक सबमिशन",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "form_id", "type": "id", "fk": "forms.id" },
        { "name": "data", "type": "json", "note": "{ fieldId: value }" },
        { "name": "submitted_at", "type": "datetime" },
        { "name": "ip", "type": "string", "nullable": true },
        { "name": "submitter_email", "type": "string", "nullable": true }
      ]
    },
    {
      "id": "form_shares",
      "name": "form_shares",
      "note": "फ्रेमवर्क शेयर तालिका - प्रति फॉर्म भूमिकाओं के सिद्धांत",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "form_id", "type": "id", "fk": "forms.id" },
        { "name": "principal", "type": "string", "note": "user or org" },
        { "name": "role", "type": "enum", "note": "दर्शक | संपादक | व्यवस्थापक" }
      ]
    }
  ],
  "relations": [
    { "from": "forms", "to": "responses", "kind": "1-n", "label": "has responses" },
    { "from": "forms", "to": "form_shares", "kind": "1-n", "label": "has share grants" }
  ]
}
```

### कुंजी actions

प्रत्येक ऑपरेशन `templates/forms/actions/` में एक TypeScript फ़ाइल है, जो `POST /_agent-native/actions/:name` पर ऑटो-माउंटेड है:

- `create-form` - एक नया फॉर्म बनाएं (शीर्षक, विवरण, फ़ील्ड, सेटिंग्स)
- `update-form` - फ़ील्ड, सेटिंग्स या स्थिति अपडेट करें
- `get-form` - आईडी या स्लग द्वारा एक फॉर्म पुनर्प्राप्त करें
- `list-forms` - सुलभ प्रपत्रों की सूची
- `delete-form` - सॉफ्ट-डिलीट (`deleted_at` सेट करता है)
- `restore-form` - सॉफ़्ट-डिलीट किए गए फ़ॉर्म को पुनर्स्थापित करें
- `list-responses` - वैकल्पिक फ़िल्टर के साथ एक फॉर्म के लिए सबमिशन की सूची
- `export-responses` - प्रतिक्रियाओं को CSV या JSON के रूप में निर्यात करें

### इसे अनुकूलित करना

पहले एजेंट से शिप किए गए व्यवहार के बारे में पूछें:

- "पसंदीदा संपर्क विधि के लिए एक आवश्यक रेडियो फ़ील्ड जोड़ें।"
- "हर नए सबमिशन को Slack पर पोस्ट करें।" पहले [Messaging](/docs/messaging) के माध्यम से Slack को कनेक्ट करें।
- "हमारे CRM के लिए एक वेबहुक गंतव्य जोड़ें।"
- "1-10 पैमाने और एक लंबे पाठ अनुवर्ती के साथ एक ग्राहक फीडबैक फॉर्म बनाएं।"
- "कुछ फॉर्म सार्वजनिक करें और अन्य केवल लॉगिन के लिए।"

यदि आपको फ़ाइल अपलोड, हस्ताक्षर, या कस्टम फ़ील्ड विजेट जैसी नई क्षमताओं की आवश्यकता है, तो उन्हें टेम्पलेट एक्सटेंशन के रूप में मानें: SQL आकार, actions, UI संपादक नियंत्रण, सार्वजनिक रेंडरर समर्थन और एजेंट निर्देश एक साथ जोड़ें। मौजूदा बिल्ड पैटर्न के लिए [Creating Templates](/docs/creating-templates) देखें।

## आगे क्या

- [**Templates**](/docs/cloneable-saas) - क्लोन-एंड-ओन मॉडल
- [**Actions**](/docs/actions) - बिल्डर को शक्ति प्रदान करने वाली क्रिया प्रणाली
- [**Messaging**](/docs/messaging) - Slack और अन्य सबमिशन गंतव्य
