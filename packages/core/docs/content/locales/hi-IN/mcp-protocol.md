---
title: "MCP प्रोटोकॉल"
description: "अपने एजेंट-नेटिव ऐप को एक दूरस्थ MCP सर्वर के रूप में प्रदर्शित करें ताकि Claude, ChatGPT, Claude कोड, कर्सर और अन्य AI उपकरण सीधे आपके ऐप के actions को कॉल कर सकें।"
---

# MCP प्रोटोकॉल

**यह पृष्ठ: निम्न-स्तरीय MCP सर्वर संदर्भ।** कैसे प्रत्येक एजेंट-मूल ऐप अपने actions को MCP पर प्रदर्शित करता है - ऑटो-माउंटेड एंडपॉइंट, ऑथ मोड, `tools/call` / `ask-agent` सतह और कस्टम माउंटिंग। जब आपको सर्वर आंतरिक की आवश्यकता हो तो इसके लिए पहुंचें; किसी होस्ट को कनेक्ट करने के लिए, [External Agents](/docs/external-agents) से प्रारंभ करें।

| यदि आप चाहते हैं…                                               | पढ़ें                                    |
| --------------------------------------------------------------- | ---------------------------------------- |
| किसी बाहरी एजेंट/होस्ट को अपने ऐप से कनेक्ट करें                | [External Agents](/docs/external-agents) |
| अपने एजेंट को अधिक टूल दें (अन्य MCP सर्वर का उपभोग करें)       | [MCP Clients](/docs/mcp-clients)         |
| इनलाइन UI बनाएं जो Claude/ChatGPT में प्रस्तुत हों              | [MCP Apps](/docs/mcp-apps)               |
| निचले स्तर का MCP सर्वर संदर्भ (प्रमाणीकरण, उपकरण, कस्टम माउंट) | **यह पृष्ठ** — MCP प्रोटोकॉल             |

प्रत्येक एजेंट-नेटिव ऐप स्वचालित रूप से एक दूरस्थ MCP (मॉडल कॉन्टेक्स्ट प्रोटोकॉल) सर्वर को उजागर करता है, इसलिए बाहरी AI उपकरण जैसे Claude, ChatGPT कस्टम MCP ऐप्स, Claude कोड, कर्सर, Codex और VS कोड GitHub कोपायलट आपके ऐप के actions को सीधे खोज और कॉल कर सकते हैं - कोई अतिरिक्त कोड नहीं जरुरत. यदि आपका लक्ष्य उन होस्टों में से किसी एक को होस्ट किए गए ऐप से कनेक्ट करना है, तो [External Agents](/docs/external-agents) अनुशंसित सिंगल डिस्पैच कनेक्टर, प्रति-ऐप URLs, OAuth, MCP ऐप्स इनलाइन UIs और डीप लिंक को कवर करता है। यह पृष्ठ उसके नीचे जो कुछ है उसका दस्तावेजीकरण करता है।

## अवलोकन {#overview}

MCP AI टूल को बाहरी क्षमताओं से जोड़ने के लिए मानक प्रोटोकॉल है। जब आप एक एजेंट-नेटिव ऐप तैनात करते हैं, तो यह मौजूदा A2A एंडपॉइंट के साथ एक MCP एंडपॉइंट को स्वचालित रूप से माउंट करता है। कोई भी MCP-संगत क्लाइंट आपके ऐप के टूल से कनेक्ट और उपयोग कर सकता है।

मुख्य अवधारणाएँ:

