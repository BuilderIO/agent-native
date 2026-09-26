import enUS from "./en-US";

const esES = {
  agentChat: {
    setup: {
      checkingProvider: "Comprobando la conexión de IA…",
      providerStatusUnavailable: "No se pudo comprobar la conexión de IA.",
    },
    common: { retry: "Reintentar" },
  },
  language: {
    label: "Idioma",
    system: "Sistema",
    systemDescription: "Usar el idioma del navegador",
    suggestionTitle: "¿Leer esta página en {{language}}?",
    suggestionDescription: "El idioma de tu navegador es {{language}}.",
    suggestionSwitch: "Cambiar a {{language}}",
    suggestionKeepEnglish: "Mantener inglés",
  },
  header: {
    docs: "Documentos",
    templates: "Apps",
    skills: "Habilidades",
    searchAria: "Buscar en la documentación",
    searchPlaceholder: "Buscar docs...",
    askAssistant: "Preguntar a la IA",
    toggleNavigation: "Abrir o cerrar navegación",
    copyLogoSvg: "Copiar SVG del logotipo",
    copyWordmark: "Copiar logotipo textual",
    brandAssets: "Recursos de marca",
    tryNow: "Probar ahora",
  },
  footer: {
    download: "Descargar",
    pricing: "Precios",
    brand: "Marca",
    privacy: "Privacidad",
    terms: "Términos",
  },
  feedback: {
    label: "Comentarios",
    placeholder: "Cuéntanos qué mejoraría esta documentación.",
  },
  demoVideo: {
    visualPlanningAria: "Demo de planificación visual de Agent-Native",
  },
  docBlocks: {
    blockLabel: "Bloque {{alias}}",
    unknownBlockType: "tipo de bloque desconocido",
  },
  theme: {
    light: "claro",
    dark: "oscuro",
    toggle: "Cambiar tema",
    label: "Tema: {{theme}}",
  },
  docs: {
    navigateAria: "Navegar por docs",
    onThisPage: "En esta página",
    copyMarkdown: "Copiar doc como Markdown",
    copiedMarkdown: "Markdown copiado",
    copyMarkdownError: "No se pudo copiar Markdown",
    previous: "Anterior",
    next: "Siguiente",
    draftLabel: "Borrador",
    draftDescription:
      "Esta página está en construcción. El contenido puede estar incompleto o sujeto a cambios antes de su publicación.",
    translationLabel: "Traducción automática",
    translationDescription:
      "Esta página se tradujo automáticamente y puede no ser del todo precisa.",
    translationViewOriginal: "Ver el original en inglés",
  },
  search: {
    dialogLabel: "Buscar documentación",
    placeholder: "Buscar documentación...",
    empty: "Escribe para buscar en toda la documentación",
    toggleChatSidebar: "Alternar barra lateral del chat",
    loadError: "No se pudo cargar la búsqueda. Inténtalo de nuevo.",
    retry: "Intentar de nuevo",
    noResults: 'No se encontraron resultados para "{{query}}"',
    browseAllDocs: "Ver toda la documentación",
    navigate: "navegar",
    open: "abrir",
    close: "cerrar",
  },
  agent: {
    emptyState: "Pregúntame cualquier cosa sobre Agent-Native",
    suggestionGettingStarted: "¿Cómo empiezo con Agent-Native?",
    suggestionActions: "¿Cómo funcionan las actions?",
    suggestionPolling: "Explícame el modelo de sincronización por polling",
    suggestionDeploy: "¿Cómo despliego a producción?",
  },
  errors: {
    loadingLatest: "Cargando la versión más reciente...",
    notFoundTitle: "Página no encontrada",
    notFoundBody: "La página que buscas no existe o se movió.",
    goHome: "Ir al inicio",
    readDocs: "Leer la documentación",
    genericTitle: "Algo salió mal",
    genericBody: "Ocurrió un error inesperado.",
    sendFeedback: "Enviar comentarios",
    feedbackPlaceholder:
      "Describe qué pasó antes de que apareciera este error de Docs.",
    openGitHubIssue: "Abrir issue en GitHub",
  },
  home: {
    hero: {
      titleLine1: "El framework para",
      titleAccent: "apps agentic",
      body: "No elijas entre apps o agentes. Las apps Agent-Native son ambas cosas.",
      primaryCta: "Probar una app",
      secondaryCta: "Leer la documentación",
    },
    code: {
      quickStartComment: "Crea una app con un comando",
      skillInstallComment:
        "Añade planificación Agent-Native a un coding agent que ya uses",
      frameworkComment:
        "Un action impulsa el agent, la UI, HTTP, MCP, A2A y CLI.",
      frameworkDescription: "Di hola desde el app-agent loop local.",
    },
    actionSurface: {
      eyebrow: "Profundamente agentic, no solo IA pegada",
      title: "Una acción te da toda la superficie",
      body: "Define una operación una vez. Agent-Native la convierte en acción de UI, herramienta del agent, endpoint HTTP, superficie MCP/A2A, comando CLI, permiso acotado y registro de auditoría.",
      buildAction: "Crear una acción",
      benefits: {
        oneActionDefinition: {
          title: "Una sola definición de acción",
          body: "UI, agent, HTTP, MCP, A2A y CLI llaman la misma operación.",
        },
        scopedByDefault: {
          title: "Con alcance por defecto",
          body: "Auth, sharing, governance y audit logs acompañan al trabajo.",
        },
        headedOrHeadless: {
          title: "Apps, automatizaciones y agents",
          body: "Ejecuta la misma operación desde chat, UI, tareas programadas, colas, agents externos o scripts.",
        },
        contextRichInput: {
          title: "Entrada rica en contexto",
          body: "Chat, voz, skills, instrucciones y estado de UI siguen en el circuito.",
        },
        openAgentProtocols: {
          title: "Protocolos abiertos de agent",
          body: "A2A, MCP, MCP apps y agents externos son primitivas del framework.",
        },
        observableByDesign: {
          title: "Observable por diseño",
          body: "Trazas, evals, feedback e historial de auditoría hacen inspeccionable el trabajo del agent.",
        },
      },
    },
    modules: {
      pageEyebrow: "Framework modular",
      title: "Módulos integrados para apps agentic",
      body: "Piezas verificadas por humanos para las partes de producción que los agents no deberían inventar desde cero. Úsalas tal cual, inspecciona el código o reemplaza el módulo cuando tu app necesite algo distinto.",
      pageBody:
        "Agent-Native incluye piezas verificadas por humanos para el trabajo de producción que los agents no deberían improvisar desde cero. Úsalas tal cual, revisa el código o reemplaza el módulo cuando tu producto necesite algo distinto.",
      viewAll: "Ver todos los módulos",
      browseApps: "Explorar apps creadas con módulos",
      items: {
        autoStateSyncing: {
          title: "Sincronización automática de estado",
          body: "Los cambios del agent actualizan la UI, y el estado de la UI sigue visible para el agent sin otro puente.",
        },
        actions: {
          title: "Acciones",
          body: "Define el trabajo una vez y úsalo desde UI, agent, HTTP, MCP, A2A y CLI.",
        },
        sqlStateOrm: {
          title: "Estado de PostgreSQL y ORM",
          body: "Datos duraderos de app, estado de aplicación, migraciones y esquemas de PostgreSQL/PGlite.",
        },
        dbAdmin: {
          title: "Admin de base de datos",
          body: "Esquemas legibles para agents, superficies de consulta, migraciones y herramientas admin sin un back office propio.",
        },
        authGovernance: {
          title: "Auth y gobernanza",
          body: "Login, organizaciones, multi-tenancy, permisos, aprobaciones y hooks de política.",
        },
        sharing: {
          title: "Compartir",
          body: "Enlaces compartidos, acceso acotado, recursos públicos o privados, comentarios y superficies de revisión.",
        },
        realtimeCollaboration: {
          title: "Colaboración en tiempo real",
          body: "Edición multiusuario, presencia en vivo, UI optimista y reconciliación respaldada por servidor.",
        },
        agentInteroperability: {
          title: "Interoperabilidad de agents",
          body: "A2A, MCP, MCP apps, agents externos, harness agents y handoffs entre apps.",
        },
        automationsQueues: {
          title: "Automatizaciones y colas",
          body: "Trabajo por eventos, tareas programadas, background runs y mutaciones fiables.",
        },
        agentUiSurface: {
          title: "Superficie de UI del agent",
          body: "Chat, skills, instrucciones, UI generativa, entrada de voz y contexto visible para el agent.",
        },
        observability: {
          title: "Observabilidad",
          body: "Trazas, evals, feedback, experimentos y prueba de lo que los agents afirmaron hacer.",
        },
        workspaces: {
          title: "Workspaces",
          body: "Apps agentic componibles que se descubren entre sí y coordinan por A2A.",
        },
        sourceOwnership: {
          title: "Propiedad del código fuente",
          body: "Docs y código viven donde los agents pueden inspeccionarlos, poseerlos, expulsarlos, parchearlos o reemplazarlos.",
        },
        auditLogs: {
          title: "Registros de auditoría",
          body: "Un registro duradero de cambios humanos y de agents, limitado a los recursos que los usuarios pueden acceder.",
        },
      },
    },
    framework: {
      title: "El framework para apps agent-native",
      body1:
        "Agent-Native es un framework open source para crear agentic applications: empieza con Chat, define actions compartidas y luego añade UI, jobs y colaboración alrededor del mismo estado.",
      body2:
        "Usa PGlite local o PostgreSQL alojado, tu proveedor de hosting, stack de modelos y código de app.",
      cta: "Leer la guía del framework",
      primitives: {
        actions: {
          title: "Acciones",
          description:
            "Define el trabajo una vez. Úsalo desde agent, UI, API, MCP y A2A.",
        },
        sharedState: {
          title: "Estado compartido",
          description:
            "El estado de app respaldado por SQL mantiene sincronizados a personas, agents y sesiones.",
        },
        agentRuntime: {
          title: "Runtime de agent",
          description:
            "El app-agent loop, las tools, skills, memory, jobs y observabilidad se entregan juntos.",
        },
        postgresSpecific: {
          title: "Específico de PostgreSQL",
          description:
            "Usa los asistentes de esquema de PostgreSQL del marco con PGlite local o Postgres alojado en cualquier host compatible con Nitro.",
        },
      },
    },
    templates: {
      title: "Prueba una app Agent-Native",
      eyebrow:
        "Empieza con una app funcional y deja que el agente la evolucione.",
      cta: "Ver apps",
    },
    skills: {
      title: "Pruébalo con un skill",
      body: "Añade planificación visual y PR recaps a Claude Code, Codex, Cursor, Pi, OpenCode o VS Code con un solo comando.",
      planBody:
        "Planes revisables con diagramas, wireframes, mapas de archivos y comentarios antes de cambiar código.",
      recapBody:
        "Un resumen visual de un PR o diff para que los reviewers vean la forma antes de las líneas crudas.",
      cta: "Explorar la guía de Skills",
    },
    connected: {
      title: "Agents y UI, completamente conectados",
      body: "El agent y la UI son ciudadanos iguales del mismo sistema. Cada action funciona en ambas direcciones: haz clic o pídelo.",
      tabs: {
        agentSees: {
          title: "El agent lo ve todo",
          description:
            "Puede leer y actualizar cualquier UI, cualquier dato y cualquier estado de la aplicación.",
        },
        uiTalks: {
          title: "La UI habla con el agent",
          description:
            "Botones, formularios y workflows envían contenido estructurado al agent, creando flujos guiados que pasan por el agent, incluidos skills, rules e instructions.",
        },
        agentUpdates: {
          title: "El agent actualiza su propio código",
          description:
            "Puede modificar la app para cambiar features y funcionalidad. Tus tools mejoran con el tiempo.",
        },
        everything: {
          title: "Todo funciona en ambas direcciones",
          description:
            "Cada action disponible en la UI también está disponible para el agent. Puedes hacer clic para hacer algo o pedirle al agent que lo haga.",
        },
      },
    },
    comparison: {
      titleLine1: "No elijas entre apps o agents.",
      titleAccent: "Las apps agent-native son ambas.",
      columns: {
        saas: "Herramientas SaaS",
        agents: "AI Agents crudos",
        internal: "Herramientas internas",
        native: "App Agent-Native",
      },
      rows: {
        ui: "UI",
        ai: "AI",
        customization: "Personalización",
        ownership: "Propiedad",
      },
      cells: {
        polishedButRigid: "Pulidas pero rígidas",
        none: "Ninguna",
        mixedQuality: "Calidad irregular",
        fullUi: "UI completa, personaliza y listo",
        boltedOn: "Añadida encima",
        powerful: "Potente",
        shallowlyConnected: "Conexión superficial",
        agentFirst: "Agent-first, integrada",
        cant: "No se puede",
        instructionsAndSkills: "Instructions y skills",
        fullHighMaintenance: "Completa, pero de alto mantenimiento",
        agentModifies: "El Agent modifica la app",
        rented: "Alquilada",
        somewhatYours: "Algo tuya",
        youOwnCode: "El código es tuyo",
      },
    },
    quickStart: {
      title: "Empieza con un comando",
      body: "Un comando crea una app local chat-first respaldada por actions, durable threads y PGlite. Usa `--headless` solo para workflows automation-first sin UI de navegador todavía.",
    },
    finalCta: {
      title: "Software construido para la era agentic",
      body: "Empieza con un comando o un durable action, pásalo por el app-agent loop y luego hazlo crecer hasta UI, jobs y colaboración sin reescribir la operación. Open source. Cloneable SaaS. Tuyo.",
      primaryCta: "Probar una app",
      secondaryCta: "Leer la documentación",
      githubCta: "Ver en GitHub",
    },
    batteries: {
      titleLine1: "Todo incluido,",
      titleLine2: "probado en batalla",
      body: "En lugar de partir de un prompt en blanco y código improvisado, Agent-Native ofrece a los agentes piezas probadas y buenas prácticas para crear software real.",
      browseToolkits: "Explorar toolkits",
    },
    featureCloud: {
      notifications: "Notificaciones",
      recurringJobs: "Tareas recurrentes",
      actions: "Acciones",
      agentTeams: "Equipos de agentes",
      monorepos: "Monorrepos",
      permissions: "Permisos",
      rbac: "RBAC",
      organizations: "Organizaciones",
      workspaceSecrets: "Secretos del workspace",
      docsSearch: "Búsqueda en docs",
      sourceSearch: "Búsqueda en código",
      contextAwareness: "Conciencia de contexto",
      observability: "Observabilidad",
      realtimeSync: "Sincronización en tiempo real",
      sqlState: "Estado SQL",
      multiTenancy: "multiinquilino",
      dataLoaders: "Cargadores de datos",
      liveQueries: "Consultas en vivo",
      agentInstructions: "Instrucciones del agente",
      providerGrants: "Subvenciones de proveedores",
      comments: "Comentarios",
      reviewLinks: "Enlaces de revisión",
      privacyControls: "Controles de privacidad",
      skills: "Habilidades",
      security: "Seguridad",
      auditLogs: "Registros de auditoría",
      workspaces: "Espacios de trabajo",
      voiceInput: "Entrada de voz",
      mcpApps: "MCP aplicaciones",
      generativeUi: "Interfaz generativa",
      toolCalls: "Llamadas a herramientas",
      agentSidebar: "Barra lateral del agente",
      sharedActions: "Acciones compartidas",
      uiSurfaces: "UI superficies",
      i18n: "i18n",
      mcpAuth: "MCP Autenticación",
      battleTestedComponents: "Bloques probados",
      mcpA2a: "MCP + A2A",
      externalAgents: "Agentes externos",
      a2aHandoffs: "A2A traspasos",
      humanHandoff: "Traspaso humano",
      agentContext: "Contexto del agente",
      durableResume: "currículum duradero",
      extensions: "Extensiones",
      sharingPrivacy: "Compartir y privacidad",
      realTimeCollaboration: "Colaboración en tiempo real",
      sso: "SSO",
      oauth: "OAuth",
      mcpServers: "MCP servidores",
      scopedAccess: "Acceso con alcance",
      dbAdapters: "adaptadores de bases de datos",
      auth: "autenticación",
      approvals: "Aprobaciones",
      automations: "Automatizaciones",
      governance: "Gobernanza",
      jobs: "Empleos",
      agUi: "AG-UI",
      dispatch: "Dispatch",
      backgroundRuns: "Ejecuciones en segundo plano",
      rateLimits: "Límites de tarifas",
      queues: "Colas",
      cronSchedules: "Horarios cron",
      analytics: "Analitica",
      experiments: "experimentos",
      feedbackLoops: "Bucles de retroalimentación",
      fileUploads: "Cargas de archivos",
      evals: "evaluaciones",
      templates: "Apps",
      providerApis: "Proveedor APIs",
      agentWebSurfaces: "Superficies web de agentes",
      templateSkills: "Habilidades de app",
      oneClickForks: "Creación de apps con un clic",
      localFileMode: "Modo de archivo local",
      memory: "Memoria",
      webhooks: "Ganchos web",
      http: "HTTP",
      selfEditingCode: "Código de autoedición",
      cli: "CLI",
      crossAppSso: "Aplicación cruzada SSO",
      schemaMigrations: "Migraciones de esquemas",
      hostedDeploys: "Implementaciones alojadas",
      environmentSetup: "Configuración del entorno",
      oauthCallbacks: "OAuth devoluciones de llamada",
      exports: "Exportaciones",
      dashboards: "Paneles de control",
    },
  },
  common: {
    copied: "copiado",
    copyFailed: "No se pudo copiar",
    copyCommand: "comando copiar",
    copyCode: "Copiar código",
    tryIt: "Probar",
    customizeIt: "Personalizar",
    editOnline: "Editar en línea",
    runLocally: "Ejecutar localmente",
    viewDocs: "Ver docs",
    source: "Fuente",
    readDocs: "Lea los documentos",
    signIn: "Iniciar sesión",
    tryTemplateFree: "Prueba {{name}} gratis",
    designForFree: "Diseña gratis",
    recordForFree: "Graba gratis",
    getStarted: "Comenzar",
    freeAndOpenSource: "100 % gratis • código abierto",
    viewAllApps: "Ver todas las aplicaciones",
  },
  homepage: {
    hero: {
      title: "El framework de aplicaciones agentic",
      bodyLine1: "Crea agentes autónomos con interfaces intuitivas.",
      bodyLine2: "Usa tu propio LLM. Despliega donde quieras.",
      tryAnApp: "Probar una app",
    },
    install: {
      copyCommand: "Copiar comando de instalación",
    },
    actions: {
      title: "Una acción impulsa cada superficie",
      bodyLine1: "Define una capacidad una vez con defineAction().",
      bodyLine2:
        "Tu agente, UI de React, clientes HTTP e integraciones usan el mismo código.",
      diagramAlt:
        "Una acción impulsa la UI, MCP, el chat del agente, A2A, HTTP API y CLI",
    },
    builtIn: {
      title: "Todo lo que necesita tu agente",
      body: "UI, contexto, datos, permisos e infraestructura, ya conectados entre sí.",
      pillars: {
        reactUi: {
          title: "UI en React",
          body: "Dale a los usuarios pantallas familiares para explorar, editar y revisar el trabajo.",
        },
        agentChat: {
          title: "Chat de agente integrado",
          body: "Deja que los usuarios deleguen trabajo, hagan preguntas y revisen resultados en la misma UI.",
        },
        sharedState: {
          title: "Estado de aplicación compartido",
          body: "El agente sabe qué están viendo, seleccionando y editando los usuarios.",
        },
        sharedSql: {
          title: "Datos compartidos de PostgreSQL",
          body: "Usuarios y agentes leen y actualizan la misma fuente de verdad.",
        },
        skillsMemory: {
          title: "Habilidades y memoria",
          body: "Dale a los agentes experiencia reutilizable y contexto persistente.",
        },
        automations: {
          title: "Automatizaciones",
          body: "Ejecuta trabajo del agente automáticamente según horarios o eventos.",
        },
        agentTeams: {
          title: "Equipos de agentes",
          body: "Delega trabajo a agentes especializados en el mismo espacio de trabajo o entre agentes conectados.",
        },
        auth: {
          title: "Autenticación y organizaciones",
          body: "El inicio de sesión, las cuentas de usuario y la membresía de organización están integrados.",
        },
        sharing: {
          title: "Compartir y permisos",
          body: "Controla quién puede ver, comentar, editar o gestionar cada recurso.",
        },
      },
    },
    stack: {
      title: "Usa tu propio stack",
      body: "Agent-Native es TypeScript de código abierto. Elige tu modelo, base de datos y hosting, y conserva el código de la aplicación en tu repositorio.",
      exploreApps: "Explora apps creadas con Agent-Native",
    },
    showcase: {
      title: "Apps reales creadas con Agent-Native",
      body: "Apps Agent-Native de código abierto que puedes usar gratis o personalizar sin límites.",
      browseApps: "Explorar apps",
      scrollLeft: "Desplazar apps a la izquierda",
      scrollRight: "Desplazar apps a la derecha",
    },
    bottomCta: {
      title: "Crea tu primer agente con una UI",
      body: "El agente y la UI comparten las mismas capacidades. Usa tu propio LLM y despliega donde quieras.",
    },
    footer: {
      tagline: "El framework de aplicaciones agentic.",
      framework: "Framework",
      ecosystem: "Ecosistema",
      community: "Comunidad",
      legal: "Legal",
      docs: "Documentación",
      download: "Descargar",
      apps: "Apps",
      privacyPolicy: "Política de privacidad",
      saasTerms: "Términos de SaaS",
      legalResources: "Recursos legales",
    },
  },
  gettingStarted: {
    tabs: {
      label: "Elige cómo crear",
      local: "Crear localmente",
      localDescription: "Usa la CLI para crear en tu equipo.",
      cloud: "Crear en la nube",
      cloudDescription: "Crea en el navegador con Builder.io.",
    },
    cloud: {
      intro:
        "Crea las mismas aplicaciones sin instalar nada. Describe lo que quieres y el agente escribe y ejecuta el código en un espacio de trabajo alojado por Builder.",
      stepOneTitle: "Crea una cuenta de Builder",
      stepOneBody:
        "Usa tu cuenta de Builder para crear en el navegador. Empieza gratis y sin aportar claves de API.",
      stepTwoTitle: "Escribe tu prompt",
      stepTwoBody:
        "Describe en lenguaje sencillo lo que quieres crear y el agente lo hará por ti.",
      stepThreeTitle: "Publica",
      stepThreeBody:
        "Cuando estés listo, publica tu agente y su UI con un clic en Builder.",
    },
  },
  templatesPage: {
    title: "Aplicaciones nativas del agente de código abierto de su propiedad",
    eyebrow:
      "Empieza con una app funcional y deja que el agente la evolucione.",
    body: "Puedes personalizarlo todo.",
    firstPartyTitle: "Creado por Agent-Native",
    community:
      "¿Prefieres una app en blanco? Empieza desde cero con la guía del framework.",
    createYourOwn: "Empezar desde cero",
    communityTitle: "Aplicaciones de la comunidad",
    communityDescription:
      "Descubre aplicaciones mantenidas por sus autores. Prueba una versión alojada cuando esté disponible o revisa el código fuente y personalízala.",
    submitCommunityTemplate: "Enviar una aplicación",
    communityEmpty:
      "El catálogo de la comunidad está abierto. Publica una aplicación Agent-Native enfocada y envíala al catálogo.",
    publishGuide: "Leer la guía de publicación",
    communityTrust:
      "Las aplicaciones de la comunidad son código de terceros. Revisa el código fuente, la licencia, las dependencias y los scripts de instalación antes de ejecutarlas.",
    copyCommunityInstallCommand: "Copiar comando de instalación",
    viewRepository: "Ver repositorio",
    tryCommunityDemo: "Probar demo",
    customizeDescription: "Usa esta app como punto de partida.",
    customizeOnline: "En línea",
    customizeOnlineBadge: "Unirse a la lista de espera",
    customizeLocally: "Local",
    communityNew: "Nueva",
    communityComingSoon: "Próximamente",
    communityGithubStars: "{{count}} estrellas en GitHub",
    tryCommunityApp: "Probar aplicación",
    viewCommunitySource: "Ver código fuente",
    communityEyebrow: "Aplicación de la comunidad",
    communityScreenshots: "Capturas de pantalla",
    previousScreenshot: "Captura anterior",
    nextScreenshot: "Siguiente captura",
    communityNoScreenshots:
      "Las capturas aparecerán aquí después de la revisión.",
    communityScreenshotAlt: "Captura de {{name}} {{index}}",
    communityNoHostedVersion:
      "La versión alojada estará disponible pronto. Sigue el desarrollo desde el código fuente.",
    communitySubmissionTitle: "Comparte una aplicación de la comunidad",
    communitySubmissionDescription:
      "Cuéntanos dónde encontrar tu aplicación y qué hace. Revisaremos los datos antes de publicar la ficha.",
    communitySubmissionName: "Nombre de la aplicación",
    communitySubmissionNamePlaceholder: "Centro de atención al cliente",
    communitySubmissionUrl: "URL de la aplicación",
    communitySubmissionUrlPlaceholder: "example.com",
    communitySubmissionDescriptionLabel: "Descripción",
    communitySubmissionDescriptionPlaceholder:
      "¿Qué hace la aplicación y para quién es?",
    communitySubmissionRepository: "Repositorio de GitHub (opcional)",
    communitySubmissionRepositoryPlaceholder: "github.com/owner/repository",
    communitySubmissionScreenshots: "Capturas (opcional)",
    communitySubmissionScreenshotsPlaceholder: "Arrastra hasta 5 imágenes aquí",
    communitySubmissionScreenshotDropHint:
      "PNG, JPG o WebP. Máximo 1,5 MB cada una.",
    communitySubmissionScreenshotSlot: "Captura {{index}}",
    communitySubmissionScreenshotsAdd: "Añadir capturas",
    communitySubmissionScreenshotsCount: "{{count}} / 5 seleccionadas",
    communitySubmissionScreenshotRemove: "Eliminar captura {{index}}",
    communitySubmissionSubmit: "Enviar aplicación",
    communitySubmissionReady:
      "Gracias. Revisaremos tu aplicación antes de publicarla.",
    communitySubmissionNameError: "Introduce un nombre para la aplicación.",
    communitySubmissionDescriptionError: "Añade una descripción breve.",
    communitySubmissionUrlError:
      "Introduce un enlace válido, como example.com.",
    communitySubmissionRepositoryError:
      "Introduce un enlace a un repositorio de GitHub.",
    communitySubmissionScreenshotsError:
      "Usa imágenes PNG, JPG o WebP de hasta 1,5 MB cada una, con un máximo de 5 imágenes.",
    communitySubmissionSubmitError:
      "No se pudo enviar ahora. Revisa los campos marcados e inténtalo de nuevo.",
    communitySubmissionSubmitting: "Enviando…",
  },
  buildFromScratch: {
    title: "Crear desde cero",
    description:
      "Empieza con la guía del framework o crea en línea con el agente de programación en la nube de Builder.io.",
    readDocs: "Leer documentación",
    buildOnline: "Crear en línea",
    popoverTitle: "Crear en el navegador",
    popoverBody:
      "Genera rápidamente apps agent-native en la nube con Builder.io.",
    waitlistBody:
      "Builder.io puede crear y personalizar una app agent-native en la nube: acciones, autenticación, estado SQL y chat del agente incluidos. Únete a la lista de espera para acceso anticipado.",
    emailLabel: "Correo electrónico",
    emailPlaceholder: "tu@empresa.com",
    joinWaitlist: "Unirse a la lista de espera",
    joining: "Uniéndose…",
    joined:
      "Ya estás en la lista de espera. Te enviaremos un correo cuando se abra el acceso para crear en línea.",
    invalidEmail: "Introduce un correo electrónico válido.",
    submitError: "No se pudo unir a la lista de espera. Inténtalo de nuevo.",
    waitlistUnavailable:
      "Las inscripciones en la lista de espera aún no están disponibles en este entorno. Prueba en su lugar el sitio de documentación alojado.",
    launchBuilder: "Abrir Builder",
  },
  templateCard: {
    pasteIntoTerminal: "Pega en tu terminal.",
    newToCli: "¿Nuevo en CLI?",
    screenshotAlt: "{{name}} captura de pantalla de la app",
  },
  templateDetail: {
    allTemplates: "Todas las apps",
    notFoundMetaTitle: "App no encontrada — Agent-Native",
    notFoundTitle: "App no encontrada",
    notFoundBody:
      "Explore el catálogo de apps para encontrar una aplicación disponible.",
    badge: "Agent-Native {{name}}",
    title: "App {{name}}",
  },
  templates: {
    clips: {
      replaces: "Reemplaza o amplía Loom, Granola y Wisprflow",
      description:
        "Graba tu pantalla, reuniones y notas de voz para que los agentes entiendan lo ocurrido y actúen.",
    },
    plan: {
      replaces:
        "Modo de plan visual para Codex, Claude Code y agentes de código",
      description:
        "Instala planificación visual como skill respaldada por una app. Tu agente de código puede abrir planes estructurados con diagramas, wireframes, prototipos, anotaciones, comentarios y enlaces de revisión.",
    },
    design: {
      replaces: "Reemplaza o amplía herramientas de prototipado",
      description:
        "Convierte instrucciones en diseños interactivos que siguen tu sistema de diseño mientras el agente perfecciona cada pantalla según tus comentarios.",
    },
    content: {
      replaces: "Reemplaza o aumenta Obsidian por MDX, Notion, Google Docs",
      description:
        "Trabaja con tus documentos mientras un agente redacta con tu voz, crea contenido interactivo y publica en tu sitio.",
    },
    slides: {
      replaces: "Reemplaza o aumenta Google Slides, Pitch",
      description:
        "Crea presentaciones editables y acordes con tu marca a partir de instrucciones o diapositivas existentes, que un agente puede crear, editar y perfeccionar.",
    },
    analytics: {
      replaces: "Alternativa de código abierto a Amplitude y FullStory",
      description:
        "Conecta tus datos para que un agente responda preguntas en lenguaje natural y convierta los resultados en gráficos y paneles.",
    },
    mail: {
      replaces: "Reemplaza o aumenta Superhuman, Gmail",
      description:
        "Una bandeja de entrada pensada para el teclado, donde un agente prioriza el correo, redacta respuestas, resume hilos y hace seguimiento.",
    },
    forms: {
      replaces: "Reemplaza o aumenta Typeform, Google Forms",
      description:
        "Creador de formularios nativo del agente. Genere formularios a partir de un mensaje, edite campos de forma visual o conversacional y envíe envíos a Slack, Discord, Google Sheets o webhooks.",
    },
    assets: {
      replaces:
        "Reemplaza o aumenta DAMs, bibliotecas de activos de marca y generadores de medios AI",
      description:
        "Ofrece a los agentes una biblioteca compartida de guías de marca, imágenes y vídeos para crear y elegir contenido visual acorde en todas las aplicaciones.",
    },
    calendar: {
      replaces: "Reemplaza o aumenta Google Calendar, Calendly",
      description:
        "Reúne tus calendarios de Google para que un agente encuentre horarios, programe o reprograme eventos y gestione reservas.",
    },
    dispatch: {
      replaces: "Control de misión para sus aplicaciones nativas de agente",
      description:
        "Mensajería y gestión centralizadas para cada agente de su pila. Habla con tus agentes desde Slack, Telegram o la web; enrutar trabajos, retener memoria, aprobar acciones y delegar entre aplicaciones a través de A2A.",
    },
    chat: {
      replaces: "Una aplicación mínima estilo ChatGPT para tu propio agente",
      description:
        "Chat: la primera plataforma de aplicación con subprocesos duraderos, una barra lateral estándar, acciones, autenticación, sincronización en vivo y una ruta limpia para agregar pantallas o conectar su propio backend de agente.",
    },
  },
  templateLanding: {
    faq: {
      eyebrow: "Preguntas frecuentes",
      title: "Respuestas a preguntas frecuentes",
    },
    analytics: {
      faq: {
        question1: "¿Qué es Agent-Native Analytics?",
        answer1:
          "Agent-Native Analytics es una herramienta de analítica con IA gratuita y de código abierto. Hazle preguntas a un agente de IA sobre los datos conectados, inspecciona las consultas y crea paneles reutilizables. También incluye repetición de sesiones, seguimiento de errores y monitorización del tiempo de actividad.",
        question2: "¿Necesito saber SQL para usar Analytics?",
        answer2:
          "Puedes hacer preguntas en lenguaje natural y dejar que tu agente de IA escriba las consultas. Para BigQuery, también puedes crear gráficos seleccionando tablas, métricas y filtros en el Explorador. El SQL sigue disponible para inspeccionarlo, y puede que alguien familiarizado con tus datos deba ayudar a conectar fuentes y definir métricas.",
        question3: "¿Qué fuentes de datos puedo conectar?",
        answer3:
          "Las fuentes admitidas incluyen BigQuery, Google Analytics 4, Amplitude, Mixpanel, PostHog, HubSpot y Stripe. Cada fuente necesita las credenciales adecuadas o una conexión de workspace compartida concedida a Analytics. Las respuestas disponibles dependen de los datos y permisos que conectes.",
        question4: "¿Puedo usar nuestras propias definiciones de métricas?",
        answer4:
          "Sí. Usa el diccionario de datos para documentar definiciones, nombres de tablas y columnas, ejemplos de consulta y excepciones, como excluir cuentas internas. Tu agente de IA puede usar esas definiciones al escribir consultas. Revisa el SQL y los resultados al verificar una métrica de negocio.",
        question5: "¿Puedo compartir paneles y programar informes?",
        answer5:
          "Sí. Comparte paneles con tu equipo o tu organización con acceso de lector, editor o administrador. También puedes programar informes por correo con los resultados actuales del panel, o configurar alertas para las condiciones que quieras vigilar.",
      },
      // Copy V3 de la landing page (2026-09-14) — del hero al CTA final más abajo.
      heroEyebrow: "Analytics",
      heroTitle:
        "Haz una pregunta. Obtenga el gráfico, la consulta y el contexto.",
      heroDescription:
        "Reúna datos de almacén, productos e ingresos. El agente verifica sus definiciones de métricas, escribe el SQL y convierte la respuesta en un panel reutilizable.",
      heroCta: "Explora tus datos",
      useCasesHeading: "Siga la señal desde la métrica hasta la sesión",
      useCasesBody:
        "Mantenga el razonamiento al lado de cada resultado, luego lleve un gráfico a un tablero o a una investigación de sesión.",
      useCase1Title: "Explicar un cambio en la activación.",
      useCase1Body:
        "Compare cohortes y canales en una conversación. El agente utiliza sus definiciones de métricas documentadas, escribe la consulta y muestra la evidencia detrás del cambio.",
      useCase2Title: "Cree una revisión de ingresos en vida",
      useCase2Body:
        "Pídale al agente que combine métricas de facturación, CRM o almacén en un panel. Los filtros y paneles persisten para su próxima revisión.",
      useCase3Title: "Traza una métrica hasta una sesión real",
      useCase3Body:
        "Pasar de un pico o error a la sesión detrás de él. Inspeccione la actividad de la consola y la red y luego comparta el contexto de diagnóstico temporal con el agente.",
      keyFeaturesEyebrow: "Funciones clave",
      keyFeaturesHeading:
        "Todo lo que necesitas para consultar, visualizar y explorar",
      feature1Title: "Preguntar a través de datos conectados",
      feature1Body:
        "Haga una pregunta sobre el almacén, el producto y las fuentes de ingresos. El agente convierte la respuesta en un gráfico y admite desgloses de seguimiento.",
      feature2Title: "Paneles que el agente puede editar",
      feature2Body:
        "Haga que el agente agregue o remodele paneles, filtros y averías. Los cambios permanecen en un panel reutilizable que su equipo puede compartir.",
      feature3Title: "SQL visible y contexto métrico",
      feature3Body:
        "Inspeccione la consulta detrás de un resultado y la definición de métrica utilizada para escribirlo. Refine el SQL cuando necesite más control.",
      feature4Title: "Un espacio de trabajo para fuentes de datos",
      feature4Body:
        "Conecte BigQuery, GA4, análisis de productos, HubSpot y Stripe, luego explore sus datos permitidos desde la misma aplicación.",
      feature5Title: "Definiciones que sigue el agente",
      feature5Body:
        "Documente reglas métricas, uniones, ejemplos y errores conocidos. Analytics brinda ese contexto al agente cuando escribe consultas.",
      feature6Title: "Repetición de sesión con diagnóstico",
      feature6Body:
        "Salte de un error a una grabación con eventos de red y de consola a la vista. Comparta un enlace de diagnóstico temporal para una investigación asistida por un agente.",
      finalCtaHeading: "Empieza con una pregunta sobre tus datos",
      finalCtaBody:
        "Conecta una fuente y pídele a tu agente de IA el primer gráfico.",
      finalCtaButton: "Explora tus datos",
      s001: "Analytics captura de pantalla de la plantilla",
      s002: "Conectores de datos",
      s003: "Tipos de gráficos",
      s004: "Explorador de consultas",
      s005: "lenguaje natural",
      s006: "Todas las plantillas",
      s007Primary: "La alternativa de código abierto a",
      s007Secondary: "Amplitude y FullStory",
      s008: "Conecte cualquier fuente de datos, solicite cualquier gráfico, cree paneles reutilizables: el agente AI escribe el SQL.",
      s009: "Probar",
      s010: "que puedes hacer",
      s011: "Todo lo que necesita para reemplazar su pila de análisis.",
      s012: "Consultas en lenguaje natural",
      s013: "Pregunte en inglés sencillo. El agente escribe el SQL y construye el gráfico.",
      s014: "Paneles reutilizables",
      s015: "Paneles persistentes con controles de fecha, subvistas y paneles redimensionables.",
      s016: "Acceso directo a BigQuery con historial, recuento de filas y URL para compartir.",
      s017: "Superación personal",
      s018: "El agente modifica la propia aplicación. ¿Necesita un nuevo tipo de gráfico? Sólo pregunta.",
      s019: "Conecta todo",
      s020: "Múltiples conectores integrados para servicios populares. El agente escribe otros nuevos a pedido.",
      s021: "CRM e ingresos",
      s022: "Ingeniería",
      s023: "GitHub, Jira, Sentry — PRs, tickets, sprints y seguimiento de errores.",
      s024: "Infraestructura",
      s025: "comunicación",
      s026: "Content y SEO",
      s027: "Comunidad",
      s028: "Diccionario de datos vivos",
      s029: "Definiciones de métricas con plantillas de consulta, patrones de unión, errores conocidos y frecuencia de actualización. Sincronizado desde Notion con validación impulsada por la comunidad.",
      s030: "Plantillas de consulta y resultados de ejemplo para cada métrica",
      s031: "Puntuación y validación de confianza con aprobaciones de revisores",
      s032: "Descubrimiento y sugerencias de métricas impulsadas por AI",
      s033: "Retraso de datos, dependencias y rangos de fechas válidos documentados",
      s034: "Usuarios activos semanales",
      s035: "Diariamente",
      s036: "~2 horas",
      s037: "Excluye correos electrónicos internos de @empresa",
      s038: "Validado ✓",
      s039: "como se compara",
      s040: "Panel de control UI",
      s041: "Si, rígido",
      s042: "No",
      s043: "Sí, totalmente personalizable",
      s044: "Limitado",
      s045: "Si, efímero",
      s046: "Sí, gráficos persistentes",
      s047: "Incorporado SDKs",
      s048: "Carga manual",
      s049: "Múltiples fuentes + personalizado",
      s050: "Diccionario de datos",
      s051: "Básico",
      s052: "Métricas completas con contexto",
      s053: "Personalización",
      s054: "Sólo configuración",
      s055: "Sólo aviso",
      s056: "Código fuente completo",
      s057: "Precios",
      s058: "Por asiento, por evento",
      s059: "Suscripción",
      s060: "Gratis y de código abierto",
      s061: "Comience en minutos",
      s062: "Empiece con la plantilla, conecte sus datos y comience a crear paneles.",
      s063: "Lea los documentos",
      s064: "Ver todas las plantillas",
    },
    calendar: {
      faq: {
        question1: "¿Qué es Agent-Native Calendar?",
        answer1:
          "Agent-Native Calendar es un asistente de programación con IA gratuito y de código abierto que se conecta a Google Calendar. Usa un agente de IA para gestionar eventos y encontrar horarios, o comparte enlaces de reserva para que otros puedan programar contigo.",
        question2: "¿Qué calendarios puedo conectar?",
        answer2:
          "Conecta varias cuentas de Google para ver sus eventos juntos. Los eventos nuevos y actualizados se escriben en el calendario principal de la cuenta seleccionada. También puedes mostrar feeds ICS o webcal de solo lectura; no son integraciones bidireccionales con Outlook ni Apple Calendar. Los calendarios de Google compartidos son de solo visualización y no bloquean la disponibilidad de reserva.",
        question3: "¿Qué puede hacer el agente de IA con mi calendario?",
        answer3:
          "Tu agente de IA puede consultar tu agenda, encontrar horarios disponibles y crear o reprogramar eventos. Cuando le pides que encuentre un horario, comprueba tus reglas de disponibilidad y los eventos existentes, además de la información de libre/ocupado de los asistentes indicados cuando es accesible. Tú eliges el horario sugerido antes de que se reserve la reunión.",
        question4:
          "¿Necesitan cuenta las personas para reservar una reunión conmigo?",
        answer4:
          "No. Cualquiera con tu enlace de reserva público puede elegir un horario disponible y responder tus preguntas de reserva sin iniciar sesión. Tras reservar, recibe un enlace privado para reprogramar o cancelar la reunión.",
        question5:
          "¿Puede un enlace de reserva comprobar la disponibilidad de varios anfitriones?",
        answer5:
          "Sí. Añade coanfitriones obligatorios y Calendar comprobará su información de libre/ocupado antes de ofrecer un horario. Para respetar también el horario laboral configurado de cada coanfitrión, tú y ese coanfitrión debéis añadir vuestros calendarios mutuamente como superposiciones. Sin ese uso compartido mutuo, Calendar solo comprueba su información de libre/ocupado.",
      },
      s001: "Calendar captura de pantalla de la plantilla",
      // Copia V3 de la página de destino (2026-09-10) — del hero al CTA final.
      heroEyebrow: "Calendar",
      heroTitle:
        "Encuentre tiempo, reserve reuniones y adapte su día con un agente",
      heroDescription:
        "Calendar reúne sus calendarios de Google y las reglas de disponibilidad para que el agente pueda encontrar vacantes compartidas, preparar reservas y ayudar a actualizar eventos.",
      heroCta: "Empieza a programar",
      useCasesHeading:
        "Deje que el agente se encargue de los detalles de la programación",
      useCasesBody:
        "Verifique la disponibilidad real en todos los calendarios y luego revise una propuesta clara antes de crear o mover una reunión.",
      useCase1Title: "Convierta un enlace de reserva en una reunión preparada",
      useCase1Body:
        "Ofrezca únicamente horarios que respeten el horario laboral, los avisos y las zonas de amortiguamiento. Recopile los detalles que necesita y luego agregue el enlace del video cuando el huésped reserve.",
      useCase2Title: "Encuentra un espacio que todos puedan hacer",
      useCase2Body:
        "Pídale al agente que compare el tiempo de disponibilidad y ocupación de los asistentes y las superposiciones del calendario. Devuelve la apertura compartida y los calendarios que revisó.",
      useCase3Title: "Reprogramar sin perder el hilo",
      useCase3Body:
        "Solicite una hora más tarde y permita que el agente revise a los invitados, conserve los detalles de la reunión y prepare la invitación actualizada para su revisión.",
      keyFeaturesEyebrow: "Funciones clave",
      keyFeaturesHeading:
        "Todo lo que necesitas para programar, reservar y reprogramar",
      feature1Title: "Programación en lenguaje natural",
      feature1Body:
        "Pídale al agente que verifique la disponibilidad, proponga un horario y cree o mueva un evento con sus invitados y detalles de la reunión.",
      feature2Title: "Disponibilidad entre cuentas",
      feature2Body:
        "Vea calendarios de Google conectados juntos e incluya feeds de solo lectura como contexto de programación.",
      feature3Title: "Páginas de reserva con admisión",
      feature3Body:
        "Cree enlaces para diferentes tipos de reuniones, establezca la duración y las preguntas de reserva, y permita que los invitados elijan un espacio disponible.",
      feature4Title: "Reglas que dan forma a cada tragamonedas",
      feature4Body:
        "Establezca horarios de trabajo, zonas de influencia, avisos, zonas horarias y horizontes de reserva para que los horarios públicos y sugeridos se ajusten a su agenda.",
      feature5Title: "Comprobaciones reales de múltiples hosts",
      feature5Body:
        "Agregue los coanfitriones necesarios y verifique su disponibilidad de disponibilidad antes de ofrecer una hora. Calendar también respeta las superposiciones de horas de trabajo compartidas cuando se configura.",
      feature6Title: "Seguimiento de reuniones gestionadas por agentes",
      feature6Body:
        "Mantenga adjuntos los detalles de Google Meet o Zoom mientras el agente prepara los cambios del evento y las invitaciones actualizadas.",
      finalCtaHeading: "Añade tu próxima reunión al calendario",
      finalCtaBody:
        "Encuentra un horario con tu agente de IA o envía un enlace de reserva.",
      finalCtaButton: "Empieza a programar",
      s002: "Calendar vistas",
      s003: "Acciones del agente",
      s004: "Tipos de enlaces de reserva",
      s005: "Todas las plantillas",
      s006Primary: "La alternativa de código abierto",
      s006Secondary: "Google Calendar y Calendly",
      s007: "Sincronización de cuentas múltiples Google Calendar, disponibilidad configurable y enlaces de reserva personalizables estilo Calendly, con un agente AI que programa en su nombre.",
      s008: "Probar",
      s009: "Iniciar sesión solo utiliza la identidad básica Google, pero conectar la sincronización Calendar solicita acceso al calendario. Es posible que algunos administradores de Workspace requieran aprobación para la demostración alojada. Ejecútelo localmente para utilizar su propio cliente Google OAuth.",
      s010: "que puedes hacer",
      s011: "Todo lo que necesitas para reemplazar tu calendario y programación.",
      s012: "Múltiples vistas Calendar",
      s013: "Vistas de mes, semana y día con gestión de eventos de arrastrar y soltar.",
      s014: "Programación de lenguaje natural",
      s015: "Dígale al agente que busque un espacio, cree un evento o reprograme; él se encarga del resto.",
      s016: "Enlaces de reserva personalizables",
      s017: "Cree múltiples páginas de reserva estilo Calendly con diferentes duraciones y disponibilidad. Los visitantes eligen un espacio que funcione.",
      s018: "Superación personal",
      s019: "El agente modifica la propia aplicación. ¿Necesita una nueva vista o flujo de reservas? Sólo pregunta.",
      s020: "Conecte varias cuentas Google a través de OAuth 2.0. Extraiga eventos de todos sus calendarios y cree eventos que se sincronicen con Google.",
      s021: "Cuenta múltiple OAuth 2.0 con actualización automática de token",
      s022: "Sincronización basada en extracción: no se necesitan webhooks",
      s023: "Crear, actualizar y eliminar eventos en Google",
      s024: "Cree enlaces de reserva personalizables donde cualquiera pueda reservar tiempo con usted. Ajustes de disponibilidad configurables por tipo de reserva.",
      s025: "Selector de fecha + selección de franja horaria",
      s026: "Respeta tu disponibilidad y los eventos existentes.",
      s027: "Captura de información del visitante + confirmación.",
      s028: "Programación impulsada por agentes",
      s029: "El agente ejecuta scripts para sincronizar calendarios, crear eventos, verificar disponibilidad y administrar reservas. Todo a través del lenguaje natural.",
      s030: '"Sincronizar mi Google Calendar para este mes"',
      s031: '"Busque un espacio de 30 minutos el próximo martes para una reunión de equipo"',
      s032: '"Crea un stand-up recurrente a las 9 a. m. todos los días de la semana"',
      s033: '"Muéstrame mi disponibilidad para la próxima semana"',
      s034: "como se compara",
      s035: "Interfaz de calendario",
      s036: "Completo, rígido",
      s037: "mínimo",
      s038: "Completo, totalmente personalizable",
      s039: "AI programación",
      s040: "Lenguaje natural, control total",
      s041: "Página de reserva",
      s042: "Espacios para citas",
      s043: "Sí, marca limitada",
      s044: "Dominio propio totalmente personalizable",
      s045: "Personalización",
      s046: "Sólo ajustes",
      s047: "Solo marca",
      s048: "Código fuente completo",
      s049: "Precios",
      s050: "Libre / Espacio de trabajo",
      s051: "$10+ al mes por usuario",
      s052: "Gratis y de código abierto",
      s053: "Comience en minutos",
      s054: "Empiece con la plantilla, conecte Google Calendar y comience a programar con AI.",
      s055: "Lea los documentos",
      s056: "Ver todas las plantillas",
      s057: "Nota de la demo alojada",
      s058: "Sincronización bidireccional",
    },
    assets: {
      faq: {
        question1: "¿Qué es Agent-Native Assets?",
        answer1:
          "Agent-Native Assets es una biblioteca de activos de marca gratuita y de código abierto con generación de imágenes y vídeo por IA. Organiza el contenido multimedia existente, aporta referencias de marca y trabaja con un agente de IA para generar, editar y reutilizar activos en distintos proyectos.",
        question2: "¿Cómo usa Assets mis directrices de marca?",
        answer2:
          "Añade tu logotipo, imágenes de referencia, colores y notas de estilo a un kit de marca. Las plantillas reutilizables aportan instrucciones para tipos de contenido concretos. Tu agente de IA usa ese contexto para guiar la generación, y puedes revisar y perfeccionar los resultados antes de guardarlos.",
        question3: "¿Puedo subir y organizar imágenes y vídeos existentes?",
        answer3:
          "Sí. Sube contenido multimedia existente o importa un activo desde una URL, y organízalo en bibliotecas y carpetas junto con el trabajo generado. Puedes explorar y buscar en la biblioteca, reutilizar activos como referencias o exportarlos para otro proyecto.",
        question4: "¿Puede mi agente de IA usar Assets desde otra app?",
        answer4:
          "Sí. Conecta un agente compatible mediante la integración MCP de Assets para buscar, generar y seleccionar contenido multimedia desde el chat. Las apps Agent-Native también pueden solicitar activos o integrar un selector. La experiencia disponible depende de la app anfitriona y de su conexión con Assets.",
        question5:
          "¿Puede Assets usar mi logotipo real en las imágenes generadas?",
        answer5:
          "Sí. Define un logotipo canónico en tu kit de marca y activa la composición del logotipo para la generación. Assets coloca el logotipo original sobre la imagen después de generarla, de modo que el modelo de imagen no lo vuelve a dibujar. Revisa su colocación y la imagen circundante antes de usarla.",
      },
      s001: "Assets captura de pantalla de la plantilla",
      imageCredits: "Créditos de imágenes",
      // V3 landing page copy (2026-09-11) — hero through final CTA below.
      heroEyebrow: "Assets",
      heroTitle: "Genera imágenes de marca en una conversación",
      heroDescription:
        "Describe lo que necesitas, dale a tu agente un kit de marca o una referencia y compara las variaciones generadas junto con la conversación.",
      heroCta: "Genera una imagen",
      useCasesHeading: "¿Qué puedes hacer con Assets?",
      useCasesBody:
        "Crea imágenes de campaña, adapta visuales para nuevos proyectos, o dale a tu equipo y a tus agentes de IA una biblioteca de marca compartida.",
      useCase1Title: "Crear visuales de campaña",
      useCase1Body:
        "Pide a tu agente de IA imágenes para el blog, gráficos para redes sociales o visuales de lanzamiento usando tus referencias de marca. Compara las opciones y perfecciona la que elijas.",
      useCase2Title: "Adaptar imágenes para nuevos proyectos",
      useCase2Body:
        "Dale a tu agente de IA una imagen existente y describe los cambios que necesitas, como un fondo distinto o espacio para un titular.",
      useCase3Title: "Compartir recursos de marca en todo tu trabajo",
      useCase3Body:
        "Mantén juntos los logotipos, las imágenes de producto y las referencias de marca para que tus compañeros y los agentes de IA conectados encuentren contenido multimedia para presentaciones, sitios web y otros proyectos.",
      keyFeaturesEyebrow: "Funciones clave",
      keyFeaturesHeading:
        "Todo lo que necesitas para generar, perfeccionar y reutilizar",
      feature1Title: "Bibliotecas de activos de marca",
      feature1Body:
        "Organiza el contenido multimedia subido y generado en bibliotecas y carpetas. Añade logotipos, imágenes de referencia y notas de estilo para que los use tu agente de IA.",
      feature2Title: "Generación de imágenes y vídeo con IA",
      feature2Body:
        "Describe el contenido multimedia que necesitas y elige tus referencias de marca. Genera opciones de imágenes o vídeos cortos, y revisa los resultados antes de guardarlos.",
      feature3Title: "Edición de imágenes",
      feature3Body:
        "Pide a tu agente de IA que edite o modifique el estilo de una imagen. Usa el activo existente como referencia y perfecciónalo con tus comentarios.",
      feature4Title: "Plantillas reutilizables",
      feature4Body:
        "Guarda instrucciones de generación para trabajos recurrentes, como portadas de blog o gráficos para redes sociales. Asocia plantillas a un kit de marca para reutilizar sus referencias.",
      feature5Title: "Colocación del logotipo original",
      feature5Body:
        "Define el logotipo de tu kit de marca y añádelo a las imágenes generadas. La composición del logotipo coloca el archivo original en lugar de generar una versión nueva.",
      feature6Title: "Acceso del agente",
      feature6Body:
        "Conecta tu agente de IA para buscar en la biblioteca, generar contenido multimedia y elegir activos desde el chat. Las apps compatibles también pueden integrar un selector de activos.",
      finalCtaHeading: "Crea tu próximo recurso de marca",
      finalCtaBody:
        "Elige tus referencias y dile a tu agente de IA lo que necesitas.",
      finalCtaButton: "Genera una imagen",
    },
    chat: {
      faq: {
        question1: "¿Qué es Agent-Native Chat?",
        answer1:
          "Agent-Native Chat es una app de chat con IA gratuita y de código abierto para desarrolladores. Incluye hilos guardados, una interfaz de chat con agente, autenticación, acciones compartidas y sincronización en vivo. Tú añades los datos y el comportamiento específicos de tu dominio para tu aplicación.",
        question2: "¿Chat es un asistente de IA terminado?",
        answer2:
          "Chat ofrece una interfaz de conversación funcional y el framework que hay detrás. Incluye una acción de ejemplo, pero los flujos de trabajo de negocio y las integraciones con proveedores son cosa tuya: impleméntalos y configúralos.",
        question3: "¿Puedo añadir pantallas más allá de la interfaz de chat?",
        answer3:
          "Sí. Añade rutas y componentes para listas, colas, editores o cualquier otra vista que necesite tu flujo de trabajo. Conéctalas a las mismas acciones y datos de la aplicación que usa el agente.",
        question4: "¿Chat incluye conexiones con mis herramientas de negocio?",
        answer4:
          "La plantilla mínima no incluye integraciones de proveedores específicas de un dominio. Añade las conexiones y reglas de acceso que necesite tu app. Si ya existe una app de Agent-Native que se ajusta a tu flujo de trabajo, su plantilla puede ser un punto de partida más adecuado.",
        question5: "¿Puedo personalizar y desplegar mi propia versión?",
        answer5:
          "Sí. Crea una copia con la CLI, añade tus acciones, datos e interfaz, y despliega tu aplicación. Configura la autenticación y el acceso a proveedores para tu entorno, y prueba los flujos de trabajo que añadas antes de compartirlos con tus usuarios.",
      },
      s001: "Captura de pantalla de la app Chat",
      // V3 landing page copy (2026-09-14) — hero through final CTA below.
      heroEyebrow: "Chat",
      heroTitle: "Crea tu propia app de chat con IA",
      heroDescription:
        "Un iniciador de chat gratuito y de código abierto con hilos duraderos, autenticación, acciones compartidas y un agente que puede ampliar con sus propias herramientas y pantallas.",
      heroCta: "Crea tu chat",
      heroSecondaryCta: "Abrir Chat",
      useCasesHeading: "Convierta las conversaciones en asistentes de trabajo",
      useCasesBody:
        "Agregue las acciones, datos y pantallas que le permitan a su agente responder preguntas y hacer avanzar el trabajo.",
      useCase1Title: "Responda preguntas con el contexto de su equipo",
      useCase1Body:
        "Conecte las fuentes que su aplicación necesita a través de acciones y luego permita que el agente reúna notas, archivos y detalles del proyecto en una sola respuesta.",
      useCase2Title: "Dale a tu agente herramientas para actuar",
      useCase2Body:
        "Cree un prototipo de un flujo de trabajo en el chat, llame a las acciones que defina y refine cómo el agente maneja cada paso.",
      useCase3Title: "Hacer que los resultados sean utilizables",
      useCase3Body:
        "El agente abierto trabaja en una cola, tabla o editor para que las personas puedan inspeccionar y continuar a partir de los mismos datos compartidos.",
      keyFeaturesEyebrow: "Funciones clave",
      keyFeaturesHeading: "Un punto de partida para tu agente y su interfaz",
      feature1Title: "Conversaciones duraderas",
      feature1Body:
        "Cree, vuelva a abrir, cambie el nombre, fije y archive hilos desde la barra lateral del historial incluida.",
      feature2Title: "Chat de agente de página completa",
      feature2Body:
        "Comience con la superficie del chat y el tiempo de ejecución, listos para sus propias instrucciones, herramientas y flujos de trabajo.",
      feature3Title: "Conecta tus propios servicios",
      feature3Body:
        "Agregue acciones de proveedores y flujos de conexión para herramientas como Granola, Linear, Drive o Notion; el iniciador deja esas integraciones a su aplicación.",
      feature4Title: "Acciones compartidas",
      feature4Body:
        "Mantenga las herramientas del agente y las operaciones de la interfaz en la misma superficie de acción.",
      feature5Title: "Estado del espacio de trabajo en vivo",
      feature5Body:
        "Mantenga la navegación actual y el trabajo seleccionado sincronizados para el usuario y el agente.",
      feature6Title: "Pantallas personalizadas",
      feature6Body:
        "Agregue vistas enfocadas cuando una conversación necesite una cola, un editor u otra interfaz de dominio.",
      finalCtaHeading: "Construye tu primer flujo de trabajo de agente",
      finalCtaBody:
        "Crea tu copia y añade la primera acción que necesiten tus usuarios.",
      finalCtaButton: "Crea tu chat",
    },
    clips: {
      s001: "Clips captura de pantalla de la plantilla",
      // V5 landing page copy (2026-09-09) — hero through final CTA below.
      heroEyebrow: "Clips",
      heroTitle:
        "Grabaciones de pantalla que tu agente de IA puede ver y escuchar",
      heroDescription:
        "Clips es un grabador de pantalla gratuito y de código abierto para compartir errores, comentarios y tutoriales con agentes de IA.",
      heroCta: "Grabar un clip",
      useCasesHeading: "¿Qué puedes hacer con Clips?",
      useCasesBody:
        "Empieza con un clip que hayas grabado o que alguien te haya compartido. Dale a tu agente de IA el contexto y dile lo que necesitas.",
      useCase1Title: "Actuar sobre comentarios grabados",
      useCase1Body:
        "Dale a tu agente de IA comentarios grabados para convertirlos en un plan o ayudar a implementar los cambios solicitados.",
      useCase2Title: "Investigar un error reportado",
      useCase2Body:
        "Comparte una grabación de un error con tu agente de IA para que investigue qué salió mal y defina los siguientes pasos.",
      useCase3Title: "Crear a partir de un brief grabado",
      useCase3Body:
        "Usa un brief grabado para guiar a tu agente de IA en la creación de una presentación, un diseño, contenido o un cambio en una app.",
      keyFeaturesEyebrow: "Funciones clave",
      keyFeaturesHeading:
        "Todo lo que necesitas para grabar, transcribir y compartir",
      feature1Title: "Grabaciones legibles por agentes",
      feature1Body:
        "Comparte la transcripción y las imágenes con marca de tiempo de un clip con tu agente de IA mediante un único enlace legible por agentes.",
      feature2Title: "Transcripciones automáticas",
      feature2Body:
        "Obtén transcripciones de grabaciones, reuniones y dictados. Haz clic en cualquier línea de la transcripción para saltar a ese momento.",
      feature3Title: "Registros de depuración del navegador",
      feature3Body:
        "Captura errores de consola y solicitudes fallidas junto con tu grabación con la extensión de Chrome de Clips.",
      feature4Title: "Agente de IA integrado",
      feature4Body:
        "Pregúntale al agente de IA integrado sobre un clip o sobre toda tu biblioteca, y deja que edite las transcripciones en el chat.",
      feature5Title: "Biblioteca de grabaciones con búsqueda",
      feature5Body:
        "Encuentra clips buscando en sus transcripciones. Organiza tus grabaciones con carpetas, etiquetas y espacios de equipo.",
      feature6Title: "Dictado con pulsar para hablar",
      feature6Body:
        "Mantén pulsada la tecla Fn en la app de escritorio para dictar en otras aplicaciones. Repasa las transcripciones y el texto depurado en tu historial.",
      teammatesLine:
        "Tus compañeros pueden ver la misma grabación en el reproductor.",
      teammatesLinkLabel: "Leer la guía para compartir con agentes",
      seeInActionHeading: "Ve Clips en acción",
      seeInActionBody:
        "Mira Clips en uso, desde grabar un flujo de trabajo en el navegador hasta mostrarle a un agente de IA cómo realizar una tarea.",
      watchClipLabel: "Ver el clip",
      finalCtaHeading: "Pon tu próximo clip a trabajar",
      finalCtaBody:
        "Graba una explicación o lleva un clip compartido a tu agente de IA.",
      finalCtaButton: "Grabar un clip",
      s002: "Registro de pantalla",
      s003: "Registros de depuración del navegador",
      s004: "Dictar",
      s005: "Puede ver + oír",
      s006: "Todas las plantillas",
      s007Primary: "Grabaciones de pantalla que tu",
      s007Secondary: "AI puede ver y oír.",
      s008: "Captura registros de depuración del navegador, obtén transcripciones y usa el dictado integrado. 100 % gratis, de código abierto y personalizable.",
      s063: "Obtén una recomendación personalizada",
      s064: "Pega este mensaje en Claude, ChatGPT o Cursor para ver cómo Clips podría influir en tu flujo de trabajo.",
      s009: "Pruébalo",
      s010: "que puedes hacer",
      s011: "Grabe, transcriba y depure: una aplicación, una biblioteca, sin la pila de suscripción.",
      s012: "Grabación de pantalla con un clic",
      s013: "Transcripciones automáticas",
      s014: "Cada grabación de pantalla, reunión y dictado obtiene una transcripción completa. Los agentes pueden usarlo como capa de audio y los espectadores pueden hacer clic en cualquier línea para saltar a ese momento.",
      s015: "Dictado pulsar para hablar",
      s016: "Biblioteca Video con capacidad de búsqueda",
      s017: "Grabaciones de pantalla, transcripciones de reuniones y dictados, todos indexados juntos. Busque en toda su biblioteca por lo que se dijo, no solo por el título.",
      s018: "Búsqueda de texto completo en cada transcripción",
      s019: "Carpetas, etiquetas y espacios de trabajo en equipo",
      s020: "Comentarios y reacciones con marca de tiempo",
      s021: "Página de jugador de marca",
      s022: "Autohospeda al jugador. Personalice la marca, el llamado a la acción y los análisis: es su código.",
      s023: "Dominio personalizado y tematización",
      s024: "Recuento de visualizaciones, tasa de visualización y abandono",
      s025: "Integrable en cualquier sitio",
      s026: "Flujos de trabajo de vídeo impulsados por agentes",
      s027: "Pregúntele al agente cualquier cosa sobre su biblioteca o pegue un enlace Clips compartido en otro agente: puede leer transcripciones, inspeccionar fotogramas con marca de tiempo, leer los errores capturados de la consola y las solicitudes fallidas detrás de un error, y redactar seguimientos escritos de sus grabaciones.",
      s028: '"Saque elementos de acción del stand-up de hoy"',
      s029: '"Encuentra el dictado donde describí el plan de lanzamiento"',
      s030: '"Redactar un correo electrónico de seguimiento de esta reunión"',
      s031: '"Lea los errores de la consola en este clip de error y proponga una solución"',
      s032: "como se compara",
      s033: "Grabación de pantalla",
      s034: "Sí",
      s035: "No",
      s036: "Captura de depuración del navegador (consola + red)",
      s037: "Calendar notas de reunión sincronizadas",
      s038: "Dictado de pulsar para hablar",
      s039: "AI resúmenes y elementos de acción",
      s040: "Limitado",
      s041: "Agente completo: capítulos, acciones, Q&A",
      s042: "El agente edita transcripciones y códigos",
      s043: "Enlaces de medios de agentes pegables",
      s044: "Solo transcripción",
      s045: "Paquete de registro + captura de pantalla",
      s046: "Sólo notas",
      s047: "Sólo texto",
      s048: "Transcripción + fotogramas con marca de tiempo",
      s049: "Propiedad de los datos",
      s050: "almacenamiento del vendedor",
      s051: "La nube del vendedor",
      s052: "Eres dueño de tus datos e incluso del propio código de la app.",
      s053: "Precios",
      s054: "$15-30 al mes por usuario",
      s055: "Niveles gratuitos + pagos",
      s056: "$18-25 al mes por usuario",
      s057: "$12-15 al mes por usuario",
      s058: "Gratis y de código abierto",
      s059: "Empieza ahora",
      s060: "Elige qué quieres capturar y, después, empieza a grabar en Clips.",
      s062: "Ver todas las plantillas",
      faq: {
        question1: "¿Qué es Agent-Native Clips?",
        answer1:
          "Agent-Native Clips es un grabador de pantalla gratuito y de código abierto para compartir errores, comentarios y tutoriales con agentes de IA. Le da a tu agente de IA una transcripción e imágenes con marca de tiempo de una grabación, mientras que las personas pueden ver el mismo clip.",
        question2: "¿Puedo compartir grabaciones con Claude, ChatGPT o Cursor?",
        answer2:
          "Clips ofrece un enlace legible por agentes con una transcripción e imágenes con marca de tiempo. Tu agente debe poder abrir el contenido enlazado y leer imágenes para usar ambos. Algunos modos de chat pueden leer la transcripción, pero necesitan que subas una imagen por separado.",
        question3: "¿Necesito la extensión de Chrome para grabar mi pantalla?",
        answer3:
          "No. Puedes grabar en la app web de Clips. Usa la extensión de Chrome cuando también quieras los mensajes de consola y los diagnósticos de red de la pestaña que estás mostrando.",
        question4: "¿Pueden los agentes de IA ver mis grabaciones de pantalla?",
        answer4:
          "Con Clips, los agentes de IA compatibles pueden entender tu grabación a través de una transcripción e imágenes con marca de tiempo. Usan el texto y las imágenes en lugar de reproducir el video, así que puedes hacer preguntas sobre lo que ocurrió o darle a tu agente de IA una tarea basada en la grabación.",
        question5: "¿Quién puede acceder a una grabación compartida?",
        answer5:
          "Las grabaciones usan enlaces públicos de forma predeterminada, salvo que tu organización cambie esa configuración. Cualquiera con el enlace puede acceder a ellas. Hay opciones de acceso privado y de organización disponibles, y los clips privados se pueden compartir con agentes mediante enlaces temporales sin hacer pública la grabación.",
      },
      quickStart: {
        recordingMode: "Modo de grabación",
        modeScreenCamera: "Pantalla + cámara",
        modeScreenOnly: "Solo pantalla",
        modeCameraOnly: "Solo cámara",
        captureSource: "Fuente de captura",
        surfaceWindow: "Ventana",
        surfaceBrowser: "Pestaña del navegador",
        surfaceScreen: "Pantalla",
        audioSource: "Fuente de audio",
        defaultMicrophone: "Micrófono predeterminado",
        startRecording: "Iniciar grabación",
        uploadVideo: "Subir vídeo",
        importLoom: "Importar desde Loom",
      },
    },
    content: {
      faq: {
        question1: "¿Qué es Agent-Native Content?",
        answer1:
          "Agent-Native Content es un espacio de trabajo gratuito y de código abierto para documentos, tareas y bases de datos. Combina un editor de documentos con IA, tablas estructuradas y páginas compartidas que las personas y los agentes de IA conectados pueden leer y actualizar juntos.",
        question2: "¿Puedo usar mi propio agente de IA con Content?",
        answer2:
          "Sí. Content ofrece una conexión MCP para herramientas compatibles como Claude Code, Codex y Cursor. Después de conectarte y autorizar el acceso, tu agente puede trabajar con los documentos y las bases de datos disponibles para él. También puedes usar el agente integrado de Content.",
        question3:
          "¿Puedo pedirle a la IA que revise mi texto sin reescribirlo?",
        answer3:
          "Sí. Pide a tu agente de IA que deje comentarios en un documento o un pasaje. Puedes leer los comentarios y hacer los cambios tú mismo, o pedirle al agente que edite el texto. Pedir comentarios no implica entregarle la redacción.",
        question4:
          "¿Puede Content hacer seguimiento de tareas y recopilar solicitudes del equipo?",
        answer4:
          "Sí. Crea una base de datos con campos como responsable, estado, fecha de entrega y próximo paso. Añade descripciones que expliquen qué debe contener cada campo. Esas descripciones guían a tu agente de IA al crear o actualizar entradas, incluso para pedir la información que falte.",
        question5:
          "¿Puedo controlar quién edita mi trabajo y restaurar una versión anterior?",
        answer5:
          "Sí. Los documentos nuevos son privados de forma predeterminada. Compártelos con acceso de lector, editor o administrador, y usa el historial de versiones de la página para restaurar una instantánea anterior. Restaurar una instantánea reemplaza el contenido actual de la página.",
      },
      s001: "Content captura de pantalla de la plantilla",
      // V4 landing page copy (2026-09-14) — hero through final CTA below.
      heroEyebrow: "Content",
      heroTitle: "Crea y organiza tu trabajo con tu agente de IA",
      heroDescription:
        "Content es un espacio de trabajo gratuito y de código abierto para documentos, listas de tareas y bases de datos que puedes leer y actualizar junto con tus agentes de IA.",
      heroCta: "Organiza tu trabajo",
      useCasesHeading: "¿Qué puedes hacer con Content?",
      useCasesBody:
        "Trabaja en un borrador, haz seguimiento de lo que falta por hacer o recopila los detalles de una nueva solicitud.",
      useCase1Title: "Escribe y revisa contenido",
      useCase1Body:
        "Pide a tu agente de IA que redacte una página, revise un pasaje o deje comentarios en tu texto. Elige cómo quieres que te ayude.",
      useCase2Title: "Haz seguimiento del trabajo con tus agentes",
      useCase2Body:
        "Mantén las tareas, el estado y los próximos pasos en una tabla compartida. Pide a tus agentes de IA conectados que la actualicen mientras avanzas en un proyecto.",
      useCase3Title: "Recopila solicitudes de proyectos",
      useCase3Body:
        "Crea una tabla para solicitudes de diseño u otro trabajo del equipo. Añade instrucciones a cada campo para que tu agente de IA pueda pedir los detalles que falten.",
      keyFeaturesEyebrow: "Funciones clave",
      keyFeaturesHeading:
        "Todo lo que necesitas para escribir, organizar y colaborar",
      feature1Title: "Redacción y revisión con IA",
      feature1Body:
        "Obtén un primer borrador, pide cambios en el texto seleccionado o solicita comentarios. Tu agente de IA trabaja directamente en el documento.",
      feature2Title: "Documentos y páginas anidadas",
      feature2Body:
        "Escribe páginas con encabezados, tablas, imágenes y bloques de código. Agrupa documentos de apoyo bajo un proyecto y busca por título y contenido para encontrarlos.",
      feature3Title: "Bases de datos y vistas",
      feature3Body:
        "Organiza el trabajo en tablas, tableros o calendarios. Añade campos para responsables, fechas y estado, con un documento completo detrás de cada fila.",
      feature4Title: "Instrucciones de página y de campo",
      feature4Body:
        "Describe qué debe ir en una página o en un campo de la base de datos. Dale a tus agentes de IA indicaciones sobre la información y el formato que esperas.",
      feature5Title: "Agentes de IA conectados",
      feature5Body:
        "Conecta agentes de herramientas como Claude Code, Codex o Cursor para leer y actualizar tus documentos y bases de datos junto con el agente integrado.",
      feature6Title: "Colaboración en equipo",
      feature6Body:
        "Edita páginas de forma conjunta, comenta pasajes y responde en hilos. Comparte con personas concretas o con tu organización y elige su nivel de acceso.",
      finalCtaHeading: "Lleva tu próximo proyecto a Content",
      finalCtaBody:
        "Empieza con un documento, una lista de tareas o una tabla que tu equipo ya usa.",
      finalCtaButton: "Organiza tu trabajo",
      s002: "Todas las plantillas",
      s003: "Obsidian de código abierto para MDX",
      s004: "Edite archivos Markdown/MDX locales como Obsidian, genere bloques personalizados interactivos enriquecidos y escriba con un agente AI que conozca sus documentos.",
      s005: "Probar",
      s006: "escribir",
      s007: "Editor enriquecido para Markdown/MDX local con formato, encabezados, bloques de código y medios.",
      s008: "Refinar con AI",
      s009: "Reescribe, amplía, resume o cambia el tono de cualquier selección.",
      s010: "Construir bloques MDX",
      s011: "Genere componentes interactivos y manténgalos editables en sus documentos.",
      s012: "Todo lo que necesitas",
      s013: "Un espacio de trabajo de contenido completo, como Obsidian para MDX, con colaboración al estilo Notion cuando la necesite.",
      s014: "Proyectos y Documentos",
      s015: "Organice en proyectos con documentos anidados. Navegación y búsqueda en árbol de barra lateral.",
      s016: "Consciente de la marca AI",
      s017: "El agente aprende su voz, guía de estilo y tono. Cada borrador suena como tú.",
      s018: "Sincronización bidireccional Notion. Importe páginas desde Notion, edítelas localmente y reenvíe los cambios.",
      s019: "Archivos locales Markdown/MDX",
      s020: "Edite documentos de repositorio directamente como Obsidian, obtenga una vista previa de los cambios y sincronícelos nuevamente cuando use el modo alojado.",
      s021: "Bloques MDX personalizados",
      s022: "Genere componentes locales interactivos, insértelos en MDX y edite sus accesorios desde el documento UI.",
      s023: "Automatización de guiones",
      s024: "Generación de contenido por lotes, referencias cruzadas y canales de publicación.",
      s025: "Superación personal",
      s026: "El agente modifica la propia aplicación. ¿Necesita un nuevo flujo de trabajo? Sólo pregunta.",
      s027: "Escribe aquí, publica en todas partes.",
      s028: "Conéctese a cualquier CMS sin cabeza mediante scripts. El agente maneja todo el flujo de trabajo.",
      s029: "El agente ejecuta los scripts de publicación de forma autónoma",
      s030: "Markdown, HTML, o cualquier formato que prefieras",
      s031: "Sincronización local opcional Markdown/MDX para flujos de trabajo de archivo primero",
      s032: "Borrador de contenido en el editor",
      s033: '"Publicar esto en WordPress"',
      s034: "El agente ejecuta el script de publicación",
      s035: "Content vive en tu sitio",
      s036: "como se compara",
      s037: "Interfaz del editor",
      s038: "Completo, rígido",
      s039: "Chat solamente",
      s040: "Completo, personalizable",
      s041: "Conocimiento de marca",
      s042: "Por conversación",
      s043: "Persistente, entrenado",
      s044: "Archivos locales MDX",
      s045: "Markdown en algunas herramientas",
      s046: "Copiar y pegar manualmente",
      s047: "Edición directa de archivos con bloques personalizados",
      s048: "publicación CMS",
      s049: "Paso separado",
      s050: "Flujo de trabajo integrado",
      s051: "Personalización",
      s052: "Solo complementos",
      s053: "Sólo aviso",
      s054: "Código fuente completo",
      s055: "Precios",
      s056: "Por asiento",
      s057: "Suscripción",
      s058: "Gratis y de código abierto",
      s059: "Comience en minutos",
      s060: "Traiga sus documentos MDX, genere bloques interactivos y comience a escribir con AI.",
      s061: "Lea los documentos",
      s062: "Ver todas las plantillas",
    },
    design: {
      faq: {
        question1: "¿Qué es Agent-Native Design?",
        answer1:
          "Agent-Native Design es una herramienta de diseño y prototipado con IA gratuita y de código abierto. Crea prototipos HTML interactivos con un agente de IA, aplica tu marca y perfecciona los diseños con controles visuales o por chat. Comparte el resultado para recibir feedback o expórtalo para desarrollo.",
        question2: "¿Puedo editar un diseño después de que la IA lo genere?",
        answer2:
          "Sí. Ajusta texto, espaciado y estilo con controles visuales, o pide al agente de IA que cambie el diseño. Puedes comparar distintas direcciones y seguir perfeccionando la que elijas.",
        question3: "¿Puedo usar mi propio sistema de diseño?",
        answer3:
          "Sí. Vincula un sistema de diseño para guiar colores, tipografía, estilo e instrucciones de marca. Puedes reutilizarlo en varios diseños y usarlo como contexto para las revisiones del agente de IA.",
        question4: "¿Puedo trabajar con diseños de Figma?",
        answer4:
          "Sí. Design admite flujos de importación desde Figma y una exportación SVG específica para Figma. Revisa las fuentes, los diseños y los elementos editables después de transferir un diseño, ya que la compatibilidad depende del origen y el formato de exportación.",
        question5: "¿Qué puedo exportar, y es una app terminada?",
        answer5:
          "Exporta HTML o un ZIP de los archivos de diseño, o prepara un traspaso para un agente de programación. El prototipo ofrece un punto de partida para el desarrollo; la lógica de la aplicación, las integraciones, las pruebas y el despliegue aún necesitan implementación y revisión. Las exportaciones HTML pueden usar recursos de tiempo de ejecución externos.",
      },
      s001: "Design captura de pantalla de la plantilla",
      // V4 landing page copy (2026-09-14) — hero through final CTA below.
      heroEyebrow: "Design",
      heroTitle: "Diseña prototipos interactivos con tu agente de IA",
      heroDescription:
        "Design es una herramienta de diseño y prototipado con IA gratuita y de código abierto para crear páginas e interfaces de producto con tu marca, con diseños que puedes editar tú mismo.",
      heroCta: "Diseña gratis",
      useCasesHeading: "¿Qué puedes hacer con Design?",
      useCasesBody:
        "Explora una página, un flujo de producto o una interfaz nueva antes de construirla. Dale a tu agente de IA el brief y los detalles que importan.",
      useCase1Title: "Explorar ideas de landing pages",
      useCase1Body:
        "Convierte un brief de campaña o de producto en un prototipo de landing page. Revisa el mensaje, el diseño y las llamadas a la acción con tu equipo.",
      useCase2Title: "Trabajar flujos de producto",
      useCase2Body:
        "Crea el prototipo de un flujo de onboarding, registro o checkout. Recorre los pasos y perfecciona la experiencia antes de comprometerte con la implementación.",
      useCase3Title: "Diseñar dashboards y herramientas internas",
      useCase3Body:
        "Convierte requisitos de flujo de trabajo en un dashboard o una interfaz de administración. Explora cómo las personas encontrarán información y completarán sus tareas diarias.",
      keyFeaturesEyebrow: "Funciones clave",
      keyFeaturesHeading:
        "Todo lo que necesitas para diseñar, prototipar y compartir",
      feature1Title: "Prototipos interactivos",
      feature1Body:
        "Describe la página o el flujo que necesitas. Tu agente de IA crea un prototipo HTML con interacciones que puedes probar en la vista previa.",
      feature2Title: "Edición con IA y visual",
      feature2Body:
        "Ajusta texto, espaciado y estilo con controles visuales, o pide a tu agente de IA que cambie el diseño y las interacciones.",
      feature3Title: "Variantes de diseño en paralelo",
      feature3Body:
        "Pide a tu agente de IA distintas direcciones de diseño. Compáralas en el lienzo, elige un enfoque y sigue perfeccionándolo.",
      feature4Title: "Estilos de marca reutilizables",
      feature4Body:
        "Vincula un sistema de diseño con tus colores, tipografía y estilo. Úsalo para guiar nuevos diseños y revisiones en todo tu proyecto.",
      feature5Title: "Comentarios de revisión de diseño",
      feature5Body:
        "Fija el feedback a un elemento concreto para que el contexto quede claro. Envía un comentario a tu agente de IA para trabajar el cambio.",
      feature6Title: "Exportación HTML y traspaso de código",
      feature6Body:
        "Exporta HTML o un ZIP de tus archivos de diseño. Dale a un desarrollador o a un agente de programación el prototipo y el contexto para continuar la implementación.",
      finalCtaHeading: "Empieza tu próximo diseño",
      finalCtaBody:
        "Trae un brief. Explora las posibilidades. Perfecciona los detalles.",
      finalCtaButton: "Diseña gratis",
      s002: "describir",
      s003: "generar",
      s004: "Refinar",
      s005: "Todas las plantillas",
      s006: "El estudio de creación de prototipos de código abierto AI HTML",
      s007: "Cree diseños y prototipos interactivos. Refine con herramientas familiares o realice ediciones conversacionales. Exporte a donde quiera.",
      s008: "Diseña algo",
      s009: "como funciona",
      s010: "Todo lo que necesitas",
      s011: "Un estudio prototipo con un agente que escribe y refina la fuente.",
      s012: "Prototipos HTML completos",
      s013: "Genere Alpine/Tailwind HTML autónomo que se represente en el iframe de vista previa y se pueda exportar directamente.",
      s014: "Generación de variantes",
      s015: "Comience desde varias direcciones, compárelas en la aplicación y siga perfeccionando el diseño más sólido.",
      s016: "Ajustar controles",
      s017: "Ajuste visualmente las variables de diseño comunes mientras el agente maneja cambios estructurales y de copia más importantes.",
      s018: "Ediciones conversacionales",
      s019: '"Haga que el título sea más llamativo", "pruebe con una paleta más cálida", "agregue un botón de CTA". El agente actualiza el HTML subyacente.',
      s020: "Design Sistemas",
      s021: "Guarde las preferencias del sistema de diseño reutilizables para que las nuevas generaciones se acerquen más al lenguaje de su producto.",
      s022: "Exportar a cualquier lugar",
      s023: "Exporte HTML, ZIP o PDF desde el prototipo generado cuando esté listo para compartirlo o entregarlo.",
      s024: "Vista previa del código fuente primero",
      s025: "La vista previa se representa desde el mismo HTML que edita el agente y utiliza la exportación, por lo que hay menos traducción entre el concepto y la transferencia.",
      s026: "Vista previa del iframe del prototipo generado",
      s027: "Artefactos HTML, ZIP y PDF exportables",
      s028: "Refinamiento conversacional",
      s029: "El agente edita la fuente del prototipo. Las instrucciones en inglés sencillo se convierten en cambios de copia, diseño, colores, espaciado e interacciones.",
      s030: '"Haz que esto parezca más premium"',
      s031: '"Pruebe una paleta de colores más oscura"',
      s032: '"Haz que el diseño del héroe sea más editorial"',
      s033: '"Genera tres variaciones de esto"',
      s034: "como se compara",
      s035: "Herramientas de maqueta estática",
      s036: "Generadores de un solo disparo",
      s037: "editor visual",
      s038: "Lo visual primero",
      s039: "Preguntar primero",
      s040: "Agente + vista previa + código",
      s041: "AI generación",
      s042: "Limitado/complementos",
      s043: "Mensaje de un solo disparo",
      s044: "Iterativo, conversacional",
      s045: "Salida editable",
      s046: "Archivo nativo de la herramienta",
      s047: "A menudo estático",
      s048: "Completar HTML/CSS/JS",
      s049: "Personalización",
      s050: "Solo complementos",
      s051: "Sólo aviso",
      s052: "Código fuente completo",
      s053: "Precios",
      s054: "Desde $15/mes por usuario",
      s055: "Créditos por imagen",
      s056: "Gratis y de código abierto",
      s057: "Comience en minutos",
      s058: "Empieza con la plantilla y comienza a generar prototipos interactivos con un agente que edita el código fuente.",
      s059: "Lea los documentos",
      s060: "Ver todas las plantillas",
      s061: "100 % gratis, de código abierto y personalizable.",
    },
    dispatch: {
      faq: {
        question1: "¿Qué es Agent-Native Dispatch?",
        answer1:
          "Agent-Native Dispatch es una app de orquestación de agentes de IA gratuita y de código abierto para un espacio de trabajo Agent-Native. Coordina solicitudes entre las apps conectadas, recibe mensajes de los canales admitidos, programa tareas recurrentes y gestiona integraciones compartidas.",
        question2: "¿Con qué apps puede trabajar Dispatch?",
        answer2:
          "Dispatch delega en las apps conectadas y disponibles en tu espacio de trabajo, como Analytics o Mail. Cada app gestiona sus propias tareas y datos. Configura las conexiones y los permisos correspondientes antes de pedirle a Dispatch que las use.",
        question3: "¿Puedo usar Dispatch desde Slack o Telegram?",
        answer3:
          "Sí. Configura el canal de mensajería y vincula tu identidad a tu cuenta del espacio de trabajo cuando sea necesario. Dispatch puede recibir solicitudes y devolver resultados a través de ese canal. Conectar un canal no le da automáticamente a cada remitente acceso a todas las apps.",
        question4: "¿Pueden los agentes ejecutar tareas según un horario?",
        answer4:
          "Sí. Configura una tarea recurrente y, si es necesario, un destino de entrega para sus resultados. Dispatch muestra la última ejecución, la próxima ejecución y el estado de error de la tarea para que puedas comprobar si se ejecutó correctamente.",
        question5:
          "¿Las aprobaciones de Dispatch cubren todo lo que hace un agente?",
        answer5:
          "No. En un espacio de trabajo de equipo, Dispatch puede exigir revisión de sus propios cambios en recursos y configuraciones compartidos. Las acciones dentro de las apps conectadas, como enviar un correo electrónico, siguen los controles de esas apps. La cola de aprobaciones de Dispatch no es una puerta universal para cada acción del agente.",
      },
      s001: "Dispatch captura de pantalla de la plantilla",
      // V3 landing page copy (2026-09-12) — hero through final CTA below.
      heroEyebrow: "Dispatch",
      heroTitle: "Coordina tus agentes de IA desde un solo lugar",
      heroDescription:
        "Dispatch es una app de orquestación de agentes de IA gratuita y de código abierto para delegar trabajo a las apps de Agent-Native conectadas, programar tareas recurrentes y gestionar conexiones compartidas.",
      heroCta: "Delega una tarea",
      useCasesHeading: "¿Qué puedes hacer con Dispatch?",
      useCasesBody:
        "Pide ayuda a una app conectada, configura una actualización periódica o investiga una ejecución de agente que necesite atención.",
      useCase1Title: "Delega trabajo desde una sola conversación",
      useCase1Body:
        "Pide un resumen de métricas o un borrador de respuesta. Dispatch pasa la solicitud al agente de Analytics o Mail conectado y devuelve el resultado.",
      useCase2Title: "Configura actualizaciones recurrentes para el equipo",
      useCase2Body:
        "Programa un resumen diario de métricas o un boletín semanal desde tus apps conectadas. Elige un canal o una bandeja de entrada configurados donde deba llegar el resultado.",
      useCase3Title: "Investiga la actividad de los agentes",
      useCase3Body:
        "Consulta la última ejecución de una tarea y sus posibles errores. Usa los hilos y los detalles de monitorización disponibles para investigar qué ocurrió cuando un flujo de trabajo necesita atención.",
      keyFeaturesEyebrow: "Funciones clave",
      keyFeaturesHeading:
        "Todo lo que necesitas para delegar, programar y monitorizar",
      feature1Title: "Delegación entre apps",
      feature1Body:
        "Envía solicitudes a la app conectada que se encarga del trabajo. Cada app usa su propio agente, sus acciones y sus datos para responder.",
      feature2Title: "Conexiones de mensajería",
      feature2Body:
        "Conecta canales como Slack o Telegram para enviar solicitudes y recibir respuestas. Vincula identidades para que Dispatch sepa qué usuario del espacio de trabajo está preguntando.",
      feature3Title: "Tareas programadas",
      feature3Body:
        "Asigna un horario al trabajo recurrente. Comprueba si una tarea está activada, cuándo se ejecutó por última vez, su próxima ejecución y cualquier error registrado.",
      feature4Title: "Destinos de entrega guardados",
      feature4Body:
        "Guarda un canal de Slack, un chat de Telegram o una dirección de correo electrónico como destino de entrega. Reutilízalo para los resultados programados y comprueba el estado de la entrega.",
      feature5Title: "Integraciones compartidas",
      feature5Body:
        "Configura una conexión de proveedor una sola vez y concede acceso a las apps que la necesiten. Gestiona las conexiones compartidas y el acceso a las apps desde Dispatch.",
      feature6Title: "Aprobaciones de cambios en el espacio de trabajo",
      feature6Body:
        "Exige que otro administrador revise los cambios de Dispatch en recursos y configuraciones compartidos. Revisa las solicitudes pendientes y apruébalas o recházalas en un espacio de trabajo de equipo.",
      finalCtaHeading: "Empieza con una tarea conectada",
      finalCtaBody:
        "Elige las apps que necesitas y pídele a Dispatch que coordine el trabajo.",
      finalCtaButton: "Delega una tarea",
      s002: "+ Telegram incluido",
      s003: "Interagente",
      s004: "Memoria",
      s005: "Tareas recurrentes",
      s006: "Todas las plantillas",
      s007: "La base de operaciones de su agente",
      s008: "Hable con su agente desde Slack, Telegram o cualquier mensajero y se dirigirá a sus otras aplicaciones. Trabajos, memoria, aprobaciones y delegación A2A, todo en un solo lugar.",
      s009: "Probar",
      s010: "que puedes hacer",
      s011: "Dispatch es la puerta de entrada al mensajero para toda su pila de agentes nativos.",
      s012: "Mensajería bidireccional con contexto de hilo, respuestas de Block Kit y aprobaciones en línea. Habla desde cualquier lugar.",
      s013: "Las rutas Dispatch funcionan con sus otras aplicaciones nativas del agente a través del protocolo A2A. Mail, diapositivas, diseño: todo accesible desde un solo chat.",
      s014: "Trabajos recurrentes",
      s015: "Programe el agente para que se ejecute en un cron: reuniones diarias, resúmenes semanales, comprobaciones cada hora. Los resultados llegan a tu messenger.",
      s016: "Aprobaciones",
      s017: "Controle las acciones sensibles detrás de una aprobación con un solo toque en Slack. Configure por acción: enviar correo electrónico, publicar actualizaciones, ejecutar automatización.",
      s018: "Memoria de agente persistente",
      s019: "Dispatch recuerda el contexto de conversaciones, hilos y canales. Dígale sus preferencias una vez: las llevará adelante.",
      s020: "Aprendizajes capturados automáticamente de cada conversación",
      s021: "Ámbitos de memoria por usuario, por organización y global",
      s022: "Inspeccionar y editar lo que recuerda el agente.",
      s023: "Enrutamiento entre aplicaciones",
      s024: "Dispatch es el centro. Conecte sus otras aplicaciones nativas del agente y cada solicitud se enruta al agente que puede hacer el trabajo.",
      s025: '"Enviar una baraja al equipo de diseño" → Slides agente',
      s026: '"Responder al último correo electrónico de ventas" → Mail agente',
      s027: '"Resumir los eventos de este trimestre" → Analytics agente',
      s028: "Habla con tu agente desde cualquier lugar",
      s029: 'Envíe un mensaje de texto a su agente en Slack a las 7 AM, haga un seguimiento desde Telegram en el tren, obtenga una respuesta de Block Kit con el botón "Abrir hilo" para acceder a la conversación completa.',
      s030: '"¿Qué hay en mi calendario mañana?"',
      s031: '"Crea un mazo para todos los Monday"',
      s032: '"Realiza mi stand-up matutino a las 9 AM todos los días laborables"',
      s033: '"Dime cuando finalice el despliegue"',
      s034: "como se compara",
      s035: "Cerrado AI Asistentes",
      s036: "Enrutamiento entre aplicaciones",
      s037: "Por robot",
      s038: "Producto único",
      s039: "Definido por el proveedor",
      s040: "Persistente, con alcance, inspeccionable",
      s041: "código personalizado",
      s042: "Limitado",
      s043: "Personalización",
      s044: "Plomería SDK",
      s045: "Cerrado",
      s046: "Código fuente completo",
      s047: "Precios",
      s048: "Tarifas por aplicación",
      s049: "Desde $20/mes por usuario",
      s050: "Gratis y de código abierto",
      s051: "Comience en minutos",
      s052: "Empiece con la plantilla, conecte Slack o Telegram y coloque a su agente en cada conversación.",
      s053: "Lea los documentos",
      s054: "Ver todas las plantillas",
    },
    forms: {
      faq: {
        question1: "¿Qué es Agent-Native Forms?",
        answer1:
          "Agent-Native Forms es un creador de formularios con IA gratuito y de código abierto. Crea formularios y encuestas con un agente de IA, edita los campos visualmente, publica un enlace público y revisa o analiza las respuestas en la misma app.",
        question2: "¿Puedo editar un formulario después de que la IA lo cree?",
        answer2:
          "Sí. Cambia preguntas, etiquetas, opciones, campos obligatorios y el orden de los campos en el editor visual, o pide a tu agente de IA que haga los cambios. Ambas formas actualizan el mismo formulario. También puedes añadir preguntas condicionales basadas en respuestas anteriores.",
        question3: "¿Necesita alguien una cuenta para rellenar mi formulario?",
        answer3:
          "No. Cualquiera con el enlace público de un formulario publicado puede enviar una respuesta sin cuenta. Los formularios en borrador no son públicos, y los formularios cerrados dejan de aceptar nuevas respuestas.",
        question4: "¿Puedo recopilar comentarios anónimos?",
        answer4:
          "Sí. Activa el modo anónimo para omitir la identidad de quien responde y los metadatos de origen. También puedes omitir preguntas que pidan nombres, correos electrónicos u otros datos identificativos si quieres que las respuestas sigan siendo anónimas.",
        question5: "¿Puedo enviar las respuestas a Google Sheets o Slack?",
        answer5:
          "Sí, después de configurar un destino para el formulario. Slack y Discord usan URLs de webhook. Google Sheets requiere un endpoint de Google Apps Script desplegado que reciba los envíos; un enlace de hoja de cálculo por sí solo no funciona. También puedes usar un webhook o exportar las respuestas como CSV. Las exportaciones del agente de todas las respuestas en CSV o JSON requieren almacenamiento de archivos conectado.",
      },
      s001: "Forms captura de pantalla de la plantilla",
      heroEyebrow: "Forms",
      heroTitle: "Crea formularios con tu agente de IA",
      heroDescription:
        "Forms es un creador de formularios con IA gratuito y de código abierto para crear encuestas, formularios de inscripción y formularios de solicitud, con preguntas que puedes editar tú mismo y respuestas que tu agente de IA puede ayudarte a analizar.",
      heroCta: "Crear un formulario",
      useCasesHeading: "¿Qué puedes hacer con Forms?",
      useCasesBody:
        "Recopila comentarios de clientes, inscribe a personas en un evento o reúne los detalles que tu equipo necesita para gestionar una solicitud.",
      useCase1Title: "Recopila comentarios de clientes",
      useCase1Body:
        "Pregunta a tus clientes sobre su experiencia con valoraciones, preguntas de opción múltiple y respuestas escritas. Pide a tu agente de IA que resuma los comentarios que recibes.",
      useCase2Title: "Reúne inscripciones y registros",
      useCase2Body:
        "Crea un formulario para un webinar, evento o lista de espera de producto. Recopila datos de contacto y preferencias, y luego revisa o exporta los envíos.",
      useCase3Title: "Recopila solicitudes de proyectos",
      useCase3Body:
        "Ofrece a las personas un formulario para solicitudes de diseño, briefs de proyecto o soporte interno. Pide plazos, requisitos y otros detalles que tu equipo necesite.",
      keyFeaturesEyebrow: "Funciones clave",
      keyFeaturesHeading:
        "Todo lo que necesitas para crear, compartir y revisar",
      feature1Title: "Generación de formularios con IA",
      feature1Body:
        "Describe lo que quieres recopilar y tu agente de IA construye el formulario. Pídele que añada preguntas o revise los campos existentes.",
      feature2Title: "Edición visual de campos",
      feature2Body:
        "Edita etiquetas, opciones, campos obligatorios y el orden de las preguntas tú mismo. Elige tipos de campo como texto, correo electrónico, opción múltiple, fechas, valoraciones y escalas.",
      feature3Title: "Preguntas condicionales",
      feature3Body:
        "Muestra una pregunta de seguimiento cuando una respuesta anterior cumple una regla. Pide más detalles cuando alguien selecciona «Otro», por ejemplo.",
      feature4Title: "Enlaces públicos del formulario",
      feature4Body:
        "Publica un formulario y comparte su enlace. Define un mensaje de finalización o una redirección, y cierra el formulario cuando dejes de aceptar respuestas.",
      feature5Title: "Estadísticas y exportación de respuestas",
      feature5Body:
        "Revisa los envíos en una tabla o pide a tu agente de IA resúmenes y tendencias de las respuestas. Descarga la tabla de respuestas como CSV.",
      feature6Title: "Integraciones de envío",
      feature6Body:
        "Configura el envío a Slack, Discord, Google Sheets o un webhook. Cada nueva respuesta llega al destino que hayas configurado para ese formulario.",
      finalCtaHeading: "Crea tu próximo formulario",
      finalCtaBody: "Dile a tu agente de IA qué quieres recopilar.",
      finalCtaButton: "Crear un formulario",
      s002: "describir",
      s003: "generar",
      s004: "Ruta",
      s005: "Todas las plantillas",
      s006Primary: "La alternativa de código abierto AI a",
      s006Secondary: "Typeform y Google Forms",
      s007: "Genere un formulario completo a partir de un mensaje, refine los campos de forma conversacional y dirija los envíos a Slack, Discord, Google Sheets o webhooks. Sea dueño de sus datos y de su flujo de trabajo, sin tarifas por respuesta.",
      s008: "Probar",
      s009: "como funciona",
      s010: "Todo lo que necesitas",
      s011: "Un generador de formularios completo con AI integrado.",
      s012: "Todos los tipos de campo",
      s013: "Texto, correo electrónico, número, texto largo, selección, selección múltiple, casilla de verificación, radio, fecha, calificación y escala.",
      s014: "Edición de campos visuales",
      s015: "Actualice etiquetas, marcadores de posición, opciones, estado requerido y orden de campos en el editor o preguntándoselo al agente.",
      s016: "Estilo personalizado",
      s017: 'Haga coincidir su marca: colores, fuentes, diseño. O simplemente pídale al agente que "haga que parezca nuestro sitio de marketing".',
      s018: "Integraciones de envío",
      s019: "Envíe envíos estructurados a Slack, Discord, Google Sheets o un webhook cuando llegue cada respuesta.",
      s020: "Páginas públicas para compartir",
      s021: "Cada formulario obtiene una URL pública con SEO completo. Insértelo en cualquier sitio o aloje en su propio dominio.",
      s022: "Panel de envíos",
      s023: "Tabla ordenable, filtros, exportación CSV y vistas detalladas por envío. Todos los datos residen en su base de datos SQL.",
      s024: "Edición visual + conversacional",
      s025: "Arrastre campos, edite etiquetas, establezca validación. O simplemente describa el cambio y el agente actualizará el mismo esquema de formulario.",
      s026: "Reordenación de campos con arrastrar y soltar",
      s027: "Vista previa en vivo junto al editor",
      s028: "Deshacer/rehacer con historial completo",
      s029: "Creación de formularios conversacionales",
      s030: "Evite la rutina campo por campo. Describe el formulario una vez y luego refine con un lenguaje sencillo.",
      s031: '"Crear un formulario de solicitud de empleo"',
      s032: '"Agregar un menú desplegable de nivel de experiencia requerido"',
      s033: '"Hacer que el campo de correo electrónico sea obligatorio"',
      s034: '"Publique cada envío en Slack"',
      s035: "como se compara",
      s036: "AI Generadores de formularios",
      s037: "editor visual",
      s038: "Sí, vinculado a plantilla",
      s039: "Limitado/ninguno",
      s040: "Visual + agente + código",
      s041: "AI generación",
      s042: "Ninguno/básico",
      s043: "De un solo disparo, rígido",
      s044: "Iterativo, conversacional",
      s045: "Integraciones de envío",
      s046: "manuales",
      s047: "Limitado",
      s048: "Propiedad de los datos",
      s049: "servidores del proveedor",
      s050: "Alojado por el proveedor",
      s051: "Su base de datos SQL",
      s052: "Precios",
      s053: "Tarifas por respuesta",
      s054: "Suscripción",
      s055: "Gratis y de código abierto",
      s056: "Comience en minutos",
      s057: "Empieza con la plantilla y comienza a recopilar envíos de tu propiedad.",
      s058: "Lea los documentos",
      s059: "Ver todas las plantillas",
    },
    mail: {
      faq: {
        question1: "¿Qué es Agent-Native Mail?",
        answer1:
          "Agent-Native Mail es un cliente de correo electrónico gratuito y de código abierto para Gmail con un asistente de correo con IA. Lee y busca mensajes, resume conversaciones, redacta respuestas y organiza el correo desde la bandeja de entrada o con tu agente de IA.",
        question2: "¿Mail funciona con mi cuenta de Gmail actual?",
        answer2:
          "Sí. Conecta tu cuenta de Gmail actual para leer y enviar correo a través de Mail. Puedes conectar varias cuentas de Gmail y buscar en todas ellas. Mail no ofrece una dirección de correo nueva, y por ahora es compatible con Gmail en lugar de Outlook u otros proveedores de correo.",
        question3: "¿El agente de IA enviará correos sin mi aprobación?",
        answer3:
          "Cuando le pides al agente de IA que envíe un correo en el chat, necesita tu aprobación. Los envíos activados por automatizaciones también requieren aprobación, salvo que actives explícitamente el envío automático en la configuración de Mail. Puedes revisar y editar los borradores antes de enviarlos.",
        question4:
          "¿Puede la IA organizar mi bandeja de entrada automáticamente?",
        answer4:
          "Sí. Crea reglas en lenguaje natural para etiquetar, archivar, destacar con estrella o marcar como leídos los mensajes entrantes. Mail también admite filtros nativos de Gmail para condiciones como el remitente o el asunto. Los filtros de Gmail se ejecutan en Gmail y siguen funcionando aunque Mail esté cerrado.",
        question5:
          "¿Puede un compañero de equipo preparar un correo para que yo lo revise?",
        answer5:
          "Sí. Un compañero de equipo puede solicitar un borrador que aparece en tu cola de revisión. Ábrelo, edita el mensaje y envíalo cuando esté listo. Quien lo solicitó no puede enviarlo en tu nombre; quien es propietario del borrador o un administrador de la organización controla el envío.",
      },
      s001: "Mail captura de pantalla de la plantilla",
      // V3 landing page copy (2026-09-10) — hero through final CTA below.
      heroEyebrow: "Mail",
      heroTitle: "Toma el control de tu bandeja de entrada con Jev",
      heroDescription:
        "Dile a Jev en lenguaje natural qué te importa. Mantendrá visibles los comentarios humanos de GitHub, destacará los mensajes de tu responsable y apartará las notificaciones de bots; después aprenderá de tus correcciones.",
      heroCta: "Gestiona tu bandeja de entrada",
      useCasesHeading: "Una bandeja más inteligente, impulsada por Jev",
      useCasesBody:
        "Crea una regla en lenguaje natural. Jev da prioridad a las personas y conversaciones importantes, aplica las etiquetas adecuadas y archiva el correo repetitivo cuando llega.",
      useCase1Title: "Conserva a las personas. Archiva los bots.",
      useCase1Body:
        "Dile a Jev qué importa: mantén visibles en Product los comentarios de personas en pull requests de GitHub, archiva las notificaciones de bots y mueve los correos de tu responsable a Important. Ajusta cada regla con un prompt y mejora el filtro de spam con tus comentarios.",
      useCase2Title: "Cada correo, con su etiqueta",
      useCase2Body:
        "Jev etiqueta las conversaciones por su significado, no solo por palabras clave, para que las notas de clientes, los recibos y la investigación lleguen al lugar adecuado.",
      useCase3Title: "Automatiza el trabajo rutinario",
      useCase3Body:
        "Establezca reglas para etiquetar o archivar correo nuevo en segundo plano y luego revise el historial de ejecución cuando lo desee.",
      keyFeaturesEyebrow: "Funciones clave",
      keyFeaturesHeading:
        "Todo lo que necesitas para leer, escribir y organizar el correo",
      feature1Title: "clasificación por prioridad",
      feature1Body:
        "Clasifique los hilos entrantes por urgencia y contexto, de modo que los plazos y las personas que esperan una respuesta lleguen a la cima.",
      feature2Title: "Etiquetas contextuales de IA",
      feature2Body:
        "Clasifique los mensajes según el tema de la conversación y luego mantenga agrupados los correos similares a medida que llegan.",
      feature3Title: "Bandeja de entrada controlada por agentes",
      feature3Body:
        "Pídale al agente que busque, resuma, etiquete, archive, destaque o prepare una respuesta desde la bandeja de entrada que está viendo.",
      feature4Title: "Automatizaciones en segundo plano",
      feature4Body:
        "Aplique reglas en lenguaje sencillo a los mensajes entrantes e inspeccione las acciones que ha tomado Mail.",
      feature5Title: "Revisar antes de enviar",
      feature5Body:
        "Haga que el agente redacte o revise una respuesta, luego revísela y edítela antes de que salga de su bandeja de entrada.",
      feature6Title: "Un filtro de spam que aprende",
      feature6Body:
        "Marca como deseado un mensaje filtrado o señala el correo no deseado. Jev aprende de cada corrección y la aplica a mensajes similares.",
      finalCtaHeading: "Empieza con tu próximo correo",
      finalCtaBody:
        "Abre una conversación y pídele a tu agente de IA un resumen o un borrador de respuesta.",
      finalCtaButton: "Gestiona tu bandeja de entrada",
      s002: "Teclado primero",
      s003: "Clasificación de bandeja de entrada",
      s004: "Vistas",
      s005: "Personalizable",
      s006: "Todas las plantillas",
      s007Primary: "La alternativa de código abierto a",
      s007Secondary: "Superhuman y Gmail",
      s008: "Probar",
      s009: "La demostración alojada utiliza la aplicación Google compartida de Agent-Native para el acceso de Gmail, por lo que Google puede pedirle que confirme antes de continuar. Ejecútelo localmente para utilizar su propio cliente Google OAuth.",
      s010: "que puedes hacer",
      s011: "Todo lo que necesitas para reemplazar tu cliente de correo electrónico con una bandeja de entrada con tecnología AI de tu propiedad.",
      s012: "Atajos de teclado",
      s013: "AI Triaje",
      s014: "El agente lee su bandeja de entrada, muestra lo que importa, redacta respuestas y maneja los correos electrónicos de rutina automáticamente. Configure automatizaciones para el etiquetado y el archivado automáticos.",
      s015: "Búsqueda inteligente",
      s016: 'Búsqueda en lenguaje natural en toda tu bandeja de entrada. Los "correos electrónicos de la semana pasada sobre el presupuesto" simplemente funcionan.',
      s017: "Superación personal",
      s018: "El agente modifica la propia aplicación. ¿Necesita una carpeta, un filtro o una automatización personalizados? Sólo pregunta.",
      s019: "AI-Gestión de bandeja de entrada potenciada",
      s020: "Deje que el agente haga el trabajo pesado: clasificar, etiquetar, archivar y redactar respuestas a partir de instrucciones en lenguaje natural.",
      s021: "Etiquetado automático, clasificación por prioridad y reglas de archivo automático",
      s022: "AI-respuestas redactadas para mensajes de rutina",
      s023: "Resumen de hilos y elementos de acción",
      s024: "Redactar primero con el teclado",
      s025: "Escribe y envía correos electrónicos a la velocidad del pensamiento. Navegación completa con el teclado, atajos estilo Notion y dibujo asistido por AI.",
      s026: "Múltiples pestañas de borrador para redactar varios correos electrónicos a la vez",
      s027: "AI expande borradores cortos a correos electrónicos completos",
      s028: "Enviar recordatorios más tarde, posponer y hacer seguimiento",
      s029: "Flujos de trabajo de correo electrónico impulsados por agentes",
      s030: "El agente lee, redacta y organiza su correo electrónico a través del lenguaje natural. Cada flujo de trabajo es un script que puede inspeccionar y ampliar.",
      s031: '"Resumir mis correos electrónicos no leídos de esta semana"',
      s032: '"Redactar una respuesta al hilo de actualización para inversores"',
      s033: '"Archivar todos los boletines de más de 7 días"',
      s034: '"Encuentra todos los correos electrónicos que esperan una respuesta mía"',
      s035: "como se compara",
      s036: "Atajos de teclado",
      s037: "Básico",
      s038: "Excelente",
      s039: "Totalmente personalizable",
      s040: "AI asistencia",
      s041: "Redacción inteligente",
      s042: "AI responde",
      s043: "Agente completo: selección, reclutamiento, automatización",
      s044: "Personalización",
      s045: "Sólo ajustes",
      s046: "Solo temas",
      s047: "Código fuente completo",
      s048: "Propiedad de los datos",
      s049: "Servidores de Google",
      s050: "Alojado por el proveedor",
      s051: "Eres dueño del código",
      s052: "Precios",
      s053: "Libre / Espacio de trabajo",
      s054: "$30/mes por usuario",
      s055: "Gratis y de código abierto",
      s056: "Comience en minutos",
      s057: "Empieza con la plantilla, conecta tu proveedor de correo electrónico y comienza a administrar tu bandeja de entrada con AI.",
      s058: "Lea los documentos",
      s059: "Ver todas las plantillas",
      s060: "Nota de la demo alojada",
    },
    plan: {
      faq: {
        question1: "¿Qué es Agent-Native Plans?",
        answer1:
          "Agent-Native Plans es una herramienta de planificación visual gratuita y de código abierto para agentes de código. Revisa planes de implementación con diagramas, wireframes, código anotado y comentarios, o genera recapitulaciones visuales de cambios ya realizados.",
        question2: "¿Cómo uso Plans con mi agente de código?",
        answer2:
          "Instala las skills de planificación y el conector con `npx @agent-native/core@latest skills add visual-plan`, y completa el paso de autenticación de tu cliente. La guía de instalación cubre clientes como Claude Code y Codex. Usa `/visual-plan` para pedirle a tu agente un plan de implementación visual.",
        question3:
          "¿Puede mi agente actualizar un plan a partir de mis comentarios?",
        answer3:
          "Sí. Deja comentarios en el texto o fíjalos a un elemento visual, y pídele a tu agente que los lea y los resuelva. Puede actualizar el plan y responder en los hilos de revisión. Esto respalda tu proceso de revisión, pero no impide automáticamente que el agente cambie código.",
        question4: "¿Puedo usar Plans para revisar código que ya está escrito?",
        answer4:
          "Sí. Usa `/visual-recap` con un pull request, un commit, una branch o un diff para obtener una explicación visual del cambio. Usa la recapitulación para guiar tu revisión del código y los tests reales.",
        question5: "¿Dónde se guardan los planes, y puedo compartirlos?",
        answer5:
          "La instalación predeterminada conecta tu agente con la app Plans alojada. Los planes alojados nuevos son privados hasta que los compartes. Tu equipo puede revisar los planes compartidos en el navegador; comentar requiere una cuenta. También hay flujos de trabajo locales disponibles en la guía de configuración.",
      },
      s001: "Plans captura de pantalla de la app",
      heroEyebrow: "Plans",
      heroTitle: "Mira qué planea construir tu agente de código",
      heroDescription:
        "Plans es una herramienta de planificación visual gratuita y de código abierto para revisar el enfoque de tu agente de código, darle comentarios y entender los cambios de código mediante diagramas, wireframes y código anotado.",
      heroCta: "Planifica visualmente",
      heroSecondaryCta: "Abrir Plans",
      useCasesHeading: "¿Qué puedes hacer con Plans?",
      useCasesBody:
        "Revisa un enfoque de implementación, perfecciona una interfaz o entiende un cambio ya realizado junto a tu agente de código.",
      useCase1Title: "Revisa la arquitectura antes de implementar",
      useCase1Body:
        "Pídele a tu agente de código que diagrame una función o refactorización propuesta. Revisa el flujo de datos, las dependencias y los posibles puntos de fallo antes de que empiece a cambiar código.",
      useCase2Title: "Perfecciona los cambios de interfaz",
      useCase2Body:
        "Revisa las pantallas y los flujos de usuario propuestos junto a tu agente de código. Señala los estados o interacciones que falten y pídele que actualice el plan.",
      useCase3Title: "Entiende los cambios de código ya realizados",
      useCase3Body:
        "Pídele a tu agente de código una recapitulación visual de un pull request, un commit o una branch. Revisa los cambios de comportamiento y los archivos afectados.",
      keyFeaturesEyebrow: "Funciones clave",
      keyFeaturesHeading:
        "Todo lo que necesitas para visualizar, revisar y comentar",
      feature1Title: "Diagramas de arquitectura",
      feature1Body:
        "Muestra flujos de solicitudes, relaciones entre sistemas y modelos de datos dentro de un plan. Pídele a tu agente de código que actualice los diagramas a medida que cambie el enfoque.",
      feature2Title: "Wireframes y prototipos",
      feature2Body:
        "Revisa los diseños de pantalla y las opciones de prototipo interactivo junto al plan de implementación. Comenta la interfaz propuesta antes de pedirle a tu agente que la construya.",
      feature3Title: "Recorridos de código anotado",
      feature3Body:
        "Lee archivos fuente con notas línea por línea y explicaciones de los cambios. Usa árboles de archivos para ver dónde encaja el trabajo propuesto dentro del código base.",
      feature4Title: "Comentarios y anotaciones",
      feature4Body:
        "Comenta el texto o fija anotaciones en un punto concreto de un elemento visual. Dirige tus preguntas a tu agente o a un compañero de equipo.",
      feature5Title: "Recapitulaciones visuales de código",
      feature5Body:
        "Usa `/visual-recap` para convertir un pull request, un commit, una branch o un diff existente en un recorrido con diagramas y explicaciones de los cambios.",
      feature6Title: "Compartir y exportar",
      feature6Body:
        "Comparte un plan para que tu equipo lo revise en el navegador. Expórtalo como HTML, Markdown, JSON o MDX cuando necesites una copia aparte.",
      finalCtaHeading: "Revisa visualmente tu próxima tarea de código",
      finalCtaBody: "Pídele un plan a tu agente y revisa los detalles juntos.",
      finalCtaButton: "Planifica visualmente",
    },
    slides: {
      faq: {
        question1: "¿Qué es Agent-Native Slides?",
        answer1:
          "Agent-Native Slides es un creador de presentaciones de IA gratuito y de código abierto. Crea decks con tu marca a partir de tus ideas y material de referencia con un agente de IA, luego edita las diapositivas tú mismo, preséntalas o expórtalas a PowerPoint.",
        question2:
          "¿Puedo editar las diapositivas después de que la IA las genere?",
        answer2:
          "Sí. Edita texto, diseño y estilo directamente en el editor visual, o pide al agente de IA que revise una diapositiva seleccionada. Puedes seguir puliendo la presentación después del primer borrador.",
        question3:
          "¿Puedo crear una presentación a partir de un deck o documento ya existente?",
        answer3:
          "Sí. Adjunta un deck o documento como material de referencia para una nueva presentación. Para trabajar directamente sobre el deck existente, impórtalo de forma explícita. Revisa las diapositivas importadas por si hay cambios de diseño o imágenes que faltan.",
        question4:
          "¿Puedo usar mis propios colores de marca, fuentes y logotipo?",
        answer4:
          "Sí. Aplica un sistema de diseño con los colores, la tipografía y los logotipos de tu marca, y reutilízalo en varios decks. También puedes aportar una presentación de referencia para guiar las decisiones de diseño del agente de IA.",
        question5: "¿Puedo usar mi presentación en PowerPoint o Google Slides?",
        answer5:
          "Exporta un archivo PPTX para abrirlo en PowerPoint. Para usar la presentación en Google Slides, impórtalo allí. Revisa las fuentes y los diseños después de exportar, porque pueden renderizarse de forma distinta entre editores.",
      },
      s001: "Slides captura de pantalla de la plantilla",
      // V4 landing page copy (2026-09-11) — hero through final CTA below.
      heroEyebrow: "Slides",
      heroTitle: "Crea presentaciones con tu agente de IA",
      heroDescription:
        "Slides es un creador de presentaciones de IA gratuito y de código abierto para crear decks con tu marca a partir de tus ideas y material de referencia, con diapositivas que puedes editar tú mismo.",
      heroCta: "Crear un deck",
      useCasesHeading: "¿Qué puedes hacer con Slides?",
      useCasesBody:
        "Prepara un pitch, presenta un plan o comparte una actualización. Dale a tu agente de IA el material y el público que tienes en mente.",
      useCase1Title: "Crear presentaciones de ventas y pitch",
      useCase1Body:
        "Convierte el brief de tu producto en un deck para clientes potenciales o inversores. Adapta el mensaje al público ante el que vas a presentar.",
      useCase2Title: "Presentar planes y estrategias",
      useCase2Body:
        "Dale a tu agente de IA un brief de estrategia o un plan de lanzamiento para convertirlo en diapositivas que expliquen la dirección y los próximos pasos propuestos.",
      useCase3Title: "Compartir actualizaciones del negocio",
      useCase3Body:
        "Convierte notas de proyecto o informes de rendimiento en una presentación que muestre el progreso, explique los resultados y destaque lo que necesita atención.",
      keyFeaturesEyebrow: "Funciones clave",
      keyFeaturesHeading:
        "Todo lo que necesitas para crear, editar y presentar",
      feature1Title: "Generación de presentaciones con IA",
      feature1Body:
        "Empieza con un prompt, un documento o un deck de referencia. Dale a tu agente de IA el tema y el público para construir la presentación en torno a ellos.",
      feature2Title: "Edición con IA y visual",
      feature2Body:
        "Selecciona texto para que tu agente de IA lo revise, o edita tú mismo el texto, el diseño y el estilo directamente en la diapositiva.",
      feature3Title: "Estilos de marca reutilizables",
      feature3Body:
        "Guarda tus colores, fuentes y logotipos en un sistema de diseño. Aplícalo en varios decks para mantener las presentaciones coherentes con tu marca.",
      feature4Title: "Imágenes y logotipos",
      feature4Body:
        "Pide a tu agente de IA que genere imágenes, busque fotos o localice logotipos de empresas para usar en tus diapositivas.",
      feature5Title: "Colaboración en equipo",
      feature5Body:
        "Trabaja en los decks con tu equipo, deja comentarios en diapositivas concretas y restaura una versión anterior cuando lo necesites.",
      feature6Title: "Presentación y exportación",
      feature6Body:
        "Presenta a pantalla completa con notas del orador, comparte un enlace de visualización o exporta tu deck como archivo de PowerPoint.",
      finalCtaHeading: "Empieza tu próxima presentación",
      finalCtaBody: "Trae una idea, un brief o un deck ya existente.",
      finalCtaButton: "Crear un deck",
      s002: "describir",
      s003: "generar",
      s004: "Refinar",
      s005: "Todas las plantillas",
      s006Primary: "Presentaciones de diapositivas",
      s006Secondary: "Con tu marca y editables",
      s007: "Genera presentaciones con tu marca desde tu agente de IA, edita luego las diapositivas tú mismo y expórtalas donde quieras.",
      s008: "Probar",
      s009: "como funciona",
      s010: "Todo lo que necesitas",
      s011: "Un estudio de presentación completo con AI integrado.",
      s012: "Diseños de diapositivas prediseñados",
      s013: "Usa nuestras plantillas de diapositivas iniciales. Crea y reutiliza tus propias plantillas para más adelante.",
      s014: "Edición visual + de código",
      s015: "Haga clic para editar estilos, haga doble clic para ver texto. Cambie a HTML sin formato para obtener control total.",
      s016: "Generación de imágenes sin fricciones",
      s017: "Toma como referencia estilos y guías de marca. Elige entre las opciones generadas por Gemini AI.",
      s018: "Búsqueda de logotipos e imágenes",
      s019: "Busque logotipos de empresas a través de Logo.dev o Brandfetch. Google Imágenes para fotografías de archivo.",
      s020: "Arrastrar y soltar reordenamiento",
      s021: "Reordena las diapositivas en la barra lateral. Duplicar o eliminar con acciones de desplazamiento.",
      s022: "Modo de presentación",
      s023: "Pantalla completa con navegación por teclado, controles que se ocultan automáticamente y notas del orador.",
      s024: "Compartir y colaborar",
      s025: "Genere enlaces para compartir para acceso a presentaciones de solo lectura. Historial completo de deshacer/rehacer con entradas etiquetadas.",
      s026: "Compartir enlaces con acceso de solo lectura",
      s027: "Cmd+Z deshacer/rehacer con historial completo",
      s028: "Navega a cualquier punto de la historia.",
      s029: "Refinamiento conversacional",
      s030: "El agente edita las diapositivas directamente y UI se actualiza mediante sincronización de sondeo.",
      s031: '"Agranda el título"',
      s032: '"Agregue un gráfico en la diapositiva 3"',
      s033: '"Cambia el esquema de color a azul"',
      s034: '"Agregar notas del orador para la diapositiva 5"',
      s035: "como se compara",
      s036: "AI Generadores de diapositivas",
      s037: "editor visual",
      s038: "Sí, vinculado a plantilla",
      s039: "Limitado/ninguno",
      s040: "Visual + código + agente",
      s041: "AI generación",
      s042: "Básico/ninguno",
      s043: "De un solo disparo, rígido",
      s044: "Iterativo, conversacional",
      s045: "Generación de imágenes",
      s046: "Básico",
      s047: "Personalización",
      s048: "Solo temas",
      s049: "Sólo aviso",
      s050: "Código fuente completo",
      s051: "Precios",
      s052: "Gratis / por asiento",
      s053: "Suscripción",
      s054: "Gratis y de código abierto",
      s055: "Crea una presentación ahora",
      s056: "Elige tus preferencias de diseño y escribe un prompt para empezar. Siempre gratis.",
      s057: "Lea los documentos",
      s058: "Ver todas las plantillas",
      howItWorksDescribe:
        "Describe tu tema, audiencia y tono. Adjunta una presentación de referencia. Empieza en la interfaz o desde tu propio flujo de trabajo de IA.",
      signInIntegration:
        "Inicia sesión para acceder a Slides mediante una integración por webhook, MCP o A2A.",
      signIn: "Iniciar sesión",
      tryNow: {
        step: "Paso {{current}} de {{total}}",
        q1: "¿Qué tipo de presentación necesitas?",
        q1Pitch: "Pitch deck para inversores",
        q1Sales: "Presentación de ventas para clientes",
        q1Talk: "Apoyo para una charla o clase en vivo",
        q1Other: "Otra cosa",
        q1OtherPlaceholder: "Describe el tipo de presentación",
        q2Pitch: "¿Cuál es la empresa y la ronda de financiación?",
        q2Sales: "¿Qué vendes y a quién?",
        q2Talk: "¿De qué trata la charla y quién está en la sala?",
        q2Other: "¿Qué debería cubrir la presentación?",
        q2Detail:
          "Escribe unas notas o dame simplemente la URL de un sitio web",
        q2Placeholder: "Notas, o https://example.com",
        q3: "Dame un estilo a seguir",
        q3Detail:
          "Pega un sitio web para replicar su estilo, o elige un ambiente en su lugar",
        q3Placeholder: "https://example.com",
        q3VibeToggle: "¿No tienes sitio web? Elige un ambiente",
        q3VibeMinimal: "Minimalista y editorial",
        q3VibeBold: "Audaz y de alto contraste",
        q3VibeWarm: "Cálido y humano",
        q3VibeTechnical: "Técnico y con muchos datos",
        answerAction: "Añadir al prompt",
        composerLabel: "Tu prompt",
        composerPlaceholder:
          "Describe la presentación que quieres, o responde a las preguntas de arriba.",
        promptTip: "Consejo para el prompt",
        promptPlaceholder:
          "Sea específico. Diga para quién es, pegue sus notas o haga referencia a un diseño de sitio web...",
        submit: "Generar mi presentación",
        readyHint: "Tu prompt está listo: envíalo al agente.",
        promptDeck: "Crea {{deck}}.",
        promptSubject: "Esto es lo que debería cubrir: {{subject}}",
        promptStyleSite: "Replica la estética y el estilo de {{style}}.",
        promptStyleVibe: "Estilo: {{style}}.",
        promptClose:
          "Redacta la presentación completa con notas del orador y luego repasa el esquema conmigo.",
        deckPitch: "un pitch deck para inversores",
        deckSales: "una presentación de ventas para clientes",
        deckTalk: "una presentación de apoyo para una charla en vivo",
        designReference: "Referencia de diseño",
        websiteUrl: "URL del sitio web",
        websiteUrlPlaceholder: "https://example.com",
        crawlWebsite: "Inspeccionar sitio web",
        crawlError:
          "No pudimos inspeccionar este sitio. Es posible que bloquee el acceso automatizado. Prueba con otra URL o sube una referencia de diseño.",
        or: "o",
        uploadDesignReference: "Subir referencia de diseño",
        importDesignSystem: "Importar sistema de diseño",
        loginDesignSystems:
          "Inicia sesión para gestionar los sistemas de diseño.",
        promptCreatePrefix: "Crea una presentación de",
        deckTypeLabel: "Tipo de presentación",
        deckCapitalRaise: "captación de capital",
        deckOfferingMemorandum: "memorando de oferta",
        deckB2bSales: "ventas B2B",
        deckTeamMeeting: "agenda de reunión de equipo",
        deckLiveTalk: "apoyo para una charla en directo",
        promptDeckFor: "para",
        promptTextShouldBe: "El texto debe ser",
        textAmountLabel: "Cantidad de texto",
        textMinimal: "mínimo",
        textBrief: "breve",
        textThorough: "detallado",
        findingTitle: "título",
        findingDescription: "descripción",
        findingColors: "colores",
        findingFonts: "fuentes",
        findingPrimaryColor: "color principal",
        findingAccentColor: "color de acento",
        findingHeadingFont: "fuente de los encabezados",
        findingBodyFont: "fuente del cuerpo",
        styleGuidePrefix: "Guía de estilo para",
      },
    },
  },
  skillsPage: {
    metaTitle:
      "Skills de agente - Visual Plan, Visual Recap y Visual Edit para agentes de codigo",
    metaDescription:
      "Instala skills respaldadas por apps Agent-Native para que tu agente de codigo cree planes visuales, recapitulaciones de PR y edicion visual local.",
    metaOgDescription:
      "Dale a tu agente de codigo comandos slash impulsados por apps Agent-Native que puedes alojar, inspeccionar y personalizar.",
    metaKeywords:
      "skills de agente, visual plan, visual recap, visual edit, agente de codigo, Claude Code, Codex, revision de PR, planificacion, agent-native",
    heroTitle: "Dale nuevos superpoderes a tu agente de codigo",
    heroBody:
      "Instala skills respaldadas por apps Agent-Native que puedes personalizar por completo: planificacion visual antes de implementar, recapitulaciones visuales de PR despues de los cambios y edicion visual de flujos UI locales.",
    sectionTitle: "Skills respaldadas por apps para agentes de codigo",
    sectionBody:
      "Usa enlaces de apps alojadas y compartibles, archivos locales o una app autohospedada/personalizada; tu agente recibe instrucciones y la superficie MCP correspondiente cuando hace falta.",
    ctaBody:
      "Funciona con Claude Code, Codex, Cursor, Pi, OpenCode, GitHub Copilot / VS Code y agentes de codigo similares.",
    readVisualPlansDocs: "Leer la documentacion de Visual Plans",
    browseTemplates: "Explorar plantillas",
    visualPlan: {
      name: "Plan visual",
      tagline: "Revisa antes del codigo",
      description:
        "Convierte una tarea de codigo en un plan compartible con diagramas, notas de archivos y bocetos de UI opcionales.",
      feature1:
        "Ve la forma de la implementacion antes de que aterricen los cambios",
      feature2: "Comenta, revisa, aprueba o entrega",
      videoAriaLabel: "Video de demostracion de la skill Visual Plan",
    },
    visualRecap: {
      name: "Resumen visual",
      tagline: "Revisa despues de los cambios",
      description:
        "Convierte un PR o git diff en una recapitulacion compartible de que cambio y por que.",
      feature1: "Resume cambios de schema, API y archivos",
      feature2: "Opcionalmente publica un comentario fijo en el PR",
      videoAriaLabel: "Video de demostracion de la skill Visual Recap",
    },
    visualEdit: {
      name: "Edicion visual",
      tagline: "Edita flujos UI locales",
      description:
        "Abre una app localhost en ejecucion dentro de Design como pantallas respaldadas por URL para revision y edicion visual.",
      feature1: "Coloca flujos multipantalla desde URLs ordenadas",
      feature2: "Inspecciona, duplica y refina estados de rutas en vivo",
      videoAriaLabel: "Video de demostracion de la skill Visual Edit",
    },
  },
  downloadPage: {
    title: "Descargar Agent-Native",
    body: "Prueba apps agénticas para reuniones, diseño, presentaciones, datos, programación, correo y más, todo en una sola app de escritorio.",
    openDesktop: "Abrir Agent-Native",
    downloadInstaller: "Descargar instalador",
    downloadStarted: "Descarga iniciada",
    downloadAgain: "¿No funcionó? Intenta descargar de nuevo",
    loadError: "No se pudo cargar el instalador de escritorio más reciente.",
    checkingRelease: "Buscando la versión de escritorio más reciente...",
    retry: "Reintentar",
    unavailable: "Instalador no disponible para esta plataforma",
    allPlatforms: "Todas las plataformas",
    stable: "Estable",
    nightly: "Nightly",
    runFromSource: "Crea el tuyo",
    runFromSourceBody:
      "Crea una app de Agent-Native desde la línea de comandos y ejecútala localmente en macOS, Windows o Linux.",
    platforms: {
      mac: {
        primary: "Descargar para Apple Silicon",
        alternative: "Mac Intel",
        gridPrimary: "Apple Silicon",
        gridAlternative: "Intel",
      },
      windows: {
        primary: "Descargar para Windows",
        alternative: "ARM64",
        gridPrimary: "Instalador x64",
        gridAlternative: "Instalador Arm64",
        note: "Windows 10 o posterior.",
      },
      linux: {
        primary: "Descargar archivo de Linux",
        appImage: "Descargar AppImage",
        deb: "Descargar .deb",
        gridPrimary: "x86_64",
        gridAppImage: "Universal",
        gridDeb: "Debian / Ubuntu",
        note: "El archivo comprimido funciona sin FUSE. AppImage puede requerir FUSE 2 en algunas distribuciones.",
      },
    },
  },
  brandPage: {
    eyebrow: "Recursos de marca",
    title: "Logotipos de Agent-Native",
    body: "Descarga los logotipos y símbolos oficiales para artículos, presentaciones y proyectos de la comunidad. Los archivos SVG se mantienen nítidos a cualquier tamaño y admiten fondos transparentes.",
    horizontal: {
      title: "Logotipo horizontal",
      body: "La composición recomendada para cabeceras de artículos, sitios web, presentaciones y otros formatos anchos.",
    },
    symbol: {
      title: "Símbolo",
      body: "Usa el símbolo independiente para avatares, iconos de aplicaciones y espacios compactos.",
    },
    lightBackground: "Para fondos claros",
    darkBackground: "Para fondos oscuros",
    downloadSvg: "Descargar SVG",
    usage: {
      title: "Uso de la marca",
      clear: {
        title: "Mantén la claridad",
        body: "Conserva las proporciones del logotipo y deja suficiente espacio libre a su alrededor.",
      },
      contrast: {
        title: "Elige el contraste adecuado",
        body: "Usa la versión oscura sobre fondos claros y la versión clara sobre fondos oscuros.",
      },
      original: {
        title: "Usa el diseño original",
        body: "No cambies el color, recortes, gires, estires ni reorganices el logotipo o el símbolo.",
      },
    },
  },
  legal: {
    lastUpdated: "Última actualización: {{date}}",
    resources: {
      eyebrow: "Recursos legales",
      title: "Recursos legales de Agent-Native",
      intro:
        "Políticas legales independientes de Agent-Native para aplicaciones y servicios alojados.",
      agentNative: {
        title: "Políticas de Agent-Native",
        body: "Estas páginas adaptan el marco de políticas compartido al proyecto de código abierto y a los ejemplos alojados de Agent-Native.",
        terms: "Términos de servicio de Agent-Native",
        privacy: "Política de privacidad de Agent-Native",
      },
      builder: {
        title: "Políticas adicionales del servicio alojado",
        body: "Estas copias locales cubren el uso aceptable, las funciones de IA, las reglas de la plataforma, la suspensión y retirada, los derechos de autor y las solicitudes de las autoridades. Prevalece la versión en inglés.",
      },
      links: {
        terms: "Acuerdo de servicios SaaS",
        privacy: "Política de privacidad",
        acceptableUse: "Política de uso aceptable",
        aiTerms: "Términos de IA",
        platformRules: "Reglas de la plataforma",
        takedown: "Política de suspensión, retirada y gestión de datos",
        lawEnforcement: "Política para solicitudes de las fuerzas del orden",
      },
      notIncluded: {
        title: "Términos comerciales no incluidos",
        body: "Agent-Native no tiene planes de pago ni contratos empresariales. No se incluyen materiales comerciales como SLA empresariales, condiciones de soporte, DPA, adendas de seguridad, servicios profesionales ni tarifas.",
      },
    },
    privacy: {
      eyebrow: "Política de privacidad",
      title: "Agent-Native aplicaciones alojadas",
      intro:
        "Esta política explica cómo Builder.io recopila, usa, comparte y retiene datos cuando opera aplicaciones alojadas, plantillas alojadas, demostraciones y extensiones oficiales del navegador de Agent-Native.",
      scopeCards: {
        hosted: {
          title: "Aplicaciones alojadas",
          body: "Cubierto cuando Builder.io opera el servicio Agent-Native o la plantilla alojada para usted.",
        },
        openSource: {
          title: "Código abierto",
          body: "No se cubre el uso del código fuente con licencia MIT.",
        },
        selfHosted: {
          title: "Autohospedado",
          body: "No está cubierto para bifurcaciones, personalizaciones o implementaciones operadas por otra persona.",
        },
      },
      sections: {
        scope: "Alcance",
        information: "Información que recopilamos",
        cookies: "Cookies y analítica",
        clipsExtension: "Extensión de Chrome Agent-Native Clips",
        use: "Cómo utilizamos la información",
        sharing: "Compartir y terceros",
        chromeLimitedUse: "Chrome Web Store uso limitado",
        retention: "Retención y eliminación",
        security: "Seguridad",
        changes: "Cambios y contacto",
      },
      paragraphs: {
        scope1:
          "Agent-Native es de código abierto y el código fuente está disponible bajo la licencia MIT. Esta política se aplica únicamente a aplicaciones alojadas y servicios operados por Builder.io para usuarios de Agent-Native. No se aplica al uso del código por parte de otra persona, incluidas bifurcaciones, plantillas personalizadas, implementaciones privadas o versiones autohospedadas. Si opera su propia implementación, es responsable de sus propias prácticas de datos y política de privacidad.",
        scope2Prefix:
          "Esta política está destinada a complementar la política más amplia de Builder.io.",
        scope2Suffix:
          "para el comportamiento de la aplicación alojada Agent-Native.",
        cookies:
          "El sitio de documentación y las aplicaciones alojadas de Agent-Native pueden usar cookies necesarias para autenticación y seguridad, guardar preferencias como el idioma o el tema, y tecnologías analíticas configuradas. El sitio de documentación puede cargar Google Analytics o Google Tag Manager cuando la implementación los configura, y el servicio alojado puede usar analítica propia para medir la fiabilidad y el uso de funciones. No usamos el contenido de las aplicaciones alojadas para publicidad de terceros. Puedes controlar las cookies desde la configuración del navegador, aunque desactivar las necesarias puede impedir el inicio de sesión u otras funciones.",
        clips1:
          "Agent-Native Clips Chrome extension le ayuda a iniciar grabaciones basadas en navegador y, cuando está habilitado, adjuntar diagnósticos del navegador a un clip. Puede recopilar la fuente de captura seleccionada, la cámara y el micrófono que elija incluir, el título de la pestaña activa y la URL, y el estado de autenticación necesario para conectar la extensión al Clips alojado.",
        clips2:
          "Los registros de desarrollador son opcionales. Cuando está habilitada, la extensión puede recopilar mensajes de consola redactados, excepciones JavaScript y recuperar metadatos/XHR como método, URL, estado, tiempo y detalles de falla de la pestaña seleccionada mientras una grabación está activa. La extensión no está diseñada para recopilar cuerpos de solicitud, cuerpos de respuesta, cookies o encabezados de autorización.",
        clipsAnchor:
          "Para divulgaciones Chrome Web Store, utilice esta sección como ancla de extensión de la política de privacidad:",
        sharing1:
          "No vendemos datos de aplicaciones alojadas Agent-Native ni los utilizamos para publicidad de terceros. Compartimos datos con proveedores de servicios que ayudan a operar el servicio alojado, como infraestructura en la nube, almacenamiento, autenticación, correo electrónico, observabilidad, AI y proveedores de transcripción, cuando esos servicios son necesarios para la función que utiliza.",
        sharing2:
          "Cuando conecta una integración, la aplicación alojada puede enviar o recibir datos de ese proveedor de acuerdo con su configuración y los propios términos del proveedor. También podemos divulgar información cuando sea necesario por motivos de seguridad, prevención de abusos, cumplimiento legal o para proteger a los usuarios y el servicio.",
        chromeLimitedUse:
          "Para Agent-Native Clips Chrome extension, nuestro uso de la información recibida de Chrome extension APIs se adhiere a la Política de datos de usuario Chrome Web Store, incluidos los requisitos de uso limitado. La actividad del navegador recopilada por la extensión se utiliza para proporcionar el flujo de trabajo de diagnóstico y grabación de cara al usuario, no para publicidad, reventa, solvencia crediticia o elaboración de perfiles no relacionados.",
        retention1:
          "Conservamos los datos de las aplicaciones alojadas durante el tiempo que sea necesario para brindar el servicio, mantener el historial del espacio de trabajo, cumplir con las obligaciones, resolver disputas o mejorar la confiabilidad y la seguridad. Los usuarios pueden eliminar clips, documentos, recursos y otro contenido de aplicaciones alojadas a través de los controles de aplicaciones relevantes, cuando estén disponibles.",
        retention2:
          "El contenido eliminado puede permanecer en copias de seguridad, registros o registros de auditoría durante un período limitado antes de eliminarse según los cronogramas de retención operativos.",
        security:
          "Utilizamos medidas de seguridad administrativas, técnicas y organizativas razonables diseñadas para proteger los datos de las aplicaciones alojadas, incluidos controles de acceso, cifrado de transporte, monitoreo y prácticas de seguridad operativa. Ningún servicio en línea puede garantizar una seguridad perfecta, por lo que los usuarios deben evitar incluir secretos o información confidencial en grabaciones o mensajes a menos que tengan la intención de compartir esa información con la aplicación alojada.",
        changes1:
          "Podemos actualizar esta política a medida que cambien las aplicaciones alojadas Agent-Native. La fecha de actualización en la parte superior de la página muestra cuándo se revisó la política por última vez.",
        changes2Prefix:
          "Para solicitudes o preguntas sobre privacidad, comuníquese con Builder.io a través de los canales de soporte y privacidad enumerados en la",
      },
      dataCategories: {
        account: {
          title: "Información de cuenta y espacio de trabajo",
          body: "Nombre, dirección de correo electrónico, membresía de la organización, identificadores de autenticación y configuraciones de aplicaciones utilizadas para iniciar sesión y mantener separados los espacios de trabajo alojados.",
        },
        hostedContent: {
          title: "Contenido de la aplicación alojada",
          body: "Content usted crea o carga en plantillas alojadas Agent-Native, como grabaciones, transcripciones, documentos, comentarios, tareas, indicaciones, respuestas de agentes, archivos y configuración.",
        },
        integrations: {
          title: "Datos de integración conectados",
          body: "Datos de los servicios que elige conectarse, como calendario, Slack, correo electrónico, almacenamiento o herramientas de desarrollo, limitados a los alcances y flujos de trabajo que se muestran en la aplicación alojada.",
        },
        usage: {
          title: "Uso y datos técnicos",
          body: "Dispositivo, navegador, dirección IP, registros de diagnóstico, uso de páginas y funciones, errores y eventos de seguridad utilizados para operar, proteger y mejorar los servicios alojados.",
        },
      },
      uses: {
        provide:
          "Proporcionar, sincronizar y operar aplicaciones Agent-Native alojadas y sus flujos de trabajo de agentes.",
        transform:
          "Registre, transcriba, resuma, busque, comparta o transforme contenido cuando le solicite a la aplicación alojada que lo haga.",
        auth: "Autentique usuarios, administre organizaciones, aplique controles de acceso y evite abusos.",
        support:
          "Depure incidentes, brinde soporte, mida la confiabilidad y mejore la experiencia del producto alojado.",
        comply:
          "Cumplir con las obligaciones legales, de seguridad y de plataforma.",
      },
      links: {
        builderPrivacy: "Política de privacidad",
        builderPrivacyFull: "Builder.io Política de privacidad",
      },
    },
    about: {
      eyebrow: "Acerca de Agent-Native",
      title: "Aplicaciones de código abierto para agentes y personas",
      intro:
        "Agent-Native es un framework de código abierto para crear aplicaciones donde los agentes de IA y las interfaces comparten las mismas acciones, datos y estado de aplicación.",
      sections: {
        project: {
          title: "Un modelo operativo compartido",
          body: "Agent-Native trata al agente y a la interfaz como socios iguales. Una sola acción puede alimentar un control de UI, una herramienta del agente, un endpoint HTTP, una capacidad MCP o A2A, un comando CLI y un flujo auditable. El estado SQL compartido mantiene alineadas la vista humana y la del agente.",
        },
        openSource: {
          title: "Código abierto por defecto",
          body: "El código fuente está disponible bajo la licencia MIT en el repositorio BuilderIO/agent-native. Los desarrolladores pueden inspeccionarlo, ejecutarlo localmente, elegir sus proveedores de base de datos y modelos, y adaptarlo a su producto. Los servicios alojados se operan por separado de los forks y despliegues propios.",
        },
        hosted: {
          title: "Alojado y autohospedado",
          body: "Builder.io opera las aplicaciones alojadas y la documentación de Agent-Native en agent-native.com. El framework también está diseñado para equipos que quieren desplegar y mantener sus propias aplicaciones. Los mismos contratos de acciones, límites de acceso, instrucciones de agente y protocolos públicos se pueden revisar en el código y la documentación.",
        },
        community: {
          title: "Construido en público",
          body: "El proyecto se desarrolla abiertamente mediante issues, pull requests, documentación y la comunidad de Agent-Native. Lee la documentación para aprender la arquitectura, revisa el código para verificar una implementación o únete a la comunidad para hablar de un caso de uso o contribuir con un cambio.",
        },
      },
    },
    contact: {
      eyebrow: "Contacto",
      title: "Contacta con Builder.io sobre Agent-Native",
      intro:
        "Usa los canales de soporte, código y comunidad para hacer preguntas, informar problemas, proponer mejoras o comunicar una preocupación de seguridad sobre Agent-Native.",
      emailLabel: "Enviar correo a support@builder.io",
      sections: {
        support: {
          title: "Soporte del producto y servicio alojado",
          body: "Para preguntas sobre una aplicación alojada, acceso a una cuenta, un problema de documentación o un comportamiento que no puedas resolver, escribe a support@builder.io. Incluye la URL pública, una descripción reproducible y cualquier identificador de solicitud o ejecución. No incluyas contraseñas, claves API, tokens ni datos privados.",
        },
        source: {
          title: "Proyecto de código abierto y comunidad",
          body: "Usa el repositorio de GitHub para errores del código, propuestas, pull requests y debates de implementación. Discord sirve para preguntas que se benefician de la conversación con otros desarrolladores. Busca primero en los issues y la documentación para dar a los mantenedores el contexto necesario.",
        },
        security: {
          title: "Informes de seguridad",
          body: "No publiques una vulnerabilidad sin corregir en un issue o chat público. Contacta con Builder.io por el canal de seguridad disponible y proporciona solo los datos necesarios para reproducir y evaluar el informe. Mantén las credenciales, los datos privados y el material de explotación fuera de las solicitudes normales.",
        },
        legal: {
          title: "Legal y privacidad",
          body: "Para preguntas de privacidad, revisa la política de privacidad de Agent-Native y los recursos legales de Builder.io antes de contactar con soporte. Builder.io, Inc. está en 95 3rd Street, 2nd Floor, San Francisco, CA 94103, Estados Unidos. Los términos del servicio alojado y las responsabilidades de autohospedaje están en los Términos de Servicio.",
        },
      },
    },
    terms: {
      eyebrow: "Términos de servicio",
      title: "Agent-Native aplicaciones alojadas",
      intro:
        "Estos términos se aplican cuando Builder.io opera Agent-Native aplicaciones alojadas, plantillas alojadas, demostraciones y servicios alojados oficiales para usted.",
      scopeCards: {
        hosted: {
          title: "Aplicaciones alojadas",
          body: "Cubierto cuando usa una aplicación o plantilla Agent-Native operada por Builder.io.",
        },
        openSource: {
          title: "Código abierto",
          body: "El código fuente con licencia MIT permanece disponible bajo su licencia de código abierto.",
        },
        selfHosted: {
          title: "Autohospedado",
          body: "Las implementaciones independientes operadas por usted o por otra persona no son servicios alojados Builder.io.",
        },
      },
      sections: {
        scope: "Alcance y términos relacionados",
        hostedService: "Servicio alojado",
        accounts: "Cuentas y espacios de trabajo",
        content: "Tu contenido y permisos",
        agents: "Agentes, salidas AI e integraciones",
        acceptableUse: "Uso aceptable",
        openSource: "Código abierto y autohospedaje",
        suspension: "Suspensión y terminación",
        disclaimers: "Descargos de responsabilidad y responsabilidad",
        changes: "Cambios y contacto",
      },
      paragraphs: {
        scope1:
          "Agent-Native es de código abierto y su código fuente está disponible bajo la licencia MIT. Estos términos se aplican únicamente a aplicaciones alojadas y servicios operados por Builder.io para usuarios de Agent-Native. No rigen las bifurcaciones, las plantillas personalizadas, las implementaciones privadas ni las versiones autohospedadas operadas fuera de Builder.io.",
        scope2Prefix:
          "Estos términos complementan los términos más amplios de Builder.io.",
        scope2Middle: "y el Agent-Native",
        scope2Suffix:
          "Si utiliza una aplicación Agent-Native alojada en nombre de una empresa u organización, declara que tiene autoridad para aceptar estos términos para esa organización.",
        scope3:
          "Agent-Native no tiene planes de pago ni suscripciones de alojamiento de pago. Los términos comerciales de Builder.io, como formularios de pedido, tarifas, soporte empresarial, niveles de servicio y anexos de tratamiento de datos, no forman parte de esta oferta salvo que se acuerden por escrito por separado.",
        hostedService:
          "Builder.io puede proporcionar aplicaciones, plantillas, demostraciones, espacios de trabajo compartidos, extensiones de navegador y flujos de trabajo de agentes relacionados alojados en Agent-Native. El servicio alojado puede actualizarse, limitarse, suspenderse o discontinuarse a medida que evoluciona el producto.",
        accounts1:
          "Usted es responsable de la exactitud de la información de la cuenta, la actividad de su cuenta y de mantener seguras las credenciales. Las aplicaciones alojadas Agent-Native pueden incluir funciones de organización, invitaciones, recursos compartidos, integraciones conectadas y controles de acceso específicos de la aplicación. Invita únicamente a usuarios y conecta servicios que estés autorizado a utilizar.",
        accounts2:
          "Si cree que una cuenta, espacio de trabajo, integración o recurso compartido se ha visto comprometido o utilizado indebidamente, comuníquese con el soporte de Builder.io de inmediato.",
        content1:
          "Usted conserva la propiedad del contenido que crea, carga, graba, importa o conecta a aplicaciones alojadas Agent-Native. Usted otorga a Builder.io el permiso limitado necesario para alojar, procesar, transmitir, mostrar, transformar, analizar y almacenar ese contenido para que la aplicación alojada y los flujos de trabajo de sus agentes puedan operar.",
        content2:
          "Usted es responsable de tener los derechos y permisos necesarios para el contenido, las grabaciones, las indicaciones, los archivos, las credenciales y los datos de integración conectados que proporciona al servicio.",
        agents1:
          "Las aplicaciones Agent-Native alojadas pueden ejecutar agentes, herramientas, automatizaciones e integraciones de proveedores AI según su solicitud. La salida generada por AI puede ser incompleta, inexacta o inadecuada para un uso particular. Revise resultados, acciones, exportaciones y mensajes importantes antes de confiar en ellos.",
        agents2:
          "Cuando conecta servicios de terceros, su uso de esos servicios permanece sujeto a sus propios términos, límites, permisos y prácticas de privacidad.",
        openSource:
          "Estos términos no cambian la licencia de código abierto para el código Agent-Native. Si descarga, bifurca, modifica o aloja automáticamente Agent-Native, la licencia MIT y los términos que establezca para su propia implementación rigen ese uso. Usted es responsable de la seguridad, la privacidad, el cumplimiento, las operaciones y la asistencia al usuario de las implementaciones que opera.",
        suspensionPrefix:
          "Builder.io puede suspender o restringir el acceso a los servicios alojados de Agent-Native cuando sea necesario para proteger a los usuarios, cumplir con la ley, prevenir abusos, abordar riesgos de seguridad u operar el servicio. Puede dejar de utilizar el servicio alojado en cualquier momento. Algunos datos pueden permanecer en copias de seguridad, registros o registros de auditoría durante un período limitado, como se describe en la",
        disclaimers1:
          "Los servicios alojados de Agent-Native se brindan tal como están y según están disponibles, sujetos a la ley aplicable y a cualquier acuerdo escrito por separado que tenga con Builder.io. Builder.io no garantiza que las aplicaciones alojadas, integraciones, automatizaciones o salidas de AI sean ininterrumpidas, estén libres de errores o cumplan con todos los requisitos.",
        disclaimers2Prefix:
          "En la medida máxima permitida por la ley, la responsabilidad de Builder.io por los servicios alojados de Agent-Native está limitada como se describe en la política más amplia de Builder.io.",
        disclaimers2Suffix: "u otro acuerdo escrito que se aplique a su uso.",
        changes1:
          "Podemos actualizar estos términos a medida que cambien las aplicaciones alojadas Agent-Native. La fecha de actualización en la parte superior de la página muestra cuándo se revisaron los términos por última vez.",
        changes2Prefix:
          "Si tiene preguntas sobre estos términos, comuníquese con Builder.io a través de los canales de soporte enumerados en Builder.io.",
      },
      hostedServicePoints: {
        create:
          "Cree y opere espacios de trabajo alojados Agent-Native y aplicaciones de plantilla.",
        workflows:
          "Ejecute flujos de trabajo, acciones, automatizaciones e integraciones de agentes que elija utilizar.",
        store:
          "Almacene el contenido de la aplicación alojada, la configuración, los datos de la organización y el estado de la cuenta conectada necesarios para brindar el servicio.",
        improve:
          "Mida, proteja, depure y mejore los servicios alojados Agent-Native.",
      },
      acceptableUse: {
        laws: "No utilice aplicaciones alojadas Agent-Native para violar leyes, infringir derechos o dañar a personas o sistemas.",
        bypass:
          "No intente eludir los controles de acceso, los límites de tarifas, los límites de seguridad o el aislamiento de los inquilinos.",
        malware:
          "No cargue malware, material de robo de credenciales ni contenido diseñado para interrumpir el servicio.",
        spam: "No utilice el servicio para enviar spam, raspar sin autorización ni abusar de los proveedores conectados.",
        sensitive:
          "No coloque secretos ni datos confidenciales regulados en aplicaciones alojadas a menos que esté autorizado y la aplicación sea apropiada para ese uso.",
      },
      links: {
        builderTerms: "Términos de servicio",
        privacyPolicy: "Política de privacidad",
      },
    },
  },
  nav: {
    overview: "Visión general",
    coreArchitecture: "Arquitectura central",
    dataAuthGovernance: "Datos, autenticación y gobernanza",
    usingYourAgent: "Usar tu Agent",
    agentResources: "Recursos del Agente",
    integrations: "Integraciones",
    advancedRuntime: "Avanzado: extender el runtime",
    templatesSection: "Apps",
    gettingStarted: "Primeros pasos",
    gettingStartedActions: "Add an Action",
    gettingStartedPages: "Add a Page",
    whatIsAgentNative: "¿Qué es Agent-Native?",
    agentSurfaces: "Superficies del Agent",
    agentNativeConfig: "Agent-Native Config",
    keyConcepts: "Conceptos clave",
    agentNativeToolkit: "Toolkit",
    toolkitOverview: "Resumen",
    toolkitUiPrimitives: "Primitivas de UI",
    customDesignSystem: "Sistemas de diseño personalizados",
    toolkitEditorsCanvases: "Editores y lienzos",
    toolkitContextKnowledge: "Contexto y conocimiento",
    toolkitSharing: "Compartir",
    toolkitCollaboration: "Colaboración",
    toolkitSettings: "Ajustes",
    toolkitOrgTeam: "Organización y equipo",
    toolkitSetupConnections: "Configuración y conexiones",
    toolkitCommandNavigation: "Comandos y navegación",
    toolkitResources: "Recursos",
    toolkitAgentUx: "UX del agente",
    toolkitHistory: "Historial",
    toolkitCommentsReview: "Comentarios y revisión",
    toolkitObservability: "Observabilidad",
    featureKits: "Kits de funciones",
    appChrome: "Marco de la app",
    capabilityPackages: "Paquetes de capacidad",
    capabilityPackagesOverview: "Resumen",
    packageLifecycle: "Ciclo de vida de paquetes",
    versioningAndStability: "Versiones y estabilidad",
    templatesOverview: "Plantillas",
    pureAgentApps: "Apps orientadas a la automatización",
    faq: "FAQ",
    server: "Servidor",
    serverOverview: "Resumen",
    serverMiddleware: "Middleware",
    serverPlugins: "Plugins",
    serverRoutes: "Rutas",
    client: "Cliente",
    clientOverview: "Resumen",
    clientDataSync: "Datos y sincronización",
    clientAgentChat: "Chat del Agent",
    clientAdvanced: "Avanzado",
    clientSyncInternals: "Sincronización interna",
    clientEntryPoints: "Puntos de entrada",
    routing: "Rutas",
    actions: "Acciones",
    actionsOverview: "Resumen",
    actionsDefining: "Definir acciones",
    actionsAccessControl: "Acceso y autorización",
    actionsRunContext: "Contexto de ejecución",
    actionsOtherSurfaces: "Otras superficies",
    actionsAdvanced: "Avanzado y heredado",
    actionsAgentTools: "Acceso del Agente en Producción",
    publicAgentWeb: "Agent Web público",
    database: "Base de datos",
    databaseProviders: "Proveedores de bases de datos",
    databaseNeon: "Neon Postgres",
    databaseSupabase: "Supabase Postgres",
    databaseAwsRds: "Amazon RDS for PostgreSQL",
    databaseCloudSql: "Cloud SQL for PostgreSQL",
    databaseAzurePostgres: "Azure Database for PostgreSQL",
    databasePostgres: "Plain Postgres",
    internationalization: "Internacionalización",
    localFileMode: "Modo de archivos locales",
    fileUploads: "Subidas de archivos",
    deployment: "Despliegue",
    deploymentOverview: "Resumen",
    deploymentProviders: "Proveedores de hosting",
    deploymentProduction: "Producción y avanzado",
    deployAnApp: "Desplegar una aplicación",
    workspaceDeployment: "Despliegue del Workspace",
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
    deploymentOtherPlatforms: "Otras Plataformas",
    ssrCaching: "Caché de SSR",
    deploymentEnvironmentVariables: "Despliegue: Variables de Entorno",
    updatingUiInProduction: "Actualizar la UI en Producción",
    environmentVariables: "Variables de entorno",
    progress: "Progreso",
    authentication: "Autenticación",
    multiTenancy: "multiinquilino",
    organizationsTeamsPermissions: "Organizaciones, equipos y permisos",
    administeredDeployments: "Despliegues administrados",
    securityDataScoping: "Seguridad y alcance de datos",
    sharingPrivacy: "Compartir y privacidad",
    trackingAnalytics: "Tracking y analítica",
    auditLog: "Registro de auditoría",
    doctorCodeChecks: "Doctor (verificaciones de código)",
    observability: "Observabilidad",
    observationalMemory: "Memoria observacional",
    ciEvalGate: "Puerta de evals en CI",
    usingYourAgentOverview: "Visión general",
    contextAwareness: "Contexto de pantalla",
    agentMentions: "Menciones al Agent",
    voiceInput: "Entrada de voz",
    dropInAgent: "Agent embebible",
    componentApi: "API de componentes",
    nativeChatUi: "UI de chat nativa",
    agentkit: "AgentKit",
    generativeUi: "Interfaz generativa",
    realTimeCollaboration: "Colaboración en tiempo real",
    agentResourcesOverview: "Descripción general de los recursos del agente",
    skills: "Habilidades",
    customAgentsTeams: "Agents y equipos personalizados",
    workspaceGovernance: "Gobernanza del workspace",
    recurringJobs: "Tareas recurrentes",
    automations: "Automatizaciones",
    extensions: "Extensiones",
    dataPrograms: "Programas de datos",
    multiAppWorkspaces: "Workspaces multi-app",
    onboardingApiKeys: "Onboarding y claves API",
    messaging: "Mensajería (Slack, Email...)",
    messagingRecipes: "Recetas de mensajería",
    messagingInternals: "Arquitectura de mensajería",
    dispatch: "Dispatch",
    portal: "Portal",
    a2aProtocol: "Protocolo A2A",
    mcpClients: "Clientes MCP (añadir herramientas)",
    httpApi: "API HTTP (llamar acciones)",
    mcpServer: "Servidor MCP (exponer tu app)",
    externalAgents: "Agents externos (conectar un host)",
    externalAgentsCatalog: "Catálogo de agentes externos",
    mcpApps: "MCP Apps (UI integrada)",
    webMcp: "WebMCP (herramientas del navegador)",
    crossAppSso: "SSO entre apps",
    notifications: "Notificaciones",
    automationConnectors: "Conectores de flujo de trabajo",
    workspaceConnections: "Conexiones del workspace",
    creatingTemplates: "Crear plantillas",
    syncingTemplateChanges: "Sincronizar cambios de plantillas",
    writingAgentInstructions: "Escribir instrucciones de Agent",
    embeddingSdk: "SDK de incrustación",
    agentNativeCodeUi: "UI de código Agent-Native",
    harnessAgents: "Agentes con harness",
    adapters: "Adaptadores",
    cliAdapters: "Adaptadores CLI",
    processors: "Procesadores in-loop",
    durableResume: "Reanudación duradera",
    durableBackgroundRuns: "Ejecuciones en segundo plano duraderas",
    blueprintInstaller: "Instalador Blueprint",
    chat: "Chat",
    chatOverview: "Visión general",
    chatFirstEdits: "Tu primera función",
    chatDevelopers: "Guía para desarrolladores",
    calendar: "Calendario",
    calendarOverview: "Visión general",
    calendarAgent: "Hablar con el Agent",
    calendarFeatures: "Funciones",
    calendarIntegrations: "Uso entre apps",
    calendarDevelopers: "Guía para desarrolladores",
    content: "Contenido",
    contentOverview: "Visión general",
    contentEditing: "Escritura y organización",
    contentDatabases: "Colecciones y formularios",
    contentSync: "Archivos locales y sincronización",
    contentDevelopers: "Guía para desarrolladores",
    plans: "Plans",
    visualPlans: "Planes visuales",
    planReviewWorkflow: "Revisión y comentarios",
    planAutomations: "Eventos y automatizaciones",
    planLocalAndDesktop: "Archivos locales y escritorio",
    planDevelopers: "Guía para desarrolladores",
    prVisualRecap: "Resumen visual de PR",
    planPluginMarketplace: "Plugin y marketplace de Plan",
    slides: "Diapositivas",
    slidesOverview: "Visión general",
    slidesFeatures: "Funciones",
    slidesAgent: "Hablar con el Agent",
    slidesIntegrations: "Uso entre apps",
    slidesDevelopers: "Guía para desarrolladores",
    analytics: "Analitica",
    analyticsOverview: "Visión general",
    analyticsDashboards: "Paneles y análisis",
    analyticsConnectors: "Conectar fuentes de datos",
    analyticsMonitoringAndSessions: "Monitorización y repetición de sesiones",
    analyticsDevelopers: "Guía para desarrolladores",
    mail: "Correo",
    mailOverview: "Visión general",
    mailAgent: "Hablar con el Agent",
    mailInbox: "Bandeja de entrada y automatizaciones",
    mailDraftsAndQueue: "Borradores y programación",
    mailDevelopers: "Guía para desarrolladores",
    clips: "Clips",
    clipsOverview: "Visión general",
    clipsFeatures: "Funciones",
    clipsAgent: "Hablar con el Agent",
    clipsIntegrations: "Uso entre apps",
    clipsDevelopers: "Guía para desarrolladores",
    clipsEmbed: "Insertar Clips",
    assets: "Recursos",
    assetsOverview: "Visión general",
    assetsGeneration: "Generar y refinar",
    assetsPresets: "Preajustes",
    assetsIntegrations: "Uso entre apps",
    assetsDevelopers: "Guía para desarrolladores",
    design: "Design",
    designOverview: "Visión general",
    designFeatures: "Funciones",
    designAgent: "Hablar con el Agent",
    designIntegrations: "Uso entre apps",
    designDevelopers: "Guía para desarrolladores",
    dispatchOverview: "Visión general",
    dispatchFeatures: "Funciones",
    dispatchAgent: "Hablar con el Agent",
    dispatchIntegrations: "Uso entre apps",
    dispatchDevelopers: "Guía para desarrolladores",
    dispatchReference: "Referencia de acciones y datos",
    forms: "Formularios",
    formsOverview: "Visión general",
    formsFeatures: "Funciones",
    formsAgent: "Hablar con el Agent",
    formsIntegrations: "Uso entre apps",
    docsComponents: "Docs Components",
    formsDevelopers: "Guía para desarrolladores",
  },
} satisfies typeof enUS;

export default esES;
