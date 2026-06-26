---
title: "हार्नेस एजेंट"
description: "Claude कोड, Codex, Pi और अन्य पूर्ण कोडिंग हार्नेस को Agent-Native के अंदर एम्बेडेड एजेंट के रूप में चलाएं, अपने स्वयं के लूप, सैंडबॉक्स, देशी टूल और फिर से शुरू करने योग्य SQL-समर्थित सत्रों के साथ।"
search: "हार्नेस एजेंट एजेंटहार्नेस एआई-एसडीके हार्नेसएजेंट Claude कोड Codex पीआई कर्सर मास्ट्रा एम्बेडेड कोडिंग एजेंट रिजोल्यूशनएजेंटहार्नेस स्टार्टएजेंटहार्नेसरन फिर से शुरू करने योग्य सत्र सैंडबॉक्स होस्ट टूल"
---

# हार्नेस एजेंट

> **यह किसके लिए है:** होस्ट लेखक पूर्ण कोडिंग रनटाइम वायरिंग कर रहे हैं (Claude कोड,
> Codex, Pi) एजेंट के रूप में Agent-Native में। एक ऐप बना रहे हैं? से प्रारंभ करें
> [Creating Templates](/docs/creating-templates).

एक हार्नेस एजेंट एक पूर्ण एजेंट रनटाइम है - Claude कोड, Codex, Pi, और समान -
जिसके पास अपना स्वयं का लूप, कार्यक्षेत्र, मूल फ़ाइल उपकरण, सत्र स्थिति, संघनन, है
अनुमोदन मॉडल, और सैंडबॉक्स व्यवहार। Agent-Native इन्हें
**`AgentHarness`** `@agent-native/core/agent/harness` में सब्सट्रेट, उनकी स्ट्रीम
घटनाओं को सामान्य प्रतिलेख में, और उनके मूल सत्र को एक थ्रेड के रूप में जारी रखता है
रोक सकते हैं और फिर से शुरू कर सकते हैं।

यह बिल्ट-इन चैट एजेंट से और आपकी खुद की चैट लाने से अलग है
रनटाइम. बिल्ट-इन एजेंट और `AgentEngine` एक मॉडल राउंड ट्रिप
`runAgentLoop` के नीचे। हार्नेस एक `AgentEngine` प्रदाता नहीं है - यह इसे चलाता है
स्वयं का लूप शुरू से अंत तक होता है, इसलिए Agent-Native इसे एक सत्र के रूप में चलाता है, एकल के रूप में नहीं
मॉडल कॉल.