- **ऑटो-माउंटेड** - प्रत्येक ऐप को मुफ्त में `/_agent-native/mcp` मिलता है, किसी सेटअप की आवश्यकता नहीं है
- **स्ट्रीम करने योग्य HTTP** - मानक HTTP (POST + SSE) की तुलना में आधुनिक MCP परिवहन का उपयोग करता है
- **वही actions** - बिल्कुल वही एक्शन रजिस्ट्री जो एजेंट चैट और A2A को शक्ति प्रदान करती है
- **`ask-agent` टूल** - एक मेटा-टूल जो जटिल कार्यों के लिए पूर्ण एजेंट लूप को सौंपता है
- **MCP ऐप्स** - actions आधिकारिक `io.modelcontextprotocol/ui` एक्सटेंशन के माध्यम से इंटरैक्टिव UI संसाधनों का विज्ञापन कर सकता है
- **मानक रिमोट MCP OAuth** - OAuth 2.1 खोज, गतिशील ग्राहक पंजीकरण, प्राधिकरण-कोड + PKCE, ताज़ा-टोकन रोटेशन
- **बियरर ऑथ फ़ॉलबैक** - उन ग्राहकों के लिए `ACCESS_TOKEN`, `ACCESS_TOKENS`, या कनेक्ट-मिंटेड JWT का उपयोग करता है जो OAuth नहीं चला सकते

```an-diagram title="आपका ऐप MCP सर्वर के रूप में" summary="बाहरी होस्ट स्ट्रीम करने योग्य HTTP से जुड़ते हैं। प्रत्येक क्रिया एक उपकरण है; आस्क-एजेंट पूर्ण एजेंट लूप को सौंपता है।"
{
  "html": "<div class=\"diagram-mcp\"><div class=\"diagram-col\"><div class=\"diagram-node\">Claude</div><div class=\"diagram-node\">ChatGPT</div><div class=\"diagram-node\">Cursor · Codex</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\"><span class=\"diagram-pill accent\">POST /_agent-native/mcp</span><small class=\"diagram-muted\">Streamable HTTP</small><small class=\"diagram-muted\">initialize &rarr; tools/list &rarr; tools/call</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\" data-rough>each action<br><small class=\"diagram-muted\">= one tool</small></div><div class=\"diagram-box\" data-rough>ask-agent<br><small class=\"diagram-muted\">&rarr; full agent loop</small></div></div></div>",
  "css": ".diagram-mcp{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.diagram-mcp .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-mcp .diagram-panel{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-mcp .diagram-arrow{font-size:20px;line-height:1}"
}
```

## MCP बनाम A2A {#mcp-vs-a2a}

दोनों प्रोटोकॉल ऑटो-माउंटेड हैं। जो भी आपके उपयोग के मामले में फिट बैठता है उसका उपयोग करें:

|                      | MCP                                                                  | A2A                                           |
| -------------------- | -------------------------------------------------------------------- | --------------------------------------------- |
| **के लिए सर्वोत्तम** | बाहरी उपकरण आपके ऐप को कॉल कर रहे हैं                                | एजेंट-टू-एजेंट संचार                          |
| **प्रोटोकॉल**        | MCP स्ट्रीम करने योग्य HTTP                                          | JSON-RPC 2.0                                  |
| **उपकरण खोज**        | `tools/list`                                                         | `/.well-known/agent-card.json` पर एजेंट कार्ड |
| **समापनबिंदु**       | `/_agent-native/mcp`                                                 | `/_agent-native/a2a`                          |
| **समर्थित**          | Claude, ChatGPT, Claude कोड, कर्सर, Codex, कोवर्क, और अन्य MCP होस्ट | अन्य एजेंट-मूल ऐप्स                           |
| **निष्पादन**         | डायरेक्ट टूल कॉल (कोई अतिरिक्त LLM नहीं)                             | पूर्ण एजेंट लूप (LLM तर्क)                    |

आप दोनों दुनियाओं का सर्वश्रेष्ठ प्राप्त करने के लिए `ask-agent` MCP टूल का भी उपयोग कर सकते हैं - इसे Claude कोड से कॉल करें और अपने ऐप के एजेंट को जटिल कार्यों के माध्यम से तर्क करने दें।

## मैन्युअल MCP क्लाइंट कॉन्फिगरेशन {#manual-config}

अनुशंसित एक-कमांड सेटअप के लिए, [External Agents](/docs/external-agents) का उपयोग करें। यदि आप OAuth-सक्षम क्लाइंट के लिए MCP कॉन्फिगरेशन को हाथ से लिख रहे हैं, तो अपने ऐप को बिना किसी स्थिर हेडर के रिमोट MCP सर्वर के रूप में जोड़ें:

