---
title: "कार्यस्थान प्रशासन"
description: "ब्रांचिंग, CODEOWNERS, पीआर समीक्षा, और डिस्पैच गिट-लेवल गवर्नेंस के साथ-साथ रनटाइम गवर्नेंस को कैसे संभालता है।"
---

# कार्यस्थान प्रशासन

> **कौन सा कार्यक्षेत्र दस्तावेज़?** यह पृष्ठ **शासन** को कवर करता है - एक रेपो में कई ऐप्स की समीक्षा, अनुमोदन और स्वामित्व कौन करता है। कार्यस्थान क्या है (अनुकूलन परत) के लिए [Workspace](/docs/workspace) देखें; परिनियोजन आकार (एक मोनोरेपो, कई ऐप्स) के लिए [Multi-App Workspaces](/docs/multi-app-workspace) देखें।

यह मार्गदर्शिका एजेंट-नेटिव वर्कस्पेस को चलाने के परिचालन पक्ष को कवर करती है - शाखा कैसे लगाएं, कौन क्या समीक्षा करता है, कोड स्वामित्व कैसे सेट करें, और डिस्पैच नियंत्रण विमान आपके शासन मॉडल में कैसे फिट बैठता है।

```an-diagram title="दो शासन विमान" summary="Git कोड को नियंत्रित करता है; Dispatch रनटाइम को नियंत्रित करता है। वे पूरक हैं - एक को दूसरे के अंदर दोहराएँ नहीं।"
{
  "html": "<div class=\"gov\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Git और GitHub</span><strong>कोड गवर्नेंस</strong><div class=\"gov-list\"><span class=\"diagram-pill\">CODEOWNERS</span><span class=\"diagram-pill\">branch protection</span><span class=\"diagram-pill\">PR समीक्षा</span><span class=\"diagram-pill\">git log / blame</span></div></div><div class=\"diagram-pill diagram-muted\">+</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Dispatch</span><strong>Runtime governance</strong><div class=\"gov-list\"><span class=\"diagram-pill\">vault secrets &amp; grants</span><span class=\"diagram-pill\">workspace resources</span><span class=\"diagram-pill\">agent profiles</span><span class=\"diagram-pill\">approvals &amp; audit</span></div></div></div>",
  "css": ".gov{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.gov .diagram-card{display:flex;flex-direction:column;gap:8px;padding:16px 18px;flex:1;min-width:240px}.gov .gov-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}"
}
```

## शाखा बनाना

### फ़ीचर शाखाएँ

सभी कार्यों के लिए अल्पकालिक फीचर शाखाओं का उपयोग करें:

```
main                         ← production
├── feat/mail-filters        ← single-app change
├── feat/core-oauth-refresh  ← framework change
├── fix/analytics-chart      ← targeted bug fix
└── feat/vault-encryption    ← dispatch/infra change
```

**नामकरण परंपरा:**

- **एकल-ऐप परिवर्तन:** `feat/<app>-<description>` या `fix/<app>-<description>` - उदा. `feat/mail-thread-search`, `fix/calendar-recurrence-parse`
- **फ्रेमवर्क परिवर्तन:** `feat/core-<description>` या `fix/core-<description>` - उदा. `feat/core-polling-v2`
- **प्रेषण परिवर्तन:** `feat/dispatch-<description>` - उदा. `feat/dispatch-vault-policies`
- **क्रॉस-ऐप परिवर्तन:** यदि किसी फ्रेमवर्क परिवर्तन के लिए टेम्पलेट अपडेट की आवश्यकता होती है, तो दोनों को एक ही शाखा में करें ताकि वे परमाणु रूप से शिप हो सकें

शाखाओं को अल्पकालिक रखें। लंबे समय तक रहने वाली शाखाएं मुख्य से अलग हो जाती हैं और दर्दनाक विलय पैदा करती हैं - विशेष रूप से एक मोनोरेपो में जहां कई टीमें रोजाना धक्का देती हैं।

### गैर-डेवलपर ब्रांचिंग