```an-diagram title="एक हार्नेस का अपना लूप होता है; Agent-Native सत्र चलाता है" summary="एजेंटहार्नेस सब्सट्रेट creates/resumes मूल सत्र, इसकी घटनाओं को सामान्य प्रतिलेख में स्ट्रीम करता है, और मोड़ों के बीच SQL में फिर से शुरू करता है।"
{
  "html": "<div class=\"diagram-harness\"><div class=\"diagram-box\" data-rough><strong>AgentHarness substrate</strong><small class=\"diagram-muted\">@agent-native/core/agent/harness</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><strong>Native harness loop</strong><small class=\"diagram-muted\">Claude Code · Codex · Pi — own tools, sandbox, compaction</small></div><div class=\"diagram-col\"><div class=\"diagram-pill accent\">events &rarr; transcript</div><div class=\"diagram-pill ok\">resumeState &rarr; SQL session</div></div></div>",
  "css": ".diagram-harness{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-harness .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-harness .diagram-arrow{font-size:22px;line-height:1}.diagram-harness .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## मुझे कौन सा कोडिंग दस्तावेज़ चाहिए? {#which-doc}

| आप चाहते हैं…                                                                      | उपयोग                                        |
| ---------------------------------------------------------------------------------- | -------------------------------------------- |
| Claude कोड / Codex / Pi **एजेंट के रूप में** चलाएँ, अपने स्वयं के लूप + टूल के साथ | **हार्नेस एजेंट** (यह पृष्ठ)                 |
| एक Claude-कोड/Codex-शैली प्रस्तुत करें **कोडिंग कार्यक्षेत्र UI**                  | [Agent-Native Code UI](/docs/code-agents-ui) |
| एजेंट के **`run-code` टूल** को चलाने वाले बैकएंड को स्वैप करें                     | [Adapters](/docs/sandbox-adapters)           |
| एजेंट को कॉल करने के लिए एक CLI टूल (`gh`, `ffmpeg`) लपेटें                        | [Adapters](/docs/sandbox-adapters)           |

आसन्न सतहें: अपने द्वारा बनाए गए एजेंट को Agent-Native की चैट के पीछे कहीं और रखें
[`AgentChatRuntime`](/docs/native-chat-ui#byo-agent-runtimes) के साथ UI; चलो एक
बाहरी MCP होस्ट [External Agents](/docs/external-agents) के माध्यम से आपके ऐप में कॉल करता है;
स्पॉन बैकग्राउंड / सब-एजेंट [Custom Agents & Teams](/docs/agent-teams) के साथ चलता है।

## अंतर्निहित हार्नेस {#built-in}

`registerBuiltinAgentHarnesses()` AI SDK द्वारा समर्थित तीन एडेप्टर पंजीकृत करता है
`HarnessAgent`:

| नाम                          | रनटाइम     | सैंडबॉक्स | अनुमोदन |
| ---------------------------- | ---------- | --------- | ------- |
| `ai-sdk-harness:claude-code` | Claude कोड | हां       | हां     |
| `ai-sdk-harness:codex`       | Codex      | हाँ       | नहीं    |
| `ai-sdk-harness:pi`          | पी         | नहीं      | हाँ     |

उनके रनटाइम पैकेज **वैकल्पिक सहकर्मी निर्भरता** हैं और आलस्य से लोड होते हैं, इसलिए एक
ऐप जो कभी भी हार्नेस का उपयोग नहीं करता वह इसके लिए भुगतान नहीं करता है। प्रत्येक एडॉप्टर में एक
`installPackage` संकेत (उदाहरण के लिए `@ai-sdk/harness@canary
@ai-sdk/harness-codex@canary`); `resolveAgentHarness` एक स्पष्ट इंस्टॉल फेंकता है
यदि पैकेज गायब हैं तो त्रुटि, और `isAgentHarnessPackageInstalled(entry)`
आपको पहले जांच करने देता है।

`registerBuiltinAgentHarnesses()` [ACP](#acp) हार्नेस को भी पंजीकृत करता है
(`acp`, `acp:gemini`, `acp:claude-code`).

## ACP एजेंट {#acp}

Agent-Native एक [ACP](https://agentclientprotocol.com) (एजेंट क्लाइंट) के रूप में कार्य कर सकता है
प्रोटोकॉल) **क्लाइंट** और एक स्थानीय कोडिंग एजेंट को ड्राइव करें - जेमिनी CLI, Claude कोड,
या कोई ACP-संगत एजेंट - इसी सब्सट्रेट के माध्यम से। एजेंट a
स्थानीय उपप्रक्रिया जो stdio पर न्यूलाइन-सीमांकित JSON-RPC बोलती है; ACP के संपादक
↔ एजेंट मॉडल बिल्कुल इसी आकार का है।

यह एडॉप्टर **स्थानीय कोडिंग** तक सीमित है। चाइल्ड प्रोसेस को विरासत में मिलता है
मूल वातावरण, इसलिए एजेंट के पास पहले से मौजूद स्थानीय CLI लॉगिन का पुन: उपयोग होता है
(उदाहरण के लिए उपयोगकर्ता के होम डीआईआर में `gemini` या `claude` प्रमाणीकरण)। यह एक
होस्टेड या सैंडबॉक्स्ड ट्रांसपोर्ट, और यह चैट/A2A ट्रांसपोर्ट नहीं है - उनके लिए,
[Agent Surfaces](/docs/agent-surfaces) देखें।

| नाम               | डिफ़ॉल्ट कमांड                                            | पुनः प्रारंभ करने योग्य\* |
| ----------------- | --------------------------------------------------------- | ------------------------- |
| `acp`             | _(कॉन्फ़िगरेशन के माध्यम से `command`/`args` की आपूर्ति)_ | हां                       |
| `acp:gemini`      | `npx -y @google/gemini-cli --experimental-acp`            | हां                       |
| `acp:claude-code` | `npx -y @zed-industries/claude-code-acp`                  | हां                       |

\*जब एजेंट `loadSession` क्षमता का विज्ञापन करता है तो रेज़्यूमे काम करता है और
अन्यथा एक नए सत्र में अवक्रमित हो जाता है।

```ts
import {
  registerBuiltinAgentHarnesses,
  resolveAgentHarness,
} from "@agent-native/core/agent/harness";

