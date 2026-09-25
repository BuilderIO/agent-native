import type { EnvironmentBadgeMessages } from "../../environment-badge-messages.js";
import type {
  McpConnectMessages,
  McpSettingsMessages,
} from "../../mcp-settings-messages.js";
import type { PrivacySettingsMessages } from "../../privacy-settings-messages.js";

export const environmentBadgeMessages: EnvironmentBadgeMessages = {
  betaLabel: "bêta",
  betaTitle: "Vous êtes sur Agent-Native {{label}}",
  productionTitle: "Vous êtes sur Agent-Native Production",
  activeDevelopment: "En développement actif",
  feedbackPrompt:
    "Ce modèle est en développement actif. Vos retours nous aideront à le construire.",
  continuePrompt: "Choisissez où continuer.",
  switchToProduction: "Passer en production",
  goToBeta: "Accéder à la bêta",
  hideBadge: "Masquer le badge",
  openSwitcher: "Ouvrir le sélecteur {{title}}",
  localDevelopment: "Environnement de développement local",
  development: "Environnement de développement",
};

export const mcpConnectMessages: McpConnectMessages = {
  pageTitle: "Connecter {appName}",
  authorizeLabel: "Autoriser {appName}",
  terminalTitle: "Autoriser {appName} depuis votre terminal ?",
  assistantTitle: "Utiliser {appName} depuis votre assistant IA",
  signedInAs: "Connecté en tant que",
  deviceCode: "Code de l’appareil",
  guidesLabel: "Guides d’URL MCP",
  advancedOptions: "Options avancées",
  labelOptional: "Libellé (facultatif)",
  labelPlaceholder: "ex. Claude Code sur mon ordinateur portable",
  expiresInDays: "Expire dans (jours, 1–365)",
  terminalAlternative: "Alternative terminal",
  existingConnections: "Connexions existantes",
  checkingConnections: "Vérification des connexions...",
  unavailable: "Indisponible",
  couldNotLoadConnections: "Impossible de charger les connexions.",
  emptyConnections:
    "Les connexions créées apparaîtront ici pour être révoquées plus tard.",
  unlabeled: "(sans libellé)",
  lastUsed: "dernière utilisation",
  revoked: "Révoqué",
  created: "Créé",
  revoke: "Révoquer",
  couldNotRevoke: "Impossible de révoquer le jeton.",
  authorizeDevice: "Autoriser l’appareil",
  fullCatalogRequested:
    "Cet appareil demande l’accès au catalogue complet des actions.",
  createToken: "Créer un jeton de connexion",
  authorizingDevice: "Autorisation de l’appareil...",
  creatingToken: "Création du jeton...",
  couldNotAuthorize: "Impossible d’autoriser ce code d’appareil.",
  unknownDeviceCode:
    "Ce code d’appareil n’est pas reconnu. Recommencez la connexion depuis votre terminal.",
  expiredDeviceCode:
    "Ce code d’appareil a expiré. Recommencez la connexion depuis votre terminal.",
  alreadyUsedDeviceCode:
    "Ce code d’appareil a déjà été utilisé. Recommencez la connexion depuis votre terminal.",
  finishingConnection:
    "Connexion en cours… vous pouvez retourner à votre terminal.",
  deviceAuthorized: "Appareil autorisé",
  connected: "Connecté",
  connectedDescription:
    "Cet appareil peut maintenant agir en votre nom. Gérez-le ou révoquez-le ci-dessous.",
  couldNotCreate: "Impossible de créer le jeton.",
  networkError: "Erreur réseau. Réessayez.",
  urlTitle: "Votre URL MCP",
};

export const mcpSettingsMessages: McpSettingsMessages = {
  mcpTitle: "MCP",
  mcpDescription:
    "Connectez cette app à Claude, ChatGPT, Cursor, Codex ou un autre hôte MCP.",
  mcpUrlLabel: "URL du serveur MCP",
  mcpUrlHint:
    "Copiez cette URL dans l’hôte IA de votre choix. Le chemin canonique est /mcp.",
  mcpOpenDocs: "Ouvrir la documentation de connexion MCP",
  a2aAgentCard: "Carte d’agent A2A",
  a2aOpenDocs: "Ouvrir la documentation A2A",
  mcpClientSetup: "Connecter un hôte IA",
  mcpClientSetupDescription:
    "Choisissez un hôte pour obtenir une configuration pas à pas, ou collez l’URL dans n’importe quel client compatible MCP.",
  mcpChooseAssistant: "Choisissez votre assistant IA",
  mcpCommand: "Commande",
  mcpConfig: "Configuration MCP",
  mcpCopy: "Copier",
  mcpCopied: "Copié",
  mcpStaticTokenDescription:
    "Ouvrez la page complète de connexion pour créer un jeton pour les clients qui ne peuvent pas terminer OAuth.",
  mcpOpenConnectPage: "Ouvrir la page complète de connexion",
  mcpConnect: mcpConnectMessages,
};

export const privacySettingsMessages: PrivacySettingsMessages = {
  privacyTitle: "Confidentialité et données",
  privacyDescription:
    "Demandez une copie de vos données ou la suppression de vos données personnelles.",
  privacyManage: "Gérer",
  privacyRightsTitle: "Vos droits sur vos données",
  privacyRightsDescription:
    "Les demandes sont enregistrées pour être examinées par un administrateur de l’espace de travail, qui vérifiera votre identité et vous recontactera.",
  privacyRequestCopy: "Demander une copie",
  privacyRequestDeletion: "Demander la suppression",
  privacyRequesting: "Enregistrement de la demande...",
  privacyRequestRecorded:
    "Demande enregistrée. Un administrateur vous recontactera.",
  privacyRequestRecordedShort: "Demande enregistrée",
  privacyRequestError: "Impossible d’enregistrer la demande. Réessayez.",
  privacyDeletionTitle: "Demander la suppression de vos données ?",
  privacyDeletionDescription:
    "Cette action enregistre une demande de suppression ; les données ne sont pas supprimées immédiatement. Un administrateur vérifiera votre identité et traitera la demande conformément aux obligations de conservation et aux obligations légales de ce déploiement.",
  privacyDocsLink:
    "Lire les informations sur la confidentialité et les droits sur les données",
};
