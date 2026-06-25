---
title: "सार्वजनिक एजेंट वेब"
description: "सार्वजनिक मार्गों को एजेंटों द्वारा क्रॉल करने योग्य, पढ़ने योग्य, उद्धृत करने योग्य और वैकल्पिक रूप से कॉल करने योग्य बनाएं - robots.txt, llms.txt, मार्कडाउन मिरर, JSON-LD, और एक सार्वजनिक MCP सतह।"
---

# सार्वजनिक एजेंट वेब

सार्वजनिक एजेंट वेब एजेंटों के लिए सार्वजनिक Agent-Native मार्गों को क्रॉल करना, पढ़ना, उद्धृत करना और कॉल करना आसान बनाता है। लक्ष्य प्रत्येक ऐप एंडपॉइंट को सार्वजनिक करना नहीं है। लक्ष्य उन पृष्ठों के लिए एक स्वच्छ सार्वजनिक सतह प्रकाशित करना है जो पहले से ही सार्वजनिक हैं, जबकि निजी डेटा और टूल एक्सेस को स्पष्ट नियंत्रण के पीछे रखना है।

दस्तावेज़ साइट संदर्भ कार्यान्वयन है। आज यह शिप करता है:

- `/robots.txt` एक क्रॉलर नीति के साथ जो पुनर्प्राप्ति की अनुमति देता है लेकिन डिफ़ॉल्ट रूप से प्रशिक्षण की अनुमति नहीं देता है।
- `/sitemap.xml` पूर्ण विहित URLs और `lastmod` के साथ जब स्रोत फ़ाइल इसे उजागर करती है।
- एजेंट-अनुकूल सामग्री खोज के लिए `/llms.txt` और `/llms-full.txt`।
- Markdown दर्पण जैसे `/docs/getting-started.md`।
- उत्पादन निर्माण के बाद सार्वजनिक दस्तावेज़ पृष्ठों के लिए `Accept: text/markdown` प्रतिक्रियाएँ।
- आधार संगठन, वेबसाइट और पेज मेटाडेटा के लिए JSON-LD।
- एक ऑडिट CLI (`npx @agent-native/core@latest audit-agent-web`) जो उपरोक्त सभी की जांच करता है।

`publicMcp: true` को सेट करने से ऑप्ट-इन actions एक सार्वजनिक MCP एंडपॉइंट के रूप में सामने आता है, जिससे बाहरी एजेंट उन्हें सीधे कॉल कर सकते हैं ([MCP Protocol](/docs/mcp-protocol) देखें)।

```an-diagram title="सार्वजनिक मार्ग क्या प्रकाशित करता है" summary="एक सार्वजनिक मार्ग एजेंट-अनुकूल अभ्यावेदन को बढ़ावा देता है। रूट पढ़ना कॉलिंग टूल से अलग है - टूल एक्सेस ऑप्ट-इन रहता है।"
{
  "html": "<div class=\"diagram-web\"><div class=\"diagram-box\" data-rough>सार्वजनिक रूट<br><small class=\"diagram-muted\">derived from route access settings</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-grid\"><span class=\"diagram-pill\">robots.txt</span><span class=\"diagram-pill\">sitemap.xml</span><span class=\"diagram-pill\">llms.txt</span><span class=\"diagram-pill\">.md mirror</span><span class=\"diagram-pill\">JSON-LD</span><span class=\"diagram-pill\">text/markdown</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col gate\"><span class=\"diagram-pill warn\">टूल निजी रहते हैं</span><small class=\"diagram-muted\">publicMcp + publicAgent.expose required</small></div></div>",
  "css": ".diagram-web{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-web .diagram-arrow{font-size:22px;line-height:1}.diagram-web .diagram-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.diagram-web .gate{display:flex;flex-direction:column;gap:4px;align-items:flex-start}"
}
```

## कॉन्फ़िगरेशन {#config}

