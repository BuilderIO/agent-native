---
title: "Skills गाइड"
description: "skills एजेंट-नेटिव में कैसे काम करता है: फ्रेमवर्क skills, डोमेन skills, और कस्टम skills बनाना।"
---

# Skills गाइड

Skills Markdown फ़ाइलें हैं जो एजेंट को विशिष्ट पैटर्न और वर्कफ़्लो के बारे में गहन जानकारी देती हैं।

## skills क्या हैं {#what-are-skills}

Skills, `.agents/skills/<name>/SKILL.md` पर लाइव है और इसमें एजेंट के लिए विस्तृत मार्गदर्शन शामिल है। प्रत्येक कौशल एक चिंता पर केंद्रित है - डेटा कैसे संग्रहीत करें, स्थिति को कैसे सिंक करें, एजेंट चैट को काम कैसे सौंपें।

प्रत्येक कौशल के फ्रंटमैटर `name` और `description` को हमेशा सिस्टम प्रॉम्प्ट के skills ब्लॉक में इंजेक्ट किया जाता है ताकि एजेंट को पता चले कि skills क्या मौजूद है। जब एजेंट निर्णय लेता है कि कौशल कार्य के लिए प्रासंगिक है, तो पूर्ण कौशल निकाय को मांग पर लोड किया जाता है (यह `docs-search` के माध्यम से भी सामने आता है)। यही कारण है कि विवरणों को छोटा रखना और ट्रिगर-विशिष्ट मायने रखता है: विवरण ही एकमात्र ऐसी चीज है जिसे एजेंट यह तय करने से पहले पढ़ता है कि बाकी को लोड करना है या नहीं।

```an-diagram title="प्रगतिशील खुलासा" summary="प्रत्येक कौशल का केवल नाम + विवरण हमेशा संदर्भ में होता है। जब कार्य मेल खाता है तो पूरा शरीर मांग पर लोड होता है।"
{
  "html": "<div class=\"sk-flow\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">हमेशा system prompt में</span><div class=\"sk-list\"><span class=\"diagram-pill\">storing-data &mdash; <small class=\"diagram-muted\">add data models&hellip;</small></span><span class=\"diagram-pill\">real-time-sync &mdash; <small class=\"diagram-muted\">wire polling&hellip;</small></span><span class=\"diagram-pill\">create-skill &mdash; <small class=\"diagram-muted\">add a skill&hellip;</small></span></div><small class=\"diagram-muted\">just name + description (cheap)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><small class=\"diagram-muted\">task matches a description</small><span class=\"diagram-pill accent\">load on demand</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Full <code>SKILL.md</code> body<br><small class=\"diagram-muted\">नियम, कोड, क्या करें/न करें</small></div></div>",
  "css": ".sk-flow{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.sk-flow .diagram-card{display:flex;flex-direction:column;gap:8px;padding:14px 16px;min-width:240px}.sk-flow .sk-list{display:flex;flex-direction:column;gap:6px}.sk-flow .center{display:flex;flex-direction:column;align-items:center;gap:6px}.sk-flow .diagram-arrow{font-size:22px}"
}
```

## फ्रेमवर्क skills {#framework-skills}

ये skills **डिफ़ॉल्ट टेम्पलेट** के साथ बंडल हैं। किसी भी ऐप में उपलब्ध सटीक सेट आपके द्वारा बनाए गए टेम्पलेट पर निर्भर करता है - उस टेम्पलेट की `.agents/skills/` निर्देशिका की जांच करें कि यह वास्तव में क्या शिप करता है।

