import type { EnvironmentBadgeMessages } from "../../environment-badge-messages.js";
import type {
  McpConnectMessages,
  McpSettingsMessages,
} from "../../mcp-settings-messages.js";
import type { PrivacySettingsMessages } from "../../privacy-settings-messages.js";

export const environmentBadgeMessages: EnvironmentBadgeMessages = {
  betaLabel: "बीटा",
  betaTitle: "आप Agent-Native {{label}} पर हैं",
  productionTitle: "आप Agent-Native प्रोडक्शन पर हैं",
  activeDevelopment: "सक्रिय विकास के तहत",
  feedbackPrompt:
    "यह टेम्पलेट सक्रिय विकास के तहत है। इसे बेहतर बनाने के लिए आपका फ़ीडबैक हमें पसंद आएगा।",
  continuePrompt: "चुनें कि आप कहाँ जारी रखना चाहते हैं।",
  switchToProduction: "प्रोडक्शन पर स्विच करें",
  goToBeta: "बीटा पर जाएँ",
  hideBadge: "बैज छिपाएँ",
  openSwitcher: "{{title}} स्विचर खोलें",
  localDevelopment: "स्थानीय विकास परिवेश",
  development: "विकास परिवेश",
};

export const mcpConnectMessages: McpConnectMessages = {
  pageTitle: "{appName} कनेक्ट करें",
  authorizeLabel: "{appName} को अनुमति दें",
  terminalTitle: "अपने terminal से {appName} को अनुमति दें?",
  assistantTitle: "अपने AI assistant से {appName} का उपयोग करें",
  signedInAs: "इस रूप में साइन इन",
  deviceCode: "डिवाइस कोड",
  guidesLabel: "MCP URL गाइड",
  advancedOptions: "उन्नत विकल्प",
  labelOptional: "लेबल (वैकल्पिक)",
  labelPlaceholder: "उदाहरण: मेरे laptop पर Claude Code",
  expiresInDays: "समाप्ति (दिन, 1–365)",
  terminalAlternative: "Terminal विकल्प",
  existingConnections: "मौजूदा कनेक्शन",
  checkingConnections: "कनेक्शन जाँचे जा रहे हैं...",
  unavailable: "उपलब्ध नहीं",
  couldNotLoadConnections: "कनेक्शन लोड नहीं किए जा सके।",
  emptyConnections: "बाद में revoke करने के लिए बनाए गए कनेक्शन यहाँ दिखेंगे।",
  unlabeled: "(बिना लेबल)",
  lastUsed: "अंतिम उपयोग",
  revoked: "Revoke किया गया",
  created: "बनाया गया",
  revoke: "Revoke करें",
  couldNotRevoke: "Token revoke नहीं किया जा सका।",
  authorizeDevice: "डिवाइस को अनुमति दें",
  fullCatalogRequested: "यह डिवाइस पूरे एक्शन कैटलॉग तक पहुंच का अनुरोध कर रहा है।",
  createToken: "कनेक्शन token बनाएँ",
  authorizingDevice: "डिवाइस को अनुमति दी जा रही है...",
  creatingToken: "Token बनाया जा रहा है...",
  couldNotAuthorize: "इस डिवाइस कोड को अनुमति नहीं दी जा सकी।",
  unknownDeviceCode:
    "यह डिवाइस कोड पहचाना नहीं गया। अपने टर्मिनल से कनेक्शन फिर शुरू करें।",
  expiredDeviceCode:
    "यह डिवाइस कोड समाप्त हो गया है। अपने टर्मिनल से कनेक्शन फिर शुरू करें।",
  alreadyUsedDeviceCode:
    "यह डिवाइस कोड पहले ही इस्तेमाल हो चुका है। अपने टर्मिनल से कनेक्शन फिर शुरू करें।",
  finishingConnection: "कनेक्शन पूरा हो रहा है… आप terminal पर लौट सकते हैं।",
  deviceAuthorized: "डिवाइस को अनुमति दी गई",
  connected: "कनेक्टेड",
  connectedDescription:
    "यह डिवाइस अब आपकी ओर से काम कर सकता है। नीचे इसे manage या revoke करें।",
  couldNotCreate: "Token बनाया नहीं जा सका।",
  networkError: "Network error. फिर से कोशिश करें।",
  urlTitle: "आपका MCP URL",
};

export const mcpSettingsMessages: McpSettingsMessages = {
  mcpTitle: "MCP",
  mcpDescription:
    "इस ऐप को Claude, ChatGPT, Cursor, Codex या किसी अन्य MCP host से कनेक्ट करें।",
  mcpUrlLabel: "MCP server URL",
  mcpUrlHint:
    "इस URL को उस AI host में कॉपी करें जिसका आप उपयोग करना चाहते हैं। मानक पथ /mcp है।",
  mcpOpenDocs: "MCP कनेक्शन दस्तावेज़ खोलें",
  a2aAgentCard: "A2A agent card",
  a2aOpenDocs: "A2A दस्तावेज़ खोलें",
  mcpClientSetup: "AI host कनेक्ट करें",
  mcpClientSetupDescription:
    "चरण-दर-चरण सेटअप के लिए कोई host चुनें या किसी भी MCP-compatible client में URL पेस्ट करें।",
  mcpChooseAssistant: "अपना AI assistant चुनें",
  mcpCommand: "कमांड",
  mcpConfig: "MCP config",
  mcpCopy: "कॉपी करें",
  mcpCopied: "कॉपी हो गया",
  mcpStaticTokenDescription:
    "पूरी कनेक्शन पेज खोलकर उन clients के लिए token बनाएँ जो OAuth पूरा नहीं कर सकते।",
  mcpOpenConnectPage: "पूरी कनेक्शन पेज खोलें",
  mcpConnect: mcpConnectMessages,
};

export const privacySettingsMessages: PrivacySettingsMessages = {
  privacyTitle: "गोपनीयता और डेटा",
  privacyDescription:
    "अपने डेटा की कॉपी का अनुरोध करें या अपना निजी डेटा हटाने के लिए कहें।",
  privacyManage: "प्रबंधित करें",
  privacyRightsTitle: "आपके डेटा अधिकार",
  privacyRightsDescription:
    "अनुरोध कार्यक्षेत्र व्यवस्थापक की समीक्षा, आपकी पहचान सत्यापित करने और आपसे संपर्क करने के लिए दर्ज किए जाते हैं।",
  privacyRequestCopy: "कॉपी का अनुरोध करें",
  privacyRequestDeletion: "हटाने का अनुरोध करें",
  privacyRequesting: "अनुरोध दर्ज किया जा रहा है...",
  privacyRequestRecorded: "अनुरोध दर्ज हो गया। व्यवस्थापक आपसे संपर्क करेगा।",
  privacyRequestRecordedShort: "अनुरोध दर्ज",
  privacyRequestError: "अनुरोध दर्ज नहीं किया जा सका। फिर कोशिश करें।",
  privacyDeletionTitle: "अपना डेटा हटाने का अनुरोध करें?",
  privacyDeletionDescription:
    "यह हटाने का अनुरोध दर्ज करता है; डेटा तुरंत नहीं हटाया जाता। व्यवस्थापक आपकी पहचान सत्यापित करेगा और इस डिप्लॉयमेंट की डेटा-रिटेंशन तथा कानूनी बाध्यताओं के अनुसार अनुरोध पूरा करेगा।",
  privacyDocsLink: "गोपनीयता और डेटा अधिकार पढ़ें",
};
