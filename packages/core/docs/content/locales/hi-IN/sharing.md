---
title: "साझाकरण एवं गोपनीयता"
description: "Google-डॉक्स-शैली साझाकरण, फ़्रेमवर्क में अंतर्निहित। प्रत्येक उपयोगकर्ता द्वारा निर्मित संसाधन - डॉक्स, डैशबोर्ड, डिज़ाइन, डेक, क्लिप, रिकॉर्डिंग, फॉर्म - को एक सुसंगत शेयर UI के साथ समान निजी-डिफ़ॉल्ट मॉडल मिलता है।"
---

# साझाकरण एवं गोपनीयता

प्रत्येक संसाधन जो उपयोगकर्ता एजेंट-नेटिव ऐप में बनाता है - एक दस्तावेज़, एक डैशबोर्ड, एक डिज़ाइन, एक डेक, एक वीडियो संपादन, एक स्क्रीन रिकॉर्डिंग, एक मीटिंग ट्रांसक्रिप्ट, एक फॉर्म, एक बुकिंग लिंक - **डिफ़ॉल्ट रूप से निर्माता के लिए निजी है**। अन्य लोग इसे तभी देखते हैं जब निर्माता इसे स्पष्ट रूप से साझा करता है, या इसकी दृश्यता को `org` या `public` में बदल देता है।

यह Google डॉक्स की तरह दिखता है और काम करता है। समान शेयर बटन, समान संवाद, समान त्रि-स्तरीय दृश्यता मॉडल, समान प्रति-उपयोगकर्ता/प्रति-संगठन अनुदान - हर टेम्पलेट में, बिना किसी प्रति-ऐप पुनर्निमाण के।

## एक मॉडल क्यों {#why}

अधिकांश ऐप फ़्रेमवर्क साझाकरण को प्रति-फ़ीचर प्रोजेक्ट बनाते हैं। परिणाम: प्रत्येक दस्तावेज़ जैसी सतह अपने स्वयं के शेयर संवाद, अपनी स्वयं की अनुमति स्कीमा, अपनी स्वयं की एक्सेस-चेक बग के साथ समाप्त होती है। एजेंट-नेटिव में, साझाकरण एक **फ्रेमवर्क आदिम** है। स्कीमा कॉलम, एक्सेस-चेक हेल्पर्स, शेयर पॉपओवर, और एजेंट-कॉल करने योग्य शेयर actions सभी कोर के साथ भेजे जाते हैं। एक नए टेम्पलेट में दो कॉलम और पंजीकरण की एक पंक्ति जोड़कर पूरी साझाकरण कहानी मिलती है।

इसका मतलब यह भी है कि एजेंट को कभी भी प्रति ऐप नया शेयरिंग मॉडल नहीं सीखना होगा। किसी भी टेम्पलेट में एजेंट को "इसे एक संपादक के रूप में ऐलिस के साथ साझा करें" बताएं और वही `share-resource` कार्रवाई सक्रिय हो जाती है।

## तीन दृश्यता स्तर {#visibility}

मोटी दृश्यता संसाधन पर ही रहती है; सुक्ष्म अनुदान एक साथी शेयर तालिका में रहते हैं।

| दृश्यता   | इसे कौन देख सकता है                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------- |
| `private` | मालिक + लोगों को स्पष्ट रूप से प्रदान किया गया। **प्रत्येक नए संसाधन के लिए डिफ़ॉल्ट.**                        |
| `org`     | मालिक + स्पष्ट अनुदान + एक ही संगठन में कोई भी (केवल पढ़ने के लिए)।                                            |
| `public`  | स्वामी + स्पष्ट अनुदान + लिंक वाला कोई भी व्यक्ति (केवल पढ़ने के लिए)। दूसरों की सूची/खोज में दिखाई नहीं देता। |

`public` एक जानबूझकर शांत स्तर है: एक सार्वजनिक संसाधन सीधे लिंक द्वारा पहुंचा जा सकता है, लेकिन यह अन्य उपयोगकर्ताओं के साइडबार, सूचियों या खोज में **नहीं** दिखाई देता है। यह "URL को साझा करने के लिए सार्वजनिक" को "क्रॉस-उपयोगकर्ता खोज के लिए सार्वजनिक" से अलग रखता है। गैलरी और टेम्प्लेट कैटलॉग जो वास्तव में क्रॉस-यूज़र डिस्कवरी चाहते हैं, स्पष्ट रूप से ऑप्ट इन करें।