हर कोई जिसे परिवर्तन करने की आवश्यकता है, वह गिट के साथ सहज नहीं है। [Builder.io](https://www.builder.io) एक विज़ुअल ब्रांचिंग मॉडल का समर्थन करता है जो हुड के नीचे गिट शाखाओं को मैप करता है - सामग्री और प्रतिलिपि परिवर्तन, लेआउट समायोजन, डिज़ाइन पुनरावृत्तियों और बिना किसी देव वातावरण के ए/बी परीक्षण के लिए उपयोगी।

## कोड स्वामित्व

कोड गवर्नेंस को रेपो रूट पर कुछ फाइलों द्वारा कॉन्फ़िगर किया गया है:

```an-file-tree title="repo में governance config"
{
  "entries": [
    { "path": ".github/CODEOWNERS", "note": "बदले गए path के अनुसार reviewers auto-assign करता है" },
    { "path": ".github/labeler.yml", "note": "app के अनुसार PRs पर labels auto-apply करता है" },
    { "path": "pnpm-workspace.yaml", "note": "Workspace-level: broad review" },
    { "path": "package.json", "note": "Workspace-level: platform team ownership" }
  ]
}
```

GitHub की CODEOWNERS फ़ाइल स्वचालित रूप से समीक्षकों को पीआर को सौंपती है, जिसके आधार पर फ़ाइलें बदली जाती हैं। रेपो रूट पर `.github/CODEOWNERS` बनाएं:

```
# Framework core — affects every app; platform team reviews all changes
packages/core/                     @your-org/platform-team

# प्रेषण नियंत्रण विमान - रहस्य, एकीकरण, कार्यक्षेत्र संसाधन
templates/dispatch/                @your-org/platform-team

# प्रति-ऐप स्वामित्व - प्रत्येक टीम अपने स्वयं के ऐप की समीक्षा करती है
templates/mail/                    @your-org/mail-team
templates/analytics/               @your-org/analytics-team
templates/calendar/                @your-org/calendar-team
# ... add an entry per app

# कार्यक्षेत्र-स्तरीय कॉन्फ़िगरेशन - व्यापक समीक्षा क्योंकि यह सभी को प्रभावित करता है
.github/                           @your-org/platform-team
package.json                       @your-org/platform-team
pnpm-workspace.yaml                @your-org/platform-team
```

मुख्य युक्तियाँ: GitHub टीमों (`@org/team`) का उपयोग करें, व्यक्तियों का नहीं। फ़्रेमवर्क और डिस्पैच परिवर्तनों के लिए हमेशा प्लेटफ़ॉर्म समीक्षा की आवश्यकता होनी चाहिए। ग्लोब सिंटैक्स और मल्टीपल-ओनर पैटर्न के लिए [GitHub CODEOWNERS docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) देखें।

आवश्यक समीक्षाओं को सक्षम करने के लिए: सेटिंग्स → शाखाएं → `main` के लिए शाखा सुरक्षा → **विलय से पहले एक पुल अनुरोध की आवश्यकता है** → **कोड मालिकों से समीक्षा की आवश्यकता है**।

## पीआर लेबलिंग

`.github/labeler.yml` (अंश) के साथ ऐप द्वारा ऑटो-लेबल पीआर:

```yaml
app:mail:
  - changed-files:
      - any-glob-to-any-file: templates/mail/**
app:analytics:
  - changed-files:
      - any-glob-to-any-file: templates/analytics/**
core:
  - changed-files:
      - any-glob-to-any-file: packages/core/**
```

फिर [actions/labeler](https://github.com/actions/labeler) क्रिया जोड़ें - संपूर्ण वर्कफ़्लो YAML के लिए उस रेपो का README देखें। जब पीआर खोले या अपडेट किए जाते हैं तो लेबल स्वचालित रूप से लागू हो जाते हैं।

## पीआर समीक्षा दिशानिर्देश

| प्रकार बदलें                     | समीक्षा कौन करता है                  | क्या देखना है                                                               |
| -------------------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| **केवल ऐप** (`templates/<app>/`) | ऐप टीम का स्वामी                     | डोमेन की शुद्धता, कार्रवाई स्कीमा                                           |
| **फ्रेमवर्क** (`packages/core/`) | प्लेटफ़ॉर्म टीम + एक प्रभावित ऐप टीम | ब्रेकिंग परिवर्तन, प्रदर्शन, पीछे की ओर तुलना                               |
| **स्कीमा माइग्रेशन**             | प्लेटफ़ॉर्म टीम + वरिष्ठ इंजीनियर    | डेटा सुरक्षा, बोली अज्ञेयवाद (SQLite + Postgres)                            |
| **Actions**                      | स्वामी टीम                           | Actions दोनों एजेंट टूल हैं AND HTTP एंडपॉइंट - दोनों कोणों से समीक्षा करें |
| **क्रॉस-ऐप A2A**                 | दोनों ऐप टीमें                       | यदि आप A2A इंटरफ़ेस बदलते हैं, तो कॉल करने वालों को पता होना चाहिए          |
| **डिस्पैच वॉल्ट/संसाधन**         | प्लेटफ़ॉर्म टीम                      | गुप्त पहुंच, अनुदान का दायरा, किसे क्या मिलता है                            |

### समवर्ती एजेंट कार्य

एजेंट-मूल कार्यस्थानों में अक्सर एक ही शाखा पर एक साथ कई एआई एजेंट काम करते हैं। यह डिज़ाइन के अनुसार है - एजेंट एक शाखा साझा करते हैं और स्वतंत्र रूप से आगे बढ़ते हैं।

```an-callout
{ "tone": "warning", "body": "**The later commit wins.** Two agents touching the same file won't conflict at commit time — the conflict surfaces at review. Run `pnpm run prep` (typecheck + test + format) before pushing, and don't revert changes you didn't make unless they're clearly broken." }
```

इस परिवेश में पीआर की समीक्षा करते समय:

- **आपके द्वारा नहीं किए गए परिवर्तनों को वापस न करें** जब तक कि वे स्पष्ट रूप से टूटे न हों
- **फ़ाइलों को एक ही पीआर में कई एजेंटों द्वारा संशोधित किया जा सकता है** - यह सामान्य है
- **एजेंटों के परिवर्तनों के बीच एकीकरण समस्याओं को पकड़ने के लिए आगे बढ़ने से पहले `pnpm run prep`** (टाइपचेक + टेस्ट + फॉर्मेट) चलाएं
- **यदि दो एजेंट एक ही फ़ाइल को छूते हैं,**बाद वाला जीतता है। विवाद समीक्षा के समय सामने आते हैं, प्रतिबद्ध समय पर नहीं
- **पीआर में किसी भी कोड में बग ठीक करें,** चाहे इसे किसी भी एजेंट ने लिखा हो। पीआर की समग्र रूप से समीक्षा की जाती है।

## शासन के रूप में प्रेषण

[Dispatch](/docs/dispatch) ऐप कार्यक्षेत्र का रनटाइम कंट्रोल प्लेन है। यह रनटाइम गवर्नेंस के साथ गिट-स्तरीय गवर्नेंस को पूरक करता है:

| चिंता                                | गिट / GitHub             | प्रेषण                                                   |
| ------------------------------------ | ------------------------ | -------------------------------------------------------- |
| कोड कौन बदल सकता है                  | CODEOWNERS, शाखा सुरक्षा | —                                                        |
| रहस्यों तक कौन पहुंच सकता है         | —                        | वॉल्ट नीति, अनुदान, अनुरोध वर्कफ़्लो                     |
| एजेंट किन निर्देशों का पालन करते हैं | —                        | वैश्विक कार्यक्षेत्र संसाधन (AGENTS.md, निर्देश, skills) |
| कौन से एजेंट साझा किए जाते हैं       | —                        | कार्यस्थान एजेंट प्रोफ़ाइल                               |
| एकीकरण सूची                          | —                        | कार्यस्थान कनेक्शन और एकीकरण कैटलॉग                      |
| रनटाइम परिवर्तन अनुमोदन              | —                        | प्रेषण अनुमोदन प्रवाह                                    |
| ऑडिट ट्रेल                           | `git log` / `git blame`  | वॉल्ट ऑडिट + प्रेषण ऑडिट लॉग                             |
| मैसेजिंग एवं रूटिंग                  | —                        | Slack / टेलीग्राम एकीकरण                                 |

**गिट कोड गवर्नेंस को संभालता है। डिस्पैच रनटाइम गवर्नेंस को संभालता है।** डिस्पैच के अंदर गिट वर्कफ़्लो को दोहराने की कोशिश न करें या इसके विपरीत।

डिस्पैच प्रबंधन: वॉल्ट रहस्य, पुन: प्रयोज्य कार्यक्षेत्र कनेक्शन, कार्यक्षेत्र संसाधन (skills, निर्देश, एजेंट प्रोफाइल, MCP सर्वर), अनुमोदन और ऑडिट लॉग। सार्वजनिक ऐप रूट कॉन्फ़िगरेशन (`workspaceApp.audience` / `publicPaths` / `protectedPaths`) के लिए, [Multi-App Workspaces — Public app routes](/docs/multi-app-workspace#deployment) देखें।

संसाधन मॉडल और विहित पथों के लिए, [Workspace — Global resources](/docs/workspace#global-resources) देखें।

## सेटअप चेकलिस्ट

एक नए कार्यक्षेत्र के लिए, `npx @agent-native/core@latest create` चलाने के बाद:

**गिट और GitHub:**

- [ ] प्रति-ऐप टीम स्वामित्व के साथ `.github/CODEOWNERS` बनाएं
- [ ] आवश्यक कोड स्वामी समीक्षाओं के साथ `main` पर शाखा सुरक्षा सक्षम करें
- [ ] ऐप द्वारा पीआर को ऑटो-लेबल करने के लिए `.github/labeler.yml` जोड़ें
- [ ] प्रत्येक ऐप और प्लेटफ़ॉर्म टीम के लिए GitHub टीमें बनाएं

**प्रेषण:**

- [ ] वॉल्ट में साझा रहस्य जोड़ें (API कुंजी, OAuth क्रेडेंशियल, आदि)
- [ ] डिफ़ॉल्ट ऑल-ऐप वॉल्ट नीति रखें या मैन्युअल प्रति-ऐप अनुदान पर स्विच करें
- [ ] वॉल्ट रहस्यों को ऐप्स पर भेजने के लिए उन्हें सिंक करें
- [ ] फिर साझा प्रदाता खातों के लिए पुन: प्रयोज्य कार्यक्षेत्र कनेक्शन पंजीकृत करें
      ब्रेन, एनालिटिक्स, मेल या डिस्पैच जैसे ऐप्स को केवल तभी अनुदान दें जब उन्हें आवश्यकता हो
      वह खाता
- [ ] संसाधन पृष्ठ के माध्यम से कार्यक्षेत्र-व्यापी skills, रेलिंग निर्देश और ब्रांड/कंपनी संदर्भ संसाधन जोड़ें। संपूर्ण संसाधन-मॉडल तालिका और अनुशंसित स्टार्टर पैक के लिए [Workspace](/docs/workspace#global-resources) देखें।
- [ ] अनुमोदन नीति और अनुमोदनकर्ता ईमेल कॉन्फ़िगर करें
- [ ] व्यवस्थापक सूचनाओं के लिए सेंडग्रिड (`SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`) सेट करें
- [ ] कार्यक्षेत्र संदेश के लिए Slack या टेलीग्राम कनेक्ट करें
- [ ] साझा MCP सर्वर कॉन्फ़िगर करें - ऑल-ऐप या चयनित-ऐप अनुदान के लिए डिस्पैच में `mcp-servers/<name>.json` कार्यक्षेत्र संसाधन जोड़ें; निचले स्तर की तैनाती के लिए `mcp.config.json` या [MCP hub mode](/docs/mcp-clients#hub) का उपयोग करें
