import type { EnvironmentBadgeMessages } from "../../environment-badge-messages.js";
import type {
  McpConnectMessages,
  McpSettingsMessages,
} from "../../mcp-settings-messages.js";
import type { PrivacySettingsMessages } from "../../privacy-settings-messages.js";

export const environmentBadgeMessages: EnvironmentBadgeMessages = {
  betaLabel: "測試版",
  betaTitle: "你目前正在使用 Agent-Native {{label}}",
  productionTitle: "你目前正在使用 Agent-Native 正式版",
  activeDevelopment: "正在積極開發",
  feedbackPrompt:
    "此範本正在積極開發中。歡迎在我們完善它的過程中提供意見回饋。",
  continuePrompt: "選擇要繼續使用的環境。",
  switchToProduction: "切換至正式版",
  goToBeta: "前往測試版",
  hideBadge: "隱藏標記",
  openSwitcher: "開啟 {{title}} 切換器",
  localDevelopment: "本機開發環境",
  development: "開發環境",
};

export const mcpConnectMessages: McpConnectMessages = {
  pageTitle: "連線 {appName}",
  authorizeLabel: "授權 {appName}",
  terminalTitle: "要從終端機授權 {appName} 嗎？",
  assistantTitle: "透過 AI 助理使用 {appName}",
  signedInAs: "已登入為",
  deviceCode: "裝置代碼",
  guidesLabel: "MCP URL 指南",
  advancedOptions: "進階選項",
  labelOptional: "標籤（選填）",
  labelPlaceholder: "例如：我筆記型電腦上的 Claude Code",
  expiresInDays: "有效期限（天，1–365）",
  terminalAlternative: "終端機替代方案",
  existingConnections: "現有連線",
  checkingConnections: "正在檢查連線...",
  unavailable: "無法使用",
  couldNotLoadConnections: "無法載入連線。",
  emptyConnections: "建立的連線會顯示在這裡，方便稍後撤銷。",
  unlabeled: "（無標籤）",
  lastUsed: "上次使用",
  revoked: "已撤銷",
  created: "已建立",
  revoke: "撤銷",
  couldNotRevoke: "無法撤銷權杖。",
  authorizeDevice: "授權裝置",
  fullCatalogRequested: "此裝置正在要求存取完整的動作目錄。",
  createToken: "建立連線權杖",
  authorizingDevice: "正在授權裝置...",
  creatingToken: "正在建立權杖...",
  couldNotAuthorize: "無法授權此裝置代碼。",
  unknownDeviceCode: "無法辨識此裝置代碼。請從終端機重新開始連線。",
  expiredDeviceCode: "此裝置代碼已過期。請從終端機重新開始連線。",
  alreadyUsedDeviceCode: "此裝置代碼已使用過。請從終端機重新開始連線。",
  finishingConnection: "正在完成連線…你可以返回終端機。",
  deviceAuthorized: "裝置已授權",
  connected: "已連線",
  connectedDescription: "此裝置現在可以代表你操作，你可以在下方管理或撤銷它。",
  couldNotCreate: "無法建立權杖。",
  networkError: "網路錯誤。請再試一次。",
  urlTitle: "你的 MCP URL",
};

export const mcpSettingsMessages: McpSettingsMessages = {
  mcpTitle: "MCP",
  mcpDescription:
    "將此應用程式連線到 Claude、ChatGPT、Cursor、Codex 或其他 MCP 主機。",
  mcpUrlLabel: "MCP 伺服器 URL",
  mcpUrlHint: "將此 URL 複製到你要使用的 AI 主機中。標準路徑為 /mcp。",
  mcpOpenDocs: "開啟 MCP 連線文件",
  a2aAgentCard: "A2A 代理程式卡片",
  a2aOpenDocs: "開啟 A2A 文件",
  mcpClientSetup: "連線 AI 主機",
  mcpClientSetupDescription:
    "選擇主機查看逐步設定，或將 URL 貼到任何相容 MCP 的用戶端。",
  mcpChooseAssistant: "選擇你的 AI 助理",
  mcpCommand: "指令",
  mcpConfig: "MCP 設定",
  mcpCopy: "複製",
  mcpCopied: "已複製",
  mcpStaticTokenDescription:
    "開啟完整連線頁面，為無法完成 OAuth 的用戶端建立權杖。",
  mcpOpenConnectPage: "開啟完整連線頁面",
  mcpConnect: mcpConnectMessages,
};

export const privacySettingsMessages: PrivacySettingsMessages = {
  privacyTitle: "隱私與資料",
  privacyDescription: "要求取得您的資料副本，或要求刪除您的個人資料。",
  privacyManage: "管理",
  privacyRightsTitle: "您的資料權利",
  privacyRightsDescription:
    "要求會記錄下來，供工作區管理員審查、驗證您的身分並與您聯絡。",
  privacyRequestCopy: "要求副本",
  privacyRequestDeletion: "要求刪除",
  privacyRequesting: "正在記錄要求...",
  privacyRequestRecorded: "要求已記錄。管理員會與您聯絡。",
  privacyRequestRecordedShort: "要求已記錄",
  privacyRequestError: "無法記錄要求。請再試一次。",
  privacyDeletionTitle: "要求刪除您的資料？",
  privacyDeletionDescription:
    "這會記錄刪除要求，不會立即刪除資料。管理員會驗證您的身分，並依照此部署的保留期限與法律義務完成要求。",
  privacyDocsLink: "閱讀隱私與資料權利",
};
