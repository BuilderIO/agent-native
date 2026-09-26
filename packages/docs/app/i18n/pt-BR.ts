import enUS from "./en-US";

const ptBR = {
  language: {
    label: "Idioma",
    system: "Sistema",
    systemDescription: "Usar o idioma do navegador",
    suggestionTitle: "Ler esta página em {{language}}?",
    suggestionDescription: "O idioma do seu navegador é {{language}}.",
    suggestionSwitch: "Mudar para {{language}}",
    suggestionKeepEnglish: "Manter em inglês",
  },
  header: {
    docs: "Documentos",
    templates: "Apps",
    skills: "Habilidades",
    searchAria: "Pesquisar na documentação",
    searchPlaceholder: "Pesquisar docs...",
    askAssistant: "Perguntar à IA",
    toggleNavigation: "Alternar menu de navegação",
    copyLogoSvg: "Copiar SVG do logotipo",
    copyWordmark: "Copiar logotipo textual",
    brandAssets: "Recursos da marca",
    tryNow: "Experimente agora",
  },
  footer: {
    download: "Baixar",
    pricing: "Preços",
    brand: "Marca",
    privacy: "Privacidade",
    terms: "Termos",
  },
  feedback: {
    label: "Comentários",
    placeholder: "Conte o que deixaria esta documentação melhor.",
  },
  demoVideo: {
    visualPlanningAria: "Demonstração de planejamento visual do Agent-Native",
  },
  docBlocks: {
    blockLabel: "Bloco {{alias}}",
    unknownBlockType: "tipo de bloco desconhecido",
  },
  theme: {
    light: "claro",
    dark: "escuro",
    toggle: "Alternar tema",
    label: "Tema: {{theme}}",
  },
  docs: {
    navigateAria: "Navegar pelos docs",
    onThisPage: "Nesta página",
    copyMarkdown: "Copiar doc como Markdown",
    copiedMarkdown: "Markdown copiado",
    copyMarkdownError: "Não foi possível copiar Markdown",
    previous: "Anterior",
    next: "Próximo",
    draftLabel: "Rascunho",
    draftDescription:
      "Esta página está em andamento. O conteúdo pode estar incompleto ou sujeito a alterações antes da publicação.",
    translationLabel: "Traduzido automaticamente",
    translationDescription:
      "Esta página foi traduzida automaticamente e pode não ser totalmente precisa.",
    translationViewOriginal: "Ver o original em inglês",
  },
  search: {
    dialogLabel: "Pesquisar documentação",
    placeholder: "Pesquisar documentação...",
    empty: "Digite para pesquisar em toda a documentação",
    toggleChatSidebar: "Alternar barra lateral do chat",
    loadError: "A busca não pôde ser carregada. Tente novamente.",
    retry: "Tentar novamente",
    noResults: 'Nenhum resultado para "{{query}}"',
    browseAllDocs: "Ver todos os docs",
    navigate: "navegar",
    open: "abrir",
    close: "fechar",
  },
  agent: {
    emptyState: "Pergunte qualquer coisa sobre Agent-Native",
    suggestionGettingStarted: "Como começo com Agent-Native?",
    suggestionActions: "Como as actions funcionam?",
    suggestionPolling: "Explique o modelo de sincronização por polling",
    suggestionDeploy: "Como faço deploy em produção?",
  },
  errors: {
    loadingLatest: "Carregando a versão mais recente...",
    notFoundTitle: "Página não encontrada",
    notFoundBody: "A página que você procura não existe ou foi movida.",
    goHome: "Ir para o início",
    readDocs: "Ler a documentação",
    genericTitle: "Algo deu errado",
    genericBody: "Ocorreu um erro inesperado.",
    sendFeedback: "Enviar feedback",
    feedbackPlaceholder:
      "Descreva o que aconteceu antes deste erro do Docs aparecer.",
    openGitHubIssue: "Abrir issue no GitHub",
  },
  home: {
    hero: {
      titleLine1: "O framework para",
      titleAccent: "apps agentic",
      body: "Não escolha entre apps e agents. As apps Agent-Native são as duas coisas.",
      primaryCta: "Testar uma app",
      secondaryCta: "Ler a documentação",
    },
    code: {
      quickStartComment: "Crie uma app com um comando",
      skillInstallComment:
        "Adicione planejamento Agent-Native a um coding agent que você já usa",
      frameworkComment: "Um action impulsiona agent, UI, HTTP, MCP, A2A e CLI.",
      frameworkDescription: "Diga olá a partir do app-agent loop local.",
    },
    actionSurface: {
      eyebrow: "Profundamente agentic, não IA colada por fora",
      title: "Uma action abre toda a superfície",
      body: "Defina uma operação uma vez. O Agent-Native transforma isso em ação de UI, ferramenta do agent, endpoint HTTP, superfície MCP/A2A, comando CLI, verificação de permissão e trilha de auditoria.",
      buildAction: "Criar uma action",
      benefits: {
        oneActionDefinition: {
          title: "Uma definição de action",
          body: "UI, agent, HTTP, MCP, A2A e CLI chamam a mesma operação.",
        },
        scopedByDefault: {
          title: "Escopo por padrão",
          body: "Auth, compartilhamento, governança e audit logs acompanham o trabalho.",
        },
        headedOrHeadless: {
          title: "Apps, automações e agents",
          body: "Rode a mesma operação a partir de chat, UI, jobs agendados, filas, agents externos ou scripts.",
        },
        contextRichInput: {
          title: "Entrada rica em contexto",
          body: "Chat, voz, skills, instruções e estado da UI ficam no ciclo.",
        },
        openAgentProtocols: {
          title: "Protocolos abertos de agent",
          body: "A2A, MCP, MCP apps e agents externos são primitivas do framework.",
        },
        observableByDesign: {
          title: "Observável por design",
          body: "Traces, evals, feedback e histórico de auditoria tornam o trabalho do agent inspecionável.",
        },
      },
    },
    modules: {
      pageEyebrow: "Framework modular",
      title: "Módulos integrados para apps agentic",
      body: "Peças verificadas por humanos para partes de produção que agents não deveriam inventar do zero. Use como estão, inspecione o código-fonte ou troque o módulo quando sua app precisar de algo diferente.",
      pageBody:
        "O Agent-Native traz peças verificadas por humanos para o trabalho de produção que agents não deveriam improvisar. Use como estão, inspecione o código-fonte ou troque o módulo quando seu produto precisar de algo diferente.",
      viewAll: "Ver todos os módulos",
      browseApps: "Explorar apps criadas com módulos",
      items: {
        autoStateSyncing: {
          title: "Sincronização automática de estado",
          body: "Mudanças do agent atualizam a UI, e o estado da UI continua visível para o agent sem outra ponte.",
        },
        actions: {
          title: "Ações",
          body: "Defina o trabalho uma vez e use pela UI, agent, HTTP, MCP, A2A e CLI.",
        },
        sqlStateOrm: {
          title: "Estado PostgreSQL e ORM",
          body: "Dados duráveis da app, estado da aplicação, migrações e esquemas PostgreSQL/PGlite.",
        },
        dbAdmin: {
          title: "Admin de banco de dados",
          body: "Esquemas legíveis por agents, superfícies de consulta, migrações e ferramentas admin sem back office próprio.",
        },
        authGovernance: {
          title: "Auth e governança",
          body: "Login, organizações, multi-tenancy, permissões, aprovações e hooks de política.",
        },
        sharing: {
          title: "Compartilhamento",
          body: "Links compartilhados, acesso com escopo, recursos públicos ou privados, comentários e superfícies de revisão.",
        },
        realtimeCollaboration: {
          title: "Colaboração em tempo real",
          body: "Edição multiusuário, presença ao vivo, UI otimista e reconciliação apoiada pelo servidor.",
        },
        agentInteroperability: {
          title: "Interoperabilidade de agents",
          body: "A2A, MCP, MCP apps, agents externos, harness agents e passagens entre apps.",
        },
        automationsQueues: {
          title: "Automações e filas",
          body: "Trabalho acionado por eventos, tarefas agendadas, execuções em background e mutations confiáveis.",
        },
        agentUiSurface: {
          title: "Superfície de UI do agent",
          body: "Chat, skills, instruções, UI generativa, entrada por voz e contexto visível ao agent.",
        },
        observability: {
          title: "Observabilidade",
          body: "Traces, evals, feedback, experimentos e prova do que os agents disseram ter feito.",
        },
        workspaces: {
          title: "Workspaces",
          body: "Apps agentic componíveis que se descobrem e coordenam por A2A.",
        },
        sourceOwnership: {
          title: "Posse do código-fonte",
          body: "Docs e código ficam onde agents podem inspecionar, possuir, ejetar, corrigir ou substituir.",
        },
        auditLogs: {
          title: "Logs de auditoria",
          body: "Um registro durável de mudanças humanas e de agents, limitado aos recursos que usuários podem acessar.",
        },
      },
    },
    framework: {
      title: "O framework para apps agent-native",
      body1:
        "Agent-Native é um framework open source para construir agentic applications: comece com Chat, defina actions compartilhadas e depois adicione UI, jobs e colaboração ao redor do mesmo estado.",
      body2:
        "Use PGlite local ou PostgreSQL hospedado, seu provedor de hospedagem, stack de modelos e código da app.",
      cta: "Ler o guia do framework",
      primitives: {
        actions: {
          title: "Ações",
          description:
            "Defina o trabalho uma vez. Use-o a partir de agent, UI, API, MCP e A2A.",
        },
        sharedState: {
          title: "Estado compartilhado",
          description:
            "O estado da app com suporte em SQL mantém pessoas, agents e sessões em sincronia.",
        },
        agentRuntime: {
          title: "Runtime de agent",
          description:
            "O app-agent loop, tools, skills, memory, jobs e observabilidade são entregues juntos.",
        },
        postgresSpecific: {
          title: "Específico de PostgreSQL",
          description:
            "Use os auxiliares de esquema PostgreSQL da estrutura com PGlite local ou Postgres hospedado em qualquer host compatível com Nitro.",
        },
      },
    },
    templates: {
      title: "Experimente uma app Agent-Native",
      eyebrow: "Comece com uma app funcional e deixe o agente evoluí-la.",
      cta: "Ver apps",
    },
    skills: {
      title: "Experimente com um skill",
      body: "Adicione planejamento visual e PR recaps ao Claude Code, Codex, Cursor, Pi, OpenCode ou VS Code com um comando.",
      planBody:
        "Planos revisáveis com diagramas, wireframes, mapas de arquivos e comentários antes de mudanças no código.",
      recapBody:
        "Um resumo visual de um PR ou diff para que reviewers vejam o formato antes das linhas brutas.",
      cta: "Explorar o Skills Guide",
    },
    connected: {
      title: "Agents e UI totalmente conectados",
      body: "O agent e a UI são cidadãos iguais do mesmo sistema. Cada action funciona nos dois sentidos: clique ou peça.",
      tabs: {
        agentSees: {
          title: "O agent vê tudo",
          description:
            "Ele pode ler e atualizar qualquer UI, qualquer dado e qualquer estado da aplicação.",
        },
        uiTalks: {
          title: "A UI conversa com o agent",
          description:
            "Botões, formulários e workflows enviam conteúdo estruturado ao agent, criando fluxos guiados que passam pelo agent, incluindo skills, rules e instructions.",
        },
        agentUpdates: {
          title: "O agent atualiza seu próprio código",
          description:
            "Ele pode modificar a própria app para mudar features e funcionalidade. Suas tools melhoram com o tempo.",
        },
        everything: {
          title: "Tudo funciona nos dois sentidos",
          description:
            "Cada action disponível na UI também está disponível para o agent. Você pode clicar para fazer algo ou pedir ao agent que faça.",
        },
      },
    },
    comparison: {
      titleLine1: "Não escolha entre apps ou agents.",
      titleAccent: "Apps agent-native são os dois.",
      columns: {
        saas: "Ferramentas SaaS",
        agents: "Agentes AI brutos",
        internal: "Ferramentas internas",
        native: "App Agent-Native",
      },
      rows: {
        ui: "UI",
        ai: "AI",
        customization: "Personalização",
        ownership: "Propriedade",
      },
      cells: {
        polishedButRigid: "Polidas, mas rígidas",
        none: "Nenhuma",
        mixedQuality: "Qualidade irregular",
        fullUi: "UI completa, personalize e pronto",
        boltedOn: "Acoplada depois",
        powerful: "Poderosa",
        shallowlyConnected: "Conexão superficial",
        agentFirst: "Agent-first, integrada",
        cant: "Não dá",
        instructionsAndSkills: "Instructions e skills",
        fullHighMaintenance: "Completa, mas com alta manutenção",
        agentModifies: "Agent modifica a app",
        rented: "Alugada",
        somewhatYours: "Em parte sua",
        youOwnCode: "O código é seu",
      },
    },
    quickStart: {
      title: "Comece com um comando",
      body: "Um comando cria uma app local chat-first com suporte em actions, durable threads e PGlite. Use `--headless` apenas para workflows automation-first sem UI no navegador ainda.",
    },
    finalCta: {
      title: "Software feito para a era agentic",
      body: "Comece com um comando ou um durable action, rode pelo app-agent loop e depois expanda para UI, jobs e colaboração sem reescrever a operação. Open source. Cloneable SaaS. Seu.",
      primaryCta: "Testar uma app",
      secondaryCta: "Ler a documentação",
      githubCta: "Ver no GitHub",
    },
    batteries: {
      titleLine1: "Tudo incluído,",
      titleLine2: "testado em produção",
      body: "Em vez de começar de um prompt vazio e código improvisado, o Agent-Native dá aos agentes componentes testados e boas práticas para criar software real.",
      browseToolkits: "Explorar toolkits",
    },
    featureCloud: {
      notifications: "Notificações",
      recurringJobs: "Jobs recorrentes",
      actions: "Ações",
      agentTeams: "Equipes de agentes",
      monorepos: "Monorepositórios",
      permissions: "Permissões",
      rbac: "RBAC",
      organizations: "Organizações",
      workspaceSecrets: "Segredos do workspace",
      docsSearch: "Busca em docs",
      sourceSearch: "Busca no código",
      contextAwareness: "Consciência de contexto",
      observability: "Observabilidade",
      realtimeSync: "Sincronização em tempo real",
      sqlState: "Estado SQL",
      multiTenancy: "Multilocação",
      dataLoaders: "Carregadores de dados",
      liveQueries: "Consultas ao vivo",
      agentInstructions: "Instruções do agente",
      providerGrants: "Subsídios de provedores",
      comments: "Comentários",
      reviewLinks: "Revisar links",
      privacyControls: "Controles de privacidade",
      skills: "Habilidades",
      security: "Segurança",
      auditLogs: "Registros de auditoria",
      workspaces: "Espaços de trabalho",
      voiceInput: "Entrada de voz",
      mcpApps: "MCP aplicativos",
      generativeUi: "UI generativa",
      toolCalls: "Chamadas de ferramentas",
      agentSidebar: "Barra lateral do agente",
      sharedActions: "Ações compartilhadas",
      uiSurfaces: "UI superfícies",
      i18n: "i18n",
      mcpAuth: "MCP Autenticação",
      battleTestedComponents: "Blocos testados",
      mcpA2a: "MCP + A2A",
      externalAgents: "Agentes externos",
      a2aHandoffs: "A2A transferências",
      humanHandoff: "Transferência humana",
      agentContext: "Contexto do agente",
      durableResume: "Currículo durável",
      extensions: "Extensões",
      sharingPrivacy: "Compartilhamento e privacidade",
      realTimeCollaboration: "Colaboração em tempo real",
      sso: "SSO",
      oauth: "OAuth",
      mcpServers: "Servidores MCP",
      scopedAccess: "Acesso com escopo",
      dbAdapters: "Adaptadores de banco de dados",
      auth: "Autenticação",
      approvals: "Aprovações",
      automations: "Automações",
      governance: "Governança",
      jobs: "Empregos",
      agUi: "AG-UI",
      dispatch: "Dispatch",
      backgroundRuns: "Execuções em segundo plano",
      rateLimits: "Limites de taxa",
      queues: "Filas",
      cronSchedules: "Cronogramas",
      analytics: "Analises",
      experiments: "Experimentos",
      feedbackLoops: "Ciclos de feedback",
      fileUploads: "Uploads de arquivos",
      evals: "Avaliações",
      templates: "Apps",
      providerApis: "Provedor APIs",
      agentWebSurfaces: "Superfícies da Web do agente",
      templateSkills: "Habilidades de app",
      oneClickForks: "Criação de app com um clique",
      localFileMode: "Modo de arquivo local",
      memory: "Memória",
      webhooks: "Webhooks",
      http: "HTTP",
      selfEditingCode: "Código de autoedição",
      cli: "CLI",
      crossAppSso: "Entre aplicativos SSO",
      schemaMigrations: "Migrações de esquema",
      hostedDeploys: "Implantações hospedadas",
      environmentSetup: "Configuração do ambiente",
      oauthCallbacks: "retornos de chamada OAuth",
      exports: "Exportações",
      dashboards: "Painéis",
    },
  },
  common: {
    copied: "Copiado",
    copyFailed: "Falha ao copiar",
    copyCommand: "Comando copiar",
    copyCode: "Copiar código",
    tryIt: "Experimentar",
    customizeIt: "Personalizar",
    editOnline: "Editar online",
    runLocally: "Executar localmente",
    viewDocs: "Ver docs",
    source: "Fonte",
    readDocs: "Leia os documentos",
    signIn: "Entrar",
    tryTemplateFree: "Experimente {{name}} grátis",
    designForFree: "Crie de graça",
    recordForFree: "Grave de graça",
    getStarted: "Começar",
    freeAndOpenSource: "100% grátis • código aberto",
    viewAllApps: "Ver todos os apps",
  },
  homepage: {
    hero: {
      title: "O framework para aplicativos agentic",
      bodyLine1: "Crie agentes autônomos com interfaces intuitivas.",
      bodyLine2: "Traga seu próprio LLM. Implante em qualquer lugar.",
      tryAnApp: "Experimentar um app",
    },
    install: {
      copyCommand: "Copiar comando de instalação",
    },
    actions: {
      title: "Uma Action alimenta cada superfície",
      bodyLine1: "Defina uma capacidade uma vez com defineAction().",
      bodyLine2:
        "Seu agente, sua UI React, clientes HTTP e integrações usam o mesmo código.",
      diagramAlt:
        "Uma Action alimenta UI, MCP, chat do agente, A2A, HTTP API e CLI",
    },
    builtIn: {
      title: "Tudo o que seu agente precisa",
      body: "UI, contexto, dados, permissões e infraestrutura, já conectados entre si.",
      pillars: {
        reactUi: {
          title: "UI em React",
          body: "Dê aos usuários telas familiares para navegar, editar e revisar trabalho.",
        },
        agentChat: {
          title: "Chat de agente incorporado",
          body: "Deixe os usuários delegarem trabalho, fazerem perguntas e revisarem resultados na mesma UI.",
        },
        sharedState: {
          title: "Estado de aplicação compartilhado",
          body: "O agente sabe o que os usuários estão vendo, selecionando e editando.",
        },
        sharedSql: {
          title: "Dados PostgreSQL compartilhados",
          body: "Usuários e agentes leem e atualizam a mesma fonte de verdade.",
        },
        skillsMemory: {
          title: "Habilidades e memória",
          body: "Dê aos agentes expertise reutilizável e contexto persistente.",
        },
        automations: {
          title: "Automações",
          body: "Execute trabalho do agente automaticamente por horários ou eventos.",
        },
        agentTeams: {
          title: "Equipes de agentes",
          body: "Delegue trabalho a agentes especializados no mesmo workspace ou entre agentes conectados.",
        },
        auth: {
          title: "Autenticação e organizações",
          body: "Login, contas de usuário e associação a organizações já vêm integrados.",
        },
        sharing: {
          title: "Compartilhamento e permissões",
          body: "Controle quem pode visualizar, comentar, editar ou gerenciar cada recurso.",
        },
      },
    },
    stack: {
      title: "Traga sua própria stack",
      body: "Agent-Native é TypeScript de código aberto. Escolha seu modelo, banco de dados e hospedagem, e mantenha o código da aplicação no seu repositório.",
      exploreApps: "Explore apps criados com Agent-Native",
    },
    showcase: {
      title: "Apps reais criados com Agent-Native",
      body: "Apps Agent-Native de código aberto que você pode usar gratuitamente ou personalizar infinitamente.",
      browseApps: "Explorar apps",
      scrollLeft: "Rolar apps para a esquerda",
      scrollRight: "Rolar apps para a direita",
    },
    bottomCta: {
      title: "Crie seu primeiro agente com uma UI",
      body: "O agente e a UI compartilham as mesmas capacidades. Traga seu próprio LLM e implante em qualquer lugar.",
    },
    footer: {
      tagline: "O framework para aplicativos agentic.",
      framework: "Framework",
      ecosystem: "Ecossistema",
      community: "Comunidade",
      legal: "Legal",
      docs: "Documentação",
      download: "Baixar",
      apps: "Apps",
      privacyPolicy: "Política de Privacidade",
      saasTerms: "Termos de SaaS",
      legalResources: "Recursos jurídicos",
    },
  },
  gettingStarted: {
    tabs: {
      label: "Escolha como criar",
      local: "Criar localmente",
      localDescription: "Use a CLI para criar no seu computador.",
      cloud: "Criar na nuvem",
      cloudDescription: "Crie no navegador com o Builder.io.",
    },
    cloud: {
      intro:
        "Crie os mesmos aplicativos sem instalar nada. Descreva o que você quer e o agente escreve e executa o código em um espaço de trabalho hospedado pelo Builder.",
      stepOneTitle: "Crie uma conta no Builder",
      stepOneBody:
        "Use sua conta do Builder para criar no navegador. Comece gratuitamente, sem precisar fornecer chaves de API.",
      stepTwoTitle: "Envie seu prompt",
      stepTwoBody:
        "Descreva em linguagem simples o que você quer criar e o agente fará isso por você.",
      stepThreeTitle: "Publique",
      stepThreeBody:
        "Quando estiver pronto, publique seu agente e sua UI com um clique no Builder.",
    },
  },
  templatesPage: {
    title: "Aplicativos de código aberto e nativos do agente que você possui",
    eyebrow: "Comece com uma app funcional e deixe o agente evoluí-la.",
    body: "Você pode personalizar tudo.",
    firstPartyTitle: "Criados pelo Agent-Native",
    community:
      "Quer uma app em branco? Comece do zero com o guia do framework.",
    createYourOwn: "Começar do zero",
    communityTitle: "Aplicativos da comunidade",
    communityDescription:
      "Descubra aplicativos mantidos por seus autores. Experimente uma versão hospedada quando disponível ou veja o código-fonte e personalize por conta própria.",
    submitCommunityTemplate: "Enviar um aplicativo",
    communityEmpty:
      "As inscrições da comunidade estão abertas. Publique um aplicativo Agent-Native focado e envie-o para o catálogo.",
    publishGuide: "Ler o guia de publicação",
    communityTrust:
      "Aplicativos da comunidade são código de terceiros. Revise o código-fonte, a licença, as dependências e os scripts de instalação antes de executá-los.",
    copyCommunityInstallCommand: "Copiar comando de instalação",
    viewRepository: "Ver repositório",
    tryCommunityDemo: "Experimentar demo",
    customizeDescription: "Use este app como ponto de partida.",
    customizeOnline: "Online",
    customizeOnlineBadge: "Entrar na lista de espera",
    customizeLocally: "Local",
    communityNew: "Novo",
    communityComingSoon: "Em breve",
    communityGithubStars: "{{count}} estrelas no GitHub",
    tryCommunityApp: "Experimentar aplicativo",
    viewCommunitySource: "Ver código-fonte",
    communityEyebrow: "Aplicativo da comunidade",
    communityScreenshots: "Capturas de tela",
    previousScreenshot: "Captura anterior",
    nextScreenshot: "Próxima captura",
    communityNoScreenshots: "As capturas aparecerão aqui após a revisão.",
    communityScreenshotAlt: "Captura {{index}} de {{name}}",
    communityNoHostedVersion:
      "Uma versão hospedada estará disponível em breve. Acompanhe o desenvolvimento pelo código-fonte.",
    communitySubmissionTitle: "Compartilhe um aplicativo da comunidade",
    communitySubmissionDescription:
      "Conte onde encontrar seu aplicativo e o que ele faz. Revisaremos os detalhes antes de publicar a listagem.",
    communitySubmissionName: "Nome do aplicativo",
    communitySubmissionNamePlaceholder: "Central de suporte ao cliente",
    communitySubmissionUrl: "URL do aplicativo",
    communitySubmissionUrlPlaceholder: "example.com",
    communitySubmissionDescriptionLabel: "Descrição",
    communitySubmissionDescriptionPlaceholder:
      "O que o aplicativo faz e para quem ele é?",
    communitySubmissionRepository: "Repositório do GitHub (opcional)",
    communitySubmissionRepositoryPlaceholder: "github.com/owner/repository",
    communitySubmissionScreenshots: "Capturas de tela (opcional)",
    communitySubmissionScreenshotsPlaceholder: "Solte até 5 imagens aqui",
    communitySubmissionScreenshotDropHint:
      "PNG, JPG ou WebP. Máximo de 1,5 MB cada.",
    communitySubmissionScreenshotSlot: "Captura {{index}}",
    communitySubmissionScreenshotsAdd: "Adicionar capturas",
    communitySubmissionScreenshotsCount: "{{count}} / 5 selecionadas",
    communitySubmissionScreenshotRemove: "Remover captura {{index}}",
    communitySubmissionSubmit: "Enviar aplicativo",
    communitySubmissionReady:
      "Obrigado. Vamos revisar seu aplicativo antes de publicá-lo.",
    communitySubmissionNameError: "Insira um nome para o aplicativo.",
    communitySubmissionDescriptionError: "Adicione uma descrição curta.",
    communitySubmissionUrlError: "Insira um link válido, como example.com.",
    communitySubmissionRepositoryError:
      "Insira um link de repositório do GitHub.",
    communitySubmissionScreenshotsError:
      "Use imagens PNG, JPG ou WebP de até 1,5 MB cada, com no máximo 5 imagens.",
    communitySubmissionSubmitError:
      "Não foi possível enviar agora. Verifique os campos destacados e tente novamente.",
    communitySubmissionSubmitting: "Enviando…",
  },
  buildFromScratch: {
    title: "Criar do zero",
    description:
      "Comece com o guia do framework ou crie online com o agente de programação em nuvem da Builder.io.",
    readDocs: "Ler a documentação",
    buildOnline: "Criar online",
    popoverTitle: "Criar no navegador",
    popoverBody:
      "Gere rapidamente apps agent-native na nuvem com a Builder.io.",
    waitlistBody:
      "A Builder.io pode iniciar e personalizar um app agent-native na nuvem — com actions, auth, estado SQL e chat do agente. Entre na lista de espera para acesso antecipado.",
    emailLabel: "Email",
    emailPlaceholder: "voce@empresa.com",
    joinWaitlist: "Entrar na lista de espera",
    joining: "Entrando…",
    joined:
      "Você está na lista de espera. Enviaremos um email quando o acesso para criar online abrir.",
    invalidEmail: "Insira um endereço de email válido.",
    submitError: "Não foi possível entrar na lista de espera. Tente novamente.",
    waitlistUnavailable:
      "As inscrições na lista de espera ainda não estão disponíveis neste ambiente. Tente o site de documentação hospedado.",
    launchBuilder: "Abrir o Builder",
  },
  templateCard: {
    pasteIntoTerminal: "Cole em seu terminal.",
    newToCli: "Novo no CLI?",
    screenshotAlt: "Captura de tela do app {{name}}",
  },
  templateDetail: {
    allTemplates: "Todos os apps",
    notFoundMetaTitle: "App não encontrado — Agent-Native",
    notFoundTitle: "App não encontrado",
    notFoundBody:
      "Navegue no catálogo de apps para encontrar um aplicativo disponível.",
    badge: "Agent-Native {{name}}",
    title: "App {{name}}",
  },
  templates: {
    clips: {
      replaces: "Substitui ou amplia Loom, Granola e Wisprflow",
      description:
        "Grava sua tela, reuniões e notas de voz para que os agentes entendam o que aconteceu e tomem providências.",
    },
    plan: {
      replaces:
        "Modo de plano visual para Codex, Claude Code e agentes de código",
      description:
        "Instale planejamento visual como skill apoiada por app. Seu agente de código pode abrir planos estruturados com diagramas, wireframes, protótipos, anotações, comentários e links de revisão compartilháveis.",
    },
    design: {
      replaces: "Substitui ou amplia ferramentas de prototipagem de design",
      description:
        "Transforma prompts em designs interativos que seguem seu sistema de design enquanto o agente refina cada tela com seu feedback.",
    },
    content: {
      replaces: "Substitui ou aumenta Obsidian por MDX, Notion, Google Docs",
      description:
        "Trabalha com seus documentos enquanto um agente escreve com sua voz, cria conteúdo interativo e publica no seu site.",
    },
    slides: {
      replaces: "Substitui ou aumenta Google Slides, Pitch",
      description:
        "Cria apresentações editáveis e alinhadas à sua marca a partir de prompts ou slides existentes, que um agente pode criar, editar e refinar.",
    },
    analytics: {
      replaces: "Alternativa de código aberto ao Amplitude e ao FullStory",
      description:
        "Conecta seus dados para que um agente responda perguntas em linguagem simples e transforme os resultados em gráficos e painéis.",
    },
    mail: {
      replaces: "Substitui ou aumenta Superhuman, Gmail",
      description:
        "Uma caixa de entrada pensada para o teclado, onde um agente prioriza e-mails, redige respostas, resume conversas e acompanha pendências.",
    },
    forms: {
      replaces: "Substitui ou aumenta Typeform, Google Forms",
      description:
        "Construtor de formulários nativo do agente. Gere formulários a partir de um prompt, edite campos visualmente ou de forma conversacional e envie envios para Slack, Discord, Google Sheets ou webhooks.",
    },
    assets: {
      replaces:
        "Substitui ou aumenta DAMs, bibliotecas de ativos de marca e geradores de mídia AI",
      description:
        "Oferece aos agentes uma biblioteca compartilhada de diretrizes, imagens e vídeos da marca para criar e escolher mídias alinhadas em seus apps.",
    },
    calendar: {
      replaces: "Substitui ou aumenta Google Calendar, Calendly",
      description:
        "Reúne seus Google Calendars para que um agente encontre horários, agende ou reagende eventos e gerencie reservas.",
    },
    dispatch: {
      replaces: "Controle de missão para seus aplicativos nativos de agente",
      description:
        "Mensagens e gerenciamento centralizados para todos os agentes da sua pilha. Fale com seus agentes de Slack, Telegram ou da web; rotear trabalhos, reter memória, aprovar ações e delegar entre aplicativos em A2A.",
    },
    chat: {
      replaces: "Um aplicativo mínimo estilo ChatGPT para seu próprio agente",
      description:
        "Chat-primeiro andaime de aplicativo com threads duráveis, uma barra lateral padrão, ações, autenticação, sincronização ao vivo e um caminho limpo para adicionar telas ou conectar seu próprio back-end de agente.",
    },
  },
  templateLanding: {
    faq: {
      eyebrow: "Perguntas frequentes",
      title: "Respostas para perguntas frequentes",
    },
    analytics: {
      faq: {
        question1: "O que é o Agent-Native Analytics?",
        answer1:
          "Agent-Native Analytics é uma ferramenta de análise de IA gratuita e de código aberto. Faça perguntas a um agente de IA sobre dados conectados, inspecione consultas e crie painéis reutilizáveis. Também inclui repetição de sessão, rastreamento de erros e monitoramento de uptime.",
        question2: "Preciso saber SQL para usar o Analytics?",
        answer2:
          "Você pode fazer perguntas em linguagem natural e deixar seu agente de IA escrever as consultas. Para o BigQuery, também é possível criar gráficos selecionando tabelas, métricas e filtros no Explorer. O SQL continua disponível para inspeção, e alguém familiarizado com seus dados pode precisar ajudar a conectar fontes e definir métricas.",
        question3: "Quais fontes de dados posso conectar?",
        answer3:
          "As fontes compatíveis incluem BigQuery, Google Analytics 4, Amplitude, Mixpanel, PostHog, HubSpot e Stripe. Cada fonte precisa das credenciais adequadas ou de uma conexão de workspace compartilhada concedida ao Analytics. As respostas disponíveis dependem dos dados e permissões que você conectar.",
        question4: "Posso usar nossas próprias definições de métricas?",
        answer4:
          "Sim. Use o dicionário de dados para documentar definições, nomes de tabelas e colunas, exemplos de consultas e exceções, como excluir contas internas. Seu agente de IA pode usar essas definições ao escrever consultas. Revise o SQL e os resultados ao conferir uma métrica de negócio.",
        question5: "Posso compartilhar painéis e agendar relatórios?",
        answer5:
          "Sim. Compartilhe painéis com colegas de equipe ou sua organização com acesso de visualizador, editor ou administrador. Você também pode agendar relatórios por e-mail com os resultados atuais do painel, ou configurar alertas para as condições que quiser acompanhar.",
      },
      // Copy V3 da landing page (2026-09-14) — do hero ao CTA final abaixo.
      heroEyebrow: "Analytics",
      heroTitle:
        "Faça uma pergunta. Obtenha o gráfico, a consulta e o contexto.",
      heroDescription:
        "Reúna dados de armazém, produtos e receitas. O agente verifica suas definições de métricas, escreve o SQL e transforma a resposta em um painel reutilizável.",
      heroCta: "Explore seus dados",
      useCasesHeading: "Siga o sinal da métrica para a sessão",
      useCasesBody:
        "Mantenha o raciocínio ao lado de cada resultado e, em seguida, leve um gráfico para um painel ou investigação de sessão.",
      useCase1Title: "Explique uma mudança na ativação",
      useCase1Body:
        "Compare coortes e canais em uma conversa. O agente usa suas definições de métricas documentadas, escreve a consulta e mostra as evidências por trás da mudança.",
      useCase2Title: "Crie uma avaliação de receita vital",
      useCase2Body:
        "Peça ao agente para combinar métricas de faturamento, CRM ou armazém em um painel. Filtros e painéis persistem para sua próxima revisão.",
      useCase3Title: "Rastreie uma métrica para uma sessão real",
      useCase3Body:
        "Passe de um pico ou erro para a sessão por trás dele. Inspecione a atividade do console e da rede e compartilhe o contexto de diagnóstico temporário com o agente.",
      keyFeaturesEyebrow: "Principais recursos",
      keyFeaturesHeading:
        "Tudo que você precisa para consultar, visualizar e explorar",
      feature1Title: "Pergunte através de dados conectados",
      feature1Body:
        "Faça perguntas sobre depósitos, produtos e fontes de receita. O agente transforma a resposta em um gráfico e dá suporte ao detalhamento do acompanhamento.",
      feature2Title: "Painéis que o agente pode editar",
      feature2Body:
        "Peça ao agente para adicionar ou remodelar painéis, filtros e detalhamentos. As alterações ficam em um painel reutilizável que sua equipe pode compartilhar.",
      feature3Title: "SQL visível e contexto métrico",
      feature3Body:
        "Inspecione a consulta por trás de um resultado e a definição de métrica usada para escrevê-lo. Refine o SQL quando precisar de mais controle.",
      feature4Title: "Um espaço de trabalho para fontes de dados",
      feature4Body:
        "Conecte BigQuery, GA4, análise de produtos, HubSpot e Stripe e explore os dados permitidos no mesmo aplicativo.",
      feature5Title: "Definições que o agente segue",
      feature5Body:
        "Documente regras métricas, junções, exemplos e dicas conhecidas. O Analytics fornece esse contexto ao agente quando ele escreve consultas.",
      feature6Title: "Repetição da sessão com diagnóstico",
      feature6Body:
        "Passe de um erro para uma gravação com eventos de console e de rede à vista. Compartilhe um link de diagnóstico temporário para investigação assistida por agente.",
      finalCtaHeading: "Comece com uma pergunta sobre seus dados",
      finalCtaBody:
        "Conecte uma fonte e peça ao seu agente de IA o primeiro gráfico.",
      finalCtaButton: "Explore seus dados",
      s001: "Captura de tela do modelo Analytics",
      s002: "Conectores de dados",
      s003: "Tipos de gráfico",
      s004: "Explorador de consultas",
      s005: "Linguagem natural",
      s006: "Todos os modelos",
      s007Primary: "A alternativa de código aberto para",
      s007Secondary: "Amplitude e FullStory",
      s008: "Conecte qualquer fonte de dados, solicite qualquer gráfico, crie painéis reutilizáveis ​​— o agente AI escreve o SQL.",
      s009: "Experimentar",
      s010: "O que você pode fazer",
      s011: "Tudo que você precisa para substituir sua pilha de análises.",
      s012: "Consultas em linguagem natural",
      s013: "Pergunte em inglês simples. O agente escreve o SQL e constrói o gráfico.",
      s014: "Painéis reutilizáveis",
      s015: "Painéis persistentes com controles de data, subvisualizações e painéis redimensionáveis.",
      s016: "Acesso direto BigQuery com histórico, contagens de linhas e URLs compartilháveis.",
      s017: "Autoaperfeiçoamento",
      s018: "O agente modifica o próprio aplicativo. Precisa de um novo tipo de gráfico? Basta perguntar.",
      s019: "Conecte tudo",
      s020: "Vários conectores integrados para serviços populares. O agente escreve novos sob demanda.",
      s021: "CRM e receita",
      s022: "Engenharia",
      s023: "GitHub, Jira, Sentry — PRs, tickets, sprints e rastreamento de erros.",
      s024: "Infraestrutura",
      s025: "Comunicação",
      s026: "Content e SEO",
      s027: "Comunidade",
      s028: "Dicionário de dados vivos",
      s029: "Definições de métricas com modelos de consulta, padrões de junção, dicas conhecidas e frequência de atualização. Sincronizado de Notion com validação orientada pela comunidade.",
      s030: "Modelos de consulta e resultados de exemplo para cada métrica",
      s031: "Pontuação e validação de confiança com aprovações de revisores",
      s032: "Sugestões e descobertas de métricas baseadas em AI",
      s033: "Atraso de dados, dependências e intervalos de datas válidos documentados",
      s034: "Usuários ativos semanais",
      s035: "Diariamente",
      s036: "~2 horas",
      s037: "Exclui e-mails internos da @empresa",
      s038: "Validado ✓",
      s039: "Como se compara",
      s040: "Painel UI",
      s041: "Sim, rígido",
      s042: "No",
      s043: "Sim, totalmente personalizável",
      s044: "Limitado",
      s045: "Sim, efêmero",
      s046: "Sim, gráficos persistentes",
      s047: "SDKs integrado",
      s048: "Carregamento manual",
      s049: "Várias fontes + personalizado",
      s050: "Dicionário de dados",
      s051: "Básico",
      s052: "Métricas completas com contexto",
      s053: "Personalização",
      s054: "Somente configuração",
      s055: "Somente aviso",
      s056: "Código fonte completo",
      s057: "Preços",
      s058: "Por assento, por evento",
      s059: "Assinatura",
      s060: "Gratuito e de código aberto",
      s061: "Comece em minutos",
      s062: "Comece com o modelo, conecte seus dados e comece a construir painéis.",
      s063: "Leia os documentos",
      s064: "Ver todos os modelos",
    },
    calendar: {
      faq: {
        question1: "O que é o Agent-Native Calendar?",
        answer1:
          "O Agent-Native Calendar é um assistente de agendamento com IA gratuito e de código aberto que se conecta ao Google Calendar. Use um agente de IA para gerenciar eventos e encontrar horários, ou compartilhe links de reserva para que outras pessoas agendem com você.",
        question2: "Quais calendários posso conectar?",
        answer2:
          "Conecte várias contas do Google para ver os eventos delas juntos. Eventos novos e atualizados são gravados no calendário principal da conta selecionada. Você também pode exibir feeds ICS ou webcal somente leitura; eles não são integrações bidirecionais com Outlook ou Apple Calendar. Calendários do Google compartilhados são somente visualização e não bloqueiam a disponibilidade de reserva.",
        question3: "O que o agente de IA pode fazer com meu calendário?",
        answer3:
          "Seu agente de IA pode verificar sua agenda, encontrar horários disponíveis e criar ou reagendar eventos. Quando você pede para ele encontrar um horário, ele verifica suas regras de disponibilidade e eventos existentes, além das informações de livre/ocupado dos convidados nomeados quando acessíveis. Você escolhe o horário sugerido antes que a reunião seja marcada.",
        question4:
          "As pessoas precisam de uma conta para marcar uma reunião comigo?",
        answer4:
          "Não. Qualquer pessoa com seu link de reserva público pode escolher um horário disponível e responder suas perguntas de reserva sem fazer login. Após a reserva, ela recebe um link privado para reagendar ou cancelar a reunião.",
        question5:
          "Um link de reserva pode verificar a disponibilidade de vários anfitriões?",
        answer5:
          "Sim. Adicione coanfitriões obrigatórios, e o Calendar verifica as informações de livre/ocupado deles antes de oferecer um horário. Para também respeitar o horário de trabalho configurado de cada coanfitrião, você e esse coanfitrião precisam adicionar os calendários um do outro como sobreposições. Sem esse compartilhamento mútuo, o Calendar verifica apenas as informações de livre/ocupado deles.",
      },
      s001: "Captura de tela do modelo Calendar",
      // Cópia V3 da página de destino (10/09/2026) — do hero ao CTA final.
      heroEyebrow: "Calendar",
      heroTitle:
        "Encontre tempo, marque reuniões e adapte seu dia com um agente",
      heroDescription:
        "O Agenda reúne suas agendas do Google e regras de disponibilidade para que o agente possa encontrar vagas compartilhadas, preparar reservas e ajudar a atualizar eventos.",
      heroCta: "Comece a agendar",
      useCasesHeading: "Deixe o agente cuidar dos detalhes do agendamento",
      useCasesBody:
        "Verifique a disponibilidade real nos calendários e revise uma proposta clara antes de uma reunião ser criada ou movida.",
      useCase1Title: "Transforme um link de reserva em uma reunião preparada",
      useCase1Body:
        "Ofereça apenas horários que respeitem horário de trabalho, aviso prévio e buffers. Colete os detalhes necessários e adicione o link do vídeo quando o convidado fizer a reserva.",
      useCase2Title: "Encontre um slot que todos possam fazer",
      useCase2Body:
        "Peça ao agente para comparar o horário livre/ocupado dos participantes e as sobreposições de calendário. Ele retorna a abertura compartilhada e os calendários verificados.",
      useCase3Title: "Reagende sem perder o fio da conversa",
      useCase3Body:
        "Solicite um horário posterior e deixe o agente verificar os convidados, preservar os detalhes da reunião e preparar o convite atualizado para sua análise.",
      keyFeaturesEyebrow: "Principais recursos",
      keyFeaturesHeading:
        "Tudo o que você precisa para agendar, marcar e reagendar",
      feature1Title: "Agendamento em linguagem natural",
      feature1Body:
        "Peça ao agente para verificar a disponibilidade, propor um horário e criar ou movimentar um evento com seus convidados e detalhes da reunião.",
      feature2Title: "Disponibilidade entre contas",
      feature2Body:
        "Visualize agendas do Google conectadas em conjunto e inclua feeds somente leitura como contexto de programação.",
      feature3Title: "Reservando páginas com entrada",
      feature3Body:
        "Crie links para diferentes tipos de reunião, defina a duração e as perguntas de reserva e deixe os convidados escolherem um horário disponível.",
      feature4Title: "Regras que moldam cada slot",
      feature4Body:
        "Defina horários de trabalho, buffers, aviso, fuso horário e horizonte de reserva para que os horários sugeridos e públicos se ajustem à sua programação.",
      feature5Title: "Verificações reais de vários hosts",
      feature5Body:
        "Adicione os coanfitriões necessários e verifique a disponibilidade de livre/ocupado antes de oferecer um horário. O Calendário também respeita sobreposições de horário de trabalho compartilhado quando configurado.",
      feature6Title: "Acompanhamento de reuniões gerenciadas por agentes",
      feature6Body:
        "Mantenha os detalhes do Google Meet ou Zoom anexados enquanto o agente prepara alterações no evento e atualiza convites.",
      finalCtaHeading: "Coloque sua próxima reunião no calendário",
      finalCtaBody:
        "Encontre um horário com seu agente de IA ou envie um link de reserva.",
      finalCtaButton: "Comece a agendar",
      s002: "Calendar visualizações",
      s003: "Ações do agente",
      s004: "Tipos de link de reserva",
      s005: "Todos os modelos",
      s006Primary: "A alternativa de código aberto",
      s006Secondary: "Google Calendar e Calendly",
      s007: "Sincronização Google Calendar de várias contas, disponibilidade configurável e links de reserva personalizáveis no estilo Calendly — com um agente AI que agenda em seu nome.",
      s008: "Experimentar",
      s009: "O login usa apenas a identidade Google básica, mas a conexão com a sincronização Calendar solicita acesso ao calendário. Alguns administradores do Workspace podem exigir aprovação para a demonstração hospedada. Execute localmente para usar seu próprio cliente Google OAuth.",
      s010: "O que você pode fazer",
      s011: "Tudo o que você precisa para substituir seu calendário e sua pilha de agendamento.",
      s012: "Várias visualizações Calendar",
      s013: "Visualizações mensais, semanais e diárias com gerenciamento de eventos de arrastar e soltar.",
      s014: "Agendamento de linguagem natural",
      s015: "Diga ao agente para encontrar um horário, criar um evento ou reprogramar – ele cuida do resto.",
      s016: "Links de reserva personalizáveis",
      s017: "Crie várias páginas de reserva no estilo Calendly com diferentes durações e disponibilidades. Os visitantes escolhem um slot que funcione.",
      s018: "Autoaperfeiçoamento",
      s019: "O agente modifica o próprio aplicativo. Precisa de uma nova visualização ou fluxo de reserva? Basta perguntar.",
      s020: "Conecte várias contas Google via OAuth 2.0. Extraia eventos de todos os seus calendários e crie eventos que sejam sincronizados com Google.",
      s021: "OAuth 2.0 multiconta com atualização automática de token",
      s022: "Sincronização baseada em pull – sem necessidade de webhooks",
      s023: "Criar, atualizar e excluir eventos em Google",
      s024: "Crie links de reserva personalizáveis onde qualquer pessoa pode reservar um horário com você. Configurações de disponibilidade configuráveis ​​por tipo de reserva.",
      s025: "Seletor de data + seleção de intervalo de tempo",
      s026: "Respeita a sua disponibilidade e eventos existentes",
      s027: "Captura de informações do visitante + confirmação",
      s028: "Agendamento baseado em agente",
      s029: "O agente executa scripts para sincronizar calendários, criar eventos, verificar disponibilidade e gerenciar reservas. Tudo através da linguagem natural.",
      s030: '"Sincronize meu Google Calendar para este mês"',
      s031: '"Encontre um horário de 30 minutos na próxima terça-feira para uma reunião de equipe"',
      s032: '"Crie um stand-up recorrente às 9h todos os dias da semana"',
      s033: '"Mostre-me minha disponibilidade para a próxima semana"',
      s034: "Como se compara",
      s035: "Interface de calendário",
      s036: "Cheio, rígido",
      s037: "Mínimo",
      s038: "Completo, totalmente personalizável",
      s039: "AI agendamento",
      s040: "Linguagem natural, controle total",
      s041: "Página de reserva",
      s042: "Horários disponíveis",
      s043: "Sim, marca limitada",
      s044: "Domínio próprio totalmente personalizável",
      s045: "Personalização",
      s046: "Apenas configurações",
      s047: "Somente marca",
      s048: "Código fonte completo",
      s049: "Preços",
      s050: "Gratuito / Espaço de trabalho",
      s051: "$10+ / mês por usuário",
      s052: "Gratuito e de código aberto",
      s053: "Comece em minutos",
      s054: "Comece com o modelo, conecte Google Calendar e comece a agendar com AI.",
      s055: "Leia os documentos",
      s056: "Ver todos os modelos",
      s057: "Nota da demonstração hospedada",
      s058: "Sincronização bidirecional",
    },
    assets: {
      faq: {
        question1: "O que é o Agent-Native Assets?",
        answer1:
          "Agent-Native Assets é uma biblioteca de assets de marca gratuita e de código aberto com geração de imagem e vídeo por IA. Organize mídias existentes, forneça referências de marca e trabalhe com um agente de IA para gerar, editar e reutilizar assets em vários projetos.",
        question2: "Como o Assets usa minhas diretrizes de marca?",
        answer2:
          "Adicione seu logotipo, imagens de referência, cores e notas de estilo a um kit de marca. Modelos reutilizáveis fornecem instruções para tipos específicos de conteúdo. Seu agente de IA usa esse contexto para guiar a geração, e você pode revisar e refinar os resultados antes de salvá-los.",
        question3: "Posso enviar e organizar imagens e vídeos existentes?",
        answer3:
          "Sim. Envie mídias existentes ou importe um asset a partir de uma URL, depois organize-o em bibliotecas e pastas junto com o conteúdo gerado. Você pode navegar e pesquisar na biblioteca, reutilizar assets como referências ou exportá-los para outro projeto.",
        question4: "Meu agente de IA pode usar o Assets a partir de outro app?",
        answer4:
          "Sim. Conecte um agente compatível pela integração MCP do Assets para pesquisar, gerar e selecionar mídias pelo chat. Apps Agent-Native também podem solicitar assets ou incorporar um seletor. A experiência disponível depende do app hospedeiro e da sua conexão com o Assets.",
        question5: "O Assets pode usar meu logotipo real nas imagens geradas?",
        answer5:
          "Sim. Defina um logotipo canônico no seu kit de marca e ative o compositing de logotipo para a geração. O Assets posiciona o logotipo original sobre a imagem depois da geração, para que o modelo de imagem não o redesenhe. Revise o posicionamento e a imagem ao redor antes de usar.",
      },
      s001: "Captura de tela do app Assets",
      imageCredits: "Créditos das imagens",
      heroEyebrow: "Assets",
      heroTitle: "Gere imagens da marca em uma conversa",
      heroDescription:
        "Descreva o que você precisa, forneça ao seu agente um kit de marca ou referência e compare as variações geradas durante a conversa.",
      heroCta: "Gere uma imagem",
      useCasesHeading: "O que você pode fazer com o Assets?",
      useCasesBody:
        "Crie imagens de campanha, adapte visuais para novos projetos, ou dê à sua equipe e aos agentes de IA uma biblioteca de marca compartilhada.",
      useCase1Title: "Criar visuais de campanha",
      useCase1Body:
        "Peça ao seu agente de IA imagens para blog, artes para redes sociais ou visuais de lançamento usando suas referências de marca. Compare as opções e refine a que você escolher.",
      useCase2Title: "Adaptar imagens para novos projetos",
      useCase2Body:
        "Dê ao seu agente de IA uma imagem existente e descreva as mudanças que você precisa, como um fundo diferente ou espaço para um título.",
      useCase3Title: "Compartilhar assets de marca em todo o seu trabalho",
      useCase3Body:
        "Mantenha logotipos, imagens de produto e referências de marca juntos para que colegas de equipe e agentes de IA conectados encontrem mídias para apresentações, sites e outros projetos.",
      keyFeaturesEyebrow: "Principais recursos",
      keyFeaturesHeading:
        "Tudo o que você precisa para gerar, refinar e reutilizar",
      feature1Title: "Bibliotecas de assets de marca",
      feature1Body:
        "Organize mídias enviadas e geradas em bibliotecas e pastas. Adicione logotipos, imagens de referência e notas de estilo para seu agente de IA usar.",
      feature2Title: "Geração de imagem e vídeo por IA",
      feature2Body:
        "Descreva a mídia que você precisa e escolha suas referências de marca. Gere opções de imagem ou vídeos curtos, depois revise os resultados antes de salvar.",
      feature3Title: "Edição de imagem",
      feature3Body:
        "Peça ao seu agente de IA para editar ou reestilizar uma imagem. Use o asset existente como referência e refine-o com feedback.",
      feature4Title: "Modelos reutilizáveis",
      feature4Body:
        "Salve instruções de geração para trabalhos recorrentes, como capas de blog ou artes para redes sociais. Associe modelos a um kit de marca para reutilizar suas referências.",
      feature5Title: "Posicionamento do logotipo original",
      feature5Body:
        "Defina o logotipo do seu kit de marca e adicione-o às imagens geradas. O compositing de logotipo posiciona o arquivo original em vez de gerar uma nova versão.",
      feature6Title: "Acesso do agente",
      feature6Body:
        "Conecte seu agente de IA para pesquisar na biblioteca, gerar mídias e escolher assets pelo chat. Apps compatíveis também podem incorporar um seletor de assets.",
      finalCtaHeading: "Crie seu próximo asset de marca",
      finalCtaBody:
        "Escolha suas referências e diga ao seu agente de IA o que você precisa.",
      finalCtaButton: "Gere uma imagem",
    },
    chat: {
      faq: {
        question1: "O que é o Agent-Native Chat?",
        answer1:
          "O Agent-Native Chat é um app de chat com IA gratuito e de código aberto para desenvolvedores. Inclui threads salvas, uma interface de chat com agente, autenticação, actions compartilhadas e sincronização em tempo real. Você adiciona os dados e o comportamento específicos do seu domínio para sua aplicação.",
        question2: "O Chat é um assistente de IA pronto?",
        answer2:
          "O Chat oferece uma interface de conversa funcional e o framework por trás dela. Ele inclui uma action de exemplo, mas os fluxos de trabalho de negócio e as integrações com provedores ficam por sua conta implementar e configurar.",
        question3: "Posso adicionar telas além da interface de chat?",
        answer3:
          "Sim. Adicione rotas e componentes para listas, filas, editores ou outras telas que seu fluxo de trabalho precisar. Conecte-as às mesmas actions e dados de aplicação que o agente usa.",
        question4: "O Chat inclui conexões com minhas ferramentas de negócio?",
        answer4:
          "O template mínimo não inclui integrações com provedores específicas de domínio. Adicione as conexões e regras de acesso que seu app precisar. Se já existe um app Agent-Native que corresponde ao seu fluxo de trabalho, o template dele pode ser um ponto de partida mais adequado.",
        question5: "Posso personalizar e implantar minha própria versão?",
        answer5:
          "Sim. Crie uma cópia com a CLI, adicione suas actions, dados e interface, e implante sua aplicação. Configure a autenticação e o acesso a provedores para seu ambiente, e teste os fluxos de trabalho que você adicionar antes de compartilhá-los com seus usuários.",
      },
      s001: "Captura de tela do app Chat",
      // V3 landing page copy (2026-09-14) — hero through final CTA below.
      heroEyebrow: "Chat",
      heroTitle: "Construa seu próprio app de chat com IA",
      heroDescription:
        "Um iniciador de bate-papo gratuito e de código aberto com threads duráveis, autenticação, ações compartilhadas e um agente que você pode estender com suas próprias ferramentas e telas.",
      heroCta: "Crie seu chat",
      heroSecondaryCta: "Abrir Chat",
      useCasesHeading: "Transforme conversas em assistentes de trabalho",
      useCasesBody:
        "Adicione ações, dados e telas que permitem que seu agente responda a perguntas e avance com o trabalho.",
      useCase1Title: "Responda às perguntas com o contexto da sua equipe",
      useCase1Body:
        "Conecte as fontes que seu aplicativo precisa por meio de ações e deixe o agente reunir notas, arquivos e detalhes do projeto em uma única resposta.",
      useCase2Title: "Dê ao seu agente ferramentas para agir",
      useCase2Body:
        "Crie um protótipo de um fluxo de trabalho no chat, chame as ações que você define e refine como o agente lida com cada etapa.",
      useCase3Title: "Torne os resultados utilizáveis",
      useCase3Body:
        "Abra o trabalho do agente em uma fila, tabela ou editor para que as pessoas possam inspecionar e continuar a partir dos mesmos dados compartilhados.",
      keyFeaturesEyebrow: "Principais recursos",
      keyFeaturesHeading: "Um ponto de partida para seu agente e sua interface",
      feature1Title: "Conversas duradouras",
      feature1Body:
        "Crie, reabra, renomeie, fixe e arquive tópicos na barra lateral do histórico incluída.",
      feature2Title: "Chat de agente de página inteira",
      feature2Body:
        "Comece com a superfície de chat e o tempo de execução, prontos para suas próprias instruções, ferramentas e fluxos de trabalho.",
      feature3Title: "Conecte seus próprios serviços",
      feature3Body:
        "Adicione ações de provedor e fluxos de conexão para ferramentas como Granola, Linear, Drive ou Notion; o starter deixa essas integrações para seu aplicativo.",
      feature4Title: "Ações compartilhadas",
      feature4Body:
        "Mantenha as ferramentas do agente e as operações de interface na mesma superfície de ação.",
      feature5Title: "Estado do espaço de trabalho ativo",
      feature5Body:
        "Mantenha a navegação atual e o trabalho selecionado sincronizados para o usuário e o agente.",
      feature6Title: "Telas personalizadas",
      feature6Body:
        "Adicione visualizações focadas quando uma conversa precisar de uma fila, editor ou outra interface de domínio.",
      finalCtaHeading: "Construa seu primeiro fluxo de trabalho de agente",
      finalCtaBody:
        "Crie sua cópia e adicione a primeira action que seus usuários precisam.",
      finalCtaButton: "Crie seu chat",
    },
    clips: {
      s001: "Captura de tela do modelo Clips",
      // V5 landing page copy (2026-09-09) — hero through final CTA below.
      heroEyebrow: "Clips",
      heroTitle: "Gravações de tela que seu agente de IA pode ver e ouvir",
      heroDescription:
        "Clips é um gravador de tela gratuito e de código aberto para compartilhar bugs, feedback e tutoriais com agentes de IA.",
      heroCta: "Gravar um clipe",
      useCasesHeading: "O que você pode fazer com o Clips?",
      useCasesBody:
        "Comece com um clipe que você gravou ou que alguém compartilhou com você. Dê ao seu agente de IA o contexto e diga o que você precisa.",
      useCase1Title: "Agir sobre feedback gravado",
      useCase1Body:
        "Dê ao seu agente de IA feedback gravado para transformar em um plano ou ajudar a implementar as mudanças solicitadas.",
      useCase2Title: "Investigar um bug relatado",
      useCase2Body:
        "Compartilhe uma gravação de bug com seu agente de IA para investigar o que deu errado e definir os próximos passos.",
      useCase3Title: "Criar a partir de um briefing gravado",
      useCase3Body:
        "Use um briefing gravado para orientar seu agente de IA na criação de uma apresentação, design, conteúdo ou mudança no app.",
      keyFeaturesEyebrow: "Principais recursos",
      keyFeaturesHeading:
        "Tudo que você precisa para gravar, transcrever e compartilhar",
      feature1Title: "Gravações legíveis por agentes",
      feature1Body:
        "Compartilhe a transcrição e as imagens com marca de tempo de um clipe com seu agente de IA por meio de um único link legível por agentes.",
      feature2Title: "Transcrições automáticas",
      feature2Body:
        "Obtenha transcrições de gravações, reuniões e ditados. Clique em qualquer linha da transcrição para voltar àquele momento.",
      feature3Title: "Logs de depuração do navegador",
      feature3Body:
        "Capture erros de console e requisições que falharam junto com sua gravação com a extensão do Clips para Chrome.",
      feature4Title: "Agente de IA integrado",
      feature4Body:
        "Pergunte ao agente de IA integrado sobre um clipe ou sobre toda a sua biblioteca, e deixe que ele edite as transcrições no chat.",
      feature5Title: "Biblioteca de gravações pesquisável",
      feature5Body:
        "Encontre clipes pesquisando suas transcrições. Organize suas gravações com pastas, tags e espaços de equipe.",
      feature6Title: "Ditado push-to-talk",
      feature6Body:
        "Mantenha Fn pressionado no app de desktop para ditar em outros aplicativos. Reveja transcrições e o texto revisado no seu histórico.",
      teammatesLine:
        "Seus colegas de equipe podem assistir à mesma gravação no player.",
      teammatesLinkLabel: "Ler o guia de compartilhamento com agentes",
      seeInActionHeading: "Veja o Clips em ação",
      seeInActionBody:
        "Veja o Clips em uso, desde a gravação de um fluxo de trabalho no navegador até mostrar a um agente de IA como realizar uma tarefa.",
      watchClipLabel: "Ver o clipe",
      finalCtaHeading: "Ponha seu próximo clipe para trabalhar",
      finalCtaBody:
        "Grave uma explicação ou leve um clipe compartilhado para o seu agente de IA.",
      finalCtaButton: "Gravar um clipe",
      s002: "Gravação de tela",
      s003: "Logs de depuração do navegador",
      s004: "Ditar",
      s005: "Pode ver + ouvir",
      s006: "Todos os modelos",
      s007Primary: "Gravações de tela que sua",
      s007Secondary: "AI pode ver e ouvir.",
      s008: "Capture logs de depuração do navegador, obtenha transcrições e use o ditado integrado. 100% grátis, código aberto e personalizável.",
      s063: "Receba uma recomendação personalizada",
      s064: "Cole este prompt no Claude, ChatGPT ou Cursor para ver como o Clips pode impactar seu fluxo de trabalho.",
      s009: "Experimente",
      s010: "O que você pode fazer",
      s011: "Grave, transcreva e depure — um aplicativo, uma biblioteca, sem a pilha de assinaturas.",
      s012: "Gravação de tela com um clique",
      s013: "Transcrições automáticas",
      s014: "Cada gravação de tela, reunião e ditado recebe uma transcrição completa. Os agentes podem usar isso como camada de áudio e os espectadores podem clicar em qualquer linha para ir até aquele momento.",
      s015: "Ditado push-to-talk",
      s016: "Biblioteca Video pesquisável",
      s017: "Gravações de tela, transcrições de reuniões e ditados, todos indexados juntos. Pesquise em toda a sua biblioteca o que foi dito, não apenas pelo título.",
      s018: "Pesquisa de texto completo em cada transcrição",
      s019: "Pastas, tags e espaços de trabalho de equipe",
      s020: "Comentários e reações com carimbo de data/hora",
      s021: "Página do jogador com marca",
      s022: "Auto-hospedar o player. Personalize a marca, a frase de chamariz e as análises – é o seu código.",
      s023: "Domínio e tema personalizados",
      s024: "Ver contagens, taxa de exibição e desistência",
      s025: "Incorporável em qualquer site",
      s026: "Fluxos de trabalho de vídeo com tecnologia de agente",
      s027: "Pergunte ao agente qualquer coisa sobre sua biblioteca ou cole um link Clips compartilhado em outro agente — ele pode ler transcrições, inspecionar quadros com carimbo de data/hora, ler os erros capturados do console e solicitações com falha por trás de um bug e redigir acompanhamentos escritos de suas gravações.",
      s028: '"Puxe itens de ação do stand-up de hoje"',
      s029: '"Encontre o ditado onde descrevi o plano de lançamento"',
      s030: '"Elabore um e-mail de acompanhamento desta reunião"',
      s031: '"Leia os erros do console neste clipe de bug e proponha uma correção"',
      s032: "Como se compara",
      s033: "Gravação de tela",
      s034: "Sim",
      s035: "No",
      s036: "Captura de depuração do navegador (console + rede)",
      s037: "Notas de reunião sincronizadas com Calendar",
      s038: "Ditado push-to-talk",
      s039: "AI resumos e itens de ação",
      s040: "Limitado",
      s041: "Agente completo: capítulos, ações, Q&A",
      s042: "Agente edita transcrições e código",
      s043: "Links de mídia do agente coláveis",
      s044: "Apenas transcrição",
      s045: "Pacote de registro + captura de tela",
      s046: "Apenas notas",
      s047: "Somente texto",
      s048: "Transcrição + quadros com carimbo de data/hora",
      s049: "Propriedade de dados",
      s050: "Armazenamento do fornecedor",
      s051: "Nuvem do fornecedor",
      s052: "Você é dono dos seus dados e até do próprio código do aplicativo.",
      s053: "Preços",
      s054: "$15-30 / mês por usuário",
      s055: "Camadas gratuitas + pagas",
      s056: "$18-25 / mês por usuário",
      s057: "$12-15 / mês por usuário",
      s058: "Gratuito e de código aberto",
      s059: "Comece agora",
      s060: "Escolha o que capturar e comece a gravar no Clips.",
      s062: "Ver todos os modelos",
      faq: {
        question1: "O que é o Agent-Native Clips?",
        answer1:
          "Agent-Native Clips é um gravador de tela gratuito e de código aberto para compartilhar bugs, feedback e tutoriais com agentes de IA. Ele fornece ao seu agente de IA uma transcrição e imagens com marca de tempo de uma gravação, enquanto as pessoas podem assistir ao mesmo clipe.",
        question2:
          "Posso compartilhar gravações com Claude, ChatGPT ou Cursor?",
        answer2:
          "O Clips fornece um link legível por agentes com uma transcrição e imagens com marca de tempo. Seu agente precisa conseguir abrir o conteúdo do link e ler imagens para usar os dois. Alguns modos de chat conseguem ler a transcrição, mas exigem que você envie uma imagem separadamente.",
        question3: "Preciso da extensão do Chrome para gravar minha tela?",
        answer3:
          "Não. Você pode gravar no app web do Clips. Use a extensão do Chrome quando também quiser mensagens de console e diagnósticos de rede da aba que está demonstrando.",
        question4:
          "Agentes de IA conseguem assistir às minhas gravações de tela?",
        answer4:
          "Com o Clips, agentes de IA compatíveis conseguem entender sua gravação por meio de uma transcrição e imagens com marca de tempo. Eles usam o texto e as imagens em vez de reproduzir o vídeo, então você pode fazer perguntas sobre o que aconteceu ou dar ao seu agente de IA uma tarefa baseada na gravação.",
        question5: "Quem pode acessar uma gravação compartilhada?",
        answer5:
          "As gravações usam links públicos por padrão, a menos que sua organização altere essa configuração. Qualquer pessoa com o link pode acessá-las. Há opções de acesso privado e organizacional disponíveis, e clipes privados podem ser compartilhados com agentes por meio de links temporários sem tornar a gravação pública.",
      },
      quickStart: {
        recordingMode: "Modo de gravação",
        modeScreenCamera: "Tela + câmera",
        modeScreenOnly: "Somente tela",
        modeCameraOnly: "Somente câmera",
        captureSource: "Fonte de captura",
        surfaceWindow: "Janela",
        surfaceBrowser: "Aba do navegador",
        surfaceScreen: "Tela",
        audioSource: "Fonte de áudio",
        defaultMicrophone: "Microfone padrão",
        startRecording: "Iniciar gravação",
        uploadVideo: "Enviar vídeo",
        importLoom: "Importar do Loom",
      },
    },
    content: {
      faq: {
        question1: "O que é o Agent-Native Content?",
        answer1:
          "Agent-Native Content é um espaço de trabalho gratuito e de código aberto para documentos, tarefas e bancos de dados. Ele combina um editor de documentos com IA e tabelas estruturadas e páginas compartilhadas que pessoas e agentes de IA conectados podem ler e atualizar juntos.",
        question2: "Posso usar meu próprio agente de IA com o Content?",
        answer2:
          "Sim. O Content oferece uma conexão MCP para ferramentas compatíveis, como Claude Code, Codex e Cursor. Depois de conectar e autorizar o acesso, seu agente pode trabalhar com os documentos e bancos de dados disponíveis para ele. Você também pode usar o agente integrado do Content.",
        question3: "Posso pedir para a IA revisar meu texto sem reescrevê-lo?",
        answer3:
          "Sim. Peça ao seu agente de IA para deixar comentários em um documento ou trecho. Você pode ler o feedback e fazer as alterações você mesmo, ou pedir ao agente para editar o texto. Pedir comentários não exige entregar a redação a ele.",
        question4:
          "O Content consegue acompanhar tarefas e coletar pedidos da equipe?",
        answer4:
          "Sim. Crie um banco de dados com campos como responsável, status, data de entrega e próximo passo. Adicione descrições explicando o que cada campo deve conter. Essas descrições orientam seu agente de IA ao criar ou atualizar itens, inclusive para pedir informações que estejam faltando.",
        question5:
          "Posso controlar quem edita meu trabalho e restaurar uma versão anterior?",
        answer5:
          "Sim. Novos documentos são privados por padrão. Compartilhe-os com acesso de visualização, edição ou administração, e use o histórico de versões da página para restaurar um snapshot anterior. Restaurar um snapshot substitui o conteúdo atual da página.",
      },
      s001: "Captura de tela do modelo Content",
      // V4 landing page copy (2026-09-14) — hero through final CTA below.
      heroEyebrow: "Content",
      heroTitle: "Crie e organize seu trabalho com seu agente de IA",
      heroDescription:
        "Content é um espaço de trabalho gratuito e de código aberto para documentos, listas de tarefas e bancos de dados que você e seus agentes de IA podem ler e atualizar juntos.",
      heroCta: "Organize seu trabalho",
      useCasesHeading: "O que você pode fazer com o Content?",
      useCasesBody:
        "Trabalhe em um rascunho, acompanhe o que ainda precisa ser feito ou reúna os detalhes de um novo pedido.",
      useCase1Title: "Escreva e revise conteúdo",
      useCase1Body:
        "Peça ao seu agente de IA para redigir uma página, revisar um trecho ou deixar comentários no seu texto. Escolha como você quer que ele ajude.",
      useCase2Title: "Acompanhe o trabalho com seus agentes",
      useCase2Body:
        "Mantenha tarefas, status e próximos passos em uma tabela compartilhada. Peça aos seus agentes de IA conectados para atualizá-la enquanto você avança em um projeto.",
      useCase3Title: "Colete pedidos de projeto",
      useCase3Body:
        "Configure uma tabela para pedidos de design ou outro trabalho da equipe. Dê instruções em cada campo para que seu agente de IA possa pedir os detalhes que faltarem.",
      keyFeaturesEyebrow: "Principais recursos",
      keyFeaturesHeading:
        "Tudo o que você precisa para escrever, organizar e colaborar",
      feature1Title: "Escrita e revisão com IA",
      feature1Body:
        "Obtenha um primeiro rascunho, peça alterações no texto selecionado ou peça comentários. Seu agente de IA trabalha diretamente no documento.",
      feature2Title: "Documentos e páginas aninhadas",
      feature2Body:
        "Escreva páginas com títulos, tabelas, imagens e blocos de código. Agrupe documentos relacionados em um projeto e pesquise por título e conteúdo para encontrá-los.",
      feature3Title: "Bancos de dados e visualizações",
      feature3Body:
        "Organize o trabalho em tabelas, quadros ou calendários. Adicione campos para responsáveis, datas e status, com um documento completo por trás de cada linha.",
      feature4Title: "Instruções de página e campo",
      feature4Body:
        "Descreva o que deve constar em uma página ou em um campo do banco de dados. Dê aos seus agentes de IA orientações sobre as informações e o formato que você espera.",
      feature5Title: "Agentes de IA conectados",
      feature5Body:
        "Conecte agentes de ferramentas como Claude Code, Codex ou Cursor para ler e atualizar seus documentos e bancos de dados junto com o agente integrado.",
      feature6Title: "Colaboração em equipe",
      feature6Body:
        "Edite páginas em conjunto, comente trechos e responda em threads. Compartilhe com pessoas específicas ou com sua organização e escolha o nível de acesso delas.",
      finalCtaHeading: "Traga seu próximo projeto para o Content",
      finalCtaBody:
        "Comece com um documento, uma lista de tarefas ou uma tabela que sua equipe já usa.",
      finalCtaButton: "Organize seu trabalho",
      s002: "Todos os modelos",
      s003: "Código aberto Obsidian para MDX",
      s004: "Edite arquivos Markdown/MDX locais como Obsidian, gere blocos personalizados interativos avançados e escreva com um agente AI que conhece seus documentos.",
      s005: "Experimentar",
      s006: "Escreva",
      s007: "Editor rico para Markdown/MDX local com formatação, títulos, blocos de código e mídia.",
      s008: "Refinar com AI",
      s009: "Reescreva, expanda, resuma ou altere o tom de qualquer seleção.",
      s010: "Construir blocos MDX",
      s011: "Gere componentes interativos e mantenha-os editáveis em seus documentos.",
      s012: "Tudo que você precisa",
      s013: "Um espaço de trabalho de conteúdo completo - como Obsidian para MDX, com colaboração no estilo Notion quando você precisar.",
      s014: "Projetos e Documentos",
      s015: "Organize em projetos com documentos aninhados. Navegação e pesquisa na árvore da barra lateral.",
      s016: "Consciente da marca AI",
      s017: "O agente aprende sua voz, guia de estilo e tom. Cada rascunho soa como você.",
      s018: "Sincronização Notion bidirecional. Importe páginas de Notion, edite localmente e empurre as alterações de volta.",
      s019: "Arquivos locais Markdown/MDX",
      s020: "Edite documentos de repositório diretamente como Obsidian, visualize as alterações e sincronize-as novamente quando usar o modo hospedado.",
      s021: "Blocos MDX personalizados",
      s022: "Gere componentes locais interativos, insira-os em MDX e edite suas propriedades no documento UI.",
      s023: "Automação de scripts",
      s024: "Geração de conteúdo em lote, referência cruzada e pipelines de publicação.",
      s025: "Autoaperfeiçoamento",
      s026: "O agente modifica o próprio aplicativo. Precisa de um novo fluxo de trabalho? Basta perguntar.",
      s027: "Escreva aqui, publique em qualquer lugar",
      s028: "Conecte-se a qualquer CMS headless por meio de scripts. O agente cuida de todo o fluxo de trabalho.",
      s029: "Agente executa scripts de publicação de forma autônoma",
      s030: "Markdown, HTML ou qualquer formato de sua preferência",
      s031: "Sincronização Markdown/MDX local opcional para fluxos de trabalho que priorizam o arquivo",
      s032: "Rascunho de conteúdo no editor",
      s033: '"Publicar isto em WordPress"',
      s034: "Agente executa script de publicação",
      s035: "Content ativo em seu site",
      s036: "Como se compara",
      s037: "Interface do editor",
      s038: "Cheio, rígido",
      s039: "Chat apenas",
      s040: "Completo, personalizável",
      s041: "Conscientização da marca",
      s042: "Por conversa",
      s043: "Persistente, treinado",
      s044: "Arquivos MDX locais",
      s045: "Markdown em algumas ferramentas",
      s046: "Copiar e colar manualmente",
      s047: "Edição direta de arquivos com blocos personalizados",
      s048: "Publicação CMS",
      s049: "Etapa separada",
      s050: "Fluxo de trabalho integrado",
      s051: "Personalização",
      s052: "Apenas plug-ins",
      s053: "Somente aviso",
      s054: "Código fonte completo",
      s055: "Preços",
      s056: "Por assento",
      s057: "Assinatura",
      s058: "Gratuito e de código aberto",
      s059: "Comece em minutos",
      s060: "Traga seus documentos MDX, gere blocos interativos e comece a escrever com AI.",
      s061: "Leia os documentos",
      s062: "Ver todos os modelos",
    },
    design: {
      faq: {
        question1: "O que é o Agent-Native Design?",
        answer1:
          "Agent-Native Design é uma ferramenta de design e prototipagem com IA gratuita e de código aberto. Crie protótipos HTML interativos com um agente de IA, aplique sua marca e refine designs com controles visuais ou por chat. Compartilhe o resultado para receber feedback ou exporte para desenvolvimento.",
        question2: "Posso editar um design depois que a IA o gera?",
        answer2:
          "Sim. Ajuste texto, espaçamento e estilo com controles visuais, ou peça ao agente de IA para mudar o design. Você pode comparar direções diferentes e continuar refinando a que escolher.",
        question3: "Posso usar meu próprio design system?",
        answer3:
          "Sim. Vincule um design system para guiar cores, tipografia, estilo e diretrizes de marca. Você pode reutilizá-lo em vários designs e usá-lo como contexto para as revisões do agente de IA.",
        question4: "Posso trabalhar com designs vindos do Figma?",
        answer4:
          "Sim. Design oferece suporte a fluxos de importação do Figma e uma exportação SVG dedicada, pronta para o Figma. Revise fontes, layouts e elementos editáveis depois de transferir um design, já que a compatibilidade depende da origem e do formato de exportação.",
        question5: "O que posso exportar, e é um aplicativo pronto?",
        answer5:
          "Exporte o HTML ou um ZIP dos arquivos de design, ou prepare um repasse para um agente de programação. O protótipo oferece um ponto de partida para o desenvolvimento; a lógica da aplicação, integrações, testes e implantação ainda precisam de implementação e revisão. As exportações em HTML podem usar recursos externos em tempo de execução.",
      },
      s001: "Captura de tela do modelo Design",
      // V4 landing page copy (2026-09-14) — hero through final CTA below.
      heroEyebrow: "Design",
      heroTitle: "Crie protótipos interativos com seu agente de IA",
      heroDescription:
        "Design é uma ferramenta de design e prototipagem com IA gratuita e de código aberto para criar páginas e interfaces de produto com a identidade da sua marca, com designs que você mesmo pode editar.",
      heroCta: "Desenhe de graça",
      useCasesHeading: "O que você pode fazer com o Design?",
      useCasesBody:
        "Explore uma nova página, fluxo de produto ou interface antes de construí-la. Dê ao seu agente de IA o briefing e os detalhes que importam.",
      useCase1Title: "Explorar ideias de landing page",
      useCase1Body:
        "Transforme um briefing de campanha ou produto em um protótipo de landing page. Revise a mensagem, o layout e as chamadas para ação com sua equipe.",
      useCase2Title: "Trabalhar fluxos de produto",
      useCase2Body:
        "Crie o protótipo de um fluxo de onboarding, cadastro ou checkout. Percorra as etapas e refine a experiência antes de se comprometer com a implementação.",
      useCase3Title: "Criar dashboards e ferramentas internas",
      useCase3Body:
        "Transforme requisitos de fluxo de trabalho em um dashboard ou interface de administração. Explore como as pessoas vão encontrar informações e concluir suas tarefas diárias.",
      keyFeaturesEyebrow: "Principais recursos",
      keyFeaturesHeading:
        "Tudo que você precisa para criar, prototipar e compartilhar",
      feature1Title: "Protótipos interativos",
      feature1Body:
        "Descreva a página ou o fluxo de que você precisa. Seu agente de IA cria um protótipo HTML com interações que você pode testar na pré-visualização.",
      feature2Title: "Edição por IA e visual",
      feature2Body:
        "Ajuste texto, espaçamento e estilo com controles visuais, ou peça ao seu agente de IA para mudar o layout e as interações.",
      feature3Title: "Variações de design lado a lado",
      feature3Body:
        "Peça ao seu agente de IA diferentes direções de design. Compare-as na tela, escolha uma abordagem e continue refinando-a.",
      feature4Title: "Estilos de marca reutilizáveis",
      feature4Body:
        "Vincule um design system com suas cores, tipografia e estilo. Use-o para guiar novos designs e revisões em todo o seu projeto.",
      feature5Title: "Comentários de revisão de design",
      feature5Body:
        "Fixe um feedback em um elemento específico para manter o contexto claro. Envie um comentário ao seu agente de IA para trabalhar na mudança.",
      feature6Title: "Exportação HTML e repasse de código",
      feature6Body:
        "Exporte o HTML ou um ZIP dos seus arquivos de design. Dê a um desenvolvedor ou agente de programação o protótipo e o contexto para continuar a implementação.",
      finalCtaHeading: "Comece seu próximo design",
      finalCtaBody:
        "Traga um briefing. Explore as possibilidades. Refine os detalhes.",
      finalCtaButton: "Desenhe de graça",
      s002: "Descrever",
      s003: "Gerar",
      s004: "Refinar",
      s005: "Todos os modelos",
      s006: "O estúdio de prototipagem de código aberto AI HTML",
      s007: "Crie designs e protótipos interativos. Refine com ferramentas familiares ou faça edições de conversação. Exporte para qualquer lugar.",
      s008: "Crie algo",
      s009: "Como funciona",
      s010: "Tudo que você precisa",
      s011: "Um protótipo de estúdio com um agente que escreve e refina a fonte.",
      s012: "Protótipos HTML completos",
      s013: "Gere Alpine/Tailwind HTML independente que é renderizado no iframe de visualização e pode ser exportado diretamente.",
      s014: "Geração de variante",
      s015: "Comece em várias direções, compare-as no aplicativo e continue refinando o design mais forte.",
      s016: "Controles de ajustes",
      s017: "Ajuste visualmente variáveis de projeto comuns enquanto o agente lida com alterações estruturais e de cópia maiores.",
      s018: "Edições de conversação",
      s019: "“Deixe o título mais ousado”, “experimente uma paleta mais quente”, “adicione um botão CTA”. O agente atualiza o HTML subjacente.",
      s020: "Design Sistemas",
      s021: "Salve preferências de sistema de design reutilizáveis para que as novas gerações fiquem mais próximas da linguagem do seu produto.",
      s022: "Exporte para qualquer lugar",
      s023: "Exporte HTML, ZIP ou PDF do protótipo gerado quando estiver pronto para compartilhar ou entregar.",
      s024: "Visualização da fonte primeiro",
      s025: "A visualização é renderizada a partir do mesmo HTML que o agente edita e usa a exportação, portanto, há menos tradução entre o conceito e a transferência.",
      s026: "Pré-visualização do iframe do protótipo gerado",
      s027: "Artefatos exportáveis HTML, ZIP e PDF",
      s028: "Refinamento Conversacional",
      s029: "O agente edita a origem do protótipo. As instruções em inglês simples tornam-se alterações na cópia, layout, cores, espaçamento e interações.",
      s030: '"Faça isso parecer mais premium"',
      s031: '"Experimente uma paleta de cores mais escuras"',
      s032: '"Torne o layout do herói mais editorial"',
      s033: '"Gere três variações disso"',
      s034: "Como se compara",
      s035: "Ferramentas de maquete estática",
      s036: "Geradores de disparo único",
      s037: "Editor visual",
      s038: "Visual em primeiro lugar",
      s039: "Solicitar primeiro",
      s040: "Agente + visualização + código",
      s041: "AI geração",
      s042: "Limitado / plug-ins",
      s043: "Alerta único",
      s044: "Iterativo, conversacional",
      s045: "Saída editável",
      s046: "Arquivo nativo da ferramenta",
      s047: "Muitas vezes estático",
      s048: "Preencher HTML/CSS/JS",
      s049: "Personalização",
      s050: "Apenas plug-ins",
      s051: "Somente aviso",
      s052: "Código fonte completo",
      s053: "Preços",
      s054: "A partir de US$ 15/mês por usuário",
      s055: "Créditos por imagem",
      s056: "Gratuito e de código aberto",
      s057: "Comece em minutos",
      s058: "Comece com o modelo e comece a gerar protótipos interativos com um agente que edita a fonte.",
      s059: "Leia os documentos",
      s060: "Ver todos os modelos",
      s061: "100% grátis, código aberto e personalizável.",
    },
    dispatch: {
      faq: {
        question1: "O que é o Agent-Native Dispatch?",
        answer1:
          "O Agent-Native Dispatch é um aplicativo gratuito e de código aberto de orquestração de agentes de IA para um workspace Agent-Native. Ele coordena solicitações entre aplicativos conectados, recebe mensagens de canais compatíveis, agenda tarefas recorrentes e gerencia integrações compartilhadas.",
        question2: "Com quais aplicativos o Dispatch pode trabalhar?",
        answer2:
          "O Dispatch delega tarefas para aplicativos conectados e disponíveis no seu workspace, como Analytics ou Mail. Cada aplicativo cuida de suas próprias tarefas e dados. Configure as conexões e permissões relevantes antes de pedir ao Dispatch para usá-los.",
        question3: "Posso usar o Dispatch pelo Slack ou Telegram?",
        answer3:
          "Sim. Configure o canal de mensagens e vincule sua identidade à conta do workspace, se necessário. O Dispatch pode receber solicitações e retornar resultados por esse canal. Conectar um canal não concede automaticamente a todo remetente acesso a todos os aplicativos.",
        question4: "Os agentes podem executar tarefas em uma agenda?",
        answer4:
          "Sim. Configure uma tarefa recorrente e, se necessário, um destino de entrega para os resultados. O Dispatch mostra a última execução da tarefa, a próxima execução e o status de erro, para que você possa verificar se ela foi executada com sucesso.",
        question5: "As aprovações do Dispatch cobrem tudo o que um agente faz?",
        answer5:
          "Não. Em um workspace de equipe, o Dispatch pode exigir revisão das próprias alterações que faz em recursos e configurações compartilhados. Ações dentro de aplicativos conectados, como enviar e-mail, seguem os controles desses aplicativos. A fila de aprovações do Dispatch não é um portão universal para toda ação de agente.",
      },
      s001: "Captura de tela do modelo Dispatch",
      // V3 landing page copy (2026-09-12) — hero through final CTA below.
      heroEyebrow: "Dispatch",
      heroTitle: "Coordene seus agentes de IA em um só lugar",
      heroDescription:
        "O Dispatch é um aplicativo gratuito e de código aberto de orquestração de agentes de IA para delegar trabalho a aplicativos Agent-Native conectados, agendar tarefas recorrentes e gerenciar conexões compartilhadas.",
      heroCta: "Delegue uma tarefa",
      useCasesHeading: "O que você pode fazer com o Dispatch?",
      useCasesBody:
        "Peça ajuda a um aplicativo conectado, configure uma atualização regular ou investigue uma execução de agente que precisa de atenção.",
      useCase1Title: "Delegue trabalho a partir de uma única conversa",
      useCase1Body:
        "Peça um resumo de métricas ou um rascunho de resposta. O Dispatch encaminha a solicitação ao agente Analytics ou Mail conectado e retorna o resultado.",
      useCase2Title: "Configure atualizações recorrentes para a equipe",
      useCase2Body:
        "Agende um resumo diário de métricas ou um resumo semanal a partir dos seus aplicativos conectados. Escolha um canal ou caixa de entrada configurado para onde o resultado deve chegar.",
      useCase3Title: "Investigue a atividade dos agentes",
      useCase3Body:
        "Verifique a última execução de uma tarefa e quaisquer erros. Use os detalhes de threads e monitoramento disponíveis para investigar o que aconteceu quando um fluxo de trabalho precisa de atenção.",
      keyFeaturesEyebrow: "Principais recursos",
      keyFeaturesHeading:
        "Tudo o que você precisa para delegar, agendar e monitorar",
      feature1Title: "Delegação entre aplicativos",
      feature1Body:
        "Envie solicitações ao aplicativo conectado que cuida do trabalho. Cada aplicativo usa seu próprio agente, ações e dados para responder.",
      feature2Title: "Conexões de mensagens",
      feature2Body:
        "Conecte canais como Slack ou Telegram para enviar solicitações e receber respostas. Vincule identidades para que o Dispatch saiba qual usuário do workspace está perguntando.",
      feature3Title: "Tarefas agendadas",
      feature3Body:
        "Defina uma agenda para o trabalho recorrente. Veja se uma tarefa está ativada, quando foi executada pela última vez, a próxima execução e qualquer erro registrado.",
      feature4Title: "Destinos de entrega salvos",
      feature4Body:
        "Salve um canal do Slack, um chat do Telegram ou um endereço de e-mail como destino de entrega. Reutilize-o para resultados agendados e verifique o status da entrega.",
      feature5Title: "Integrações compartilhadas",
      feature5Body:
        "Configure uma conexão de provedor uma vez e conceda acesso aos aplicativos que precisam dela. Gerencie conexões compartilhadas e acesso de aplicativos a partir do Dispatch.",
      feature6Title: "Aprovações de mudanças no workspace",
      feature6Body:
        "Exija que outro administrador revise as mudanças que o Dispatch faz em recursos e configurações compartilhados. Revise solicitações pendentes e aprove ou rejeite-as em um workspace de equipe.",
      finalCtaHeading: "Comece com uma tarefa conectada",
      finalCtaBody:
        "Escolha os aplicativos de que você precisa e peça ao Dispatch para coordenar o trabalho.",
      finalCtaButton: "Delegue uma tarefa",
      s002: "+ Telegram incluído",
      s003: "Interagente",
      s004: "Memória",
      s005: "Jobs recorrentes",
      s006: "Todos os modelos",
      s007: "A base do seu agente",
      s008: "Fale com seu agente de Slack, Telegram ou qualquer mensageiro e ele encaminhará para seus outros aplicativos. Trabalhos, memória, aprovações e delegação A2A — tudo em um só lugar.",
      s009: "Experimentar",
      s010: "O que você pode fazer",
      s011: "Dispatch é a porta de entrada voltada para o mensageiro para toda a pilha nativa do agente.",
      s012: "Mensagens bidirecionais com contexto de thread, respostas do Block Kit e aprovações inline. Fale de qualquer lugar.",
      s013: "As rotas Dispatch funcionam para seus outros aplicativos nativos do agente por meio do protocolo A2A. Mail, slides, design — tudo acessível em um chat.",
      s014: "Empregos recorrentes",
      s015: "Programe o agente para ser executado em um cron – reuniões diárias, resumos semanais, verificações de hora em hora. Os resultados chegam ao seu mensageiro.",
      s016: "Aprovações",
      s017: "Controle ações confidenciais por meio de aprovação com um toque em Slack. Configurar por ação: enviar e-mail, postar atualização, executar automação.",
      s018: "Memória de agente persistente",
      s019: "Dispatch lembra o contexto em conversas, tópicos e canais. Diga suas preferências uma vez - isso as leva adiante.",
      s020: "Aprendizados capturados automaticamente em cada conversa",
      s021: "Escopos de memória global, por usuário e por organização",
      s022: "Inspecione e edite o que o agente lembra",
      s023: "Roteamento entre aplicativos",
      s024: "Dispatch é o centro. Conecte seus outros aplicativos nativos do agente e cada solicitação será roteada para o agente que pode realizar o trabalho.",
      s025: '"Enviar um deck para a equipe de design" → agente Slides',
      s026: '"Responder ao último e-mail de vendas" → agente Mail',
      s027: '"Resuma os eventos deste trimestre" → agente Analytics',
      s028: "Fale com seu agente de qualquer lugar",
      s029: 'Mande uma mensagem para seu agente em Slack às 7 AM, faça o acompanhamento de Telegram no trem, obtenha uma resposta Block Kit com um botão "Abrir tópico" para entrar na conversa completa.',
      s030: '"O que está na minha agenda amanhã?"',
      s031: '"Crie um deck para Monday all-hands"',
      s032: '"Faça minha reunião matinal às 9 AM todos os dias da semana"',
      s033: '"Avise-me quando a implantação terminar"',
      s034: "Como se compara",
      s035: "Fechados AI Assistentes",
      s036: "Roteamento entre aplicativos",
      s037: "Por bot",
      s038: "Produto único",
      s039: "Definido pelo fornecedor",
      s040: "Persistente, com escopo definido, inspecionável",
      s041: "Código personalizado",
      s042: "Limitado",
      s043: "Personalização",
      s044: "Encanamento SDK",
      s045: "Fechado",
      s046: "Código fonte completo",
      s047: "Preços",
      s048: "Taxas por aplicativo",
      s049: "A partir de US$ 20/mês por usuário",
      s050: "Gratuito e de código aberto",
      s051: "Comece em minutos",
      s052: "Comece com o modelo, conecte Slack ou Telegram e coloque seu agente em todas as conversas.",
      s053: "Leia os documentos",
      s054: "Ver todos os modelos",
    },
    forms: {
      faq: {
        question1: "O que é o Agent-Native Forms?",
        answer1:
          "Agent-Native Forms é um criador de formulários com IA gratuito e de código aberto. Crie formulários e pesquisas com um agente de IA, edite os campos visualmente, publique um link público e revise ou analise as respostas no mesmo app.",
        question2: "Posso editar um formulário depois que a IA o cria?",
        answer2:
          "Sim. Altere perguntas, rótulos, opções, campos obrigatórios e a ordem dos campos no editor visual, ou peça ao seu agente de IA para fazer as alterações. As duas formas atualizam o mesmo formulário. Você também pode adicionar perguntas condicionais com base em respostas anteriores.",
        question3:
          "As pessoas precisam de uma conta para preencher meu formulário?",
        answer3:
          "Não. Qualquer pessoa com o link público de um formulário publicado pode enviar uma resposta sem conta. Formulários em rascunho não são públicos, e formulários fechados param de aceitar novas respostas.",
        question4: "Posso coletar feedback anônimo?",
        answer4:
          "Sim. Ative o modo anônimo para omitir a identidade de quem responde e os metadados de origem. Também evite perguntas que peçam nome, e-mail ou outros dados de identificação se quiser que as respostas continuem anônimas.",
        question5: "Posso enviar as respostas para o Google Sheets ou o Slack?",
        answer5:
          "Sim, depois de configurar um destino para o formulário. Slack e Discord usam URLs de webhook. O Google Sheets exige um endpoint do Google Apps Script implantado que receba os envios; apenas um link de planilha não funciona. Você também pode usar um webhook ou exportar as respostas como CSV. Exportações do agente de todas as respostas em CSV ou JSON exigem armazenamento de arquivos conectado.",
      },
      s001: "Captura de tela do modelo Forms",
      heroEyebrow: "Forms",
      heroTitle: "Crie formulários com seu agente de IA",
      heroDescription:
        "Forms é um criador de formulários com IA gratuito e de código aberto para criar pesquisas, formulários de inscrição e formulários de solicitação, com perguntas que você mesmo pode editar e respostas que seu agente de IA pode ajudar a analisar.",
      heroCta: "Criar um formulário",
      useCasesHeading: "O que você pode fazer com o Forms?",
      useCasesBody:
        "Colete feedback de clientes, inscreva pessoas em um evento ou reúna os detalhes que sua equipe precisa para atender uma solicitação.",
      useCase1Title: "Colete feedback de clientes",
      useCase1Body:
        "Pergunte aos clientes sobre a experiência deles com avaliações, perguntas de múltipla escolha e respostas escritas. Peça ao seu agente de IA para resumir o feedback recebido.",
      useCase2Title: "Reúna inscrições e cadastros",
      useCase2Body:
        "Crie um formulário para um webinar, evento ou lista de espera de produto. Colete dados de contato e preferências, depois revise ou exporte os envios.",
      useCase3Title: "Colete solicitações de projeto",
      useCase3Body:
        "Ofereça às pessoas um formulário para solicitações de design, briefings de projeto ou suporte interno. Peça prazos, requisitos e outros detalhes que sua equipe precise.",
      keyFeaturesEyebrow: "Principais recursos",
      keyFeaturesHeading:
        "Tudo que você precisa para criar, compartilhar e analisar",
      feature1Title: "Geração de formulários com IA",
      feature1Body:
        "Descreva o que você quer coletar e seu agente de IA cria o formulário. Peça para ele adicionar perguntas ou revisar campos existentes.",
      feature2Title: "Edição visual de campos",
      feature2Body:
        "Edite rótulos, opções, campos obrigatórios e a ordem das perguntas você mesmo. Escolha tipos de campo como texto, e-mail, múltipla escolha, datas, avaliações e escalas.",
      feature3Title: "Perguntas condicionais",
      feature3Body:
        "Mostre uma pergunta de acompanhamento quando uma resposta anterior corresponder a uma regra. Peça mais detalhes quando alguém selecionar “Outro”, por exemplo.",
      feature4Title: "Links públicos do formulário",
      feature4Body:
        "Publique um formulário e compartilhe o link. Defina uma mensagem de conclusão ou redirecionamento, e feche o formulário quando parar de aceitar respostas.",
      feature5Title: "Insights e exportação de respostas",
      feature5Body:
        "Revise os envios em uma tabela ou peça ao seu agente de IA resumos e tendências das respostas. Baixe a tabela de respostas como CSV.",
      feature6Title: "Integrações de envio",
      feature6Body:
        "Configure o envio para Slack, Discord, Google Sheets ou um webhook. Novas respostas vão para o destino configurado para aquele formulário.",
      finalCtaHeading: "Crie seu próximo formulário",
      finalCtaBody: "Diga ao seu agente de IA o que você quer coletar.",
      finalCtaButton: "Criar um formulário",
      s002: "Descrever",
      s003: "Gerar",
      s004: "Rota",
      s005: "Todos os modelos",
      s006Primary: "A alternativa AI de código aberto para",
      s006Secondary: "Typeform e Google Forms",
      s007: "Gere um formulário completo a partir de um prompt, refine os campos de forma conversacional e encaminhe os envios para Slack, Discord, Google Sheets ou webhooks. Seja dono dos seus dados e do seu fluxo de trabalho, sem taxas por resposta.",
      s008: "Experimentar",
      s009: "Como funciona",
      s010: "Tudo que você precisa",
      s011: "Um construtor de formulário completo com AI integrado.",
      s012: "Todos os tipos de campo",
      s013: "Texto, e-mail, número, texto longo, seleção, seleção múltipla, caixa de seleção, rádio, data, classificação e escala.",
      s014: "Edição de campo visual",
      s015: "Atualize rótulos, espaços reservados, opções, estado obrigatório e ordem dos campos no editor ou perguntando ao agente.",
      s016: "Estilo personalizado",
      s017: "Combine com sua marca – cores, fontes, layout. Ou apenas peça ao agente para “fazer com que se pareça com o nosso site de marketing”.",
      s018: "Integrações de envio",
      s019: "Envie envios estruturados para Slack, Discord, Google Sheets ou um webhook quando cada resposta chegar.",
      s020: "Páginas de compartilhamento público",
      s021: "Cada formulário obtém uma URL pública com SEO completo. Incorpore em qualquer site ou hospede em seu próprio domínio.",
      s022: "Painel de envios",
      s023: "Tabela classificável, filtros, exportação CSV e visualizações detalhadas por envio. Todos os dados residem em seu banco de dados SQL.",
      s024: "Edição Visual + Conversacional",
      s025: "Arraste campos, edite rótulos, defina validação. Ou apenas descreva a mudança e o agente atualizará o mesmo esquema de formulário.",
      s026: "Reordenação de campos com arrastar e soltar",
      s027: "Visualização ao vivo junto com o editor",
      s028: "Desfazer/refazer com histórico completo",
      s029: "Construção de formulário de conversação",
      s030: "Ignore a rotina campo por campo. Descreva o formulário uma vez e depois refine-o com uma linguagem simples.",
      s031: '"Criar um formulário de candidatura de emprego"',
      s032: '"Adicionar um menu suspenso de nível de experiência obrigatório"',
      s033: '"Tornar o campo de e-mail obrigatório"',
      s034: '"Postar cada envio para Slack"',
      s035: "Como se compara",
      s036: "AI Geradores de Formulários",
      s037: "Editor visual",
      s038: "Sim, vinculado a modelo",
      s039: "Limitado/nenhum",
      s040: "Visual + agente + código",
      s041: "AI geração",
      s042: "Nenhum/básico",
      s043: "One-shot, rígido",
      s044: "Iterativo, conversacional",
      s045: "Integrações de envio",
      s046: "Manuais",
      s047: "Limitado",
      s048: "Propriedade de dados",
      s049: "Servidores do fornecedor",
      s050: "Hospedado pelo fornecedor",
      s051: "Seu banco de dados SQL",
      s052: "Preços",
      s053: "Taxas por resposta",
      s054: "Assinatura",
      s055: "Gratuito e de código aberto",
      s056: "Comece em minutos",
      s057: "Comece com o modelo e comece a coletar envios que você possui totalmente.",
      s058: "Leia os documentos",
      s059: "Ver todos os modelos",
    },
    mail: {
      faq: {
        question1: "O que é o Agent-Native Mail?",
        answer1:
          "O Agent-Native Mail é um cliente de e-mail gratuito e de código aberto para o Gmail com um assistente de e-mail com IA. Leia e pesquise mensagens, resuma conversas, redija respostas e organize seu e-mail pela caixa de entrada ou pelo seu agente de IA.",
        question2: "O Mail funciona com minha conta do Gmail existente?",
        answer2:
          "Sim. Conecte sua conta do Gmail existente para ler e enviar e-mails pelo Mail. Você pode conectar várias contas do Gmail e pesquisar em todas elas. O Mail não oferece um novo endereço de e-mail, e atualmente é compatível com o Gmail, e não com o Outlook ou outros provedores de e-mail.",
        question3: "O agente de IA vai enviar e-mails sem minha aprovação?",
        answer3:
          "Quando você pede ao agente de IA para enviar um e-mail no chat, é necessária sua aprovação. Envios acionados por automações também exigem aprovação, a menos que você ative explicitamente o envio automático nas configurações do Mail. Você pode revisar e editar os rascunhos antes de enviá-los.",
        question4:
          "A IA pode organizar minha caixa de entrada automaticamente?",
        answer4:
          "Sim. Crie regras em linguagem natural para rotular, arquivar, marcar com estrela ou marcar como lidas as mensagens recebidas. O Mail também é compatível com filtros nativos do Gmail para condições como remetente ou assunto. Os filtros do Gmail rodam no Gmail e continuam funcionando mesmo com o Mail fechado.",
        question5:
          "Um colega de equipe pode preparar um e-mail para eu revisar?",
        answer5:
          "Sim. Um colega de equipe pode solicitar um rascunho que aparece na sua fila de revisão. Abra-o, edite a mensagem e envie quando estiver pronto. Quem solicitou não pode enviá-lo em seu nome; quem controla o envio é o dono do rascunho ou um administrador da organização.",
      },
      s001: "Captura de tela do modelo Mail",
      // V3 landing page copy (2026-09-10) — hero through final CTA below.
      heroEyebrow: "Mail",
      heroTitle: "Gerencie sua caixa de entrada com seu agente de IA",
      heroDescription:
        "O Mail traz classificação de prioridade, rótulos sensíveis ao contexto, resumos de conversas e regras de segundo plano em uma caixa de entrada do Gmail com teclado, com um agente que pode dar o próximo passo.",
      heroCta: "Gerencie sua caixa de entrada",
      useCasesHeading: "Deixe o Mail dar o primeiro passo",
      useCasesBody:
        "Revele conversas urgentes, rotule as mensagens por significado e mantenha o trabalho repetitivo da caixa de entrada em andamento enquanto você mantém o controle.",
      useCase1Title: "Veja o que precisa de você hoje",
      useCase1Body:
        "O Mail classifica os tópicos por urgência, prazos e quem está esperando e, em seguida, fornece um resumo da caixa de entrada com as próximas ações úteis.",
      useCase2Title: "Rotular mensagens por significado",
      useCase2Body:
        "O agente pode aplicar rótulos do contexto do remetente e da conversa, para que as conversas de pesquisa, finanças e clientes fiquem fáceis de encontrar.",
      useCase3Title: "Automatize o trabalho de rotina",
      useCase3Body:
        "Defina regras para rotular ou arquivar novos e-mails em segundo plano e revise o histórico de execução sempre que desejar.",
      keyFeaturesEyebrow: "Principais recursos",
      keyFeaturesHeading:
        "Tudo o que você precisa para ler, escrever e organizar e-mails",
      feature1Title: "Classificação prioritária",
      feature1Body:
        "Classifique os tópicos recebidos por urgência e contexto, para que os prazos e as pessoas que aguardam uma resposta cheguem ao topo.",
      feature2Title: "Rótulos contextuais de IA",
      feature2Body:
        "Classifique as mensagens de acordo com o assunto da conversa e mantenha as mensagens semelhantes agrupadas à medida que chegam.",
      feature3Title: "Caixa de entrada controlada por agente",
      feature3Body:
        "Peça ao agente para pesquisar, resumir, rotular, arquivar, marcar com estrela ou preparar uma resposta na caixa de entrada que você está visualizando.",
      feature4Title: "Automações em segundo plano",
      feature4Body:
        "Aplique regras de linguagem simples às mensagens recebidas e inspecione as ações que o Mail tomou.",
      feature5Title: "Revise antes de enviar",
      feature5Body:
        "Peça ao agente para redigir ou revisar uma resposta e, em seguida, revise-a e edite-a antes que ela saia da sua caixa de entrada.",
      feature6Title: "Pesquisa em várias contas",
      feature6Body:
        "Pesquise contas do Gmail conectadas e use a mesma prioridade, rótulos e ferramentas de agente em um só lugar.",
      finalCtaHeading: "Comece com seu próximo e-mail",
      finalCtaBody:
        "Abra uma conversa e peça ao seu agente de IA um resumo ou um rascunho de resposta.",
      finalCtaButton: "Gerencie sua caixa de entrada",
      s002: "Teclado primeiro",
      s003: "Triagem da caixa de entrada",
      s004: "Visualizações",
      s005: "Personalizável",
      s006: "Todos os modelos",
      s007Primary: "A alternativa de código aberto para",
      s007Secondary: "Superhuman e Gmail",
      s008: "Experimentar",
      s009: "A demonstração hospedada usa o aplicativo Google compartilhado de Agent-Native para acesso de Gmail, então Google pode pedir que você confirme antes de continuar. Execute localmente para usar seu próprio cliente Google OAuth.",
      s010: "O que você pode fazer",
      s011: "Tudo o que você precisa para substituir seu cliente de e-mail por uma caixa de entrada com tecnologia AI que você possui totalmente.",
      s012: "Atalhos de teclado",
      s013: "AI Triagem",
      s014: "O agente lê sua caixa de entrada, revela o que é importante, redige respostas e lida com e-mails de rotina automaticamente. Configure automações para etiquetagem e arquivamento automáticos.",
      s015: "Pesquisa inteligente",
      s016: 'Pesquisa em linguagem natural em toda a sua caixa de entrada. "E-mails da semana passada sobre o orçamento" simplesmente funciona.',
      s017: "Autoaperfeiçoamento",
      s018: "O agente modifica o próprio aplicativo. Precisa de uma pasta, filtro ou automação personalizada? Basta perguntar.",
      s019: "Gerenciamento de caixa de entrada com tecnologia AI",
      s020: "Deixe o agente fazer o trabalho pesado: triagem, rótulo, arquivamento e rascunho das respostas a partir de instruções em linguagem natural.",
      s021: "Rotulagem automática, classificação de prioridade e regras de arquivamento automático",
      s022: "Respostas elaboradas por AI para mensagens de rotina",
      s023: "Resumo do tópico e itens de ação",
      s024: "Composição com o teclado primeiro",
      s025: "Escreva e envie e-mails na velocidade do pensamento. Navegação completa pelo teclado, atalhos no estilo Notion e desenho assistido por AI.",
      s026: "Várias guias de rascunho para redigir vários e-mails de uma vez",
      s027: "AI expande rascunhos curtos em e-mails completos",
      s028: "Enviar mais tarde, suspender e lembretes de acompanhamento",
      s029: "Fluxos de trabalho de e-mail com tecnologia de agente",
      s030: "O agente lê, rascunha e organiza seu e-mail por meio de linguagem natural. Cada fluxo de trabalho é um script que você pode inspecionar e estender.",
      s031: '"Resumir meus e-mails não lidos desta semana"',
      s032: '"Elabore uma resposta para o tópico de atualização do investidor"',
      s033: '"Arquivar todos os boletins informativos com mais de 7 dias"',
      s034: '"Encontre todos os e-mails que aguardam uma resposta minha"',
      s035: "Como se compara",
      s036: "Atalhos de teclado",
      s037: "Básico",
      s038: "Excelente",
      s039: "Totalmente personalizável",
      s040: "AI assistência",
      s041: "Escrita inteligente",
      s042: "AI responde",
      s043: "Agente completo: triagem, rascunho, automatização",
      s044: "Personalização",
      s045: "Apenas configurações",
      s046: "Apenas temas",
      s047: "Código fonte completo",
      s048: "Propriedade de dados",
      s049: "Servidores de Google",
      s050: "Hospedado pelo fornecedor",
      s051: "Você possui o código",
      s052: "Preços",
      s053: "Gratuito / Espaço de trabalho",
      s054: "$30/mês por usuário",
      s055: "Gratuito e de código aberto",
      s056: "Comece em minutos",
      s057: "Comece com o modelo, conecte seu provedor de e-mail e comece a gerenciar sua caixa de entrada com AI.",
      s058: "Leia os documentos",
      s059: "Ver todos os modelos",
      s060: "Nota da demonstração hospedada",
    },
    plan: {
      faq: {
        question1: "O que é o Agent-Native Plans?",
        answer1:
          "Agent-Native Plans é uma ferramenta de planejamento visual gratuita e de código aberto para agentes de programação com IA. Revise planos de implementação com diagramas, wireframes, código anotado e comentários, ou gere recapitulações visuais de mudanças já concluídas.",
        question2: "Como uso o Plans com meu agente de programação?",
        answer2:
          "Instale as skills de planejamento e o conector com `npx @agent-native/core@latest skills add visual-plan`, depois conclua a etapa de autenticação do seu cliente. O guia de instalação cobre clientes como Claude Code e Codex. Use `/visual-plan` para pedir ao seu agente um plano de implementação visual.",
        question3:
          "Meu agente pode revisar um plano com base nos meus comentários?",
        answer3:
          "Sim. Deixe comentários no texto ou fixe-os em um elemento visual, depois peça ao seu agente para ler e responder ao feedback. Ele pode atualizar o plano e responder às discussões de revisão. Isso apoia seu processo de revisão; não impede automaticamente que o agente altere o código.",
        question4: "Posso usar o Plans para revisar código que já foi escrito?",
        answer4:
          "Sim. Use `/visual-recap` com um pull request, commit, branch ou diff para obter uma explicação visual da mudança. Use a recapitulação para guiar sua revisão do código e dos testes reais.",
        question5: "Onde os planos ficam salvos, e posso compartilhá-los?",
        answer5:
          "A instalação padrão conecta seu agente ao aplicativo Plans hospedado. Novos planos hospedados são privados até que você os compartilhe. Colegas de equipe podem revisar planos compartilhados no navegador; comentar exige uma conta. Fluxos de trabalho locais também estão disponíveis pelo guia de configuração.",
      },
      s001: "Captura de tela do modelo Plans",
      heroEyebrow: "Plans",
      heroTitle:
        "Veja o que seu agente de programação com IA planeja construir",
      heroDescription:
        "Plans é uma ferramenta de planejamento visual gratuita e de código aberto para revisar a abordagem do seu agente de programação, dar feedback e entender mudanças de código por meio de diagramas, wireframes e código anotado.",
      heroCta: "Planeje visualmente",
      heroSecondaryCta: "Abrir o Plans",
      useCasesHeading: "O que você pode fazer com o Plans?",
      useCasesBody:
        "Revise uma abordagem de implementação, avalie uma interface ou entenda uma mudança concluída com seu agente de programação com IA.",
      useCase1Title: "Revise a arquitetura antes da implementação",
      useCase1Body:
        "Peça ao seu agente de programação para diagramar um recurso ou refatoração proposta. Verifique o fluxo de dados, as dependências e os pontos de falha antes que ele comece a alterar o código.",
      useCase2Title: "Avalie mudanças de interface",
      useCase2Body:
        "Revise telas e fluxos de usuário propostos com seu agente de programação. Aponte estados ou interações ausentes e peça a ele para revisar o plano.",
      useCase3Title: "Entenda mudanças de código já concluídas",
      useCase3Body:
        "Peça ao seu agente de programação uma recapitulação visual de um pull request, commit ou branch. Revise as mudanças de comportamento e os arquivos afetados.",
      keyFeaturesEyebrow: "Principais recursos",
      keyFeaturesHeading:
        "Tudo que você precisa para visualizar, revisar e discutir",
      feature1Title: "Diagramas de arquitetura",
      feature1Body:
        "Mostre fluxos de solicitação, relações entre sistemas e modelos de dados dentro de um plano. Peça ao seu agente de programação com IA para atualizar os diagramas conforme a abordagem muda.",
      feature2Title: "Wireframes e protótipos",
      feature2Body:
        "Revise layouts de tela e opções de protótipo interativo junto com o plano de implementação. Dê feedback sobre a interface proposta antes de pedir ao seu agente para construí-la.",
      feature3Title: "Passo a passo de código anotado",
      feature3Body:
        "Leia arquivos de origem com notas por linha e explicações das mudanças. Use árvores de arquivos para ver onde o trabalho proposto se encaixa na base de código.",
      feature4Title: "Comentários e anotações",
      feature4Body:
        "Comente no texto ou fixe feedback em um ponto específico de um elemento visual. Direcione perguntas ao seu agente ou a um colega de equipe.",
      feature5Title: "Recapitulações visuais de código",
      feature5Body:
        "Use `/visual-recap` para transformar um pull request, commit, branch ou diff existente em um passo a passo com diagramas e explicações das mudanças.",
      feature6Title: "Compartilhamento e exportações",
      feature6Body:
        "Compartilhe um plano para que colegas de equipe revisem no navegador. Exporte-o como HTML, Markdown, JSON ou MDX quando precisar de uma cópia separada.",
      finalCtaHeading: "Revise sua próxima tarefa de programação visualmente",
      finalCtaBody:
        "Peça um plano ao seu agente, depois avaliem os detalhes juntos.",
      finalCtaButton: "Planeje visualmente",
    },
    slides: {
      faq: {
        question1: "O que é o Agent-Native Slides?",
        answer1:
          "Agent-Native Slides é um criador de apresentações de IA gratuito e de código aberto. Crie decks com a identidade da sua marca a partir das suas ideias e materiais de origem com um agente de IA, depois edite os slides você mesmo, apresente ou exporte para o PowerPoint.",
        question2: "Posso editar os slides depois que a IA os gera?",
        answer2:
          "Sim. Edite texto, layout e estilo diretamente no editor visual, ou peça ao agente de IA para revisar um slide selecionado. Você pode continuar refinando a apresentação depois do primeiro rascunho.",
        question3:
          "Posso criar uma apresentação a partir de um deck ou documento existente?",
        answer3:
          "Sim. Anexe um deck ou documento como material de referência para uma nova apresentação. Para trabalhar no deck existente propriamente dito, importe-o explicitamente. Revise os slides importados em busca de mudanças de layout ou imagens ausentes.",
        question4:
          "Posso usar minhas próprias cores de marca, fontes e logotipo?",
        answer4:
          "Sim. Aplique um design system com as cores, tipografia e logotipos da sua marca, e reutilize-o em vários decks. Você também pode fornecer uma apresentação de referência para guiar as escolhas de design do agente de IA.",
        question5:
          "Posso usar minha apresentação no PowerPoint ou no Google Slides?",
        answer5:
          "Exporte um arquivo PPTX para abrir no PowerPoint. Para usar a apresentação no Google Slides, importe esse arquivo lá. Revise fontes e layouts após a exportação, pois podem ser renderizados de forma diferente entre os editores.",
      },
      s001: "Captura de tela do modelo Slides",
      // V4 landing page copy (2026-09-11) — hero through final CTA below.
      heroEyebrow: "Slides",
      heroTitle: "Crie apresentações com seu agente de IA",
      heroDescription:
        "Slides é um criador de apresentações de IA gratuito e de código aberto para criar decks com a identidade da sua marca a partir das suas ideias e materiais de origem, com slides que você mesmo pode editar.",
      heroCta: "Criar um deck",
      useCasesHeading: "O que você pode fazer com o Slides?",
      useCasesBody:
        "Prepare um pitch, apresente um plano ou compartilhe uma atualização. Dê ao seu agente de IA o material e o público que você tem em mente.",
      useCase1Title: "Criar apresentações de vendas e pitch",
      useCase1Body:
        "Transforme o briefing do seu produto em um deck para clientes em potencial ou investidores. Ajuste a narrativa ao público para quem você está apresentando.",
      useCase2Title: "Apresentar planos e estratégias",
      useCase2Body:
        "Dê ao seu agente de IA um briefing de estratégia ou plano de lançamento para transformar em slides que expliquem a direção e os próximos passos propostos.",
      useCase3Title: "Compartilhar atualizações do negócio",
      useCase3Body:
        "Transforme anotações de projetos ou relatórios de desempenho em uma apresentação que mostre o progresso, explique os resultados e destaque o que precisa de atenção.",
      keyFeaturesEyebrow: "Principais recursos",
      keyFeaturesHeading:
        "Tudo que você precisa para criar, editar e apresentar",
      feature1Title: "Geração de apresentações por IA",
      feature1Body:
        "Comece com um prompt, documento ou deck de referência. Dê ao seu agente de IA o tema e o público para construir a apresentação em torno deles.",
      feature2Title: "Edição por IA e visual",
      feature2Body:
        "Selecione o texto para que seu agente de IA o revise, ou edite texto, layout e estilo diretamente no slide você mesmo.",
      feature3Title: "Estilos de marca reutilizáveis",
      feature3Body:
        "Salve suas cores, fontes e logotipos em um design system. Aplique-o em vários decks para manter as apresentações consistentes com sua marca.",
      feature4Title: "Imagens e logotipos",
      feature4Body:
        "Peça ao seu agente de IA para gerar imagens, encontrar fotos ou procurar logotipos de empresas para usar nos seus slides.",
      feature5Title: "Colaboração em equipe",
      feature5Body:
        "Trabalhe em decks com colegas de equipe, deixe comentários em slides específicos e restaure uma versão anterior quando precisar.",
      feature6Title: "Apresentação e exportação",
      feature6Body:
        "Apresente em tela cheia com notas do apresentador, compartilhe um link de visualização ou exporte seu deck como um arquivo do PowerPoint.",
      finalCtaHeading: "Comece sua próxima apresentação",
      finalCtaBody: "Traga uma ideia, um briefing ou um deck já existente.",
      finalCtaButton: "Criar um deck",
      s002: "Descrever",
      s003: "Gerar",
      s004: "Refinar",
      s005: "Todos os modelos",
      s006Primary: "Apresentações de slides",
      s006Secondary: "Com sua marca e editáveis",
      s007: "Gere apresentações com a identidade da sua marca usando seu agente de IA, depois edite os slides você mesmo e exporte para qualquer lugar.",
      s008: "Experimentar",
      s009: "Como funciona",
      s010: "Tudo que você precisa",
      s011: "Um estúdio de apresentação completo com AI integrado.",
      s012: "Layouts de slides prontos",
      s013: "Use nossos modelos de slides iniciais. Crie e reutilize seus próprios modelos depois.",
      s014: "Edição visual + código",
      s015: "Clique para editar estilos, clique duas vezes para texto. Mude para HTML bruto para controle total.",
      s016: "Geração de imagens sem atrito",
      s017: "Use estilos de referência e diretrizes de marca. Escolha entre opções geradas pela AI do Gemini.",
      s018: "Pesquisa de logotipo e imagem",
      s019: "Pesquise logotipos de empresas via Logo.dev ou Brandfetch. Google Imagens para banco de imagens.",
      s020: "Reordenação de arrastar e soltar",
      s021: "Reordene os slides na barra lateral. Duplicar ou excluir com ações instantâneas.",
      s022: "Modo de apresentação",
      s023: "Tela inteira com navegação por teclado, controles de ocultação automática e anotações do orador.",
      s024: "Compartilhamento e colaboração",
      s025: "Gere links de compartilhamento para acesso somente leitura à apresentação. Histórico completo de desfazer/refazer com entradas rotuladas.",
      s026: "Compartilhe links com acesso somente leitura",
      s027: "Cmd+Z desfazer/refazer com histórico completo",
      s028: "Navegue para qualquer ponto da história",
      s029: "Refinamento Conversacional",
      s030: "O agente edita os slides diretamente e o UI é atualizado por meio da sincronização de sondagem.",
      s031: '"Torne o título maior"',
      s032: '"Adicionar um gráfico no slide 3"',
      s033: '"Mude o esquema de cores para azul"',
      s034: '"Adicionar notas do orador ao slide 5"',
      s035: "Como se compara",
      s036: "AI Geradores de slides",
      s037: "Editor visual",
      s038: "Sim, vinculado a modelo",
      s039: "Limitado/nenhum",
      s040: "Visual + código + agente",
      s041: "AI geração",
      s042: "Básico/nenhum",
      s043: "One-shot, rígido",
      s044: "Iterativo, conversacional",
      s045: "Geração de imagem",
      s046: "Básico",
      s047: "Personalização",
      s048: "Apenas temas",
      s049: "Somente aviso",
      s050: "Código fonte completo",
      s051: "Preços",
      s052: "Grátis / por assento",
      s053: "Assinatura",
      s054: "Gratuito e de código aberto",
      s055: "Crie uma apresentação de slides agora",
      s056: "Escolha suas preferências de design e insira um prompt para começar. Sempre grátis.",
      s057: "Leia os documentos",
      s058: "Ver todos os modelos",
      howItWorksDescribe:
        "Descreva seu tema, público e tom. Anexe uma apresentação de referência. Comece pela interface ou pelo seu próprio fluxo de trabalho de IA.",
      signInIntegration:
        "Entre para acessar o Slides por integração via webhook, MCP ou A2A.",
      signIn: "Entrar",
      tryNow: {
        step: "Etapa {{current}} de {{total}}",
        q1: "Que tipo de apresentação você precisa?",
        q1Pitch: "Pitch deck para investidores",
        q1Sales: "Apresentação de vendas para clientes",
        q1Talk: "Apoio para uma palestra ou aula ao vivo",
        q1Other: "Outra coisa",
        q1OtherPlaceholder: "Descreva o tipo de apresentação",
        q2Pitch: "Qual é a empresa e a rodada de captação?",
        q2Sales: "O que você está vendendo, e para quem?",
        q2Talk: "Sobre o que é a palestra, e quem está na sala?",
        q2Other: "O que a apresentação deve abordar?",
        q2Detail: "Digite anotações ou apenas me passe a URL de um site",
        q2Placeholder: "Anotações, ou https://example.com",
        q3: "Me dê um estilo para seguir",
        q3Detail: "Cole um site para servir de referência, ou escolha um clima",
        q3Placeholder: "https://example.com",
        q3VibeToggle: "Sem site? Escolha um clima",
        q3VibeMinimal: "Minimalista e editorial",
        q3VibeBold: "Marcante e de alto contraste",
        q3VibeWarm: "Acolhedor e humano",
        q3VibeTechnical: "Técnico e denso em dados",
        answerAction: "Adicionar ao prompt",
        composerLabel: "Seu prompt",
        composerPlaceholder:
          "Descreva a apresentação que você quer, ou responda às perguntas acima.",
        promptTip: "Dica de prompt",
        promptPlaceholder:
          "Seja específico. Diga para quem é, cole suas notas ou faça referência a um design de site...",
        submit: "Gerar minha apresentação",
        readyHint: "Seu prompt está pronto — envie para o agente.",
        promptDeck: "Crie {{deck}}.",
        promptSubject: "Veja o que ela deve abordar: {{subject}}",
        promptStyleSite: "Use a aparência e o estilo de {{style}}.",
        promptStyleVibe: "Estilo: {{style}}.",
        promptClose:
          "Elabore a apresentação completa com notas do orador e, em seguida, me guie pelo roteiro.",
        deckPitch: "um pitch deck para investidores",
        deckSales: "uma apresentação de vendas para clientes",
        deckTalk: "uma apresentação de apoio para uma palestra ao vivo",
        designReference: "Referência de design",
        websiteUrl: "URL do site",
        websiteUrlPlaceholder: "https://example.com",
        crawlWebsite: "Inspecionar site",
        crawlError:
          "Não foi possível inspecionar este site. Talvez ele bloqueie o acesso automatizado. Tente outra URL ou envie uma referência de design.",
        or: "ou",
        uploadDesignReference: "Enviar referência de design",
        importDesignSystem: "Importar sistema de design",
        loginDesignSystems: "Entre para gerenciar sistemas de design.",
        promptCreatePrefix: "Crie uma apresentação de",
        deckTypeLabel: "Tipo de apresentação",
        deckCapitalRaise: "captação de investimentos",
        deckOfferingMemorandum: "memorando de oferta",
        deckB2bSales: "vendas B2B",
        deckTeamMeeting: "pauta de reunião da equipe",
        deckLiveTalk: "apoio para palestra ao vivo",
        promptDeckFor: "para",
        promptTextShouldBe: "O texto deve ser",
        textAmountLabel: "Quantidade de texto",
        textMinimal: "mínimo",
        textBrief: "breve",
        textThorough: "detalhado",
        findingTitle: "título",
        findingDescription: "descrição",
        findingColors: "cores",
        findingFonts: "fontes",
        findingPrimaryColor: "cor principal",
        findingAccentColor: "cor de destaque",
        findingHeadingFont: "fonte dos títulos",
        findingBodyFont: "fonte do corpo",
        styleGuidePrefix: "Guia de estilo para",
      },
    },
  },
  skillsPage: {
    metaTitle:
      "Skills de agente - Visual Plan, Visual Recap e Visual Edit para agentes de codigo",
    metaDescription:
      "Instale skills com apps Agent-Native para seu agente de codigo usar planejamento visual, recaps de PR e edicao visual local.",
    metaOgDescription:
      "De comandos slash ao seu agente de codigo com apps Agent-Native que voce pode hospedar, inspecionar e customizar.",
    metaKeywords:
      "skills de agente, visual plan, visual recap, visual edit, agente de codigo, Claude Code, Codex, revisao de PR, planejamento, agent-native",
    heroTitle: "Dê novos superpoderes ao seu agente de codigo",
    heroBody:
      "Instale skills com apps Agent-Native que voce pode customizar por completo: planejamento visual antes da implementacao, recaps visuais de PR depois das mudancas e edicao visual de fluxos UI locais.",
    sectionTitle: "Skills com apps para agentes de codigo",
    sectionBody:
      "Use links de apps hospedados e compartilháveis, arquivos locais ou um app auto-hospedado/customizado; seu agente recebe instrucoes e a superficie MCP correspondente quando ela e necessaria.",
    ctaBody:
      "Funciona com Claude Code, Codex, Cursor, Pi, OpenCode, GitHub Copilot / VS Code e agentes de codigo similares.",
    readVisualPlansDocs: "Ler a documentacao do Visual Plans",
    browseTemplates: "Explorar templates",
    visualPlan: {
      name: "Plano visual",
      tagline: "Revise antes do codigo",
      description:
        "Transforma uma tarefa de codigo em um plano compartilhavel com diagramas, notas de arquivos e esbocos opcionais de UI.",
      feature1: "Veja o formato da implementacao antes das mudancas chegarem",
      feature2: "Comente, revise, aprove ou transfira",
      videoAriaLabel: "Video de demonstracao da skill Visual Plan",
    },
    visualRecap: {
      name: "Recap visual",
      tagline: "Revise depois das mudancas",
      description:
        "Transforma um PR ou git diff em um recap compartilhavel do que mudou e por que.",
      feature1: "Resume mudancas de schema, API e arquivos",
      feature2: "Opcionalmente publica um comentario fixo no PR",
      videoAriaLabel: "Video de demonstracao da skill Visual Recap",
    },
    visualEdit: {
      name: "Edicao visual",
      tagline: "Edite fluxos UI locais",
      description:
        "Abre um app localhost em execucao no Design como telas baseadas em URL para revisao e edicao visual.",
      feature1: "Organize fluxos de varias telas a partir de URLs ordenadas",
      feature2: "Inspecione, duplique e refine estados de rotas ao vivo",
      videoAriaLabel: "Video de demonstracao da skill Visual Edit",
    },
  },
  downloadPage: {
    title: "Baixar Agent-Native",
    body: "Experimente apps agênticos para reuniões, design, apresentações, dados, agendamento, e-mail e muito mais, tudo em um único app de desktop.",
    openDesktop: "Abrir Agent-Native",
    downloadInstaller: "Baixar instalador",
    downloadStarted: "Download iniciado",
    downloadAgain: "Não funcionou? Tente baixar novamente",
    loadError: "Não foi possível carregar o instalador desktop mais recente.",
    checkingRelease: "Verificando a versão desktop mais recente...",
    retry: "Tentar novamente",
    unavailable: "Instalador indisponível para esta plataforma",
    allPlatforms: "Todas as plataformas",
    stable: "Estável",
    nightly: "Nightly",
    runFromSource: "Crie o seu",
    runFromSourceBody:
      "Crie um app Agent-Native pela linha de comando e execute-o localmente no macOS, Windows ou Linux.",
    platforms: {
      mac: {
        primary: "Baixar para Apple Silicon",
        alternative: "Mac Intel",
        gridPrimary: "Apple Silicon",
        gridAlternative: "Intel",
      },
      windows: {
        primary: "Baixar para Windows",
        alternative: "ARM64",
        gridPrimary: "Instalador x64",
        gridAlternative: "Instalador Arm64",
        note: "Windows 10 ou posterior.",
      },
      linux: {
        primary: "Baixar arquivo Linux",
        appImage: "Baixar AppImage",
        deb: "Baixar .deb",
        gridPrimary: "x86_64",
        gridAppImage: "Universal",
        gridDeb: "Debian / Ubuntu",
        note: "O arquivo funciona sem FUSE. AppImage pode exigir FUSE 2 em algumas distribuições.",
      },
    },
  },
  brandPage: {
    eyebrow: "Recursos da marca",
    title: "Logotipos do Agent-Native",
    body: "Baixe os logotipos e símbolos oficiais para artigos, apresentações e projetos da comunidade. Os arquivos SVG permanecem nítidos em qualquer tamanho e aceitam fundos transparentes.",
    horizontal: {
      title: "Logotipo horizontal",
      body: "A composição recomendada para cabeçalhos de artigos, sites, apresentações e outros espaços largos.",
    },
    symbol: {
      title: "Símbolo",
      body: "Use o símbolo isolado em avatares, ícones de aplicativos e espaços compactos.",
    },
    lightBackground: "Para fundos claros",
    darkBackground: "Para fundos escuros",
    downloadSvg: "Baixar SVG",
    usage: {
      title: "Uso da marca",
      clear: {
        title: "Mantenha a clareza",
        body: "Preserve as proporções do logotipo e deixe espaço livre suficiente ao redor dele.",
      },
      contrast: {
        title: "Escolha pelo contraste",
        body: "Use a versão escura em fundos claros e a versão clara em fundos escuros.",
      },
      original: {
        title: "Use a arte original",
        body: "Não altere as cores, recorte, gire, estique ou reorganize o logotipo ou o símbolo.",
      },
    },
  },
  legal: {
    lastUpdated: "Última atualização: {{date}}",
    resources: {
      eyebrow: "Recursos jurídicos",
      title: "Recursos jurídicos do Agent-Native",
      intro:
        "Políticas jurídicas independentes do Agent-Native para aplicações e serviços hospedados.",
      agentNative: {
        title: "Políticas do Agent-Native",
        body: "Estas páginas adaptam o conjunto de políticas compartilhado ao projeto open source e aos exemplos hospedados do Agent-Native.",
        terms: "Termos de Serviço do Agent-Native",
        privacy: "Política de Privacidade do Agent-Native",
      },
      builder: {
        title: "Políticas adicionais do serviço hospedado",
        body: "Estas cópias locais abrangem uso aceitável, recursos de IA, regras da plataforma, suspensão e remoção, direitos autorais e solicitações de autoridades. A versão em inglês prevalece.",
      },
      links: {
        terms: "Contrato de Serviços SaaS",
        privacy: "Política de Privacidade",
        acceptableUse: "Política de Uso Aceitável",
        aiTerms: "Termos de IA",
        platformRules: "Regras da Plataforma",
        takedown: "Política de Suspensão, Remoção e Tratamento de Dados",
        lawEnforcement: "Política para Solicitações de Autoridades Policiais",
      },
      notIncluded: {
        title: "Condições comerciais não incluídas",
        body: "O Agent-Native não tem planos pagos nem contrato empresarial. Materiais comerciais como SLAs empresariais, termos de suporte, DPAs, adendos de segurança, termos de serviços profissionais e taxas não estão incluídos.",
      },
    },
    privacy: {
      eyebrow: "Política de Privacidade",
      title: "Agent-Native aplicativos hospedados",
      intro:
        "Esta política explica como Builder.io coleta, usa, compartilha e retém dados quando opera aplicativos hospedados Agent-Native, modelos hospedados, demonstrações e extensões oficiais de navegador.",
      scopeCards: {
        hosted: {
          title: "Aplicativos hospedados",
          body: "Coberto quando Builder.io opera o serviço Agent-Native ou modelo hospedado para você.",
        },
        openSource: {
          title: "Código aberto",
          body: "Não coberto para o uso do próprio código-fonte licenciado por MIT.",
        },
        selfHosted: {
          title: "Auto-hospedado",
          body: "Não coberto para bifurcações, personalizações ou implantações operadas por terceiros.",
        },
      },
      sections: {
        scope: "Escopo",
        information: "Informações que coletamos",
        cookies: "Cookies e analytics",
        clipsExtension: "Extensão Chrome do Agent-Native Clips",
        use: "Como usamos as informações",
        sharing: "Compartilhamento e terceiros",
        chromeLimitedUse: "Chrome Web Store uso limitado",
        retention: "Retenção e exclusão",
        security: "Segurança",
        changes: "Mudanças e contato",
      },
      paragraphs: {
        scope1:
          "Agent-Native é de código aberto e o código-fonte está disponível sob a licença MIT. Esta política se aplica apenas a aplicativos e serviços hospedados operados por Builder.io para usuários Agent-Native. Ele não se aplica ao uso do código por outra pessoa, incluindo bifurcações, modelos personalizados, implantações privadas ou versões auto-hospedadas. Se você operar sua própria implantação, será responsável por suas próprias práticas de dados e política de privacidade.",
        scope2Prefix:
          "Esta política destina-se a complementar a visão mais ampla de Builder.io",
        scope2Suffix:
          "para comportamento do aplicativo hospedado Agent-Native.",
        cookies:
          "O site de documentação e os aplicativos hospedados do Agent-Native podem usar cookies necessários para autenticação e segurança, armazenamento de preferências como idioma ou tema e tecnologias de analytics configuradas. O site de documentação pode carregar o Google Analytics ou o Google Tag Manager quando configurados pela implantação, e o serviço hospedado pode usar analytics próprios para medir a confiabilidade e o uso de recursos. Não usamos o conteúdo de aplicativos hospedados para publicidade de terceiros. Você pode controlar cookies nas configurações do navegador, embora desativar os cookies necessários possa impedir o login ou outros recursos.",
        clips1:
          "O Agent-Native Clips Chrome extension ajuda você a iniciar gravações baseadas no navegador e, quando ativado, anexar diagnósticos do navegador a um clipe. Ele pode coletar a fonte de captura selecionada, mídia de câmera e microfone que você escolhe incluir, o título e URL da guia ativa e o estado de autenticação necessário para conectar a extensão ao Clips hospedado.",
        clips2:
          "Os logs do desenvolvedor são opcionais. Quando ativada, a extensão pode coletar mensagens de console editadas, exceções JavaScript e metadados fetch/XHR, como método, URL, status, tempo e detalhes de falha da guia selecionada enquanto uma gravação está ativa. A extensão não foi projetada para coletar órgãos de solicitação, órgãos de resposta, cookies ou cabeçalhos de autorização.",
        clipsAnchor:
          "Para divulgações Chrome Web Store, use esta seção como âncora de extensão da política de privacidade:",
        sharing1:
          "Não vendemos dados de aplicativos hospedados em Agent-Native nem os usamos para publicidade de terceiros. Compartilhamos dados com provedores de serviços que ajudam a operar o serviço hospedado, como infraestrutura em nuvem, armazenamento, autenticação, e-mail, observabilidade, AI e provedores de transcrição, quando esses serviços são necessários para o recurso que você usa.",
        sharing2:
          "Quando você conecta uma integração, o aplicativo hospedado pode enviar ou receber dados desse provedor de acordo com sua configuração e os próprios termos do provedor. Também poderemos divulgar informações quando necessário para segurança, prevenção de abusos, conformidade legal ou para proteger os usuários e o serviço.",
        chromeLimitedUse:
          "Para Agent-Native Clips Chrome extension, nosso uso das informações recebidas de Chrome extension APIs segue a Política de Dados do Usuário de Chrome Web Store, incluindo os requisitos de Uso Limitado. A atividade do navegador coletada pela extensão é usada para fornecer o fluxo de trabalho de gravação e diagnóstico voltado para o usuário, e não para publicidade, revenda, avaliação de crédito ou criação de perfil não relacionado.",
        retention1:
          "Retemos dados de aplicativos hospedados pelo tempo necessário para fornecer o serviço, manter o histórico do espaço de trabalho, cumprir obrigações, resolver disputas ou melhorar a confiabilidade e a segurança. Os usuários podem excluir clipes, documentos, recursos e outros conteúdos de aplicativos hospedados por meio dos controles de aplicativos relevantes, quando disponíveis.",
        retention2:
          "O conteúdo excluído pode permanecer em backups, logs ou registros de auditoria por um período limitado antes de ser removido de acordo com cronogramas de retenção operacional.",
        security:
          "Usamos salvaguardas administrativas, técnicas e organizacionais razoáveis projetadas para proteger dados de aplicativos hospedados, incluindo controles de acesso, criptografia de transporte, monitoramento e práticas de segurança operacional. Nenhum serviço online pode garantir segurança perfeita, portanto os usuários devem evitar incluir segredos ou informações confidenciais em gravações ou prompts, a menos que pretendam compartilhar essas informações com o aplicativo hospedado.",
        changes1:
          "Poderemos atualizar esta política à medida que os aplicativos hospedados em Agent-Native mudarem. A data atualizada na parte superior da página mostra quando a política foi revisada pela última vez.",
        changes2Prefix:
          "Para solicitações ou dúvidas sobre privacidade, entre em contato com Builder.io através dos canais de suporte e privacidade listados no",
      },
      dataCategories: {
        account: {
          title: "Informações da conta e do espaço de trabalho",
          body: "Nome, endereço de e-mail, associação à organização, identificadores de autenticação e configurações do aplicativo usados para fazer login e manter os espaços de trabalho hospedados separados.",
        },
        hostedContent: {
          title: "Conteúdo do aplicativo hospedado",
          body: "Content você cria ou carrega modelos Agent-Native hospedados, como gravações, transcrições, documentos, comentários, tarefas, prompts, respostas do agente, arquivos e configuração.",
        },
        integrations: {
          title: "Dados de integração conectados",
          body: "Dados de serviços que você escolhe conectar, como calendário, Slack, e-mail, armazenamento ou ferramentas de desenvolvedor, limitados aos escopos e fluxos de trabalho mostrados no aplicativo hospedado.",
        },
        usage: {
          title: "Uso e dados técnicos",
          body: "Dispositivo, navegador, endereço IP, logs de diagnóstico, uso de páginas e recursos, erros e eventos de segurança usados para operar, proteger e melhorar serviços hospedados.",
        },
      },
      uses: {
        provide:
          "Forneça, sincronize e opere aplicativos Agent-Native hospedados e seus fluxos de trabalho de agentes.",
        transform:
          "Grave, transcreva, resuma, pesquise, compartilhe ou transforme conteúdo quando você solicitar que o aplicativo hospedado faça isso.",
        auth: "Autentique usuários, gerencie organizações, aplique controles de acesso e evite abusos.",
        support:
          "Depure incidentes, forneça suporte, meça a confiabilidade e melhore a experiência do produto hospedado.",
        comply: "Cumpra as obrigações legais, de segurança e de plataforma.",
      },
      links: {
        builderPrivacy: "Política de Privacidade",
        builderPrivacyFull: "Builder.io Política de Privacidade",
      },
    },
    about: {
      eyebrow: "Sobre o Agent-Native",
      title: "Apps de código aberto para agentes e pessoas",
      intro:
        "Agent-Native é um framework de código aberto para criar aplicações em que agentes de IA e interfaces compartilham as mesmas ações, dados e estado da aplicação.",
      sections: {
        project: {
          title: "Um modelo operacional compartilhado",
          body: "O Agent-Native trata o agente e a interface como parceiros iguais. Uma ação pode alimentar um controle de UI, uma ferramenta do agente, uma rota HTTP, uma capacidade MCP ou A2A, um comando de CLI e um fluxo auditável. O estado SQL compartilhado mantém a visão humana e a do agente alinhadas.",
        },
        openSource: {
          title: "Código aberto por padrão",
          body: "O código-fonte está disponível sob a licença MIT no repositório BuilderIO/agent-native. Desenvolvedores podem inspecioná-lo, executá-lo localmente, escolher seus provedores de banco e modelos e adaptá-lo ao produto. Os serviços hospedados são operados separadamente de forks e implantações próprias.",
        },
        hosted: {
          title: "Hospedado e autohospedado",
          body: "A Builder.io opera as aplicações hospedadas e a documentação do Agent-Native em agent-native.com. O framework também atende equipes que querem implantar e manter suas próprias aplicações. Os contratos de ações, limites de acesso, instruções de agentes e protocolos públicos podem ser revisados no código e na documentação.",
        },
        community: {
          title: "Construído em público",
          body: "O projeto é desenvolvido abertamente por meio de issues, pull requests, documentação e da comunidade Agent-Native. Leia a documentação para entender a arquitetura, consulte o código para verificar uma implementação ou participe da comunidade para discutir um caso de uso e contribuir.",
        },
      },
    },
    contact: {
      eyebrow: "Contato",
      title: "Entre em contato com a Builder.io sobre o Agent-Native",
      intro:
        "Use os canais de suporte, código e comunidade para fazer perguntas, relatar problemas, sugerir melhorias ou comunicar uma preocupação de segurança sobre o Agent-Native.",
      emailLabel: "Enviar e-mail para support@builder.io",
      sections: {
        support: {
          title: "Suporte do produto e do serviço hospedado",
          body: "Para dúvidas sobre uma aplicação hospedada, acesso à conta, um problema na documentação ou um comportamento que você não consegue resolver, escreva para support@builder.io. Inclua a URL pública, uma descrição reproduzível e identificadores relevantes. Não envie senhas, chaves de API, tokens bearer ou dados privados de clientes.",
        },
        source: {
          title: "Projeto de código aberto e comunidade",
          body: "Use o repositório no GitHub para bugs no código, propostas, pull requests e discussões de implementação. O Discord é útil para perguntas que se beneficiam da conversa com outros desenvolvedores. Pesquise primeiro as issues e a documentação para fornecer o contexto necessário aos mantenedores.",
        },
        security: {
          title: "Relatos de segurança",
          body: "Não divulgue uma vulnerabilidade sem correção em uma issue ou chat público. Entre em contato com a Builder.io pelo canal de segurança disponível e forneça apenas os detalhes necessários para reproduzir e avaliar o relato. Mantenha credenciais, dados privados e material de exploração fora do suporte comum.",
        },
        legal: {
          title: "Legal e privacidade",
          body: "Para dúvidas de privacidade, consulte a política de privacidade do Agent-Native e os recursos legais da Builder.io antes de falar com o suporte. A Builder.io, Inc. fica em 95 3rd Street, 2nd Floor, San Francisco, CA 94103, Estados Unidos. Os termos do serviço hospedado e as responsabilidades de autohospedagem estão nos Termos de Serviço.",
        },
      },
    },
    terms: {
      eyebrow: "Termos de Serviço",
      title: "Agent-Native aplicativos hospedados",
      intro:
        "Estes termos se aplicam quando Builder.io opera aplicativos hospedados Agent-Native, modelos hospedados, demonstrações e serviços hospedados oficiais para você.",
      scopeCards: {
        hosted: {
          title: "Aplicativos hospedados",
          body: "Coberto quando você usa um aplicativo ou modelo Agent-Native operado por Builder.io.",
        },
        openSource: {
          title: "Código aberto",
          body: "O código-fonte licenciado por MIT permanece disponível sob sua licença de código aberto.",
        },
        selfHosted: {
          title: "Auto-hospedado",
          body: "Implantações separadas operadas por você ou por outra pessoa não são serviços hospedados Builder.io.",
        },
      },
      sections: {
        scope: "Escopo e termos relacionados",
        hostedService: "Serviço hospedado",
        accounts: "Contas e espaços de trabalho",
        content: "Seu conteúdo e permissões",
        agents: "Agentes, saídas AI e integrações",
        acceptableUse: "Uso aceitável",
        openSource: "Código aberto e auto-hospedagem",
        suspension: "Suspensão e rescisão",
        disclaimers: "Isenções de responsabilidade e responsabilidade",
        changes: "Mudanças e contato",
      },
      paragraphs: {
        scope1:
          "Agent-Native é de código aberto e seu código-fonte está disponível sob a licença MIT. Estes termos se aplicam apenas a aplicativos e serviços hospedados operados por Builder.io para usuários Agent-Native. Eles não regem forks, modelos personalizados, implantações privadas ou versões auto-hospedadas operadas fora de Builder.io.",
        scope2Prefix:
          "Estes termos complementam a visão mais ampla de Builder.io",
        scope2Middle: "e o Agent-Native",
        scope2Suffix:
          "Se você usar um aplicativo Agent-Native hospedado em nome de uma empresa ou organização, você declara ter autoridade para aceitar estes termos para essa organização.",
        scope3:
          "O Agent-Native não tem planos pagos nem assinaturas de hospedagem pagas. Termos comerciais da Builder.io, como formulários de pedido, tarifas, suporte empresarial, níveis de serviço e aditivos de tratamento de dados, não fazem parte desta oferta, salvo se acordados separadamente por escrito.",
        hostedService:
          "Builder.io pode fornecer aplicativos Agent-Native hospedados, modelos, demonstrações, espaços de trabalho compartilhados, extensões de navegador e fluxos de trabalho de agentes relacionados. O serviço hospedado pode ser atualizado, limitado, suspenso ou descontinuado à medida que o produto evolui.",
        accounts1:
          "Você é responsável pela precisão das informações da conta, pelas atividades em sua conta e por manter as credenciais seguras. Os aplicativos Agent-Native hospedados podem incluir recursos de organização, convites, recursos compartilhados, integrações conectadas e controles de acesso específicos do aplicativo. Convide apenas usuários e conecte serviços que você está autorizado a usar.",
        accounts2:
          "Se você acredita que uma conta, espaço de trabalho, integração ou recurso compartilhado foi comprometido ou utilizado indevidamente, entre em contato com o suporte Builder.io imediatamente.",
        content1:
          "Você retém a propriedade do conteúdo que cria, carrega, grava, importa ou conecta a aplicativos Agent-Native hospedados. Você concede a Builder.io a permissão limitada necessária para hospedar, processar, transmitir, exibir, transformar, analisar e armazenar esse conteúdo para que o aplicativo hospedado e seus fluxos de trabalho de agente possam operar.",
        content2:
          "Você é responsável por ter os direitos e permissões necessários para conteúdo, gravações, prompts, arquivos, credenciais e dados de integração conectados que você fornece ao serviço.",
        agents1:
          "Aplicativos Agent-Native hospedados podem executar agentes, ferramentas, automações e integrações de provedores AI conforme sua solicitação. A saída gerada por AI pode ser incompleta, imprecisa ou inadequada para um uso específico. Revise resultados, ações, exportações e mensagens importantes antes de confiar neles.",
        agents2:
          "Quando você conecta serviços de terceiros, o uso desses serviços permanece sujeito aos seus próprios termos, limites, permissões e práticas de privacidade.",
        openSource:
          "Estes termos não alteram a licença de código aberto do código Agent-Native. Se você baixar, bifurcar, modificar ou auto-hospedar Agent-Native, a licença MIT e os termos que você definiu para sua própria implantação regerão esse uso. Você é responsável pela segurança, privacidade, conformidade, operações e suporte ao usuário para implantações que você opera.",
        suspensionPrefix:
          "Builder.io pode suspender ou restringir o acesso aos serviços hospedados Agent-Native quando necessário para proteger os usuários, cumprir a lei, prevenir abusos, lidar com riscos de segurança ou operar o serviço. Você pode parar de usar o serviço hospedado a qualquer momento. Alguns dados podem permanecer em backups, logs ou registros de auditoria por um período limitado, conforme descrito no",
        disclaimers1:
          "Os serviços hospedados Agent-Native são fornecidos no estado em que se encontram e conforme disponíveis, sujeitos à lei aplicável e a qualquer acordo escrito separado que você tenha com Builder.io. Builder.io não garante que aplicativos hospedados, integrações, automações ou saídas AI serão ininterruptos, livres de erros ou atenderão a todos os requisitos.",
        disclaimers2Prefix:
          "Na extensão máxima permitida por lei, a responsabilidade de Builder.io pelos serviços Agent-Native hospedados é limitada conforme descrito no documento mais amplo de Builder.io",
        disclaimers2Suffix:
          "ou outro acordo por escrito que se aplique ao seu uso.",
        changes1:
          "Podemos atualizar estes termos à medida que os aplicativos hospedados em Agent-Native mudam. A data atualizada no topo da página mostra quando os termos foram revisados ​​pela última vez.",
        changes2Prefix:
          "Para dúvidas sobre estes termos, entre em contato com Builder.io através dos canais de suporte listados em Builder.io",
      },
      hostedServicePoints: {
        create:
          "Crie e opere espaços de trabalho Agent-Native hospedados e aplicativos de modelo.",
        workflows:
          "Execute fluxos de trabalho, ações, automações e integrações de agentes que você escolher usar.",
        store:
          "Armazene o conteúdo do aplicativo hospedado, as configurações, os dados da organização e o estado da conta conectada necessários para fornecer o serviço.",
        improve:
          "Meça, proteja, depure e melhore os serviços Agent-Native hospedados.",
      },
      acceptableUse: {
        laws: "Não use aplicativos Agent-Native hospedados para violar leis, infringir direitos ou prejudicar pessoas ou sistemas.",
        bypass:
          "Não tente contornar controles de acesso, limites de taxas, limites de segurança ou isolamento de locatários.",
        malware:
          "Não carregue malware, material de roubo de credenciais ou conteúdo projetado para interromper o serviço.",
        spam: "Não use o serviço para enviar spam, raspar sem autorização ou abusar de provedores conectados.",
        sensitive:
          "Não coloque segredos ou dados confidenciais regulamentados em aplicativos hospedados, a menos que você esteja autorizado e o aplicativo seja apropriado para esse uso.",
      },
      links: {
        builderTerms: "Termos de Serviço",
        privacyPolicy: "Política de Privacidade",
      },
    },
  },
  nav: {
    overview: "Visão geral",
    coreArchitecture: "Arquitetura principal",
    dataAuthGovernance: "Dados, autenticação e governança",
    usingYourAgent: "Usar seu Agent",
    agentResources: "Recursos do Agente",
    integrations: "Integrações",
    advancedRuntime: "Avançado: estender o runtime",
    templatesSection: "Apps",
    gettingStarted: "Primeiros passos",
    gettingStartedActions: "Add an Action",
    gettingStartedPages: "Add a Page",
    whatIsAgentNative: "O que é Agent-Native?",
    agentSurfaces: "Superfícies do Agent",
    agentNativeConfig: "Agent-Native Config",
    keyConcepts: "Conceitos principais",
    agentNativeToolkit: "Toolkit",
    toolkitOverview: "Visão geral",
    toolkitUiPrimitives: "Primitivas de UI",
    customDesignSystem: "Sistemas de design personalizados",
    toolkitEditorsCanvases: "Editores e canvases",
    toolkitContextKnowledge: "Contexto e conhecimento",
    toolkitSharing: "Compartilhamento",
    toolkitCollaboration: "Colaboração",
    toolkitSettings: "Configurações",
    toolkitOrgTeam: "Organização e equipe",
    toolkitSetupConnections: "Configuração e conexões",
    toolkitCommandNavigation: "Comando e navegação",
    toolkitResources: "Recursos",
    toolkitAgentUx: "UX do agente",
    toolkitHistory: "Histórico",
    toolkitCommentsReview: "Comentários e revisão",
    toolkitObservability: "Observabilidade",
    featureKits: "Kits de recursos",
    appChrome: "Estrutura do app",
    capabilityPackages: "Pacotes de capacidade",
    capabilityPackagesOverview: "Visão geral",
    packageLifecycle: "Ciclo de vida de pacotes",
    versioningAndStability: "Versionamento e estabilidade",
    templatesOverview: "Modelos",
    pureAgentApps: "Apps focados em automação",
    faq: "FAQ",
    server: "Servidor",
    serverOverview: "Visão geral",
    serverMiddleware: "Middleware",
    serverPlugins: "Plugins",
    serverRoutes: "Rotas",
    client: "Cliente",
    clientOverview: "Visão geral",
    clientDataSync: "Dados e sincronização",
    clientAgentChat: "Chat do Agent",
    clientAdvanced: "Avançado",
    clientSyncInternals: "Sincronização interna",
    clientEntryPoints: "Pontos de entrada",
    routing: "Roteamento",
    actions: "Ações",
    actionsOverview: "Visão geral",
    actionsDefining: "Definindo ações",
    actionsAccessControl: "Acesso e Autorização",
    actionsRunContext: "Contexto de Execução",
    actionsOtherSurfaces: "Outras Superfícies",
    actionsAdvanced: "Avançado e legado",
    actionsAgentTools: "Acesso do Agente em Produção",
    publicAgentWeb: "Agent Web público",
    database: "Banco de dados",
    databaseProviders: "Provedores de banco de dados",
    databaseNeon: "Neon Postgres",
    databaseSupabase: "Supabase Postgres",
    databaseAwsRds: "Amazon RDS for PostgreSQL",
    databaseCloudSql: "Cloud SQL for PostgreSQL",
    databaseAzurePostgres: "Azure Database for PostgreSQL",
    databasePostgres: "Plain Postgres",
    internationalization: "Internacionalização",
    localFileMode: "Modo de arquivos locais",
    fileUploads: "Uploads de arquivos",
    deployment: "Deploy",
    deploymentOverview: "Visão geral",
    deploymentProviders: "Provedores de hospedagem",
    deploymentProduction: "Produção e avançado",
    deployAnApp: "Fazer deploy de um app",
    workspaceDeployment: "Deploy do Workspace",
    localProviderBuilds: "Reproduzir o Build do Provedor Localmente",
    deploymentNodeDocker: "Node.js",
    deploymentDocker: "Docker",
    deploymentVercel: "Vercel",
    deploymentNetlify: "Netlify",
    deploymentCloudflare: "Cloudflare",
    deploymentAwsLambda: "AWS Lambda",
    deploymentDenoDeploy: "Deno Deploy",
    deploymentAzureStaticWebApps: "Azure Static Web Apps",
    deploymentKoyeb: "Koyeb",
    deploymentRender: "Render",
    deploymentOtherPlatforms: "Outras Plataformas",
    ssrCaching: "Cache de SSR",
    deploymentEnvironmentVariables: "Deploy: Variáveis de Ambiente",
    updatingUiInProduction: "Atualizando a UI em Produção",
    environmentVariables: "Variáveis de ambiente",
    progress: "Progresso",
    authentication: "Autenticação",
    multiTenancy: "Multilocação",
    organizationsTeamsPermissions: "Organizações, equipes e permissões",
    administeredDeployments: "Implantações administradas",
    securityDataScoping: "Segurança e escopo de dados",
    sharingPrivacy: "Compartilhamento e privacidade",
    trackingAnalytics: "Tracking e analytics",
    auditLog: "Log de auditoria",
    doctorCodeChecks: "Doctor (verificações de código)",
    observability: "Observabilidade",
    observationalMemory: "Memória observacional",
    ciEvalGate: "Gate de evals no CI",
    usingYourAgentOverview: "Visão geral",
    contextAwareness: "Consciência de contexto",
    agentMentions: "Menções ao Agent",
    voiceInput: "Entrada por voz",
    dropInAgent: "Agent drop-in",
    componentApi: "API de componentes",
    nativeChatUi: "UI de chat nativa",
    agentkit: "AgentKit",
    generativeUi: "UI generativa",
    realTimeCollaboration: "Colaboração em tempo real",
    agentResourcesOverview: "Visão geral dos recursos do agente",
    skills: "Habilidades",
    customAgentsTeams: "Agents e equipes personalizados",
    workspaceGovernance: "Governança do workspace",
    recurringJobs: "Jobs recorrentes",
    automations: "Automações",
    extensions: "Extensões",
    dataPrograms: "Programas de dados",
    multiAppWorkspaces: "Workspaces multi-app",
    onboardingApiKeys: "Onboarding e chaves API",
    messaging: "Mensagens (Slack, Email...)",
    messagingRecipes: "Receitas de mensagens",
    messagingInternals: "Internos de mensagens",
    dispatch: "Dispatch",
    portal: "Portal",
    a2aProtocol: "Protocolo A2A",
    mcpClients: "Clientes MCP (adicionar ferramentas)",
    httpApi: "API HTTP (chamar ações)",
    mcpServer: "Servidor MCP (expor seu app)",
    externalAgents: "Agents externos (conectar host)",
    externalAgentsCatalog: "Catálogo de agents externos",
    mcpApps: "MCP Apps (UIs inline)",
    webMcp: "WebMCP (ferramentas do navegador)",
    crossAppSso: "SSO entre apps",
    notifications: "Notificações",
    automationConnectors: "Conectores de fluxo de trabalho",
    workspaceConnections: "Conexões do workspace",
    creatingTemplates: "Criar templates",
    syncingTemplateChanges: "Sincronizar alterações de templates",
    writingAgentInstructions: "Escrever instruções de Agent",
    embeddingSdk: "SDK de incorporação",
    agentNativeCodeUi: "UI de código Agent-Native",
    harnessAgents: "Agentes com harness",
    adapters: "Adaptadores",
    cliAdapters: "Adaptadores CLI",
    processors: "Processadores in-loop",
    durableResume: "Retomada durável",
    durableBackgroundRuns: "Execuções em segundo plano duráveis",
    blueprintInstaller: "Instalador Blueprint",
    chat: "Chat",
    chatOverview: "Visão geral",
    chatFirstEdits: "Seu primeiro recurso",
    chatDevelopers: "Guia do desenvolvedor",
    calendar: "Calendário",
    calendarOverview: "Visão geral",
    calendarAgent: "Conversar com o Agent",
    calendarFeatures: "Funcionalidades",
    calendarIntegrations: "Uso entre apps",
    calendarDevelopers: "Guia do desenvolvedor",
    content: "Conteúdo",
    contentOverview: "Visão geral",
    contentEditing: "Escrever e organizar",
    contentDatabases: "Coleções e formulários",
    contentSync: "Arquivos locais e sincronização",
    contentDevelopers: "Guia do desenvolvedor",
    plans: "Plans",
    visualPlans: "Planos visuais",
    planReviewWorkflow: "Revisão e comentários",
    planAutomations: "Eventos e automações",
    planLocalAndDesktop: "Arquivos locais e desktop",
    planDevelopers: "Guia do desenvolvedor",
    prVisualRecap: "Recap visual de PR",
    planPluginMarketplace: "Plugin Plan e marketplace",
    slides: "Slides",
    slidesOverview: "Visão geral",
    slidesFeatures: "Funcionalidades",
    slidesAgent: "Conversar com o Agent",
    slidesIntegrations: "Uso entre apps",
    slidesDevelopers: "Guia do desenvolvedor",
    analytics: "Analises",
    analyticsOverview: "Visão geral",
    analyticsDashboards: "Painéis e análises",
    analyticsConnectors: "Conectar fontes de dados",
    analyticsMonitoringAndSessions: "Monitoramento e gravações de sessão",
    analyticsDevelopers: "Guia do desenvolvedor",
    mail: "E-mail",
    mailOverview: "Visão geral",
    mailAgent: "Conversar com o Agent",
    mailInbox: "Caixa de entrada e automações",
    mailDraftsAndQueue: "Rascunhos e agendamento",
    mailDevelopers: "Guia do desenvolvedor",
    clips: "Clips",
    clipsOverview: "Visão geral",
    clipsFeatures: "Funcionalidades",
    clipsAgent: "Conversar com o Agent",
    clipsIntegrations: "Uso entre apps",
    clipsDevelopers: "Guia do desenvolvedor",
    clipsEmbed: "Inserir o Clips",
    assets: "Assets",
    assetsOverview: "Visão geral",
    assetsGeneration: "Gerar e refinar",
    assetsPresets: "Predefinições",
    assetsIntegrations: "Uso entre apps",
    assetsDevelopers: "Guia do desenvolvedor",
    design: "Design",
    designOverview: "Visão geral",
    designFeatures: "Funcionalidades",
    designAgent: "Conversar com o Agent",
    designIntegrations: "Uso entre apps",
    designDevelopers: "Guia do desenvolvedor",
    dispatchOverview: "Visão geral",
    dispatchFeatures: "Funcionalidades",
    dispatchAgent: "Conversar com o Agent",
    dispatchIntegrations: "Uso entre apps",
    dispatchDevelopers: "Guia do desenvolvedor",
    dispatchReference: "Referência de ações e dados",
    forms: "Formularios",
    formsOverview: "Visão geral",
    formsFeatures: "Funcionalidades",
    formsAgent: "Conversar com o Agent",
    formsIntegrations: "Uso entre apps",
    docsComponents: "Docs Components",
    formsDevelopers: "Guia do desenvolvedor",
  },
} satisfies typeof enUS;

export default ptBR;
