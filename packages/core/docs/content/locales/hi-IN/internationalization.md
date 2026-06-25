---
title: "अंतर्राष्ट्रीयकरण"
description: "साझा स्थानीय कैटलॉग, एक भाषा पिकर, ब्राउज़र-भाषा फ़ॉलबैक और स्थानीय-जागरूक डॉक्स सामग्री के साथ Agent Native ऐप्स को स्थानीयकृत करें।"
---

# अंतर्राष्ट्रीयकरण

Agent Native ऐप्स साझा के माध्यम से फ्रेमवर्क और टेम्पलेट UI को स्थानीयकृत कर सकते हैं
`@agent-native/core/client/i18n` रनटाइम। फ़्रेमवर्क उपयोगकर्ता को संग्रहीत करता है
SQL सेटिंग्स में भाषा का चयन, इसे actions के रूप में प्रदर्शित करता है, और वापस आ जाता है
अंग्रेजी जब किसी ऐप ने अभी तक किसी स्ट्रिंग का अनुवाद नहीं किया है।

## रनटाइम

`AppProviders` के माध्यम से प्रदाता का उपयोग करें:

```tsx
import { AppProviders, getLocaleInitScript } from "@agent-native/core/client";
import { i18nCatalog } from "./i18n";

const LOCALE_INIT_SCRIPT = getLocaleInitScript();

<script
  data-agent-native-locale-init
  dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }}
/>;

<AppProviders queryClient={queryClient} i18n={{ catalog: i18nCatalog }}>
  <Outlet />
</AppProviders>;
```

`getLocaleInitScript()` प्रारंभिक `lang`, `dir`, और
React हाइड्रेट होने से पहले `window.__AGENT_NATIVE_LOCALE__`। सार्वजनिक SSR मार्ग
`@agent-native/core/server` से `resolveLocaleFromRequest()` को कॉल करें और पास करें
हाइड्रेशन बेमेल से बचने के लिए उस स्क्रिप्ट में लोकेल/कैटलॉग को हल किया गया।

## कैटलॉग

प्रत्येक स्थानीयकृत टेम्पलेट कैटलॉग को `app/i18n/` के अंतर्गत रखता है:

```ts
// app/i18n/index.ts
import enUS from "./en-US";
import type { AgentNativeI18nCatalog } from "@agent-native/core/client";

export const i18nCatalog = {
  sourceLocale: "en-US",
  messages: enUS,
  loadMessages: async (locale) => {
    switch (locale) {
      case "zh-CN":
        return (await import("./zh-CN")).default;
      default:
        return null;
    }
  },
} satisfies AgentNativeI18nCatalog;
```

हमेशा `en-US` को बंडल करें। डायनामिक-आयात गैर-अंग्रेज़ी कैटलॉग केवल उपयोगकर्ताओं के लिए
सक्रिय लोकेल डाउनलोड करें। समर्थित स्थानीय कोड `en-US`, `zh-CN`,
`es-ES`, `fr-FR`, `de-DE`, `ja-JP`, `ko-KR`, `pt-BR`, `hi-IN`, और `ar-SA`।

## UI

इंटरफ़ेस स्ट्रिंग्स के लिए `useT()` का उपयोग करें और ऐप पर `<LanguagePicker />` डालें
`/settings` पेज। साइडबार ऐप्स को ऐप साइडबार में **सेटिंग्स** को प्रदर्शित करना चाहिए;
हेडर भाषा आइकन केवल एक शॉर्टकट है।

```tsx
import {
  LanguagePicker,
  openAgentSettings,
  useT,
} from "@agent-native/core/client";

function SettingsPage() {
  const t = useT();
  return (
    <>
      <h2>{t("settings.languageTitle")}</h2>
      <LanguagePicker label={t("settings.languageLabel")} />

      <h2>{t("settings.agentTitle")}</h2>
      <p>{t("settings.agentDescription")}</p>
      <button type="button" onClick={() => openAgentSettings()}>
        {t("settings.openAgentSettings")}
      </button>
    </>
  );
}
```