registerBuiltinAgentHarnesses();

// A built-in preset (command/args are overridable through the resolve config):
const adapter = resolveAgentHarness("acp:gemini");

// Or any ACP agent by command:
const custom = resolveAgentHarness("acp", {
  command: "gemini",
  args: ["--experimental-acp"],
});
```

प्रोटोकॉल ट्रांसपोर्ट (`@zed-industries/agent-client-protocol`) एक वैकल्पिक है
एआई SDK की तरह, `installPackage` संकेत के माध्यम से निर्भरता को आलस्य से लोड किया गया है
हार्नेस। एजेंट बाइनरी स्वयं (`@google/gemini-cli`,
`@zed-industries/claude-code-acp`,…) एक अलग बाहरी CLI है; प्रीसेट
इसे `npx` के माध्यम से लॉन्च करें और कमांड/आर्ग ओवरराइडेबल रहें क्योंकि एजेंट ACP
प्रवेश ध्वज अभी भी विकसित हो रहे हैं।

`permissionMode` टूल-कॉल का उपयोग करके ACP `session/request_permission` पर मैप करता है
एजेंट रिपोर्ट प्रकार: रीड्स हमेशा चलते हैं, संपादन `allow-edits` के अंतर्गत चलते हैं, और
`allow-all` तक सब कुछ जोखिम भरा संकेत देता है। स्वीकृतियाँ सामान्य रूप से सामने आती हैं
`approval-request` इवेंट। एडाप्टर `fs/read_text_file` और
सत्र कार्यक्षेत्र के विरुद्ध `fs/write_text_file` (बचने वाले रास्तों को अस्वीकार करना
it) और एमिट `file-change` ईवेंट लिखता है; टर्मिनल विधियों का विज्ञापन नहीं किया जाता है,
इसलिए एजेंट अपने स्वयं के शेल का उपयोग करता है।

## Codex प्रमाणन: कोड UI बनाम हार्नेस सैंडबॉक्स {#codex-auth}

दो Codex सतहें हैं, और वे अलग-अलग तरीके से प्रमाणित करते हैं:

- **Agent-Native कोड / डेस्कटॉप** उपयोगकर्ता की मशीन पर `codex exec` चलाता है। यदि
  उपयोगकर्ता ने `codex login` चलाया है, यह स्थानीय रन जो भी ChatGPT है उसका पुन: उपयोग करता है
  सदस्यता या API-कुंजी के माध्यम से स्थापित Codex CLI रिपोर्ट
  `codex login status`.
- **`ai-sdk-harness:codex`** `@ai-sdk/harness-codex` को लोड करता है, जो Codex को चलाता है
  `@openai/codex-sdk` के माध्यम से हार्नेस सैंडबॉक्स के अंदर। यह चुपचाप नहीं
  उपयोगकर्ता का डेस्कटॉप `~/.codex` लॉगिन इनहेरिट करें क्योंकि सैंडबॉक्स रिमोट हो सकता है
  या पृथक। विश्वसनीय/निजी सैंडबॉक्स के लिए, `codexCliAuth: true` के साथ ऑप्ट इन करें;
  Agent-Native स्थानीय Codex CLI ऑथ फ़ाइल को इससे पहले सैंडबॉक्स में कॉपी करता है
  हार्नेस शुरू होता है। होस्ट किए गए या साझा किए गए सैंडबॉक्स के लिए, API-कुंजी / गेटवे कॉन्फ़िगर करें
  इसके बजाय प्रमाणीकरण।

इसलिए यदि कोई पूछता है कि कौन सा पैकेज Codex OAuth पथ वहन करता है: स्थानीय कोडिंग के लिए
सत्र, स्थापित `@agent-native/core`/डेस्कटॉप का उपयोग करें
`@openai/codex` CLI और `codex login`। सैंडबॉक्स्ड `ai-sdk-harness:codex` के लिए,
उस लॉगिन को सैंडबॉक्स में कॉपी करते समय स्पष्ट `codexCliAuth` ऑप्ट-इन का उपयोग करें
स्वीकार्य है।

```ts
const adapter = resolveAgentHarness("ai-sdk-harness:codex", {
  codexCliAuth: true,
});
```

`codexCliAuth: true` पढ़ता है `CODEX_HOME/auth.json` या `~/.codex/auth.json`. को
किसी भिन्न स्थानीय लॉगिन पर इंगित करें, पास करें
`{ codexCliAuth: { codexHome: "/path/to/.codex" } }` या
`{ codexCliAuth: { authJsonPath: "/path/to/auth.json" } }`.

## पंजीकरण करें और समाधान करें {#register-resolve}

```ts
import {
  registerBuiltinAgentHarnesses,
  resolveAgentHarness,
} from "@agent-native/core/agent/harness";