```bash
claude mcp add --transport http mail https://mail.example.com/_agent-native/mcp
```

या `.mcp.json` (प्रोजेक्ट स्कोप) या `~/.claude.json` (यूजर स्कोप) में हाथ से प्रविष्टि लिखें:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "mail": {
      "type": "http",
      "url": "https://mail.example.com/_agent-native/mcp",
    },
  },
}
```

फिर Claude कोड में `/mcp` चलाएं और **प्रमाणीकृत** चुनें। उन ग्राहकों के लिए जो दूरस्थ MCP OAuth नहीं कर सकते हैं, कनेक्ट पेज या `headers.Authorization` के साथ एक स्थिर बियरर-टोकन प्रविष्टि का उपयोग करें। एक बार प्रमाणित होने के बाद, आप स्वाभाविक रूप से अपने ऐप के टूल का उपयोग कर सकते हैं:

```
> draft an email to John about the Q3 report

Claude Code calls: draft-email(to: "john@example.com", subject: "Q3 Report", body: "...")
```

## अन्य MCP क्लाइंट से कनेक्ट हो रहा है {#other-clients}

कोई भी MCP क्लाइंट जो स्ट्रीम करने योग्य HTTP ट्रांसपोर्ट का समर्थन करता है, कनेक्ट हो सकता है। अंतिमबिंदु है:

```
POST https://your-app.example.com/_agent-native/mcp
```

सर्वर मानक MCP हैंडशेक का समर्थन करता है: `initialize` → `initialized` → `tools/list` → `tools/call`।

```an-api title="MCP समापन बिंदु" summary="ऑटो-माउंटेड स्ट्रीमेबल HTTP एंडपॉइंट प्रत्येक एजेंट-नेटिव ऐप को उजागर करता है।"
{
  "method": "POST",
  "path": "/_agent-native/mcp",
  "summary": "MCP स्ट्रीम करने योग्य HTTP समापन बिंदु",
  "description": "Auto-mounted on every app. Speaks the standard MCP handshake (`initialize` → `initialized` → `tools/list` → `tools/call`) plus `resources/list`, `resources/templates/list`, and `resources/read` when an action declares `mcpApp`. Each action maps to one tool; `ask-agent` delegates to the full agent loop.",
  "auth": "Standard remote MCP OAuth (Bearer access token), connect-minted JWT, or static ACCESS_TOKEN/ACCESS_TOKENS",
  "params": [
    { "name": "Authorization", "in": "header", "type": "string", "required": false, "description": "Bearer access token. Required except for loopback local-dev probes." },
    { "name": "method", "in": "body", "type": "string", "required": true, "description": "MCP method, e.g. initialize, tools/list, tools/call." }
  ],
  "request": {
    "contentType": "application/json",
    "example": "{\n  \"jsonrpc\": \"2.0\",\n  \"id\": 1,\n  \"method\": \"tools/call\",\n  \"params\": {\n    \"name\": \"ask-agent\",\n    \"arguments\": { \"message\": \"Summarize Q3 signups by source\" }\n  }\n}"
  },
  "responses": [
    { "status": "200", "description": "MCP result (POST + SSE)." },
    { "status": "401", "description": "Unauthenticated — responds with a WWW-Authenticate header pointing at OAuth discovery." }
  ]
}
```

यदि कोई कार्रवाई `mcpApp` घोषित करती है, तो सर्वर आधिकारिक MCP ऐप्स एक्सटेंशन (`io.modelcontextprotocol/ui`) का भी विज्ञापन करता है और ऐप संसाधन के लिए `resources/list`, `resources/templates/list` और `resources/read` का समर्थन करता है। MCP ऐप्स प्रस्तुत करने वाले होस्ट UI इनलाइन दिखा सकते हैं; जो होस्ट अभी भी टूल को कॉल नहीं कर सकते हैं और डीप-लिंक फ़ॉलबैक का उपयोग कर सकते हैं। उत्पाद UIs को `embedApp()` का उपयोग करना चाहिए ताकि इनलाइन सतह वास्तविक React ऐप मार्ग हो, या एक केंद्रित मार्ग जो एक साझा React घटक जैसे एनालिटिक्स चार्ट प्रस्तुत करता है, न कि एक अलग सादा HTML कार्यान्वयन। सर्वर मानक MCP ऐप्स मेटाडेटा और ChatGPT ऐप्स SDK संगतता मेटाडेटा दोनों उत्सर्जित करता है ताकि ऐप-सक्षम होस्ट समान `ui://` संसाधन पा सकें। वर्तमान आधिकारिक एक्सटेंशन मैट्रिक्स में Claude, Claude डेस्कटॉप, VS कोड GitHub कोपायलट, गूज़, पोस्टमैन, MCPJam, ChatGPT और कर्सर शामिल हैं; होस्ट समर्थन संस्करण और योजना के अनुसार भिन्न होता है, इसलिए उपयोगकर्ता-सामना मार्गदर्शन के लिए [External Agents MCP Apps notes](/docs/external-agents#mcp-apps-compatibility) का उपयोग करें।

