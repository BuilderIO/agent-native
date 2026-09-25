import type { EnvironmentBadgeMessages } from "../../environment-badge-messages.js";
import type {
  McpConnectMessages,
  McpSettingsMessages,
} from "../../mcp-settings-messages.js";
import type { PrivacySettingsMessages } from "../../privacy-settings-messages.js";

export const environmentBadgeMessages: EnvironmentBadgeMessages = {
  betaLabel: "beta",
  betaTitle: "Du verwendest Agent-Native {{label}}",
  productionTitle: "Du verwendest Agent-Native Production",
  activeDevelopment: "In aktiver Entwicklung",
  feedbackPrompt:
    "Diese Vorlage befindet sich in aktiver Entwicklung. Wir freuen uns über dein Feedback.",
  continuePrompt: "Wähle aus, wo du fortfahren möchtest.",
  switchToProduction: "Zur Produktionsumgebung wechseln",
  goToBeta: "Zur Beta wechseln",
  hideBadge: "Badge ausblenden",
  openSwitcher: "{{title}}-Umschalter öffnen",
  localDevelopment: "Lokale Entwicklungsumgebung",
  development: "Entwicklungsumgebung",
};

export const mcpConnectMessages: McpConnectMessages = {
  pageTitle: "{appName} verbinden",
  authorizeLabel: "{appName} autorisieren",
  terminalTitle: "{appName} über dein Terminal autorisieren?",
  assistantTitle: "{appName} mit deinem KI-Assistenten verwenden",
  signedInAs: "Angemeldet als",
  deviceCode: "Gerätecode",
  guidesLabel: "MCP-URL-Anleitungen",
  advancedOptions: "Erweiterte Optionen",
  labelOptional: "Bezeichnung (optional)",
  labelPlaceholder: "z. B. Claude Code auf meinem Laptop",
  expiresInDays: "Läuft ab in (Tagen, 1–365)",
  terminalAlternative: "Terminal-Alternative",
  existingConnections: "Vorhandene Verbindungen",
  checkingConnections: "Verbindungen werden geprüft...",
  unavailable: "Nicht verfügbar",
  couldNotLoadConnections: "Verbindungen konnten nicht geladen werden.",
  emptyConnections:
    "Erstellte Verbindungen werden hier angezeigt, damit du sie später widerrufen kannst.",
  unlabeled: "(ohne Bezeichnung)",
  lastUsed: "zuletzt verwendet",
  revoked: "Widerrufen",
  created: "Erstellt",
  revoke: "Widerrufen",
  couldNotRevoke: "Token konnte nicht widerrufen werden.",
  authorizeDevice: "Gerät autorisieren",
  fullCatalogRequested:
    "Dieses Gerät fordert Zugriff auf den vollständigen Aktionskatalog an.",
  createToken: "Verbindungstoken erstellen",
  authorizingDevice: "Gerät wird autorisiert...",
  creatingToken: "Token wird erstellt...",
  couldNotAuthorize: "Dieser Gerätecode konnte nicht autorisiert werden.",
  unknownDeviceCode:
    "Dieser Gerätecode wurde nicht erkannt. Starte die Verbindung in deinem Terminal neu.",
  expiredDeviceCode:
    "Dieser Gerätecode ist abgelaufen. Starte die Verbindung in deinem Terminal neu.",
  alreadyUsedDeviceCode:
    "Dieser Gerätecode wurde bereits verwendet. Starte die Verbindung in deinem Terminal neu.",
  finishingConnection:
    "Verbindung wird abgeschlossen… du kannst zu deinem Terminal zurückkehren.",
  deviceAuthorized: "Gerät autorisiert",
  connected: "Verbunden",
  connectedDescription:
    "Dieses Gerät kann jetzt in deinem Namen handeln. Verwalte oder widerrufe es unten.",
  couldNotCreate: "Token konnte nicht erstellt werden.",
  networkError: "Netzwerkfehler. Bitte versuche es erneut.",
  urlTitle: "Deine MCP-URL",
};

export const mcpSettingsMessages: McpSettingsMessages = {
  mcpTitle: "MCP",
  mcpDescription:
    "Verbinde diese App mit Claude, ChatGPT, Cursor, Codex oder einem anderen MCP-Host.",
  mcpUrlLabel: "MCP-Server-URL",
  mcpUrlHint:
    "Kopiere diese URL in den gewünschten KI-Host. Der kanonische Pfad ist /mcp.",
  mcpOpenDocs: "MCP-Verbindungsdokumentation öffnen",
  a2aAgentCard: "A2A-Agentenkarte",
  a2aOpenDocs: "A2A-Dokumentation öffnen",
  mcpClientSetup: "Einen KI-Host verbinden",
  mcpClientSetupDescription:
    "Wähle einen Host für eine Schritt-für-Schritt-Einrichtung oder füge die URL in einen beliebigen MCP-kompatiblen Client ein.",
  mcpChooseAssistant: "Deinen KI-Assistenten auswählen",
  mcpCommand: "Befehl",
  mcpConfig: "MCP-Konfiguration",
  mcpCopy: "Kopieren",
  mcpCopied: "Kopiert",
  mcpStaticTokenDescription:
    "Öffne die vollständige Verbindungsseite, um ein Token für Clients zu erstellen, die OAuth nicht abschließen können.",
  mcpOpenConnectPage: "Vollständige Verbindungsseite öffnen",
  mcpConnect: mcpConnectMessages,
};

export const privacySettingsMessages: PrivacySettingsMessages = {
  privacyTitle: "Datenschutz und Daten",
  privacyDescription:
    "Fordere eine Kopie deiner Daten an oder bitte um die Löschung deiner personenbezogenen Daten.",
  privacyManage: "Verwalten",
  privacyRightsTitle: "Deine Datenrechte",
  privacyRightsDescription:
    "Anfragen werden zur Prüfung durch eine Workspace-Administration gespeichert, die deine Identität bestätigt und sich bei dir meldet.",
  privacyRequestCopy: "Kopie anfordern",
  privacyRequestDeletion: "Löschung anfordern",
  privacyRequesting: "Anfrage wird gespeichert...",
  privacyRequestRecorded:
    "Anfrage gespeichert. Eine Administration meldet sich bei dir.",
  privacyRequestRecordedShort: "Anfrage gespeichert",
  privacyRequestError:
    "Anfrage konnte nicht gespeichert werden. Bitte versuche es erneut.",
  privacyDeletionTitle: "Löschung deiner Daten anfordern?",
  privacyDeletionDescription:
    "Damit wird eine Löschanfrage gespeichert; die Daten werden nicht sofort gelöscht. Eine Administration bestätigt deine Identität und bearbeitet die Anfrage gemäß den Aufbewahrungs- und gesetzlichen Pflichten dieses Deployments.",
  privacyDocsLink: "Datenschutz und Datenrechte lesen",
};
