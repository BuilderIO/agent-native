---
title: "MCP ग्राहक"
description: "अपने एजेंट-नेटिव ऐप को स्थानीय MCP सर्वर (क्लाउड-इन-क्रोम, फ़ाइल सिस्टम, प्लेराइट इत्यादि) से कनेक्ट करें ताकि एजेंट को उनके टूल प्राप्त हो सकें।"
---

# MCP ग्राहक

**यह पेज: अपने एजेंट को अधिक टूल दें।** एक एजेंट-नेटिव ऐप को MCP सर्वर - स्थानीय या रिमोट - पर इंगित करें ताकि उनके टूल एजेंट चैट में दिखाई दें। यह _क्लाइंट_ दिशा है, [MCP Protocol](/docs/mcp-protocol) की दर्पण छवि (जो आपके ऐप को MCP _सर्वर_ बनाती है)।

| यदि आप चाहते हैं…                                               | पढ़ें                                    |
| --------------------------------------------------------------- | ---------------------------------------- |
| किसी बाहरी एजेंट/होस्ट को अपने ऐप से कनेक्ट करें                | [External Agents](/docs/external-agents) |
| अपने एजेंट को अधिक टूल दें (अन्य MCP सर्वर का उपभोग करें)       | **यह पृष्ठ** — MCP ग्राहक                |
| इनलाइन UI बनाएं जो Claude/ChatGPT में प्रस्तुत हों              | [MCP Apps](/docs/mcp-apps)               |
| निचले स्तर का MCP सर्वर संदर्भ (प्रमाणीकरण, उपकरण, कस्टम माउंट) | [MCP Protocol](/docs/mcp-protocol)       |

एक कॉन्फ़िगरेशन फ़ाइल के साथ, आपके कार्यक्षेत्र में प्रत्येक एजेंट-नेटिव ऐप आपकी मशीन पर MCP सर्वर द्वारा प्रदान किए गए टूल तक पहुंच प्राप्त करता है: ब्राउज़र स्वचालन के लिए `claude-in-chrome`, फ़ाइलों को पढ़ने के लिए `@modelcontextprotocol/server-filesystem`, ब्राउज़र परीक्षण के लिए `@playwright/mcp`, और कुछ भी जो MCP बोलता है।