registerBuiltinAgentHarnesses();
const adapter = resolveAgentHarness("ai-sdk-harness:codex");
```

`resolveAgentHarness(name, config?)` एक `AgentHarnessAdapter` लौटाता है। द
वैकल्पिक `config` को एडॉप्टर फ़ैक्टरी में भेज दिया गया है - AI SDK एडाप्टर के लिए
जो `AiSdkHarnessAdapterOptions` (`label`, `description`,
`permissionMode`, `harnessOptions`, `agentOptions`, और Codex-केवल
`codexCliAuth`). किसके लिए पंजीकृत है यह गिनने के लिए `listAgentHarnesses()` का उपयोग करें
एक पिकर।

## एक मोड़ चलाएँ {#run-a-turn}

`startAgentHarnessRun` एक हार्नेस सत्र को साझा रन-मैनेजर में जोड़ता है
जीवनचक्र. यह मूल सत्र बनाता है (या पुन: उपयोग करता है), इसे जारी रखता है, स्ट्रीम करता है
टर्न, प्रत्येक हार्नेस इवेंट को ट्रांसक्रिप्ट इवेंट में अनुवादित करता है, और अलग कर देता है
टर्न पूरा होने पर पुनः प्रारंभ करने योग्य स्थिति।

```ts
import { startAgentHarnessRun } from "@agent-native/core/agent/harness";

const run = startAgentHarnessRun({
  runId,
  threadId,
  adapter,
  input: { prompt },
  createSession: {
    sessionId,
    resumeState, // opaque value from a previous turn, if resuming
    instructions,
    sandbox, // required for sandboxed harnesses — see Sandbox Adapters
    permissionMode: "allow-reads",
    tools, // a narrow, intentional set of host tools (see below)
  },
  ownerEmail,
  orgId,
});
```

`startAgentHarnessRun` रन-मैनेजर से `ActiveRun` लौटाता है, इसलिए बारी
मौजूदा रन रूट, ट्रांसक्रिप्ट और रद्दीकरण के माध्यम से दिखाता है
any other agent run. Pass an already-created `session` instead of `createSession`
किसी सत्र को जारी रखने के लिए जिसे आप स्मृति में रख रहे हैं।

## सत्र और बायोडाटा {#sessions}

एक हार्नेस लंबे समय तक जीवित रहने वाली मूल सत्र स्थिति का मालिक होता है। Agent-Native इसे SQL
ताकि एक थ्रेड घुमावों, प्रक्रियाओं और तैनाती के दौरान जीवित रह सके। `resumeState`
**अपारदर्शी** है - Agent-Native इसे संग्रहीत करता है और वापस सौंप देता है, लेकिन कभी निरीक्षण नहीं करता या
इसकी व्याख्या करता है।

```an-diagram title="मोड़ों, प्रक्रियाओं और तैनाती को फिर से शुरू करें" summary="प्रत्येक मोड़ एक अपारदर्शी बायोडेटा को SQL में अलग कर देता है; अगला चरण चैट इतिहास को दोबारा चलाने के बजाय इसे वापस createSession में फीड कर देता है।"
{
  "html": "<div class=\"diagram-resume\"><div class=\"diagram-node\" data-rough>टर्न N<br><small class=\"diagram-muted\">streamTurn</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>detach &rarr; resumeState<br><small class=\"diagram-muted\">अपारदर्शी · SQL harness सेशन</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\" data-rough>टर्न N+1<br><small class=\"diagram-muted\">createSession.resumeState</small></div></div>",
  "css": ".diagram-resume{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-resume .diagram-arrow{font-size:22px;line-height:1}"
}
```

```ts
import {
  getLatestAgentHarnessSessionForThread,
  listAgentHarnessSessions,
} from "@agent-native/core/agent/harness";

