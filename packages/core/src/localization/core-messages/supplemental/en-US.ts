import type { EnvironmentBadgeMessages } from "../../environment-badge-messages.js";
import type {
  McpConnectMessages,
  McpSettingsMessages,
} from "../../mcp-settings-messages.js";
import type { PrivacySettingsMessages } from "../../privacy-settings-messages.js";

export const environmentBadgeMessages: EnvironmentBadgeMessages = {
  betaLabel: "beta",
  betaTitle: "You're on Agent-Native {{label}}",
  productionTitle: "You're on Agent-Native Production",
  activeDevelopment: "Under active development",
  feedbackPrompt:
    "This template is under active development. We'd love your feedback as we build it.",
  continuePrompt: "Choose where you want to continue.",
  switchToProduction: "Switch to production",
  goToBeta: "Go to beta",
  hideBadge: "Hide badge",
  openSwitcher: "Open {{title}} switcher",
  localDevelopment: "Local development environment",
  development: "Development environment",
};

export const mcpConnectMessages: McpConnectMessages = {
  pageTitle: "Connect {appName}",
  authorizeLabel: "Authorize {appName}",
  terminalTitle: "Authorize {appName} from your terminal?",
  assistantTitle: "Use {appName} from your AI assistant",
  signedInAs: "Signed in as",
  deviceCode: "Device code",
  guidesLabel: "MCP URL guides",
  advancedOptions: "Advanced options",
  labelOptional: "Label (optional)",
  labelPlaceholder: "e.g. Claude Code on my laptop",
  expiresInDays: "Expires in (days, 1–365)",
  terminalAlternative: "Terminal alternative",
  existingConnections: "Existing connections",
  checkingConnections: "Checking connections...",
  unavailable: "Unavailable",
  couldNotLoadConnections: "Could not load connections.",
  emptyConnections: "Created connections will appear here for revoking later.",
  unlabeled: "(unlabeled)",
  lastUsed: "last used",
  revoked: "Revoked",
  created: "Created",
  revoke: "Revoke",
  couldNotRevoke: "Could not revoke token.",
  authorizeDevice: "Authorize device",
  fullCatalogRequested:
    "This device is requesting access to the full action catalog.",
  createToken: "Create connection token",
  authorizingDevice: "Authorizing device...",
  creatingToken: "Creating token...",
  couldNotAuthorize: "Could not authorize this device code.",
  unknownDeviceCode:
    "This device code isn't recognized. Restart the connection from your terminal.",
  expiredDeviceCode:
    "This device code has expired. Restart the connection from your terminal.",
  alreadyUsedDeviceCode:
    "This device code was already used. Restart the connection from your terminal.",
  finishingConnection: "Finishing connection… you can return to your terminal.",
  deviceAuthorized: "Device authorized",
  connected: "Connected",
  connectedDescription:
    "This device can now act as you — manage or revoke it below.",
  couldNotCreate: "Could not create token.",
  networkError: "Network error. Please try again.",
  urlTitle: "Your MCP URL",
};

export const mcpSettingsMessages: McpSettingsMessages = {
  mcpTitle: "MCP",
  mcpDescription:
    "Connect this app to Claude, ChatGPT, Cursor, Codex, or another MCP host.",
  mcpUrlLabel: "MCP server URL",
  mcpUrlHint:
    "Copy this URL into the AI host you want to use. The canonical path is /mcp.",
  mcpOpenDocs: "Open MCP connection docs",
  a2aAgentCard: "A2A agent card",
  a2aOpenDocs: "Open A2A documentation",
  mcpClientSetup: "Connect an AI host",
  mcpClientSetupDescription:
    "Choose a host for step-by-step setup, or paste the URL into any MCP-compatible client.",
  mcpChooseAssistant: "Choose your AI assistant",
  mcpCommand: "Command",
  mcpConfig: "MCP config",
  mcpCopy: "Copy",
  mcpCopied: "Copied",
  mcpStaticTokenDescription:
    "Open the full connect page to create a token for clients that cannot complete OAuth.",
  mcpOpenConnectPage: "Open full connect page",
  mcpConnect: mcpConnectMessages,
};

export const privacySettingsMessages: PrivacySettingsMessages = {
  privacyTitle: "Privacy & data",
  privacyDescription:
    "Request a copy of your data or ask for your personal data to be deleted.",
  privacyManage: "Manage",
  privacyRightsTitle: "Your data rights",
  privacyRightsDescription:
    "Requests are recorded for review by a workspace administrator, who will verify your identity and follow up.",
  privacyRequestCopy: "Request a copy",
  privacyRequestDeletion: "Request deletion",
  privacyRequesting: "Recording request...",
  privacyRequestRecorded: "Request recorded. An administrator will follow up.",
  privacyRequestRecordedShort: "Request recorded",
  privacyRequestError: "Could not record your request. Please try again.",
  privacyDeletionTitle: "Request deletion of your data?",
  privacyDeletionDescription:
    "This records a deletion request; it does not delete data immediately. An administrator will verify your identity and complete the request under the deployment's retention and legal obligations.",
  privacyDocsLink: "Read privacy and data rights",
};