मौजूदा वर्कस्पेस ऐप कॉन्फ़िगरेशन के तहत `agentWeb` जोड़ें (अपने ऐप के `package.json` में `agent-native` कुंजी के तहत - या समकक्ष `workspace.agentWeb`, `agentWeb`, या `root.agentWeb`)। सार्वजनिक रूट सूची अभी भी ऐप की रूट एक्सेस सेटिंग्स से ली गई है; `agentWeb` नियंत्रित करता है कि उस सार्वजनिक सतह को एजेंटों के सामने कैसे प्रस्तुत किया जाए।

```json
{
  "agent-native": {
    "workspaceApp": {
      "audience": "public",
      "protectedPaths": ["/admin/*"],
      "agentWeb": {
        "discoverable": true,
        "markdownTwins": true,
        "llmsTxt": true,
        "jsonLd": true,
        "publicAgentCard": true,
        "publicMcp": false,
        "crawlerPolicy": "discoverable-no-training",
        "crawlers": {
          "training": "disallow",
          "search": "allow",
          "userTriggered": "allow",
          "codingAgents": "allow",
          "autonomousAgents": "allow"
        }
      }
    }
  }
}
```

अधिकांश ऐप्स के लिए, डिफ़ॉल्ट को अकेला छोड़ दें। यदि किसी ऐप में कोई सार्वजनिक रूट है, तो `discoverable` डिफ़ॉल्ट रूप से चालू हो जाता है। डिफ़ॉल्ट क्रॉलर नीति "खोजने योग्य है, प्रशिक्षित करने योग्य नहीं": खोज, उपयोगकर्ता-ट्रिगर पुनर्प्राप्ति, कोडिंग एजेंट और स्वायत्त ब्राउज़िंग एजेंटों की अनुमति है; क्रॉलर को प्रशिक्षण देने की अनुमति नहीं है.

## सत्य का मार्ग स्रोत {#route-source}

एजेंट वेब डिस्कवरी रूट एक्सेस मॉडल का अनुसरण करती है:

- सार्वजनिक ऐप्स `protectedPaths` को छोड़कर हर मार्ग को उजागर करते हैं।
- आंतरिक ऐप्स केवल `publicPaths` को उजागर करते हैं।
- सार्वजनिक शेयर और फॉर्म पेज एजेंटों द्वारा पढ़ने योग्य हो सकते हैं।
- प्रस्तुत निजी डेटा, प्रमाणित डैशबोर्ड और उपयोगकर्ता/संगठन स्थिति को कभी भी शामिल नहीं किया जाता है क्योंकि पास का पृष्ठ सार्वजनिक है।

यह मिश्रित ऐप्स को स्वाभाविक रखता है। एक फॉर्म ऐप एक सार्वजनिक फॉर्म पेज को उजागर कर सकता है और सबमिशन को निजी रख सकता है। एक सामग्री ऐप प्रकाशित पोस्ट को उजागर कर सकता है और संपादक को निजी रख सकता है। एक डॉक्स साइट एडमिन टूल्स को छोड़कर बाकी सब कुछ उजागर कर सकती है।

## सार्वजनिक पृष्ठ सार्वजनिक उपकरण नहीं हैं {#public-tools}

सार्वजनिक पेज एक्सेस और सार्वजनिक टूल एक्सेस अलग-अलग हैं। किसी रूट के सार्वजनिक होने का मतलब केवल यह है कि एजेंट उस रूट को HTML, Markdown, साइटमैप प्रविष्टियों, एलएलएमएस प्रविष्टियों और संरचित डेटा के रूप में पढ़ सकते हैं।

```an-callout
{
  "tone": "warning",
  "body": "**A public page is not a public tool.** Making a route crawlable never exposes an action. Tool access requires an explicit `publicAgent.expose` opt-in on the action *and* `publicMcp: true` on the app."
}
```

सार्वजनिक एजेंट प्रोटोकॉल के माध्यम से किसी कार्रवाई को उजागर करने के लिए, कार्रवाई को इसमें शामिल होना होगा:

```an-annotated-code title="सार्वजनिक सतह पर एक सुरक्षित कार्रवाई का विकल्प चुनना"
{
  "filename": "actions/search-docs.ts",
  "language": "ts",
  "code": "export default defineAction({\n  description: \"खोजें published docs\",\n  readOnly: true,\n  publicAgent: {\n    expose: true,\n    readOnly: true,\n    requiresAuth: false,\n    isConsequential: false,\n    title: \"खोजें published docs\",\n  },\n  run: async (args) => {\n    // ...\n  },\n});",
  "annotations": [
    { "lines": "4", "label": "स्पष्ट ऑप्ट-इन", "note": "Without `publicAgent.expose === true`, the action never appears on any public agent surface — no matter how public its routes are." },
    { "lines": "5-7", "label": "स्व-वर्णन सुरक्षा", "note": "इसे केवल पढ़ने के लिए चिह्नित करें, घोषित करें कि क्या इसे प्रमाणीकरण की आवश्यकता है, और ध्वजांकित करें कि क्या यह परिणामी है। सार्वजनिक MCP consequential/write कार्यों को तब तक बाहर करता है जब तक कि नीति स्पष्ट रूप से उन्हें अनुमति न दे।" }
  ]
}
```

`agentWeb.publicMcp` डिफ़ॉल्ट रूप से `false` रहता है। जब सार्वजनिक MCP सक्षम होता है, तो सर्वर को `publicAgent.expose === true` के साथ केवल actions को उजागर करना चाहिए, और तब भी परिणामी को बाहर करना चाहिए या actions लिखना चाहिए जब तक कि कार्रवाई और प्राधिकरण नीति स्पष्ट रूप से उन्हें अनुमति न दे।

## बिल्ड-टाइम फ़ाइलें {#build-time}

`@agent-native/core/agent-web` में फ्रेमवर्क उपयोगिताएँ एक पृष्ठ सूची से सामान्य फ़ाइलें उत्पन्न करती हैं:

```ts
import {
  buildAgentWebStaticFiles,
  normalizeAgentWebConfig,
} from "@agent-native/core/agent-web";

const config = normalizeAgentWebConfig(
  { crawlerPolicy: "discoverable-no-training" },
  { hasPublicRoutes: true },
);

const files = buildAgentWebStaticFiles({
  siteName: "My Agent-Native App",
  siteUrl: "https://example.com",
  description: "Public docs for my app.",
  config,
  pages: [
    {
      path: "/docs",
      title: "Docs",
      description: "Start here.",
      markdown: "# दस्तावेज़\n\nयहां प्रारंभ करें.\n",
      markdownPath: "/docs/getting-started.md",
      lastmod: new Date(),
    },
  ],
});
```

Vite ऐप्स उत्पादन निर्माण के दौरान उन फ़ाइलों को `public`, `dist`, `dist/client`, `dist/server/public`, या `build/client` में लिखने के लिए `@agent-native/core/vite` से `createAgentWebVitePlugin` का उपयोग कर सकते हैं।

## किसी साइट का ऑडिट करें {#audit}

किसी तैनात साइट या स्थानीय उत्पादन सर्वर के विरुद्ध CLI ऑडिट का उपयोग करें:

```bash
npx @agent-native/core@latest audit-agent-web --url https://www.agent-native.com
```

ऑडिट इसकी जाँच करता है:

- SSR-दृश्यमान HTML.
- कैनोनिकल URLs.
- JSON-LD.
- `robots.txt` नीति और संपूर्ण साइटमैप URL.
- पूर्ण साइटमैप प्रविष्टियाँ।
- `/llms.txt` और `/llms-full.txt`.
- Markdown दर्पण।
- `Accept: text/markdown`.
- सामान्य एजेंट पुनर्प्राप्ति उपयोगकर्ता एजेंटों के लिए कोई आकस्मिक 401/403 ब्लॉक नहीं।

यदि आवश्यक सार्वजनिक सतह गायब है तो ऑडिट गैर-शून्य से बाहर हो जाता है।

## आगे क्या

- [**Actions**](/docs/actions) - सार्वजनिक एजेंट प्रोटोकॉल में actions को कैसे चुनें
- [**MCP Protocol**](/docs/mcp-protocol) - MCP सतह जो `publicMcp: true` सक्षम करती है
- [**Deployment**](/docs/deployment) - जहां ये स्थिर फ़ाइलें बिल्ड के दौरान लिखी जाती हैं
