const messages = {
  root: {
    commandActions: "Ações",
    askPlan: "Perguntar ao Plan",
    openPlans: "Abrir planos",
    openRecaps: "Abrir recaps",
    commandAppearance: "Aparência",
    toggleTheme: "Alternar tema",
  },
  header: {
    plan: "Plano",
    settings: "Configurações",
    team: "Equipe",
    extensions: "Extensões",
  },
  navigation: {
    settings: "Configurações",
    ask: "Perguntar",
    plan: "Plano",
  },
  settings: {
    title: "Configurações",
    description: "Preferências de idioma e espaço de trabalho deste app.",
    languageTitle: "Idioma",
    languageDescription:
      "Escolha o idioma da interface. Essa preferência é salva na sua conta.",
    languageLabel: "Idioma da interface",
    workspaceTitle: "Espaço de trabalho",
    workspaceDescription:
      "Gerencie membros da equipe, acesso da organização e preferências compartilhadas.",
    openTeamSettings: "Abrir configurações da equipe",
    openResourceSettings: "Abrir configurações de recursos",
    agentTitle: "Configurações do agente",
    agentDescription:
      "Abra as configurações do agente na barra lateral para modelos, chaves de API, automações, voz e outros controles.",
    openAgentSettings: "Abrir configurações do agente",
    editorTitle: "Extensão do VS Code",
    editorDescription:
      "Abra e revise planos em um painel lateral dentro do VS Code em vez de uma aba separada do navegador.",
    openEditorExtension: "Obter a extensão do VS Code",
  },
  agent: {
    emptyState:
      "Peça ao agente do Plan para buscar recaps de PRs mesclados, inspecionar este documento, adicionar diagramas ou responder perguntas de código como planos visuais.",
    suggestionShipped: "O que foi lançado na última semana?",
    suggestionUi: "Como esta interface aparece?",
    suggestionApi: "Qual é a estrutura desta API?",
  },
  sidebar: {
    openNavigation: "Abrir navegação",
    navigation: "Navegação",
    navigationDescription: "Links de navegação do app",
    chats: "Chats",
    newPlanChat: "Novo chat do Plan",
    newChat: "Novo chat",
    renameChat: "Renomear chat",
    unpinChat: "Desafixar chat",
    pinChat: "Fixar chat",
    archiveChat: "Arquivar chat",
    planSection: "Plano",
    newPlan: "Novo plano",
    signInCreatePlan: "Entre para criar um plano",
    signInToCreate: "Entre para criar",
    signInKeepPlans: "Entre para criar e manter planos.",
    noPlans: "Ainda não há planos.",
    recapBadge: "Recap",
    viewAllPlans: "Ver todos os planos...",
    brandingSentLocal: "Solicitação de marca enviada ao agente de código local",
    brandingSent: "Solicitação de marca enviada ao agente de código",
    customizePlanBranding: "Personalizar a marca do Plan",
    customizeBranding: "Personalizar marca",
    customizeBrandingDescription:
      "Descreva as mudanças de marca para aplicar no Plan.",
    customizeBrandingPlaceholder:
      "Use nosso logo, altere o nome do app, atualize as cores...",
    expandSidebar: "Expandir barra lateral",
    collapseSidebar: "Recolher barra lateral",
    signIn: "Entrar",
  },
  chat: {
    suggestionShipped: "O que foi lançado na última semana?",
    suggestionUi: "Como é a nova interface de checkout?",
    suggestionAuth: "Quando a API de autenticação mudou?",
    suggestionApi: "Qual é o formato da API de cobrança?",
    emptyState: "Perguntar ao Plan",
    placeholder:
      "Pergunte o que foi enviado, o que mudou ou o que o codigo atual mostra...",
    heading: "Perguntar ao Plan",
    description:
      "Pesquise recaps de PRs mesclados, inspecione blocos visuais e publique respostas de codigo como diagramas, wireframes, specs de API e modelos de dados.",
  },
  editor: {
    slash: {
      text: {
        title: "Texto",
        description: "Paragrafo de texto simples",
      },
      heading1: {
        title: "Titulo 1",
        description: "Titulo grande",
      },
      heading2: {
        title: "Titulo 2",
        description: "Titulo de secao",
      },
      heading3: {
        title: "Titulo 3",
        description: "Subtitulo",
      },
      bulletedList: {
        title: "Lista com marcadores",
        description: "Lista sem ordem",
      },
      numberedList: {
        title: "Lista numerada",
        description: "Lista ordenada",
      },
      todoList: {
        title: "Lista de tarefas",
        description: "Itens de checklist",
      },
      quote: {
        title: "Citacao",
        description: "Citacao em bloco",
      },
      codeBlock: {
        title: "Bloco de codigo",
        description: "Trecho de codigo",
      },
      divider: {
        title: "Divisor",
        description: "Linha horizontal",
      },
      table: {
        title: "Tabela",
        description: "Tabela tres por tres",
      },
      image: {
        title: "Imagem",
        description: "Inserir uma imagem",
      },
      structuredTable: {
        title: "Tabela estruturada",
      },
    },
  },
  raw: {
    sidebar: {
      archiveChatFailed: "Nao foi possivel arquivar o chat.",
      renameChatFailed: "Nao foi possivel renomear o chat.",
    },
    canvas: {
      artboardCanvas: "Tela de prancheta do Plan",
      zoomIn: "Aproximar",
      zoomOut: "Afastar",
      markupSaveFailed: "Nao foi possivel salvar a marcacao. Tente novamente.",
    },
    document: {
      replaceImageFailed: "No se pudo reemplazar la imagen.",
      replacingImage: "Substituindo imagem…",
      imageReplaced: "Imagen reemplazada.",
      htmlFragment: "Fragmento HTML",
      optionalCss: "CSS opcional",
      invalidBlockDescription:
        "Este bloque generado no coincidio con el esquema de Plan, asi que se omitio mientras el resto del resumen siguio visible.",
      validationDetails: "Detalles de validacion",
    },
    localCodebase: {
      chooseCodebase: "Elegir base de codigo",
      clearCodebase: "Borrar base de codigo",
      syncCodebase: "Sincronizar base de codigo",
      codebaseSynced: "Base de codigo sincronizada",
      codebaseSyncFailed: "Fallo la sincronizacion de la base de codigo",
      chooseFolderFailed: "No se pudo elegir la carpeta",
      syncLocalFailed: "No se pudo sincronizar la base de codigo local.",
      folderUnavailable:
        "El acceso a carpetas no esta disponible en este navegador.",
      filesSynced: "{{count}} archivos sincronizados",
      lastSynced: "Ultima sincronizacion {{date}}",
      codebaseUnlinked: "Base de codigo desvinculada",
    },
    content: {
      addSummary: "Agrega un resumen breve del plan",
      changeStatistics: "Estadisticas de cambios",
      untitledPlan: "Plan sin titulo",
      saveFailed: "No se pudo guardar",
    },
    imageViewer: {
      actualSize: "Tamano real",
      closePreview: "Cerrar vista previa de imagen",
      copyImage: "Copiar imagen",
      downloadImage: "Descargar imagen",
      download: "Descargar",
      editDetails: "Editar detalles",
      fitToScreen: "Ajustar a pantalla",
      imageOptions: "Opciones de imagen",
      more: "Mas",
      openOriginal: "Abrir original",
      replaceImage: "Reemplazar imagen",
      viewFullSize: "Ver a tamano completo",
      uploadingImage: "Subiendo imagen…",
      image: "Imagen",
    },
    imageActions: {
      copiedUrl: "URL de imagen copiada.",
      copyFailed: "No se pudo copiar la imagen.",
      imageCopied: "Imagen copiada.",
      downloadStarted: "Descarga de imagen iniciada.",
      openedNewTab: "Imagen abierta en una nueva pestana.",
    },
    markdown: {
      copySectionLink: "Copiar enlace a esta seccion",
    },
    toc: {
      planSections: "Secoes do plano",
    },
    visual: {
      clearDesignSelection: "Borrar seleccion de diseno",
      designElement: "Elemento de diseno",
      visualReviewMode: "Modo de revision visual",
      prototype: "Prototipo",
      design: "Diseno",
      wireframes: "Wireframes",
    },
    blocks: {
      describeChange: "Describe un cambio…",
      describeChangeTo: "Describe un cambio en {{label}}",
    },
    pages: {
      planActions: "Acoes do plano",
    },
  },
  plansPage: {
    common: {
      cancel: "Cancelar",
      save: "salvar",
      delete: "excluir",
      deleting: "Excluindo...",
    },
    nouns: {
      plan: "plano",
      recap: "análise",
    },
    status: {
      updateFailed: "Falha ao atualizar o status do plano.",
      setPlanStatus: "Definir status do plano",
      setStatus: "Definir status",
      labels: {
        draft: "rascunho",
        review: "Em revisão",
        approved: "Aprovado",
        in_progress: "em andamento",
        complete: "Concluído",
        archived: "Arquivado",
      },
    },
    localMode: {
      privacyDetails: "Detalhes de privacidade do modo local",
      badge: "modo local",
      title: "Modo local 100% privado",
      description:
        "Seus dados nunca são salvos em nosso backend e nunca são vistos por nós. Esta página irá apenas renderizar e editar seus arquivos MDX locais.",
      openDocs: "Abra o documento.",
    },
    reader: {
      openingFile: "Abrindo arquivo em seu editor",
      linksDisabled:
        "Os links são desativados na revisão para que o documento permaneça no lugar.",
      visualPromptCopied: "Prompt de ingestão visual copiado",
      sentAnswers: "Enviou respostas ao agente",
      recapLinkCopied: "Link de recapitulação copiado",
      planLinkCopied: "Link Plan copiado",
      localPathCopied: "Caminho local copiado",
      enterRepoFolder: "Insira um caminho de pasta relativo ao repositório.",
      localPlanAlreadySaved: "O plano local já está salvo no repositório",
      savedLocalFiles: "Arquivos locais {{count}} salvos em {{path}}",
      localSourceUnavailable:
        "A fonte do plano local ainda não estava disponível.",
      localSourceFilesUnavailable:
        "Os arquivos de origem do plano local ainda não estavam disponíveis.",
      exportUnavailable: "A exportação de Plan não estava disponível.",
      desktopSyncUnavailable:
        "A sincronização de arquivos locais da área de trabalho não está disponível.",
      sourceFilesUnavailable:
        "Os arquivos de origem Plan ainda não estavam disponíveis.",
      syncedLocalFiles: "Arquivos locais {{count}} sincronizados",
      noSourceFiles: "Nenhum arquivo de origem Plan foi encontrado.",
      importedLocalSource: "Arquivos de origem locais importados",
      enableLocalSyncFailed:
        "Não foi possível ativar a sincronização de arquivos locais.",
      syncLocalFailed:
        "Não foi possível sincronizar o plano com arquivos locais.",
      planHtmlCopied: "Plan HTML copiado",
      planMarkdownCopied: "Plan Markdown copiado",
      planSourceDownloaded: "Plan fonte baixada",
      archiveFailed: "Falha ao arquivar o plano.",
      unarchiveFailed: "Falha ao desarquivar o plano.",
      recapMovedToDeleted: "Recapitulação movida para Excluído.",
      planMovedToDeleted: "Plan movido para Excluído.",
      recapRestored: "Recapitulação restaurada.",
      planRestored: "Plan restaurado.",
      recapPermanentlyDeleted: "Recapitulação excluída permanentemente.",
      planPermanentlyDeleted: "Plan excluído permanentemente.",
      saveAnswersFailed:
        "Não foi possível salvar as respostas. Elas foram enviadas apenas para o chat do agente.",
      sentCommentsWithScreenshots:
        "Enviou comentários e capturas de tela focadas ao agente",
      sentComments: "Enviou comentários ao agente",
      feedbackCopied: "Instruções de feedback copiadas",
      backToPlans: "De volta aos planos",
      openFullPlan: "Abrir plano completo",
      openPrototypeWindow: "Abrir janela de protótipo",
      sending: "Enviando",
      sendToAgent: "Enviar para agente",
      sendFeedback: "Enviar comentários",
      copyForAgent: "Cópia para seu agente",
      copyForAgentDescription:
        "Copia um prompt que você pode colar no bate-papo.",
      sendToInlineAgent: "Enviar para agente in-line",
      sendToInlineAgentDescription:
        "Publica comentários abertos no agente do lado do aplicativo.",
      localFiles: "Arquivos locais",
      localFilesNoHosted:
        "Nenhuma gravação ou compartilhamento de banco de dados hospedado.",
      copyLocalPath: "Copiar caminho local",
      saveToRepo: "Salvar no repositório...",
      saveSourceToFolder: "Salvar fonte na pasta...",
      hideComments: "Ocultar comentários",
      showComments: "Mostrar comentários",
      showAllComments: "Mostrar todos os comentários",
      fullPlan: "Plano completo",
      appView: "Visualização do aplicativo",
      fullScreen: "Tela cheia",
      lightMode: "Modo claro",
      darkMode: "Modo escuro",
      cleanWireframes: "Limpar wireframes",
      sketchyWireframes: "Wireframes esboçados",
      copyLink: "Copiar link",
      openDocs: "Abrir documentos",
      downloadSourceZip: "Fonte de download (.zip)",
      changeLocalFolder: "Alterar pasta local",
      linkLocalFolder: "Vincular pasta local",
      syncToLocalFolder: "Sincronizar com a pasta local",
      importLocalEdits: "Importar edições locais",
      autoSyncChanges: "Alterações de sincronização automática",
      export: "Exportar",
      copyMarkdown: "Copiar Markdown",
      downloadMarkdown: "Baixar Markdown",
      copyHtml: "Copiar HTML",
      downloadHtml: "Baixar HTML",
      copyFeedback: "Copiar comentários",
      saveLocalPlanToRepo: "Salvar plano local no repositório",
      chooseRepoFolder:
        "Escolha uma pasta relativa ao repositório para estes arquivos MDX.",
      repoFolder: "Pasta do repositório",
      replaceExistingFolder: "Substituir pasta existente",
      toggleAgentSidebar: "Alternar barra lateral do agente",
      toggleSideChat: "Alternar bate-papo paralelo",
      clickToComment: "Clique em {{noun}} ou selecione o texto para comentar",
      clickCanvasNote: "Clique na tela para colocar uma nota",
      dragCanvasCallout: "Arraste na tela para desenhar um texto explicativo",
      reviewMarkupTools: "Revise as ferramentas de marcação",
      stopCommenting: "Pare de comentar",
      pinComment: "Fixar um comentário",
      runtimeOpen: "Abrir",
      runtimeCloseCodePreview: "Fechar visualização do código",
      runtimeCommentAuthor: "Autor do comentário",
      runtimeComment: "Comentário",
      runtimePlanComment: "Plan comentário",
      runtimeCommentCount_one: "{{count}} comentário",
      runtimeCommentCount_other: "{{count}} comentários",
      runtimeCommentBy: "{{countLabel}} por {{names}}: {{message}}",
      runtimeCommentTitle: "{{countLabel}}: {{message}}",
      clientHtmlWorkingPlan: "Plano de trabalho",
      runtimeCommentCount_many: "{{count}} comentários",
    },
    share: {
      linkCopied: "Link compartilhável copiado",
      copyFailed: "Não foi possível copiar o link",
      createAccountToPublish:
        "Crie uma conta gratuita para publicar este {{noun}}",
      linkLabel: "link {{noun}}",
      description:
        "Privado por padrão. Convide pessoas, compartilhe com sua organização ou defina Público para revisão por qualquer pessoa com link.",
      peopleAccess: "Pessoas com acesso {{noun}}",
      generalAccess: "Acesso geral {{noun}}",
      shareAria: "Compartilhe {{noun}}",
      share: "Compartilhe {{noun}}",
      shareThis: "Compartilhe isto {{noun}}",
      hostedCopy:
        "Este {{noun}} local possui uma cópia hospedada para compartilhamento. Abra o {{noun}} hospedado para gerenciar o acesso.",
      publishDescription:
        "Crie uma conta gratuita para publicar este {{noun}} em um link compartilhável. Você pode continuar editando localmente com seu agente de codificação até fazer isso.",
      finishAccount: "Termine de criar sua conta, volte e geraremos o link.",
      checking: "Verificando",
      signedInRetry: "Estou conectado - tente novamente",
      updating: "Atualizando",
      updateLink: "Link de atualização",
      openHostedPlan: "Plano hospedado aberto",
      creatingLink: "Criando link",
      createShareableLink: "Crie um link compartilhável",
      accessNote:
        "Qualquer pessoa com acesso de edição pode alterar o {{noun}}. Visualizar um {{noun}} público não precisa de conta, mas comentar sobre ele requer uma conta nativa do agente.",
      visibility: {
        private: {
          label: "Privado",
          description: "Somente pessoas convidadas podem abrir este {{noun}}",
        },
        org: {
          label: "Organização",
          description:
            "Qualquer pessoa na sua organização com o link pode visualizar",
        },
        public: {
          label: "Público",
          description: "Qualquer pessoa com o link pode visualizar",
        },
      },
    },
    report: {
      reportAria: "Relatório {{noun}}",
      report: "Relatório {{noun}}",
      description: "Diga-nos por que este {{noun}} público deve ser revisado.",
      reason: "Motivo",
      details: "Detalhes",
      detailsPlaceholder: "Adicione uma breve nota para moderadores",
      submit: "Enviar relatório",
      reasons: {
        spam: "Spam ou enganoso",
        harassment: "Assédio",
        hate: "Conteúdo odioso",
        sexual: "Conteúdo sexual",
        violence: "Violência ou ameaças",
        "self-harm": "Auto-mutilação",
        privacy: "Preocupação com privacidade",
        illegal: "Atividade ilegal",
        other: "Outra coisa",
      },
    },
    skeleton: {
      loadingRecap: "Carregando recapitulação",
      loadingPlan: "Carregando plano",
    },
    localPlanLoadError: {
      title: "Plano local não encontrado",
      message: 'A pasta do plano local "{{slug}}" não pôde ser lida.',
    },
    overview: {
      title: "plano",
      documentCount_other: "{{count}} documentos",
      newPlan: "Novo plano",
      signInToCreate: "Faça login para criar",
      tabs: {
        all: "todos",
        plans: "plano",
        recaps: "análise",
        archived: "Arquivado",
        deleted: "Excluído",
      },
      createdBy: "Criador",
      allAuthors: "Todos os autores",
      me: "EU",
      searchPlaceholder: "Plano de pesquisa...",
      empty: {
        noMatch: "Não há plano correspondente.",
        noArchived: "Não há planos arquivados.",
        noDeleted: "Não há planos excluídos.",
        noPlans: "Não há planos aqui ainda.",
      },
      recapBadge: "análise",
      deletedBadge: "Excluído",
      deletedAt: "Excluído em {{date}}",
      planActions: "Planejar operações",
      restore: "recuperar",
      deletePermanently: "Excluir permanentemente",
      unarchive: "Desarquivar",
      archive: "Arquivo",
      delete: "excluir...",
      documentCount_one: "{{count}} documentos",
      documentCount_many: "{{count}} documentos",
      documentCount: "Contagem de documentos",
    },
    empty: {
      title: "Comece com um plano visual",
      description:
        "Crie um plano sofisticado com blocos de documentação editáveis, diagramas, wireframes e comentários antes de iniciar a implementação.",
      newPlan: "Novo plano",
      installPrefix:
        "Ou instale a habilidade e use-a em seu agente de codificação",
      installSuffix: "：",
    },
    loggedOut: {
      title: "Comece com /visual-plan",
      description:
        "Instale a habilidade Plan em seu agente de codificação e use o comando de barra para criar o primeiro plano de auditoria.",
      installCopied: "Comando de instalação copiado",
      installCopyFailed: "Não é possível copiar o comando de instalação",
      copyInstallCommand: "Copie o comando de instalação",
      copied: "Copiado",
      copy: "cópia",
      viewDocs: "Ver documentação",
    },
    skillDemos: {
      "visual-plan": {
        label: "Planejamento visual",
        description:
          "Revise o formulário de implementação antes que as alterações no código sejam implementadas.",
        videoAriaLabel:
          "Vídeo de demonstração de habilidades de planejamento visual",
      },
      "visual-recap": {
        label: "Revisão visual",
        description: "Converta PR ou diff em uma revisão compartilhável.",
        videoAriaLabel:
          "Vídeo de demonstração de habilidades de revisão visual",
      },
    },
    history: {
      surface: {
        prototype: "protótipo",
        canvas: "tela",
        blocks_other: "{{count}} blocos",
        sections_other: "{{count}} capítulos",
        blocks_one: "{{count}} blocos",
        blocks_many: "{{count}} blocos",
        sections_one: "{{count}} capítulos",
        sections_many: "{{count}} capítulos",
        blocks: "Blocos",
        sections: "Seções",
      },
      restoreSuccess: "A versão planejada foi restaurada.",
      restoreFailed: "A versão do plano de recuperação falhou.",
      back: "Voltar à história",
      title: "Histórico do programa",
      description:
        "Procure versões de planos salvas e restaure instantâneos anteriores.",
      untitled: "plano sem nome",
      snapshotUnavailable: "O instantâneo não está disponível",
      previewTitle: "Visualização da versão do plano",
      noPreview: "Este instantâneo não tem conteúdo para visualização.",
      restoreThisVersion: "Restaurar esta versão",
      savedFirst: "A versão atual será salva primeiro no histórico.",
      versionActions: "Operação de versão",
      noVersions: "Ainda não há versões salvas",
      noVersionsDescription:
        "A versão será salva automaticamente antes de editar o plano no futuro.",
      restoreConfirmTitle: "Restaurar esta versão?",
      restoreConfirmDescription:
        "Isso substitui o plano atual por um instantâneo de {{date}}. A versão atual é salva primeiro no histórico para que você possa desfazê-la.",
      restoring: "Recuperando...",
      restore: "recuperar",
    },
    create: {
      sourceOptions: {
        codex: "Codex",
        "claude-code": "Claude Code",
        cursor: "Cursor",
        pi: "Pi",
        manual: "Manual",
        imported: "Importado",
      },
      kindOptions: {
        auto: {
          label: "automático",
          description:
            "Automático - escolhe o caminho de planejamento apropriado",
        },
        ui: {
          label: "UI Processo",
          description: "Processo UI - Wireframes e Estados",
        },
        questions: {
          label: "Problema de visualização",
          description: "Visualize o problema - colete requisitos claramente",
        },
        visual: {
          label: "Visualização geral",
          description: "Visualização geral – gráficos e notas",
        },
      },
      presets: {
        checkout: "Processo de check-out",
        settings: "Redesenho da configuração",
        imported: "Plano importado",
      },
      presetPrompts: {
        checkout:
          "Planeje um fluxo de revisão de checkout com wireframes para desktop e mobile, estados principais vazio/carregando/erro, prompts de comentário e notas de implementação.",
        settings:
          "Crie um plano de fluxo de UI para um redesenho de configurações, incluindo estados de navegação, interações de risco, anotações de revisão e notas de repasse para código.",
        imported:
          "# Plano de implementação\n\nCole aqui o plano existente do Codex ou Claude Code e transforme-o em um documento de revisão visual.",
      },
      assessment: {
        ui: "O estado ou processo UI é detectado automaticamente; o agente criará um plano wireframe-first.",
        visual:
          "Permite automaticamente que os agentes criem planos técnicos avançados com diagramas e detalhes de implementação.",
      },
      autoWithLabel: "Automático: {{label}}",
      agentMissing:
        "Conecte o agente para executar - adicione a chave API ou use Builder.",
      describeFirst: "Por favor, descreva o plano primeiro.",
      sent: "Enviado para agente Plan",
      title: "Deixe o agente criar o plano",
      description:
        "Descreva o plano desejado ou cole um plano Codex/Claude existente. O agente Plan gera wireframes e estruturas de revisão.",
      placeholder:
        "Por favor, crie processo UI, diagrama de implementação, notas de revisão...",
      advanced: "avançado",
      source: "fonte",
      sourceHelp:
        "Usado apenas como referência de fonte para ajudar a explicar onde o plano começa.",
      planningStyle: "Estilo de plano de agência",
      planningHelp:
        "O plano colado é detectado e enviado ao agente com o contexto de importação. Mantém automaticamente o processo de planejamento regular; se quiser coletar os requisitos primeiro, selecione Perguntas Visuais.",
      importDetected:
        "Parece um plano existente. O agente preserva sua intenção e adiciona uma estrutura de revisão visual.",
    },
    loadError: {
      genericMessage: "Este plano não pode ser carregado da sessão atual.",
      orgBody:
        "Este programa pertence a {{orgName}}. Você precisa ser membro de {{orgName}} para visualizá-lo.",
      orgTitle: "Cadastre-se em {{orgName}} para visualizar este plano",
      createAccountFailed: "Não foi possível criar a conta.",
      emailSignInFailed: "Não é possível fazer login usando e-mail.",
      verifyEmail:
        "Verifique seu e-mail para verificar sua conta e reabrir este link.",
      notFoundTitle: "Plano não encontrado",
      requestAccessTitle: "Solicite acesso a este programa",
      signInTitle: "Faça login para visualizar este plano",
      didNotLoadTitle: "Plano não carregado",
      notFoundBody:
        "Este programa não existe ou pertence a outra organização e você precisa de acesso.",
      noAccessBody:
        "Este plano existe, mas esta conta não tem permissão para visualizá-lo.",
      maybeOtherOrgBody:
        "Este programa pode pertencer a outra organização ou esta conta pode não ter acesso.",
      privateBody:
        "Este programa é privado. Faça login com uma conta que tenha direitos de acesso.",
      signedInAs: "Atualmente logado como",
      accessRequestSent:
        "Solicitação de acesso enviada. Depois que o proprietário conceder acesso, você poderá abrir o link.",
      retryHelp:
        "Tente carregar novamente ou faça login com uma conta diferente se este for um link de plano privado.",
      continueWithGoogle: "Use Google para continuar",
      switchAccount: "Trocar de conta",
      signInWithEmail: "Faça login usando e-mail",
      email: "Correspondência",
      password: "senha",
      createAccount: "criar uma conta",
      signIn: "Conecte-se",
      haveAccount: "Eu já tenho uma conta",
      retry: "Tente novamente",
      joinedOrg: "Inscreveu-se em {{orgName}}. Plano de abertura...",
      acceptingInvite: "Aceitando convite",
      joiningOrg: "Aderindo à organização",
      acceptInvite: "aceitar convite",
      joinOrg: "Junte-se a {{orgName}}",
      requestSent: "Solicitação enviada",
      requestAccess: "Solicitar acesso",
      inviteMessage:
        "Você recebeu um convite de {{orgName}}. Aceite o convite para abrir este programa.",
      domainMessage:
        "Seu endereço de e-mail @{{domain}} pode ser adicionado a {{orgName}}. Depois de entrar, você pode abrir o programa.",
      joinMessage:
        "Você pode ingressar em {{orgName}} para abrir este programa.",
    },
    comments: {
      expectedResolver: "processador pretendido",
      agent: "atuando",
      human: "Artificial",
      toAgent: "Enviar para agente",
      cancelComment: "Cancelar comentário",
      addPlaceholder: "Adicione um comentário...",
      saving: "Salvando",
      saveFailed: "Não foi possível salvar. Por favor, tente novamente.",
      signInTitle: "Faça login para comentar",
      signInDescription:
        "Crie uma conta gratuita para deixar um comentário sobre este programa.",
      replyPlaceholder: "responder",
      sendReply: "Enviar resposta",
      sendFailed: "Não foi possível enviar. Por favor, tente novamente.",
      comment: "Comentário",
      comments: "Comentário",
      humanReview: "Revisão manual",
      agentAction: "Operação do agente",
      options: "Opções de comentários",
      reopenThread: "Reabrir o tópico",
      markResolved: "Marcar como resolvido",
      editFirstComment: "Editar o primeiro comentário",
      closeComment: "Fechar comentários",
      editPlaceholder: "Comentário do editor...",
      closeComments: "Fechar comentários",
      open: "Abrir",
      resolved: "Resolvido",
      noResolved: "Não há comentários resolvidos.",
      commentUpdated: "Comentário atualizado",
      replyAdded: "Resposta adicionada",
      commentDeleted: "Comentário excluído",
      commentResolved: "Comentário resolvido",
      commentReopened: "Comentário reaberto",
      mentionMember: "Mencionar membro da organização",
      searchingPeople: "Buscando pessoas...",
      noMatchingMembers: "Nenhum membro da organização correspondente.",
      noOpen:
        "Não há comentários abertos. Clique em Comentários e em Colocar comentário.",
      deleteThreadTitle: "Excluir tópico?",
      deleteCommentTitle: "Excluir comentário?",
      deleteThreadDescription_other:
        "Isso removerá o comentário e as respostas {{count}} do plano.",
      deleteCommentDescription: "Isso removerá o comentário da programação.",
      deleteThread: "Excluir tópico",
      deleteComment: "Excluir comentário",
      deleteThreadDescription_one:
        "Isso removerá o comentário e as respostas {{count}} do plano.",
      deleteThreadDescription_many:
        "Isso removerá o comentário e as respostas {{count}} do plano.",
      deleteThreadDescription: "Excluir descrição do tópico",
    },
    deletePlan: {
      hardTitle: "Excluir este {{noun}} permanentemente?",
      softTitle: "Excluir este {{noun}}?",
      description:
        "{{title}} não aparecerá mais na visualização de planejamento normal.",
      fallbackTitle: "Este plano de hospedagem",
      moveToDeleted: "Mover para excluído",
      softOptionDescription:
        "Oculte, interrompa instantaneamente o acesso público e mantenha os recursos de recuperação.",
      deletePermanently: "Excluir permanentemente",
      hardOptionDescription:
        "Remova linhas e referências gerenciadas. Esta ação não pode ser desfeita.",
      softDescription:
        'A exclusão reversível moverá {{noun}} para o rótulo "Excluído". Links diretos, compartilhamento público, comentários e leituras de proxy deixarão de funcionar até que você os restaure.',
      permanentWarning: "A exclusão permanente não pode ser desfeita.",
      permanentDescription:
        "Isso excluirá os {{noun}} hospedados, comentários, compartilhamentos, atividades, versões, relatórios e registros de ativos Plan SQL. As regras de ciclo de vida do arquivo local e do provedor de upload externo são independentes.",
      typePrefix: "digitar",
      typeSuffix: "confirmar",
    },
    wireframe: {
      emptyDiagram: "O conteúdo do diagrama está vazio.",
      usageFree: "1% usado · 198k livres",
      contextXray: "Raio X de contexto",
      contextXrayPopover: "Popover do Context X-Ray",
      pinnedZero: "Fixados 0",
      evictedZero: "Removidos 0",
      userMessage: "Mensagem do usuário",
      toolResult: "Resultado da ferramenta",
      pinEvict: "Fixar / remover",
      tokenMap: "Mapa de tokens",
      selectedTokens: "Selecionados 2.0k",
      chatMessages: "Mensagens do chat",
      thinkingStatus: "Status de raciocínio",
      appShell: "Shell do app",
      chatThread: "Thread de chat",
      agentSidebar: "Barra lateral do agente",
      xray: "Raio X",
    },
  },
  guest: {
    banner:
      "Voce esta navegando como convidado. Entre para criar planos, deixar comentarios e manter seu trabalho.",
    signIn: "Entrar",
  },
};

export default messages;