आप कॉन्फ़िगरेशन फ़ाइल को संपादित किए बिना भी [connect remote (HTTP) MCP servers at runtime](#remote-via-ui) - व्यक्तिगत उपयोगकर्ता या संपूर्ण संगठन - कर सकते हैं।

प्रत्येक स्रोत एक रनटाइम **MCP प्रबंधक** में हल हो जाता है, और प्रत्येक उपकरण जिसे वह सीखता है वह टकराव-प्रूफ `mcp__<server-id>__<tool>` उपसर्ग के तहत एजेंट की टूल रजिस्ट्री में लैंड करता है - जिसे `tool-search` के माध्यम से इरादे से खोजा जा सकता है।

```an-diagram title="ग्राहक दिशा: कई स्रोत, एक टूल रजिस्ट्री" summary="कॉन्फ़िग फ़ाइलें, env, और रनटाइम UI सभी MCP प्रबंधक में विलीन हो जाते हैं; इसके उपकरण आपके ऐप के कार्यों के साथ-साथ उपसर्ग और उपकरण-खोज योग्य दिखाई देते हैं। यह सर्वर दिशा का दर्पण है."
{
  "html": "<div class=\"mcp-merge\"><div class=\"diagram-col sources\"><div class=\"diagram-box\" data-rough>Workspace <code>mcp.config.json</code><br><small class=\"diagram-muted\">ऐप्स में साझा</small></div><div class=\"diagram-box\" data-rough>ऐप रूट <code>mcp.config.json</code><br><small class=\"diagram-muted\">प्रति-ऐप override</small></div><div class=\"diagram-box\" data-rough><code>MCP_SERVERS</code> env<br><small class=\"diagram-muted\">CI / प्रोडक्शन</small></div><div class=\"diagram-box\" data-rough>सेटिंग्स UI से रिमोट<br><small class=\"diagram-muted\">personal &amp; org scope</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">MCP मैनेजर</span><small class=\"diagram-muted\">merge &middot; hot-reload</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col out\"><div class=\"diagram-node\">एजेंट टूल registry<br><small class=\"diagram-muted\"><code>mcp__&lt;server-id&gt;__&lt;tool&gt;</code></small></div><div class=\"diagram-node\"><code>tool-search</code><br><small class=\"diagram-muted\">इरादे से खोजें</small></div></div></div>",
  "css": ".mcp-merge{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.mcp-merge .diagram-col{display:flex;flex-direction:column;gap:8px}.mcp-merge .center{display:flex;flex-direction:column;align-items:center;gap:4px}.mcp-merge .diagram-arrow{font-size:22px;line-height:1}.mcp-merge code{font-size:.85em}"
}
```

> विपरीत दिशा - _अपने_ ऐप को एक MCP सर्वर बनाना जिसका अन्य होस्ट उपभोग करते हैं - [MCP Protocol](/docs/mcp-protocol) और [External Agents](/docs/external-agents) में रहता है।

## अंतर्निहित ब्राउज़र और कंप्यूटर-उपयोग क्षमताएं {#built-in-capabilities}

एजेंट-नेटिव में सामान्य stdio MCP सर्वर के लिए स्थानीय-विकास टॉगल शामिल हैं।
वे डिफ़ॉल्ट रूप से बंद हैं और केवल प्रति उपयोगकर्ता या प्रति संगठन सक्षम किए जा सकते हैं
जब ऐप स्थानीय रूप से चल रहा हो। उत्पादन और होस्ट किए गए सर्वर रहित रनटाइम छोड़ें
ये बिल्ट-इन भले ही पुरानी सेटिंग्स पंक्तियाँ मौजूद हों, और वर्कस्पेस संसाधन
पेड़ उन्हें डिफ़ॉल्ट `mcp-servers/*.json` संसाधनों के रूप में नहीं दिखाता है।

| क्षमता            | सर्वर आईडी        | कमांड                                                                   |
| ----------------- | ----------------- | ----------------------------------------------------------------------- |
| क्रोम डेवटूल्स    | `chrome-devtools` | `npx -y chrome-devtools-mcp@latest --autoConnect --no-usage-statistics` |
| नाटककार ब्राउज़र  | `playwright`      | `npx -y @playwright/mcp@latest`                                         |
| कंप्यूटर का उपयोग | `computer-use`    | `npx -y computer-use-mcp@latest`                                        |

एक समय में एक दायरे में केवल एक ब्राउज़र क्षमता सक्षम की जा सकती है। Chrome DevTools को सक्षम करने से उसी उपयोगकर्ता या संगठन के लिए Playwright अक्षम हो जाता है, और Playwright को सक्षम करने से Chrome DevTools अक्षम हो जाता है।

कंप्यूटर का उपयोग केवल macOS के लिए है। अन्य प्लेटफ़ॉर्म पर इसे अनुपलब्ध के रूप में सूचीबद्ध किया गया है और पुरानी सेटिंग पंक्ति में इसे शामिल करने पर भी इसे छोड़ दिया गया है।

Chrome DevTools डिफ़ॉल्ट रूप से `--autoConnect` का उपयोग करता है। यह एक योग्य चल रहे क्रोम इंस्टेंस से जुड़ जाता है; यह आपके लिए एक अलग ब्राउज़र प्रोफ़ाइल नहीं बनाता है या उपयोगकर्ता की नियमित प्रोफ़ाइल में साइन इन नहीं करता है। इसके लिए रिमोट डिबगिंग सक्षम के साथ Chrome 144+ की आवश्यकता है। मैन्युअल `browser-url` कॉन्फ़िगरेशन को बाद में जोड़ा जा सकता है जब किसी परिनियोजन को एक विशिष्ट डिबगिंग एंडपॉइंट की आवश्यकता होती है।

व्यक्तिगत टॉगल के लिए `u:<email>:mcp-builtin-capabilities` और टीम टॉगल के लिए `o:<orgId>:mcp-builtin-capabilities` के तहत फ्रेमवर्क की `settings` तालिका में बिल्ट-इन मौजूद हैं। सक्षम होने पर, वे दूरस्थ सर्वर के समान स्कोप दृश्यता प्रारूप के साथ रनटाइम MCP प्रबंधक में विलय हो जाते हैं, उदाहरण के लिए `mcp__user_<emailhash>_playwright__*` या `mcp__org_<orgId>_chrome-devtools__*`।

### उपयोगकर्ता-सामना वाले सेटअप नोट्स

संवेदनशील बिल्ट-इन के लिए संक्षिप्त, स्पष्ट सेटअप प्रतिलिपि का उपयोग करें:

- **Chrome DevTools** चल रहे Chrome डिबगिंग लक्ष्य से जुड़ जाता है। उपयोगकर्ताओं को बताएं
  यह ब्राउज़र परीक्षण और लॉग-इन सत्यापन के लिए है, और यह
  उपकरण प्रदर्शित होने से पहले Chrome रिमोट डिबगिंग को सक्षम करने की आवश्यकता हो सकती है।
- **नाटककार** ने एक अलग ब्राउज़र लॉन्च किया। नियतिवादी
  क्यूए जब उपयोगकर्ता की लाइव क्रोम प्रोफ़ाइल की आवश्यकता नहीं है।
- **कंप्यूटर का उपयोग** स्थानीय ऐप्स संचालित कर सकता है। इसे डिफ़ॉल्ट रूप से बंद रखें, समझाएं
  macOS स्क्रीन रिकॉर्डिंग और एक्सेसिबिलिटी संकेत देती है, और लेने से पहले पूछें
  संवेदनशील actions जैसे खरीदारी, वित्तीय परिवर्तन, या खाता परिवर्तन।

### अंतर्निहित समापनबिंदु

| विधि | मार्ग                        | उद्देश्य                                                                         |
| ---- | ---------------------------- | -------------------------------------------------------------------------------- |
| GET  | `/_agent-native/mcp/builtin` | अंतर्निहित क्षमताओं, सक्षम स्कोप, मर्ज किए गए आईडी और लाइव स्थिति की सूची बनाएं। |
| POST | `/_agent-native/mcp/builtin` | एक दायरा अद्यतन करें. बॉडी: `{ scope, enabledIds }` या `{ scope, id, enabled }`. |

## एक स्थानीय MCP सर्वर जोड़ना {#adding-a-server}

अपने वर्कस्पेस रूट पर (या एक व्यक्तिगत ऐप रूट पर `mcp.config.json` बनाएं - दोनों मौजूद होने पर वर्कस्पेस रूट जीत जाता है):

```jsonc
{
  "$schema": "https://agent-native.com/schema/mcp.config.json",
  "servers": {
    "claude-in-chrome": {
      "command": "claude-in-chrome-mcp",
      "args": [],
      "env": { "LOG_LEVEL": "info" },
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"],
    },
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem@latest",
        "/Users/me/projects",
      ],
    },
  },
}
```

आकार छोटा है: सर्वर आईडी द्वारा कुंजीबद्ध एक `servers` मानचित्र, जहां प्रत्येक प्रविष्टि या तो एक stdio लॉन्चर (`command` + `args` + वैकल्पिक `env`) या एक दूरस्थ `{ "type": "http", "url", "headers" }` प्रविष्टि है।

```an-annotated-code title="mcp.config.json, एनोटेट"
{
  "filename": "mcp.config.json",
  "language": "jsonc",
  "code": "{\n  \"$schema\": \"https://agent-native.com/schema/mcp.config.json\",\n  \"servers\": {\n    \"claude-in-chrome\": {\n      \"command\": \"claude-in-chrome-mcp\",\n      \"args\": [],\n      \"env\": { \"LOG_LEVEL\": \"info\" }\n    },\n    \"filesystem\": {\n      \"command\": \"npx\",\n      \"args\": [\"-y\", \"@modelcontextprotocol/server-filesystem@latest\", \"/Users/me/projects\"]\n    }\n  }\n}",
  "annotations": [
    { "lines": "3", "label": "सर्वर आईडी", "note": "कुंजी उपकरण उपसर्ग बन जाती है: इस सर्वर के उपकरण एजेंट की रजिस्ट्री में `mcp__claude-in-chrome__*` के रूप में सामने आते हैं, इसलिए वे 't collide with your template's क्रियाएं कर सकते हैं।" },
    { "lines": "4-6", "label": "stdio launcher", "note": "`command` + `args` एक स्थानीय बाइनरी उत्पन्न करता है। Stdio सर्वर **स्थानीय विकास** के लिए हैं - वे एज रनटाइम में नो-ऑप हैं।" },
    { "lines": "6", "label": "प्रक्रिया पर्यावरण", "note": "Optional `env` is passed to the spawned process. Keep secrets out of committed config; prefer `MCP_SERVERS` or the settings UI for tokens." }
  ]
}
```

अगले ऐप प्रारंभ पर आप देखेंगे:

```
[mcp-client] loaded config from /path/to/mcp.config.json (3 server(s))
[mcp-client] connected to claude-in-chrome: 12 tools
[mcp-client] connected to playwright: 9 tools
[mcp-client] connected to filesystem: 4 tools
```

उपकरण एजेंट की टूल रजिस्ट्री में उपसर्ग `mcp__<server-id>__<tool-name>` के साथ पंजीकृत हैं ताकि वे आपके टेम्पलेट के actions से टकरा न सकें। वे `tool-search` में भी शामिल हैं, इसलिए एजेंट सामने सटीक नाम जोड़ने की आवश्यकता के बजाय इरादे से नई कनेक्टेड MCP क्षमताओं की खोज कर सकते हैं।

## कॉन्फ़िगर प्राथमिकता {#precedence}

MCP कॉन्फ़िगरेशन को इस क्रम में हल किया गया है, पहला मैच जीतता है:

1. **वर्कस्पेस रूट `mcp.config.json`** - `package.json` में `agent-native.workspaceCore` के माध्यम से पता लगाया गया। कार्यक्षेत्र में प्रत्येक ऐप पर साझा किया गया।
2. **ऐप-रूट `mcp.config.json`** - यदि आप नहीं चाहते कि प्रत्येक ऐप में MCP सर्वर उपलब्ध हो तो प्रति-ऐप ओवरराइड।
3. **`MCP_SERVERS` env var** - समान आकार वाली JSON स्ट्रिंग, CI/उत्पादन के लिए जहां फ़ाइल का कोई मतलब नहीं है।

## उत्पादन परिनियोजन: `MCP_SERVERS` {#mcp-servers-env}

उत्पादन परिनियोजन के लिए, दूरस्थ HTTP MCP सर्वर को प्राथमिकता दें और पूर्ण कॉन्फ़िगरेशन सेट करें
एक पर्यावरण चर के रूप में आकार (या आंतरिक सर्वर मानचित्र):

```bash
MCP_SERVERS='{"servers":{"zapier":{"type":"http","url":"https://mcp.example.com/mcp","headers":{"Authorization":"Bearer paste-token-value-here"}}}}'
```

`MCP_SERVERS` को JSON के रूप में पार्स किया गया है, इसलिए `${...}` प्लेसहोल्डर्स का विस्तार नहीं किया गया है
स्ट्रिंग के अंदर। यदि आप टोकन को किसी अन्य गुप्त स्थान पर संग्रहीत करते हैं, तो पहले उसका विस्तार करें
अंतिम JSON मान लिखना।

Stdio MCP सर्वर स्थानीय बायनेरिज़ उत्पन्न करते हैं और स्थानीय विकास के लिए अभिप्रेत हैं।
MCP उपकरण केवल नोड रनटाइम में सक्रिय होते हैं - क्लाउडफ्लेयर वर्कर्स और अन्य एज
लक्ष्य चुपचाप MCP को छोड़ दें और बाकी ऐप के साथ काम करना जारी रखें
सामान्यतः।

## स्वतः पता लगाएं: `claude-in-chrome` {#autodetect}

यदि आपके पास **नहीं** `mcp.config.json` है और `claude-in-chrome-mcp` बाइनरी `PATH` पर है (या प्रसिद्ध इंस्टॉल स्थान `~/.claude-in-chrome/bin/claude-in-chrome-mcp` में है), तो एजेंट-नेटिव इसे डिफ़ॉल्ट MCP सर्वर के रूप में स्वचालित रूप से पंजीकृत करता है। ऑप्ट आउट करने के लिए `AGENT_NATIVE_DISABLE_MCP_AUTODETECT=1` सेट करें।

इसका मतलब है कि जिन उपयोगकर्ताओं ने क्लाउड-इन-क्रोम एक्सटेंशन इंस्टॉल किया है, उन्हें बिना किसी कॉन्फिग बदलाव के उनके द्वारा खोले जाने वाले प्रत्येक एजेंट-नेटिव ऐप पर ब्राउज़र नियंत्रण मिलता है।

## सेटिंग्स UI के माध्यम से दूरस्थ MCP सर्वर {#remote-via-ui}

MCP (मॉडल कॉन्टेक्स्ट प्रोटोकॉल) सर्वर आपके एजेंट को नई क्षमताएं देते हैं - जैसे जैपियर, क्लाउडफ्लेयर, कंपोज़ियो या आपकी कंपनी के आंतरिक टूल से कनेक्ट करना। एक बार कनेक्ट होने के बाद, एजेंट उन टूल्स का उपयोग अपने बिल्ट-इन टूल्स की तरह ही कर सकता है।

### दूरस्थ MCP सर्वर कैसे कनेक्ट करें

1. **सर्वर नाम** — आपके स्वयं के संदर्भ के लिए एक संक्षिप्त लेबल (उदाहरण के लिए "ज़ैपियर", "स्लैक-टूल्स")।
2. **URL** - MCP सर्वर प्रदाता द्वारा आपको दिया गया HTTPS एंडपॉइंट (उदाहरण के लिए `https://mcp.zapier.com/s/abc123/mcp`)। यह आमतौर पर प्रदाता के डैशबोर्ड या एकीकरण दस्तावेज़ों में पाया जाता है।
3. **विवरण** (वैकल्पिक) - यह सर्वर क्या करता है इसके बारे में एक नोट।
4. **हेडर** - सर्वर को प्रमाणीकरण क्रेडेंशियल की आवश्यकता होती है, प्रति पंक्ति एक। अधिकांश सर्वरों को `Authorization` हेडर की आवश्यकता होती है। उदाहरण: `Authorization: Bearer sk-your-key-here`. प्रदाता के दस्तावेज़ आपको बताएंगे कि यहां क्या डालना है।

सहेजने से पहले कनेक्शन सत्यापित करने के लिए **परीक्षण** पर क्लिक करें। यदि यह सफल होता है, तो आप उपलब्ध टूल की संख्या देखेंगे। इसे जोड़ने के लिए **कनेक्ट** पर क्लिक करें।

### व्यक्तिगत बनाम संगठन का दायरा

दो दायरे समर्थित हैं:

- **व्यक्तिगत** - केवल साइन-इन उपयोगकर्ता को ही उपकरण मिलते हैं। उपयोगकर्ता-क्षेत्र सेटिंग के रूप में संग्रहीत।
- **टीम** - सक्रिय संगठन में सभी को उपकरण मिलते हैं। स्वामी और व्यवस्थापक जोड़ सकते हैं; सदस्य सूची को केवल पढ़ने के लिए देखते हैं। एक ऑर्ग-स्कोप सेटिंग के रूप में संग्रहीत।

चल रहे MCP प्रबंधक में हॉट-रीलोड जोड़ता और हटाता है - कोई प्रक्रिया पुनरारंभ नहीं होती, और कोई सर्वर पुनरारंभ नहीं होता। नए `mcp__<scope>-<name>__*` उपकरण अगले संदेश पर एजेंट को दिखाई देते हैं और `tool-search` के माध्यम से खोजे जा सकते हैं।

HTTPS URLs हर जगह स्वीकार किए जाते हैं; विकास के दौरान केवल `localhost` के लिए सादे `http://` की अनुमति है। वैकल्पिक प्रमाणीकरण एक बियरर टोकन के रूप में जाता है जो प्रत्येक अनुरोध पर `Authorization: Bearer …` के माध्यम से भेजा जाता है।

हुड के तहत ये सर्वर फ्रेमवर्क की `settings` तालिका में कुंजी `u:<email>:mcp-servers-remote` (व्यक्तिगत) या `o:<orgId>:mcp-servers-remote` (टीम) के तहत बने रहते हैं और स्टार्टअप पर `mcp.config.json` के साथ विलय हो जाते हैं।

### HTTP समापन बिंदु

| विधि   | मार्ग                                                 | उद्देश्य                                                                          |
| ------ | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| GET    | `/_agent-native/mcp/servers`                          | वर्तमान उपयोगकर्ता के व्यक्तिगत + ऑर्ग सर्वर को लाइव स्थिति के साथ सूचीबद्ध करें। |
| POST   | `/_agent-native/mcp/servers`                          | एक सर्वर जोड़ें. बॉडी: `{ scope, name, url, headers?, description? }`.            |
| DELETE | `/_agent-native/mcp/servers/:id?scope=user\|org`      | Remove a server and reconfigure the manager.                                      |
| POST   | `/_agent-native/mcp/servers/:id/test?scope=user\|org` | Dry-run the existing server's connect + list-tools.                               |
| POST   | `/_agent-native/mcp/servers/test`                     | जारी रखने से पहले एक मनमाना URL को ड्राई-रन करें। बॉडी: `{ url, headers? }`.      |

Stdio सर्वर अभी भी नोड रनटाइम के बाहर एक नो-ऑप हैं, लेकिन दूरस्थ HTTP MCP सर्वर `fetch` के साथ किसी भी वातावरण में काम करते हैं - जिसमें डेस्कटॉप उत्पादन बिल्ड भी शामिल है।

## एक हब के माध्यम से साझा MCP सर्वर {#hub}

यदि आपका कार्यक्षेत्र कई एजेंट-नेटिव ऐप्स (उदाहरण के लिए डिस्पैच + मेल + क्लिप) चलाता है, तो आप **एक** ऐप को हब के रूप में कॉन्फ़िगर कर सकते हैं और अन्य को इसके ऑर्ग-स्कोप MCP सर्वर को स्वचालित रूप से खींचने के लिए कह सकते हैं। URLs और बियरर टोकन की कोई प्रति-ऐप कॉपी-पेस्ट नहीं। डिस्पैच वर्कस्पेस MCP संसाधनों का उपयोग करके विहित दृष्टिकोण के लिए [Multi-App Workspace](/docs/multi-app-workspace) देखें।

डिस्पैच पारंपरिक हब है - यह पहले से ही सभी ऐप्स में समन्वय करता है।

```an-diagram title="हब मॉडल: एक ऐप ऑर्ग-स्कोप MCP सर्वर पर कार्य करता है" summary="Dispatch ऑर्ग-स्कोप MCP सर्वर रखता है; उपभोक्ता ऐप्स उन्हें mcp__hub_<orgId>_<name>__* के रूप में खींचते और मर्ज करते हैं। केवल ऑर्ग-स्कोप पंक्तियाँ साझा की जाती हैं - व्यक्तिगत क्रेडेंशियल यथावत रहते हैं।"
{
  "html": "<div class=\"mcp-hub\"><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Dispatch hub</span><small class=\"diagram-muted\">org-scope MCP सर्वर</small><small class=\"diagram-muted\"><code>GET /mcp/hub/servers</code></small></div><div class=\"diagram-col arrows\"><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div></div><div class=\"diagram-col consumers\"><div class=\"diagram-box\" data-rough>Mail<br><small class=\"diagram-muted\"><code>mcp__hub_&lt;orgId&gt;_&lt;name&gt;__*</code></small></div><div class=\"diagram-box\" data-rough>Clips<br><small class=\"diagram-muted\">हर ~60 सेकंड pull + merge</small></div></div></div><p class=\"diagram-muted note\">Bearer-gated by <code>AGENT_NATIVE_MCP_HUB_TOKEN</code>. Personal (user-scope) servers are never re-exposed.</p>",
  "css": ".mcp-hub{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.mcp-hub .center{display:flex;flex-direction:column;align-items:center;gap:4px}.mcp-hub .diagram-col{display:flex;flex-direction:column;gap:10px}.mcp-hub .arrows .diagram-arrow{font-size:22px;line-height:1}.mcp-hub .note{margin:8px 0 0;font-size:.85em}.mcp-hub code{font-size:.85em}"
}
```

नए कार्यस्थान सेटअप के लिए, **जब आप कार्यस्थान MCP संसाधन भेजें** को प्राथमिकता दें
कार्यस्थान skills द्वारा उपयोग किया जाने वाला समान ऑल-ऐप बनाम चयनित-ऐप अनुदान मॉडल चाहते हैं,
निर्देश, और संदर्भ संसाधन। इसके साथ एक कार्यस्थान संसाधन जोड़ें:

```json
{
  "type": "http",
  "url": "https://example.com/mcp",
  "headers": {
    "Authorization": "Bearer ${keys.MCP_SERVER_TOKEN}"
  },
  "description": "Shared MCP टूलs for workspace apps"
}
```

इसे `mcp-server` के साथ `mcp-servers/<name>.json` के अंतर्गत सहेजें। ऑल-ऐप
संसाधन प्रत्येक कार्यक्षेत्र ऐप द्वारा लोड किए जाते हैं; चयनित संसाधन केवल
सक्रिय डिस्पैच अनुदान वाले ऐप्स। गुप्त प्लेसहोल्डर ऐप से हल होते हैं
गुप्त भंडार, इसलिए कच्चे वाहक टोकन को डिस्पैच वॉल्ट में रखें और उनका संदर्भ लें
उन्हें संसाधन निकाय में संग्रहीत करने के बजाय `${keys.NAME}` के साथ।

ऐप्स अपने मर्ज किए गए MCP कॉन्फिगरेशन को लगभग एक मिनट में एक बार रीफ्रेश करते हैं, इसलिए केंद्रीय संसाधन
संपादन, अनुदान परिवर्तन और निष्कासन बिना परिनियोजन के प्रभावी होते हैं। सेट करें
`AGENT_NATIVE_MCP_CONFIG_REFRESH_MS=0` उस बैकग्राउंड रिफ्रेश को अक्षम करने के लिए, या
अंतराल को ट्यून करने के लिए इसे कम से कम `5000` मिलीसेकंड के मान पर सेट करें।

नीचे दिया गया पुराना हब मोड मोटे तौर पर "हर ऑर्ग-स्कोप MCP को साझा करने" के लिए उपयोगी रहता है
डिस्पैच से सर्वर” सेटअप और तैनाती के लिए जो पहले से ही MCP का उपयोग करते हैं
UI को सत्य के स्रोत के रूप में सेट करें।

### 1. हब ऐप (प्रेषण) पर हब-सर्व सक्षम करें

डिस्पैच के परिनियोजन में एक env var सेट करें:

```bash
AGENT_NATIVE_MCP_HUB_TOKEN=<a-long-random-secret>
```

डिस्पैच अब `GET /_agent-native/mcp/hub/servers` को माउंट करता है जो अपनी `settings` तालिका में संग्रहीत प्रत्येक ऑर्ग-स्कोप MCP सर्वर को पूर्ण URL + हेडर के साथ, टोकन द्वारा प्रमाणित करता है।

### 2. हब पर पॉइंट उपभोग करने वाले ऐप्स

प्रत्येक उपभोक्ता पर सेट करें (मेल, क्लिप, जो भी हो):

```bash
AGENT_NATIVE_MCP_HUB_URL=https://dispatch.acme.com
AGENT_NATIVE_MCP_HUB_TOKEN=<the-same-secret>
```

स्टार्टअप पर, प्रत्येक उपभोक्ता हब की सर्वर सूची खींचता है और इसे अपने स्वयं के MCP प्रबंधक में विलय कर देता है। एजेंट को उपकरण `mcp__hub_<orgId>_<name>__*` के रूप में दिखाई देते हैं - उपभोक्ता के अपने स्थानीय `mcp__org_…` से अलग, इसलिए कोई टकराव नहीं होता है।

### 3. क्या साझा किया जाता है

केवल **ऑर्ग-स्कोप** सर्वर साझा किए जाते हैं। उपयोगकर्ता-स्कोप (व्यक्तिगत) सर्वर उस उपयोगकर्ता के पास रहते हैं जिसने उन्हें जोड़ा है - हब कभी भी ऐप्स में व्यक्तिगत क्रेडेंशियल्स को दोबारा उजागर नहीं करता है।

हब प्रतिक्रियाओं में पूर्ण ऑथ हेडर (बियरर टोकन आदि) शामिल हैं। ट्रांसपोर्ट HTTPS है, समापन बिंदु को साझा रहस्य की आवश्यकता होती है, और यह केवल ऑर्ग-स्कोप पंक्तियाँ लौटाता है - हब URL + टोकन को डेटाबेस क्रेडेंशियल की तरह मानें।

### 4. हॉट रीलोड बनाम रीस्टार्ट

स्थानीय UI प्रत्येक ऐप में `McpClientManager.reconfigure()` के माध्यम से हॉट-रीलोड जोड़ता है - कोई पुनरारंभ नहीं। हब-सोर्स किए गए सर्वरों को उसी आवधिक बैकग्राउंड रिफ्रेश (लगभग 60 सेकंड, `AGENT_NATIVE_MCP_CONFIG_REFRESH_MS` के माध्यम से ट्यून करने योग्य या अक्षम करने योग्य) द्वारा उठाया जाता है, जिसे वर्कस्पेस संसाधन पथ उपयोग करता है, इसलिए डिस्पैच में किए गए परिवर्तन बिना पुनरारंभ किए लगभग एक मिनट के भीतर सभी उपभोक्ता ऐप्स में प्रसारित हो जाते हैं। इसके अतिरिक्त, किसी उपभोक्ता ऐप में कोई भी स्थानीय उत्परिवर्तन तुरंत उस ऐप के लिए पुन: कॉन्फ़िगर को ट्रिगर कर देता है।

### समाप्ति बिंदु सारांश

| विधि | मार्ग                            | उद्देश्य                                                                                                                                 |
| ---- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | `/_agent-native/mcp/hub/servers` | सभी ऑर्ग-स्कोप सर्वरों को पूर्ण क्रेडिट के साथ परोसें (बेयरर-गेटेड, केवल तभी माउंट किया जाता है जब `AGENT_NATIVE_MCP_HUB_TOKEN` सेट हो)। |
| GET  | `/_agent-native/mcp/hub/status`  | सेटिंग्स UI कार्ड के लिए `{ serving, consuming, hubUrl }` लौटाता है।                                                                     |

## स्थिति मार्ग {#status-route}

प्रत्येक ऐप टूलींग और ऑनबोर्डिंग के लिए `GET /_agent-native/mcp/status` को उजागर करता है:

```an-api
{
  "method": "GET",
  "path": "/_agent-native/mcp/status",
  "summary": "टूलींग और ऑनबोर्डिंग के लिए MCP क्लाइंट स्थिति",
  "description": "Reports which configured servers connected, the total live tool count, the merged prefixed tool list, and any per-server connection errors. Use it to build \"detected — your agent can now drive X\" hints or to debug connection problems.",
  "responses": [
    {
      "status": "200",
      "description": "Configured vs connected servers, tool inventory, and per-server errors.",
      "example": "{\n  \"configuredServers\": [\"claude-in-chrome\", \"playwright\"],\n  \"connectedServers\": [\"claude-in-chrome\", \"playwright\"],\n  \"totalTools\": 21,\n  \"tools\": [\n    {\n      \"source\": \"claude-in-chrome\",\n      \"name\": \"mcp__claude-in-chrome__navigate\",\n      \"description\": \"Navigate the browser to a URL\"\n    }\n  ],\n  \"errors\": {}\n}"
    }
  ]
}
```

```json
{
  "configuredServers": ["claude-in-chrome", "playwright"],
  "connectedServers": ["claude-in-chrome", "playwright"],
  "totalTools": 21,
  "tools": [
    {
      "source": "claude-in-chrome",
      "name": "mcp__claude-in-chrome__navigate",
      "description": "Navigate the browser to a URL"
    }
  ],
  "errors": {}
}
```

इसका उपयोग "क्लाउड-इन-क्रोम का पता चला - आपका एजेंट अब क्रोम चला सकता है" ऑनबोर्डिंग संकेत बनाने या MCP कनेक्शन समस्याओं को डीबग करने के लिए करें।

## विफलता मोड {#failures}

व्यक्तिगत MCP सर्वर विफलताएं कभी भी एजेंट को निष्क्रिय नहीं करतीं:

- एक गलत कॉन्फ़िगर किया गया `command` → सर्वर छोड़ दिया गया है, इसकी त्रुटि `errors.<server-id>` के तहत `/mcp/status` में दिखाई देती है, और हर दूसरा सर्वर काम करना जारी रखता है।
- MCP SDK `node_modules` से गायब है → सभी MCP कार्यक्षमता एक चेतावनी के साथ छोड़ दी गई है; एजेंट चैट शून्य MCP टूल के साथ काम करती रहती है।
- एज रनटाइम में चल रहा है → MCP क्लाइंट नो-ऑप है।

एजेंट-नेटिव हमेशा बूट होगा; टूटे हुए MCP कॉन्फ़िगरेशन का मतलब केवल कम उपकरण हैं।

## सुरक्षा {#security}

MCP उपकरण आपकी मशीन पर उत्पन्न प्रक्रिया की सभी अनुमतियों के साथ चलते हैं। `mcp.config.json` को किसी अन्य निष्पादन योग्य सूची की तरह समझें जिसे आप एजेंट को चलाने देना चाहते हैं। MCP सर्वर के उपकरण आपके टेम्पलेट के actions की तरह ही एजेंट के टूल-उपयोग लूप में दिखाई देते हैं, इसलिए सुनिश्चित करें कि आप अपने द्वारा कॉन्फ़िगर किए गए प्रत्येक सर्वर पर भरोसा करते हैं।