```an-diagram title="दृश्यता, बाहर की ओर चौड़ी होना" summary="संसाधन पर अस्पष्ट दृश्यता मंजिल निर्धारित करती है; सहयोगी तालिका में स्पष्ट शेयर अनुदान नामित लोगों को शीर्ष पर जोड़ें।"
{
  "html": "<div class=\"share-tiers\"><div class=\"diagram-card\"><span class=\"diagram-pill\">private</span><small class=\"diagram-muted\">owner + explicit grants only &middot; <strong>default</strong></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">org</span><small class=\"diagram-muted\">+ anyone in the same org (read-only)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">public</span><small class=\"diagram-muted\">+ anyone with the link (read-only) &middot; hidden from others' lists/search</small></div></div>",
  "css": ".share-tiers{display:flex;flex-direction:column;align-items:stretch;gap:8px}.share-tiers .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px}.share-tiers .diagram-arrow{text-align:center;font-size:20px;line-height:1}"
}
```

## शेयर अनुदान पर भूमिकाएँ {#roles}

जब आप किसी विशिष्ट उपयोगकर्ता या संगठन के साथ साझा करते हैं, तो आप एक भूमिका चुनते हैं:

- **दर्शक** — केवल पढ़ने के लिए।
- **संपादक** - पढ़ें + लिखें।
- **एडमिन** - पढ़ें + लिखें + शेयर प्रबंधित करें (अन्य लोगों को जोड़/हटा सकते हैं)।

`admin` क्या NOT स्वामित्व बदलता है - शेयर अनुदान से अलग, प्रति संसाधन अभी भी एक ही मालिक है।

## क्या कवर किया गया है {#covered}

प्रत्येक टेम्पलेट जो उपयोगकर्ता द्वारा लिखित कार्य को संग्रहीत करता है, इस मॉडल का उपयोग करता है। ठोस रूप से:

- **सामग्री** — दस्तावेज़
- **स्लाइड** — डेक
- **डिज़ाइन** — डिज़ाइन और संपत्ति
- **वीडियो** — रचनाएँ
- **क्लिप्स** — स्क्रीन रिकॉर्डिंग (लूम-शैली)
- **फ़ॉर्म** — फॉर्म परिभाषाएँ
- **कैलेंडर** — ईवेंट और बुकिंग लिंक
- **एनालिटिक्स** - डैशबोर्ड (बाहर चल रहा है - एनालिटिक्स टेम्पलेट का `AGENTS.md` देखें)
- **एक्सटेंशन** — सैंडबॉक्स्ड मिनी-ऐप्स ([Extensions](/docs/extensions#sharing) देखें)

इनमें से हर एक समान `ownableColumns()` स्कीमा हेल्पर, समान `share-resource` क्रिया और समान `<ShareButton>` UI का उपयोग करता है। एक टेम्प्लेट से दूसरे टेम्प्लेट पर जाएं और शेयर डायलॉग समान दिखता है।

## क्या शामिल नहीं है {#not-covered}

कुछ क्षेत्र जानबूझकर साझाकरण प्रणाली से बाहर हैं:

- **व्यक्तिगत-डेटा ऐप्स** (मेल, मैक्रोज़) - डिज़ाइन के अनुसार उपयोगकर्ता के दायरे में। कोई "मेरा इनबॉक्स साझा करें" अवधारणा नहीं है।
- **सत्य के बाहरी स्रोत ऐप्स** — एक्सेस कंट्रोल अपस्ट्रीम सिस्टम में रहता है, एजेंट-नेटिव ऐप में नहीं।
- **गुमनाम सार्वजनिक URLs** - फॉर्म प्रकाशित स्लग और बुकिंग-लिंक स्लग जो लॉग-आउट उपयोगकर्ताओं के लिए URL को उजागर करते हैं, एक अलग अक्ष हैं। वे साझाकरण प्रणाली के साथ-साथ रहते हैं, उसके शीर्ष पर नहीं।

## शेयर UI {#share-ui}

प्रत्येक साझा करने योग्य संसाधन को उसके हेडर में एक शेयर बटन मिलता है। इसे क्लिक करने से बटन से जुड़ा एक पॉपओवर खुलता है (मोडल नहीं):

- दृश्यता चयनकर्ता (`Private` / `Organization` / `Public link`)।
- "लोगों या टीमों को जोड़ें" स्वतः पूर्ण - संगठन में उपयोगकर्ताओं को खोजें या एक ईमेल पेस्ट करें।
- व्यक्तिगत ईमेल अनुदान के लिए एक Google डॉक्स-शैली `सूचित करें people` चेकबॉक्स।
- भूमिका चयनकर्ताओं और हटाने के नियंत्रण के साथ वर्तमान अनुदानों की एक सूची।
- एक कॉपी-लिंक बटन जो वर्तमान दृश्यता का सम्मान करता है।

शेयर बटन एक एकल आयात है:

```tsx
import { ShareButton } from "@agent-native/core/client";

<ShareButton
  resourceType="deck"
  resourceId={deck.id}
  resourceTitle={deck.title}
/>;
```

सूचियों के लिए, प्रत्येक पंक्ति के आगे एक `<VisibilityBadge visibility={row.visibility} />` छोड़ें ताकि उपयोगकर्ता एक नज़र में देख सकें कि निजी बनाम साझा क्या है।

## समान मॉडल, एजेंट और UI {#agent-and-ui}

फ्रेमवर्क इन actions को प्रत्येक टेम्पलेट में ऑटो-माउंट करता है - एजेंट उन्हें टूल के रूप में कॉल करता है, और UI उन्हें `useActionQuery` / `useActionMutation` के माध्यम से कॉल करता है:

| कार्रवाई                  | यह क्या करता है                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `share-resource`          | किसी उपयोगकर्ता या संगठन को किसी विशिष्ट भूमिका तक पहुंच प्रदान करें। वैकल्पिक `notify` ईमेल सूचनाओं को नियंत्रित करता है। |
| `unshare-resource`        | किसी उपयोगकर्ता या संगठन के लिए पहुंच रद्द करें।                                                                           |
| `list-resource-shares`    | वर्तमान दृश्यता और सभी स्पष्ट अनुदान दिखाएं।                                                                               |
| `set-resource-visibility` | `private`, `org`, या `public` में बदलें।                                                                                   |

एजेंट को बताएं "इस डिज़ाइन को संपादकों के रूप में मार्केटिंग टीम के साथ साझा करें" और यह UI द्वारा उपयोग किए जाने वाले उसी एंडपॉइंट के विरुद्ध `share-resource` को कॉल करता है। परिणाम अगले रेंडर पर शेयर डायलॉग में दिखाई देता है।

## इसे एक नए टेम्पलेट में बनाना {#building}

यदि आप एक टेम्प्लेट बना रहे हैं ([Creating Templates](/docs/creating-templates) देखें), तो वायरिंग शेयरिंग कम है। आपकी स्कीम में दो अतिरिक्त:

```ts
import {
  table,
  text,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const decks = table("decks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  data: text("data").notNull(),
  ...ownableColumns(), // adds owner_email, org_id, visibility
});

export const deckShares = createSharesTable("deck_shares");
```

```an-schema title="संसाधन + सहयोगी शेयर तालिका" summary="Coarse visibility lives on the resource; each fine-grained grant is a row in the shares table."
{
  "entities": [
    {
      "id": "deck",
      "name": "decks",
      "note": "...ownableColumns()",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "title", "type": "text", "nullable": false },
        { "name": "owner_email", "type": "text", "nullable": false, "note": "स्वामित्व के लिए सत्य का एकल स्रोत।" },
        { "name": "org_id", "type": "text", "nullable": true },
        { "name": "visibility", "type": "enum", "nullable": false, "note": "निजी | संगठन | सार्वजनिक" }
      ]
    },
    {
      "id": "deckShare",
      "name": "deck_shares",
      "note": "createSharesTable() — one row per grant",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "resource_id", "type": "text", "fk": "decks.id", "nullable": false },
        { "name": "principal_type", "type": "enum", "note": "उपयोगकर्ता | संगठन" },
        { "name": "principal_id", "type": "text", "note": "email (user) or org id (org)" },
        { "name": "role", "type": "enum", "note": "दर्शक | संपादक | व्यवस्थापक" },
        { "name": "created_by", "type": "text" },
        { "name": "created_at", "type": "text" }
      ]
    }
  ],
  "relations": [
    { "from": "deckShare", "to": "deck", "kind": "n-n", "label": "grants access to" }
  ]
}
```

`server/db/index.ts` में एक पंजीकरण कॉल:

```ts
import { registerShareableResource } from "@agent-native/core/sharing";

registerShareableResource({
  type: "deck",
  resourceTable: schema.decks,
  sharesTable: schema.deckShares,
  displayName: "Deck",
  titleColumn: "title",
  getResourcePath: (deck) => `/deck/${deck.id}`,
  getDb,
});
```

उसके बाद, सूची/पठित क्वेरीज़ `accessFilter()` से होकर गुजरती हैं और भूमिकाओं को लागू करने के लिए actions का उपयोग करके `assertAccess()` लिखती हैं।

### वैकल्पिक सख्त झंडे {#hardening-flags}

`registerShareableResource` उन संसाधनों के लिए दो सुरक्षा झंडे स्वीकार करता है जो कोड निष्पादित करते हैं या उन्नत विश्वास रखते हैं:

```ts
registerShareableResource({
  type: "extension",
  resourceTable: schema.extensions,
  sharesTable: schema.extensionShares,
  // ...
  allowPublic: false, // Reject set-resource-visibility → "public"
  requireOrgMemberForUserShares: true, // Reject user grants to non-org emails
});
```

`allowPublic: false` किसी भी कॉलर - एजेंट या UI - को संसाधन की दृश्यता को `public` पर सेट करने से रोकता है। `requireOrgMemberForUserShares: true` संसाधन स्वामी के संगठन के बाहर के ईमेल पतों पर व्यक्तिगत उपयोगकर्ता अनुदान को अस्वीकार करता है। एक्सटेंशन दोनों सेट करते हैं: एक एक्सटेंशन का HTML एक iframe के अंदर चलता है जो actions और DB को _viewer_ कहता है, इसलिए सार्वजनिक पहुंच दर्शक के क्रेडेंशियल के साथ मनमाना कोड होगा।

```an-callout
{
  "tone": "risk",
  "body": "For resources that execute code or carry elevated trust (like extensions), set `allowPublic: false` and `requireOrgMemberForUserShares: true`. Otherwise a public share becomes arbitrary code running with the *viewer's* credentials."
}
```

जब एजेंट या किसी अन्य गैर-UI कॉलर द्वारा कोई शेयर बनाया जाता है, तो `getResourcePath` अधिसूचना ईमेल को एक सीधा फ़ॉलबैक लिंक देता है। पूरा पैटर्न (क्रिएट-एक्शन ओनरशिप स्टैम्पिंग और मौजूदा तालिकाओं के लिए माइग्रेशन रेसिपी सहित) `sharing` एजेंट कौशल में रहता है - शेयरिंग-अवेयर फीचर बनाते समय एजेंट इसे मांग पर पढ़ता है।

## सुरक्षा गारंटी {#security}

फ्रेमवर्क के व्यापक डेटा-स्कोपिंग मॉडल पर साझाकरण - स्वामित्व योग्य तालिकाओं तक सूची/पढ़ने/लिखने की पहुंच `accessFilter()` / `resolveAccess()` / `assertAccess()` के माध्यम से जाती है, और `org_id`-टैग किए गए संसाधन सभी संगठनों में अदृश्य हैं। पूरी पाइपलाइन, सीआई गार्ड और खतरे की सतह के लिए [Security → Data Scoping](/docs/security#data-scoping) देखें।

## यह भी देखें {#see-also}

- [Security & Data Scoping](/docs/security) - एक्सेस-फ़िल्टर और स्वामित्व मॉडल जिस पर साझाकरण चलता है।
- [Authentication](/docs/authentication) - सत्र, संगठन, और अनुरोध संदर्भ में पहचान कैसे प्रवाहित होती है।
- [Extensions](/docs/extensions#sharing) - सैंडबॉक्स्ड मिनी-ऐप सतह में साझा करना।
- [Creating Templates](/docs/creating-templates) - `ownableColumns` को एक नए टेम्पलेट के स्कीमा में वायरिंग करना।