| कौशल                   | कब उपयोग करें                                                         |
| ---------------------- | --------------------------------------------------------------------- |
| `storing-data`         | डेटा मॉडल जोड़ना, कॉन्फिगरेशन या स्थिति को पढ़ना/लिखना                |
| `real-time-sync`       | वायरिंग पोलिंग सिंक, डिबगिंग UI अपडेट नहीं हो रहा                     |
| `delegate-to-agent`    | UI या actions से एजेंट को AI कार्य सौंपना                             |
| `actions`              | एजेंट actions बनाना या चलाना                                          |
| `self-modifying-code`  | ऐप स्रोत, घटकों या शैलियों का संपादन                                  |
| `create-skill`         | एजेंट के लिए नया skills जोड़ना                                        |
| `capture-learnings`    | रिकॉर्डिंग सुधार और पैटर्न                                            |
| `frontend-design`      | किसी भी वेब UI, घटकों, या पृष्ठों का निर्माण या स्टाइलिंग             |
| `adding-a-feature`     | चार-क्षेत्रीय चेकलिस्ट: UI, actions, skills, ऐप-स्टेट                 |
| `internationalization` | स्थानीयकृत UI कॉपी, भाषा कैटलॉग और RTL-सुरक्षित शैलियों को अपडेट करना |
| `shadcn-ui`            | shadcn/ui प्राइमेटिव्स और घटकों का उपयोग करना                         |
| `security`             | प्रामाणिक, अभिगम नियंत्रण, और गुप्त प्रबंधन                           |
| `real-time-collab`     | बहु-उपयोगकर्ता सहयोगात्मक संपादन                                      |
| `agent-engines`        | अंतर्निहित एजेंट इंजन की अदला-बदली या कॉन्फ़िगर करना                  |
| `notifications`        | इन-ऐप और पुश अधिसूचना पैटर्न                                          |
| `progress`             | पृष्ठभूमि कार्य प्रगति को ट्रैक करना और सामने लाना                    |
| `inline-embeds`        | एजेंट चैट के अंदर ऐप्स या आईफ्रेम एम्बेड करना                         |

`context-awareness` और `a2a-protocol` फ्रेमवर्क-स्तर skills हैं जो रेपो रूट पर `.agents/skills/` निर्देशिका में उपलब्ध हैं - प्रत्येक टेम्पलेट का अपना `.agents/skills/` देखें कि उसे क्या विरासत में मिला है।

## डोमेन skills {#domain-skills}

टेम्प्लेट में उनके डोमेन के लिए विशिष्ट skills शामिल है। ये समान `.agents/skills/` निर्देशिका में रहते हैं लेकिन टेम्पलेट-विशिष्ट पैटर्न को कवर करते हैं। पूरी सूची के लिए प्रत्येक टेम्पलेट की `.agents/skills/` निर्देशिका देखें; एक प्रतिनिधि नमूना:

- **मेल टेम्प्लेट** — `email-drafts`, `draft-queue`
- **फ़ॉर्म टेम्पलेट** — `form-building`, `form-publishing`, `form-responses`
- **एनालिटिक्स टेम्पलेट** - `adhoc-analysis`, `bigquery`, `cross-source-analysis`, `dashboard-management`, `data-querying`, `provider-api`, `gong`, `hubspot`, `prometheus`
- **स्लाइड टेम्पलेट** — `create-deck`, `deck-management`, `design-systems`, `slide-editing`, `slide-images`

डोमेन skills फ्रेमवर्क skills के समान प्रारूप का पालन करता है। वे उस टेम्पलेट के लिए विशिष्ट पैटर्न को एन्कोड करते हैं जिसका एजेंट को अनुसरण करने की आवश्यकता होती है।

## ऐप-समर्थित skills {#app-backed-skills}

ऐप-समर्थित skills एक कौशल बाज़ार आर्टिफैक्ट के रूप में एक एजेंट-मूल ऐप को पैकेज करता है। बंडल में एजेंट निर्देश, निर्यातित skills, MCP कनेक्टर मेटाडेटा, होस्टेड/स्थानीय लॉन्च निर्देश और UI सतह जैसे MCP ऐप्स शामिल हो सकते हैं।