### MCP ऐप एंबेड ब्रिज {#mcp-app-embed-bridge}

`embedApp()` निम्न-स्तरीय URL-पहला MCP ऐप सहायक है: यह एक हस्ताक्षरित ऐप लॉन्च करता है
प्रत्यारोपण (Claude), नियंत्रित-फ़्रेम (ChatGPT), या प्रत्यक्ष के माध्यम से रूट इनलाइन
नेविगेशन, `ui/*` JSON-RPC ब्रिज (और
`agentNative.mcpHost.*` नियंत्रित-फ़्रेम पथ के लिए पोस्टमैसेज रिले), और
संसाधन शेल ऊंचाई को क्लैंप करता है ताकि पूर्ण-ऐप रूट एक के रूप में प्रस्तुत न हो
बड़े आकार का चैट आर्टिफैक्ट।

पूर्ण एम्बेड ब्रिज विवरण के लिए [MCP Apps](/docs/mcp-apps#mcp-app-bridge) देखें - ट्रांसप्लांट बनाम नियंत्रित-फ़्रेम, `ui/*` और पोस्टमैसेज टेबल, `create_embed_session` / `embedStartUrl`, CSP और डोमेन नियम, एक्सटेंशन `srcDoc` एम्बेडिंग, ऊंचाई क्लैंपिंग, और होस्ट ब्रिज क्लाइंट API।

## उपकरण {#tools}

प्रत्येक कॉल करने वाले को **डिफ़ॉल्ट रूप से एक कॉम्पैक्ट कैटलॉग** (टेम्पलेट-घोषित ऐप actions प्लस क्रॉस-ऐप बिल्टिन) मिलता है, जिसमें पूरी कार्रवाई सतह केवल स्पष्ट ऑप्ट-इन पर दी जाती है और `tool-search` हमेशा बाकी तक पहुंचने के लिए उपलब्ध होता है। संपूर्ण स्पष्टीकरण के लिए [External Agents → Catalog tiers](/docs/external-agents#catalog-tiers) देखें।

प्रत्येक क्रिया सीधे एक MCP टूल पर मैप होती है:

| क्रिया संपत्ति     | MCP टूल प्रॉपर्टी |
| ------------------ | ----------------- |
| `tool.description` | `description`     |
| `tool.parameters`  | `inputSchema`     |
| कार्रवाई का नाम    | टूल का नाम        |

जब `mcpApp` मौजूद होता है, तो टूल प्रविष्टि में `_meta.ui.resourceUri`, `_meta["ui/resourceUri"]`, और `_meta["openai/outputTemplate"]` भी शामिल होते हैं, और संबंधित `ui://` संसाधन `text/html;profile=mcp-app` के रूप में लौटाया जाता है।

### `ask-agent` टूल {#ask-agent}

व्यक्तिगत एक्शन टूल के अलावा, प्रत्येक MCP सर्वर में एक `ask-agent` मेटा-टूल शामिल होता है। यह ऐप के AI एजेंट को एक प्राकृतिक भाषा में संदेश भेजता है और प्रतिक्रिया देता है।

जटिल कार्यों के लिए `ask-agent` का उपयोग करें जो एजेंट के तर्क और संदर्भ से लाभान्वित हों:

```json
{
  "name": "ask-agent",
  "arguments": {
    "message": "Draft a follow-up email to the Q3 planning thread with John, summarizing the action items we discussed"
  }
}
```

एजेंट इंटरैक्टिव चैट के समान लूप चलाता है - यह कई टूल को कॉल कर सकता है, संदर्भ के बारे में तर्क कर सकता है और एक विचारशील प्रतिक्रिया दे सकता है।

## प्रमाणीकरण {#authentication}

MCP एंडपॉइंट मानक रिमोट MCP OAuth प्लस मौजूदा बियरर-टोकन फ़ॉलबैक का समर्थन करता है:

| मोड                           | यह कैसे काम करता है                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| मानक MCP OAuth                | क्लाइंट `WWW-Authenticate` से प्रमाणीकरण खोजता है, रजिस्टर करता है, PKCE चलाता है, और `Authorization: Bearer <access-token>` भेजता है |
| कनेक्ट-मिंटेड JWT             | `npx @agent-native/core@latest connect` / कनेक्ट पेज प्रति-उपयोगकर्ता, प्रतिसंहरणीय JWT बनाता है                                      |
| `ACCESS_TOKEN`                | स्टेटिक बियरर टोकन - क्लाइंट `Authorization: Bearer <token>` भेजता है                                                                 |
| `ACCESS_TOKENS`               | मान्य स्थिर वाहक टोकन की अल्पविराम से अलग की गई सूची                                                                                  |
| `A2A_SECRET`                  | JWT-आधारित प्रमाणीकरण - टोकन को क्रिप्टोग्राफ़िक रूप से सत्यापित किया जाता है                                                         |
| _(कोई सेट नहीं, केवल लूपबैक)_ | स्थानीय विकास जांच के लिए किसी प्रमाणीकरण की आवश्यकता नहीं है                                                                         |

OAuth-सक्षम MCP होस्ट के लिए, बिना किसी स्थिर हेडर के रिमोट सर्वर URL को कॉन्फ़िगर करें:

```bash
claude mcp add --transport http agent-native https://dispatch.agent-native.com/_agent-native/mcp
```

पहला अप्रमाणित MCP अनुरोध प्राप्त होता है:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://dispatch.agent-native.com/.well-known/oauth-protected-resource", scope="mcp:read mcp:write mcp:apps"
```

खोज समापन बिंदु:

| अंतबिंदु                                  | उद्देश्य                           |
| ----------------------------------------- | ---------------------------------- |
| `/.well-known/oauth-protected-resource`   | RFC 9728 संरक्षित-संसाधन मेटाडेटा  |
| `/.well-known/oauth-authorization-server` | OAuth प्राधिकरण सर्वर मेटाडेटा     |
| `/_agent-native/mcp/oauth/register`       | डायनामिक पब्लिक-क्लाइंट पंजीकरण    |
| `/_agent-native/mcp/oauth/authorize`      | ब्राउज़र प्राधिकरण + सहमति         |
| `/_agent-native/mcp/oauth/token`          | प्राधिकरण-कोड और ताज़ा-टोकन अनुदान |

```an-diagram title="OAuth खोज प्रवाह" summary="401 खोज, पंजीकरण और PKCE अधिकृत → टोकन एक्सचेंज को शुरू करता है। बियरर टोकन ऑडियंस-बाउंड और स्कोप्ड है।"
{
  "html": "<div class=\"diagram-oauth\"><div class=\"diagram-box\" data-rough>first request<br><small class=\"diagram-muted\">no token</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill warn\">401 · WWW-Authenticate</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\"><span class=\"diagram-pill\">/.well-known/oauth-protected-resource</span><span class=\"diagram-pill\">/.well-known/oauth-authorization-server</span><small class=\"diagram-muted\">discover</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">register</div><div class=\"diagram-pill\">authorize (PKCE)</div><div class=\"diagram-pill\">token</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Bearer access token<br><small class=\"diagram-muted\">audience से बंधा · mcp:read / write / apps स्कोप</small></div></div>",
  "css": ".diagram-oauth{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-oauth .diagram-panel{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-oauth .diagram-col{display:flex;flex-direction:column;gap:6px}.diagram-oauth .diagram-arrow{font-size:20px;line-height:1}"
}
```

एक्सेस टोकन हस्ताक्षरित JWT हैं जिनके दर्शक सटीक MCP संसाधन URL हैं। सर्वर केवल अपने लिए जारी किए गए टोकन को स्वीकार करता है और लिस्टिंग/कॉलिंग टूल से पहले स्कोप लागू करता है:

| दायरा       | अनुमति देता है                           |
| ----------- | ---------------------------------------- |
| `mcp:read`  | केवल पढ़ने योग्य actions                 |
| `mcp:write` | actions और `ask-agent` को परिवर्तित करना |
| `mcp:apps`  | MCP ऐप्स संसाधन (`ui://` HTML संसाधन)    |

रीफ्रेश टोकन केवल हैश के रूप में संग्रहीत होते हैं और प्रत्येक रीफ्रेश पर घुमाए जाते हैं। `npx @agent-native/core@latest connect` डिफ़ॉल्ट रूप से Claude कोड क्लाइंट के लिए यह URL-केवल OAuth प्रविष्टि लिखता है; स्थानीय stdio प्रॉक्सीइंग, पुराने क्लाइंट और आपातकालीन/डीबग प्रवाह के लिए कनेक्ट पेज, `npx @agent-native/core@latest connect --token <token>` और स्टेटिक बियरर कॉन्फिगरेशन रखें।

## कस्टम MCP सेटअप {#custom-setup}

MCP सर्वर एजेंट-चैट प्लगइन द्वारा ऑटो-माउंटेड है। अधिकांश ऐप्स के लिए, किसी कॉन्फ़िगरेशन की आवश्यकता नहीं है। यदि आपको कस्टम व्यवहार की आवश्यकता है, तो आप इसे सर्वर प्लगइन में मैन्युअल रूप से माउंट कर सकते हैं:

```ts
// server/plugins/mcp.ts
import { mountMCP } from "@agent-native/core/mcp";
import { autoDiscoverActions } from "@agent-native/core/server";

export default defineNitroPlugin(async (nitro) => {
  const actions = await autoDiscoverActions(import.meta.url);

  mountMCP(nitro, {
    name: "My App",
    description: "Custom MCP server",
    actions,
    // Optional: provide ask-agent handler
    askAgent: async (message) => {
      // Your custom agent logic
      return "Response";
    },
    // Optional: override the route prefix (default "/_agent-native")
    // routePrefix: "/_agent-native",
  });
});
```

## उदाहरण: Claude कोड से विश्लेषण {#example}

आपके पास `analytics.example.com` पर एक तैनात एनालिटिक्स ऐप है। Claude कोड से:

```bash
claude mcp add --transport http analytics https://analytics.example.com/_agent-native/mcp
```

या इसे `.mcp.json` में हाथ से जोड़ें:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "analytics": {
      "type": "http",
      "url": "https://analytics.example.com/_agent-native/mcp",
    },
  },
}
```

अब Claude कोड में:

```
> How many signups did we get last week?

Claude Code calls: run-query(sql: "SELECT count(*) FROM signups WHERE created_at > now() - interval '7 days'")
→ "1,247 signups last week"
```

अधिक जटिल विश्लेषण के लिए:

```
> Ask the analytics agent to prepare a full breakdown of Q3 signups by source, with trends

Claude Code calls: ask-agent(message: "Prepare a full breakdown of Q3 signups by source, with trends")
→ The analytics agent runs multiple queries, reasons about the data, and returns a formatted report
```
