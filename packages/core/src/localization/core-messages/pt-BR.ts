import type { AgentChatTranslation } from "../core-messages.js";

const messages: AgentChatTranslation = {
  "composer.contextUrlLabel": "Endereço URL",
  "composer.contextInvalidUrl": "Insira uma URL HTTP ou HTTPS válida.",
  "composer.contextAttach": "Anexar",
  "composer.menu.search": "Pesquisar…",
  "composer.contextPrevious": "Anterior",
  "composer.contextNext": "Próximo",
  "composer.contextLoadFailed": "Não foi possível carregar o contexto.",
  "composer.contextLinkRequired": "Insira um link.",
  "composer.submitFailed": "Não foi possível enviar. Tente novamente.",
  "composer.addContext": "Adicionar contexto",
  "composer.contextActionFailed": "Não foi possível adicionar o contexto.",
  "composer.contextBack": "Voltar",
  "composer.searchContext": "Buscar contexto…",
  "composer.noContextResults": "Nenhum contexto correspondente.",
  "composer.contextPending": "Contexto pendente",
  "composer.contextError": "Falha no contexto",
  "composer.retryContext": "Tentar novamente o contexto {{name}}",
  "composer.contextLimitExceeded":
    "O contexto é grande demais. Remova um item ou anexe uma seleção menor.",
  "activity.reasoning": "Raciocínio",
  "approval.alwaysAllow": "Sempre permitir",
  "approval.alwaysAllowHint": "Aprovar e sempre permitir este comando exato",
  "approval.alwaysAllowAction": "Sempre permitir esta ação",
  "approval.alwaysAllowActionHint": "Aprovar e sempre permitir esta ação",
  "approval.approve": "Aprovar",
  "approval.approved": "Aprovado. Executando {{tool}} novamente...",
  "approval.denied": "Negado. {{tool}} não foi executado.",
  "approval.deny": "Negar",
  "approval.moreOptions": "Mais opções de aprovação",
  "approval.question": "Aprovar a execução de {{tool}}?",
  "auth.expiredDescription":
    "Sua sessão pode ter expirado. Saia e entre novamente para restabelecer a conexão.",
  "auth.expiredTitle": "Sessão expirada",
  "auth.logIn": "Entrar",
  "auth.logOut": "Sair",
  "auth.refreshChat": "Atualizar chat",
  "auth.refreshDescription":
    "Você está conectado, mas a conexão deste chat precisa ser restabelecida.",
  "auth.refreshTitle": "A sessão do chat precisa ser atualizada",
  "auth.requiredDescription": "Você precisa entrar para usar o agente.",
  "auth.requiredTitle": "Autenticação obrigatória",
  "commands.act": "Voltar ao modo de ação",
  "commands.available": "Comandos disponíveis",
  "commands.clear": "Iniciar um novo chat (mantém o chat atual no histórico)",
  "commands.closeHelp": "Fechar ajuda",
  "commands.help": "Mostrar esta lista de comandos",
  "commands.history": "Ver todos os chats",
  "commands.mention": "Mencionar arquivos, agentes ou recursos",
  "commands.new": "O mesmo que /clear",
  "commands.plan": "Mudar para o planejamento somente leitura",
  "observability.viewDetails": "Ver detalhes",
  "observability.hideDetails": "Ocultar detalhes",
  "observability.input": "Entrada",
  "observability.output": "Saída",
  "observability.error": "Erro",
  "observability.metadata": "Metadados",
  "observability.notCaptured": "Não capturado",
  "observability.openFullConversation": "Abrir conversa completa",
  "observability.learnAboutTab": "Saiba mais sobre esta guia",
  "onboarding.back": "Voltar",
  "onboarding.chooseRole": "Escolha sua função",
  "onboarding.customizeRole": "Vamos personalizar isso para você.",
  "onboarding.roleQuestion": "O que melhor descreve sua função?",
  "onboarding.roleHelperText": "Isso nos ajuda a personalizar sua experiência",
  "onboarding.roleProduct": "Gerente de produto",
  "onboarding.roleDesign": "Designer",
  "onboarding.roleDeveloper": "Desenvolvimento",
  "onboarding.roleMarketing": "Marketing",
  "onboarding.roleSales": "Vendas",
  "onboarding.roleOps": "Operações",
  "onboarding.roleIndividual": "Individual",
  "onboarding.roleOther": "Outro",
  "onboarding.roleOtherInputLabel": "Descreva sua função",
  "onboarding.skipForNow": "Pular por enquanto",
  "onboarding.saveRoleError": "Não foi possível salvar sua função.",
  "onboarding.builderCreateAccount": "Criar conta do Builder.io",
  "onboarding.builderSignInWithAccount": "Entrar com uma conta do Builder.io",
  "onboarding.builderActivateDescription":
    "Crie ou reutilize sua conta do Builder.io e ative os créditos gratuitos com um clique.",
  "onboarding.builderActiveCredits":
    "Incluído nos créditos gratuitos ativos do Builder.io",
  "onboarding.builderCredits": "Incluído nos créditos gratuitos do Builder.io",
  "onboarding.builderActivateTitle": "Ativar créditos gratuitos",
  "onboarding.builderAccountExistsTitle": "Você já tem uma conta do Builder.io",
  "onboarding.builderAccountExistsDescription": "Faça login para conectá-la.",
  "onboarding.builderActivationDescription":
    "Criaremos automaticamente sua conta do Builder.io com um clique.",
  "onboarding.builderCreateAndActivate": "Criar e ativar",
  "onboarding.builderConsentPrefix":
    "Ao criar uma conta Builder.io, você concorda com nossos",
  "onboarding.builderTerms": "Termos de Serviço",
  "onboarding.builderPrivacy": "Política de Privacidade",
  "onboarding.builderConsentAnd": "e",
  "onboarding.builderExistingAccount": "Tenho uma conta do Builder.io",
  "onboarding.builderActivating":
    "Ativando os créditos gratuitos do Builder.io",
  "onboarding.builderConnecting":
    "Conectando os créditos gratuitos do Builder.io",
  "onboarding.builderProvisioningDescription":
    "Criando ou reutilizando sua conta do Builder.io. Isso geralmente leva alguns segundos.",
  "onboarding.builderConnectionDescription":
    "Conclua a conexão com um clique na nova janela.",
  "onboarding.builderReadyWithCodeChanges":
    "Os créditos de IA e as alterações de código na nuvem estão prontos para uso.",
  "onboarding.builderReadyCreditsOnly":
    "Os créditos de IA estão prontos para uso. As edições de código na nuvem exigem um projeto Builder nas configurações do agente em segundo plano.",
  "onboarding.openBackgroundAgentSettings":
    "Abrir configurações do agente em segundo plano",
  "onboarding.capability.llm.keySummary": "Conecte seu próprio modelo de IA",
  "onboarding.capability.fileStorage.keySummary":
    "Upload e armazenamento de arquivos",
  "onboarding.fileStorage.title": "Escolha o armazenamento de arquivos",
  "onboarding.fileStorage.description":
    "Escolha o armazenamento gerenciado do Builder ou suas próprias chaves para um bucket compatível com S3.",
  "onboarding.fileStorage.custom":
    "Usar chaves de armazenamento personalizadas",
  "onboarding.fileStorage.customDescription":
    "Configure um bucket compatível com S3 com uma URL pública estável.",
  "onboarding.capability.voiceInput.label": "Entrada de voz",
  "onboarding.capability.voiceInput.keySummary": "Entrada de voz",
  "onboarding.capability.voiceInput.why":
    "A entrada de voz transforma solicitações faladas em texto; digitar sempre funciona.",
  "onboarding.capability.embeddings.label": "Vetores semânticos",
  "onboarding.capability.embeddings.keySummary": "Vetores semânticos",
  "onboarding.capability.embeddings.why":
    "Vetores semânticos melhoram a busca semântica. A busca por palavras-chave continua funcionando sem eles.",
  "onboarding.capability.assetsImageGeneration.label": "Geração de imagens",
  "onboarding.capability.assetsImageGeneration.keySummary":
    "Créditos Builder ou chave de provedor de imagens",
  "onboarding.capability.assetsImageGeneration.why":
    "A geração de imagens é o fluxo principal para criar assets alinhados à marca.",
  "onboarding.capability.assetsVideoGeneration.label": "Geração de vídeo",
  "onboarding.capability.assetsVideoGeneration.keySummary":
    "Chave de API do Gemini",
  "onboarding.capability.assetsVideoGeneration.why":
    "A geração de vídeo é opcional; o fluxo principal do Assets é a geração de imagens.",
  "onboarding.capability.clipsObjectStorage.label": "Armazenamento de objetos",
  "onboarding.capability.clipsObjectStorage.keySummary":
    "Armazenamento Builder ou bucket compatível com S3",
  "onboarding.capability.clipsObjectStorage.why":
    "Vídeos gravados precisam de armazenamento de objetos durável antes de serem reproduzidos ou compartilhados.",
  "onboarding.capability.clipsTranscription.keySummary":
    "Chave de provedor de conversão de fala em texto",
  "onboarding.capability.about": "Sobre {{label}}",
  "onboarding.capability.why": "Por que {{label}} é necessário",
  "onboarding.openAiKeySettings": "Abrir configurações de chaves de IA",
  "aboutAgentNative.title": "Sobre o Agent-Native",
  "aboutAgentNative.version": "Versão",
  "aboutAgentNative.environment": "Ambiente",
  "aboutAgentNative.build": "Build",
  "aboutAgentNative.copyDiagnostics": "Copiar diagnósticos",
  "aboutAgentNative.unknown": "Desconhecida",
  "common.agent": "Agente",
  "agentPanel.mode": "Modo",
  "agentPanel.uiMode": "Interface",
  "agentPanel.keyScope": "Escopo da chave",
  "agentPanel.personalKeyScope": "Pessoal",
  "agentPanel.organizationKeyScope": "Organização",
  "agentPanel.personalKeyInEffect": "Sua chave pessoal está em uso.",
  "agentPanel.organizationKeyInEffect": "A chave da organização está em uso.",
  "agentPanel.sharedKeyInEffect": "Uma chave compartilhada está em uso.",
  "agentPanel.useOrganizationKey": "Usar chave da organização",
  "agentPanel.keyStatusUnavailable":
    "Não foi possível consultar o status da chave.",
  "agentPanel.saveScopeRoleUnavailable":
    "Não foi possível carregar sua função na organização, então ainda não é possível salvar chaves.",
  "agentPanel.chatgptSubscriptionPopupBlocked":
    "Permita pop-ups para este site e tente novamente.",
  "agentPanel.chatgptSubscriptionTitle": "Assinatura do ChatGPT",
  "agentPanel.chatgptSubscriptionDescription":
    "Acesso experimental ao Codex por meio da sua assinatura do ChatGPT.",
  "agentPanel.chatgptSubscriptionInUse": "Em uso",
  "agentPanel.chatgptSubscriptionConnected": "Conectado",
  "agentPanel.chatgptSubscriptionConnecting": "Conectando…",
  "agentPanel.chatgptSubscriptionReconnect": "Reconectar",
  "agentPanel.chatgptSubscriptionConnect": "Conectar ao ChatGPT",
  "agentPanel.chatgptSubscriptionUse": "Usar no chat",
  "agentPanel.chatgptSubscriptionDisconnect": "Desconectar",
  "agentHostNudge.sidebarTitle": "Usar o chat do {{agent}}",
  "agentHostNudge.sidebarDescription":
    "Você já está conversando com {{agent}}. Peça para ele trabalhar diretamente com este app.",
  "agentHostNudge.promptTitle": "Perguntar ao {{agent}} em vez disso",
  "agentHostNudge.promptDescription":
    "Você pode pedir ao {{agent}} para criar ou alterar isto aqui.",
  "agentHostNudge.useThisChat": "Usar este chat",
  "agentHostNudge.useThisPrompt": "Usar este prompt",
  "common.cancel": "Cancelar",
  "common.collapse": "Recolher",
  "common.connect": "Conectar",
  "common.continue": "Continuar",
  "common.copied": "Copiado",
  "common.copy": "Copiar",
  "common.details": "Detalhes",
  "common.dismiss": "Dispensar",
  "common.dismissError": "Dispensar erro",
  "common.expand": "Expandir",
  "common.loading": "Carregando...",
  "common.no": "Não",
  "common.retry": "Tentar novamente",
  "common.chunkLoadFailed": "Não foi possível carregar. Tente novamente.",
  "common.save": "Salvar",
  "agents.hostedAgent": "Agente hospedado",
  "agents.provider": "Provedor",
  "agents.providerA2A": "Agente A2A (Foundry, Gemini ou personalizado)",
  "agents.providerAnthropic": "Agentes gerenciados da Anthropic",
  "agents.agentId": "ID do agente",
  "agents.agentIdPlaceholder": "agent_...",
  "agents.environmentId": "ID do ambiente",
  "agents.environmentIdPlaceholder": "env_...",
  "agents.apiBaseUrl": "URL base da API (opcional)",
  "agents.apiBaseUrlPlaceholder": "https://api.anthropic.com",
  "agents.managedAgentIncomplete":
    "Preencha os campos do Anthropic Managed Agents.",
  "agents.managedAgentCheck":
    "A conexão é verificada quando você delega pelo chat.",
  "agents.managedAgentSaved":
    "Anthropic Managed Agent salvo. Delegue para ele pelo chat.",
  "agents.cardUrl": "URL do cartão do agente",
  "agents.cardUrlPlaceholder": "https://host.example/agent-card.json",
  "agents.authType": "Autenticação",
  "agents.authNone": "Sem autenticação",
  "agents.authBearer": "Token Bearer",
  "agents.authClientCredentials": "Credenciais de cliente OAuth",
  "agents.chooseCredential": "Escolher credencial",
  "agents.vault": "Cofre",
  "agents.tokenUrl": "URL do token",
  "agents.clientId": "ID do cliente",
  "agents.scope": "Escopo",
  "agents.authIncomplete":
    "Preencha os campos de autenticação do agente hospedado.",
  "agents.invalidUrl":
    "As URLs do agente devem usar HTTPS, exceto URLs de desenvolvimento localhost ou loopback.",
  "agents.statusReachable": "Acessível",
  "agents.statusAuthRejected": "Autenticação rejeitada",
  "agents.statusNoJsonRpc": "Sem JSON-RPC",
  "agents.directoryTab": "Diretório de agentes",
  "agents.directoryPageHint":
    "Encontre um backend de agente e conecte-o ao seu workspace.",
  "agents.directorySearch": "Pesquisar provedores",
  "agents.directoryProviders": "Provedores",
  "agents.directoryManual": "Adicionar por URL",
  "agents.directoryA2A": "A2A",
  "agents.directoryManaged": "API gerenciada",
  "agents.directoryFoundry": "Microsoft Foundry",
  "agents.directoryFoundryHint": "Conecte um agente do Foundry via A2A.",
  "agents.directoryGemini": "Gemini Enterprise",
  "agents.directoryGeminiHint":
    "Conecte um agente do Gemini Enterprise via A2A.",
  "agents.directoryAnthropic": "Agentes gerenciados da Anthropic",
  "agents.directoryAnthropicHint": "Conecte sessões e aprovações da Anthropic.",
  "agents.directoryNoMatches": "Nenhum provedor corresponde à sua pesquisa.",
  "agents.directoryRegistry": "Registro global de A2A",
  "agents.directoryRegistryHint":
    "Explore Agent Cards públicas e verifique-as antes de conectar.",
  "agents.directoryBrowse": "Explorar registro",
  "agents.formName": "Nome",
  "agents.formUrl": "URL",
  "agents.formUrlPlaceholder": "URL (ex.: http://localhost:8085)",
  "agents.formDescription": "Descrição",
  "agents.formDescriptionPlaceholder": "Descrição (opcional)",
  "agents.formCheck": "Verificar",
  "agents.formAdd": "Adicionar",
  "agents.formAdding": "Adicionando",
  "agents.formAddAnyway": "Adicionar mesmo assim",
  "agents.formRemove": "Remover",
  "agents.formSaveFailed": "Não foi possível salvar o agente.",
  "agents.formAddFailed": "Não foi possível adicionar o agente.",
  "agents.checkFailed": "Falha na verificação",
  "agents.checkFailedStatus": "Falha na verificação ({{status}})",
  "agents.checkNotReachable": "Inacessível",
  "agents.checkLive": "Ativo · {{scheme}}",
  "agents.checkNoAuthScheme": "nenhum esquema de autenticação anunciado",
  "agents.checkTokenRejected":
    "o par rejeitou nosso token, então as chamadas retornarão 401 em produção",
  "agents.checkTokenUnverified": "não foi possível verificar nosso token",
  "agents.checkTokenUnverifiedReason":
    "não foi possível verificar nosso token ({{reason}})",
  "agents.checkTokenWorks": "nosso token funciona",
  "agents.checkReadsRequireAuth": "leituras exigem autenticação",
  "agents.checkPublicSkills": "habilidades públicas: {{count}}",
  "agents.unreachableHint":
    "Talvez o app ainda não esteja em execução. Você ainda pode adicioná-lo.",
  "agents.addedOneWay":
    "{{name}} foi adicionado só do seu lado. O registro é unidirecional, então {{name}} só vai conhecer este app quando você adicioná-lo lá também.",
  "agents.openPeerSettings": "Abrir as configurações de {{name}}",
  "agents.syncSecret": "Sincronizar segredo com os apps",
  "agents.noSharedSecret": "Nenhum segredo compartilhado definido ainda.",
  "agents.noSharedSecretLink": "Defina um primeiro na página Equipe.",
  "agents.askOwnerSyncSecret":
    "Peça ao proprietário do workspace para sincronizar o segredo compartilhado.",
  "common.saveFailed": "Falha ao salvar",
  "common.saveFailedStatus": "Falha ao salvar ({{status}})",
  "common.saving": "Salvando...",
  "common.settings": "Configurações",
  "common.waiting": "Aguardando...",
  "common.yes": "Sim",
  "composer.attachmentError": "Não foi possível processar o anexo.",
  "composer.dropToAttach": "Solte para anexar",
  "composer.droppedFileError":
    "Não foi possível adicionar o arquivo solto. Tente outro formato.",
  "composer.openDesktop": "Abra o aplicativo para desktop para usar este chat.",
  "composer.removeAttachment": "Remover {{name}}",
  "composer.scrollToBottom": "Rolar até o final",
  "composer.suggestedPrompts": "Prompts sugeridos",
  "composer.stopResponse": "Parar resposta",
  "composer.subAgentReadOnly":
    "Envie mensagens ao chat do orquestrador — este subagente é executado automaticamente",
  "empty.loadingChat": "Carregando chat...",
  "empty.prompt": "Como posso ajudar?",
  "error.afterDuration": "{{headline}} após {{duration}}",
  "error.failed": "O agente encontrou um erro",
  "error.stopped": "O agente parou antes de concluir",
  "header.switchToCli": "Mudar para a CLI",
  "history.active": "Ativo",
  "history.empty": "Nenhum chat ainda",
  "history.loadOlder": "Carregar chats anteriores",
  "history.noMatches": "Nenhum chat correspondente",
  "history.open": "Abrir",
  "history.pinned": "Fixado",
  "history.search": "Pesquisar chats...",
  "history.searching": "Pesquisando...",
  "history.untitledChat": "Chat",
  "history.yesterday": "Ontem",
  "integrations.availableSection": "Integrações disponíveis",
  "integrations.connectedSection": "Conectado",
  "integrations.goToApiKeys": "Ir para chaves de API",
  "integrations.goToIntegrations": "Ir para integrações",
  "integrations.lookingForApiKeys": "Procurando uma chave de API em vez disso?",
  "integrations.lookingForProviders": "Procurando provedores OAuth ou MCP?",
  "integrations.manage": "Gerenciar",
  "integrations.recommended": "Recomendado",
  "integrations.subtitle": "Conecte as ferramentas que seu agente pode usar.",
  "mcpIntegrations.menuLabel": "Integrações",
  "mcpIntegrations.menuDescription":
    "Conectar ferramentas e serviços ao agente",
  "mcpIntegrations.title": "Conectar integrações",
  "mcpIntegrations.description":
    "Explore {{count}} integrações de agente ou adicione uma personalizada.",
  "mcpIntegrations.searchPlaceholder": "Pesquisar integrações",
  "mcpIntegrations.addYourOwn": "Adicionar a sua",
  "mcpIntegrations.noMatches":
    "Nenhuma integração corresponde a essa pesquisa.",
  "mcpIntegrations.connected": "Conectado",
  "mcpIntegrations.connectionError": "Erro de conexão",
  "mcpIntegrations.connectionErrorReason": "Motivo: {{reason}}",
  "mcpIntegrations.reconnect": "Reconectar",
  "mcpIntegrations.reconnecting": "Reconectando…",
  "mcpIntegrations.reconnectFailed": "Falha ao reconectar: {{error}}",
  "mcpIntegrations.configure": "Configurar",
  "mcpIntegrations.connect": "Conectar",
  "mcpIntegrations.connectWithOAuth": "Conectar",
  "mcpIntegrations.connecting": "Conectando…",
  "mcpIntegrations.useApiToken": "Usar token de API",
  "mcpIntegrations.customOAuthDefault": "Entrar com OAuth",
  "mcpIntegrations.customHeadersMode": "Usar uma chave de API",
  "mcpIntegrations.useApiKeyInstead": "Usar uma chave de API em vez disso",
  "mcpIntegrations.useOAuthInstead": "Usar OAuth em vez disso",
  "mcpIntegrations.connectSuggestion": "Conecte o {{name}} para usá-lo no chat",
  "mcpIntegrations.connectSuggestionWithApiToken":
    "Conecte o {{name}} com um token de API para usá-lo no chat",
  "mcpIntegrations.dismissSuggestion": "Dispensar sugestão de integração",
  "mcpIntegrations.backToIntegrations": "Voltar para integrações",
  "mcpIntegrations.customTitle": "Adicionar integração de agente personalizada",
  "mcpIntegrations.configureTitle": "Configurar {{name}}",
  "mcpIntegrations.presetNoAuthDescription":
    "Os valores predefinidos já estão preenchidos. Teste o endpoint ou conecte-o agora.",
  "mcpIntegrations.presetAuthDescription":
    "Os valores predefinidos já estão preenchidos. Adicione os detalhes de autorização necessários antes de conectar.",
  "mcpIntegrations.customDescription":
    "Cole um endpoint Streamable HTTP ou SSE e cabeçalhos opcionais.",
  "mcpIntegrations.oauthNotice":
    "Este provedor geralmente exige uma configuração OAuth. Siga a documentação do provedor ou adicione um cabeçalho Authorization se o seu endpoint aceitar acesso baseado em token.",
  "mcpIntegrations.providerSetupRequired":
    "Configuração do provedor necessária",
  "mcpIntegrations.providerSetupDescription":
    "Primeiro, conclua a configuração necessária no {{name}}. Depois, volte aqui para conectar sua conta.",
  "mcpIntegrations.providerSetupFormDescription":
    "Conclua a configuração do provedor antes de conectar sua conta.",
  "mcpIntegrations.continueToConnect": "Conectar minha conta",
  "mcpIntegrations.setupTitle": "Conectar {{name}}",
  "mcpIntegrations.personal": "Pessoal",
  "mcpIntegrations.personalConnection": "Conexão pessoal",
  "mcpIntegrations.organization": "Organização",
  "mcpIntegrations.scopeQuestion": "Quem deve poder usar esta conexão?",
  "mcpIntegrations.scopeChoiceTitle": "Quem deve usar isto?",
  "mcpIntegrations.scopeChoiceDescription":
    "Escolha onde esta conexão fica disponível.",
  "mcpIntegrations.connectForMe": "Conectar para mim",
  "mcpIntegrations.setUpForWorkspace": "Configurar para o espaço de trabalho",
  "mcpIntegrations.workspaceAdminRequired":
    "É necessário ser proprietário ou administrador do espaço de trabalho.",
  "mcpIntegrations.workspaceJoinRequired":
    "Primeiro, entre em um espaço de trabalho.",
  "mcpIntegrations.personalOnlyDescription":
    "Esta integração aceita apenas conexões pessoais.",
  "mcpIntegrations.workspaceOnlyDescription":
    "Esta integração se conecta uma única vez para todo o espaço de trabalho, então não pode ser conectada apenas à sua conta. Um proprietário ou administrador do espaço de trabalho pode configurá-la.",
  "mcpIntegrations.loadingScopeMetadata": "Carregando o escopo da conexão…",
  "mcpIntegrations.retry": "Tentar novamente",
  "mcpIntegrations.retrying": "Tentando novamente…",
  "mcpIntegrations.personalDescription": "Somente você pode usar esta conexão.",
  "mcpIntegrations.sharedWithWorkspace":
    "Compartilhada com o espaço de trabalho",
  "mcpIntegrations.organizationDescription":
    "Membros autorizados do espaço de trabalho podem usar esta conexão. As permissões do provedor continuam valendo.",
  "mcpIntegrations.serverNameRequired":
    "Insira um nome para a integração antes de conectar com OAuth.",
  "mcpIntegrations.serverName": "Nome da integração",
  "mcpIntegrations.url": "URL",
  "mcpIntegrations.fieldDescription": "Descrição",
  "mcpIntegrations.headers": "Cabeçalhos",
  "mcpIntegrations.serverNamePlaceholder": "Nome da integração",
  "mcpIntegrations.urlPlaceholder": "https://example.com/agent-integration",
  "mcpIntegrations.descriptionPlaceholder": "Descrição (opcional)",
  "mcpIntegrations.headersPlaceholder": "Authorization: Bearer <token>",
  "mcpIntegrations.openSetupDocs": "Abrir documentação de configuração",
  "mcpIntegrations.viewSetup": "Abrir guia de configuração",
  "mcpIntegrations.test": "Testar",
  "mcpIntegrations.testing": "Testando…",
  "mcpIntegrations.toolsAvailable_one": "{{count}} ferramenta disponível",
  "mcpIntegrations.toolsAvailable_many": "{{count}} ferramentas disponíveis",
  "mcpIntegrations.toolsAvailable_other": "{{count}} ferramentas disponíveis",
  "mcpIntegrations.failed": "Falhou",
  "mcpIntegrations.docsLabel": "Ver a documentação do {{name}}",
  "mcpIntegrations.catalog.context7.description":
    "Busque a documentação atual de bibliotecas nos chats com o agente.",
  "mcpIntegrations.catalog.context7.useCase":
    "Documentação, referência técnica, documentação de API, guias de frameworks",
  "mcpIntegrations.catalog.sentry.description":
    "Inspecione problemas, eventos e dados de depuração.",
  "mcpIntegrations.catalog.sentry.useCase":
    "Monitoramento de erros, depuração, desempenho, relatórios de falhas",
  "mcpIntegrations.catalog.fullstory.description":
    "Leia análises comportamentais e inspecione replays de sessão.",
  "mcpIntegrations.catalog.fullstory.useCase":
    "Análise de produto, replay de sessão, comportamento qualitativo, pesquisa com usuários",
  "mcpIntegrations.catalog.fullstory.setupNote":
    "O FullStory MCP está em beta e exige que um administrador da organização no FullStory ative os recursos do StoryAI e a opção Model Context Protocol.",
  "mcpIntegrations.catalog.amplitude.description":
    "Leia e trabalhe com a análise de produto do Amplitude.",
  "mcpIntegrations.catalog.amplitude.useCase":
    "Análise de produto, gráficos, dashboards, coortes, experimentos",
  "mcpIntegrations.catalog.amplitude.setupNote":
    "O Amplitude MCP usa OAuth via HTTP com streaming. O endpoint padrão é para residência de dados nos EUA. Use o endpoint da UE do Amplitude quando a conta exigir residência na UE.",
  "mcpIntegrations.catalog.sigma.description":
    "Pesquise, explore e analise workbooks e dashboards do Sigma.",
  "mcpIntegrations.catalog.sigma.useCase":
    "Análise de dados, dashboards, workbooks, exploração de dados, business intelligence",
  "mcpIntegrations.catalog.sigma.setupNote":
    "A URL do Sigma MCP é específica de cada organização. No Sigma, abra Profile > Integrations > Connect Sigma to AI tools, copie a URL e cole aqui. No momento, o Sigma MCP oferece pesquisa, exploração de metadados e análise. Esta conexão não permite criar nem importar dashboards ou workbooks.",
  "mcpIntegrations.catalog.notion.description":
    "Pesquise páginas e o conhecimento da equipe.",
  "mcpIntegrations.catalog.notion.useCase":
    "Documentação, gestão do conhecimento, notas, criação de conteúdo",
  "mcpIntegrations.catalog.notion.setupNote":
    "A integração do Notion usa OAuth do usuário. Espaços de trabalho Enterprise podem auditar o uso da integração e permitir ou bloquear clientes. Reconecte após mudanças na política do administrador.",
  "mcpIntegrations.catalog.granola.description":
    "Pesquise notas de reunião, transcrições e itens de ação.",
  "mcpIntegrations.catalog.granola.useCase":
    "Notas de reunião, gravações, transcrições, itens de ação, acompanhamentos",
  "mcpIntegrations.catalog.granola.setupNote":
    "A integração do Granola usa OAuth no navegador. Autorize a conta do Granola conectada e revise quais notas de reunião e transcrições o agente pode acessar.",
  "mcpIntegrations.catalog.gong.description":
    "Pesquise chamadas do Gong e gere insights sobre contas e negócios.",
  "mcpIntegrations.catalog.gong.useCase":
    "Chamadas de vendas, transcrições, insights de negócios, resumos de contas",
  "mcpIntegrations.catalog.gong.setupNote":
    "O Gong exige que um administrador técnico crie uma integração MCP e escolha a autorização pessoal ou compartilhada. O ID e o segredo do cliente gerados precisam ser configurados antes de conectar.",
  "mcpIntegrations.catalog.semgrep.description":
    "Analise o código em busca de problemas de segurança.",
  "mcpIntegrations.catalog.semgrep.useCase":
    "Verificação de segurança, detecção de vulnerabilidades, análise de código",
  "mcpIntegrations.catalog.linear.description": "Leia e crie issues do Linear.",
  "mcpIntegrations.catalog.linear.useCase":
    "Gestão de projetos, acompanhamento de issues, planejamento, relatórios de bugs",
  "mcpIntegrations.catalog.apollo.description":
    "Pesquise, enriqueça e gerencie dados de GTM do Apollo.",
  "mcpIntegrations.catalog.apollo.useCase":
    "Prospecção, enriquecimento, contatos, sequências, pesquisa de contas",
  "mcpIntegrations.catalog.apollo.setupNote":
    "O Apollo MCP usa OAuth do usuário e não exige uma chave de API do Apollo. As permissões do plano do Apollo, os créditos e as restrições de treinamento de modelos do provedor continuam valendo.",
  "mcpIntegrations.catalog.commonRoom.description":
    "Pesquise sinais de compradores, contatos e organizações.",
  "mcpIntegrations.catalog.commonRoom.useCase":
    "Inteligência sobre compradores, sinais de produto, intenção, enriquecimento de contatos",
  "mcpIntegrations.catalog.commonRoom.setupNote":
    "O Common Room MCP usa OAuth por usuário e respeita a função do usuário autorizado no espaço de trabalho. Um administrador pode precisar ativar a conexão MCP para a instância.",
  "mcpIntegrations.catalog.exa.description":
    "Pesquise na web e busque páginas com o Exa.",
  "mcpIntegrations.catalog.exa.useCase":
    "Pesquisa na web, pesquisa, busca de código, obtenção de páginas",
  "mcpIntegrations.catalog.exa.setupNote":
    "O endpoint MCP remoto do Exa permite uso básico gratuito sem chave. Adicione uma chave de API do Exa na configuração de cabeçalho do provedor quando precisar de limites maiores ou de ferramentas adicionais.",
  "mcpIntegrations.catalog.supabase.description":
    "Gerencie dados, autenticação e serviços de backend.",
  "mcpIntegrations.catalog.supabase.useCase":
    "Banco de dados, autenticação, armazenamento, edge functions",
  "mcpIntegrations.catalog.neon.description":
    "Trabalhe com projetos Postgres serverless.",
  "mcpIntegrations.catalog.neon.useCase":
    "Gerenciamento de banco de dados, Postgres serverless, armazenamento de dados",
  "mcpIntegrations.catalog.stripe.description":
    "Gerencie pagamentos, assinaturas e clientes.",
  "mcpIntegrations.catalog.stripe.useCase":
    "Pagamentos, assinaturas, faturamento, gestão de clientes",
  "mcpIntegrations.catalog.atlassian.description":
    "Leia e edite issues do Jira e conteúdo do Confluence.",
  "mcpIntegrations.catalog.atlassian.useCase":
    "Gestão de projetos, acompanhamento de issues, documentação, colaboração em equipe",
  "mcpIntegrations.catalog.atlassian.setupNote":
    "Peça ao administrador da Atlassian para permitir o domínio do app Clips e ativar o Rovo/MCP com as permissões de leitura, escrita e pesquisa para o seu site do Jira.",
  "mcpIntegrations.catalog.cloudflare.description":
    "Pesquise e opere serviços da Cloudflare pela integração dela.",
  "mcpIntegrations.catalog.cloudflare.useCase":
    "DNS, Workers, domínios, segurança, observabilidade, APIs da plataforma",
  "mcpIntegrations.catalog.cloudflare.setupNote":
    "O diretório de integrações gerenciadas da Cloudflare inclui integrações específicas por produto e a integração ampla de API. Revise os escopos e escolha o endpoint mais restrito que atenda ao seu fluxo de trabalho.",
  "mcpIntegrations.catalog.grafana.description":
    "Consulte métricas, logs e dados de observabilidade do Grafana Cloud.",
  "mcpIntegrations.catalog.grafana.useCase":
    "Observabilidade, métricas, logs, traces, dashboards",
  "mcpIntegrations.catalog.grafana.setupNote":
    "O Grafana Cloud MCP está em prévia pública e exige acesso ao MCP do Grafana Cloud Assistant. Ele funciona apenas no Grafana Cloud hospedado. O Grafana auto-hospedado precisa do servidor MCP local.",
  "mcpIntegrations.catalog.gitlab.description":
    "Leia e gerencie projetos, issues e merge requests do GitLab.",
  "mcpIntegrations.catalog.gitlab.useCase":
    "Repositórios, issues, merge requests, CI/CD, análise de código",
  "mcpIntegrations.catalog.gitlab.setupNote":
    "A integração do GitLab está em beta. No GitLab.com, um administrador do grupo de nível superior precisa permitir o acesso da integração antes que o OAuth possa ser concluído. Instâncias autogerenciadas têm uma configuração equivalente na instância.",
  "mcpIntegrations.catalog.figma.description":
    "Traga o contexto de design e as ações de canvas do Figma para um agente.",
  "mcpIntegrations.catalog.figma.useCase":
    "Arquivos de design, componentes, variáveis, design systems, canvas",
  "mcpIntegrations.catalog.figma.setupNote":
    "A integração do Figma só permite clientes listados no catálogo de integrações do Figma, então este endpoint remoto ainda não consegue se conectar a partir do Agent-Native. Use a alternativa pela API REST do Figma com um token de acesso pessoal para ler o contexto de arquivos e nós. As ações de canvas continuam indisponíveis até que o Figma aprove o Agent-Native.",
  "mcpIntegrations.catalog.canva.description":
    "Pesquise, crie e atualize designs e recursos do Canva.",
  "mcpIntegrations.catalog.canva.useCase":
    "Designs, modelos, recursos, kits de marca, exportações, colaboração",
  "mcpIntegrations.catalog.canva.setupNote":
    "A integração do Canva usa OAuth por usuário e exige que os clientes permitam os domínios canva.com e canva.ai do Canva. Confirme a configuração atual de redirecionamento e do cliente na documentação de integração do Canva antes de conectar.",
  "mcpIntegrations.catalog.vercel.description":
    "Pesquise a documentação da Vercel e inspecione projetos, implantações e logs.",
  "mcpIntegrations.catalog.vercel.useCase":
    "Implantações, projetos, logs, domínios, hospedagem, documentação",
  "mcpIntegrations.catalog.vercel.setupNote":
    "A integração da Vercel só aceita clientes de IA revisados e aprovados. O Agent-Native precisa ser adicionado à lista de clientes compatíveis da Vercel para que uma conexão genérica do framework funcione.",
  "mcpIntegrations.catalog.github.description":
    "Leia repositórios, issues, pull requests e contexto de código.",
  "mcpIntegrations.catalog.github.useCase":
    "Repositórios, issues, pull requests, código, análise de engenharia",
  "mcpIntegrations.catalog.github.setupNote":
    "O provedor de login do GitHub não permite que apps se registrem sozinhos, então o botão Conectar não consegue concluir o OAuth. Conecte-se com um token de acesso pessoal do GitHub. Observe que as organizações podem aplicar políticas de acesso de OAuth Apps.",
  "mcpIntegrations.catalog.slack.description":
    "Pesquise conversas do Slack e realize ações no espaço de trabalho pela integração dele.",
  "mcpIntegrations.catalog.slack.useCase":
    "Mensagens, canais, pessoas, memória da empresa, fluxos de trabalho",
  "mcpIntegrations.catalog.slack.setupNote":
    "A integração do Slack exige um app do Slack registrado com um ID de app fixo. O registro dinâmico de clientes não é compatível, e somente apps do Slack Marketplace ou apps internos podem se conectar. Use o fluxo OAuth de mensagens gerenciado do Slack para os fluxos de trabalho do Agent-Native.",
  "mcpIntegrations.catalog.asana.description":
    "Pesquise e gerencie tarefas, projetos e dados do gráfico de trabalho do Asana.",
  "mcpIntegrations.catalog.asana.useCase":
    "Tarefas, projetos, portfólios, planejamento, carga de trabalho",
  "mcpIntegrations.catalog.asana.setupNote":
    "A integração de agente do Asana exige um app OAuth pré-registrado e não aceita registro dinâmico de clientes. Configure um cliente de app do Asana antes de conectar.",
  "mcpIntegrations.catalog.hubspot.description":
    "Pesquise e atualize registros do CRM do HubSpot pela integração dele.",
  "mcpIntegrations.catalog.hubspot.useCase":
    "CRM, contatos, empresas, negócios, tickets, análise de clientes",
  "mcpIntegrations.catalog.hubspot.setupNote":
    "Quando um HubSpot MCP Auth App gerenciado pelo espaço de trabalho estiver configurado, qualquer membro pode conectar uma conta pessoal do HubSpot com OAuth e PKCE. Caso contrário, crie o app no HubSpot Developer Platform antes de conectar. O conector OAuth existente do HubSpot continua disponível para as ações do app.",
  "mcpIntegrations.catalog.pylon.description":
    "Pesquise e atualize dados de suporte do Pylon.",
  "mcpIntegrations.catalog.pylon.useCase":
    "Suporte ao cliente, problemas, contas, contatos, conversas",
  "mcpIntegrations.catalog.pylon.setupNote":
    "Ative o acesso MCP do Pylon para os usuários relevantes e ligue o servidor MCP no Pylon antes de conectar. O Pylon exige uma licença de Member ou Admin e usa apenas OAuth do usuário.",
  "mcpIntegrations.catalog.intercom.description":
    "Pesquise conversas e o conhecimento de suporte ao cliente.",
  "mcpIntegrations.catalog.intercom.useCase":
    "Suporte ao cliente, conversas, contatos, conteúdo da central de ajuda",
  "mcpIntegrations.catalog.intercom.setupNote":
    "A integração do Intercom usa OAuth e está disponível para espaços de trabalho hospedados nos EUA. Confirme a região do espaço de trabalho e os escopos solicitados durante a autorização.",
  "mcpIntegrations.catalog.monday.description":
    "Trabalhe com quadros, itens e fluxos de trabalho da equipe.",
  "mcpIntegrations.catalog.monday.useCase":
    "Gestão do trabalho, quadros, projetos, tarefas, operações da equipe",
  "mcpIntegrations.catalog.monday.setupNote":
    "A integração do monday.com usa OAuth via Streamable HTTP. Escolha o espaço de trabalho e as permissões a compartilhar durante a autorização.",
  "mcpIntegrations.catalog.webflow.description":
    "Leia e atualize sites e conteúdo do Webflow.",
  "mcpIntegrations.catalog.webflow.useCase":
    "Sites, CMS, conteúdo do site, publicação, fluxos de trabalho de design",
  "mcpIntegrations.catalog.webflow.setupNote":
    "A integração do Webflow usa OAuth. Os recursos do Designer podem instalar o Bridge App do Webflow durante a autorização. O acesso à Data API está disponível separadamente.",
  "mcpIntegrations.catalog.paypal.description":
    "Trabalhe com pagamentos, faturas e dados de comércio do PayPal.",
  "mcpIntegrations.catalog.paypal.useCase":
    "Pagamentos, faturas, transações, operações de lojista",
  "mcpIntegrations.catalog.paypal.setupNote":
    "O PayPal oferece descoberta e login OAuth para a integração de agente remota. O Agent-Native usa o endpoint /sse atualmente ativo. Revise as permissões de lojista antes de autorizar.",
  "mcpIntegrations.catalog.box.description":
    "Pesquise e gerencie arquivos e pastas no Box.",
  "mcpIntegrations.catalog.box.useCase":
    "Arquivos, pastas, conteúdo corporativo, pesquisa, colaboração",
  "mcpIntegrations.catalog.box.setupNote":
    "A integração do Box está em beta e precisa ser ativada por um administrador. Clientes personalizados também precisam de Box Integration Credentials, uma URI de redirecionamento e escopos aprovados.",
  "mcpIntegrations.catalog.builder.description":
    "Pesquise conteúdo do Builder Publish e de Hybrid Spaces.",
  "mcpIntegrations.catalog.builder.useCase":
    "Modelos de conteúdo, páginas, entradas, Publish e Hybrid Spaces",
  "mcpIntegrations.catalog.builder.setupNote":
    "O Builder CMS MCP usa OAuth com registro dinâmico de clientes. Ele só se conecta a Publish ou Hybrid Spaces, e o fluxo de autorização pede que você selecione o Space.",
  "mcpIntegrations.catalog.netlify.description":
    "Inspecione e opere sites e implantações da Netlify.",
  "mcpIntegrations.catalog.netlify.useCase":
    "Sites, implantações, builds, domínios, operações de hospedagem",
  "mcpIntegrations.catalog.netlify.setupNote":
    "A Netlify documenta uma configuração de integração remota para clientes compatíveis. Revise as permissões do site e da equipe antes de concluir o OAuth.",
  "mcpIntegrations.catalog.zapier.description":
    "Conecte ferramentas a milhares de ações de apps.",
  "mcpIntegrations.catalog.zapier.useCase":
    "Automação, fluxos de trabalho, ações de apps, operações entre serviços",
  "mcpIntegrations.catalog.zapier.setupNote":
    "A integração de agente do Zapier usa uma conexão e um token criados pelo usuário para clientes não listados. Crie a conexão no Zapier e cole o token bearer gerado no campo de cabeçalho.",
  "mcpIntegrations.auth.none": "Sem autenticação",
  "mcpIntegrations.auth.headers": "Cabeçalho",
  "mcpIntegrations.auth.oauth": "OAuth",
  "mcpIntegrations.status.beta": "Beta",
  "mcpIntegrations.status.setupRequired": "Configuração do provedor",
  "mcpIntegrations.status.clientRestricted": "Somente clientes aprovados",
  "mcpIntegrations.status.verified": "Verificado",
  "mcpIntegrations.status.preflightOnly": "Somente verificação prévia",
  "mcpIntegrations.status.restricted": "Restrito",
  "limit.account": "sua conta",
  "limit.descriptionAll":
    "O agente usou todas as etapas disponíveis. Continue em uma nova interação ou aumente primeiro o limite de {{scope}}.",
  "limit.descriptionWithCount":
    "O agente usou {{formattedCount}} etapas. Continue em uma nova interação ou aumente primeiro o limite de {{scope}}.",
  "limit.keepGoing": "Continuar",
  "limit.maxSteps": "Máximo de etapas",
  "limit.namedOrganization": "organização {{organization}}",
  "limit.organization": "a organização",
  "limit.ownerOnly":
    "Somente proprietários e administradores da organização podem alterar este limite.",
  "limit.reached": "Limite de etapas atingido",
  "limit.saveAndContinue": "Salvar e continuar",
  "message.actions": "Ações da mensagem",
  "message.copyMessage": "Copiar mensagem",
  "message.copyRequestId": "Copiar ID da solicitação",
  "message.requestIdUnavailable": "ID da solicitação indisponível",
  "message.edit": "Editar mensagem",
  "message.forkChat": "Bifurcar chat",
  "message.missingFinal":
    "O agente parou sem enviar uma mensagem final. Peça para ele continuar ou tente novamente.",
  "message.messages": "Mensagens",
  "message.nextBranch": "Próxima ramificação",
  "message.noRestoreRun":
    "Esta mensagem não possui uma execução para restaurar.",
  "message.previousBranch": "Ramificação anterior",
  "message.regenerate": "Gerar resposta novamente",
  "message.restoreFailed": "Falha ao restaurar ({{status}}).",
  "message.restoreQuestion": "Restaurar até aqui?",
  "message.revertQuestion":
    "Reverter para este ponto? As alterações feitas depois serão perdidas.",
  "message.restoreRequestFailed": "Falha na solicitação de restauração.",
  "message.threadNotFound":
    "Esta conversa não está mais disponível. Inicie uma nova conversa ou tente novamente se isso for inesperado.",
  "message.restoring": "Restaurando...",
  "message.revertHere": "Reverter até aqui",
  "message.revertToBeginning": "Reverter ao início",
  "message.sentAt": "Enviado às {{time}}",
  "plan.act": "Agir",
  "plan.implement": "Implementar",
  "plan.mode": "Modo de planejamento",
  "plan.ready": "Plano pronto",
  "plan.switchToAct": "Mudar para o modo de ação",
  "queue.count": "{{count}} na fila",
  "queue.followUp": "Enviar uma mensagem de acompanhamento...",
  "queue.followUpWithCount":
    "{{count}} na fila — enviar uma mensagem de acompanhamento...",
  "queue.remove": "Remover da fila",
  "queue.sendNow": "Enviar agora",
  "queue.sendNowHint": "Enviar agora (interrompe a resposta atual)",
  "queue.steer": "Orientar",
  "queue.steerHint": "Enviar esta mensagem em seguida",
  "queue.moreActions": "Mais ações",
  "queue.moveToTop": "Mover para o topo",
  "recovery.connectingBuilder": "Conectando ao Builder.io",
  "recovery.copyDebug": "Copiar informações de depuração",
  "recovery.copyFailed": "Falha ao copiar",
  "recovery.credentialRejected":
    "A credencial atual do Builder.io ou do provedor de modelos foi rejeitada. Reconecte o Builder.io e tente enviar esta mensagem novamente.",
  "recovery.diagnoseRetry": "Diagnosticar e tentar novamente",
  "recovery.forkDescription":
    "Bifurque esta conversa em uma linha de chat separada.",
  "recovery.forkFailed":
    "Não foi possível bifurcar este chat. Tente iniciar um novo chat.",
  "recovery.forking": "Bifurcando...",
  "recovery.newChatHint":
    "Se a nova tentativa resultar no mesmo erro, inicie uma nova sessão de chat e continue a partir das alterações já realizadas.",
  "recovery.backgroundTimeout":
    "A execução anterior do agente em segundo plano atingiu o limite de tempo antes de terminar. O trabalho parcial foi preservado; continue ou tente novamente a partir daqui.",
  "recovery.noProgress":
    "A execução anterior do agente deixou de mostrar progresso durante a recuperação e foi interrompida antes de continuar em loop.",
  "recovery.statusCheckFailed":
    "Não foi possível acessar o servidor para verificar se o agente ainda está trabalhando. Envie a mensagem novamente para tentar de novo.",
  "recovery.streamEnded":
    "O fluxo anterior do agente terminou durante a recuperação. Continue ou tente novamente para se reconectar à execução.",
  "recovery.reconnectBuilder": "Reconectar o Builder.io",
  "secrets.addCustomKeyNamed": 'Adicionar "{{name}}" como chave personalizada',
  "secrets.chooseKey": "Escolha uma chave",
  "secrets.customKey": "Chave personalizada",
  "secrets.customKeyHint": "Adicione qualquer chave pelo nome",
  "secrets.emptyHint": "Adicione uma chave para usar suas próprias contas.",
  "secrets.emptyMore":
    "e mais {{count}} em Novo, ou adicione qualquer chave personalizada",
  "secrets.emptyTitle": "Nenhuma chave ainda.",
  "secrets.fromEnvironment": "Fornecido pelo ambiente de implantação.",
  "secrets.managedInVault":
    "Gerenciado no Vault do espaço de trabalho. Todos os apps deste espaço de trabalho usam este valor.",
  "secrets.openVault": "Abrir Vault",
  "secrets.managedByOwner": "Gerenciado em {{owner}}",
  "secrets.removeCredentials": "Remover credenciais",
  "secrets.confirmRemove": "Remover",
  "secrets.sharedKeysKept":
    "Algumas chaves compartilhadas não foram removidas. Somente administradores do workspace podem removê-las.",
  "secrets.newKey": "Novo",
  "secrets.noKeysFound": "Nenhuma chave encontrada.",
  "secrets.overridesVault":
    "Esta chave pessoal substitui o valor do Vault do espaço de trabalho. Remova-a para usar a chave do Vault.",
  "secrets.overridesWorkspace":
    "Esta chave pessoal substitui o valor do espaço de trabalho. Remova-a para usar a chave compartilhada.",
  "secrets.setForWorkspace": "Definido para todos neste espaço de trabalho.",
  "secrets.sourceEnvironment": "Ambiente",
  "secrets.sourceVault": "Vault",
  "secrets.sourceWorkspace": "Espaço de trabalho",
  "secrets.statusUnavailable": "Indisponível",
  "secrets.required": "Obrigatório",
  "secrets.searchKeys": "Pesquisar chaves...",
  "secrets.usePersonalKey": "Usar uma chave pessoal",
  "selection.attached": "{{formattedCount}} caracteres da seleção anexados",
  "selection.clear": "Limpar contexto da seleção",
  "setup.addOwnKeys": "Adicionar suas próprias chaves",
  "setup.builderCredits":
    "O Builder.io inclui créditos gratuitos, ou você pode usar sua própria chave de API.",
  "setup.builderOrOwnKeys":
    "Use o Builder.io (créditos gratuitos) ou adicione as chaves do seu próprio provedor.",
  "setup.connectAi": "Conectar IA",
  "setup.connectBuilder": "Conectar o Builder.io",
  "setup.connectPlaceholder": "Conecte a IA para começar a conversar...",
  "setup.connectToChat": "Conectar a IA ao chat",
  "setup.connectToStart": "Conecte a IA para começar a conversar",
  "setup.connected": "Conectado",
  "setup.connectedOrganization": "Conectado — {{organization}}",
  "setup.connectedTo": "Conectado a {{organization}}",
  "setup.freeCredits":
    "Créditos gratuitos para LLM, hospedagem e muito mais — sem necessidade de chave de API",
  "setup.keyProvider": "Provedor de chaves de API",
  "setup.keySaveFailed": "Não foi possível salvar a chave.",
  "setup.storedSecurely":
    "Armazenado com segurança somente para este aplicativo.",
  "status.resuming": "Retomando",
  "status.stillWorking": "Ainda trabalhando",
  "status.thinking": "Pensando",
  "status.working": "Trabalhando",
  "shell.chat": "Chat",
  "shell.loadingTerminal": "Carregando terminal...",
  "shell.toggleAgent": "Mostrar ou ocultar agente",
  "status.contactingModel": "Contatando o modelo",
  "status.starting": "Iniciando {{activity}}...",
  "status.preparing": "Preparando {{activity}}...",
  "status.writing": "Escrevendo {{activity}}...",
  "status.stillGenerating": "Ainda gerando {{activity}}",
  "status.runningTool": "Executando {{activity}}",
  "tabs.allChats": "Todos os chats",
  "tabs.closeTab": "Fechar aba",
  "tabs.main": "Principal",
  "tabs.newChat": "Novo chat",
  "tabs.subAgent": "Subagente...",
  "tool.askedAgent": "{{agent}} foi consultado",
  "tool.askingAgent": "Consultando {{agent}}...",
  "tool.elapsed": "{{duration}} decorridos",
  "tool.askingAgentFailed": "Erro ao consultar {{agent}}",
  "tool.input": "Entrada",
  "tool.inputWithLabel": "Entrada - {{label}}",
  "tool.interrupted":
    "Interrompido antes da confirmação da conclusão — a operação pode ou não ter sido concluída. Verifique antes de tentar novamente.",
  "tool.longRunning":
    "Ainda trabalhando. Atualizações grandes podem levar um ou dois minutos.",
  "tool.ranTools": "{{count}} ferramentas executadas",
  "tool.rawOutput": "Saída bruta da chamada da ferramenta {{tool}}",
  "tool.repeated": "Repetido {{count}} vezes",
  "tool.result": "Resultado",
  "tool.subAgentTask": "Tarefa do subagente",
  "thinking.collapsed": "Recolhido",
  "thinking.display": "Raciocínio",
  "thinking.expanded": "Expandido",
  "thinking.hidden": "Oculto",
  "tool.thought": "Raciocínio",
  "tool.thoughtFor": "Raciocinou por {{duration}}",
  "tool.viewOutput": "Ver saída de {{tool}}",
  "tool.worked": "Trabalhou",
  "tool.workedFor": "Trabalhou por {{duration}}",
  "widget.chart": "Gráfico",
  "widget.dataChart": "Gráfico de dados",
  "widget.dataInsights": "Insights de dados",
  "widget.dataTable": "Tabela de dados",
  "widget.downloadCsv": "Baixar CSV",
  "widget.connectProvider": "Conectar o {{provider}}",
  "widget.loadingToolResult": "Carregando resultado da ferramenta",
  "widget.noRows": "Nenhuma linha",
  "widget.points": "{{formattedCount}} pontos",
  "widget.rows": "{{formattedCount}} linhas",
  "widget.sampled": "amostrado",
  "commands.clearShort": "Iniciar um novo bate-papo",
  "commands.newShort": "Iniciar um novo bate-papo",
  "composer.actDescription": "Use ferramentas e faça alterações aprovadas",
  "composer.activeAppContext": "Contexto de aplicativo ativo",
  "composer.actMode": "Modo de ação",
  "composer.add": "Adicionar...",
  "composer.addOwnKeys": "Chaves personalizadas",
  "composer.assets.closePicker": "Fechar seletor de imagens",
  "composer.assets.contextTitle": "Imagem: {{title}}",
  "composer.assets.generatedImage": "Imagem gerada",
  "composer.assets.generateImage": "Gerar imagem",
  "composer.assets.invalidUrl":
    "O URL do seletor de imagens configurado não é válido.",
  "composer.assets.loadingPicker": "Carregando o seletor Assets",
  "composer.assets.openPicker": "Abrir o seletor de imagens do Assets",
  "composer.assets.openSecurely":
    "Abra Assets em uma nova guia para fazer login e escolher uma imagem com segurança.",
  "composer.assets.pickerTitle": "Seletor de imagens do Assets",
  "composer.auto": "Auto",
  "composer.builderModelCredits":
    "Créditos grátis para Claude, OpenAI e Gemini",
  "composer.chatGptSubscription": "Assinatura do ChatGPT",
  "composer.closePreview": "Fechar visualização",
  "composer.configureProviderKeys":
    "Configurar Anthropic, OpenAI ou outro provedor",
  "composer.connectAbove": "Conecte um provedor de IA acima para continuar...",
  "composer.connectBuilder": "Conectar Builder.io",
  "composer.connectKeys": "Conectar chaves",
  "composer.connectingBuilder": "Conectando Builder.io…",
  "composer.costHigher": "Custo mais alto",
  "composer.costLower": "Menor custo",
  "composer.costMedium": "Custo médio",
  "composer.createAutomation": "Criar automação",
  "composer.createAutomationPrefix": "Criar uma automação: ",
  "composer.createExtension": "Criar extensão",
  "composer.createExtensionPrefix": "Criar uma extensão: ",
  "composer.createSkill": "Criar habilidade",
  "composer.createSkillPrefix": "Criar uma habilidade: ",
  "composer.currentDraft": "Rascunho atual",
  "composer.defaultModel": "Modelo padrão",
  "composer.describeAutomation": "Descreva o que você deseja automatizar...",
  "composer.describeExtension":
    "Descreva a extensão interativa que você deseja construir...",
  "composer.describeSchedule": "Descreva o que deve acontecer e quando...",
  "composer.describeSkill": "Descreva a habilidade que você deseja criar...",
  "composer.documentTooLarge":
    '"{{name}}" tem {{size}} MB. {{label}} são limitados a {{maxSize}} MB para não ultrapassar o tamanho máximo da mensagem. Reduza o arquivo ou divida-o em partes menores.',
  "composer.requestTooLarge":
    "Esta mensagem e seus anexos são grandes demais para enviar. Remova um anexo ou encurte a mensagem.",
  "composer.file": "arquivo",
  "composer.imageModel": "Modelo de imagem",
  "composer.imagePreview": "Visualização da imagem",
  "composer.loadingModels": "Carregando modelos",
  "composer.loadingModelsProgress": "Carregando modelos…",
  "composer.menu.createAutomation": "Criar automação",
  "composer.menu.createAutomationDescription":
    "Configurar uma regra do tipo “se X, faça Y”",
  "composer.menu.createExtension": "Criar extensão",
  "composer.menu.createExtensionDescription":
    "Criar uma extensão de miniaplicativo",
  "composer.menu.createSkill": "Criar habilidade",
  "composer.menu.createSkillDescription":
    "Ensine ao agente uma nova habilidade",
  "composer.menu.generateImage": "Gerar imagem",
  "composer.menu.generateImageDescription":
    "Abrir o seletor de imagens do Assets",
  "composer.menu.integrations": "Integrações",
  "composer.menu.integrationsDescription":
    "Conectar ferramentas e serviços ao agente",
  "composer.menu.scheduleTask": "Agendar tarefa",
  "composer.menu.scheduleTaskDescription":
    "Executar algo conforme uma programação",
  "composer.menu.uploadFile": "Carregar arquivo",
  "composer.menu.uploadFileDescription":
    "Imagens, PDFs, texto/código, JSON, CSV",
  "composer.messageAgent": "Enviar mensagem ao agente...",
  "composer.model": "Modelo",
  "composer.needsApiKey": "requer uma chave de API",
  "composer.pageTitle": "Título da página",
  "composer.pastedImageError":
    "Não foi possível anexar a imagem colada. Experimente um formato diferente.",
  "composer.pastedTextError": "Não foi possível anexar o texto colado.",
  "composer.plan": "Plano",
  "composer.planDescription": "Pesquisa somente leitura e aprovação primeiro",
  "composer.planDesktopRequired":
    "Abra Agent-Native Desktop para usar o modo Plano.",
  "composer.previewAttachment": "Visualização {{name}}",
  "composer.reasoning": "Raciocínio",
  "composer.reasoningEffort.auto": "Auto",
  "composer.reasoningEffort.high": "Alto",
  "composer.reasoningEffort.low": "Baixo",
  "composer.reasoningEffort.max": "Máx.",
  "composer.reasoningEffort.medium": "Médio",
  "composer.reasoningEffort.minimal": "Mínimo",
  "composer.reasoningEffort.none": "Nenhum",
  "composer.reasoningEffort.xhigh": "Extra alto",
  "composer.reasoningExtraHighShort": "Muito alto",
  "composer.reasoningMediumShort": "Méd.",
  "composer.reasoningMinimalShort": "Mín.",
  "composer.removeContext": "Remover contexto {{name}}",
  "composer.removeReference": "Remover referência {{name}}",
  "composer.route": "Rota",
  "composer.scheduleTask": "Agendar tarefa",
  "composer.scheduleTaskPrefix": "Crie um trabalho recorrente: ",
  "composer.selectedReferences": "Referências selecionadas",
  "composer.sendMessage": "Enviar mensagem",
  "composer.skill.added": 'Habilidade "{{name}}" adicionada',
  "composer.skill.back": "Voltar",
  "composer.skill.content": "Conteúdo",
  "composer.skill.createDescription":
    "Descreva uma habilidade e deixe o agente elaborá-la",
  "composer.skill.createNew": "Criar nova habilidade",
  "composer.skill.name": "Nome da habilidade",
  "composer.skill.review": "Revise o conteúdo de {{name}} antes de salvar.",
  "composer.skill.savedAt": "Salvo em",
  "composer.skill.saveFailed": "Falha ao salvar o arquivo de habilidade",
  "composer.skill.selectedFile": "o arquivo selecionado",
  "composer.skill.uploadDescription": "Importe um arquivo SKILL.md existente",
  "composer.skill.uploadFailedStatus": "Falha no upload ({{status}})",
  "composer.skill.uploadFile": "Carregar arquivo de habilidade",
  "composer.upload": "Carregar",
  "composer.uploadFailed":
    "Não foi possível fazer upload do arquivo selecionado.",
  "composer.useAttachedContext": "Use o contexto anexado.",
  "mentions.commands": "Comandos",
  "mentions.learnMore": "Saber mais",
  "mentions.noResults": "Nenhum resultado encontrado",
  "mentions.noSkills": "Nenhuma habilidade disponível",
  "mentions.sections.agents": "Agentes",
  "mentions.sections.connectedAgents": "Agentes Conectados",
  "mentions.sections.files": "Arquivos",
  "mentions.sections.other": "Outro",
  "mentions.skills": "Habilidades",
  "mentions.typeToSearch": "Digite para pesquisar...",
  "pastedText.characters": "{{formattedCount}} caracteres",
  "pastedText.characters_many": "{{formattedCount}} caracteres",
  "pastedText.characters_one": "{{formattedCount}} caractere",
  "pastedText.characters_other": "{{formattedCount}} caracteres",
  "pastedText.lines": "{{formattedCount}} linhas",
  "pastedText.lines_many": "{{formattedCount}} linhas",
  "pastedText.lines_one": "{{formattedCount}} linha",
  "pastedText.lines_other": "{{formattedCount}} linhas",
  "pastedText.preview": "Visualizar texto colado",
  "pastedText.remove": "Remover texto colado",
  "pastedText.title": "Texto colado",
  "voice.dictation.cancel": "Cancelar (Esc)",
  "voice.dictation.cancelRecording": "Cancelar gravação",
  "voice.dictation.start": "Ditar ({{shortcut}})",
  "voice.dictation.stopRecording": "Parar gravação",
  "voice.dictation.transcribing": "Transcrevendo…",
  "voiceMode.connectBuilder": "Conectar Builder.io",
  "voiceMode.end": "Encerrar modo de voz",
  "voiceMode.entryButtonLabel": "Usar microfone",
  "voiceMode.errors.channelDisconnected":
    "O canal de controle de voz em tempo real foi desconectado.",
  "voiceMode.errors.connectionFailed": "A conexão de voz em tempo real falhou.",
  "voiceMode.errors.connectionTimedOut":
    "A conexão de voz em tempo real expirou.",
  "voiceMode.errors.offerFailed": "O navegador não criou uma oferta de áudio.",
  "voiceMode.errors.responseFailed":
    "OpenAI não conseguiu completar a resposta de voz.",
  "voiceMode.errors.sessionFailed":
    "A sessão de voz em tempo real encontrou um erro.",
  "voiceMode.errors.unsupported":
    "Este navegador não oferece suporte a conversas de voz em tempo real.",
  "voiceMode.hideChat": "Ocultar bate-papo",
  "voiceMode.keepDictating": "Ditar uma mensagem",
  "voiceMode.promptDescription":
    "O modo de voz continua ouvindo enquanto o agente navega e executa ações.",
  "voiceMode.promptTitle": "Use sua voz",
  "voiceMode.rememberPreference": "Lembrar minha preferência",
  "voiceMode.settings.autoLanguage": "Auto",
  "voiceMode.settings.defaultMicrophone": "Padrão do sistema",
  "voiceMode.settings.intelligence": "Inteligência",
  "voiceMode.settings.intelligenceLevels.balanced": "Equilibrado",
  "voiceMode.settings.intelligenceLevels.deep": "Profundo",
  "voiceMode.settings.intelligenceLevels.instant": "Instantâneo",
  "voiceMode.settings.language": "Idioma",
  "voiceMode.settings.languages.de": "Alemão",
  "voiceMode.settings.languages.en": "Inglês",
  "voiceMode.settings.languages.es": "Espanhol",
  "voiceMode.settings.languages.fr": "Francês",
  "voiceMode.settings.languages.it": "Italiano",
  "voiceMode.settings.languages.ja": "Japonês",
  "voiceMode.settings.languages.ko": "Coreano",
  "voiceMode.settings.languages.pt": "Português",
  "voiceMode.settings.languages.zh": "Chinês",
  "voiceMode.settings.microphone": "Microfone",
  "voiceMode.settings.microphoneNumber": "Microfone {{number}}",
  "voiceMode.settings.microphoneSwitchFailed":
    "Não foi possível trocar de microfone. Seu microfone atual ainda está ativo.",
  "voiceMode.settings.voiceChangePending":
    "Sua nova voz será aplicada na próxima vez que você iniciar o modo de voz.",
  "voiceMode.settings.voiceDescriptions.alloy": "Equilibrado e neutro",
  "voiceMode.settings.voiceDescriptions.ash": "Suave e confiante",
  "voiceMode.settings.voiceDescriptions.ballad": "Quente e expressivo",
  "voiceMode.settings.voiceDescriptions.cedar": "Claro e fundamentado",
  "voiceMode.settings.voiceDescriptions.coral": "Amigável e brilhante",
  "voiceMode.settings.voiceDescriptions.echo": "Claro e direto",
  "voiceMode.settings.voiceDescriptions.marin": "Quente e natural",
  "voiceMode.settings.voiceDescriptions.sage": "Calmo e atencioso",
  "voiceMode.settings.voiceDescriptions.shimmer": "Leve e otimista",
  "voiceMode.settings.voiceDescriptions.verse": "Expressivo e versátil",
  "voiceMode.settings.voiceStyle": "Estilo de voz",
  "voiceMode.setupDescription":
    "Conecte Builder.io para usar voz gerenciada com créditos gratuitos ou adicione suas próprias chaves.",
  "voiceMode.setupTitle": "Configurar o modo de voz",
  "voiceMode.showChat": "Mostrar bate-papo",
  "voiceMode.start": "Iniciar conversa por voz",
  "voiceMode.startWithOpenAiKey": "Iniciar com uma chave da OpenAI",
  "voiceMode.status.connecting": "Conectando",
  "voiceMode.status.ending": "Encerrando o modo de voz",
  "voiceMode.status.error": "O modo de voz precisa de atenção",
  "voiceMode.status.listening": "Ouvindo",
  "voiceMode.status.speaking": "Falando",
  "voiceMode.status.working": "Trabalhando",
  "voiceMode.useOpenAiKey": "Adicione suas próprias chaves",
  "voiceMode.voiceSettings": "Configurações de voz",
  "duration.hourShort": "h",
  "duration.minuteShort": "min",
  "duration.secondShort": "s",
  "limit.descriptionWithCount_one":
    "O agente usou {{formattedCount}} etapa. Continue em uma nova interação ou aumente primeiro o limite de {{scope}}.",
  "limit.descriptionWithCount_many":
    "O agente usou {{formattedCount}} etapas. Continue em uma nova interação ou aumente primeiro o limite de {{scope}}.",
  "limit.descriptionWithCount_other":
    "O agente usou {{formattedCount}} etapas. Continue em uma nova interação ou aumente primeiro o limite de {{scope}}.",
  "selection.attached_one": "{{formattedCount}} caractere de seleção anexado",
  "selection.attached_many":
    "{{formattedCount}} caracteres de seleção anexados",
  "selection.attached_other":
    "{{formattedCount}} caracteres de seleção anexados",
  "tool.ranTools_one": "{{count}} ferramenta executada",
  "tool.ranTools_many": "{{count}} ferramentas executadas",
  "tool.ranTools_other": "{{count}} ferramentas executadas",
  "widget.points_one": "{{formattedCount}} ponto",
  "widget.points_many": "{{formattedCount}} pontos",
  "widget.points_other": "{{formattedCount}} pontos",
  "widget.rows_one": "{{formattedCount}} linha",
  "widget.rows_many": "{{formattedCount}} linhas",
  "widget.rows_other": "{{formattedCount}} linhas",
  "errorMessages.agentConnection":
    "A conexão do agente foi interrompida. Verifique sua conexão e tente novamente.",
  "errorMessages.attachmentPasswordProtected":
    "Este PDF está protegido por senha e não pode ser lido. Remova a proteção por senha ou cole o texto relevante e tente novamente.",
  "errorMessages.builderAuthentication":
    "O Builder rejeitou as credenciais conectadas. Reconecte Builder.io em Configurações e tente novamente.",
  "errorMessages.builderModelUnauthorized":
    "O provedor por trás deste modelo rejeitou a solicitação. Escolha um modelo diferente e tente novamente.",
  "errorMessages.errorPrefix": "Erro: {{message}}",
  "errorMessages.gatewayInternalError":
    "O gateway do modelo teve um erro interno antes de o agente poder responder. Tente novamente em instantes e informe o id de erro abaixo se continuar acontecendo.",
  "errorMessages.gatewayNoDetails":
    "O gateway do modelo não retornou detalhes do erro, e o chat não pôde ser recuperado. Aguarde um momento e tente novamente. Se o problema persistir, inicie um novo chat.",
  "errorMessages.creditsLimitReached":
    "Você atingiu o limite de créditos de IA.",
  "errorMessages.inactivityTimeout":
    "A conexão com o agente expirou antes da conclusão. Você pode continuar a partir do trabalho parcial ou tentar novamente.",
  "errorMessages.invalidToolSchema":
    "O esquema de uma ferramenta era inválido, então o modelo rejeitou a solicitação antes de iniciá-la. Você pode ignorar a ferramenta inválida e tentar novamente.",
  "errorMessages.malformedRequest":
    "O provedor do modelo rejeitou esta solicitação por estar malformada, então ela não foi repetida. Tente novamente ou inicie um novo chat se continuar acontecendo.",
  "errorMessages.malformedRequestAttachment":
    "O modelo rejeitou um arquivo anexado, então esta mensagem nunca foi enviada. Remova o anexo e tente novamente: um PDF, um arquivo de texto simples ou uma imagem JPEG, PNG, GIF ou WebP é lido diretamente; outros formatos precisam ser enviados e vinculados.",
  "errorMessages.noProviderConnected":
    "Nenhum provedor de LLM está conectado. Abra Configurações > Agente > Provedores de IA e conecte o Builder.io (nível gratuito disponível) ou adicione uma chave de provedor.",
  "errorMessages.openBuilderSpaceSettings":
    "Abrir as configurações do espaço do Builder",
  "errorMessages.providerAuthentication":
    "O provedor do modelo rejeitou a chave de API salva. Atualize-a em Configurações → Integrações → Chaves de API e tente novamente.",
  "errorMessages.providerConfiguration":
    "Este modelo não pode usar ferramentas com as configurações atuais. Troque de modelo em Configurações e tente novamente.",
  "errorMessages.providerHtml": "O provedor retornou uma página de erro HTML.",
  "errorMessages.providerNetwork":
    "Não foi possível acessar o provedor do modelo. Verifique sua conexão e tente novamente.",
  "errorMessages.providerRateLimit":
    "O provedor do modelo está limitando temporariamente este chat. Aguarde um momento e tente novamente.",
  "errorMessages.providerTransientRejection":
    "O provedor de IA recusou temporariamente esta solicitação. Isso costuma se resolver em menos de um minuto — tente novamente.",
  "errorMessages.startNewChat": "Iniciar novo chat",
  "errorMessages.addCreditsInBuilder": "Adicionar créditos no Builder",
  "feedback.inaccurate": "Impreciso",
  "feedback.keyboardHint": "{{shortcut}} Enter para enviar",
  "feedback.notHelpful": "Pouco útil",
  "feedback.placeholder": "Conte-nos o que deu errado...",
  "feedback.submit": "Enviar",
  "feedback.submitted": "Feedback enviado",
  "feedback.thumbsDown": "Não gostei",
  "feedback.thumbsUp": "Gostei",
  "feedback.tooSlow": "Muito lento",
  "feedback.whatWentWrong": "O que deu errado?",
  "feedback.wrongTool": "Ferramenta errada",
  "contextMeter.ariaLabel":
    "Contexto {{percent}}%, {{totalTokens}}{{breakdown}}. Abrir a análise de contexto.",
  "contextMeter.breakdown":
    " no total: {{systemTokens}} do sistema + {{conversationTokens}} da conversa",
  "contextMeter.summary": "Contexto {{percent}}% · {{totalTokens}}",
  "contextMeter.summaryBreakdown":
    " ({{systemTokens}} do sistema + {{conversationTokens}} da conversa)",
  "contextXray.advisory": "Informativo",
  "contextXray.conversation": "{{count}} conversa",
  "contextXray.currentStatus": "Status atual",
  "contextXray.estimated": "estimado",
  "contextXray.estimatedPrefix": " estimado",
  "contextXray.estimatedSuffix": " · estimado",
  "contextXray.evict": "Retirar",
  "contextXray.evicted": "{{count}} retirados",
  "contextXray.evictSegment": "Retirar segmento",
  "contextXray.framework": "Framework",
  "contextXray.free": "{{count}} livres",
  "contextXray.governance.inherited": "Herdado",
  "contextXray.governance.required": "Obrigatório",
  "contextXray.governance.user": "Seu contexto",
  "contextXray.groups.conversation": "Conversa",
  "contextXray.groups.evicted": "Retirados",
  "contextXray.groups.filesRead": "Arquivos lidos",
  "contextXray.groups.pinned": "Fixados",
  "contextXray.groups.taskInstructions": "Tarefa e instruções",
  "contextXray.groups.thinking": "Raciocínio",
  "contextXray.groups.toolResults": "Resultados das ferramentas",
  "contextXray.inspect": "Inspecione {{name}}",
  "contextXray.list": "Lista",
  "contextXray.loading": "Carregando contexto...",
  "contextXray.map": "Mapa",
  "contextXray.messageIndex": "índice de mensagens",
  "contextXray.noActiveSegments": "Nenhum segmento ativo",
  "contextXray.panelTitle": "Análise de contexto",
  "contextXray.partIndex": "índice de partes",
  "contextXray.pin": "Fixar",
  "contextXray.pinned": "{{count}} fixados",
  "contextXray.pinSegment": "Fixar segmento",
  "contextXray.protectedDescription":
    "Este segmento faz parte do turno ativo e ainda não pode ser retirado.",
  "contextXray.protectedDuringTurn": "Protegido durante o turno ativo",
  "contextXray.recordEvictionIntent": "Registrar intenção de retirada",
  "contextXray.restore": "Restaurar",
  "contextXray.restoreSegment": "Restaurar segmento",
  "contextXray.segment": "Segmento",
  "contextXray.showList": "Mostrar lista de contexto",
  "contextXray.showMap": "Mostrar mapa de contexto",
  "contextXray.status.active": "Ativo",
  "contextXray.status.evicted": "Retirado",
  "contextXray.status.pinned": "Fixado",
  "contextXray.status.protected": "Protegido",
  "contextXray.status.summarized": "Resumido",
  "contextXray.system": "{{count}} do sistema",
  "contextXray.systemOrdered": "Sistema · ordenado, não removível",
  "contextXray.tokens": "tokens",
  "contextXray.tokensShare": "tokens · {{share}}%",
  "contextXray.unpin": "Desafixar",
  "contextXray.unpinSegment": "Desafixar segmento",
  "share.add": "Adicionar",
  "share.addPeopleEmail": "Adicionar pessoas por e-mail",
  "share.addPeopleOrganization": "Adicionar pessoas da sua organização",
  "share.admin": "Administrador",
  "share.adminDescription": "Pode editar e gerenciar o acesso",
  "share.commenter": "Comentador",
  "share.commenterDescription": "Pode visualizar e adicionar comentários",
  "share.advanced": "Avançado",
  "share.advancedAccess": "Acesso avançado",
  "share.advancedDescription":
    "Controle como o acesso à organização aparece na pesquisa.",
  "share.copied": "Copiado",
  "share.copy": "Copiar",
  "share.shareWithAgents": "Compartilhar com agentes",
  "share.agentContext": "Link de contexto do agente",
  "share.agentContextDescription":
    "Contexto somente leitura para um agente externo.",
  "share.preparingAgentLink": "Preparando link do agente...",
  "share.agentLinkUnavailable": "Não foi possível criar o link do agente.",
  "share.retryAgentLink": "Tentar novamente",
  "share.editor": "Editor",
  "share.editorDescription": "Pode editar",
  "share.generalAccess": "Acesso geral",
  "share.hideInSearch": "Ocultar na pesquisa",
  "share.linkCanStillOpen": "Pessoas com o link ainda podem abrir isto.",
  "share.loading": "Carregando...",
  "share.loadMore": "Ver mais",
  "share.loadFailed":
    "Não foi possível carregar as configurações de compartilhamento.",
  "share.loadPeopleFailed": "Não foi possível carregar pessoas.",
  "share.noAccess": "Ninguém tem acesso ainda.",
  "share.noMatches": "Nenhuma correspondência.",
  "share.noPeopleFound": "Nenhuma pessoa encontrada.",
  "share.notifyPeople": "Notificar pessoas",
  "share.message": "Mensagem",
  "share.addMessage": "Adicionar uma mensagem",
  "share.hideMessage": "Ocultar mensagem",
  "share.messagePlaceholder": "Adicione uma nota curta (opcional)",
  "share.organization": "Organização",
  "share.organizationDescription":
    "Qualquer pessoa na sua organização pode visualizar",
  "share.owner": "Proprietário",
  "share.peopleWithAccess": "Pessoas com acesso",
  "share.private": "Privado",
  "share.privateDescription": "Somente pessoas com acesso podem visualizar",
  "share.public": "Público",
  "share.publicDescription": "Qualquer pessoa com o link pode visualizar",
  "share.remove": "Remover",
  "share.role": "Função",
  "share.searching": "Procurando...",
  "share.share": "Compartilhar",
  "share.shareLink": "Compartilhar link",
  "share.shareOptions": "Opções de compartilhamento",
  "share.titleWithResource": 'Compartilhar "{{title}}"',
  "share.titleWithType": "Compartilhar {{type}}",
  "share.triggerWithVisibility": "Compartilhar ({{visibility}})",
  "share.unknownPerson": "Pessoa desconhecida",
  "share.viewer": "Visualizador",
  "share.viewerDescription": "Pode visualizar",
  "share.userGroup": "Grupo de usuários",
  "settings.emailTitle": "E-mail",
  "settings.emailChange": "Alterar e-mail",
  "settings.emailChanging": "Enviando...",
  "settings.emailChangeSent":
    "Verifique seu e-mail para confirmar esta alteração.",
  "settings.emailChangeError": "Não foi possível enviar a confirmação.",
  "settings.emailNewLabel": "Novo e-mail",
  "settings.emailNewPlaceholder": "Digite o novo e-mail",
  "usage.builderCredits": "Créditos do Builder",
  "usage.inviteFriends": "Convide amigos",
  "usage.inviteCredits":
    "Ganhe {{amount}} créditos do Builder quando um amigo assinar.",
  "usage.copyInviteLink": "Copiar link de convite",
  "usage.inviteLinkCopied": "Link de convite copiado",
  "usage.creditBalance": "Saldo do workspace",
  "usage.monthlyPlan": "Plano mensal",
  "usage.dailyFreeLimit": "Limite diário gratuito",
  "usage.creditUsedOfLimit": "{{used}} de {{limit}} usados",
  "usage.creditRemaining": "{{amount}} restantes",
  "usage.creditUsageUnavailable":
    "Não foi possível carregar o uso de créditos do Builder.",
  "usage.estimatedBuilderCredits": "~{{amount}} créditos estimados",
  "usage.otherUsdSpend": "{{amount}} USD adicional",
  "usage.noBuilderCredits": "0 créditos do Builder",
  "usage.otherUnclassifiedSpend":
    "Gastos em USD adicionais ou não classificados",
  "usage.providerSpendDetail":
    "Uso do provedor ou chamadas antigas fora da cobrança do Builder",
  "usage.providerSpendToday":
    "Uso adicional ou não classificado hoje: {{amount}}",
  "usage.driverCreditsAndUsd": "Créditos do Builder / USD",
  "settings.usage.tabsLabel": "Visualizações de uso",
  "settings.usage.tabOverview": "Visão geral",
  "settings.usage.tabActivity": "Atividade",
  "settings.usage.rangeLabel": "Período",
  "settings.usage.range7": "Últimos 7 dias",
  "settings.usage.range30": "Últimos 30 dias",
  "settings.usage.range90": "Últimos 90 dias",
  "settings.usage.appFilterLabel": "App",
  "settings.usage.allApps": "Todos os apps",
  "settings.usage.unattributedApp": "Sem atribuição",
  "settings.usage.peopleFilterLabel": "Pessoas",
  "settings.usage.everyone": "Todos",
  "settings.usage.justYou": "Só você",
  "settings.usage.estimatedSpend": "Gasto estimado",
  "settings.usage.creditSpend": "Gasto em créditos do Builder.io",
  "settings.usage.yourEstimatedSpend": "Seu gasto estimado",
  "settings.usage.yourCreditSpend": "Seu gasto em créditos do Builder.io",
  "settings.usage.calls": "Chamadas",
  "settings.usage.tokens": "Tokens",
  "settings.usage.activePeople": "Pessoas ativas",
  "settings.usage.history": "Histórico de uso",
  "settings.usage.historyDimensionLabel": "Agrupar histórico de uso",
  "settings.usage.byFeature": "Por recurso",
  "settings.usage.byApp": "Por app",
  "settings.usage.byModel": "Por modelo",
  "settings.usage.bySurface": "Por superfície",
  "settings.usage.historyChartLabel": "Uso diário",
  "settings.usage.noUsage": "Nenhum uso neste período.",
  "settings.usage.total": "Total",
  "settings.usage.featureChat": "Chat",
  "settings.usage.featureSubAgents": "Subagentes",
  "settings.usage.featureAutomations": "Automações",
  "settings.usage.other": "Outros",
  "settings.usage.unknownModel": "Modelo desconhecido",
  "settings.usage.surfaceApp": "No app",
  "settings.usage.topChats": "Principais chats",
  "settings.usage.untitledChat": "Chat sem título",
  "settings.usage.titleUnavailable": "Não foi possível carregar o título",
  "settings.usage.showAll": "Mostrar tudo",
  "settings.usage.showLess": "Mostrar menos",
  "settings.usage.topPeople": "Principais pessoas",
  "settings.usage.you": "Você",
  "settings.usage.toolCalls": "Chamadas de ferramentas",
  "settings.usage.toolCallsChartLabel": "Chamadas de ferramentas por dia",
  "settings.usage.noToolCalls": "Nenhuma chamada de ferramenta neste período.",
  "settings.usage.toolCallsUnavailable":
    "Não foi possível carregar as chamadas de ferramentas.",
  "settings.usage.modelCalls": "Chamadas ao modelo",
  "settings.usage.modelCallsDimensionLabel": "Agrupar chamadas ao modelo",
  "settings.usage.modelCallsChartLabel": "Chamadas ao modelo por dia",
  "settings.usage.noModelCalls": "Nenhuma chamada ao modelo neste período.",
  "settings.usage.recentPrompts": "Prompts recentes",
  "settings.usage.promptNotCaptured": "Prompt não registrado",
  "settings.usage.promptUnavailable": "Não foi possível carregar o prompt",
  "settings.usage.loadError": "Não foi possível carregar o uso.",
  "settings.usage.yourAlerts": "Seus alertas",
  "settings.usage.alertsLoadError": "Não foi possível carregar os alertas.",
  "settings.usage.alertDailySpend": "Gasto diário",
  "settings.usage.alertMonthlySpend": "Gasto mensal",
  "settings.usage.alertDailyTokens": "Tokens diários",
  "settings.usage.alertMonthlyTokens": "Tokens mensais",
  "settings.usage.alertOnTrack": "Dentro do limite",
  "settings.usage.alertOverLimit": "Acima do limite",
  "settings.usage.alertDismissed": "Dispensado",
  "settings.usage.alertOff": "Desativado",
  "settings.usage.alertProgressDay": "{{current}} de {{limit}} hoje",
  "settings.usage.alertProgressMonth": "{{current}} de {{limit}} neste mês",
  "settings.usage.alertChannelsBoth": "No app e por e-mail",
  "settings.usage.alertChannelInApp": "No app",
  "settings.usage.alertChannelEmail": "E-mail",
  "settings.usage.alertDefault": "Padrão",
  "settings.usage.alertEdit": "Editar",
  "settings.usage.alertDialogTitle": "Alerta de {{name}}",
  "settings.usage.alertThreshold": "Me avisar ao atingir",
  "settings.usage.alertHintDayAll": "Por dia, em todos os apps.",
  "settings.usage.alertHintMonthAll": "Por mês, em todos os apps.",
  "settings.usage.alertHintDayApp": "Por dia, em {{app}}.",
  "settings.usage.alertHintMonthApp": "Por mês, em {{app}}.",
  "settings.usage.alertNotify": "Avisar por",
  "settings.usage.alertEnabled": "Alerta ativado",
  "settings.usage.alertReset": "Restaurar padrão",
  "settings.usage.alertInvalidLimit": "Informe um valor maior que zero.",
  "settings.usage.alertNoChannel": "Escolha pelo menos uma forma de aviso.",
  "settings.usage.alertSaveError": "Não foi possível salvar o alerta.",
  "settings.usage.unitUsd": "USD",
  "settings.usage.unitCredits": "créditos",
  "settings.usage.unitTokens": "tokens",
  "settings.usage.creditAmount_one": "{{amount}} crédito",
  "settings.usage.creditAmount_many": "{{amount}} créditos",
  "settings.usage.creditAmount_other": "{{amount}} créditos",
  "settings.usage.tokenAmount_one": "{{amount}} token",
  "settings.usage.tokenAmount_many": "{{amount}} tokens",
  "settings.usage.tokenAmount_other": "{{amount}} tokens",
  "settings.storage.provider": "Provedor",
  "settings.storage.providerOther": "Outro compatível com S3",
  "settings.storage.endpoint": "URL do endpoint",
  "settings.storage.bucket": "Bucket",
  "settings.storage.accessKeyId": "ID da chave de acesso",
  "settings.storage.secretAccessKey": "Chave de acesso secreta",
  "settings.storage.region": "Região",
  "settings.storage.publicUrl": "URL pública",
  "settings.storage.optional": "Opcional",
  "settings.storage.saved": "Salva",
  "settings.storage.hintAws": "Use o endpoint da região do seu bucket.",
  "settings.storage.hintR2":
    "Você encontra nas configurações do seu bucket do R2.",
  "settings.storage.hintSupabase":
    "Você encontra nas configurações de Storage do seu projeto.",
  "settings.storage.hintOther":
    "MinIO, Backblaze B2, Wasabi e DigitalOcean Spaces também funcionam.",
  "settings.storage.save": "Salvar",
  "settings.storage.saving": "Salvando…",
  "settings.storage.cancel": "Cancelar",
  "settings.storage.clear": "Limpar credenciais",
  "settings.storage.clearing": "Limpando…",
  "settings.storage.clearTitle": "Limpar credenciais de armazenamento?",
  "settings.storage.clearBuilder":
    "Novos envios vão para o armazenamento do Builder.io.",
  "settings.storage.clearNoFallback":
    "Os envios falham até você configurar o armazenamento de novo.",
  "settings.storage.clearExisting":
    "Os arquivos existentes ficam em {{bucket}}.",
  "settings.storage.clearExistingGeneric":
    "Os arquivos existentes ficam no seu bucket.",
  "settings.storage.invalidUrl":
    "Use uma URL que comece com https:// ou http://.",
  "settings.storage.invalidBucket":
    "Nomes de bucket usam letras, números, pontos, hifens e sublinhados.",
  "settings.storage.savedNotice":
    "Armazenamento de arquivos salvo. Novos envios vão para {{bucket}}.",
  "settings.storage.cleared": "Credenciais de armazenamento limpas.",
  "settings.storage.clearedBuilder":
    "Credenciais de armazenamento limpas. Novos envios vão para o Builder.io.",
  "settings.storage.saveFailed":
    "Não foi possível salvar o armazenamento de arquivos.",
  "settings.storage.clearFailed":
    "Não foi possível limpar as credenciais de armazenamento.",
  "settings.storage.loadFailed":
    "Não foi possível carregar as configurações de armazenamento de arquivos.",
  "settings.storage.retry": "Tentar novamente",
  "settings.storage.adminOnly":
    "Somente proprietários e administradores da organização podem alterar o armazenamento de arquivos.",
  "settings.audit.action": "Ação",
  "settings.audit.allApps": "Todos os apps",
  "settings.audit.app": "App",
  "settings.audit.changedBy": "Alterado por",
  "settings.audit.close": "Fechar",
  "settings.audit.empty": "Nenhuma alteração neste período.",
  "settings.audit.emptyDescription":
    "As alterações feitas por pessoas e pelo agente aparecem aqui.",
  "settings.audit.failed": "Falhou",
  "settings.audit.input": "Entrada",
  "settings.audit.inputLoadFailed": "Não foi possível carregar a entrada.",
  "settings.audit.last30Days": "Últimos 30 dias",
  "settings.audit.last7Days": "Últimos 7 dias",
  "settings.audit.last90Days": "Últimos 90 dias",
  "settings.audit.loadFailed": "Não foi possível carregar o log de auditoria.",
  "settings.audit.loading": "Carregando log de auditoria",
  "settings.audit.onBehalfOf": "Em nome de",
  "settings.audit.range": "Período",
  "settings.audit.refused": "Recusado",
  "settings.audit.result": "Resultado",
  "settings.audit.showMore": "Mostrar mais {{count}}",
  "settings.audit.succeeded": "Concluído",
  "settings.audit.system": "Sistema",
  "settings.audit.target": "Destino",
  "settings.audit.when": "Quando",
  "accountMenu.label": "Conta",
  "accountMenu.loading": "Carregando conta",
  "accountMenu.triggerLabel": "{{name}}, {{organization}}",
  "accountMenu.triggerLabelDemo":
    "{{name}}, {{organization}}, modo de demonstração",
  "accountMenu.personal": "Pessoal",
  "accountMenu.demoMode": "Modo de demonstração",
  "accountMenu.demoModeOn": "O modo de demonstração está ativado",
  "accountMenu.demoModeDescription":
    "E-mails exibidos e gráficos compatíveis são ajustados para apresentações. Sua conta e suas permissões não mudam.",
  "accountMenu.turnOffDemoMode": "Desativar o modo de demonstração",
  "accountMenu.invitations": "Convites",
  "accountMenu.joinYourTeam": "Entre na sua equipe",
  "accountMenu.join": "Entrar",
  "accountMenu.yourWorkspace": "Seu espaço de trabalho",
  "accountMenu.createOrganization": "Criar organização",
  "accountMenu.organizationName": "Nome da organização",
  "accountMenu.create": "Criar",
  "accountMenu.usage": "Uso",
  "accountMenu.getApps": "Obter apps e extensões",
  "accountMenu.back": "Voltar",
  "settingsOrg.general.organization": "Organização",
  "settingsOrg.general.name": "Nome",
  "settingsOrg.general.nameLocked":
    "Proprietários e administradores podem alterar o nome.",
  "settingsOrg.general.membership": "Associação",
  "settingsOrg.general.yourRole": "Sua função",
  "settingsOrg.general.deleteDescription":
    "Exclui permanentemente {{name}}, seus membros e seus dados.",
  "settingsOrg.members.removeTitle": "Remover {{name}}?",
  "settingsOrg.members.removeDescription":
    "A pessoa perde o acesso a {{org}}. O que pertence a ela passa para a pessoa que você escolher.",
  "settingsOrg.members.roleFor": "Função de {{name}}",
  "settingsOrg.members.moreActions": "Mais ações para {{name}}",
  "settingsOrg.members.removing": "Removendo…",
  "settingsOrg.members.groupsEmpty":
    "Agrupe membros para gerenciar o acesso aos apps em conjunto.",
  "settingsOrg.auth.signIn": "Login",
  "settingsOrg.auth.joining": "Entrada",
  "settingsOrg.auth.betweenApps": "Entre apps",
  "settingsOrg.auth.methodsEmailOnly": "E-mail e senha.",
  "settingsOrg.auth.methodsEmailAndOne": "E-mail e senha, e {{method}}.",
  "settingsOrg.auth.methodsEmailAndTwo":
    "E-mail e senha, {{first}} e {{second}}.",
  "settingsOrg.auth.emailPassword": "E-mail e senha",
  "settingsOrg.auth.emailPasswordNote": "Ativo em todas as implantações.",
  "settingsOrg.auth.methodConfigured":
    "Configurado no seu host com estas variáveis.",
  "settingsOrg.auth.methodNotConfigured":
    "Não configurado. Adicione estas variáveis no seu host e implante novamente.",
  "settingsOrg.auth.methodOn": "Ativado",
  "settingsOrg.auth.methodOff": "Desativado",
  "settingsOrg.auth.requireHint":
    "Para exigir um destes para todos em {{org}}, use Login da organização.",
  "settingsOrg.auth.view": "Ver",
  "settingsOrg.auth.close": "Fechar",
  "settingsOrg.apps.access": "Acesso",
  "settingsOrg.apps.browse": "Explorar apps",
  "settingsOrg.apps.defaults": "Padrões",
  "settingsOrg.search.domainAutoJoin":
    "Entrada automática por domínio de e-mail",
  "settingsOrg.search.roles": "Funções dos membros",
  "settingsOrg.learnMore": "Saiba mais",
  "settingsOrg.moreInformation": "Mais informações",
  "settingsOrg.general.workspaceUrl": "URL do espaço de trabalho",
  "settingsOrg.general.workspaceUrlDescription":
    "Envie os membros para este espaço de trabalho a partir de outra implantação.",
  "settingsOrg.general.workspaceUrlHelp":
    "Os membros que chegarem a outra implantação vão para este espaço de trabalho em vez de um app vazio.",
  "settingsOrg.general.editWorkspaceUrl": "Editar URL do espaço de trabalho",
  "settingsOrg.general.removeWorkspaceUrl": "Remover URL do espaço de trabalho",
  "settingsOrg.general.setWorkspaceUrl": "Definir URL",
  "settingsOrg.auth.domainDescription":
    "Adicione automaticamente pessoas com um e-mail @{{domain}}.",
  "settingsOrg.auth.domainDescriptionNoDomain":
    "Adicione automaticamente pessoas com o domínio do seu e-mail de trabalho.",
  "settingsOrg.auth.domainHelp":
    "Quem se cadastrar com um e-mail deste domínio entra na organização. Só é possível usar o seu próprio domínio de e-mail, e provedores de e-mail gratuitos não são permitidos.",
  "settingsOrg.auth.editDomain": "Editar domínio",
  "settingsOrg.auth.removeDomain": "Remover domínio",
  "settingsOrg.auth.sharedSecret": "Segredo compartilhado",
  "settingsOrg.auth.sharedSecretSet":
    "Definido. Permite que os apps deste espaço de trabalho verifiquem uns aos outros.",
  "settingsOrg.auth.sharedSecretNotSet":
    "Não definido. Permite que os apps deste espaço de trabalho verifiquem uns aos outros.",
  "settingsOrg.auth.secretNotSetValue": "Não definido",
  "settingsOrg.auth.manage": "Gerenciar",
  "settingsOrg.auth.reveal": "Mostrar",
  "settingsOrg.auth.hide": "Ocultar",
  "settingsOrg.auth.regenerate": "Gerar novamente",
  "settingsOrg.auth.syncToApps": "Sincronizar com os apps",
  "settingsOrg.auth.pasteSecret": "Colar segredo",
  "settingsOrg.auth.pasteSecretLabel": "Cole um segredo compartilhado",
  "settingsOrg.auth.syncing": "Sincronizando com os apps…",
  "settingsOrg.auth.syncErrorStatus": "HTTP {{status}}",
  "settingsOrg.invite.emails": "Endereços de e-mail",
  "settingsOrg.invite.emailPlaceholder": "nome@empresa.com.br",
  "settingsOrg.invite.note":
    "Cada pessoa entra com este e-mail exato para aceitar.",
  "settingsOrg.invite.noteNoEmail":
    "Os convites não serão enviados por e-mail, então peça para cada pessoa entrar com este e-mail exato.",
  "settingsOrg.invite.role": "Função",
  "settingsOrg.invite.member": "Membro",
  "settingsOrg.invite.admin": "Administrador",
  "settingsOrg.invite.ownerOnlyAdmin":
    "Somente o proprietário da organização pode convidar administradores.",
  "settingsOrg.invite.removeRow": "Remover",
  "settingsOrg.invite.addAnother": "Adicionar outro",
  "settingsOrg.invite.pasteMany": "Colar vários",
  "settingsOrg.invite.importCsv": "Importar CSV",
  "settingsOrg.invite.pasteLabel":
    "Cole e-mails separados por vírgulas, espaços ou quebras de linha.",
  "settingsOrg.invite.addAsMembers": "Adicionar como membros",
  "settingsOrg.invite.addAsAdmins": "Adicionar como administradores",
  "settingsOrg.invite.add": "Adicionar",
  "settingsOrg.invite.send": "Enviar convites",
  "settingsOrg.invite.sending": "Enviando…",
  "settingsOrg.invite.csvNoEmails":
    "Nenhum e-mail válido encontrado neste CSV.",
  "settingsOrg.auth.synced_one": "Sincronizado com {{count}} app.",
  "settingsOrg.auth.synced_many": "Sincronizado com {{count}} apps.",
  "settingsOrg.auth.synced_other": "Sincronizado com {{count}} apps.",
  "settingsOrg.auth.syncedPartial_one":
    "Sincronizado com {{succeeded}} de {{count}} app. {{failed}} com falha.",
  "settingsOrg.auth.syncedPartial_many":
    "Sincronizado com {{succeeded}} de {{count}} apps. {{failed}} com falha.",
  "settingsOrg.auth.syncedPartial_other":
    "Sincronizado com {{succeeded}} de {{count}} apps. {{failed}} com falha.",
  "settingsOrg.invite.sent_one": "{{count}} convite enviado.",
  "settingsOrg.invite.sent_many": "{{count}} convites enviados.",
  "settingsOrg.invite.sent_other": "{{count}} convites enviados.",
  "settingsOrg.invite.saved_one":
    "{{count}} convite salvo. A pessoa vai vê-lo ao entrar.",
  "settingsOrg.invite.saved_many":
    "{{count}} convites salvos. As pessoas vão vê-los ao entrar.",
  "settingsOrg.invite.saved_other":
    "{{count}} convites salvos. As pessoas vão vê-los ao entrar.",
  "settingsShell.account.addPassword": "Adicionar senha",
  "settingsShell.account.authenticatorCode": "Código do autenticador",
  "settingsShell.account.change": "Alterar",
  "settingsShell.account.changeEmail": "Alterar e-mail",
  "settingsShell.account.changePassword": "Alterar senha",
  "settingsShell.account.confirmPassword": "Confirmar nova senha",
  "settingsShell.account.currentPassword": "Senha atual",
  "settingsShell.account.deletionDialogDescription":
    "Isso envia uma solicitação de exclusão a um administrador. Seus dados permanecem até que ele a analise.",
  "settingsShell.account.done": "Concluído",
  "settingsShell.account.email": "E-mail",
  "settingsShell.account.emailChangeError":
    "Não foi possível enviar a confirmação.",
  "settingsShell.account.emailChangeSent":
    "Confira seu e-mail para ver como confirmar esta alteração.",
  "settingsShell.account.languageAndRegion": "Idioma e região",
  "settingsShell.account.languageDescription":
    "Vale para todos os seus dispositivos.",
  "settingsShell.account.manage": "Gerenciar",
  "settingsShell.account.name": "Nome",
  "settingsShell.account.nameDescription":
    "Usado para se referir a você nos apps Agent-Native.",
  "settingsShell.account.namePlaceholder": "Seu nome",
  "settingsShell.account.nameSaveError": "Não foi possível atualizar seu nome.",
  "settingsShell.account.nameSaved": "Nome atualizado",
  "settingsShell.account.newEmail": "Novo e-mail",
  "settingsShell.account.newPassword": "Nova senha",
  "settingsShell.account.password": "Senha",
  "settingsShell.account.passwordDescription":
    "Adicione uma senha para ter outra forma de entrar na sua conta.",
  "settingsShell.account.passwordLoadError":
    "Não foi possível carregar seus métodos de login.",
  "settingsShell.account.passwordMinLength":
    "Escolha uma senha com pelo menos {{count}} caracteres.",
  "settingsShell.account.passwordMismatch": "As senhas não coincidem.",
  "settingsShell.account.passwordSaveError":
    "Não foi possível atualizar a senha.",
  "settingsShell.account.passwordSaved": "Senha atualizada",
  "settingsShell.account.photoError": "Não foi possível atualizar a foto.",
  "settingsShell.account.photoUpdated": "Foto atualizada",
  "settingsShell.account.profilePhoto": "Foto do perfil",
  "settingsShell.account.requestCopyDescription":
    "Um administrador verifica sua identidade e dá retorno.",
  "settingsShell.account.requestCopyLabel":
    "Solicitar uma cópia dos seus dados",
  "settingsShell.account.requestDeletionDescription":
    "Seus dados permanecem até que um administrador conclua a solicitação.",
  "settingsShell.account.requestDeletionLabel": "Solicitar exclusão dos dados",
  "settingsShell.account.savePassword": "Salvar senha",
  "settingsShell.account.sendConfirmation": "Enviar confirmação",
  "settingsShell.account.sending": "Enviando...",
  "settingsShell.account.setUpTwoFactor": "Configurar dois fatores",
  "settingsShell.account.settingUp": "Configurando...",
  "settingsShell.account.signIn": "Login",
  "settingsShell.account.timezone": "Fuso horário",
  "settingsShell.account.timezoneDescription":
    "Usado para carimbos de data e hora e automações agendadas.",
  "settingsShell.account.turnOffTwoFactor": "Desativar dois fatores",
  "settingsShell.account.turningOff": "Desativando...",
  "settingsShell.account.twoFactor": "Autenticação de dois fatores",
  "settingsShell.account.twoFactorBackupCodes":
    "Guarde estes códigos de backup em um lugar seguro. Cada um pode ser usado uma vez se você perder o acesso ao seu autenticador.",
  "settingsShell.account.twoFactorCodeError":
    "Digite o código de seis dígitos do seu app autenticador.",
  "settingsShell.account.twoFactorDescription":
    "Use um app autenticador para adicionar uma segunda etapa de login à sua conta.",
  "settingsShell.account.twoFactorDisableError":
    "Não foi possível desativar a autenticação de dois fatores.",
  "settingsShell.account.twoFactorEnabled":
    "A autenticação de dois fatores está ativada.",
  "settingsShell.account.twoFactorLoadError":
    "Não foi possível carregar as configurações de dois fatores.",
  "settingsShell.account.twoFactorQrLabel":
    "Código QR de configuração de dois fatores",
  "settingsShell.account.twoFactorSaved":
    "Autenticação de dois fatores ativada",
  "settingsShell.account.twoFactorScan":
    "Escaneie este código QR com seu app autenticador e digite o código exibido.",
  "settingsShell.account.twoFactorSetupError":
    "Não foi possível atualizar as configurações de dois fatores.",
  "settingsShell.account.twoFactorSetupTitle":
    "Configurar a autenticação de dois fatores",
  "settingsShell.account.uploading": "Enviando...",
  "settingsShell.account.verifyAndEnable": "Verificar e ativar",
  "settingsShell.account.verifying": "Verificando...",
  "settingsShell.account.voiceBatch": "Em lote",
  "settingsShell.account.voiceDescription":
    "Escolha como a entrada de voz é transcrita.",
  "settingsShell.account.voiceGoogleRealtime": "Google em tempo real",
  "settingsShell.account.voiceInput": "Entrada de voz",
  "settingsShell.account.voiceLoadError":
    "Não foi possível carregar sua configuração de transcrição de voz.",
  "settingsShell.account.voiceMacNative": "Nativo do Mac",
  "settingsShell.account.voiceSaveError":
    "Não foi possível salvar sua configuração de transcrição de voz.",
  "settingsShell.account.yourData": "Seus dados",
  "settingsShell.appFallbackName": "Aplicativo",
  "settingsShell.appGroup.adminOnly":
    "Somente proprietários e administradores podem alterar isso",
  "settingsShell.appGroup.automationsCreateTitle":
    "O que deve acontecer, e quando?",
  "settingsShell.appGroup.defaultModel": "Modelo padrão",
  "settingsShell.appGroup.defaultModelDescription":
    "Usado em novos chats com o agente em {{app}}. O padrão é {{model}}.",
  "settingsShell.appGroup.defaultModelDescriptionUnset":
    "Usado em novos chats com o agente em {{app}}.",
  "settingsShell.appGroup.defaultModelLoadError":
    "Não foi possível carregar o modelo padrão.",
  "settingsShell.appGroup.defaultModelSaveError":
    "Não foi possível salvar o modelo padrão. Tente novamente.",
  "settingsShell.appGroup.demoMode": "Modo de demonstração",
  "settingsShell.appGroup.demoModeDescription":
    "Use dados de exemplo neste navegador para apresentações.",
  "settingsShell.appGroup.labsFootnote":
    "Esses recursos novos e instáveis podem ter bugs.",
  "settingsShell.appGroup.labsLoadError":
    "Não foi possível carregar seus Labs.",
  "settingsShell.appGroup.labsSaveError":
    "Não foi possível alterar {{lab}}. Tente novamente.",
  "settingsShell.appGroup.mcpAbout":
    "Conecte {{app}} ao Claude, ao ChatGPT, ao Cursor ou a qualquer app de IA compatível com MCP. Esse app poderá trabalhar em {{app}} por você. Ele só vê o que você pode ver.",
  "settingsShell.appGroup.mcpFootnote":
    "Para as ferramentas que o próprio agente usa, consulte {{integrations}}.",
  "settingsShell.appGroup.newAutomation": "Nova automação",
  "settingsShell.appGroup.retry": "Tentar novamente",
  "settingsShell.appGroup.thisBrowser": "Este navegador",
  "settingsShell.appGroup.useDefault": "Usar o padrão",
  "settingsShell.appGroup.whatsNewChip":
    "Atualizações de {{app}}. Cada app tem seu próprio registro de alterações.",
  "settingsShell.appGroup.whatsNewEmpty": "Ainda não há atualizações.",
  "settingsShell.appGroup.whatsNewShowFewer": "Mostrar menos atualizações",
  "settingsShell.appGroup.whatsNewViewAll": "Ver todas as atualizações",
  "settingsShell.backToApp": "Voltar para {{app}}",
  "settingsShell.breadcrumbLabel": "Trilha de navegação",
  "settingsShell.builder.connect": "Conectar",
  "settingsShell.builder.connected": "Conectado",
  "settingsShell.builder.connectedTo": "Conectado · {{space}}",
  "settingsShell.builder.connection": "Conexão",
  "settingsShell.builder.disconnect": "Desconectar",
  "settingsShell.builder.disconnecting": "Desconectando…",
  "settingsShell.builder.disconnectBody":
    "Isso afeta todas as pessoas de {{org}} que não conectaram a própria conta.",
  "settingsShell.builder.disconnectFailed":
    "Não foi possível desconectar o Builder.io.",
  "settingsShell.builder.disconnectTitle": "Desconectar o Builder.io?",
  "settingsShell.builder.grantsFailed":
    "Não foi possível ler as conexões do Builder.io.",
  "settingsShell.builder.loss.defaultStops":
    "Os chats param até você adicionar um provedor da organização.",
  "settingsShell.builder.loss.defaultSwitches":
    "O modelo padrão muda para {{next}}.",
  "settingsShell.builder.loss.modelPicker":
    "Os modelos do Builder.io saem do seletor de modelos.",
  "settingsShell.builder.loss.serviceStops":
    "Para até que outro provedor seja configurado.",
  "settingsShell.builder.loss.stops": "Para de funcionar.",
  "settingsShell.builder.loss.uploadsFail":
    "Os envios falham até você configurar o armazenamento.",
  "settingsShell.builder.manage": "Gerenciar",
  "settingsShell.builder.needsReconnect": "Precisa ser reconectado.",
  "settingsShell.builder.orgFallback": "sua organização",
  "settingsShell.builder.orgNotConnectedAdmin":
    "Não conectado. Quando você conectar, todas as pessoas de {{org}} poderão usar.",
  "settingsShell.builder.orgNotConnectedMember":
    "Não conectado. Um proprietário ou administrador pode conectar.",
  "settingsShell.builder.organization": "Organização",
  "settingsShell.builder.personal": "Pessoal",
  "settingsShell.builder.personalConnected": "Conectado. Só você usa.",
  "settingsShell.builder.personalConnectedOverOrg":
    "Conectado. Só você usa, em vez da conexão da organização.",
  "settingsShell.builder.personalConnectedTo":
    "Conectado · {{space}}. Só você usa.",
  "settingsShell.builder.personalConnectedToOverOrg":
    "Conectado · {{space}}. Só você usa, em vez da conexão da organização.",
  "settingsShell.builder.personalNotConnected":
    "Conecte sua própria conta. Só você usa.",
  "settingsShell.builder.personalRestricted":
    "Proprietários e administradores restringiram as chaves de API pessoais.",
  "settingsShell.builder.personalRestrictedUnused":
    "Não é usado enquanto as chaves de API pessoais estiverem restritas.",
  "settingsShell.builder.reconnect": "Reconectar",
  "settingsShell.builder.retry": "Tentar novamente",
  "settingsShell.builder.use.aiModel": "Modelo de IA",
  "settingsShell.builder.use.aiModelDefaultNote": "O modelo padrão, {{model}}.",
  "settingsShell.builder.use.aiModelNote":
    "Os modelos do Builder.io estão no seletor de modelos.",
  "settingsShell.builder.use.backgroundAgentsNote":
    "Faz alterações de código a partir da produção.",
  "settingsShell.builder.use.browserAutomationNote":
    "Permite que o agente use um navegador em produção.",
  "settingsShell.builder.use.designSystem": "Inteligência do design system",
  "settingsShell.builder.use.designSystemNote":
    "Mantém os slides e designs gerados alinhados à marca.",
  "settingsShell.builder.use.embeddings": "Embeddings",
  "settingsShell.builder.use.embeddingsNote": "Busca no Brain.",
  "settingsShell.builder.use.fileStorageNote":
    "Novos envios são armazenados no Builder.io.",
  "settingsShell.builder.use.images": "Geração de imagens",
  "settingsShell.builder.use.imagesNote": "Slides e Design.",
  "settingsShell.builder.use.voice": "Entrada de voz",
  "settingsShell.builder.use.voiceNote": "Ditado em todos os apps.",
  "settingsShell.builder.usedFor": "Usado para",
  "settingsShell.builder.usedForFootnote":
    "Escolha o que roda no Builder.io em {{link}}.",
  "settingsShell.builder.usedForLoadFailed":
    "Não foi possível verificar quais serviços rodam no Builder.io.",
  "settingsShell.builder.whatHappens": "O que acontece",
  "settingsShell.channels.about.discord":
    "Execute o agente com comandos de barra do Discord.",
  "settingsShell.channels.about.email":
    "Envie um e-mail ao agente, e ele responde na mesma conversa.",
  "settingsShell.channels.about.googleDocs":
    "Marque o agente em comentários do Google Docs para receber respostas.",
  "settingsShell.channels.about.microsoftTeams":
    "Mencione o agente no Microsoft Teams, e ele responde nessa conversa.",
  "settingsShell.channels.about.page":
    "Onde as pessoas podem enviar mensagens ao agente do {{app}}. O agente de cada app é configurado separadamente.",
  "settingsShell.channels.about.slack":
    "Mencione o agente com @ em uma thread ou mande uma mensagem direta, e ele responde nessa thread.",
  "settingsShell.channels.about.telegram":
    "Converse com seu agente por um bot do Telegram.",
  "settingsShell.channels.about.whatsapp":
    "Conecte seu agente ao WhatsApp Business.",
  "settingsShell.channels.action.manage": "Gerenciar",
  "settingsShell.channels.action.manageAria": "Gerenciar {{platform}}",
  "settingsShell.channels.action.setUp": "Configurar",
  "settingsShell.channels.action.setUpAria": "Configurar {{platform}}",
  "settingsShell.channels.action.view": "Ver",
  "settingsShell.channels.action.viewAria": "Ver {{platform}}",
  "settingsShell.channels.agentIn": "Agente no {{platform}}",
  "settingsShell.channels.connection": "Conexão",
  "settingsShell.channels.copyServiceAccountEmail":
    "Copiar e-mail da conta de serviço",
  "settingsShell.channels.copyWebhookUrl": "Copiar URL do webhook",
  "settingsShell.channels.credentials": "Credenciais",
  "settingsShell.channels.developerSite": "Site para desenvolvedores",
  "settingsShell.channels.documentation": "Documentação",
  "settingsShell.channels.empty": "Nenhum canal está disponível no {{app}}.",
  "settingsShell.channels.information": "Informações",
  "settingsShell.channels.loadFailed": "Não foi possível carregar os canais.",
  "settingsShell.channels.membersFootnote":
    "Apenas proprietários e admins podem configurar canais.",
  "settingsShell.channels.notFound":
    "Este canal não está disponível no {{app}}.",
  "settingsShell.channels.open": "Abrir",
  "settingsShell.channels.openDocs": "Abrir documentação",
  "settingsShell.channels.registerWebhook": "Registrar",
  "settingsShell.channels.removeCredentials.action": "Remover",
  "settingsShell.channels.removeCredentials.aria":
    "Remover as credenciais do {{platform}}",
  "settingsShell.channels.removeCredentials.body":
    "O agente para de responder no {{platform}} para todos, a menos que o ambiente de implantação também defina essas chaves.",
  "settingsShell.channels.removeCredentials.confirm": "Remover",
  "settingsShell.channels.removeCredentials.failed":
    "Não foi possível remover as credenciais.",
  "settingsShell.channels.removeCredentials.removing": "Removendo…",
  "settingsShell.channels.removeCredentials.title":
    "Remover as credenciais do {{platform}}?",
  "settingsShell.channels.retry": "Tentar novamente",
  "settingsShell.channels.setup.addToEnvironment":
    "Adicione ao ambiente de implantação",
  "settingsShell.channels.setup.body":
    "Adicione estes valores a esta implantação e depois ative.",
  "settingsShell.channels.setup.close": "Fechar",
  "settingsShell.channels.setup.failed":
    "Não foi possível salvar as variáveis.",
  "settingsShell.channels.setup.optional": "Opcional",
  "settingsShell.channels.setup.replace": "Substituir",
  "settingsShell.channels.setup.replaceAria": "Substituir {{key}}",
  "settingsShell.channels.setup.save": "Salvar",
  "settingsShell.channels.setup.saveAndTurnOn": "Salvar e ativar",
  "settingsShell.channels.setup.saving": "Salvando…",
  "settingsShell.channels.setup.saved": "Salva",
  "settingsShell.channels.setup.savedElsewhere": "Salva fora de Canais",
  "settingsShell.channels.setup.setInEnvironment":
    "Definida no ambiente da implantação",
  "settingsShell.channels.setup.stillMissing":
    "Ainda faltam algumas variáveis obrigatórias.",
  "settingsShell.channels.setup.title": "Configurar {{platform}}",
  "settingsShell.channels.shareDocumentsWith": "Compartilhe os documentos com",
  "settingsShell.channels.state.notSetUp": "Não configurado",
  "settingsShell.channels.state.off": "Desativado",
  "settingsShell.channels.state.on": "Ativado",
  "settingsShell.channels.status": "Status",
  "settingsShell.channels.toggleFailed":
    "Não foi possível atualizar o {{platform}}.",
  "settingsShell.channels.turnOnAria": "Ativar {{platform}}",
  "settingsShell.channels.unavailable":
    "{{platform}} não está disponível no {{app}}.",
  "settingsShell.channels.webhookLocalOnly":
    "O {{platform}} não consegue acessar este endereço. Abra esta página pelo endereço HTTPS público do app para obter uma URL de webhook.",
  "settingsShell.channels.webhookRegistered": "Registrado",
  "settingsShell.channels.webhookRegistration": "Webhook",
  "settingsShell.channels.webhookUrl": "URL do webhook",
  "settingsShell.channels.category": "Categoria",
  "settingsShell.channels.developer": "Desenvolvedor",
  "settingsShell.channels.mentionAgent": "Mencionar o agente",
  "settingsShell.channels.rowDescription": "{{about}} {{state}}.",
  "settingsShell.channels.separately":
    "O agente de cada app é configurado separadamente.",
  "settingsShell.channels.setUpLocked":
    "Apenas proprietários e admins podem configurar isso",
  "settingsShell.integrationDetail.access.none":
    "É um servidor público, então não há nada em que entrar.",
  "settingsShell.integrationDetail.access.oauth":
    "O agente age com suas permissões do {{name}}, então só vê o que você pode ver.",
  "settingsShell.integrationDetail.access.token":
    "O agente usa o token de acesso que você adicionar, então vê o que esse token pode ver.",
  "settingsShell.integrationDetail.accessToken": "Token de acesso",
  "settingsShell.integrationDetail.addAccessToken": "Adicionar token de acesso",
  "settingsShell.integrationDetail.callout.adminNeeded":
    "Um admin precisa configurar isso",
  "settingsShell.integrationDetail.callout.adminNeededBody":
    "Peça a um proprietário ou admin de {{org}} para adicionar o ID do cliente e o segredo do {{name}}. Depois você pode conectar sua própria conta.",
  "settingsShell.integrationDetail.callout.beforeAnyone":
    "Antes que alguém possa se conectar",
  "settingsShell.integrationDetail.callout.beforeYouConnect":
    "Antes de se conectar",
  "settingsShell.integrationDetail.callout.token":
    "Conecta com um token de acesso",
  "settingsShell.integrationDetail.callout.unavailable": "Ainda não disponível",
  "settingsShell.integrationDetail.category": "Categoria",
  "settingsShell.integrationDetail.connected": "{{name}} conectado",
  "settingsShell.integrationDetail.copyServerUrl": "Copiar URL do servidor",
  "settingsShell.integrationDetail.developer": "Desenvolvedor",
  "settingsShell.integrationDetail.howToCreateToken": "Como criar um token",
  "settingsShell.integrationDetail.justMe": "Só eu",
  "settingsShell.integrationDetail.notFound":
    "Esta integração não está no catálogo.",
  "settingsShell.integrationDetail.notFoundTitle": "Não encontrado",
  "settingsShell.integrationDetail.prompt.amplitude.1":
    "Como os usuários ativos semanais evoluíram este mês?",
  "settingsShell.integrationDetail.prompt.amplitude.2":
    "Monte um funil do cadastro até a primeira gravação",
  "settingsShell.integrationDetail.prompt.amplitude.3":
    "Quais coortes têm a melhor retenção?",
  "settingsShell.integrationDetail.prompt.apollo.1":
    "Encontre líderes de design em startups série B",
  "settingsShell.integrationDetail.prompt.apollo.2":
    "Enriqueça esta lista de e-mails",
  "settingsShell.integrationDetail.prompt.apollo.3":
    "Adicione estes contatos à sequência do quarto trimestre",
  "settingsShell.integrationDetail.prompt.asana.1":
    "O que vence para mim esta semana?",
  "settingsShell.integrationDetail.prompt.asana.2":
    "Crie tarefas a partir dos itens de ação desta gravação",
  "settingsShell.integrationDetail.prompt.asana.3":
    "Quais projetos estão atrasados?",
  "settingsShell.integrationDetail.prompt.atlassian.1":
    "Crie um ticket no Jira com os itens de ação desta gravação",
  "settingsShell.integrationDetail.prompt.atlassian.2":
    "O que está bloqueando o lançamento do quarto trimestre?",
  "settingsShell.integrationDetail.prompt.atlassian.3":
    "Encontre a página do Confluence sobre onboarding",
  "settingsShell.integrationDetail.prompt.box.1":
    "Encontre o contrato assinado da Acme",
  "settingsShell.integrationDetail.prompt.box.2":
    "Compartilhe a pasta do relatório do terceiro trimestre com o financeiro",
  "settingsShell.integrationDetail.prompt.box.3":
    "O que mudou na pasta jurídica esta semana?",
  "settingsShell.integrationDetail.prompt.canva.1":
    "Crie um post para redes sociais com os destaques desta gravação",
  "settingsShell.integrationDetail.prompt.canva.2":
    "Encontre as cores do nosso brand kit",
  "settingsShell.integrationDetail.prompt.canva.3":
    "Exporte a apresentação mais recente como PDF",
  "settingsShell.integrationDetail.prompt.cloudflare.1":
    "Quais registros DNS apontam para {{host}}?",
  "settingsShell.integrationDetail.prompt.cloudflare.2":
    "Mostre os erros de Worker da última hora",
  "settingsShell.integrationDetail.prompt.cloudflare.3":
    "Limpe o cache desta URL",
  "settingsShell.integrationDetail.prompt.commonRoom.1":
    "Quais empresas estão mostrando sinais de compra?",
  "settingsShell.integrationDetail.prompt.commonRoom.2":
    "Quem da Acme está ativo na nossa comunidade?",
  "settingsShell.integrationDetail.prompt.commonRoom.3":
    "Resuma a atividade das nossas principais contas",
  "settingsShell.integrationDetail.prompt.context7.1":
    "Mostre a documentação atual do React Router sobre loaders",
  "settingsShell.integrationDetail.prompt.context7.2":
    "Como configuro migrações do Drizzle?",
  "settingsShell.integrationDetail.prompt.context7.3":
    "O que há de novo na versão mais recente do Tailwind?",
  "settingsShell.integrationDetail.prompt.exa.1":
    "Encontre artigos recentes sobre apps agent-native",
  "settingsShell.integrationDetail.prompt.exa.2":
    "Pesquise concorrentes do {{app}}",
  "settingsShell.integrationDetail.prompt.exa.3": "Busque e resuma esta página",
  "settingsShell.integrationDetail.prompt.figma.1":
    "Resuma os componentes deste arquivo do Figma",
  "settingsShell.integrationDetail.prompt.figma.2":
    "Liste as variáveis de cor do nosso design system",
  "settingsShell.integrationDetail.prompt.figma.3":
    "Descreva o layout deste frame",
  "settingsShell.integrationDetail.prompt.fullstory.1":
    "Mostre sessões em que as pessoas clicaram com raiva em Compartilhar",
  "settingsShell.integrationDetail.prompt.fullstory.2":
    "Resuma os pontos de atrito na página de preços",
  "settingsShell.integrationDetail.prompt.fullstory.3":
    "Onde as pessoas desistem no onboarding?",
  "settingsShell.integrationDetail.prompt.github.1":
    "Resuma os pull requests que aguardam minha revisão",
  "settingsShell.integrationDetail.prompt.github.2":
    "Encontre issues sobre prévias de links do Slack no agent-native",
  "settingsShell.integrationDetail.prompt.github.3":
    "O que mudou em packages/core esta semana?",
  "settingsShell.integrationDetail.prompt.gitlab.1":
    "Quais merge requests falharam na CI hoje?",
  "settingsShell.integrationDetail.prompt.gitlab.2":
    "Resuma as issues abertas com o rótulo bug",
  "settingsShell.integrationDetail.prompt.gitlab.3":
    "Quais pipelines foram os mais lentos esta semana?",
  "settingsShell.integrationDetail.prompt.gong.1":
    "Resuma minha última ligação com a Acme",
  "settingsShell.integrationDetail.prompt.gong.2":
    "Quais objeções surgiram este mês?",
  "settingsShell.integrationDetail.prompt.gong.3":
    "Quais deals mencionam preocupações com preço?",
  "settingsShell.integrationDetail.prompt.googleDocs.1":
    "@agent resuma os comentários deste documento",
  "settingsShell.integrationDetail.prompt.googleDocs.2":
    "@agent escreva um rascunho de resposta a este comentário",
  "settingsShell.integrationDetail.prompt.googleDocs.3":
    "@agent transforme estas notas em um checklist",
  "settingsShell.integrationDetail.prompt.grafana.1":
    "Mostre em gráfico a latência p95 da API no último dia",
  "settingsShell.integrationDetail.prompt.grafana.2":
    "Encontre logs de erro por volta das 14h",
  "settingsShell.integrationDetail.prompt.grafana.3":
    "Quais alertas dispararam esta semana?",
  "settingsShell.integrationDetail.prompt.granola.1":
    "O que decidimos na revisão de design de ontem?",
  "settingsShell.integrationDetail.prompt.granola.2":
    "Liste meus itens de ação em aberto das reuniões",
  "settingsShell.integrationDetail.prompt.granola.3":
    "Resuma minhas ligações com a Acme",
  "settingsShell.integrationDetail.prompt.hubspot.1":
    "Mova o deal da Acme para Closed won",
  "settingsShell.integrationDetail.prompt.hubspot.2":
    "Quais deals estão parados na negociação?",
  "settingsShell.integrationDetail.prompt.hubspot.3":
    "Registre esta ligação como nota no contato",
  "settingsShell.integrationDetail.prompt.intercom.1":
    "Resuma as conversas abertas de hoje",
  "settingsShell.integrationDetail.prompt.intercom.2":
    "Encontre artigos de ajuda sobre SSO",
  "settingsShell.integrationDetail.prompt.intercom.3":
    "O que os clientes mais perguntaram esta semana?",
  "settingsShell.integrationDetail.prompt.linear.1":
    "Crie uma issue para a prévia quebrada do Slack e atribua a mim",
  "settingsShell.integrationDetail.prompt.linear.2":
    "O que falta no ciclo atual?",
  "settingsShell.integrationDetail.prompt.linear.3":
    "Resuma os bugs relatados esta semana",
  "settingsShell.integrationDetail.prompt.monday.1":
    "O que está no quadro de design neste sprint?",
  "settingsShell.integrationDetail.prompt.monday.2": "Mova este item para Done",
  "settingsShell.integrationDetail.prompt.monday.3":
    "Quais itens estão atrasados?",
  "settingsShell.integrationDetail.prompt.neon.1":
    "Crie um branch da produção para testes",
  "settingsShell.integrationDetail.prompt.neon.2":
    "Mostre as consultas mais lentas desta semana",
  "settingsShell.integrationDetail.prompt.neon.3":
    "Qual o tamanho do banco de dados principal?",
  "settingsShell.integrationDetail.prompt.netlify.1":
    "Por que o último deploy falhou?",
  "settingsShell.integrationDetail.prompt.netlify.2":
    "Quais sites tiveram builds com falha esta semana?",
  "settingsShell.integrationDetail.prompt.netlify.3":
    "Volte para o deploy de produção anterior",
  "settingsShell.integrationDetail.prompt.notion.1":
    "Encontre nosso checklist de onboarding",
  "settingsShell.integrationDetail.prompt.notion.2":
    "Resuma as notas de reunião desta semana",
  "settingsShell.integrationDetail.prompt.notion.3":
    "Adicione estes itens de ação à wiki do time",
  "settingsShell.integrationDetail.prompt.paypal.1":
    "Liste as faturas vencidas",
  "settingsShell.integrationDetail.prompt.paypal.2":
    "Resuma as transações deste mês",
  "settingsShell.integrationDetail.prompt.paypal.3":
    "Crie uma fatura para a Acme",
  "settingsShell.integrationDetail.prompt.pylon.1":
    "Quais contas têm issues urgentes em aberto?",
  "settingsShell.integrationDetail.prompt.pylon.2":
    "Resuma o ticket mais recente da Acme",
  "settingsShell.integrationDetail.prompt.pylon.3":
    "Escreva um rascunho de resposta para esta issue",
  "settingsShell.integrationDetail.prompt.semgrep.1":
    "Analise packages/core em busca de problemas de segurança",
  "settingsShell.integrationDetail.prompt.semgrep.2":
    "Explique este achado e como corrigi-lo",
  "settingsShell.integrationDetail.prompt.semgrep.3":
    "Há segredos fixos no código deste repositório?",
  "settingsShell.integrationDetail.prompt.sentry.1":
    "Quais são os principais erros novos desde o deploy de ontem?",
  "settingsShell.integrationDetail.prompt.sentry.2":
    "Mostre o stack trace da falha mais frequente",
  "settingsShell.integrationDetail.prompt.sentry.3":
    "Qual release introduziu este erro?",
  "settingsShell.integrationDetail.prompt.sigma.1":
    "Encontre o dashboard de receita",
  "settingsShell.integrationDetail.prompt.sigma.2":
    "O que causou a mudança no MRR no mês passado?",
  "settingsShell.integrationDetail.prompt.sigma.3":
    "Explique as principais métricas deste workbook",
  "settingsShell.integrationDetail.prompt.slack.1":
    "Resuma o #design desta semana",
  "settingsShell.integrationDetail.prompt.slack.2":
    "Encontre a thread sobre a mudança de preço",
  "settingsShell.integrationDetail.prompt.slack.3":
    "O que a Camila disse sobre o lançamento?",
  "settingsShell.integrationDetail.prompt.stripe.1":
    "Quanta receita tivemos no mês passado?",
  "settingsShell.integrationDetail.prompt.stripe.2":
    "Encontre o cliente desta fatura",
  "settingsShell.integrationDetail.prompt.stripe.3":
    "Quais assinaturas não foram renovadas?",
  "settingsShell.integrationDetail.prompt.supabase.1":
    "Quantas pessoas se cadastraram esta semana?",
  "settingsShell.integrationDetail.prompt.supabase.2":
    "Mostre o esquema da tabela recordings",
  "settingsShell.integrationDetail.prompt.supabase.3":
    "Quais edge functions deram erro hoje?",
  "settingsShell.integrationDetail.prompt.telegram.1":
    "Resuma as gravações de hoje",
  "settingsShell.integrationDetail.prompt.telegram.2":
    "Me lembre da revisão das 15h",
  "settingsShell.integrationDetail.prompt.telegram.3":
    "Compartilhe o link da demo de ontem",
  "settingsShell.integrationDetail.prompt.vercel.1":
    "Por que o último deploy de prévia falhou?",
  "settingsShell.integrationDetail.prompt.vercel.2":
    "Mostre os logs do deployment de produção",
  "settingsShell.integrationDetail.prompt.vercel.3":
    "Quais domínios apontam para este projeto?",
  "settingsShell.integrationDetail.prompt.webflow.1":
    "Atualize o título da página de preços",
  "settingsShell.integrationDetail.prompt.webflow.2":
    "Liste os itens do CMS publicados esta semana",
  "settingsShell.integrationDetail.prompt.webflow.3":
    "Quais páginas estão sem meta description?",
  "settingsShell.integrationDetail.prompt.whatsapp.1":
    "O que tenho na agenda hoje?",
  "settingsShell.integrationDetail.prompt.whatsapp.2":
    "Resuma a gravação mais recente",
  "settingsShell.integrationDetail.prompt.whatsapp.3":
    "Me envie as notas da revisão de design",
  "settingsShell.integrationDetail.prompt.zapier.1":
    "Publique novas gravações em #design no Slack",
  "settingsShell.integrationDetail.prompt.zapier.2":
    "Adicione novos cadastros ao nosso CRM",
  "settingsShell.integrationDetail.prompt.zapier.3":
    "Quais Zaps você pode executar?",
  "settingsShell.integrationDetail.serverUrl": "URL do servidor",
  "settingsShell.integrationDetail.setUp": "Configurar",
  "settingsShell.integrationDetail.signIn": "Login",
  "settingsShell.integrationDetail.signInNone": "Nenhum",
  "settingsShell.integrationDetail.tokenHint.figma":
    "Crie um token de acesso pessoal no Figma e cole-o aqui.",
  "settingsShell.integrationDetail.tokenHint.github":
    "Crie um token de acesso pessoal no GitHub e cole-o aqui.",
  "settingsShell.integrationDetail.tokenHint.sentry":
    "Crie um token de autenticação de usuário no Sentry e cole-o aqui.",
  "settingsShell.integrationDetail.tokenHint.zapier":
    "Crie uma conexão no Zapier e cole aqui o token bearer dela.",
  "settingsShell.integrationDetail.tokenPlaceholder":
    "Cole seu token do {{name}}",
  "settingsShell.integrationDetail.who": "Quem pode usar",
  "settingsShell.integrationDetail.whoMember":
    "Apenas proprietários e admins podem compartilhar com {{org}}.",
  "settingsShell.integrationDetail.whoOrgOnly":
    "Conecta uma vez para todos em {{org}}.",
  "settingsShell.integrationDetail.whoPersonal":
    "Cada pessoa conecta a própria conta.",
  "settingsShell.integrationDetail.whoShared":
    "Uma conexão compartilhada permite que todos em {{org}} usem seu acesso.",
  "settingsShell.clearSearch": "Limpar pesquisa",
  "settingsShell.group.account": "Conta",
  "settingsShell.group.agent": "Agente",
  "settingsShell.group.connections": "Conexões",
  "settingsShell.group.organization": "Organização",
  "settingsShell.interfaceLanguage": "Idioma da interface",
  "settingsShell.integrations.addCustom": "Adicionar integração personalizada",
  "settingsShell.integrations.builderDescription":
    "Acesso a modelos, automação de navegador, armazenamento de arquivos e identidade do workspace. Plano gratuito disponível.",
  "settingsShell.integrations.builderStatusFailed":
    "Não foi possível verificar a conexão do Builder.io.",
  "settingsShell.integrations.category.analytics": "Análise",
  "settingsShell.integrations.category.design": "Design",
  "settingsShell.integrations.category.engineering": "Engenharia",
  "settingsShell.integrations.category.finance": "Finanças",
  "settingsShell.integrations.category.other": "Outras",
  "settingsShell.integrations.category.productivity": "Produtividade",
  "settingsShell.integrations.category.sales": "Vendas",
  "settingsShell.integrations.category.support": "Suporte",
  "settingsShell.integrations.connectName": "Conectar {{name}}",
  "settingsShell.integrations.connectedEmptyDescription":
    "Conecte uma ferramenta abaixo e o agente poderá usá-la no chat.",
  "settingsShell.integrations.connectedEmptyTitle": "Nada conectado ainda",
  "settingsShell.integrations.footnote":
    "Estas são as ferramentas que o agente usa. Para usar o {{app}} no Claude, ChatGPT ou Cursor, veja {{link}}.",
  "settingsShell.integrations.moreActions": "Mais ações para {{name}}",
  "settingsShell.integrations.noResults":
    "Nenhuma integração corresponde. Tente outro nome.",
  "settingsShell.integrations.remove": "Remover",
  "settingsShell.integrations.removeFailed":
    "Não foi possível remover {{name}}.",
  "settingsShell.integrations.removePersonal":
    "O agente deixa de usar {{name}} para você.",
  "settingsShell.integrations.removeTitle": "Remover {{name}}?",
  "settingsShell.integrations.removeWorkspace":
    "O agente deixa de usar {{name}} para todos no workspace.",
  "settingsShell.integrations.removing": "Removendo…",
  "settingsShell.integrations.retry": "Tentar novamente",
  "settingsShell.integrations.seeMoreMany": "Ver {{first}}, {{second}} e mais",
  "settingsShell.integrations.seeMoreOne": "Ver {{first}}",
  "settingsShell.integrations.seeMoreTwo": "Ver {{first}} e {{second}}",
  "settingsShell.integrations.serversLoadFailed":
    "Não foi possível carregar suas integrações conectadas.",
  "settingsShell.learnings": "Aprendizados",
  "settingsShell.loading": "Carregando configurações",
  "settingsShell.navLabel": "Configurações",
  "settingsShell.noResults": "Nenhuma configuração correspondente",
  "settingsShell.openNav": "Abrir menu de configurações",
  "settingsShell.page.apiKeys": "Chaves de API",
  "settingsShell.page.appGeneral": "Geral",
  "settingsShell.page.apps": "Aplicativos",
  "settingsShell.page.audit": "Log de auditoria",
  "settingsShell.page.auth": "Autenticação",
  "settingsShell.page.automations": "Automações",
  "settingsShell.page.channels": "Canais",
  "settingsShell.page.creativeContext": "Contexto criativo",
  "settingsShell.page.files": "Arquivos",
  "settingsShell.page.infra": "Infraestrutura",
  "settingsShell.page.instructions": "Instruções",
  "settingsShell.page.integrations": "Integrações",
  "settingsShell.page.labs": "Labs",
  "settingsShell.page.mcp": "Servidor MCP",
  "settingsShell.page.members": "Membros",
  "settingsShell.page.memory": "Memória",
  "settingsShell.page.model": "Modelo",
  "settingsShell.page.notifications": "Notificações",
  "settingsShell.page.orgGeneral": "Geral",
  "settingsShell.page.preferences": "Preferências",
  "settingsShell.page.profile": "Perfil",
  "settingsShell.page.security": "Segurança",
  "settingsShell.page.skills": "Habilidades",
  "settingsShell.page.subAgents": "Subagentes",
  "settingsShell.page.usage": "Uso",
  "settingsShell.page.whatsNew": "Novidades",
  "settingsShell.pagePending": "Ainda não disponível",
  "settingsShell.resultsLabel": "Resultados da pesquisa nas configurações",
  "settingsShell.search.appDefaultModel": "Modelo padrão do app",
  "settingsShell.search.backgroundAgents": "Agentes em segundo plano",
  "settingsShell.search.browserAutomation": "Automação de navegador",
  "settingsShell.search.connectedAgents": "Agentes conectados",
  "settingsShell.search.database": "Banco de dados",
  "settingsShell.search.defaultModel": "Modelo padrão",
  "settingsShell.search.demoMode": "Modo de demonstração",
  "settingsShell.search.email": "E-mail",
  "settingsShell.search.fileUploads": "Upload de arquivos e armazenamento",
  "settingsShell.search.hosting": "Hospedagem",
  "settingsShell.search.maxIterations": "Máximo de iterações",
  "settingsShell.search.signInMethods": "Métodos de login",
  "settingsShell.search.voiceTranscription": "Transcrição de voz",
  "settingsShell.searchPlaceholder": "Pesquisar configurações",
  "settingsShell.unread": "Novo",
  "settingsResources.personal": "Pessoal",
  "settingsResources.organization": "Organização",
  "settingsResources.fromDispatch": "Do Dispatch",
  "settingsResources.readOnly": "Somente leitura",
  "settingsResources.readOnlyHint":
    "Somente proprietários e administradores podem alterar isso",
  "settingsResources.editInDispatch": "Edite no Dispatch",
  "settingsResources.openDispatch": "Abrir Dispatch",
  "settingsResources.allApps": "Todos os apps",
  "settingsResources.allAppsHint":
    "O Dispatch compartilha isso com todos os apps",
  "settingsResources.dispatchEmpty": "Nada compartilhado do Dispatch",
  "settingsResources.loadFailed": "Não foi possível carregar estes recursos.",
  "settingsResources.moreActions": "Mais ações",
  "settingsResources.open": "Abrir",
  "settingsResources.download": "Baixar",
  "settingsResources.remove": "Remover",
  "settingsResources.removeTitle": "Remover {{name}}?",
  "settingsResources.removeFailed": "Não foi possível remover {{name}}.",
  "settingsResources.saveFailed": "Não foi possível salvar {{name}}.",
  "settingsResources.uploadFailed": "Não foi possível enviar {{name}}.",
  "settingsResources.cancel": "Cancelar",
  "settingsResources.save": "Salvar",
  "settingsResources.create": "Criar",
  "settingsResources.saving": "Salvando",
  "settingsResources.creating": "Criando",
  "settingsResources.removing": "Removendo",
  "settingsResources.instructions.empty":
    "Diga ao agente como trabalhar com você.",
  "settingsResources.instructions.emptyTitle": "Nenhuma instrução ainda",
  "settingsResources.instructions.orgEmpty":
    "Ainda não há instruções para {{org}}",
  "settingsResources.instructions.add": "Adicionar instruções",
  "settingsResources.instructions.fieldLabel":
    "Como o agente deve trabalhar com você?",
  "settingsResources.instructions.placeholder":
    "Responda de forma curta. Use unidades métricas.",
  "settingsResources.instructions.savedAs":
    "Salvo como AGENTS.md nos seus recursos pessoais.",
  "settingsResources.memory.empty":
    "O agente salva aqui o que aprende sobre você.",
  "settingsResources.memory.emptyTitle": "Nenhuma memória ainda",
  "settingsResources.memory.orgEmpty": "Ainda não há memórias compartilhadas",
  "settingsResources.memory.add": "Adicionar memória",
  "settingsResources.learnings.empty":
    "As correções que você dá ao agente são salvas como aprendizados.",
  "settingsResources.learnings.emptyTitle": "Nenhum aprendizado ainda",
  "settingsResources.learnings.add": "Adicionar aprendizado",
  "settingsResources.skills.empty":
    "Salve um fluxo de trabalho uma vez e o agente poderá reutilizá-lo.",
  "settingsResources.skills.emptyTitle": "Nenhuma habilidade ainda",
  "settingsResources.skills.orgEmpty":
    "Ainda não há habilidades compartilhadas",
  "settingsResources.skills.add": "Adicionar habilidade",
  "settingsResources.skills.describe": "Descrever para o agente",
  "settingsResources.skills.upload": "Enviar um arquivo de habilidade",
  "settingsResources.skills.describePlaceholder":
    "Uma habilidade que revisa pull requests em busca de problemas de segurança",
  "settingsResources.files.empty":
    "Adicione um arquivo para dar mais contexto ao seu agente.",
  "settingsResources.files.emptyTitle": "Nenhum arquivo ainda",
  "settingsResources.files.orgEmpty": "Ainda não há arquivos compartilhados",
  "settingsResources.files.add": "Adicionar arquivo",
  "settingsResources.files.upload": "Enviar arquivo",
  "settingsResources.files.create": "Criar arquivo",
  "settingsInfra.setup": "Configuração",
  "settingsInfra.services": "Serviços",
  "settingsInfra.environment": "Ambiente",
  "settingsInfra.builderConnected":
    "Conectado. Os créditos da sua conta mantêm cada serviço marcado com Builder.io.",
  "settingsInfra.builderNotConnected":
    "Não conectado. Configure cada serviço por conta própria ou conecte o Builder.io para usar os créditos da sua conta.",
  "settingsInfra.builderUnknown":
    "Não foi possível verificar a conexão com o Builder.io.",
  "settingsInfra.manage": "Gerenciar",
  "settingsInfra.connect": "Conectar",
  "settingsInfra.connecting": "Conectando…",
  "settingsInfra.setUp": "Configurar",
  "settingsInfra.view": "Ver",
  "settingsInfra.retry": "Tentar novamente",
  "settingsInfra.close": "Fechar",
  "settingsInfra.cancel": "Cancelar",
  "settingsInfra.save": "Salvar",
  "settingsInfra.saving": "Salvando…",
  "settingsInfra.required": "Obrigatório",
  "settingsInfra.recommended": "Recomendado",
  "settingsInfra.optional": "Opcional",
  "settingsInfra.builderRecommended":
    "Use os créditos da sua conta Builder.io em todos os serviços abaixo. Plano gratuito disponível.",
  "settingsInfra.builderOnly": "Somente Builder.io",
  "settingsInfra.rowDescription": "{{source}} · {{use}}",
  "settingsInfra.notSetUp": "Não configurado",
  "settingsInfra.availableWithBuilder": "Disponível com o Builder.io",
  "settingsInfra.loadFailed": "Não foi possível carregar.",
  "settingsInfra.aiModel": "Modelo de IA",
  "settingsInfra.useEveryApp": "Todos os apps",
  "settingsInfra.storageBucket": "{{provider}}, bucket {{bucket}}",
  "settingsInfra.useUploads": "Uploads em todos os apps",
  "settingsInfra.storageTitle": "Armazenamento de arquivos",
  "settingsInfra.storageIntro":
    "Novos uploads vão para o seu bucket. Os arquivos existentes ficam onde estão.",
  "settingsInfra.voice": "Entrada de voz",
  "settingsInfra.images": "Geração de imagens",
  "settingsInfra.embeddings": "Embeddings",
  "settingsInfra.useVoice": "Ditado em todos os apps",
  "settingsInfra.useImages": "Slides e Design",
  "settingsInfra.useEmbeddings": "Pesquisa no Brain",
  "settingsInfra.whyVoice":
    "Transforma fala em texto. Digitar sempre funciona sem ele.",
  "settingsInfra.whyImages": "Gera imagens para slides e designs.",
  "settingsInfra.whyEmbeddings":
    "Melhora a pesquisa semântica. A pesquisa por palavra-chave continua funcionando sem ele.",
  "settingsInfra.designSystem": "Inteligência do design system",
  "settingsInfra.whyDesignSystem":
    "Mantém slides e designs gerados alinhados à marca.",
  "settingsInfra.whyBackground":
    "Faz alterações no código a partir da produção.",
  "settingsInfra.whyBrowser":
    "Permite que o agente use um navegador em produção.",
  "settingsInfra.provider": "Provedor",
  "settingsInfra.keyOrg": "Usa a chave do {{provider}} da organização.",
  "settingsInfra.manageKey": "Gerenciar chave",
  "settingsInfra.keyPersonal":
    "Sua chave do {{provider}} é pessoal. Os serviços precisam de uma chave da organização.",
  "settingsInfra.keyNone":
    "Os serviços usam chaves da organização, e ainda não há uma chave do {{provider}}.",
  "settingsInfra.keyUnavailable":
    "Não foi possível verificar a chave do {{provider}} da organização.",
  "settingsInfra.useBuilder": "Usar o Builder.io",
  "settingsInfra.addNamed": "Adicionar {{provider}}",
  "settingsInfra.serviceSaved": "{{service}} agora usa {{provider}}.",
  "settingsInfra.serviceSaveFailed": "Não foi possível alterar {{service}}.",
  "settingsInfra.reindex":
    "Reindexe o Brain para que a pesquisa semântica inclua os itens existentes.",
  "settingsInfra.variables": "Variáveis obrigatórias",
  "settingsInfra.databaseHosted":
    "{{name}}, definido no seu host. Todos os apps o compartilham.",
  "settingsInfra.databaseHostedSingle": "{{name}}, definido no seu host.",
  "settingsInfra.databaseLocal":
    "{{name}} neste computador. Defina DATABASE_URL no seu host antes de implantar.",
  "settingsInfra.databaseMissing":
    "Não definido. Defina DATABASE_URL no seu host.",
  "settingsInfra.hostingWorkspace":
    "{{host}}. O workspace implanta cada app no próprio endereço.",
  "settingsInfra.hostingSingle": "{{host}}, em {{address}}.",
  "settingsInfra.hostingPlain": "{{host}}.",
  "settingsInfra.hostOwnServer": "Seu próprio servidor",
  "settingsInfra.hostThisComputer": "Este computador",
  "settingsInfra.variablesSet": "{{keys}} estão definidas no seu host.",
  "settingsInfra.variablesMissing": "Defina {{keys}} no seu host.",
  "settingsInfra.dbConnected": "Conectado",
  "settingsInfra.dbLocal": "Neste computador",
  "settingsInfra.notSet": "Não definido",
  "settingsInfra.set": "Definida",
  "settingsInfra.dbIntro":
    "Cada app lê o banco de dados antes de iniciar, então ele é definido uma vez no seu host. Para mudar para outro banco de dados:",
  "settingsInfra.dbStep1":
    "Crie um banco de dados Postgres no Neon, no Supabase ou em qualquer host Postgres.",
  "settingsInfra.dbStep2":
    "Defina {{key}} com a string de conexão no ambiente do seu host.",
  "settingsInfra.dbStep3":
    "Implante novamente. As migrações rodam durante a implantação.",
  "settingsInfra.dbOwn":
    "Para dar a um app o próprio banco de dados, defina a variável dele, como {{key}}.",
  "settingsInfra.hostIntroWorkspace":
    "O workspace implanta cada app, cada um no próprio endereço. Para hospedar na Vercel, na Cloudflare ou no seu próprio servidor:",
  "settingsInfra.hostIntro":
    "Para hospedar na Vercel, na Cloudflare ou no seu próprio servidor:",
  "settingsInfra.hostStep1":
    "Escolha o destino com {{key}}, como vercel, cloudflare_module ou node.",
  "settingsInfra.hostStep2":
    "Dê ao novo host o mesmo ambiente, incluindo {{keys}}.",
  "settingsInfra.hostStep3":
    "Implante. Em um workspace, isso cria cada app e mostra o comando de publicação:",
  "settingsInfra.envIntro":
    "Cada app lê esses valores antes de iniciar. Defina-os uma vez no seu host e implante novamente.",
  "settingsInfra.varDatabaseUrl": "Sua string de conexão do Postgres.",
  "settingsInfra.varA2a":
    "Permite que os apps deste workspace chamem uns aos outros. Em um workspace, também assina as sessões de login quando BETTER_AUTH_SECRET não está definida.",
  "settingsInfra.varBetterAuth":
    "Assina as sessões de login. Use pelo menos 32 caracteres aleatórios.",
  "settingsInfra.varAppUrl":
    "Só é necessário quando o host não consegue informar ao app a URL pública.",
  "settingsInfra.varEncryption":
    "Criptografa as chaves salvas nas Configurações. Sem ela, o workspace deriva uma de A2A_SECRET.",
  "settingsInfra.varEncryptionSingle":
    "Criptografa as chaves salvas nas Configurações. Sem ela, o app deriva uma de BETTER_AUTH_SECRET.",
  "settingsInfra.varWeak":
    "Curta demais. Use pelo menos 32 caracteres aleatórios.",
  "settingsInfra.varWeakLabel": "Curta demais",
  "settingsInfra.generateSecret": "Para gerar um segredo:",
  "settingsInfra.copy": "Copiar",
  "settingsInfra.copied": "Copiado",
  "settingsInfra.copyFailed": "Não foi possível copiar.",
  "settingsApiKeys.addKey": "Adicionar chave",
  "settingsApiKeys.adding": "Adicionando…",
  "settingsApiKeys.availableTo": "Disponível para",
  "settingsApiKeys.deleteKey": "Excluir chave",
  "settingsApiKeys.deleting": "Excluindo…",
  "settingsApiKeys.deleteTitle": "Excluir {{name}}?",
  "settingsApiKeys.everyoneIn": "Todos em {{org}}",
  "settingsApiKeys.getKey": "Obter chave",
  "settingsApiKeys.hideKeys": "Ocultar chaves",
  "settingsApiKeys.justMe": "Só eu",
  "settingsApiKeys.keyAdded": "Chave adicionada",
  "settingsApiKeys.keyDeleted": "Chave excluída",
  "settingsApiKeys.loadFailed": "Não foi possível carregar suas chaves.",
  "settingsApiKeys.manageKey": "Gerenciar {{name}}",
  "settingsApiKeys.managedKeys": "Gerenciadas por integrações",
  "settingsApiKeys.managedName": "{{owner}} gerencia esta chave.",
  "settingsApiKeys.managedTooltip":
    "Criada e rotacionada por {{owner}}. Desconecte-a por lá.",
  "settingsApiKeys.membersLocked":
    "Somente proprietários e administradores podem compartilhar chaves com {{org}}.",
  "settingsApiKeys.modelFootnote":
    "Para usar seu próprio provedor de modelos, {{link}}.",
  "settingsApiKeys.modelFootnoteLink": "adicione-o em Modelo",
  "settingsApiKeys.name": "Nome",
  "settingsApiKeys.noKeys": "Nenhuma chave ainda",
  "settingsApiKeys.noKeysDescription":
    "Adicione uma chave para que seus apps e o agente acessem um serviço.",
  "settingsApiKeys.orgKeys": "Chaves da organização",
  "settingsApiKeys.providerInModel": "Adicione {{provider}} em {{link}}.",
  "settingsApiKeys.replaceTitle": "Substituir {{name}}",
  "settingsApiKeys.replaceValue": "Substituir valor",
  "settingsApiKeys.saving": "Salvando…",
  "settingsApiKeys.showKeys_many": "Mostrar {{count}} chaves",
  "settingsApiKeys.showKeys_one": "Mostrar {{count}} chave",
  "settingsApiKeys.showKeys_other": "Mostrar {{count}} chaves",
  "settingsApiKeys.test": "Testar",
  "settingsApiKeys.testPassed": "O valor salvo funciona.",
  "settingsApiKeys.usedBy": "Usada por {{link}}",
  "settingsApiKeys.value": "Valor",
  "settingsApiKeys.valueReplaced": "Valor substituído",
  "settingsApiKeys.yourKeys": "Suas chaves",
  "settingsModel.addEndpoint": "Adicionar uma URL de endpoint",
  "settingsModel.addNamed": "Adicionar {{provider}}",
  "settingsModel.addProvider": "Adicionar provedor",
  "settingsModel.adding": "Adicionando",
  "settingsModel.affectsOrg": "Isso afeta todas as pessoas em {{org}}.",
  "settingsModel.affectsYou": "Isso afeta só você.",
  "settingsModel.allApps": "Todos os apps",
  "settingsModel.apiKey": "Chave de API",
  "settingsModel.builderConnected": "Conectado · {{space}}",
  "settingsModel.builderConnectedPlain": "Conectado",
  "settingsModel.builderOrgNotConnectedAdmin":
    "Não conectado. Quando você conectar, todas as pessoas em {{org}} poderão usar.",
  "settingsModel.builderOrgNotConnectedMember":
    "Não conectado. Um proprietário ou administrador pode conectar.",
  "settingsModel.builderPersonalConnect":
    "Conecte sua própria conta para usar seus créditos do Builder.io.",
  "settingsModel.builderPersonalInsteadOfOrg":
    "Conecte sua própria conta para usá-la no lugar da conta da organização.",
  "settingsModel.builderPersonalOverOrg":
    "Conectado · {{space}}. Usado no lugar da conexão da organização.",
  "settingsModel.builderPersonalOverOrgPlain":
    "Conectado. Usado no lugar da conexão da organização.",
  "settingsModel.builderUnknown":
    "Não foi possível verificar a conexão com o Builder.io.",
  "settingsModel.cancel": "Cancelar",
  "settingsModel.change": "Alterar",
  "settingsModel.chatgptConnected": "Conectado",
  "settingsModel.chatgptDescription":
    "Use o mecanismo Codex com seu plano do ChatGPT.",
  "settingsModel.chatgptPopupBlocked":
    "Permita pop-ups para este site e tente de novo.",
  "settingsModel.chatgptTitle": "Assinatura do ChatGPT",
  "settingsModel.checkAgain": "Verificar de novo",
  "settingsModel.checkedJustNow": "Verificada agora mesmo.",
  "settingsModel.checkedOn": "Verificada em {{date}}.",
  "settingsModel.checking": "Verificando sua chave com {{provider}}",
  "settingsModel.checkingEndpoint": "Verificando o endpoint",
  "settingsModel.checkingOllama": "Verificando os modelos instalados…",
  "settingsModel.checkingSaved": "Verificando a chave salva",
  "settingsModel.chooseModel": "Escolha um modelo",
  "settingsModel.clear": "Limpar",
  "settingsModel.connect": "Conectar",
  "settingsModel.connecting": "Conectando…",
  "settingsModel.defaultModelDescription":
    "Usado em todos os apps, a menos que o app defina o próprio.",
  "settingsModel.defaultModelNeedsProvider":
    "Adicione um provedor para escolher um modelo padrão.",
  "settingsModel.disconnect": "Desconectar",
  "settingsModel.effectDefaultStops":
    "Os chats param até que outro provedor seja configurado.",
  "settingsModel.effectDefaultSwitches": "O modelo padrão muda para {{next}}.",
  "settingsModel.effectKeepsOrg":
    "Continua funcionando com a chave da organização.",
  "settingsModel.effectKeepsVault":
    "Continua funcionando com a chave do Vault.",
  "settingsModel.effectKeepsWorkspace":
    "Continua funcionando com a chave do espaço de trabalho.",
  "settingsModel.effectModelsLeave":
    "Os modelos do {{provider}} saem do seletor de modelos.",
  "settingsModel.emptyAskAdmin":
    "Peça a um proprietário ou administrador para adicionar um.",
  "settingsModel.emptyDescription":
    "O agente precisa de um provedor para responder.",
  "settingsModel.emptyDescriptionBuilder":
    "O agente precisa de um provedor para responder. Recomendamos o Builder.io para acesso a modelos, automação de navegador, armazenamento de arquivos e identidade do workspace. Plano gratuito disponível.",
  "settingsModel.emptyTitle": "Adicione um provedor de modelos",
  "settingsModel.endpointFirst": "Primeiro, insira a URL do endpoint.",
  "settingsModel.endpointHint":
    "Opcional. Use para o LiteLLM ou outro gateway compatível com a OpenAI.",
  "settingsModel.endpointUrl": "URL do endpoint",
  "settingsModel.keyHint":
    "Crie uma em {{host}}. O {{provider}} cobra diretamente.",
  "settingsModel.keyPlaceholder": "Cole sua chave do {{provider}}",
  "settingsModel.labs": "Labs",
  "settingsModel.loadFailed": "Não foi possível carregar os provedores.",
  "settingsModel.lockedTip":
    "Somente proprietários e administradores podem alterar isso.",
  "settingsModel.manage": "Gerenciar",
  "settingsModel.maxIterationsDescription":
    "Por quanto tempo uma resposta pode trabalhar antes de pausar.",
  "settingsModel.maxIterationsInvalid":
    "Insira um número inteiro de {{min}} a {{max}}.",
  "settingsModel.modelCount_many": "{{count}} modelos",
  "settingsModel.modelCount_one": "{{count}} modelo",
  "settingsModel.modelCount_other": "{{count}} modelos",
  "settingsModel.modelOption": "{{model}} · {{provider}}",
  "settingsModel.models": "Modelos",
  "settingsModel.modelsHint":
    "Os modelos selecionados aparecem no seletor de modelos.",
  "settingsModel.modelsHintService":
    "Os modelos de chat são opcionais. Deixe-os desmarcados para usar esta chave só para {{service}}.",
  "settingsModel.modelsIdle":
    "Cole uma chave para ver os modelos que ela pode usar.",
  "settingsModel.modelsIdleOllama":
    "Insira a URL do endpoint para ver os modelos instalados.",
  "settingsModel.modelsSaveFailed":
    "A chave foi salva, mas a lista de modelos não. {{message}}",
  "settingsModel.noChatModels": "Nenhum modelo de chat",
  "settingsModel.noModelsFound": "Nenhum modelo encontrado.",
  "settingsModel.notSet": "Não definido",
  "settingsModel.nothingElse": "Nada mais usa esta chave.",
  "settingsModel.ollamaHint": "Não é necessária chave de API.",
  "settingsModel.orgProviders": "Provedores da organização",
  "settingsModel.orgSettings": "Configurações da organização",
  "settingsModel.organization": "Organização",
  "settingsModel.pasteFirst": "Primeiro, cole uma chave.",
  "settingsModel.personal": "Pessoal",
  "settingsModel.personalProviders": "Provedores pessoais",
  "settingsModel.previewFailed": "Não foi possível verificar o que isso afeta.",
  "settingsModel.provider": "Provedor",
  "settingsModel.providerErrorHeadline":
    "O {{provider}} não conseguiu verificar esta chave",
  "settingsModel.reasonEndpoint": "Verifique a URL do endpoint.",
  "settingsModel.reasonOllamaUnreachable":
    "Verifique a URL e se o Ollama está em execução.",
  "settingsModel.reasonPrefix":
    "As chaves do {{provider}} começam com {{prefix}}.",
  "settingsModel.reasonRejected":
    "Verifique se você copiou a chave inteira ou crie uma nova.",
  "settingsModel.reasonTryAgain": "Tente de novo em instantes.",
  "settingsModel.reasonWrongProvider": "Parece uma chave do {{provider}}.",
  "settingsModel.reasonWrongProviderVowel": "Parece uma chave do {{provider}}.",
  "settingsModel.reconnect": "Reconectar",
  "settingsModel.rejected":
    "O {{provider}} recusou esta chave em {{date}}. Os chats que a usam param até você substituí-la.",
  "settingsModel.rejectedAskAdmin":
    "O {{provider}} recusou esta chave em {{date}}. Peça a um proprietário ou administrador para substituí-la.",
  "settingsModel.rejectedHeadline": "O {{provider}} recusou esta chave",
  "settingsModel.remove": "Remover",
  "settingsModel.removeProvider": "Remover provedor",
  "settingsModel.removeTitle": "Remover {{provider}}?",
  "settingsModel.removing": "Removendo",
  "settingsModel.replace": "Substituir",
  "settingsModel.replaceKey": "Substituir chave",
  "settingsModel.restrictBody":
    "Os membros só podem usar provedores da organização.",
  "settingsModel.restrictConfirm": "Restringir chaves",
  "settingsModel.restrictDescription":
    "Os membros só podem usar provedores da organização, e as chaves que adicionaram param de funcionar.",
  "settingsModel.restrictLabel": "Restringir chaves de API pessoais",
  "settingsModel.restrictMemberBuilder":
    "A conexão pessoal com o Builder.io para de funcionar.",
  "settingsModel.restrictMemberChats":
    "Os chats passam a usar provedores da organização.",
  "settingsModel.restrictMemberKeys_many":
    "As chaves do {{providers}} param de funcionar.",
  "settingsModel.restrictMemberKeys_one":
    "A chave do {{providers}} para de funcionar.",
  "settingsModel.restrictMemberKeys_other":
    "As chaves do {{providers}} param de funcionar.",
  "settingsModel.restrictNewKeysBody":
    "Os membros não podem adicioná-las. Proprietários e administradores ainda podem.",
  "settingsModel.restrictNewKeysTitle": "Novas chaves pessoais",
  "settingsModel.restrictTitle": "Restringir chaves de API pessoais?",
  "settingsModel.restricted":
    "Proprietários e administradores restringiram as chaves de API pessoais.",
  "settingsModel.restrictedRow":
    "Não é usada enquanto as chaves de API pessoais estiverem restritas.",
  "settingsModel.restricting": "Restringindo",
  "settingsModel.retry": "Tentar de novo",
  "settingsModel.save": "Salvar",
  "settingsModel.savedRejected":
    "O {{provider}} recusou a chave salva. Cole uma nova.",
  "settingsModel.saving": "Salvando",
  "settingsModel.selectAll": "Selecionar tudo",
  "settingsModel.settingLoadFailed":
    "Não foi possível carregar esta configuração.",
  "settingsModel.unreachableHeadline":
    "Não foi possível acessar o {{provider}}",
  "settingsModel.view": "Ver",
  "settingsModel.whatHappens": "O que acontece",
  "settingsModel.who": "Quem pode usar",
  "settingsModel.whoHintAdmin":
    "Provedores pessoais são só seus. Provedores da organização funcionam para todas as pessoas em {{org}}.",
  "settingsModel.whoHintMember":
    "Somente proprietários e administradores podem adicionar provedores da organização.",
  "settingsModel.whoHintService": "Os serviços usam chaves da organização.",
  "settingsSubAgents.connect": "Conectar agente",
  "settingsSubAgents.orgApps": "Apps de {{org}}",
  "settingsSubAgents.workspaceApps": "Apps do workspace",
  "settingsSubAgents.external": "Agentes externos",
  "settingsSubAgents.custom": "Agentes personalizados",
  "settingsSubAgents.managedByAdmins": "Gerenciado por administradores",
  "settingsSubAgents.appsEmpty": "Nenhum app conectado ainda",
  "settingsSubAgents.externalEmpty":
    "Conecte Foundry, Gemini Enterprise, Anthropic ou qualquer agente A2A.",
  "settingsSubAgents.externalEmptyTitle": "Nenhum agente externo ainda",
  "settingsSubAgents.customEmpty":
    "Defina um agente especializado para o qual o agente principal possa delegar.",
  "settingsSubAgents.customEmptyTitle": "Nenhum agente personalizado ainda",
  "settingsSubAgents.addAgent": "Adicionar agente",
  "settingsSubAgents.describe": "Descrever para o agente",
  "settingsSubAgents.describePlaceholder":
    "Um agente de design que critica layouts e sugere direções de UI",
  "settingsSubAgents.write": "Escrever você mesmo",
  "settingsSubAgents.name": "Nome",
  "settingsSubAgents.description": "Descrição",
  "settingsSubAgents.instructions": "Instruções",
  "settingsSubAgents.loadFailed":
    "Não foi possível carregar os agentes conectados.",
  "settingsSubAgents.statusUnreachable": "Inacessível",
  "settingsSubAgents.edit": "Editar",
  "settingsSubAgents.editTitle": "Editar {{name}}",
  "settingsSubAgents.removeDescription":
    "O agente deixa de delegar para {{name}} para todos em {{org}}.",
  "settingsSubAgents.removeDescriptionSolo":
    "O agente deixa de delegar para {{name}}.",
  "settingsSubAgents.directoryTitle": "Conectar um agente",
  "settingsSubAgents.anyAgent": "Qualquer agente A2A",
  "settingsSubAgents.anyAgentHint": "Cole a URL de um card de agente.",
  "settingsSubAgents.registryLink": "Explorar o Global A2A Registry",
  "settingsSubAgents.connectTitle": "Conectar {{name}}",
  "settingsSubAgents.close": "Fechar",
};

export default messages;