> **पूर्ण विवरण नीचे:** ऐप-समर्थित skills (प्रकट प्रारूप, CLI कमांड, मार्केटप्लेस एडाप्टर, ऑटो-अपडेट हैशिंग) के यांत्रिकी [App-backed skills — full details](#app-backed-skills-full) में शामिल हैं।

## कस्टम skills बनाना {#creating-skills}

एक कौशल बनाएं जब:

- एक पैटर्न है जिसका एजेंट को बार-बार पालन करना चाहिए
- वर्कफ़्लो को चरण-दर-चरण मार्गदर्शन की आवश्यकता होती है
- आप एक टेम्पलेट से फ़ाइलों को स्कैफोल्ड करना चाहते हैं

कौशल पैदा न करें जब:

- किसी अन्य कौशल में मार्गदर्शन पहले से मौजूद है - इसके बजाय इसे विस्तारित करें
- मार्गदर्शन एकबारगी है - इसे इसके बजाय `AGENTS.md` या कार्यक्षेत्र मेमोरी में डालें

## कौशल प्रारूप {#skill-format}

प्रत्येक कौशल YAML फ्रंटमैटर के साथ एक Markdown फ़ाइल है:

```an-annotated-code title="SKILL.md की शारीरिक रचना"
{
  "filename": ".agents/skills/project-imports/SKILL.md",
  "language": "markdown",
  "code": "---\nname: project-imports\ndescription: >-\n  How to import projects from the legacy CSV export. Use when the user uploads\n  a project CSV or asks to migrate projects from the old system.\n---\n\n# Project Imports\n\n## Rule\n\nAlways validate the CSV header row before writing any rows. Reject unknown\ncolumns rather than silently dropping them.\n\n## How\n\n1. Call `get-import-schema` to fetch the expected columns.\n2. Parse the first CSV row and diff against the schema.\n3. If any required columns are missing, return an error — do not proceed.\n4. Stream remaining rows through `create-project-item` in batches of 50.\n\n## Don't\n\n- Don't hold all rows in memory — stream them.\n- Don't create duplicate projects; check for an existing name first.\n\n## Related Skills\n\n- **storing-data** — SQL schema and write patterns for new rows\n- **sharing** — exposing a project to other users after import",
  "annotations": [
    { "lines": "2", "label": "डिस्कवरी कुंजी", "note": "The `name` matches the folder; it is how the skill is invoked as `/project-imports`." },
    { "lines": "3-5", "label": "ट्रिगर", "note": "यह `description` हमेशा संदर्भ में **एकमात्र** पाठ है। यह स्पष्ट रूप से बताएं कि *कब* कौशल लागू होता है।" },
    { "lines": "9-14", "label": "नियम पहले", "note": "Lead with the hard rule and the why; the agent reads the body only once the task matches." },
    { "lines": "27-30", "label": "क्रॉस-लिंक", "note": "संबंधित कौशलों पर ध्यान दें ताकि एजेंट मार्गदर्शन पुनः प्राप्त करने के बजाय उन्हें श्रृंखलाबद्ध कर सके।" }
  ]
}
```

फ्रंटमैटर `name` और `description` का उपयोग कौशल खोज के लिए एजेंट के टूल सिस्टम द्वारा किया जाता है। विवरण में यह बताया जाना चाहिए कि कौशल कब सक्रिय होता है - स्थितियों के बारे में विशिष्ट रहें।

फ़ाइल को `.agents/skills/my-skill/SKILL.md` पर सहेजें। निर्देशिका का नाम फ्रंटमैटर में `name` से मेल खाना चाहिए।

> **यह भी देखें:** [Writing Agent Instructions](/docs/writing-agent-instructions) कौशल विवरण को कैसे शब्दों में कहें, प्रगतिशील प्रकटीकरण कैसे लागू करें, और `AGENTS.md` को दुबला कैसे रखें। दोनों पृष्ठ चल रहे उदाहरण के रूप में `project-imports` कौशल का उपयोग करते हैं।

## कौशल का दायरा: रनटाइम बनाम डेव {#skill-scope}

एक वैकल्पिक `scope` फ्रंटमैटर फ़ील्ड नियंत्रित करता है कि कौशल किस एजेंट के लिए है:

| `scope`   | रनटाइम एजेंट द्वारा लोड किया गया? | के लिए उपयोग करें                                                             |
| --------- | --------------------------------- | ----------------------------------------------------------------------------- |
| `both`    | हां (डिफ़ॉल्ट)                    | Skills इन-ऐप एजेंट के लिए उपयोगी है। `scope` को छोड़े जाने पर यह डिफ़ॉल्ट है। |
| `runtime` | हां                               | Skills केवल इन-ऐप रनटाइम एजेंट के लिए है।                                     |
| `dev`     | नहीं                              | Skills का मतलब केवल मानव के कोडिंग एजेंट (जैसे Claude कोड) के लिए है।         |

```markdown
---
name: release-checklist
description: >-
  Steps for cutting a release. Use when preparing or publishing a new version.
scope: dev
---
```

जब `scope` अनुपस्थित होता है (या किसी अज्ञात मान पर सेट होता है) तो यह डिफ़ॉल्ट रूप से `both` पर सेट हो जाता है, इसलिए प्रत्येक मौजूदा कौशल रनटाइम पर लोड होता रहता है - यह फ़ील्ड पूरी तरह से बैकवर्ड संगत है। एक `scope: dev` कौशल हर जगह रनटाइम एजेंट के लिए अदृश्य है: इसे सिस्टम प्रॉम्प्ट में इंजेक्ट किए गए skills ब्लॉक और `docs-search` परिणामों से बाहर रखा गया है।

### अपने कोडिंग एजेंट के सामने केवल-विकास कौशल को उजागर करना {#dev-only-skills}

एजेंट-नेटिव रनटाइम `.agents/skills/` से skills पढ़ता है। Claude कोड स्वतंत्र रूप से `.claude/skills/` से skills पढ़ता है। आपके कोडिंग एजेंट को एक कौशल उपलब्ध कराने के लिए लेकिन रनटाइम एजेंट से छिपा हुआ:

- इसे `.agents/skills/<name>/SKILL.md` में `scope: dev` चिह्नित करें ताकि रनटाइम एजेंट इसे कभी लोड न करे, और/या
- कौशल को `.claude/skills/<name>/SKILL.md` के अंतर्गत रखें या प्रतिबिंबित करें ताकि Claude कोड उसे पहचान सके।

यह केवल `.claude/skills` को पढ़ने के लिए Claude कोड पर भरोसा करने की पुरानी हैक को प्रतिस्थापित करता है - `scope: dev` देव-बनाम-रनटाइम विभाजन को प्रथम श्रेणी, स्पष्ट विकल्प बनाता है।

```an-diagram title="कौन सा एजेंट कौन सा कौशल लोड करता है" summary="स्कोप यह तय करता है कि इन-ऐप रनटाइम एजेंट किसी कौशल को देखता है या नहीं। देव कौशल केवल आपके कोडिंग एजेंट को दिखाई देते हैं।"
{
"html": "<div class=\"sc-grid\"><div class=\"diagram-card\"><span class=\"diagram-pill\">.agents/skills/</span><div class=\"sc-row\"><span class=\"diagram-pill ok\">scope: both</span><small class=\"diagram-muted\">default</small></div><div class=\"sc-row\"><span class=\"diagram-pill ok\">scope: runtime</span></div><div class=\"sc-row\"><span class=\"diagram-pill warn\">scope: dev</span></div></div><div class=\"sc-targets\"><div class=\"diagram-box\">Runtime agent<br><small class=\"diagram-muted\">reads <code>both</code> + <code>runtime</code></small></div><div class=\"diagram-box\">कोडिंग एजेंट<br><small class=\"diagram-muted\">Claude Code reads <code>.claude/skills/</code> + <code>dev</code></small></div></div></div>",
"css": ".sc-grid{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}.sc-grid .diagram-card{display:flex;flex-direction:column;gap:8px;padding:14px 16px}.sc-grid .sc-row{display:flex;align-items:center;gap:8px}.sc-grid .sc-targets{display:flex;flex-direction:column;gap:10px}"
}

```

> **यह भी देखें:** [Writing Agent Instructions](/docs/writing-agent-instructions) कौशल विवरण को कैसे शब्दों में कहें, प्रगतिशील प्रकटीकरण कैसे लागू करें, और `AGENTS.md` को दुबला कैसे रखें।

## Skills बनाम AGENTS.md {#skills-vs-agents-md}

> **AGENTS.md** — सिंहावलोकन। सभी स्क्रिप्ट को सूचीबद्ध करता है, डेटा मॉडल का वर्णन करता है, ऐप आर्किटेक्चर की व्याख्या करता है। ऐप को समझने के लिए एजेंट पहले इसे पढ़ता है।
>
> **Skills** - गहरी गोता। प्रत्येक कौशल विस्तृत नियमों, कोड उदाहरणों और करने/न करने की सूचियों के साथ एक पैटर्न पर केंद्रित होता है। एजेंट इन्हें तब पढ़ता है जब उसे किसी विशिष्ट पैटर्न का पालन करने की आवश्यकता होती है।

`AGENTS.md` एजेंट को बताता है कि ऐप क्या करता है। Skills एजेंट को बताएं कि विशिष्ट कार्य सही ढंग से कैसे करें। दोनों की आवश्यकता है - अभिविन्यास के लिए `AGENTS.md`, निष्पादन के लिए skills।

## Skills बनाम मेमोरी {#skills-vs-memory}

> **Skills** - लिखित, पुन: प्रयोज्य कैसे करें मार्गदर्शिकाएँ। प्रत्येक उपयोगकर्ता पर लागू करें, कार्य मेल खाने पर मांग पर बुलाया जाता है।
>
> **मेमोरी (`LEARNINGS.md` / `memory/MEMORY.md`)** - साझा प्रोजेक्ट लर्निंग और व्यक्तिगत संरचित मेमोरी हर मोड़ पर लोड होती है।

यदि ज्ञान ऐप में काम करने वाले प्रत्येक व्यक्ति पर लागू होता है ("हमेशा सबक्वेरीज़ पर सीटीई को प्राथमिकता दें"), तो यह एक कौशल या साझा `LEARNINGS.md` है। यदि यह _इस विशेष उपयोगकर्ता_ ("स्टीव को संक्षिप्त उत्तर पसंद है") के बारे में है, तो यह `memory/MEMORY.md` में आता है। संपूर्ण उपचार के लिए [Workspace Memory](/docs/workspace#memory) देखें।

---

# उन्नत

## ऐप-समर्थित skills — पूर्ण विवरण {#app-backed-skills-full}

ऐप-समर्थित skills एक एजेंट-नेटिव ऐप को एक कौशल बाज़ार आर्टिफैक्ट के रूप में पैकेज करता है।
बंडल में एजेंट निर्देश, निर्यातित skills, MCP कनेक्टर शामिल हो सकते हैं
मेटाडेटा, होस्टेड/स्थानीय लॉन्च निर्देश, और UI सतहें जैसे MCP ऐप्स।

प्रत्येक ऐप-समर्थित कौशल ऐप रूट पर `agent-native.app-skill.json` से शुरू होता है:

```json
{
  "schemaVersion": 1,
  "id": "assets",
  "hosted": {
    "url": "https://assets.agent-native.com",
    "mcpUrl": "https://assets.agent-native.com/_agent-native/mcp"
  },
  "mcp": { "serverName": "agent-native-assets" },
  "skills": [
    {
      "path": ".agents/skills/asset-generation",
      "visibility": "both",
      "exportAs": "assets"
    }
  ]
}
```

कौशल दृश्यता यह नियंत्रित करती है कि क्या भेजा जाए:

| दृश्यता    | अर्थ                                                                                |
| ---------- | ----------------------------------------------------------------------------------- |
| `internal` | ऐप के अपने एजेंट द्वारा उपयोग किया जाता है, बाज़ारों में निर्यात नहीं किया जाता है। |
| `exported` | बाज़ार में निर्यात किया गया, लेकिन ऐप को आंतरिक रूप से इसकी आवश्यकता नहीं है।       |
| `both`     | आंतरिक रूप से उपयोग किया जाता है और निर्यात किया जाता है।                           |

होस्टेड डिफ़ॉल्ट इंस्टॉल पथ है। अनुकूलन के लिए स्थानीय लॉन्च स्पष्ट है,
ऑफ़लाइन कार्य, या गोपनीयता-संवेदनशील उपयोग।

```bash
# शुभ पथ: निर्यात किए गए निर्देश और होस्ट किए गए MCP कनेक्टर।
npx @agent-native/core@latest skills add visual-plan
npx @agent-native/core@latest skills add assets

# रेपो-प्रथम Content docs/blog/MDX संपादन।
npx @agent-native/core@latest skills add content --mode local-files --scope project

# Vercel/open Skills CLI: केवल निर्यात किए गए निर्देश, कोई MCP कॉन्फ़िगरेशन नहीं।
npx skills@latest add BuilderIO/agent-native --skill assets

# स्थानीय एजेंट क्लाइंट के लिए होस्टेड MCP कनेक्टर पंजीकृत करें।
npx @agent-native/core@latest app-skill ensure --manifest templates/assets/agent-native.app-skill.json

# संपादन योग्य स्थानीय स्रोत को मूर्त रूप दें और चलाएं।
npx @agent-native/core@latest app-skill launch --manifest templates/assets/agent-native.app-skill.json --local --into ./assets-local

# मार्केटप्लेस एडाप्टर बनाएं: Codex प्लगइन, Claude मार्केटप्लेस, Vercel कौशल,
# plain/Claude कौशल और MCP कॉन्फ़िगरेशन।
npx @agent-native/core@latest app-skill pack --manifest templates/assets/agent-native.app-skill.json --out ./dist/assets-skill

# Vercel/open Skills CLI के साथ स्थानीय निर्यातित बंडल इंस्टॉल करें।
npx skills@latest add ./dist/assets-skill --skill assets -a codex -y

# जेनरेट किए गए Claude कोड मार्केटप्लेस को जोड़ें, फिर इसके एसेट्स प्लगइन को इंस्टॉल करें।
claude plugin marketplace add ./dist/assets-skill/adapters/claude-marketplace
claude plugin install agent-native-assets@agent-native-apps
```

कौशल फ़ाइलों से रहस्यों को दूर रखें। मेनिफ़ेस्ट में केवल URL कनेक्टर होना चाहिए
मेटाडेटा; OAuth/डिवाइस सेटअप MCP होस्ट में या ऐप के सामान्य माध्यम से होता है
सेटिंग्स प्रवाह.

वर्सेल लैब्स `skills` एडाप्टर एक पोर्टेबल `skills/<name>/SKILL.md` बंडल है
`npx skills@latest add ...` के लिए, लेकिन कच्चा `skills` CLI केवल निर्देश स्थापित करता है।
यह रेपो-परिभाषित पोस्टइंस्टॉल स्क्रिप्ट नहीं चलाता है या MCP कनेक्टर पंजीकृत नहीं करता है।
Agent Native CLI को स्थानीय एजेंटों के लिए डिफ़ॉल्ट दस्तावेज़ पथ के रूप में रखें क्योंकि यह
MCP कनेक्टर को भी पंजीकृत करता है। `BuilderIO/agent-native` एक वास्तविक GitHub
वर्सेल/ओपन Skills CLI के लिए रिपोजिटरी स्रोत; `skills.sh` एक खोज है और
लीडरबोर्ड निर्देशिका, npm-शैली पैकेज नेमस्पेस नहीं।

Claude कोड मार्केटप्लेस एडॉप्टर लिखता है
`adapters/claude-marketplace/.claude-plugin/marketplace.json` प्लस एक नेस्टेड
प्लगइन निर्देशिका जिसमें `skills/<name>/SKILL.md` और `.mcp.json` शामिल हैं। Claude
कोड, मार्केटप्लेस जोड़ें, `agent-native-assets@agent-native-apps` इंस्टॉल करें,
प्लगइन्स को पुनः लोड करें, फिर `/mcp` से केवल URL-MCP कनेक्टर को प्रमाणित करें।

जेनरेट किए गए प्लगइन मेनिफ़ेस्ट को ऑटो-अपडेट के लिए सेट किया गया है: Claude कोड
बाज़ार में प्रवेश सेट `autoUpdate: true` (कमिट-SHA संस्करण के साथ) और
Codex प्लगइन `version` बंडल किए गए skills और MCP के कंटेंट हैश को एम्बेड करता है
एंडपॉइंट, इसलिए इंस्टॉल किए गए प्लगइन्स पुन: पैकिंग के बिना कौशल परिवर्तन उठाते हैं। द
प्लान ऐप को रेपो रूट पर रेडी-टू-ऐड मार्केटप्लेस के रूप में इस तरह प्रकाशित किया जाता है -
एंड-टू-एंड इंस्टॉल के लिए [Plan plugin & marketplace](/docs/plan-plugin) देखें
और ऑटो-अपडेट प्रवाह।

उन उपयोगकर्ताओं के लिए जो a के बजाय यूनिवर्सल CLI के माध्यम से कॉपी किए गए skills को इंस्टॉल करते हैं
प्लगइन मार्केटप्लेस, CLI फ्रेशनेस कमांड का उपयोग करें:

```bash
npx @agent-native/core@latest skills status visual-plan
npx @agent-native/core@latest skills update visual-plan
```

`skills update` ज्ञात Codex/Claude प्रोजेक्ट और उपयोगकर्ता कौशल फ़ोल्डरों को स्कैन करता है, तुलना करता है
नवीनतम बंडल कौशल में कॉपी किया गया फ़ोल्डर हैश, और पुराने फ़ोल्डरों को फिर से लिखता है
स्थान. नए कॉपी किए गए Agent Native skills में एक `agent-native-skill.json` शामिल है
मार्कर ताकि भविष्य की स्थिति आउटपुट स्रोत और हैश की पहचान कर सके।

जेनरेटेड Agent Native ऐप्स और वर्कस्पेस में फ्रेमवर्क-प्रदत्त भी शामिल है
skills under `.agents/skills` (or `packages/shared/.agents/skills` in a
कार्यस्थान)। उन मचान skills को वर्तमान/नवीनतम CLI से ताज़ा करें:

```bash
npm run skills:update
# या, स्थानीय पैकेज स्क्रिप्ट पर भरोसा किए बिना:
npx @agent-native/core@latest skills update scaffold --project
```

`AGENTS.md` और `.agents/skills` विहित रहें। अपडेट कमांड रिपेयर भी करता है
Claude संगतता लिंक (`CLAUDE.md` और `.claude/skills`) ताकि Claude कोड देखे
दूसरी प्रति बनाए रखे बिना वही निर्देश।
