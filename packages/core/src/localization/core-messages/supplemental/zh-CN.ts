import type { EnvironmentBadgeMessages } from "../../environment-badge-messages.js";
import type {
  McpConnectMessages,
  McpSettingsMessages,
} from "../../mcp-settings-messages.js";
import type { PrivacySettingsMessages } from "../../privacy-settings-messages.js";

export const environmentBadgeMessages: EnvironmentBadgeMessages = {
  betaLabel: "测试版",
  betaTitle: "你正在使用 Agent-Native {{label}}",
  productionTitle: "你正在使用 Agent-Native 正式版",
  activeDevelopment: "正在积极开发",
  feedbackPrompt: "此模板正在积极开发中。欢迎在我们完善它的过程中提供反馈。",
  continuePrompt: "选择要继续使用的环境。",
  switchToProduction: "切换到正式版",
  goToBeta: "前往测试版",
  hideBadge: "隐藏标记",
  openSwitcher: "打开 {{title}} 切换器",
  localDevelopment: "本地开发环境",
  development: "开发环境",
};

export const mcpConnectMessages: McpConnectMessages = {
  pageTitle: "连接 {appName}",
  authorizeLabel: "授权 {appName}",
  terminalTitle: "要从终端授权 {appName} 吗？",
  assistantTitle: "通过 AI 助手使用 {appName}",
  signedInAs: "已登录为",
  deviceCode: "设备代码",
  guidesLabel: "MCP URL 指南",
  advancedOptions: "高级选项",
  labelOptional: "标签（可选）",
  labelPlaceholder: "例如：我笔记本上的 Claude Code",
  expiresInDays: "有效期（天，1–365）",
  terminalAlternative: "终端替代方案",
  existingConnections: "现有连接",
  checkingConnections: "正在检查连接...",
  unavailable: "不可用",
  couldNotLoadConnections: "无法加载连接。",
  emptyConnections: "创建的连接会显示在这里，方便稍后撤销。",
  unlabeled: "（无标签）",
  lastUsed: "上次使用",
  revoked: "已撤销",
  created: "已创建",
  revoke: "撤销",
  couldNotRevoke: "无法撤销令牌。",
  authorizeDevice: "授权设备",
  fullCatalogRequested: "此设备正在请求访问完整的操作目录。",
  createToken: "创建连接令牌",
  authorizingDevice: "正在授权设备...",
  creatingToken: "正在创建令牌...",
  couldNotAuthorize: "无法授权此设备代码。",
  unknownDeviceCode: "无法识别此设备代码。请从终端重新开始连接。",
  expiredDeviceCode: "此设备代码已过期。请从终端重新开始连接。",
  alreadyUsedDeviceCode: "此设备代码已使用过。请从终端重新开始连接。",
  finishingConnection: "正在完成连接…你可以返回终端。",
  deviceAuthorized: "设备已授权",
  connected: "已连接",
  connectedDescription: "此设备现在可以代表你操作，你可以在下方管理或撤销它。",
  couldNotCreate: "无法创建令牌。",
  networkError: "网络错误。请重试。",
  urlTitle: "你的 MCP URL",
};

export const mcpSettingsMessages: McpSettingsMessages = {
  mcpTitle: "MCP",
  mcpDescription:
    "将此应用连接到 Claude、ChatGPT、Cursor、Codex 或其他 MCP 主机。",
  mcpUrlLabel: "MCP 服务器 URL",
  mcpUrlHint: "将此 URL 复制到你要使用的 AI 主机中。规范路径为 /mcp。",
  mcpOpenDocs: "打开 MCP 连接文档",
  a2aAgentCard: "A2A 代理卡",
  a2aOpenDocs: "打开 A2A 文档",
  mcpClientSetup: "连接 AI 主机",
  mcpClientSetupDescription:
    "选择一个主机查看分步设置，或将 URL 粘贴到任何兼容 MCP 的客户端。",
  mcpChooseAssistant: "选择你的 AI 助手",
  mcpCommand: "命令",
  mcpConfig: "MCP 配置",
  mcpCopy: "复制",
  mcpCopied: "已复制",
  mcpStaticTokenDescription:
    "打开完整连接页面，为无法完成 OAuth 的客户端创建令牌。",
  mcpOpenConnectPage: "打开完整连接页面",
  mcpConnect: mcpConnectMessages,
};

export const privacySettingsMessages: PrivacySettingsMessages = {
  privacyTitle: "隐私与数据",
  privacyDescription: "请求获取您的数据副本，或请求删除您的个人数据。",
  privacyManage: "管理",
  privacyRightsTitle: "您的数据权利",
  privacyRightsDescription:
    "请求会记录下来，供工作区管理员审核、验证您的身份并与您跟进。",
  privacyRequestCopy: "请求副本",
  privacyRequestDeletion: "请求删除",
  privacyRequesting: "正在记录请求...",
  privacyRequestRecorded: "请求已记录。管理员会与您联系。",
  privacyRequestRecordedShort: "请求已记录",
  privacyRequestError: "无法记录请求。请重试。",
  privacyDeletionTitle: "请求删除您的数据？",
  privacyDeletionDescription:
    "这会记录删除请求，不会立即删除数据。管理员会验证您的身份，并根据此部署的保留期限和法律义务完成请求。",
  privacyDocsLink: "阅读隐私与数据权利",
};
