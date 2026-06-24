const messages = {
  common: {
    cancel: "Cancelar",
    create: "Criar",
    save: "Salvar",
    saving: "Salvando…",
    saveChanges: "Salvar alterações",
    connected: "Conectado",
    notConnected: "Não conectado",
    disconnect: "Desconectar",
    disconnecting: "Desconectando...",
  },
  root: {
    commandActions: "Ações",
    commandSearch: "Pesquisar",
    commandAppearance: "Aparência",
    toggleTheme: "Alternar tema",
    extensionSignedInTitle: "Conectado",
    extensionSignedInDescription:
      "Abra a extensão Clips novamente para começar a gravar.",
    gotIt: "Entendi",
  },
  navigation: {
    brand: "Clips",
    library: "Biblioteca",
    spaces: "Espaços",
    meetings: "Reuniões",
    dictate: "Ditar",
    archive: "Arquivo",
    trash: "Lixeira",
    settings: "Configurações",
    notifications: "Notificações",
    insights: "Insights",
    space: "Espaço",
    folder: "Pasta",
    extensions: "Extensões",
    newRecording: "Nova gravação",
    folders: "Pastas",
    newFolder: "Nova pasta",
    noSpaces: "Ainda não há espaços",
    desktopCta: "Baixar app desktop",
    desktopTitle: "Baixe o app desktop do Clips.",
    desktopBody:
      "Grave pela barra de menu, atalho global e com atualizações automáticas.",
    expandSidebar: "Expandir barra lateral",
    collapseSidebar: "Recolher barra lateral",
    agentEmptyState: "Como posso ajudar com suas gravações?",
    agentSuggestionSummary: "Resuma minha última gravação",
    agentSuggestionPricing: "Encontre onde mencionei preços",
    agentSuggestionFiller: "Remova vícios de linguagem deste clipe",
    createFolderError: "Falha ao criar",
    folderCreated: "Pasta criada",
    folderNamePlaceholder: "Nome da pasta",
  },
  empty: {
    library: {
      title: "Sua biblioteca está vazia",
      body: "Capture sua primeira gravação de tela e ela aparecerá aqui, pronta para compartilhar.",
      cta: "Gravar seu primeiro Clip",
    },
    folder: {
      title: "Esta pasta está vazia",
      body: "Arraste gravações para cá ou clique em gravar para começar algo novo nesta pasta.",
      cta: "Gravar aqui",
    },
    space: {
      title: "Ainda não há gravações neste espaço",
      body: "Compartilhe uma gravação com o espaço ou grave algo novo; sua equipe verá aqui.",
      cta: "Gravar para este espaço",
    },
    archive: {
      title: "Nada arquivado",
      body: "Gravações arquivadas ficam ocultas da biblioteca, mas são mantidas em segurança. Você sempre pode restaurá-las depois.",
    },
    trash: {
      title: "A lixeira está vazia",
      body: "Gravações excluídas aparecem aqui por 30 dias antes de serem removidas permanentemente.",
    },
    search: {
      title: "Nenhum resultado",
      body: "Tente outro termo de busca ou verifique seus filtros.",
    },
  },
  settings: {
    openAgentSettings: "Abrir configurações do agente",
    agentDescription:
      "Abra as configurações do agente na barra lateral para modelos, chaves de API, automações, voz e outros controles.",
    agentTitle: "Configurações do agente",
    title: "Configurações",
    intro: "Preferências e serviços conectados para este espaço do Clips.",
    languageTitle: "Idioma",
    languageDescription:
      "Escolha o idioma da interface para esta conta. O Clips lembrará em todos os seus dispositivos.",
    languageLabel: "Idioma da interface",
    profile: "Perfil",
    email: "E-mail",
    displayName: "Nome de exibição",
    displayNamePlaceholder: "Seu nome",
    playback: "Reprodução",
    defaultPlaybackSpeed: "Velocidade padrão de reprodução",
    playbackDescription:
      "Aplicada automaticamente quando você abre uma gravação.",
    transcript: "Transcrição",
    transcriptCleanup: "Limpeza em segundo plano",
    transcriptCleanupDescription:
      "Mostre a transcrição nativa imediatamente e depois limpe em segundo plano quando disponível.",
    notifications: "Notificações",
    emailNotifications: "Notificações por e-mail",
    emailNotificationsDescription:
      "Receba um e-mail quando alguém comentar, reagir ou compartilhar uma gravação com você.",
    saved: "Configurações salvas",
    saveFailed: "Falha ao salvar",
    builderConnectedToast: "Builder.io conectado",
    videoStorage: "Armazenamento de vídeo",
    videoStorageDescription:
      "Builder.io é o caminho principal de armazenamento para uploads do Clips. S3 está disponível quando você precisa trazer seu próprio bucket.",
    checkingBuilder: "Verificando Builder.io",
    builderConnected: "Builder.io conectado",
    connectBuilder: "Conectar Builder.io",
    builderConnectedFor: "Usando Builder.io para {{orgName}}.",
    builderConnectedGeneric:
      "Novos clipes usam o provedor Builder.io conectado.",
    builderIncludes:
      "Inclui armazenamento de objetos, uploads e transcrição gerenciada para novos clipes.",
    s3Title: "Armazenamento compatível com S3",
    secondary: "Secundário",
    active: "Ativo",
    s3BuilderConnectedDescription:
      "Use isto apenas se este espaço deve enviar para seu próprio bucket em vez de Builder.io.",
    s3CurrentProvider: "Atualmente usando {{providerName}}.",
    s3OwnBucketDescription:
      "Use seu próprio bucket se não quiser armazenamento Builder.io.",
    configureS3: "Configurar S3",
    hideS3: "Ocultar S3",
    saveStorage: "Salvar armazenamento",
    storageSaved: "Configurações de armazenamento salvas",
    storageRequired: "Endpoint, bucket, access key e secret são obrigatórios.",
    apiSetup: "Configuração de IA",
    apiSetupDescription:
      "Builder.io é o caminho padrão para créditos de IA gerenciados. Chaves de provedor são opcionais e podem ser adicionadas aqui.",
    builderEasySetup: "Builder.io é a configuração mais simples",
    builderAiAvailable:
      "Créditos de IA incluídos e transcrição gerenciada estão disponíveis para Clips.",
    builderAiDescription:
      "Conecte Builder primeiro para usar créditos de IA incluídos, armazenamento de objetos, uploads e transcrição gerenciada.",
    providerKeyTitle: "Usar sua própria chave de provedor",
    providerKeyDescription:
      "Adicione chaves da Anthropic, OpenAI, Gemini, Groq ou OpenRouter para uso cobrado pelo provedor.",
    providerKeysSet: "{{count}} configuradas",
    checkingProviderKeys: "Verificando chaves de provedor…",
    keySet: "Configurada",
    replaceKey: "Substituir chave…",
    pasteProviderKey: "Cole primeiro uma chave de provedor.",
    apiKeySaved: "Chave de API salva",
    apiKeyFailed: "Falha ao salvar chave",
    slackTitle: "Agent-Native Clips para Slack",
    slackDescription:
      "Compartilhe um clipe público, cole o link no Slack e ele será reproduzido inline, sem etapas extras para quem assiste. Conecte cada espaço uma vez.",
    checkingSlack: "Verificando Slack",
    slackConnected_one: "{{count}} espaço conectado",
    slackConnected_many: "{{count}} espaços conectados",
    slackConnected_other: "{{count}} espaços conectados",
    slackOauthNeeded: "Credenciais OAuth necessárias",
    slackPreviewDescription:
      "Links públicos do Clips podem aparecer como prévias reproduzíveis no Slack.",
    connectSlack: "Conectar Slack",
    slackClientMissing:
      "Defina SLACK_CLIENT_ID e SLACK_CLIENT_SECRET para esta implantação antes de conectar espaços.",
    slackSigningMissing:
      "Defina SLACK_SIGNING_SECRET para verificar callbacks de eventos do Slack.",
    connectedBy: "Conectado por {{email}}",
    disconnectSlackLabel: "Desconectar {{team}}",
    slackConnectedToast: "Slack conectado",
    slackCheckedToast: "Conexão do Slack verificada",
    slackDisconnectedToast: "Slack desconectado",
    disconnectSlackTitle: "Desconectar Slack?",
    disconnectSlackDescription:
      "O Clips excluirá o token de bot armazenado para {{team}} e deixará de enviar prévias reproduzíveis do Slack.",
    thisWorkspace: "este espaço",
  },
};

export default messages;