"एजेंट सेटिंग" नियंत्रण को सही एजेंट साइडबार का सेटिंग टैब खोलना चाहिए
मॉडल, API कुंजी, स्वचालन, आवाज और अन्य फ्रेमवर्क-स्तरीय नियंत्रणों के लिए।
ऐप्स अपने स्वयं के सेटिंग पेज में उच्च-मूल्य फ़्रेमवर्क सेटिंग्स की नकल कर सकते हैं
जब सेटिंग ऐप के केंद्र में होती है, लेकिन साइडबार सेटिंग टैब
सत्य का स्रोत।

तिथि, संख्या, सापेक्ष समय और सूचियों के लिए `useFormatters()` का उपयोग करें। मत डालो
अनुवाद स्ट्रिंग के अंदर स्थान-संवेदनशील दिनांक/संख्या स्वरूपण।

## दस्तावेज़ साइट सामग्री {#docs-site-content}

सार्वजनिक दस्तावेज़ पृष्ठ समान मूल प्रदाता का उपयोग करते हैं, लेकिन
`persistPreference={false}` इसलिए अनाम दस्तावेज़ ट्रैफ़िक लोकलस्टोरेज और का उपयोग करता है
SQL सेटिंग्स actions के बजाय ब्राउज़र भाषा। अंग्रेजी स्रोत
`packages/core/docs/content/*.md`. स्थानीयकृत पृष्ठ
`packages/core/docs/content/locales/<locale>/<slug>.md`.

ऐप कैटलॉग के रूप में समान BCP-47 लोकेल कोड का उपयोग करें। स्लग को
अंग्रेजी स्रोत, अनुवादित शीर्षकों पर `{#anchor}` के साथ स्थिर एंकर सुरक्षित रखें,
और मार्ग, क्रिया नाम, प्रोटोकॉल फ़ील्ड, एनवी संस्करण और प्रदाता नाम छोड़ दें
अअनुवादित. यदि किसी लोकेल में किसी पेज के लिए कोई अनुवादित Markdown नहीं है, तो डॉक्स साइट
नेविगेशन और क्रोम को स्थानीयकृत करते समय उस पृष्ठ के लिए अंग्रेजी में वापस आ जाता है।

Docs Markdown में structured `an-*` visual blocks हो सकते हैं। जहाँ सही लगे, उनके user-facing prose fields translate करें, जैसे file-tree titles और `entries[].note`, callout bodies, tab labels, और annotated-code labels/notes। Stable identifiers unchanged रखें: filenames, paths, env vars, route strings, action names, language tags, code snippets, JSON keys, और protocol names।

## Actions और दृढ़ता

प्रत्येक ऐप को ये विरासत मिलती है:

- `get-localization-preference` — वर्तमान उपयोगकर्ता का `{ locale }` पढ़ें
- `set-localization-preference` - `"system"` या एक समर्थित लोकेल सेट करें

टिकाऊ मान `localization` के अंतर्गत उपयोगकर्ता-स्कोप वाली SQL सेटिंग्स में रहता है।
`localStorage` का उपयोग केवल प्री-हाइड्रेशन और अनाम फ़ॉलबैक के लिए किया जाता है। सक्रिय
लोकेल को परिवेशीय संदर्भ के रूप में एप्लिकेशन स्थिति में प्रतिबिंबित किया जाता है ताकि एजेंट देख सकें
वर्तमान इंटरफ़ेस भाषा।

## रक्षक

चलाएँ:

```bash
pnpm guard:i18n-catalogs
```

गार्ड समर्थित स्थानीय फ़ाइल नाम, कुंजी समता, प्लेसहोल्डर समता, का सत्यापन करता है
बासी कुंजियाँ, और `Intl.PluralRules` के माध्यम से CLDR बहुवचन श्रेणियाँ। यह जाँच करता है
संरचना, अनुवाद गुणवत्ता नहीं; उच्च-दृश्यता वाले तारों को अभी भी मानव की आवश्यकता है
समीक्षा.

कार्य नाम, मार्ग, एनम मान जैसे स्थिर पहचानकर्ताओं का अनुवाद न करें
ऐप-स्टेट कुंजी, डेटाबेस मान, प्रोटोकॉल फ़ील्ड, env var नाम, या प्रदाता
नाम.
