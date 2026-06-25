---
title: "प्रमाणीकरण"
description: "ईमेल/पासवर्ड, सामाजिक प्रदाताओं, संगठनों और MCP वाहक क्रेडेंशियल्स के साथ बेहतर प्रामाणिक एकीकरण।"
---

# प्रमाणीकरण

एजेंट-नेटिव ऐप्स अकाउंट-फर्स्ट डिज़ाइन के साथ प्रमाणीकरण के लिए [Better Auth](https://better-auth.com) का उपयोग करते हैं। उपयोगकर्ता पहली विज़िट पर एक खाता बनाते हैं और पहले दिन से वास्तविक पहचान प्राप्त करते हैं।

## अवलोकन {#overview}

ऑथ सर्वर प्लगइन में `autoMountAuth(app)` के माध्यम से ऑथ स्वचालित रूप से कॉन्फ़िगर किया गया है। तीन मोड हैं:

- **डिफ़ॉल्ट:** ईमेल/पासवर्ड + सामाजिक प्रदाताओं के साथ बेहतर प्रामाणिकता। पहली बार विजिट करने पर ऑनबोर्डिंग पेज दिखाया गया।
- **रिमोट MCP OAuth:** MCP होस्ट जैसे Claude कोड और ChatGPT कनेक्टर के लिए मानक OAuth 2.1।
- **कस्टम:** `getSession` कॉलबैक के माध्यम से अपना स्वयं का लेख लाएँ।

```an-diagram title="तीन तरह से, एक सत्र" summary="ब्राउज़र विज़िटर, प्रोग्रामेटिक MCP क्लाइंट और कस्टम प्रदाता सभी उसी AuthSession को हल करते हैं जिसे डाउनस्ट्रीम स्कोपिंग पढ़ता है।"
{
  "html": "<div class=\"auth-modes\"><div class=\"diagram-col\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Default</span><strong>Better Auth</strong><small class=\"diagram-muted\">email/password &middot; Google &middot; GitHub</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">Remote MCP OAuth</span><strong>OAuth 2.1 + PKCE</strong><small class=\"diagram-muted\">Claude Code, ChatGPT कनेक्टर</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">Custom</span><strong>getSession callback</strong><small class=\"diagram-muted\">Clerk &middot; Auth0 &middot; Firebase</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill ok\">AuthSession</span><small class=\"diagram-muted\">email &middot; orgId &middot; orgRole</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Request context &amp; data scoping</div></div>",
  "css": ".auth-modes{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.auth-modes .diagram-col{display:flex;flex-direction:column;gap:10px}.auth-modes .diagram-card{display:flex;flex-direction:column;gap:4px;padding:10px 12px}.auth-modes .diagram-arrow{font-size:22px;line-height:1}.auth-modes .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

ब्राउज़र प्रवाह हर जगह समान बेहतर प्रामाणिक प्रवाह है - **कोई डेव ऑथ बाईपास** नहीं है, और `getSession()` कभी भी `local@localhost` प्रहरी पर वापस नहीं आता है। परिवेशों के बीच जो परिवर्तन होता है वह साइनअप घर्षण है, लॉगिन वॉल नहीं:

| पर्यावरण             | प्रथम-लोड व्यवहार                                                                           | ईमेल सत्यापन                                                   |
| -------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **स्थानीय देव**      | स्वचालित रूप से एक थ्रोअवे डेव अकाउंट बनाता है और आपको साइन इन करता है (कोई लॉगिन वॉल नहीं) | डिफ़ॉल्ट रूप से छोड़ दिया गया (और जब कोई ईमेल प्रदाता नहीं हो) |
| **QA / पूर्वावलोकन** | सामान्य साइनअप, लेकिन सत्यापन छोड़ा जा सकता है ताकि परीक्षक ईमेल पर प्रतीक्षा न करें        | `AUTH_SKIP_EMAIL_VERIFICATION=1` के साथ छोड़ें                 |
| **उत्पादन**          | सामान्य बेहतर प्रामाणिक साइनअप/लॉगिन                                                        | आवश्यक (जब कोई ईमेल प्रदाता कॉन्फ़िगर किया गया हो)             |

कुछ झंडे इसे ट्यून करते हैं; संपूर्ण विवरण [Environment Variables](#environment-variables) तालिका में हैं:

- `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1` - ऑटो डेव खाते के बजाय स्थानीय डेव में सामान्य साइनअप पृष्ठ का उपयोग करें।
- `AUTH_DISABLED=true` - लॉगिन/साइनअप को पूरी तरह से छोड़ दें और प्रत्येक अनुरोध को एक साझा उपयोगकर्ता के रूप में चलाएं (केवल स्थानीय विकास/पूर्वावलोकन/डेमो, वास्तविक उपयोगकर्ताओं के साथ कभी उत्पादन नहीं)।
- `AUTH_MODE=local` - केवल CLI/एजेंट पहचान को प्रभावित करता है (जो डेव उपयोगकर्ता `pnpm action` के रूप में चलता है); यह ब्राउज़र लॉगिन बायपास **नहीं** है।

```an-callout
{
  "tone": "warning",
  "body": "`AUTH_DISABLED=true` runs **every request as one shared user**. Use it only for local dev, previews, or demos — never in production with real users, where it would expose all data to anyone."
}
```

## बेहतर प्रमाणीकरण (डिफ़ॉल्ट) {#better-auth}

डिफ़ॉल्ट रूप से, Better Auth प्रमाणीकरण को शक्ति प्रदान करता है। यह प्रदान करता है:

- ईमेल/पासवर्ड पंजीकरण और लॉगिन
- सामाजिक प्रदाता (Google, GitHub, और 35+ अन्य)
- भूमिकाओं और आमंत्रणों वाले संगठन
- API और A2A एक्सेस के लिए JWT टोकन
- प्रोग्रामेटिक क्लाइंट के लिए बियरर टोकन समर्थन

बेहतर प्रामाणिक मार्ग `/_agent-native/auth/ba/*` पर स्थापित हैं। फ्रेमवर्क पिछड़े-संगत समापन बिंदु भी प्रदान करता है:

- `GET /_agent-native/auth/session` - वर्तमान सत्र प्राप्त करें
- `POST /_agent-native/auth/login` - ईमेल/पासवर्ड लॉगिन
- `POST /_agent-native/auth/register` - खाता बनाएं
- `POST /_agent-native/auth/logout` - साइन आउट करें

## कुकी क्षेत्र {#cookie-realms}

सत्र कुकी का क्षेत्र परिनियोजन आकार का अनुसरण करता है, इसलिए जो ऐप्स एक साझा करते हैं
डेटाबेस/मूल शेयर साइन-इन और ऐप्स जो अलग-थलग नहीं रहते:

| परिनियोजन आकार                                          | कुकी क्षेत्र                                                                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| स्टैंडअलोन ऐप                                           | प्रति ऐप स्लग द्वारा पृथक (`APP_NAME`, या स्थानीय डेव में पैकेज का नाम); उत्पादन में स्थिर `an` उपसर्ग                                       |
| कार्यस्थान मोड (`AGENT_NATIVE_WORKSPACE=1`)             | एक साझा क्षेत्र - कार्यक्षेत्र ऐप्स एक मूल और डेटाबेस साझा करते हैं                                                                          |
| कस्टम समान-डेटाबेस उपडोमेन                              | `COOKIE_DOMAIN` के साथ साझा कुकीज़ में ऑप्ट इन करें                                                                                          |
| प्रथम-पक्ष द्वारा होस्ट किया गया (`*.agent-native.com`) | प्रति ऐप पृथक नामस्थान (प्रत्येक का अपना प्रमाणीकरण डेटाबेस है); `COOKIE_DOMAIN=.agent-native.com` को डिफ़ॉल्ट रूप से अनदेखा कर दिया जाता है |

प्रथम-पक्ष द्वारा होस्ट किए गए ऐप्स में से प्रत्येक का अपना प्रमाणीकरण डेटाबेस होता है, इसलिए क्रॉस-ऐप साइन-इन करें
साझा कुकी के बजाय [Cross-App SSO](/docs/cross-app-sso) से गुजरता है।
इन तैनाती को `APP_NAME` या एक व्युत्पन्न ऐप URL (`APP_URL`, `URL`,
`DEPLOY_PRIME_URL`, या `DEPLOY_URL`); अन्यथा स्टार्टअप गिरने के बजाय विफल हो जाता है
साझा `an_session` नाम पर वापस जाएँ। जानबूझकर एक ऑथ डेटाबेस साझा करना
उपडोमेन में, `AGENT_NATIVE_SHARE_COOKIE_DOMAIN=1` को साथ में सेट करें
`COOKIE_DOMAIN`.

## क्यूए खाते {#qa-accounts}

स्थानीय विकास और परीक्षण डिफ़ॉल्ट रूप से साइनअप ईमेल सत्यापन को छोड़ देते हैं, इसलिए आप
इनबॉक्स की प्रतीक्षा किए बिना वास्तविक ईमेल/पासवर्ड खाते बना सकते हैं। जबरदस्ती करना
उस प्रवाह का परीक्षण करते समय स्थानीय रूप से सत्यापन, `AUTH_SKIP_EMAIL_VERIFICATION=0` सेट करें।

होस्ट किए गए QA परिवेशों के लिए जहां परीक्षकों को वास्तविक खातों की आवश्यकता होती है, लेकिन प्रतीक्षा नहीं करनी चाहिए
ईमेल डिलीवरी पर, सेट करें:

```bash
AUTH_SKIP_EMAIL_VERIFICATION=1
```

जब यह फ़्लैग सेट होता है, तो ईमेल/पासवर्ड साइनअप के लिए ईमेल की आवश्यकता नहीं होती है
सत्यापन और साइनअप सत्यापन ईमेल नहीं भेजा गया है। इसका उपयोग केवल QA
या परिवेश का पूर्वावलोकन करें, और `+qa` पते के साथ परीक्षण खातों को नाम दें
(`name+qa@example.com`) ताकि उन्हें पहचानना आसान हो।

## सामाजिक प्रदाता {#social-providers}

सामाजिक लॉगिन सक्षम करने के लिए पर्यावरण चर सेट करें। Better Auth उनका स्वत: पता लगाता है:

```bash
# Google OAuth
GOOGLE_SIGN_IN_CLIENT_ID=your-low-scope-sign-in-client-id
GOOGLE_SIGN_IN_CLIENT_SECRET=your-low-scope-sign-in-client-secret

# बैकवर्ड-संगत फ़ॉलबैक, और टेम्प्लेट के लिए प्रदाता OAuth क्रेडेंशियल
# जो Google API जैसे Gmail या Calendar से कनेक्ट होता है।
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret

# GitHub OAuth
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
```

`createGoogleAuthPlugin()` का उपयोग करने वाले टेम्प्लेट एक "Google के साथ साइन इन करें" पृष्ठ दिखाते हैं। Google OAuth कॉलबैक मूल ऐप्स के लिए मोबाइल डीप लिंकिंग को स्वचालित रूप से संभालता है।

सामान्य के लिए `GOOGLE_SIGN_IN_CLIENT_ID` / `GOOGLE_SIGN_IN_CLIENT_SECRET` को प्राथमिकता दें
ऐप लॉगिन। उस ग्राहक को केवल पहचान के दायरे का अनुरोध करना चाहिए। रखें
आवश्यक उत्पाद एकीकरण के लिए `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
Google API स्कोप, या जब किसी तैनाती को विभाजित नहीं किया गया है तो विरासत फ़ॉलबैक के रूप में
अभी तक. मेल और कैलेंडर-शैली ऐप्स को अपने स्वयं के प्रदाता OAuth क्लाइंट का उपयोग करना चाहिए
हाई-स्कोप सहमति स्क्रीन सामान्य ऐप साइन-इन को प्रभावित नहीं करती हैं।

### OAuth राज्य हस्ताक्षर {#oauth-state-secret}

`OAUTH_STATE_SECRET` को उत्पादन में एक यादृच्छिक 32+ चार मान पर सेट करें ताकि OAuth राज्य लिफाफे (Google, एटलसियन, ज़ूम) किसी तीसरे पक्ष के रहस्य से स्वतंत्र एक समर्पित कुंजी के साथ HMAC-हस्ताक्षरित हों। संपूर्ण आवश्यकताओं और खतरे के मॉडल के लिए [Security — OAuth State Signing](/docs/security#oauth-state) देखें।

## संगठन {#organizations}

ढांचा एक अंतर्निहित संगठन प्रणाली प्रदान करता है। यह फ्रेमवर्क का अपना `org/` मॉड्यूल है - जो `organizations` और `org_members` तालिकाओं द्वारा समर्थित है - बेटर ऑथ का संगठन प्लगइन नहीं है, जो जानबूझकर पंजीकृत नहीं है। प्रत्येक ऐप इसका समर्थन करता है:

- संगठन बनाना
- सदस्यों को भूमिकाओं के साथ आमंत्रित करना (`owner`, `admin`, `member`)
- सक्रिय संगठन को बदलना
- `org_id` कॉलम के माध्यम से प्रति संगठन डेटा स्कोपिंग

सक्रिय संगठन को सत्र पर `session.orgId` के रूप में ट्रैक किया जाता है, और संगठनों को स्विच करने से उपयोगकर्ता और एजेंट द्वारा देखा जाने वाला डेटा बदल जाता है। डेटा स्कोपिंग स्वयं स्टैक के नीचे होती है - संपूर्ण `session.orgId → AGENT_ORG_ID → SQL` पाइपलाइन और एक्सेस गार्ड के लिए [Security & Data Scoping](/docs/security#data-scoping) देखें। [Multi-Tenancy](/docs/multi-tenancy) दस्तावेज़ संगठन-प्रबंधन सतह को कवर करते हैं।

## स्टेटिक MCP बियरर टोकन {#access-tokens}

`ACCESS_TOKEN` और `ACCESS_TOKENS` ब्राउज़र प्राधिकरण नहीं हैं और किसी ऐप को निजी नहीं बनाते हैं। वे केवल MCP/कनेक्ट क्लाइंट के लिए स्थिर वाहक क्रेडेंशियल के रूप में बने रहते हैं जो OAuth प्रवाह का उपयोग नहीं कर सकते।

```bash
# एकल टोकन
ACCESS_TOKEN=my-secret-token

# एकाधिक टोकन
ACCESS_TOKENS=token1,token2,token3
```

इन वेरिएबल्स को कॉन्फ़िगर करने से विज़िटरों के लिए कभी भी टोकन लॉगिन पेज नहीं बनता है। वेब साइन-इन Better Auth या आपके कस्टम `getSession` प्रदाता पर रहता है।

## रिमोट MCP OAuth {#remote-mcp-oauth}

प्रत्येक ऐप का MCP एंडपॉइंट एक मानक संरक्षित MCP संसाधन के रूप में कार्य कर सकता है। OAuth-सक्षम क्लाइंट को केवल दूरस्थ MCP URL के साथ कॉन्फ़िगर किया जा सकता है:

```text
https://mail.agent-native.com/_agent-native/mcp
```

अप्रमाणित MCP अनुरोध `/.well-known/oauth-protected-resource` की ओर इशारा करते हुए एक `WWW-Authenticate` चुनौती लौटाते हैं। क्लाइंट तब ऐप के OAuth मेटाडेटा को खोजता है, गतिशील रूप से एक सार्वजनिक क्लाइंट को पंजीकृत करता है, ऐप के प्राधिकरण पृष्ठ को खोलता है, और एक्सेस और रीफ्रेश टोकन के लिए PKCE के साथ एक प्राधिकरण कोड का आदान-प्रदान करता है।

```an-diagram title="रिमोट MCP OAuth हैंडशेक" summary="एक OAuth-सक्षम क्लाइंट केवल MCP URL से बूटस्ट्रैप करता है - चुनौती, खोज, गतिशील पंजीकरण, फिर एक PKCE कोड एक्सचेंज।"
{
  "html": "<div class=\"mcp-flow\"><div class=\"diagram-node\">1 &middot; MCP request<br><small class=\"diagram-muted\">no token</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node warn\">2 &middot; 401 challenge<br><small class=\"diagram-muted\">WWW-Authenticate</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">3 &middot; Discover metadata<br><small class=\"diagram-muted\">.well-known</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">4 &middot; Register client<br><small class=\"diagram-muted\">डायनामिक, सार्वजनिक</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">5 &middot; Authorize + PKCE<br><small class=\"diagram-muted\">code exchange</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node ok\">6 &middot; Access + refresh<br><small class=\"diagram-muted\">audience-bound</small></div></div>",
  "css": ".mcp-flow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.mcp-flow .diagram-node{display:flex;flex-direction:column;gap:2px;padding:8px 12px}.mcp-flow .diagram-arrow{font-size:20px;line-height:1}"
}
```

सेट होने पर एक्सेस टोकन `A2A_SECRET` के साथ हस्ताक्षरित होते हैं, अन्यथा `BETTER_AUTH_SECRET`। वे हस्ताक्षरित उपयोगकर्ता/संगठन पहचान और `mcp:read`, `mcp:write`, और/या `mcp:apps` स्कोप रखते हैं, और सटीक MCP संसाधन URL के लिए दर्शकों से बंधे हैं। रिफ्रेश टोकन केवल हैश के रूप में संग्रहीत होते हैं और प्रत्येक रिफ्रेश पर घूमते हैं। टूल कॉल और MCP ऐप्स संसाधन रीड साइन-इन उपयोगकर्ता के समान अनुरोध संदर्भ के अंदर चलते हैं; एम्बेडेड MCP ऐप iframe को कभी भी कच्चा OAuth टोकन प्राप्त नहीं होता है।

`npx @agent-native/core@latest connect <url> --client claude-code` इस मानक प्रवाह के लिए केवल URL MCP प्रविष्टि लिखता है। उन ग्राहकों के लिए जो दूरस्थ MCP OAuth नहीं कर सकते, एक स्पष्ट बियरर-टोकन प्रविष्टि लिखने के लिए कनेक्ट पेज या `npx @agent-native/core@latest connect --token <token>` फ़ॉलबैक का उपयोग करें।

## अपनी स्वयं की प्रामाणिकता लाएं {#byoa}

किसी भी प्रमाणीकरण प्रदाता (क्लर्क, Auth0, Firebase, आदि) का उपयोग करने के लिए एक कस्टम `getSession` कॉलबैक पास करें:

```ts
// server/plugins/auth.ts
import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  getSession: async (event) => {
    // Your custom auth logic here
    const session = await myAuthProvider.verify(event);
    if (!session) return null;
    return { email: session.email };
  },
  publicPaths: ["/api/webhooks"],
});
```

## सार्वजनिक कार्यक्षेत्र ऐप्स {#public-workspace-apps}

वर्कस्पेस ऐप्स डिफ़ॉल्ट रूप से आंतरिक होते हैं। अनाम आगंतुकों को सार्वजनिक रूप से लोड करने देने के लिए
साइट प्रबंधन पृष्ठों को प्रमाणीकरण के पीछे रखते हुए, रूट एक्सेस की घोषणा करें
`apps/<id>/package.json`:

```json
{
  "agent-native": {
    "workspaceApp": {
      "audience": "public",
      "protectedPaths": ["/admin"]
    }
  }
}
```

उल्टे आकार के लिए, डिफ़ॉल्ट आंतरिक दर्शक रखें और केवल एक्सपोज़ करें
विशिष्ट सार्वजनिक पृष्ठ:

```json
{
  "agent-native": {
    "workspaceApp": {
      "publicPaths": ["/", "/share"]
    }
  }
}
```

`publicPaths` और `protectedPaths` उपसर्ग मिलान का उपयोग करते हैं, इसलिए `"/admin"` भी
`"/admin/users"` को कवर करता है। ये सेटिंग्स केवल पेज नेविगेशन खोलती हैं। ढाँचा
रूट (`/_agent-native/*`) और कस्टम API रूट (`/api/*`) के लिए अभी भी प्रमाणीकरण की आवश्यकता है
जब तक ऐप स्पष्ट रूप से उन उपसर्गों को इसमें नहीं जोड़ता
`createAuthPlugin({ publicPaths: [...] })`.

## सत्र API {#session-api}

`getSession(event)` द्वारा लौटाए गए सत्र ऑब्जेक्ट का आकार यह है:

```ts
interface AuthSession {
  email: string; // User's email (primary identifier)
  userId?: string; // Better Auth user ID
  token?: string; // Session token
  name?: string; // Display name from the auth provider, when available
  image?: string; // Profile image from the auth provider, when available
  orgId?: string; // Active organization ID
  orgRole?: string; // Role in active org (owner/admin/member)
}
```

क्लाइंट पर, `useSession()` हुक का उपयोग करें:

```ts
import { useSession } from "@agent-native/core/client";

function MyComponent() {
  const { session, isLoading } = useSession();
  if (isLoading) return <p>Loading...</p>;
  if (!session) return <p>Not signed in</p>;
  return <p>Hello, {session.email}</p>;
}
```

## रिटर्न URL के साथ साइन-इन करें {#sign-in-return-url}

**सार्वजनिक पेज** (शेयर लिंक, एंबेड, मार्केटिंग पेज) वाले टेम्पलेट्स को अक्सर एक इन-पेज CTA की आवश्यकता होती है जो अज्ञात दर्शकों को साइन इन करने के लिए कहता है और उन्हें उस पेज पर वापस लाता है जिस पर वे थे। फ़्रेमवर्क इसके लिए एकल प्रवेश बिंदु प्रदान करता है:

```
/_agent-native/sign-in?return=<same-origin-path>
```

जब कोई गुमनाम दर्शक इस URL पर क्लिक करता है, तो फ्रेमवर्क का लॉगिन पेज प्रस्तुत किया जाता है। सफल साइन-इन (कोई भी प्रवाह - टोकन, ईमेल/पासवर्ड, या Google OAuth) के बाद, दर्शक `return` पर 302'd है।

`return` पैरामीटर को **समान मूल पथ** के रूप में मान्य किया गया है। नेटवर्क-पथ संदर्भ (`//evil.com/...`), निरपेक्ष URLs, `data:` / `javascript:` योजनाएं, और एम्बेडेड नियंत्रण वर्ण सभी `/` पर वापस आते हैं। मान्य पथ को URL पार्सर से पुनर्निर्मित किया गया है, इनपुट से वापस प्रतिध्वनित नहीं किया गया है।

**React घटक से:**

```tsx
import { Button } from "@/components/ui/button";

function SignInCta() {
  const onClick = () => {
    const ret = window.location.pathname + window.location.search;
    window.location.href =
      "/_agent-native/sign-in?return=" + encodeURIComponent(ret);
  };
  return <Button onClick={onClick}>Sign in</Button>;
}
```

### निजी पथ बुकमार्क किए गए

जब कोई अनाम उपयोगकर्ता सीधे `/dashboard` जैसे निजी पथ पर नेविगेट करता है, तो फ्रेमवर्क पहले से ही उस URL पर लॉगिन पेज परोसता है - सफल साइन-इन के बाद, पेज पुनः लोड होता है और उपयोगकर्ता `/dashboard` पर पहुंच जाता है। किसी विशेष संभाल की आवश्यकता नहीं; यह टोकन, ईमेल/पासवर्ड, **और** Google OAuth के लिए काम करता है।

### पर्दे के पीछे: Google OAuth

दोनों प्रवाह (स्पष्ट `/_agent-native/sign-in` प्रविष्टि बिंदु और बुकमार्क-पथ केस) OAuth स्थिति के माध्यम से रिटर्न URL को थ्रेड करते हैं। राज्य HMAC-हस्ताक्षरित है, इसलिए इसे पारगमन में जाली नहीं बनाया जा सकता है। कॉलबैक पर, रिटर्न URL को रीडायरेक्ट से पहले समान-मूल के रूप में पुनः मान्य किया जाता है - इसलिए एक लीक हुई साइनिंग कुंजी को अभी भी ओपन-रीडायरेक्ट ऑरेकल में नहीं बदला जा सकता है।

यदि आपका टेम्प्लेट सीधे `/_agent-native/google/auth-url` को लपेटता है (उदाहरण के लिए मेल और कैलेंडर टेम्प्लेट, दायरा बढ़ाने के लिए करते हैं), तो एक `?return=<path>` क्वेरी स्वीकार करें और इसे `encodeOAuthState` के विकल्प-ऑब्जेक्ट फॉर्म के माध्यम से अग्रेषित करें:

```ts
const returnUrl = getQuery(event).return;
const state = encodeOAuthState({
  redirectUri,
  desktop,
  returnUrl: typeof returnUrl === "string" ? returnUrl : undefined,
});
```

डिफ़ॉल्ट `/_agent-native/google/auth-url` रूट यह स्वचालित रूप से करता है - केवल तभी ओवरराइड करें जब आपके टेम्पलेट को कस्टम OAuth हैंडलिंग की आवश्यकता हो।

## पर्यावरण चर {#environment-variables}

| वेरिएबल                                 | उद्देश्य                                                                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                    | बेहतर प्रमाणीकरण के लिए हस्ताक्षर कुंजी (यदि सेट नहीं है तो स्वतः उत्पन्न)                                                                                                                  |
| `AUTH_SKIP_EMAIL_VERIFICATION`          | ईमेल/पासवर्ड साइनअप को सत्यापन के बिना आगे बढ़ने देने के लिए QA/पूर्वावलोकन वातावरण में `1` पर सेट करें; स्थानीय विकास/परीक्षण डिफ़ॉल्ट रूप से स्किप हो जाता है                             |
| `AUTH_DISABLED`                         | लॉगिन/साइनअप छोड़ने के लिए `true` या `1` पर सेट करें; सभी अनुरोध एक साझा उपयोगकर्ता के रूप में चलते हैं (केवल स्थानीय विकास/पूर्वावलोकन - वास्तविक उपयोगकर्ताओं के साथ उत्पादन के लिए नहीं) |
| `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT` | ताज़ा डेव डेटाबेस पर लोकलहोस्ट ऑटो-साइन-इन को अक्षम करने के लिए `1` पर सेट करें                                                                                                             |
| `AUTH_MODE`                             | `local` केवल CLI/एजेंट पहचान का समाधान करता है (जो देव उपयोगकर्ता `pnpm action` के रूप में चलता है); ब्राउज़र लॉगिन को कभी भी बायपास न करें                                                 |
| `COOKIE_DOMAIN`                         | समान-डेटाबेस उपडोमेन में साझा सत्र कुकीज़ में ऑप्ट इन करें ([Cookie Realms](#cookie-realms) देखें)                                                                                          |
| `AGENT_NATIVE_WORKSPACE`                | `1` वर्कस्पेस मोड में चलता है - वर्कस्पेस ऐप्स में एक साझा सत्र क्षेत्र                                                                                                                     |
| `AGENT_NATIVE_SHARE_COOKIE_DOMAIN`      | प्रथम-पक्ष उपडोमेन में एक प्रमाणीकरण डेटाबेस साझा करने के लिए `COOKIE_DOMAIN` के साथ सेट करें                                                                                               |
| `OAUTH_STATE_SECRET`                    | OAuth राज्य लिफाफे के लिए समर्पित HMAC कुंजी ([Security — OAuth State Signing](/docs/security#oauth-state) देखें)                                                                           |
| `GOOGLE_SIGN_IN_CLIENT_ID`              | ऐप लॉगिन के लिए पसंदीदा कम-स्कोप Google OAuth क्लाइंट आईडी                                                                                                                                  |
| `GOOGLE_SIGN_IN_CLIENT_SECRET`          | ऐप लॉगिन के लिए पसंदीदा लो-स्कोप Google OAuth रहस्य                                                                                                                                         |
| `GOOGLE_CLIENT_ID`                      | विरासत Google लॉगिन फ़ॉलबैक, और Google API एकीकरण के लिए प्रदाता OAuth क्लाइंट आईडी                                                                                                         |
| `GOOGLE_CLIENT_SECRET`                  | विरासत Google लॉगिन फ़ॉलबैक, और Google API एकीकरण के लिए प्रदाता OAuth रहस्य                                                                                                                |
| `GITHUB_CLIENT_ID`                      | GitHub OAuth सक्षम करें                                                                                                                                                                     |
| `GITHUB_CLIENT_SECRET`                  | GitHub OAuth रहस्य                                                                                                                                                                          |
| `ACCESS_TOKEN`                          | MCP/कनेक्ट क्लाइंट के लिए स्टेटिक बियरर फ़ॉलबैक; ब्राउज़र प्रमाणीकरण नहीं                                                                                                                   |
| `ACCESS_TOKENS`                         | MCP/कनेक्ट क्लाइंट के लिए अल्पविराम से अलग किए गए स्थिर बियरर फ़ॉलबैक; ब्राउज़र प्रमाणीकरण नहीं                                                                                             |
| `A2A_SECRET`                            | JWT-हस्ताक्षरित A2A क्रॉस-ऐप पहचान सत्यापन के लिए साझा रहस्य और, मौजूद होने पर, MCP OAuth एक्सेस-टोकन हस्ताक्षर                                                                             |
