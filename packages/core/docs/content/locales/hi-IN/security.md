---
title: "सुरक्षा"
description: "एजेंट-नेटिव ऐप्स के लिए सुरक्षा मॉडल: इनपुट सत्यापन, SQL इंजेक्शन रोकथाम, XSS, डेटा स्कोपिंग, रहस्य प्रबंधन और प्रमाणीकरण पैटर्न।"
---

# सुरक्षा

एजेंट-नेटिव ऐप्स डिफ़ॉल्ट रूप से सुरक्षित होने के लिए डिज़ाइन किए गए हैं। फ्रेमवर्क कई परतों पर स्वचालित सुरक्षा प्रदान करता है - आपको बॉक्स से बाहर SQL-स्तर डेटा अलगाव, पैरामीटरयुक्त क्वेरी, इनपुट सत्यापन और प्रमाणीकरण मिलता है।

## आपको मुफ़्त में क्या मिलता है, और आपके पास क्या है {#what-you-own}

```an-diagram title="परतों में बचाव" summary="ढाँचा अधिकांश खतरे की सतह का मालिक है; आपके पास दो चीजें हैं - स्कोपिंग के लिए टेबल टैग करना और बाहरी इनपुट को मान्य करना।"
{
  "html": "<div class=\"sec-layers\"><div class=\"diagram-card free\"><span class=\"diagram-pill ok\">फ्रेमवर्क के पास</span><small class=\"diagram-muted\">SQL isolation &middot; parameterized queries &middot; XSS escaping &middot; auth guard &middot; CSRF cookies &middot; secret encryption</small></div><div class=\"diagram-card you\"><span class=\"diagram-pill warn\">नियंत्रण आपका है</span><small class=\"diagram-muted\">A. tag tables with ownableColumns() &amp; route through access guards<br>B. give every action a Zod schema &amp; send user URLs through the SSRF guard</small></div></div>",
  "css": ".sec-layers{display:flex;flex-direction:column;gap:12px}.sec-layers .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px}"
}
```

जब आप मानक पैटर्न पर निर्माण करते हैं, तो ढांचा पहले से ही आपके लिए अधिकांश खतरे की सतह को संभाल लेता है:

- **डेटा अलगाव** - एजेंट SQL को फिर से लिखा गया है ताकि यह केवल वर्तमान उपयोगकर्ता (और सक्रिय संगठन) की पंक्तियों को देख सके। [Data Scoping](#data-scoping) देखें.
- **SQL इंजेक्शन** - `db-query`/`db-exec` और Drizzle हमेशा पैरामीटराइज़ करते हैं। [SQL Injection Prevention](#sql-injection) देखें.
- **XSS** - React ऑटो-एस्केप, टिपटैप और `react-markdown` सैनिटाइज़। [XSS Prevention](#xss) देखें.
- **प्रामाणिक और CSRF** - प्रत्येक `defineAction` प्रामाणिक-संरक्षित है; कुकीज़ `httpOnly` + `SameSite=lax` हैं। [Authentication](#auth) देखें.
- **गुप्त एन्क्रिप्शन** - क्रेडेंशियल्स और वॉल्ट बाकी समय एन्क्रिप्टेड होते हैं। [Secrets Management](#secrets) देखें.

यह एक छोटी सी सतह छोड़ता है जिसके बारे में आपको वास्तव में सोचना होगा:

- **ए. स्कोपिंग के लिए अपनी तालिकाओं को टैग करें। ** [`ownableColumns()`](#data-scoping) के माध्यम से `owner_email` (और टीम डेटा के लिए `org_id`) जोड़ें, और Drizzle को [access guards](#access-guards) के माध्यम से पढ़ने/लिखने के लिए रूट करें।
- **बी. बाहरी इनपुट को सत्यापित और रूट करें। ** प्रत्येक क्रिया को Zod [`schema:`](#input-validation) दें, और [SSRF guard](#ssrf) के माध्यम से उपयोगकर्ता/एजेंट URL के किसी भी सर्वर-साइड फ़ेच को भेजें।

उन दोनों को ठीक कर लें और बाकी सब डिफ़ॉल्ट है। [Production Checklist](#production-checklist) आपके शिपमेंट से पहले एक पेज की पुष्टि है।

## डिज़ाइन द्वारा सुरक्षा {#secure-by-design}

जब आप मानक पैटर्न का उपयोग करते हैं तो फ्रेमवर्क आर्किटेक्चर सामान्य कमजोरियों को रोकता है:

| भेद्यता        | फ़्रेमवर्क सुरक्षा                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------- |
| SQL इंजेक्शन   | `db-query`/`db-exec` और Drizzle ORM में पैरामीटरयुक्त क्वेरीज़                                  |
| XSS            | React ऑटो-एस्केप JSX; टिपटैप रिच टेक्स्ट को सैनिटाइज़ करता है                                   |
| डेटा लीक       | अस्थायी दृश्यों के माध्यम से SQL-स्तरीय स्कोपिंग (`owner_email`, `org_id`)                      |
| ऑथ बाइपास      | ऑथ गार्ड सभी `defineAction` एंडपॉइंट्स की स्वतः सुरक्षा करता है                                 |
| इनपुट इंजेक्शन | `defineAction` में Zod स्कीमा सत्यापन                                                           |
| CSRF           | `SameSite=lax` + `httpOnly` कुकीज़                                                              |
| गुप्त प्रदर्शन | `.env` gitignored; क्रेडेंशियल और वॉल्ट विश्राम के समय एन्क्रिप्टेड (AES-256-GCM)               |
| SSRF           | `ssrfSafeFetch` आंतरिक/मेटाडेटा लक्ष्यों को अवरुद्ध करता है + रीडायरेक्ट रीबाइंडिंग को रोकता है |

## इनपुट सत्यापन {#input-validation}

प्रत्येक क्रिया के लिए Zod `schema:` के साथ `defineAction` का उपयोग करें। आपका कोड चलने से पहले फ्रेमवर्क स्वचालित रूप से इनपुट को मान्य करता है:

```ts
import { z } from "zod";
import { defineAction } from "@agent-native/core/action";

export default defineAction({
  description: "Create a note",
  schema: z.object({
    title: z.string().min(1).max(200).describe("Note title"),
    content: z.string().optional().describe("Note body"),
  }),
  run: async (args) => {
    // args is guaranteed valid — invalid input never reaches here
  },
});
```

अमान्य इनपुट स्पष्ट त्रुटि संदेश देता है (HTTP के लिए 400, एजेंट कॉल के लिए संरचित त्रुटि)। लीगेसी `parameters:` प्रारूप कोई रनटाइम सत्यापन प्रदान नहीं करता है।

## SQL इंजेक्शन रोकथाम {#sql-injection}

फ्रेमवर्क के `db-query` और `db-exec` उपकरण पैरामीटरयुक्त प्रश्नों का उपयोग करते हैं। उपयोगकर्ता इनपुट को तर्क के रूप में पारित किया जाता है, कभी भी SQL स्ट्रिंग में प्रक्षेपित नहीं किया जाता है:

```ts
// SAFE — parameterized query (framework default)
await exec({ sql: "INSERT INTO notes (title) VALUES (?)", args: [title] });

// SAFE — Drizzle ORM (always generates parameterized queries)
await db.insert(notes).values({ title, ownerEmail: email });

// DANGEROUS — string concatenation (never do this)
await exec(`INSERT INTO notes (title) VALUES ('${title}')`);
```

```an-callout
{
  "tone": "risk",
  "body": "कभी भी SQL को स्ट्रिंग कॉन्सटेनेशन या टेम्प्लेट अक्षरशः द्वारा न बनाएं। उपयोगकर्ता इनपुट को `args` से `exec` / `db-query` के रूप में पास करें, या Drizzle का उपयोग करें - दोनों हमेशा पैरामीटराइज़ करते हैं। `pnpm guards` चेक सीआई समय पर अस्पष्ट और संक्षिप्त प्रश्नों को पकड़ते हैं।"
}
```

## XSS रोकथाम {#xss}

React सभी JSX अभिव्यक्तियों को स्वतः समाप्त कर देता है। अतिरिक्त दिशानिर्देश:

- उपयोगकर्ता-नियंत्रित सामग्री के साथ कभी भी `dangerouslySetInnerHTML` का उपयोग न करें
- कभी भी `innerHTML`, `eval()`, या `document.write()` का उपयोग न करें
- रिच टेक्स्ट संपादन के लिए, टिपटैप (फ्रेमवर्क निर्भरता) का उपयोग करें - यह अपनी स्कीमा के माध्यम से स्वच्छ करता है
- मार्कडाउन प्रस्तुत करने के लिए, `react-markdown` का उपयोग करें - यह सुरक्षित रूप से React तत्वों में परिवर्तित हो जाता है

## सर्वर-साइड फ़ेच (SSRF) {#ssrf}

उपयोगकर्ता या एजेंट-नियंत्रित URL के किसी भी सर्वर-साइड `fetch` को फ्रेमवर्क SSRF गार्ड से गुजरना होगा, या इसे क्लाउड मेटाडेटा (`169.254.169.254`), `localhost`, या आंतरिक सेवाओं पर इंगित किया जा सकता है:

```ts
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";

const res = await ssrfSafeFetch(userProvidedUrl, {}, { maxRedirects: 3 });
```

`ssrfSafeFetch` निजी/आंतरिक लक्ष्यों को ब्लॉक करता है, कनेक्ट समय पर हल किए गए आईपी को दोबारा जांचता है (DNS रीबाइंडिंग), और प्रत्येक रीडायरेक्ट हॉप को दोबारा सत्यापित करता है ताकि सार्वजनिक URL निजी नेटवर्क में रीडायरेक्ट न हो सके। एक्सटेंशन आईफ्रेम प्रॉक्सी, `upload-image`, और डिज़ाइन-टोकन आयातक इसके माध्यम से सभी रूट करते हैं। केवल-उड़ान-पूर्व जांच के लिए, `redirect: "manual"` के साथ `isBlockedExtensionUrlWithDns(url)` का उपयोग करें।

## डेटा स्कोपिंग {#data-scoping}

उत्पादन में, फ्रेमवर्क स्वचालित रूप से एजेंट SQL क्वेरी को वर्तमान उपयोगकर्ता के डेटा तक सीमित कर देता है। इसे SQL स्तर पर लागू किया जाता है - एजेंट इसे बायपास नहीं कर सकते। यह अनुभाग स्कोपिंग पाइपलाइन के लिए विहित संदर्भ है; यांत्रिकी के लिए [Authentication](/docs/authentication) और [Multi-Tenancy](/docs/multi-tenancy) दस्तावेज़ यहां लिंक हैं।

### स्कोपिंग पाइपलाइन {#scoping-pipeline}

स्कोपिंग प्रमाणित सत्र से एजेंट द्वारा चलाए जाने वाले SQL तक प्रवाहित होती है:

```
session.orgId → AGENT_ORG_ID → SQL row scoping
```

```an-diagram title="स्कोपिंग पाइपलाइन" summary="एजेंट SQL कभी भी आधार तालिकाओं को सीधे नहीं छूता है - यह वर्तमान पहचान के दायरे में एक अस्थायी दृश्य के माध्यम से पढ़ता है, इसलिए एक खाली तालिका नाम केवल स्वामित्व वाली पंक्तियों को वापस कर सकता है।"
{
  "html": "<div class=\"scope-pipe\"><div class=\"diagram-node\">साइन-इन सेशन<br><small class=\"diagram-muted\">email &middot; orgId</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">Request context<br><small class=\"diagram-muted\">AGENT_ORG_ID</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Temporary VIEW<br><small class=\"diagram-muted\">WHERE owner_email = ? AND org_id = ?</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node ok\">एजेंट SQL<br><small class=\"diagram-muted\">bare table names only</small></div></div>",
  "css": ".scope-pipe{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.scope-pipe .diagram-node{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.scope-pipe .diagram-arrow{font-size:22px;line-height:1}"
}
```

साइन-इन सत्र में `email` और (जब कोई संगठन सक्रिय होता है) `orgId` होता है। फ़्रेमवर्क उस सत्र से अनुरोध संदर्भ स्थापित करता है, सक्रिय संगठन को एजेंट SQL को `AGENT_ORG_ID` के रूप में उजागर करता है, और प्रत्येक क्वेरी को फिर से लिखता है ताकि यह केवल उन पंक्तियों को देख सके जिनके पास वर्तमान पहचान है। चाहे क्वेरी UI, एक क्रिया, या एजेंट से आती हो, वही पथ लागू होता है - एजेंट उस संगठन के लिए डेटा नहीं पढ़ सकता है जिसका उपयोगकर्ता सदस्य नहीं है।

### प्रति-उपयोगकर्ता स्कोपिंग (`owner_email`)

उपयोगकर्ता-विशिष्ट डेटा वाली प्रत्येक तालिका में एक `owner_email` टेक्स्ट कॉलम होना चाहिए। CamelCase Drizzle संपत्ति नाम का उपयोग करें - `accessFilter` `resourceTable.ownerEmail` पढ़ता है:

```ts
import {
  table,
  text,
  integer,
  ownableColumns,
} from "@agent-native/core/db/schema";

// Minimal: just the owner column
export const notes = table("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  ownerEmail: text("owner_email").notNull(), // REQUIRED — camelCase property
});

// Or use ownableColumns() to add owner_email + org_id + visibility in one call
export const notes = table("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  ...ownableColumns(),
});
```

फ़्रेमवर्क अस्थायी SQL दृश्य बनाता है जो क्वेरीज़ को स्वचालित रूप से फ़िल्टर करता है:

```sql
CREATE TEMPORARY VIEW "notes" AS
  SELECT * FROM main."notes"
  WHERE "owner_email" = 'alice@example.com';
```

जब कॉलम पहले से मौजूद नहीं है तो INSERT स्टेटमेंट `owner_email` ऑटो-इंजेक्ट हो जाते हैं।

`db-query` / `db-exec` उपकरण स्कीमा-योग्य तालिका संदर्भों (`public.<table>`, `main.<table>`) को अस्वीकार करते हैं - एक योग्य नाम आधार तालिका में हल हो जाता है और उपरोक्त अस्थायी दृश्य को बायपास कर देगा। एजेंट नंगे टेबल नामों का उपयोग करते हैं; स्कोपिंग स्वचालित रूप से लागू होती है।

### प्रति-संगठन स्कोपिंग (`org_id`)

बहु-उपयोगकर्ता ऐप्स के लिए जहां टीमें डेटा साझा करती हैं, एक `org_id` कॉलम जोड़ें। जब दोनों कॉलम मौजूद होते हैं, तो प्रश्नों का दायरा दोनों द्वारा होता है: `WHERE owner_email = ? AND org_id = ?`.

`ownableColumns()` स्कीमा सहायक एक कॉल में `owner_email`, `org_id`, और `visibility` जोड़ता है, इसलिए नई किरायेदार-जागरूक तालिकाओं को डिफ़ॉल्ट रूप से पूर्ण स्कोपिंग अनुबंध मिलता है:

```ts
import { table, text, ownableColumns } from "@agent-native/core/db/schema";

export const projects = table("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  ...ownableColumns(), // adds owner_email + org_id + visibility
});
```

```an-schema title="What ownableColumns() adds" summary="तीन कॉलम जो तालिका को किरायेदार-जागरूक और साझा करने योग्य बनाते हैं।"
{
  "entities": [
    {
      "id": "ownable",
      "name": "ownable resource",
      "note": "Any table that spreads ...ownableColumns()",
      "fields": [
        { "name": "owner_email", "type": "text", "nullable": false, "note": "Creator. Auto-filled by write actions; auto-injected on INSERT." },
        { "name": "org_id", "type": "text", "nullable": true, "note": "निर्माण के समय स्वामी का सक्रिय संगठन। ऑर्ग-विजिबिलिटी जांच चलाता है।" },
        { "name": "visibility", "type": "enum", "nullable": false, "note": "निजी | संगठन | सार्वजनिक - मोटे तौर पर डिफ़ॉल्ट, डिफ़ॉल्ट से निजी।" }
      ]
    }
  ]
}
```

### actions में एक्सेस गार्ड {#access-guards}

रॉ एजेंट SQL ऊपर दिए गए अस्थायी दृश्यों के दायरे में है। एक्शन कोड जो Drizzle के साथ क्वेरी करता है, उसे सीधे फ्रेमवर्क के एक्सेस हेल्पर्स के माध्यम से जाना चाहिए ताकि पढ़ना और लिखना वर्तमान पहचान के दायरे में रहे:

- **`accessFilter`** - `WHERE` विधेय लौटाता है जो किसी क्वेरी को उन पंक्तियों तक सीमित करता है जिन्हें वर्तमान उपयोगकर्ता/संगठन देख सकता है। इसे सूची/पठित प्रश्नों में उपयोग करें।
- **`resolveAccess`** - वर्तमान अनुरोध के लिए प्रभावी पहुंच दायरे (मालिक, संगठन, साझा) को हल करता है।
- **`assertAccess`** - एक लेखन या एकल-रिकॉर्ड पढ़ने की सुरक्षा करता है, यदि वर्तमान पहचान लक्ष्य पंक्ति पर कार्य नहीं कर सकती है, तो उसे फेंक देता है।

`ownableColumns()` के साथ निर्मित तालिकाओं को इन स्कोप्ड रीड और राइट की आवश्यकता होती है; कस्टम Nitro मार्गों को स्वामित्व योग्य डेटा की क्वेरी करने से पहले अनुरोध संदर्भ स्थापित करना होगा। `guard-no-unscoped-queries` चेक (`pnpm guards` के माध्यम से चलाया गया) इसे CI समय पर लागू करता है। पूर्ण सहायक API के लिए `sharing` कौशल देखें।

### सत्यापन

```bash
pnpm action db-check-scoping           # जांचें कि सभी तालिकाओं में मालिक का ईमेल है
pnpm action db-check-scoping --require-org  # इसके अलावा org_id की भी आवश्यकता है
```

## रहस्य प्रबंधन {#secrets}

| गुप्त प्रकार                                | कहां स्टोर करें                                                       |
| ------------------------------------------- | --------------------------------------------------------------------- |
| तैनाती-स्तर कुंजियाँ (प्रति ऐप एक)          | `.env` फ़ाइल (gitignored, केवल सर्वर-साइड)                            |
| प्रति-उपयोगकर्ता / प्रति-संगठन API कुंजियाँ | `saveCredential` / `resolveCredential` (बाकी स्थिति में एन्क्रिप्टेड) |
| पंजीकृत रहस्य (साइडबार वॉल्ट)               | `app_secrets` वॉल्ट (बाकी स्थिति में एन्क्रिप्टेड)                    |
| OAuth टोकन (Google, GitHub)                 | `saveOAuthTokens()` के माध्यम से `oauth_tokens` स्टोर                 |
| सत्र टोकन                                   | स्वचालित (बेहतर प्रमाणीकरण इसे संभालता है)                            |

प्रति-उपयोगकर्ता/प्रति-संगठन क्रेडेंशियल्स और वॉल्ट को AES-256-GCM के साथ एन्क्रिप्ट किया गया है, जो `SECRETS_ENCRYPTION_KEY` द्वारा कुंजीबद्ध है (`BETTER_AUTH_SECRET` पर वापस आते हुए); इसके बिना उत्पादन शुरू होने से इंकार कर दिया जाता है। किसी भी पहले से मौजूद प्लेनटेक्स्ट क्रेडेंशियल पंक्तियों को एन्क्रिप्ट करने के लिए, `pnpm action db-migrate-encrypt-credentials` (निष्क्रिय, गैर-विनाशकारी) चलाएँ।

`settings`, `application_state`, स्रोत कोड, या कार्रवाई प्रतिक्रियाओं में कभी भी रहस्य संग्रहीत न करें। उपरोक्त क्रेडेंशियल / वॉल्ट APIs का उपयोग करें - वे एन्क्रिप्शन और प्रति-उपयोगकर्ता स्कोपिंग दोनों को संभालते हैं।

## प्रमाणीकरण {#auth}

प्रमाणीकरण स्वचालित है. पूर्ण सेटअप के लिए [Authentication](/docs/authentication) दस्तावेज़ देखें।

**सुरक्षा के लिए मुख्य बिंदु:**

- `defineAction` एंडपॉइंट ऑथ गार्ड द्वारा स्वतः-संरक्षित हैं
- कस्टम `/api/` मार्गों को `getSession(event)` पर कॉल करना होगा और परिणाम की जांच करनी होगी
- राज्य-परिवर्तन संचालन को POST (actions के लिए डिफ़ॉल्ट) का उपयोग करना चाहिए
- `SameSite=lax` + `httpOnly` कुकीज़ अधिकांश CSRF हमलों को रोकती हैं

## A2A पहचान सत्यापन {#a2a-identity}

जब ऐप्स A2A प्रोटोकॉल के माध्यम से एक-दूसरे को कॉल करते हैं, तो वे एक साझा रहस्य के साथ हस्ताक्षरित JWT टोकन का उपयोग करके पहचान सत्यापित करते हैं:

```bash
A2A_SECRET=your-shared-secret-at-least-32-chars
```

1. ऐप A एक JWT पर हस्ताक्षर करता है जिसमें `sub: "steve@example.com"` होता है
2. ऐप B उसी रहस्य से JWT हस्ताक्षर को सत्यापित करता है
3. ऐप बी सत्यापित `sub` दावे को अनुरोध संदर्भ में पढ़ता है
4. डेटा स्कोपिंग लागू होती है - ऐप बी केवल स्टीव का डेटा दिखाता है

उत्पादन में `A2A_SECRET` के बिना, प्रत्येक A2A एंडपॉइंट और `/_agent-native/integrations/process-task` सेल्फ-फायर एंडपॉइंट रिटर्न **503**। इसे हर उस ऐप पर सेट करें जो A2A ट्रैफ़िक कॉल करता है या प्राप्त करता है। (स्थानीय विकास के लिए ढांचा अभी भी अप्रमाणित कॉल की अनुमति देता है।)

## इनबाउंड Webhooks {#webhooks}

इनबाउंड वेबहुक हैंडलर (रीसेंड, सेंडग्रिड, Slack, टेलीग्राम, व्हाट्सएप, रिकॉल.एआई, डीपग्राम, ज़ूम, गूगल डॉक्स पब/सब) उत्पादन में डिफ़ॉल्ट रूप से जाली अनुरोधों को अस्वीकार कर देते हैं: जब संबंधित हस्ताक्षरित गुप्त एनवी संस्करण गायब होता है, तो हैंडलर स्वीकार करने और भेजने के बजाय 401 लौटाता है।

यह पहले एक "चेतावनी देने और स्वीकार करने" का रुख था - उस रहस्य को सेट करें जिसे आप अन्यथा अनदेखा कर देंगे, या केवल स्थानीय विकास के लिए `AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS=1` के साथ पुराने व्यवहार में वापस आने का विकल्प चुनें। प्रति-एकीकरण हस्ताक्षर-गुप्त चर के लिए [Messaging](/docs/messaging#env-vars) देखें।

## उत्पादन चेकलिस्ट {#production-checklist}

### प्रामाणिक एवं रहस्य

- [ ] `BETTER_AUTH_SECRET` को एक यादृच्छिक 32+ चार स्ट्रिंग (`openssl rand -hex 32`) पर सेट किया गया है, जब तक कि यह एक होस्टेड वर्कस्पेस तैनाती नहीं है जो इसे `A2A_SECRET` से प्राप्त करता है
- [ ] `OAUTH_STATE_SECRET` को एक अलग यादृच्छिक 32+ चार स्ट्रिंग पर सेट करें (`BETTER_AUTH_SECRET` का पुन: उपयोग न करें) - [OAuth State Signing](#oauth-state) देखें
- [ ] `A2A_SECRET` प्रत्येक ऐप पर सेट होता है जो कॉल करता है या A2A ट्रैफ़िक प्राप्त करता है - [A2A Identity Verification](#a2a-identity) देखें
- [ ] `SECRETS_ENCRYPTION_KEY` सेट (या `BETTER_AUTH_SECRET` फ़ॉलबैक पर भरोसा करें) - [Secrets Management](#secrets) देखें
- [ ] `AUTH_SKIP_EMAIL_VERIFICATION` उत्पादन में **नहीं** सेट है (या केवल QA पूर्वावलोकन परिनियोजन पर सेट है)

### वेबहुक रहस्य (आपके द्वारा उपयोग किए जाने वाले एकीकरण के लिए सेट करें)

- [ ] प्रत्येक सक्षम इनबाउंड एकीकरण के लिए हस्ताक्षरित गुप्त सेट - प्रति-एकीकरण सूची के लिए [Inbound Webhooks](#webhooks) और [Messaging](/docs/messaging#env-vars) देखें
- [ ] `AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS` उत्पाद में **नहीं** सेट है

### स्कीमा

- [ ] प्रत्येक उपयोगकर्ता-सामना वाली तालिका में `owner_email` है, बहु-उपयोगकर्ता तालिकाओं में भी `org_id` है - [Data Scoping](#data-scoping) देखें
- [ ] ओनेबल-टेबल रीड/राइट [access guards](#access-guards) के माध्यम से होता है
- [ ] सभी actions Zod `schema:` के साथ `defineAction` का उपयोग करते हैं - [Input Validation](#input-validation) देखें
- [ ] उपयोगकर्ता/एजेंट URLs के सर्वर-साइड फ़ेच `ssrfSafeFetch` के माध्यम से जाते हैं - [SSRF](#ssrf) देखें
- [ ] उपयोगकर्ता सामग्री के साथ कोई `dangerouslySetInnerHTML` नहीं (या आउटपुट DOMPurify के माध्यम से चलाया जाता है)
- [ ] कोई स्ट्रिंग-संबद्ध SQL
- [ ] `pnpm guards` साफ़ है (`guard-no-unscoped-queries`, `guard-no-env-credentials`, `guard-no-env-mutation`, `guard-no-localhost-fallback`, `guard-no-unscoped-credentials`, `guard-no-drizzle-push`)
- [ ] डेटा अलगाव को सत्यापित करने के लिए दो उपयोगकर्ता खातों के साथ परीक्षण किया गया

### विविध सख्तीकरण

- [ ] `AGENT_NATIVE_DEBUG_ERRORS` वास्तविक उत्पाद में **नहीं** सेट है (केवल डिबग पूर्वावलोकन पर)
- [ ] `AGENT_NATIVE_KEYS_WORKSPACE_FALLBACK` तब तक **नहीं** सेट है जब तक कि आपका संगठन वास्तव में कार्यस्थान कुंजी साझा नहीं करता है - [Cross-User Tooling Secrets](#tooling-secrets) देखें
- [ ] बहु-किरायेदार तैनाती में, **उपयोगकर्ता अपना स्वयं का `ANTHROPIC_API_KEY`** लाते हैं - ढांचा तैनाती-स्तर के एनवी संस्करण पर वापस आने से इंकार कर देता है

---

नीचे दिए गए अनुभाग आला पर्यावरण फ़्लैग को कवर करते हैं जिन तक आप केवल विशिष्ट परिनियोजन में पहुंचते हैं। अधिकांश ऐप्स उन्हें कभी नहीं छूते.

## OAuth राज्य हस्ताक्षर {#oauth-state}

OAuth प्रवाह (Google, एटलसियन, ज़ूम) एक समर्पित HMAC कुंजी के साथ अपने राज्य लिफाफे पर हस्ताक्षर करते हैं:

```bash
OAUTH_STATE_SECRET=$(openssl rand -hex 32)
```

यह `GOOGLE_CLIENT_SECRET` (Google के साथ साझा किया गया एक क्रेडेंशियल) पर वापस आता था - Google रहस्य के लीक होने से हमलावरों को OAuth राज्य लिफाफे बनाने की अनुमति मिल जाती। समर्पित कुंजी किसी भी तीसरे पक्ष के रहस्य से स्वतंत्र है। यदि `OAUTH_STATE_SECRET` अनसेट है, तो फ्रेमवर्क वापस `BETTER_AUTH_SECRET` पर आ जाता है; होस्ट किए गए कार्यक्षेत्र परिनियोजन पहले से आवश्यक `A2A_SECRET` से प्रति-उद्देश्य OAuth कुंजी भी प्राप्त कर सकते हैं। यदि उन सर्वर रहस्यों में से कोई भी उपलब्ध नहीं है, तो OAuth प्रवाह उत्पादन में विफल हो जाता है।

`redirect_uri` क्वेरी पैरामीटर को एक अनुमति सूची (समान मूल + फ्रेमवर्क `/_agent-native/...` पथ) के विरुद्ध भी मान्य किया जाता है। टेम्प्लेट में कस्टम OAuth प्रवाह को राज्य पर हस्ताक्षर करने से पहले फ्रेमवर्क के `isAllowedOAuthRedirectUri()` हेल्पर का उपयोग करना चाहिए।

## क्रॉस-यूज़र टूलींग रहस्य {#tooling-secrets}

`${keys.NAME}` को संदर्भित करने वाले उपकरण और ऑटोमेशन डिफ़ॉल्ट रूप से प्रति-उपयोगकर्ता रहस्यों को हल करते हैं। इस संस्करण में वर्कस्पेस-स्कोप फ़ॉलबैक **डिफ़ॉल्ट रूप से बंद** है - एक दुर्भावनापूर्ण संगठन सदस्य अन्यथा वर्कस्पेस `OPENAI_API_KEY` प्लांट कर सकता है और अन्य सदस्यों की API कॉल काट सकता है।

यदि आपका संगठन वास्तव में कार्यस्थान-व्यापी कुंजियाँ साझा करता है (उदाहरण के लिए एकल कॉर्पोरेट स्ट्राइप कुंजी), तो पुराने व्यवहार में वापस आने का विकल्प चुनें:

```bash
AGENT_NATIVE_KEYS_WORKSPACE_FALLBACK=1
```

वर्कस्पेस-स्कोप गुप्त लेखन के लिए इस ध्वज की परवाह किए बिना अभी भी संगठन स्वामी/व्यवस्थापक भूमिका की आवश्यकता होती है।