const last = await getLatestAgentHarnessSessionForThread(threadId);
// Feed last?.resumeState into createSession.resumeState on the next turn.
```

स्टोर `saveAgentHarnessSession`, `updateAgentHarnessSession`, को भी प्रदर्शित करता है
`getAgentHarnessSession`, `getAgentHarnessSessionByRunId`,
`markAgentHarnessSessionStopped`, और `ensureAgentHarnessSessionTables`.
`startAgentHarnessRun` आपके लिए सेव/अपडेट/स्टॉप पाथ को कॉल करता है; उन तक पहुंचें
सीधे केवल एक कस्टम होस्ट में।

## होस्ट उपकरण और अनुमतियाँ {#host-tools}

एक हार्नेस अपने स्वयं के मूल उपकरण लाता है (पढ़ें, संपादित करें, लिखें, शेल, इत्यादि), इसलिए
आप फ़ाइल संपादन को होस्ट टूल के रूप में दोबारा प्रदर्शित **नहीं** करते हैं। केवल **संकीर्ण पास करें,
जानबूझकर सेट** Agent-Native actions से `createSession.tools` तक जब आप
चाहते हैं कि हार्नेस विशिष्ट ऐप संचालन तक पहुंचे - और `defineAction` रखें
ऑथ, अनुरोध संदर्भ, टाइमआउट, ट्रंकेशन, और रीड-ओनली मेटाडेटा बरकरार रहता है
आप करते हैं।

`permissionMode` बताता है कि हार्नेस अनुमोदन के बिना क्या कर सकता है:

| मोड           | अर्थ                                                           |
| ------------- | -------------------------------------------------------------- |
| `allow-reads` | डिफ़ॉल्ट. पढ़ता है भागो; संपादन और जोखिम भरा actions प्रॉम्प्ट |
| `allow-edits` | पठन और संपादन चलता है; अन्य जोखिम भरा actions प्रॉम्प्ट        |
| `allow-all`   | कोई अनुमोदन गेटिंग नहीं                                        |

जब कोई हार्नेस अनुमोदन के लिए रुकता है तो यह एक `approval-request` ईवेंट उत्सर्जित करता है और
सत्र को लंबित अनुमोदन के साथ `idle` के रूप में चिह्नित किया गया है, इसलिए UI कर सकता है
इसे सामने लाएँ और उपयोगकर्ता के निर्णय पर फिर से विचार करें। देखें
अनुमोदन सतह के लिए [Human Approval](/docs/human-approval).

## घटनाएँ {#events}

एक हार्नेस सत्र `AgentHarnessEvent` मानों को स्ट्रीम करता है, जो Agent-Native
के साथ मानक `AgentChatEvent` स्ट्रीम में अनुवाद करता है
`agentHarnessEventToAgentChatEvents`. इवेंट यूनियन `text-delta` को कवर करता है,
`thinking-delta`, `activity`, `tool-start`, `tool-done` (जो एक ले जा सकता है
देशी विजेट के लिए `mcpApp` पेलोड), `approval-request`, `file-change`,
`compaction`, `usage`, `error`, और `done`। क्योंकि टूल के परिणाम
वही अनुवाद, क्रिया-घोषित मूल विजेट अभी भी प्रस्तुत होते हैं - देखें
[Native चैट UI](/docs/native-chat-ui).

## बैकग्राउंड रन और UI {#background-runs}

Harness runs project into the shared `BackgroundAgentRun` shape with
`createAgentHarnessBackgroundAgentController()` और
मौजूदा रन रूट `goalId=agent-harness` के रूप में। इसका मतलब है लंबे समय तक चलने वाला Claude
कोड या Codex सत्र एक ही बैकग्राउंड-रन और ट्रांसक्रिप्ट सतहों पर दिखाई देता है
एजेंट टीमों और अन्य एडेप्टर के रूप में, `listAgentHarnessBackgroundRuns` के साथ,
`listAgentHarnessBackgroundTranscriptEvents`, `getAgentHarnessBackgroundRun`, और
`stopAgentHarnessBackgroundRun` कस्टम होस्ट के लिए उपलब्ध है।

## कस्टम एडाप्टर {#custom-adapters}

ऐसे रनटाइम को रैप करने के लिए जो बिल्ट-इन में से एक नहीं है, लागू करें
`AgentHarnessAdapter` और इसे पंजीकृत करें। एडॉप्टर अपनी क्षमताओं की घोषणा करता है और
सत्र बनाता है; एक सत्र `streamTurn` और वैकल्पिक `continueTurn` को उजागर करता है,
`approve`, `detach`, `stop`, और `destroy`।

```ts
import {
  registerAgentHarness,
  type AgentHarnessAdapter,
} from "@agent-native/core/agent/harness";

