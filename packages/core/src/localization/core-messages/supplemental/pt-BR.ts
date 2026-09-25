import type { EnvironmentBadgeMessages } from "../../environment-badge-messages.js";
import type {
  McpConnectMessages,
  McpSettingsMessages,
} from "../../mcp-settings-messages.js";
import type { PrivacySettingsMessages } from "../../privacy-settings-messages.js";

export const environmentBadgeMessages: EnvironmentBadgeMessages = {
  betaLabel: "beta",
  betaTitle: "Você está no Agent-Native {{label}}",
  productionTitle: "Você está no Agent-Native Production",
  activeDevelopment: "Em desenvolvimento ativo",
  feedbackPrompt:
    "Este template está em desenvolvimento ativo. Adoraríamos receber seu feedback enquanto o construímos.",
  continuePrompt: "Escolha onde deseja continuar.",
  switchToProduction: "Mudar para produção",
  goToBeta: "Ir para beta",
  hideBadge: "Ocultar selo",
  openSwitcher: "Abrir o seletor de {{title}}",
  localDevelopment: "Ambiente de desenvolvimento local",
  development: "Ambiente de desenvolvimento",
};

export const mcpConnectMessages: McpConnectMessages = {
  pageTitle: "Conectar {appName}",
  authorizeLabel: "Autorizar {appName}",
  terminalTitle: "Autorizar {appName} pelo seu terminal?",
  assistantTitle: "Usar {appName} pelo seu assistente de IA",
  signedInAs: "Sessão iniciada como",
  deviceCode: "Código do dispositivo",
  guidesLabel: "Guias de URL MCP",
  advancedOptions: "Opções avançadas",
  labelOptional: "Rótulo (opcional)",
  labelPlaceholder: "ex.: Claude Code no meu laptop",
  expiresInDays: "Expira em (dias, 1–365)",
  terminalAlternative: "Alternativa pelo terminal",
  existingConnections: "Conexões existentes",
  checkingConnections: "Verificando conexões...",
  unavailable: "Indisponível",
  couldNotLoadConnections: "Não foi possível carregar as conexões.",
  emptyConnections:
    "As conexões criadas aparecerão aqui para revogação posterior.",
  unlabeled: "(sem rótulo)",
  lastUsed: "último uso",
  revoked: "Revogado",
  created: "Criado",
  revoke: "Revogar",
  couldNotRevoke: "Não foi possível revogar o token.",
  authorizeDevice: "Autorizar dispositivo",
  fullCatalogRequested:
    "Este dispositivo está solicitando acesso ao catálogo completo de ações.",
  createToken: "Criar token de conexão",
  authorizingDevice: "Autorizando dispositivo...",
  creatingToken: "Criando token...",
  couldNotAuthorize: "Não foi possível autorizar este código de dispositivo.",
  unknownDeviceCode:
    "Este código de dispositivo não foi reconhecido. Reinicie a conexão pelo terminal.",
  expiredDeviceCode:
    "Este código de dispositivo expirou. Reinicie a conexão pelo terminal.",
  alreadyUsedDeviceCode:
    "Este código de dispositivo já foi usado. Reinicie a conexão pelo terminal.",
  finishingConnection:
    "Concluindo a conexão… você pode voltar ao seu terminal.",
  deviceAuthorized: "Dispositivo autorizado",
  connected: "Conectado",
  connectedDescription:
    "Este dispositivo agora pode agir por você. Gerencie ou revogue-o abaixo.",
  couldNotCreate: "Não foi possível criar o token.",
  networkError: "Erro de rede. Tente novamente.",
  urlTitle: "Sua URL MCP",
};

export const mcpSettingsMessages: McpSettingsMessages = {
  mcpTitle: "MCP",
  mcpDescription:
    "Conecte este app ao Claude, ChatGPT, Cursor, Codex ou outro host MCP.",
  mcpUrlLabel: "URL do servidor MCP",
  mcpUrlHint:
    "Copie esta URL para o host de IA que deseja usar. O caminho canônico é /mcp.",
  mcpOpenDocs: "Abrir documentação de conexão MCP",
  a2aAgentCard: "Cartão do agente A2A",
  a2aOpenDocs: "Abrir documentação do A2A",
  mcpClientSetup: "Conectar um host de IA",
  mcpClientSetupDescription:
    "Escolha um host para ver a configuração passo a passo ou cole a URL em qualquer cliente compatível com MCP.",
  mcpChooseAssistant: "Escolha seu assistente de IA",
  mcpCommand: "Comando",
  mcpConfig: "Configuração MCP",
  mcpCopy: "Copiar",
  mcpCopied: "Copiado",
  mcpStaticTokenDescription:
    "Abra a página completa de conexão para criar um token para clientes que não conseguem concluir o OAuth.",
  mcpOpenConnectPage: "Abrir página completa de conexão",
  mcpConnect: mcpConnectMessages,
};

export const privacySettingsMessages: PrivacySettingsMessages = {
  privacyTitle: "Privacidade e dados",
  privacyDescription:
    "Solicite uma cópia dos seus dados ou peça a exclusão dos seus dados pessoais.",
  privacyManage: "Gerenciar",
  privacyRightsTitle: "Seus direitos sobre os dados",
  privacyRightsDescription:
    "As solicitações são registradas para análise por um administrador do workspace, que verificará sua identidade e entrará em contato.",
  privacyRequestCopy: "Solicitar uma cópia",
  privacyRequestDeletion: "Solicitar exclusão",
  privacyRequesting: "Registrando solicitação...",
  privacyRequestRecorded:
    "Solicitação registrada. Um administrador entrará em contato.",
  privacyRequestRecordedShort: "Solicitação registrada",
  privacyRequestError:
    "Não foi possível registrar sua solicitação. Tente novamente.",
  privacyDeletionTitle: "Solicitar a exclusão dos seus dados?",
  privacyDeletionDescription:
    "Isso registra uma solicitação de exclusão; os dados não são excluídos imediatamente. Um administrador verificará sua identidade e concluirá a solicitação conforme as obrigações legais e de retenção desta implantação.",
  privacyDocsLink: "Ler sobre privacidade e direitos sobre os dados",
};
