import type { EnvironmentBadgeMessages } from "../../environment-badge-messages.js";
import type {
  McpConnectMessages,
  McpSettingsMessages,
} from "../../mcp-settings-messages.js";
import type { PrivacySettingsMessages } from "../../privacy-settings-messages.js";

export const environmentBadgeMessages: EnvironmentBadgeMessages = {
  betaLabel: "beta",
  betaTitle: "Estás en Agent-Native {{label}}",
  productionTitle: "Estás en Agent-Native Production",
  activeDevelopment: "En desarrollo activo",
  feedbackPrompt:
    "Esta plantilla está en desarrollo activo. Nos encantaría recibir tus comentarios mientras la construimos.",
  continuePrompt: "Elige dónde quieres continuar.",
  switchToProduction: "Cambiar a producción",
  goToBeta: "Ir a beta",
  hideBadge: "Ocultar insignia",
  openSwitcher: "Abrir el selector de {{title}}",
  localDevelopment: "Entorno de desarrollo local",
  development: "Entorno de desarrollo",
};

export const mcpConnectMessages: McpConnectMessages = {
  pageTitle: "Conectar {appName}",
  authorizeLabel: "Autorizar {appName}",
  terminalTitle: "¿Autorizar {appName} desde tu terminal?",
  assistantTitle: "Usa {appName} desde tu asistente de IA",
  signedInAs: "Sesión iniciada como",
  deviceCode: "Código del dispositivo",
  guidesLabel: "Guías de URL de MCP",
  advancedOptions: "Opciones avanzadas",
  labelOptional: "Etiqueta (opcional)",
  labelPlaceholder: "p. ej., Claude Code en mi portátil",
  expiresInDays: "Caduca en (días, 1–365)",
  terminalAlternative: "Alternativa para la terminal",
  existingConnections: "Conexiones existentes",
  checkingConnections: "Comprobando conexiones...",
  unavailable: "No disponible",
  couldNotLoadConnections: "No se pudieron cargar las conexiones.",
  emptyConnections:
    "Las conexiones creadas aparecerán aquí para revocarlas más adelante.",
  unlabeled: "(sin etiqueta)",
  lastUsed: "último uso",
  revoked: "Revocado",
  created: "Creado",
  revoke: "Revocar",
  couldNotRevoke: "No se pudo revocar el token.",
  authorizeDevice: "Autorizar dispositivo",
  fullCatalogRequested:
    "Este dispositivo solicita acceso al catálogo completo de acciones.",
  createToken: "Crear token de conexión",
  authorizingDevice: "Autorizando dispositivo...",
  creatingToken: "Creando token...",
  couldNotAuthorize: "No se pudo autorizar este código de dispositivo.",
  unknownDeviceCode:
    "No se reconoce este código de dispositivo. Reinicia la conexión desde tu terminal.",
  expiredDeviceCode:
    "Este código de dispositivo ha caducado. Reinicia la conexión desde tu terminal.",
  alreadyUsedDeviceCode:
    "Este código de dispositivo ya se usó. Reinicia la conexión desde tu terminal.",
  finishingConnection: "Terminando la conexión… puedes volver a tu terminal.",
  deviceAuthorized: "Dispositivo autorizado",
  connected: "Conectado",
  connectedDescription:
    "Este dispositivo ya puede actuar como tú; puedes administrarlo o revocarlo abajo.",
  couldNotCreate: "No se pudo crear el token.",
  networkError: "Error de red. Inténtalo de nuevo.",
  urlTitle: "Tu URL de MCP",
};

export const mcpSettingsMessages: McpSettingsMessages = {
  mcpTitle: "MCP",
  mcpDescription:
    "Conecta esta app con Claude, ChatGPT, Cursor, Codex u otro host MCP.",
  mcpUrlLabel: "URL del servidor MCP",
  mcpUrlHint:
    "Copia esta URL en el host de IA que quieras usar. La ruta canónica es /mcp.",
  mcpOpenDocs: "Abrir documentación de conexión MCP",
  a2aAgentCard: "Tarjeta de agente A2A",
  a2aOpenDocs: "Abrir documentación de A2A",
  mcpClientSetup: "Conectar un host de IA",
  mcpClientSetupDescription:
    "Elige un host para ver instrucciones paso a paso o pega la URL en cualquier cliente compatible con MCP.",
  mcpChooseAssistant: "Elige tu asistente de IA",
  mcpCommand: "Comando",
  mcpConfig: "Configuración MCP",
  mcpCopy: "Copiar",
  mcpCopied: "Copiado",
  mcpStaticTokenDescription:
    "Abre la página completa de conexión para crear un token para clientes que no pueden completar OAuth.",
  mcpOpenConnectPage: "Abrir página completa de conexión",
  mcpConnect: mcpConnectMessages,
};

export const privacySettingsMessages: PrivacySettingsMessages = {
  privacyTitle: "Privacidad y datos",
  privacyDescription:
    "Solicita una copia de tus datos o pide que se eliminen tus datos personales.",
  privacyManage: "Administrar",
  privacyRightsTitle: "Tus derechos sobre los datos",
  privacyRightsDescription:
    "Las solicitudes se registran para que un administrador del espacio de trabajo las revise, verifique tu identidad y se ponga en contacto contigo.",
  privacyRequestCopy: "Solicitar una copia",
  privacyRequestDeletion: "Solicitar eliminación",
  privacyRequesting: "Registrando la solicitud...",
  privacyRequestRecorded:
    "Solicitud registrada. Un administrador se pondrá en contacto contigo.",
  privacyRequestRecordedShort: "Solicitud registrada",
  privacyRequestError: "No se pudo registrar la solicitud. Inténtalo de nuevo.",
  privacyDeletionTitle: "¿Solicitar la eliminación de tus datos?",
  privacyDeletionDescription:
    "Esto registra una solicitud de eliminación; los datos no se eliminan de inmediato. Un administrador verificará tu identidad y completará la solicitud según las obligaciones legales y de conservación de esta implementación.",
  privacyDocsLink: "Leer sobre privacidad y derechos sobre los datos",
};