const myHarness: AgentHarnessAdapter = {
  name: "acme:my-coder",
  label: "Acme Coder",
  description: "Runs the Acme coding agent.",
  installPackage: "@acme/coder",
  capabilities: {
    sandbox: true,
    resumable: true,
    approvals: true,
    hostTools: true,
    fileEvents: true,
  },
  async createSession(opts) {
    // Build your native session and adapt it to AgentHarnessSession.
    return createAcmeSession(opts);
  },
};

registerAgentHarness({
  name: myHarness.name,
  label: myHarness.label,
  description: myHarness.description,
  installPackage: myHarness.installPackage,
  capabilities: myHarness.capabilities,
  create: () => myHarness,
});
```

`createSession` और एक में गतिशील आयात के साथ रनटाइम पैकेज को वैकल्पिक रखें
`installPackage` संकेत। ब्रिज-समर्थित कोडिंग हार्नेस के लिए, एक वास्तविक
में एक मनमाना कोडिंग एजेंट चलाने के बजाय सैंडबॉक्स/वर्कस्पेस प्रदाता
होस्ट प्रक्रिया - [Sandbox Adapters](/docs/sandbox-adapters) देखें। AI SDK एडाप्टर
(`createAiSdkHarnessAdapter`, `@ai-sdk/harness` से `HarnessAgent` द्वारा समर्थित) है
इस अनुबंध का एक कार्यान्वयन, सार्वजनिक अमूर्तन नहीं।

## नहीं करें {#donts}

- Claude कोड, Codex, कर्सर, मास्ट्रा, या Pi को `AgentEngine` के रूप में न जोड़ें। वे
  उनके पाश के स्वामी; `AgentEngine.stream()` के अंतर्गत एक चलाने से लूप दोगुना हो जाता है
  और सत्र जीवनचक्र शब्दार्थ खो देता है।
- पूरे Agent-Native चैट इतिहास को हर बार हार्नेस में दोबारा न चलाएं। फिर से शुरू करें
  इसके बजाय इसके `resumeState` के साथ हार्नेस सत्र।
- `resumeState` को `application_state` में संग्रहित न करें। यह हार्नेस में है
  सत्र SQL तालिका।
- प्रत्येक ऐप कार्रवाई को डिफ़ॉल्ट रूप से प्रत्येक हार्नेस सत्र में उजागर न करें। इसे सौंपें
  छोटा, जानबूझकर टूल सेट।

## संबंधित दस्तावेज़ {#related-docs}

- [Native चैट UI](/docs/native-chat-ui) - `AgentChatRuntime` के साथ UI चैट के पीछे अपना एजेंट रखें।
- [Agent Surfaces](/docs/agent-surfaces) - हेडलेस, चैट, साइडकार, या फुल-ऐप चुनें।
- [Agent-Native Code UI](/docs/code-agents-ui) - पुन: प्रयोज्य कोडिंग कार्यक्षेत्र सतह।
- [Custom Agents & Teams](/docs/agent-teams) - बैकग्राउंड रन और सब-एजेंट डेलिगेशन।
- [Sandbox Adapters](/docs/sandbox-adapters) - कोडिंग हार्नेस के लिए प्लग करने योग्य निष्पादन बैकएंड।
- [Human Approval](/docs/human-approval) - अनुमोदन सतही हार्नेस का उपयोग।
