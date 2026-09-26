import enUS from "./en-US";

const deDE = {
  language: {
    label: "Sprache",
    system: "System",
    systemDescription: "Browsersprache verwenden",
    suggestionTitle: "Diese Seite auf {{language}} lesen?",
    suggestionDescription: "Ihre Browsersprache ist {{language}}.",
    suggestionSwitch: "Zu {{language}} wechseln",
    suggestionKeepEnglish: "Englisch behalten",
  },
  header: {
    docs: "Dokumente",
    templates: "Apps",
    skills: "Fähigkeiten",
    searchAria: "Dokumentation durchsuchen",
    searchPlaceholder: "Docs suchen...",
    askAssistant: "KI fragen",
    toggleNavigation: "Navigationsmenü umschalten",
    copyLogoSvg: "Logo-SVG kopieren",
    copyWordmark: "Wortmarke kopieren",
    brandAssets: "Markenmaterial",
    tryNow: "Jetzt testen",
  },
  footer: {
    download: "Herunterladen",
    pricing: "Preise",
    brand: "Marke",
    privacy: "Datenschutz",
    terms: "Bedingungen",
  },
  feedback: {
    label: "Rückmeldung",
    placeholder: "Sag uns, wie diese Dokumentation besser werden kann.",
  },
  demoVideo: {
    visualPlanningAria: "Agent-Native Demo für visuelle Planung",
  },
  docBlocks: {
    blockLabel: "{{alias}}-Block",
    unknownBlockType: "unbekannter Blocktyp",
  },
  theme: {
    light: "hell",
    dark: "dunkel",
    toggle: "Design wechseln",
    label: "Design: {{theme}}",
  },
  docs: {
    navigateAria: "Docs navigieren",
    onThisPage: "Auf dieser Seite",
    copyMarkdown: "Dokument als Markdown kopieren",
    copiedMarkdown: "Markdown kopiert",
    copyMarkdownError: "Markdown konnte nicht kopiert werden",
    previous: "Zurück",
    next: "Weiter",
    draftLabel: "Entwurf",
    draftDescription:
      "Diese Seite befindet sich in Bearbeitung. Der Inhalt kann unvollständig sein oder sich vor der Veröffentlichung ändern.",
    translationLabel: "Maschinell übersetzt",
    translationDescription:
      "Diese Seite wurde automatisch übersetzt und ist möglicherweise nicht vollständig korrekt.",
    translationViewOriginal: "Original auf Englisch ansehen",
  },
  search: {
    dialogLabel: "Dokumentation durchsuchen",
    placeholder: "Dokumentation durchsuchen...",
    empty: "Tippe, um die gesamte Dokumentation zu durchsuchen",
    toggleChatSidebar: "Chat-Seitenleiste umschalten",
    loadError: "Die Suche konnte nicht geladen werden. Erneut versuchen.",
    retry: "Erneut versuchen",
    noResults: 'Keine Ergebnisse für "{{query}}"',
    browseAllDocs: "Alle Docs anzeigen",
    navigate: "navigieren",
    open: "öffnen",
    close: "schließen",
  },
  agent: {
    emptyState: "Frag mich alles über Agent-Native",
    suggestionGettingStarted: "Wie starte ich mit Agent-Native?",
    suggestionActions: "Wie funktionieren actions?",
    suggestionPolling: "Erkläre das Polling-Sync-Modell",
    suggestionDeploy: "Wie deploye ich in Produktion?",
  },
  errors: {
    loadingLatest: "Neueste Version wird geladen...",
    notFoundTitle: "Seite nicht gefunden",
    notFoundBody: "Die gesuchte Seite existiert nicht oder wurde verschoben.",
    goHome: "Zur Startseite",
    readDocs: "Docs lesen",
    genericTitle: "Etwas ist schiefgelaufen",
    genericBody: "Ein unerwarteter Fehler ist aufgetreten.",
    sendFeedback: "Feedback senden",
    feedbackPlaceholder:
      "Beschreiben Sie, was vor diesem Docs-Fehler passiert ist.",
    openGitHubIssue: "GitHub-Issue öffnen",
  },
  home: {
    hero: {
      titleLine1: "Das Framework für",
      titleAccent: "agentic Apps",
      body: "Entscheide dich nicht zwischen Apps und Agents. Agent-Native-Apps sind beides.",
      primaryCta: "App ausprobieren",
      secondaryCta: "Docs lesen",
    },
    code: {
      quickStartComment: "Erstelle eine App mit einem Befehl",
      skillInstallComment:
        "Füge Agent-Native-Planung zu einem coding agent hinzu, den du bereits nutzt",
      frameworkComment:
        "Ein action treibt agent, UI, HTTP, MCP, A2A und CLI an.",
      frameworkDescription: "Sage Hallo aus dem lokalen app-agent loop.",
    },
    actionSurface: {
      eyebrow: "Wirklich agentisch, nicht nur KI daneben",
      title: "Eine Aktion gibt dir die gesamte Oberfläche",
      body: "Definiere eine Operation einmal. Agent-Native macht daraus UI-Aktion, Agent-Tool, HTTP-Endpunkt, MCP/A2A-Oberfläche, CLI-Befehl, Berechtigungsprüfung und Audit-Trail.",
      buildAction: "Eine Aktion erstellen",
      benefits: {
        oneActionDefinition: {
          title: "Eine Aktionsdefinition",
          body: "UI, Agent, HTTP, MCP, A2A und CLI rufen dieselbe Operation auf.",
        },
        scopedByDefault: {
          title: "Standardmäßig begrenzt",
          body: "Auth, Sharing, Governance und Audit-Logs begleiten die Arbeit.",
        },
        headedOrHeadless: {
          title: "Apps, Automationen und Agents",
          body: "Führe dieselbe Operation aus Chat, UI, geplanten Jobs, Queues, externen Agents oder Skripten aus.",
        },
        contextRichInput: {
          title: "Kontextreiche Eingabe",
          body: "Chat, Voice, Skills, Anweisungen und UI-Zustand bleiben im Ablauf.",
        },
        openAgentProtocols: {
          title: "Offene Agent-Protokolle",
          body: "A2A, MCP, MCP apps und externe Agents sind Framework-Grundbausteine.",
        },
        observableByDesign: {
          title: "Von Anfang an beobachtbar",
          body: "Traces, Evals, Feedback und Audit-Historie machen Agent-Arbeit prüfbar.",
        },
      },
    },
    modules: {
      pageEyebrow: "Modulares Framework",
      title: "Eingebaute Module für agentische Apps",
      body: "Von Menschen geprüfte Bausteine für Produktionsbereiche, die Agents nicht neu erfinden sollten. Nutze sie direkt, prüfe den Source oder ersetze das Modul, wenn deine App etwas anderes braucht.",
      pageBody:
        "Agent-Native liefert von Menschen geprüfte Bausteine für Produktionsarbeit, die Agents nicht improvisieren sollten. Nutze sie direkt, prüfe den Source oder ersetze das Modul, wenn dein Produkt etwas anderes braucht.",
      viewAll: "Alle Module ansehen",
      browseApps: "Apps aus Modulen ansehen",
      items: {
        autoStateSyncing: {
          title: "Automatische Zustandssynchronisierung",
          body: "Agent-Änderungen aktualisieren die UI, und der UI-Zustand bleibt ohne weitere Brücke für den Agent sichtbar.",
        },
        actions: {
          title: "Aktionen",
          body: "Definiere Arbeit einmal und nutze sie aus UI, Agent, HTTP, MCP, A2A und CLI.",
        },
        sqlStateOrm: {
          title: "PostgreSQL-Zustand und ORM",
          body: "Dauerhafte App-Daten, Application State, Migrationen und PostgreSQL-/PGlite-Schemas.",
        },
        dbAdmin: {
          title: "Datenbank-Admin",
          body: "Agent-lesbare Schemas, Query-Oberflächen, Migrationen und Admin-Tools ohne eigenes Backoffice.",
        },
        authGovernance: {
          title: "Auth und Governance",
          body: "Login, Organisationen, Multi-Tenancy, Berechtigungen, Freigaben und Policy-Hooks.",
        },
        sharing: {
          title: "Freigabe",
          body: "Share-Links, begrenzter Zugriff, öffentliche oder private Ressourcen, Kommentare und Review-Flächen.",
        },
        realtimeCollaboration: {
          title: "Echtzeit-Zusammenarbeit",
          body: "Mehrbenutzer-Editing, Live-Präsenz, optimistische UI und servergestützte Abstimmung.",
        },
        agentInteroperability: {
          title: "Agent-Interoperabilität",
          body: "A2A, MCP, MCP apps, externe Agents, Harness Agents und Übergaben zwischen Apps.",
        },
        automationsQueues: {
          title: "Automationen und Queues",
          body: "Ereignisgesteuerte Arbeit, geplante Tasks, Hintergrundläufe und zuverlässige Mutationen.",
        },
        agentUiSurface: {
          title: "Agent-UI-Oberfläche",
          body: "Chat, Skills, Anweisungen, generative UI, Spracheingabe und agent-sichtbarer Kontext.",
        },
        observability: {
          title: "Observability",
          body: "Traces, Evals, Feedback, Experimente und Nachweis dessen, was Agents getan haben.",
        },
        workspaces: {
          title: "Arbeitsbereiche",
          body: "Komponierbare agentic apps, die einander entdecken und über A2A koordinieren.",
        },
        sourceOwnership: {
          title: "Eigentum am Source",
          body: "Docs und Source liegen dort, wo Agents sie prüfen, besitzen, ejecten, patchen oder ersetzen können.",
        },
        auditLogs: {
          title: "Audit-Protokolle",
          body: "Ein dauerhafter Verlauf menschlicher und agentischer Änderungen, begrenzt auf zugängliche Ressourcen.",
        },
      },
    },
    framework: {
      title: "Das Framework für agent-native apps",
      body1:
        "Agent-Native ist ein Open-Source-Framework zum Bau von agentic applications: Starte mit Chat, definiere gemeinsame actions und ergänze dann UI, jobs und Zusammenarbeit rund um denselben state.",
      body2:
        "Verwenden Sie lokales PGlite oder gehostetes PostgreSQL sowie Ihren Hosting-Anbieter, Model-Stack und app-Code.",
      cta: "Framework-Guide lesen",
      primitives: {
        actions: {
          title: "Aktionen",
          description:
            "Definiere Arbeit einmal. Nutze sie aus agent, UI, API, MCP und A2A.",
        },
        sharedState: {
          title: "Geteilter Zustand",
          description:
            "SQL-gestützter app-Zustand hält Menschen, agents und Sessions synchron.",
        },
        agentRuntime: {
          title: "agent runtime",
          description:
            "Der app-agent loop, tools, skills, memory, jobs und Observability werden gemeinsam ausgeliefert.",
        },
        postgresSpecific: {
          title: "PostgreSQL-spezifisch",
          description:
            "Verwenden Sie die PostgreSQL-Schema-Helfer des Frameworks mit lokalem PGlite oder gehostetem Postgres auf jedem Nitro-kompatiblen Host.",
        },
      },
    },
    templates: {
      title: "Teste eine Agent-Native-App",
      eyebrow:
        "Starte mit einer funktionierenden App und lass sie vom Agenten weiterentwickeln.",
      cta: "Apps ansehen",
    },
    skills: {
      title: "Mit einem skill ausprobieren",
      body: "Füge visuelle Planung und PR recaps mit einem Befehl zu Claude Code, Codex, Cursor, Pi, OpenCode oder VS Code hinzu.",
      planBody:
        "Reviewbare Pläne mit Diagrammen, Wireframes, Dateikarten und Kommentaren vor Codeänderungen.",
      recapBody:
        "Eine visuelle Zusammenfassung eines PR oder diff, damit Reviewers die Form vor den rohen Zeilen sehen.",
      cta: "Skills Guide durchsuchen",
    },
    connected: {
      title: "Agents und UI, vollständig verbunden",
      body: "Der agent und die UI sind gleichberechtigte Teile desselben Systems. Jeder action funktioniert in beide Richtungen: klicken oder danach fragen.",
      tabs: {
        agentSees: {
          title: "Der agent sieht alles",
          description:
            "Er kann jede UI, alle Daten und jeden Zustand in der Anwendung lesen und aktualisieren.",
        },
        uiTalks: {
          title: "Die UI spricht mit dem agent",
          description:
            "Buttons, Formulare und workflows senden strukturierte Inhalte an den agent und schaffen geführte Abläufe, die alle durch den agent laufen, einschließlich skills, rules und instructions.",
        },
        agentUpdates: {
          title: "Der agent aktualisiert seinen eigenen Code",
          description:
            "Er kann die app selbst ändern, um features und Funktionalität anzupassen. Deine tools werden mit der Zeit besser.",
        },
        everything: {
          title: "Alles funktioniert in beide Richtungen",
          description:
            "Jeder action, der in der UI verfügbar ist, steht auch dem agent zur Verfügung. Du kannst klicken, um etwas zu tun, oder den agent bitten, es zu tun.",
        },
      },
    },
    comparison: {
      titleLine1: "Wählen Sie nicht zwischen Apps und Agents.",
      titleAccent: "Agent-Native apps sind beides.",
      columns: {
        saas: "SaaS-Tools",
        agents: "Rohe AI-Agenten",
        internal: "Interne Tools",
        native: "Agent-Native App",
      },
      rows: {
        ui: "UI",
        ai: "AI",
        customization: "Anpassung",
        ownership: "Eigentum",
      },
      cells: {
        polishedButRigid: "Ausgereift, aber starr",
        none: "Keine",
        mixedQuality: "Gemischte Qualität",
        fullUi: "Volle UI, anpassen & loslegen",
        boltedOn: "Nachträglich angebaut",
        powerful: "Mächtig",
        shallowlyConnected: "Oberflächlich verbunden",
        agentFirst: "Agent-first, integriert",
        cant: "Geht nicht",
        instructionsAndSkills: "Instructions und skills",
        fullHighMaintenance: "Vollständig, aber wartungsintensiv",
        agentModifies: "Agent verändert die app",
        rented: "Gemietet",
        somewhatYours: "Teilweise deins",
        youOwnCode: "Der Code gehört dir",
      },
    },
    quickStart: {
      title: "Mit einem Befehl starten",
      body: "Ein Befehl erstellt eine chat-first lokale App mit actions, durable threads und PGlite. Nutze `--headless` nur für automation-first Workflows ohne Browser-UI.",
    },
    finalCta: {
      title: "Software, gebaut für die agentic era",
      body: "Starte mit einem Befehl oder einem durable action, führe es durch den app-agent loop und erweitere es dann zu UI, jobs und Zusammenarbeit, ohne die Operation neu zu schreiben. Open Source. Cloneable SaaS. Deins.",
      primaryCta: "App ausprobieren",
      secondaryCta: "Docs lesen",
      githubCta: "Auf GitHub ansehen",
    },
    batteries: {
      titleLine1: "Alles dabei,",
      titleLine2: "praxiserprobt",
      body: "Statt mit einem leeren Prompt und improvisiertem Code zu starten, gibt Agent-Native Agenten bewährte Bausteine und Best Practices, um echte Software zu bauen.",
      browseToolkits: "Toolkits ansehen",
    },
    featureCloud: {
      notifications: "Benachrichtigungen",
      recurringJobs: "Wiederkehrende Jobs",
      actions: "Aktionen",
      agentTeams: "Agententeams",
      monorepos: "Monorepos",
      permissions: "Berechtigungen",
      rbac: "RBAC",
      organizations: "Organisationen",
      workspaceSecrets: "Workspace-Secrets",
      docsSearch: "Docs-Suche",
      sourceSearch: "Quellcode-Suche",
      contextAwareness: "Kontextbewusstsein",
      observability: "Beobachtbarkeit",
      realtimeSync: "Echtzeit-Sync",
      sqlState: "SQL-Zustand",
      multiTenancy: "Mandantenfähigkeit",
      dataLoaders: "Datenlader",
      liveQueries: "Live-Abfragen",
      agentInstructions: "Agentenanweisungen",
      providerGrants: "Zuschüsse des Anbieters",
      comments: "Kommentare",
      reviewLinks: "Überprüfen Sie die Links",
      privacyControls: "Datenschutzkontrollen",
      skills: "Fähigkeiten",
      security: "Sicherheit",
      auditLogs: "Audit-Protokolle",
      workspaces: "Arbeitsbereiche",
      voiceInput: "Spracheingabe",
      mcpApps: "MCP Apps",
      generativeUi: "Generative Oberfläche",
      toolCalls: "Werkzeugaufrufe",
      agentSidebar: "Agenten-Seitenleiste",
      sharedActions: "Geteilte Aktionen",
      uiSurfaces: "UI Oberflächen",
      i18n: "i18n",
      mcpAuth: "MCP-Authentifizierung",
      battleTestedComponents: "Bewährte Komponenten",
      mcpA2a: "MCP + A2A",
      externalAgents: "Externe Agenten",
      a2aHandoffs: "A2A Übergaben",
      humanHandoff: "Menschliche Übergabe",
      agentContext: "Agentenkontext",
      durableResume: "Dauerhafter Lebenslauf",
      extensions: "Erweiterungen",
      sharingPrivacy: "Teilen und Privatsphäre",
      realTimeCollaboration: "Zusammenarbeit in Echtzeit",
      sso: "SSO",
      oauth: "OAuth",
      mcpServers: "MCP Server",
      scopedAccess: "Begrenzter Zugriff",
      dbAdapters: "DB-Adapter",
      auth: "Authentifizierung",
      approvals: "Zulassungen",
      automations: "Automatisierungen",
      governance: "Regierungsführung",
      jobs: "Aufträge",
      agUi: "AG-UI",
      dispatch: "Dispatch",
      backgroundRuns: "Hintergrundläufe",
      rateLimits: "Tarifbegrenzungen",
      queues: "Warteschlangen",
      cronSchedules: "Cron-Zeitpläne",
      analytics: "Analysen",
      experiments: "Experimente",
      feedbackLoops: "Rückkopplungsschleifen",
      fileUploads: "Datei-Uploads",
      evals: "Bewertungen",
      templates: "Apps",
      providerApis: "Anbieter APIs",
      agentWebSurfaces: "Agenten-Weboberflächen",
      templateSkills: "App-Fähigkeiten",
      oneClickForks: "App-Erstellung mit einem Klick",
      localFileMode: "Lokaler Dateimodus",
      memory: "Erinnerung",
      webhooks: "Webhooks",
      http: "HTTP",
      selfEditingCode: "Selbsteditierender Code",
      cli: "CLI",
      crossAppSso: "App-übergreifend SSO",
      schemaMigrations: "Schemamigrationen",
      hostedDeploys: "Gehostete Bereitstellungen",
      environmentSetup: "Umgebungseinrichtung",
      oauthCallbacks: "OAuth Rückrufe",
      exports: "Exporte",
      dashboards: "Übersichten",
    },
  },
  common: {
    copied: "Kopiert",
    copyFailed: "Kopieren fehlgeschlagen",
    copyCommand: "Befehl kopieren",
    copyCode: "Code kopieren",
    tryIt: "Ausprobieren",
    customizeIt: "Anpassen",
    editOnline: "Online bearbeiten",
    runLocally: "Lokal ausführen",
    viewDocs: "Docs ansehen",
    source: "Quelle",
    readDocs: "Lesen Sie die Dokumente",
    signIn: "Anmelden",
    tryTemplateFree: "{{name}} kostenlos testen",
    designForFree: "Kostenlos designen",
    recordForFree: "Kostenlos aufnehmen",
    getStarted: "Loslegen",
    freeAndOpenSource: "100 % kostenlos • Open Source",
    viewAllApps: "Alle Apps anzeigen",
  },
  homepage: {
    hero: {
      title: "Das Framework für agentische Anwendungen",
      bodyLine1:
        "Entwickle autonome Agenten mit intuitiven Benutzeroberflächen.",
      bodyLine2: "Bring dein eigenes LLM mit. Deploye überall.",
      tryAnApp: "App ausprobieren",
    },
    install: {
      copyCommand: "Installationsbefehl kopieren",
    },
    actions: {
      title: "Eine Action treibt jede Oberfläche an",
      bodyLine1: "Definiere eine Fähigkeit einmal mit defineAction().",
      bodyLine2:
        "Dein Agent, deine React-UI, HTTP-Clients und Integrationen verwenden denselben Code.",
      diagramAlt:
        "Eine Action treibt UI, MCP, Agent-Chat, A2A, HTTP API und CLI an",
    },
    builtIn: {
      title: "Alles, was dein Agent braucht",
      body: "UI, Kontext, Daten, Berechtigungen und Infrastruktur, bereits miteinander verbunden.",
      pillars: {
        reactUi: {
          title: "React UI",
          body: "Gib Nutzern vertraute Bildschirme zum Durchsuchen, Bearbeiten und Prüfen von Arbeit.",
        },
        agentChat: {
          title: "Eingebetteter Agent-Chat",
          body: "Lass Nutzer Arbeit delegieren, Fragen stellen und Ergebnisse in derselben UI prüfen.",
        },
        sharedState: {
          title: "Geteilter Anwendungsstatus",
          body: "Der Agent weiß, was Nutzer ansehen, auswählen und bearbeiten.",
        },
        sharedSql: {
          title: "Geteilte PostgreSQL-Daten",
          body: "Nutzer und Agenten lesen und aktualisieren dieselbe Quelle der Wahrheit.",
        },
        skillsMemory: {
          title: "Skills und Gedächtnis",
          body: "Gib Agenten wiederverwendbares Fachwissen und dauerhaften Kontext.",
        },
        automations: {
          title: "Automatisierungen",
          body: "Führe Agentenarbeit automatisch nach Zeitplänen oder Ereignissen aus.",
        },
        agentTeams: {
          title: "Agententeams",
          body: "Delegiere Arbeit an spezialisierte Agenten im selben Workspace oder über verbundene Agenten hinweg.",
        },
        auth: {
          title: "Authentifizierung und Organisationen",
          body: "Anmeldung, Benutzerkonten und Organisationsmitgliedschaft sind eingebaut.",
        },
        sharing: {
          title: "Teilen und Berechtigungen",
          body: "Kontrolliere, wer jede Ressource ansehen, kommentieren, bearbeiten oder verwalten darf.",
        },
      },
    },
    stack: {
      title: "Bring deinen eigenen Stack mit",
      body: "Agent-Native ist Open-Source-TypeScript. Wähle dein Modell, deine Datenbank und dein Hosting und behalte den Anwendungscode in deinem Repository.",
      exploreApps: "Mit Agent-Native gebaute Apps entdecken",
    },
    showcase: {
      title: "Echte Apps mit Agent-Native",
      body: "Open-Source-Agent-Native-Apps, die du kostenlos nutzen oder grenzenlos anpassen kannst.",
      browseApps: "Apps durchsuchen",
      scrollLeft: "Apps nach links scrollen",
      scrollRight: "Apps nach rechts scrollen",
    },
    bottomCta: {
      title: "Baue deinen ersten Agenten mit einer UI",
      body: "Agent und UI nutzen dieselben Funktionen. Bring dein eigenes LLM mit und deploye überall.",
    },
    footer: {
      tagline: "Das Framework für agentische Anwendungen.",
      framework: "Framework",
      ecosystem: "Ökosystem",
      community: "Community",
      legal: "Rechtliches",
      docs: "Docs",
      download: "Herunterladen",
      apps: "Apps",
      privacyPolicy: "Datenschutzerklärung",
      saasTerms: "SaaS-Bedingungen",
      legalResources: "Rechtliche Ressourcen",
    },
  },
  gettingStarted: {
    tabs: {
      label: "Wählen Sie, wie Sie entwickeln",
      local: "Lokal entwickeln",
      localDescription: "Mit der CLI auf Ihrem Computer entwickeln.",
      cloud: "In der Cloud entwickeln",
      cloudDescription: "Im Browser mit Builder.io entwickeln.",
    },
    cloud: {
      intro:
        "Entwickeln Sie dieselben Apps, ohne etwas zu installieren. Beschreiben Sie, was Sie möchten, und der Agent schreibt und führt den Code in einem von Builder gehosteten Workspace aus.",
      stepOneTitle: "Ein Builder-Konto erstellen",
      stepOneBody:
        "Verwenden Sie Ihr Builder-Konto, um im Browser zu entwickeln. Kostenlos starten, ohne eigene API-Schlüssel.",
      stepTwoTitle: "Legen Sie mit Ihrem Prompt los",
      stepTwoBody:
        "Beschreiben Sie in klarer Sprache, was Sie bauen möchten, und der Agent erstellt es für Sie.",
      stepThreeTitle: "Bereitstellen",
      stepThreeBody:
        "Wenn Sie bereit sind, stellen Sie Ihren Agenten und seine UI mit einem Klick in Builder bereit.",
    },
  },
  templatesPage: {
    title: "Open-Source-Agent-Native Apps, die Sie besitzen",
    eyebrow:
      "Starte mit einer funktionierenden App und lass sie vom Agenten weiterentwickeln.",
    body: "Du kannst alles anpassen.",
    firstPartyTitle: "Von Agent-Native erstellt",
    community:
      "Du möchtest lieber eine leere App? Starte von Grund auf mit dem Framework-Guide.",
    createYourOwn: "Von Grund auf starten",
    communityTitle: "Community-Apps",
    communityDescription:
      "Entdecke Apps, die von ihren Autorinnen und Autoren gepflegt werden. Teste eine gehostete Version oder prüfe den Quellcode und passe ihn selbst an.",
    submitCommunityTemplate: "App einreichen",
    communityEmpty:
      "Die Community-Liste ist offen. Veröffentliche eine fokussierte Agent-Native-App und reiche sie für den Katalog ein.",
    publishGuide: "Veröffentlichungsleitfaden lesen",
    communityTrust:
      "Community-Apps sind Code von Drittanbietern. Prüfe Quellcode, Lizenz, Abhängigkeiten und Installationsskripte vor der Ausführung.",
    copyCommunityInstallCommand: "Installationsbefehl kopieren",
    viewRepository: "Repository ansehen",
    tryCommunityDemo: "Demo testen",
    customizeDescription: "Nutze diese App als Ausgangspunkt.",
    customizeOnline: "Online",
    customizeOnlineBadge: "Warteliste beitreten",
    customizeLocally: "Lokal",
    communityNew: "Neu",
    communityComingSoon: "Demnächst",
    communityGithubStars: "{{count}} GitHub-Sterne",
    tryCommunityApp: "App testen",
    viewCommunitySource: "Quellcode ansehen",
    communityEyebrow: "Community-App",
    communityScreenshots: "Screenshots",
    previousScreenshot: "Vorheriger Screenshot",
    nextScreenshot: "Nächster Screenshot",
    communityNoScreenshots: "Screenshots erscheinen hier nach der Prüfung.",
    communityScreenshotAlt: "{{name}} Screenshot {{index}}",
    communityNoHostedVersion:
      "Eine gehostete Version folgt bald. Verfolge die Entwicklung über den Quellcode.",
    communitySubmissionTitle: "Community-App teilen",
    communitySubmissionDescription:
      "Zeige uns, wo deine App zu finden ist und was sie macht. Wir prüfen die Angaben vor der Veröffentlichung.",
    communitySubmissionName: "App-Name",
    communitySubmissionNamePlaceholder: "Kundensupport-Zentrale",
    communitySubmissionUrl: "App-URL",
    communitySubmissionUrlPlaceholder: "example.com",
    communitySubmissionDescriptionLabel: "Beschreibung",
    communitySubmissionDescriptionPlaceholder:
      "Was macht die App und für wen ist sie gedacht?",
    communitySubmissionRepository: "GitHub-Repository (optional)",
    communitySubmissionRepositoryPlaceholder: "github.com/owner/repository",
    communitySubmissionScreenshots: "Screenshots (optional)",
    communitySubmissionScreenshotsPlaceholder: "Bis zu 5 Bilder hierher ziehen",
    communitySubmissionScreenshotDropHint:
      "PNG, JPG oder WebP. Jeweils maximal 1,5 MB.",
    communitySubmissionScreenshotSlot: "Screenshot {{index}}",
    communitySubmissionScreenshotsAdd: "Screenshots hinzufügen",
    communitySubmissionScreenshotsCount: "{{count}} / 5 ausgewählt",
    communitySubmissionScreenshotRemove: "Screenshot {{index}} entfernen",
    communitySubmissionSubmit: "App einreichen",
    communitySubmissionReady:
      "Danke. Wir prüfen deine App vor der Veröffentlichung.",
    communitySubmissionNameError: "Gib einen App-Namen ein.",
    communitySubmissionDescriptionError: "Füge eine kurze Beschreibung hinzu.",
    communitySubmissionUrlError:
      "Gib einen gültigen App-Link ein, z. B. example.com.",
    communitySubmissionRepositoryError: "Gib einen GitHub-Repository-Link ein.",
    communitySubmissionScreenshotsError:
      "Verwende PNG-, JPG- oder WebP-Bilder mit jeweils maximal 1,5 MB und höchstens 5 Bilder.",
    communitySubmissionSubmitError:
      "Die Übermittlung ist gerade nicht möglich. Prüfe die markierten Felder und versuche es erneut.",
    communitySubmissionSubmitting: "Wird gesendet…",
  },
  buildFromScratch: {
    title: "Von Grund auf bauen",
    description:
      "Starte mit dem Framework-Leitfaden oder baue online mit dem Cloud-Coding-Agenten von Builder.io.",
    readDocs: "Dokumentation lesen",
    buildOnline: "Online bauen",
    popoverTitle: "Im Browser entwickeln",
    popoverBody:
      "Generiere schnell agent-native Apps in der Cloud mit Builder.io.",
    waitlistBody:
      "Builder.io kann eine agent-native App in der Cloud starten und anpassen — inklusive Actions, Auth, SQL-Status und Agent-Chat. Trag dich für frühen Zugriff in die Warteliste ein.",
    emailLabel: "E-Mail",
    emailPlaceholder: "du@firma.com",
    joinWaitlist: "Warteliste beitreten",
    joining: "Beitreten…",
    joined:
      "Du stehst auf der Warteliste. Wir mailen dir, sobald der Online-Build-Zugang verfügbar ist.",
    invalidEmail: "Gib eine gültige E-Mail-Adresse ein.",
    submitError:
      "Beitritt zur Warteliste fehlgeschlagen. Bitte versuche es erneut.",
    waitlistUnavailable:
      "Wartelisten-Anmeldungen sind in dieser Umgebung noch nicht verfügbar. Bitte nutze stattdessen die gehostete Dokumentationsseite.",
    launchBuilder: "Builder starten",
  },
  templateCard: {
    pasteIntoTerminal: "In Ihr Terminal einfügen.",
    newToCli: "Neu bei CLI?",
    screenshotAlt: "Screenshot der App {{name}}",
  },
  templateDetail: {
    allTemplates: "Alle Apps",
    notFoundMetaTitle: "App nicht gefunden — Agent-Native",
    notFoundTitle: "App nicht gefunden",
    notFoundBody:
      "Durchsuchen Sie den App-Katalog, um eine verfügbare App zu finden.",
    badge: "Agent-Native {{name}}",
    title: "{{name}}-App",
  },
  templates: {
    clips: {
      replaces: "Ersetzt oder erweitert Loom, Granola und Wisprflow",
      description:
        "Zeichnet Bildschirm, Meetings und Sprachnotizen auf, damit Agenten verstehen, was passiert ist, und handeln können.",
    },
    plan: {
      replaces: "Visueller Planmodus für Codex, Claude Code und Coding-Agenten",
      description:
        "Installiere visuelle Planung als app-backed Skill. Dein Coding-Agent kann strukturierte Pläne mit Diagrammen, Wireframes, Prototypen, Annotationen, Kommentaren und Review-Links öffnen.",
    },
    design: {
      replaces: "Ersetzt oder erweitert Design-Prototyping-Tools",
      description:
        "Verwandelt Prompts in interaktive Designs, die Ihrem Designsystem folgen, während der Agent jeden Bildschirm mit Feedback verfeinert.",
    },
    content: {
      replaces: "Ersetzt oder erweitert Obsidian für MDX, Notion, Google Docs",
      description:
        "Arbeitet mit Ihren Dokumenten, während ein Agent in Ihrem Stil schreibt, interaktive Inhalte erstellt und auf Ihrer Website veröffentlicht.",
    },
    slides: {
      replaces: "Ersetzt oder erweitert Google Slides, Pitch",
      description:
        "Erstellt markengerechte, bearbeitbare Präsentationen aus Prompts oder vorhandenen Folien, die ein Agent erstellen, bearbeiten und verfeinern kann.",
    },
    analytics: {
      replaces: "Open-Source-Alternative zu Amplitude und FullStory",
      description:
        "Verbindet Ihre Daten, damit ein Agent Fragen in Alltagssprache beantwortet und die Ergebnisse in Diagramme und Dashboards verwandelt.",
    },
    mail: {
      replaces: "Ersetzt oder erweitert Superhuman, Gmail",
      description:
        "Ein tastaturorientierter Posteingang, in dem ein Agent E-Mails priorisiert, Antworten entwirft, Threads zusammenfasst und nachfasst.",
    },
    forms: {
      replaces: "Ersetzt oder erweitert Typeform, Google Forms",
      description:
        "Agent-Nativer Formularersteller. Generieren Sie Formulare aus einer Eingabeaufforderung, bearbeiten Sie Felder visuell oder im Dialog und senden Sie Übermittlungen an Slack, Discord, Google Sheets oder Webhooks.",
    },
    assets: {
      replaces:
        "Ersetzt oder erweitert DAMs, Marken-Asset-Bibliotheken und AI-Mediengeneratoren",
      description:
        "Bietet Agenten eine gemeinsame Bibliothek aus Markenrichtlinien, Bildern und Videos, um in Apps markengerechte Medien zu erstellen und auszuwählen.",
    },
    calendar: {
      replaces: "Ersetzt oder erweitert Google Calendar, Calendly",
      description:
        "Führt Ihre Google-Kalender zusammen, damit ein Agent freie Zeiten findet, Termine plant oder verschiebt und Buchungen verwaltet.",
    },
    dispatch: {
      replaces: "Missionskontrolle für Ihre agentennativen Apps",
      description:
        "Zentralisierte Nachrichtenübermittlung und Verwaltung für jeden Agenten in Ihrem Stack. Sprechen Sie mit Ihren Agenten über Slack, Telegram oder das Internet. Leiten Sie Jobs weiter, halten Sie Speicher bereit, genehmigen Sie Aktionen und delegieren Sie Apps über A2A hinweg.",
    },
    chat: {
      replaces:
        "Eine minimalistische App im ChatGPT-Stil für Ihren eigenen Agenten",
      description:
        "Chat – erstes App-Gerüst mit dauerhaften Threads, einer Standard-Seitenleiste, Aktionen, Authentifizierung, Live-Synchronisierung und einem sauberen Pfad zum Hinzufügen von Bildschirmen oder zum Einbinden Ihres eigenen Agent-Backends.",
    },
  },
  templateLanding: {
    faq: {
      eyebrow: "Häufige Fragen",
      title: "Antworten auf häufige Fragen",
    },
    analytics: {
      faq: {
        question1: "Was ist Agent-Native Analytics?",
        answer1:
          "Agent-Native Analytics ist ein kostenloses Open-Source-KI-Analysetool. Stelle einem KI-Agenten Fragen zu verbundenen Daten, untersuche Abfragen und erstelle wiederverwendbare Dashboards. Es umfasst außerdem Sitzungswiedergabe, Fehlerverfolgung und Uptime-Monitoring.",
        question2: "Muss ich SQL können, um Analytics zu nutzen?",
        answer2:
          "Du kannst Fragen in einfacher Sprache stellen und deinen KI-Agenten die Abfragen schreiben lassen. Für BigQuery kannst du im Explorer auch Diagramme erstellen, indem du Tabellen, Kennzahlen und Filter auswählst. SQL bleibt zur Prüfung verfügbar, und jemand, der sich mit deinen Daten auskennt, muss möglicherweise beim Verbinden von Quellen und Definieren von Kennzahlen helfen.",
        question3: "Welche Datenquellen kann ich verbinden?",
        answer3:
          "Unterstützte Quellen umfassen BigQuery, Google Analytics 4, Amplitude, Mixpanel, PostHog, HubSpot und Stripe. Jede Quelle benötigt die passenden Zugangsdaten oder eine gemeinsame Workspace-Verbindung, die für Analytics freigegeben wurde. Die verfügbaren Antworten hängen von den Daten und Berechtigungen ab, die du verbindest.",
        question4: "Kann ich unsere eigenen Kennzahlendefinitionen verwenden?",
        answer4:
          "Ja. Nutze das Datenwörterbuch, um Definitionen, Tabellen- und Spaltennamen, Abfragebeispiele und Ausnahmen wie den Ausschluss interner Konten zu dokumentieren. Dein KI-Agent kann diese Definitionen beim Schreiben von Abfragen verwenden. Prüfe SQL und Ergebnisse, wenn du eine Geschäftskennzahl kontrollierst.",
        question5: "Kann ich Dashboards teilen und Berichte planen?",
        answer5:
          "Ja. Teile Dashboards mit Teammitgliedern oder deiner Organisation mit Betrachter-, Bearbeiter- oder Admin-Zugriff. Du kannst außerdem E-Mail-Berichte mit aktuellen Dashboard-Ergebnissen planen oder Alarme für Bedingungen konfigurieren, die du im Blick behalten willst.",
      },
      // V3-Landingpage-Texte (2026-09-14) — Hero bis finaler CTA unten.
      heroEyebrow: "Analytics",
      heroTitle:
        "Eine Frage stellen. Rufen Sie das Diagramm, die Abfrage und den Kontext ab.",
      heroDescription:
        "Führen Sie Lager-, Produkt- und Umsatzdaten zusammen. Der Agent überprüft Ihre Metrikdefinitionen, schreibt die SQL und wandelt die Antwort in ein wiederverwendbares Dashboard um.",
      heroCta: "Erkunde deine Daten",
      useCasesHeading: "Folgen Sie dem Signal von der Metrik bis zur Sitzung",
      useCasesBody:
        "Bewahren Sie die Begründung neben jedem Ergebnis auf und tragen Sie dann ein Diagramm in ein Dashboard oder eine Sitzungsuntersuchung ein.",
      useCase1Title: "Erklären Sie eine Änderung der Aktivierung",
      useCase1Body:
        "Vergleichen Sie Kohorten und Kanäle in einem Gespräch. Der Agent verwendet Ihre dokumentierten Metrikdefinitionen, schreibt die Abfrage und zeigt die Beweise für die Änderung an.",
      useCase2Title: "Erstellen Sie eine lebendige Umsatzübersicht",
      useCase2Body:
        "Bitten Sie den Agenten, Abrechnungs-, CRM- oder Lagermetriken in einem Dashboard zu kombinieren. Filter und Panels bleiben für Ihre nächste Überprüfung bestehen.",
      useCase3Title: "Verfolgen Sie eine Metrik auf eine echte Sitzung",
      useCase3Body:
        "Gehen Sie von einer Spitze oder einem Fehler zur Sitzung dahinter über. Überprüfen Sie die Konsolen- und Netzwerkaktivität und teilen Sie dann den temporären Diagnosekontext mit dem Agenten.",
      keyFeaturesEyebrow: "Wichtige Funktionen",
      keyFeaturesHeading:
        "Alles, was du zum Abfragen, Visualisieren und Erkunden brauchst",
      feature1Title: "Fragen Sie über vernetzte Daten hinweg",
      feature1Body:
        "Stellen Sie eine Frage zu allen Lager-, Produkt- und Einnahmequellen. Der Agent wandelt die Antwort in ein Diagramm um und unterstützt Folgeaufschlüsselungen.",
      feature2Title: "Dashboards, die der Agent bearbeiten kann",
      feature2Body:
        "Lassen Sie den Agenten Panels, Filter und Aufgliederungen hinzufügen oder umgestalten. Änderungen bleiben in einem wiederverwendbaren Dashboard, das Ihr Team teilen kann.",
      feature3Title: "Sichtbarer SQL- und Metrikkontext",
      feature3Body:
        "Untersuchen Sie die Abfrage hinter einem Ergebnis und die zum Schreiben verwendete Metrikdefinition. Verfeinern Sie die SQL, wenn Sie mehr Kontrolle benötigen.",
      feature4Title: "Ein Arbeitsbereich für Datenquellen",
      feature4Body:
        "Verbinden Sie BigQuery, GA4, Produktanalysen, HubSpot und Stripe und erkunden Sie dann deren zulässige Daten über dieselbe App.",
      feature5Title: "Definitionen, denen der Agent folgt",
      feature5Body:
        "Dokumentieren Sie Metrikregeln, Verknüpfungen, Beispiele und bekannte Fallstricke. Analytics stellt dem Agenten diesen Kontext bereit, wenn er Abfragen schreibt.",
      feature6Title: "Sitzungswiedergabe mit Diagnose",
      feature6Body:
        "Springen Sie von einem Fehler zu einer Aufzeichnung mit Blick auf Konsolen- und Netzwerkereignisse. Teilen Sie einen temporären Diagnoselink für eine von Agenten unterstützte Untersuchung.",
      finalCtaHeading: "Starte mit einer Frage zu deinen Daten",
      finalCtaBody:
        "Verbinde eine Quelle und bitte deinen KI-Agenten um das erste Diagramm.",
      finalCtaButton: "Erkunde deine Daten",
      s001: "Screenshot der Vorlage Analytics",
      s002: "Datenanschlüsse",
      s003: "Diagrammtypen",
      s004: "Abfrage-Explorer",
      s005: "Natürliche Sprache",
      s006: "Alle Vorlagen",
      s007Primary: "Die Open-Source-Alternative zu",
      s007Secondary: "Amplitude und FullStory",
      s008: "Verbinden Sie jede Datenquelle, fordern Sie zur Eingabe eines beliebigen Diagramms auf, erstellen Sie wiederverwendbare Dashboards – der AI-Agent schreibt den SQL.",
      s009: "Ausprobieren",
      s010: "Was Sie tun können",
      s011: "Alles, was Sie zum Ersetzen Ihres Analyse-Stacks benötigen.",
      s012: "Abfragen in natürlicher Sprache",
      s013: "Fragen Sie in einfachem Englisch. Der Agent schreibt den SQL und erstellt das Diagramm.",
      s014: "Wiederverwendbare Dashboards",
      s015: "Persistente Dashboards mit Datumssteuerelementen, Unteransichten und in der Größe veränderbaren Panels.",
      s016: "Direkter BigQuery-Zugriff mit Verlauf, Zeilenanzahl und gemeinsam nutzbaren URLs.",
      s017: "Selbstverbesserung",
      s018: "Der Agent ändert die App selbst. Benötigen Sie einen neuen Diagrammtyp? Fragen Sie einfach.",
      s019: "Alles verbinden",
      s020: "Mehrere integrierte Anschlüsse für beliebte Dienste. Der Agent schreibt auf Anfrage neue.",
      s021: "CRM & Umsatz",
      s022: "Ingenieurwesen",
      s023: "GitHub, Jira, Sentry – PRs, Tickets, Sprints und Fehlerverfolgung.",
      s024: "Infrastruktur",
      s025: "Kommunikation",
      s026: "Inhalte & SEO",
      s027: "Gemeinschaft",
      s028: "Lebendes Datenwörterbuch",
      s029: "Metrikdefinitionen mit Abfragevorlagen, Join-Mustern, bekannten Fallstricken und Aktualisierungshäufigkeit. Synchronisiert von Notion mit Community-gesteuerter Validierung.",
      s030: "Abfragevorlagen und Beispielausgaben für jede Metrik",
      s031: "Vertrauen Sie der Bewertung und Validierung mit Gutachtergenehmigungen",
      s032: "AI-gestützte Metrikvorschläge und -erkennung",
      s033: "Datenverzögerung, Abhängigkeiten und gültige Datumsbereiche dokumentiert",
      s034: "Wöchentlich aktive Benutzer",
      s035: "Täglich",
      s036: "~2 Stunden",
      s037: "Ausgeschlossen sind interne @company-E-Mails",
      s038: "Validiert ✓",
      s039: "Wie es im Vergleich aussieht",
      s040: "Armaturenbrett UI",
      s041: "Ja, starr",
      s042: "No",
      s043: "Ja, vollständig anpassbar",
      s044: "Begrenzt",
      s045: "Ja, vergänglich",
      s046: "Ja, persistente Diagramme",
      s047: "Eingebaut SDKs",
      s048: "Manueller Upload",
      s049: "Mehrere Quellen + benutzerdefiniert",
      s050: "Datenwörterbuch",
      s051: "Einfach",
      s052: "Vollständige Metriken mit Kontext",
      s053: "Anpassung",
      s054: "Nur Konfiguration",
      s055: "Nur Aufforderung",
      s056: "Vollständiger Quellcode",
      s057: "Preise",
      s058: "Pro Sitzplatz, pro Veranstaltung",
      s059: "Abonnement",
      s060: "Kostenlos und Open Source",
      s061: "Beginnen Sie in wenigen Minuten",
      s062: "Starten Sie mit der Vorlage, verbinden Sie Ihre Daten und beginnen Sie mit der Erstellung von Dashboards.",
      s063: "Lesen Sie die Dokumente",
      s064: "Alle Vorlagen anzeigen",
    },
    calendar: {
      faq: {
        question1: "Was ist Agent-Native Calendar?",
        answer1:
          "Agent-Native Calendar ist ein kostenloser Open-Source-KI-Planungsassistent, der sich mit Google Calendar verbindet. Nutze einen KI-Agenten, um Termine zu verwalten und Besprechungstermine zu finden, oder teile Buchungslinks, damit andere Termine bei dir vereinbaren können.",
        question2: "Welche Kalender kann ich verbinden?",
        answer2:
          "Verbinde mehrere Google-Konten, um ihre Termine gemeinsam anzuzeigen. Neue und aktualisierte Termine werden in den Hauptkalender des ausgewählten Kontos geschrieben. Du kannst außerdem schreibgeschützte ICS- oder Webcal-Feeds anzeigen; das sind keine zweiseitigen Outlook- oder Apple-Calendar-Integrationen. Freigegebene Google-Kalender sind schreibgeschützt und blockieren keine Buchungsverfügbarkeit.",
        question3: "Was kann der KI-Agent mit meinem Kalender tun?",
        answer3:
          "Dein KI-Agent kann deinen Kalender prüfen, verfügbare Besprechungstermine finden und Termine erstellen oder verschieben. Wenn du ihn bittest, einen Termin zu finden, prüft er deine Verfügbarkeitsregeln und bestehenden Termine sowie – sofern zugänglich – die Verfügbarkeitsinformationen namentlich genannter Teilnehmer. Du wählst einen vorgeschlagenen Termin aus, bevor er das Meeting bucht.",
        question4:
          "Brauchen andere ein Konto, um ein Meeting mit mir zu buchen?",
        answer4:
          "Nein. Jeder mit deinem öffentlichen Buchungslink kann einen verfügbaren Termin auswählen und deine Buchungsfragen beantworten, ohne sich anzumelden. Nach der Buchung erhält die Person einen privaten Link, um das Meeting zu verschieben oder abzusagen.",
        question5:
          "Kann ein Buchungslink die Verfügbarkeit mehrerer Hosts prüfen?",
        answer5:
          "Ja. Füge erforderliche Co-Hosts hinzu, und Calendar prüft deren Verfügbarkeitsinformationen, bevor ein Termin angeboten wird. Damit auch die konfigurierten Arbeitszeiten jedes Co-Hosts berücksichtigt werden, müsst ihr eure Kalender gegenseitig als Overlay hinzufügen. Ohne diese gegenseitige Freigabe prüft Calendar nur die Verfügbarkeitsinformationen.",
      },
      s001: "Screenshot der Vorlage Calendar",
      // V3 landing page copy (2026-09-10) — hero through final CTA below.
      heroEyebrow: "Calendar",
      heroTitle:
        "Finden Sie Zeit, buchen Sie Besprechungen und passen Sie Ihren Tag mit einem Agenten an",
      heroDescription:
        "Der Kalender führt Ihre Google-Kalender und Verfügbarkeitsregeln zusammen, sodass der Agent gemeinsame Stellenangebote finden, Buchungen vorbereiten und bei der Aktualisierung von Ereignissen helfen kann.",
      heroCta: "Starte die Planung",
      useCasesHeading: "Überlassen Sie die Planungsdetails dem Agenten",
      useCasesBody:
        "Überprüfen Sie die tatsächliche Verfügbarkeit in allen Kalendern und überprüfen Sie dann einen klaren Vorschlag, bevor eine Besprechung erstellt oder verschoben wird.",
      useCase1Title:
        "Verwandeln Sie einen Buchungslink in ein vorbereitetes Meeting",
      useCase1Body:
        "Bieten Sie nur Zeiten an, die Arbeitszeiten, Kündigungsfristen und Puffer respektieren. Sammeln Sie die benötigten Details und fügen Sie dann den Videolink hinzu, wenn der Gast bucht.",
      useCase2Title: "Finden Sie einen Slot, den jeder machen kann",
      useCase2Body:
        "Bitten Sie den Agenten, die Frei-/Gebuchtzeiten der Teilnehmer und die Kalendereinblendungen zu vergleichen. Es gibt die freigegebene Öffnung und die überprüften Kalender zurück.",
      useCase3Title: "Planen Sie neu, ohne den Thread zu verlieren",
      useCase3Body:
        "Bitten Sie um einen späteren Zeitpunkt und lassen Sie den Agenten die Gäste überprüfen, die Besprechungsdetails speichern und die aktualisierte Einladung für Ihre Überprüfung vorbereiten.",
      keyFeaturesEyebrow: "Wichtige Funktionen",
      keyFeaturesHeading:
        "Alles, was du zum Planen, Buchen und Umplanen brauchst",
      feature1Title: "Planung in natürlicher Sprache",
      feature1Body:
        "Bitten Sie den Agenten, die Verfügbarkeit zu prüfen, einen Termin vorzuschlagen und eine Veranstaltung mit Gästen und Besprechungsdetails zu erstellen oder zu verschieben.",
      feature2Title: "Verfügbarkeit über mehrere Konten hinweg",
      feature2Body:
        "Zeigen Sie verbundene Google-Kalender gemeinsam an und beziehen Sie schreibgeschützte Feeds als Zeitplankontext ein.",
      feature3Title: "Buchungsseiten mit Aufnahme",
      feature3Body:
        "Erstellen Sie Links für verschiedene Meeting-Typen, legen Sie Dauer und Buchungsfragen fest und lassen Sie Gäste einen verfügbaren Termin auswählen.",
      feature4Title: "Regeln, die jeden Slot prägen",
      feature4Body:
        "Legen Sie Arbeitszeiten, Puffer, Benachrichtigungen, Zeitzone und Buchungshorizont fest, sodass vorgeschlagene und öffentliche Zeiten zu Ihrem Zeitplan passen.",
      feature5Title: "Echte Multi-Host-Prüfungen",
      feature5Body:
        "Fügen Sie die erforderlichen Co-Gastgeber hinzu und überprüfen Sie deren Frei/Gebucht-Verfügbarkeit, bevor Sie einen Termin anbieten. Der Kalender berücksichtigt bei Konfiguration auch gemeinsame Arbeitszeitüberlagerungen.",
      feature6Title: "Von Agenten verwaltete Besprechungsverfolgung",
      feature6Body:
        "Behalten Sie die Google Meet- oder Zoom-Details bei, während der Agent Veranstaltungsänderungen und aktualisierte Einladungen vorbereitet.",
      finalCtaHeading: "Trage dein nächstes Meeting in den Kalender ein",
      finalCtaBody:
        "Finde einen Termin mit deinem KI-Agenten oder verschicke einen Buchungslink.",
      finalCtaButton: "Starte die Planung",
      s002: "Calendar Aufrufe",
      s003: "Agentenaktionen",
      s004: "Arten von Buchungslinks",
      s005: "Alle Vorlagen",
      s006Primary: "Die Open-Source-Alternative",
      s006Secondary: "Google Calendar und Calendly",
      s007: "Google Calendar-Synchronisierung mehrerer Konten, konfigurierbare Verfügbarkeit und anpassbare Buchungslinks im Calendly-Stil – mit einem AI-Agenten, der in Ihrem Namen plant.",
      s008: "Ausprobieren",
      s009: "Bei der Anmeldung wird nur die grundlegende Google-Identität verwendet, bei der Verbindung mit der Calendar-Synchronisierung wird jedoch nach Kalenderzugriff gefragt. Einige Workspace-Administratoren benötigen möglicherweise eine Genehmigung für die gehostete Demo. Lokal ausführen, um Ihren eigenen Google OAuth-Client zu verwenden.",
      s010: "Was Sie tun können",
      s011: "Alles, was Sie zum Ersetzen Ihres Kalenders und Planungsstapels benötigen.",
      s012: "Mehrere Calendar-Ansichten",
      s013: "Monats-, Wochen- und Tagesansichten mit Drag-and-Drop-Ereignisverwaltung.",
      s014: "Planung natürlicher Sprache",
      s015: "Weisen Sie den Agenten an, einen Termin zu finden, ein Ereignis zu erstellen oder einen neuen Termin zu vereinbaren – den Rest erledigt er.",
      s016: "Anpassbare Buchungslinks",
      s017: "Erstellen Sie mehrere Buchungsseiten im Calendly-Stil mit unterschiedlicher Dauer und Verfügbarkeit. Besucher wählen einen Slot, der funktioniert.",
      s018: "Selbstverbesserung",
      s019: "Der Agent ändert die App selbst. Benötigen Sie eine neue Ansicht oder einen neuen Buchungsablauf? Fragen Sie einfach.",
      s020: "Verbinden Sie mehrere Google-Konten über OAuth 2.0. Rufen Sie Ereignisse aus allen Ihren Kalendern ab und erstellen Sie Ereignisse, die wieder mit Google synchronisiert werden.",
      s021: "Multi-Konto OAuth 2.0 mit automatischer Token-Aktualisierung",
      s022: "Pull-basierte Synchronisierung – keine Webhooks erforderlich",
      s023: "Ereignisse auf Google erstellen, aktualisieren und löschen",
      s024: "Erstellen Sie anpassbare Buchungslinks, über die jeder Zeit bei Ihnen buchen kann. Konfigurierbare Verfügbarkeitseinstellungen pro Buchungstyp.",
      s025: "Datumsauswahl + Zeitfensterauswahl",
      s026: "Respektiert Ihre Verfügbarkeit und bestehende Veranstaltungen",
      s027: "Besucherinformationserfassung + Bestätigung",
      s028: "Agentengesteuerte Planung",
      s029: "Der Agent führt Skripte aus, um Kalender zu synchronisieren, Ereignisse zu erstellen, die Verfügbarkeit zu prüfen und Buchungen zu verwalten. Alles durch natürliche Sprache.",
      s030: "„Synchronisiere mein Google Calendar für diesen Monat“",
      s031: "„Finden Sie nächsten Dienstag einen 30-minütigen Termin für eine Teambesprechung“",
      s032: "„Erstellen Sie jeden Wochentag um 9 Uhr einen wiederkehrenden Standup.“",
      s033: "„Zeigen Sie mir meine Verfügbarkeit für nächste Woche“",
      s034: "Wie es im Vergleich aussieht",
      s035: "Kalenderoberfläche",
      s036: "Voll, starr",
      s037: "Minimal",
      s038: "Vollständig, vollständig anpassbar",
      s039: "AI Planung",
      s040: "Natürliche Sprache, volle Kontrolle",
      s041: "Buchungsseite",
      s042: "Terminslots",
      s043: "Ja, begrenztes Branding",
      s044: "Vollständig anpassbar, eigene Domain",
      s045: "Anpassung",
      s046: "Nur Einstellungen",
      s047: "Nur Branding",
      s048: "Vollständiger Quellcode",
      s049: "Preise",
      s050: "Frei / Arbeitsbereich",
      s051: "$10+ / Monat pro Nutzer",
      s052: "Kostenlos und Open Source",
      s053: "Beginnen Sie in wenigen Minuten",
      s054: "Starten Sie mit der Vorlage, verbinden Sie Google Calendar und beginnen Sie mit der Planung mit AI.",
      s055: "Lesen Sie die Dokumente",
      s056: "Alle Vorlagen anzeigen",
      s057: "Hinweis zur gehosteten Demo",
      s058: "Zwei-Wege-Synchronisierung",
    },
    assets: {
      faq: {
        question1: "Was ist Agent-Native Assets?",
        answer1:
          "Agent-Native Assets ist eine kostenlose Open-Source-Markenbibliothek mit KI-Bild- und Videogenerierung. Organisieren Sie vorhandene Medien, stellen Sie Markenreferenzen bereit und arbeiten Sie mit einem KI-Agenten, um Assets projektübergreifend zu erzeugen, zu bearbeiten und wiederzuverwenden.",
        question2: "Wie nutzt Assets meine Markenrichtlinien?",
        answer2:
          "Fügen Sie Ihrem Markenkit Ihr Logo, Referenzbilder, Farben und Stilnotizen hinzu. Wiederverwendbare Vorlagen liefern Anweisungen für bestimmte Inhaltstypen. Ihr KI-Agent nutzt diesen Kontext, um die Generierung zu steuern, und Sie können die Ergebnisse vor dem Speichern überprüfen und verfeinern.",
        question3:
          "Kann ich vorhandene Bilder und Videos hochladen und organisieren?",
        answer3:
          "Ja. Laden Sie vorhandene Medien hoch oder importieren Sie ein Asset über eine URL und organisieren Sie es zusammen mit generierten Inhalten in Bibliotheken und Ordnern. Sie können die Bibliothek durchsuchen, Assets als Referenzen wiederverwenden oder für ein anderes Projekt exportieren.",
        question4:
          "Kann mein KI-Agent Assets aus einer anderen App heraus verwenden?",
        answer4:
          "Ja. Verbinden Sie einen unterstützten Agenten über die MCP-Integration von Assets, um Medien im Chat zu suchen, zu generieren und auszuwählen. Agent-Native-Apps können Assets auch anfordern oder eine Auswahl einbetten. Der verfügbare Funktionsumfang hängt von der Host-App und ihrer Verbindung zu Assets ab.",
        question5:
          "Kann Assets mein tatsächliches Logo in generierten Bildern verwenden?",
        answer5:
          "Ja. Legen Sie ein kanonisches Logo in Ihrem Markenkit fest und aktivieren Sie das Logo-Compositing für die Generierung. Assets platziert das Originallogo nach der Generierung auf dem Bild, sodass das Bildmodell es nicht neu zeichnet. Überprüfen Sie die Platzierung und das umgebende Bild vor der Verwendung.",
      },
      s001: "Screenshot der Vorlage Assets",
      imageCredits: "Bildnachweise",
      // V3 landing page copy (2026-09-11) — hero through final CTA below.
      heroEyebrow: "Assets",
      heroTitle: "Generieren Sie in einem Gespräch markengerechte Bilder",
      heroDescription:
        "Beschreiben Sie, was Sie benötigen, geben Sie Ihrem Agenten ein Markenpaket oder eine Referenz und vergleichen Sie die generierten Varianten direkt während des Gesprächs.",
      heroCta: "Generiere ein Bild",
      useCasesHeading: "Was können Sie mit Assets tun?",
      useCasesBody:
        "Erstellen Sie Kampagnenbilder, passen Sie Visuals für neue Projekte an oder geben Sie Ihrem Team und Ihren KI-Agenten eine gemeinsame Markenbibliothek.",
      useCase1Title: "Kampagnen-Visuals erstellen",
      useCase1Body:
        "Bitten Sie Ihren KI-Agenten um Blogbilder, Social-Media-Grafiken oder Launch-Visuals anhand Ihrer Markenreferenzen. Vergleichen Sie die Optionen und verfeinern Sie die ausgewählte.",
      useCase2Title: "Bilder für neue Projekte anpassen",
      useCase2Body:
        "Geben Sie Ihrem KI-Agenten ein vorhandenes Bild und beschreiben Sie die gewünschten Änderungen, etwa einen anderen Hintergrund oder Platz für eine Überschrift.",
      useCase3Title: "Markenmaterial teamübergreifend teilen",
      useCase3Body:
        "Bewahren Sie Logos, Produktbilder und Markenreferenzen an einem Ort auf, damit Teammitglieder und verbundene KI-Agenten Medien für Präsentationen, Websites und andere Projekte finden.",
      keyFeaturesEyebrow: "Wichtige Funktionen",
      keyFeaturesHeading:
        "Alles, was Sie zum Generieren, Verfeinern und Wiederverwenden brauchen",
      feature1Title: "Marken-Asset-Bibliotheken",
      feature1Body:
        "Organisieren Sie hochgeladene und generierte Medien in Bibliotheken und Ordnern. Fügen Sie Logos, Referenzbilder und Stilnotizen für Ihren KI-Agenten hinzu.",
      feature2Title: "KI-Bild- und Videogenerierung",
      feature2Body:
        "Beschreiben Sie die benötigten Medien und wählen Sie Ihre Markenreferenzen aus. Generieren Sie Bildoptionen oder kurze Videos und prüfen Sie die Ergebnisse vor dem Speichern.",
      feature3Title: "Bildbearbeitung",
      feature3Body:
        "Bitten Sie Ihren KI-Agenten, ein Bild zu bearbeiten oder umzugestalten. Nutzen Sie ein vorhandenes Asset als Referenz und verfeinern Sie es durch Feedback.",
      feature4Title: "Wiederverwendbare Vorlagen",
      feature4Body:
        "Speichern Sie Generierungsanweisungen für wiederkehrende Arbeiten, etwa Blog-Titelbilder oder Social-Media-Grafiken. Verknüpfen Sie Vorlagen mit einem Markenkit, um dessen Referenzen wiederzuverwenden.",
      feature5Title: "Platzierung des Originallogos",
      feature5Body:
        "Legen Sie das Logo Ihres Markenkits fest und fügen Sie es generierten Bildern hinzu. Das Logo-Compositing platziert die Originaldatei, statt eine neue Version zu generieren.",
      feature6Title: "Agentenzugriff",
      feature6Body:
        "Verbinden Sie Ihren KI-Agenten, um die Bibliothek zu durchsuchen, Medien zu generieren und Assets im Chat auszuwählen. Unterstützte Apps können außerdem eine Asset-Auswahl einbetten.",
      finalCtaHeading: "Erstellen Sie Ihr nächstes Markenmaterial",
      finalCtaBody:
        "Wählen Sie Ihre Referenzen aus und teilen Sie Ihrem KI-Agenten mit, was Sie brauchen.",
      finalCtaButton: "Generiere ein Bild",
    },
    chat: {
      faq: {
        question1: "Was ist Agent-Native Chat?",
        answer1:
          "Agent-Native Chat ist eine kostenlose Open-Source-KI-Chat-App-Vorlage für Entwickler. Sie enthält gespeicherte Threads, eine Agent-Chat-Oberfläche, Authentifizierung, gemeinsame Actions und Live-Sync. Sie ergänzen die domänenspezifischen Daten und das Verhalten für Ihre Anwendung.",
        question2: "Ist Chat ein fertiger KI-Assistent?",
        answer2:
          "Chat liefert eine funktionierende Konversationsoberfläche und das Framework dahinter. Es enthält eine Beispiel-Action, aber Geschäftsworkflows und Provider-Integrationen implementieren und konfigurieren Sie selbst.",
        question3:
          "Kann ich Screens über die Chat-Oberfläche hinaus hinzufügen?",
        answer3:
          "Ja. Fügen Sie Routen und Komponenten für Listen, Warteschlangen, Editoren oder andere Ansichten hinzu, die Ihr Workflow benötigt. Verbinden Sie sie mit denselben Actions und Anwendungsdaten, die der Agent nutzt.",
        question4: "Enthält Chat Verbindungen zu meinen Geschäftstools?",
        answer4:
          "Die minimale Vorlage enthält keine domänenspezifischen Provider-Integrationen. Fügen Sie die Verbindungen und Zugriffsregeln hinzu, die Ihre App benötigt. Wenn eine bestehende Agent-Native-App bereits zu Ihrem Workflow passt, ist deren Vorlage möglicherweise der passendere Ausgangspunkt.",
        question5: "Kann ich meine eigene Version anpassen und bereitstellen?",
        answer5:
          "Ja. Erstellen Sie mit der CLI eine Kopie, fügen Sie Ihre Actions, Daten und Oberfläche hinzu und stellen Sie Ihre Anwendung bereit. Konfigurieren Sie Authentifizierung und Provider-Zugriff für Ihre Umgebung und testen Sie die hinzugefügten Workflows, bevor Sie sie mit Ihren Nutzern teilen.",
      },
      s001: "Screenshot der Chat-App",
      // V3 landing page copy (2026-09-14) — hero through final CTA below.
      heroEyebrow: "Chat",
      heroTitle: "Bauen Sie Ihre eigene KI-Chat-App",
      heroDescription:
        "Ein kostenloser Open-Source-Chat-Starter mit dauerhaften Threads, Authentifizierung, gemeinsamen Aktionen und einem Agenten, den Sie mit Ihren eigenen Tools und Bildschirmen erweitern können.",
      heroCta: "Baue deinen Chat",
      heroSecondaryCta: "Chat öffnen",
      useCasesHeading: "Verwandeln Sie Gespräche in Arbeitsassistenten",
      useCasesBody:
        "Fügen Sie die Aktionen, Daten und Bildschirme hinzu, mit denen Ihr Agent Fragen beantworten und die Arbeit vorantreiben kann.",
      useCase1Title: "Beantworten Sie Fragen im Kontext Ihres Teams",
      useCase1Body:
        "Verbinden Sie die Quellen, die Ihre App benötigt, durch Aktionen und lassen Sie dann den Agenten Notizen, Dateien und Projektdetails in einer Antwort zusammenfassen.",
      useCase2Title: "Geben Sie Ihrem Agenten Handlungswerkzeuge an die Hand",
      useCase2Body:
        "Erstellen Sie einen Prototyp eines Workflows im Chat, rufen Sie die von Ihnen definierten Aktionen auf und verfeinern Sie, wie der Agent jeden Schritt handhabt.",
      useCase3Title: "Ergebnisse nutzbar machen",
      useCase3Body:
        "Offene Agenten arbeiten in einer Warteschlange, Tabelle oder einem Editor, sodass Benutzer dieselben freigegebenen Daten überprüfen und fortfahren können.",
      keyFeaturesEyebrow: "Kernfunktionen",
      keyFeaturesHeading:
        "Ein Ausgangspunkt für Ihren Agenten und seine Oberfläche",
      feature1Title: "Dauerhafte Gespräche",
      feature1Body:
        "Erstellen, erneut öffnen, umbenennen, anpinnen und archivieren Sie Threads über die enthaltene Verlaufsseitenleiste.",
      feature2Title: "Ganzseitiger Agenten-Chat",
      feature2Body:
        "Beginnen Sie mit der Chat-Oberfläche und der Laufzeit, bereit für Ihre eigenen Anweisungen, Tools und Arbeitsabläufe.",
      feature3Title: "Verbinden Sie Ihre eigenen Dienste",
      feature3Body:
        "Fügen Sie Anbieteraktionen und Verbindungsflüsse für Tools wie Granola, Linear, Drive oder Notion hinzu; Der Starter überlässt diese Integrationen Ihrer App.",
      feature4Title: "Geteilte Aktionen",
      feature4Body:
        "Halten Sie Agent-Tools und Schnittstellenoperationen auf derselben Aktionsoberfläche.",
      feature5Title: "Status des Live-Arbeitsbereichs",
      feature5Body:
        "Halten Sie die aktuelle Navigation und ausgewählte Arbeit für Benutzer und Agent synchronisiert.",
      feature6Title: "Benutzerdefinierte Bildschirme",
      feature6Body:
        "Fügen Sie fokussierte Ansichten hinzu, wenn eine Konversation eine Warteschlange, einen Editor oder eine andere Domänenschnittstelle benötigt.",
      finalCtaHeading: "Bauen Sie Ihren ersten Agent-Workflow",
      finalCtaBody:
        "Erstellen Sie Ihre Kopie und fügen Sie die erste Action hinzu, die Ihre Nutzer brauchen.",
      finalCtaButton: "Baue deinen Chat",
    },
    clips: {
      s001: "Screenshot der Vorlage Clips",
      // V5 landing page copy (2026-09-09) — hero through final CTA below.
      heroEyebrow: "Clips",
      heroTitle: "Bildschirmaufnahmen, die dein KI-Agent sehen und hören kann",
      heroDescription:
        "Clips ist ein kostenloser Open-Source-Bildschirmrecorder zum Teilen von Fehlern, Feedback und Anleitungen mit KI-Agenten.",
      heroCta: "Clip aufnehmen",
      useCasesHeading: "Was kannst du mit Clips machen?",
      useCasesBody:
        "Starte mit einem selbst aufgenommenen Clip oder einem, der mit dir geteilt wurde. Gib deinem KI-Agenten den Kontext und sag ihm, was du brauchst.",
      useCase1Title: "Auf aufgezeichnetes Feedback reagieren",
      useCase1Body:
        "Gib deinem KI-Agenten aufgezeichnetes Feedback, damit er es in einen Plan verwandelt oder bei der Umsetzung der gewünschten Änderungen hilft.",
      useCase2Title: "Einen gemeldeten Fehler untersuchen",
      useCase2Body:
        "Teile eine Bug-Aufnahme mit deinem KI-Agenten, damit er untersucht, was schiefgelaufen ist, und die nächsten Schritte erarbeitet.",
      useCase3Title: "Aus einem aufgezeichneten Briefing erstellen",
      useCase3Body:
        "Nutze ein aufgezeichnetes Briefing, um deinen KI-Agenten bei der Erstellung einer Präsentation, eines Designs, eines Inhalts oder einer App-Änderung anzuleiten.",
      keyFeaturesEyebrow: "Wichtige Funktionen",
      keyFeaturesHeading:
        "Alles, was du zum Aufnehmen, Transkribieren und Teilen brauchst",
      feature1Title: "Für Agenten lesbare Aufnahmen",
      feature1Body:
        "Teile das Transkript und die zeitgestempelten Bilder eines Clips über einen einzigen, für Agenten lesbaren Link mit deinem KI-Agenten.",
      feature2Title: "Automatische Transkripte",
      feature2Body:
        "Erhalte Transkripte von Aufnahmen, Meetings und Diktaten. Klicke auf eine beliebige Transkriptzeile, um zu diesem Moment zu springen.",
      feature3Title: "Browser-Debug-Logs",
      feature3Body:
        "Erfasse Konsolenfehler und fehlgeschlagene Anfragen zusammen mit deiner Aufnahme mit der Clips-Chrome-Erweiterung.",
      feature4Title: "Integrierter KI-Agent",
      feature4Body:
        "Frag den integrierten KI-Agenten zu einem Clip oder deiner gesamten Bibliothek und lass ihn Transkripte im Chat bearbeiten.",
      feature5Title: "Durchsuchbare Aufnahmebibliothek",
      feature5Body:
        "Finde Clips, indem du ihre Transkripte durchsuchst. Organisiere deine Aufnahmen mit Ordnern, Tags und Team-Bereichen.",
      feature6Title: "Push-to-Talk-Diktat",
      feature6Body:
        "Halte Fn in der Desktop-App gedrückt, um in andere Apps zu diktieren. Sieh dir Transkripte und bereinigten Text in deinem Verlauf noch einmal an.",
      teammatesLine:
        "Deine Teammitglieder können sich dieselbe Aufnahme im Player ansehen.",
      teammatesLinkLabel: "Leitfaden zum Teilen mit Agenten lesen",
      seeInActionHeading: "Clips in Aktion sehen",
      seeInActionBody:
        "Sieh dir Clips im Einsatz an – von der Aufnahme eines Browser-Workflows bis dazu, einem KI-Agenten eine Aufgabe zu zeigen.",
      watchClipLabel: "Clip ansehen",
      finalCtaHeading: "Setze deinen nächsten Clip ein",
      finalCtaBody:
        "Nimm eine Erklärung auf oder bring einen geteilten Clip zu deinem KI-Agenten.",
      finalCtaButton: "Clip aufnehmen",
      s002: "Bildschirmaufzeichnung",
      s003: "Browser-Debug-Protokolle",
      s004: "Diktieren",
      s005: "Kann sehen + hören",
      s006: "Alle Vorlagen",
      s007Primary: "Bildschirmaufzeichnungen, die Ihre",
      s007Secondary: "AI sehen und hören kann.",
      s008: "Erfassen Sie Browser-Debug-Protokolle, erhalten Sie Transkripte und nutzen Sie das integrierte Diktat. 100 % kostenlos, Open Source und anpassbar.",
      s063: "Erhalten Sie eine personalisierte Empfehlung",
      s064: "Fügen Sie diese Eingabeaufforderung in Claude, ChatGPT oder Cursor ein, um zu sehen, wie Clips Ihren Workflow verändern kann.",
      s009: "Probieren Sie es aus",
      s010: "Was Sie tun können",
      s011: "Aufzeichnen, transkribieren und debuggen – eine App, eine Bibliothek, ohne den Abonnementstapel.",
      s012: "Bildschirmaufzeichnung mit einem Klick",
      s013: "Automatische Transkripte",
      s014: "Jede Bildschirmaufzeichnung, jedes Meeting und jedes Diktat erhält ein vollständiges Transkript. Agenten können dies als Audioebene verwenden und Zuschauer können auf eine beliebige Zeile klicken, um zu diesem Moment zu springen.",
      s015: "Push-to-Talk-Diktat",
      s016: "Durchsuchbare Video-Bibliothek",
      s017: "Bildschirmaufzeichnungen, Besprechungsprotokolle und Diktate werden alle zusammen indiziert. Durchsuchen Sie Ihre gesamte Bibliothek nach dem Gesagten, nicht nur nach dem Titel.",
      s018: "Volltextsuche in jedem Transkript",
      s019: "Ordner, Tags und Teamarbeitsbereiche",
      s020: "Kommentare und Reaktionen mit Zeitstempel",
      s021: "Gebrandete Spielerseite",
      s022: "Hosten Sie den Spieler selbst. Passen Sie die Marke, den Call-to-Action und die Analysen individuell an – es ist Ihr Code.",
      s023: "Benutzerdefinierte Domain und Themes",
      s024: "Anzahl der Aufrufe, Watch-Through-Rate, Drop-off",
      s025: "Einbettbar auf jeder Website",
      s026: "Agentengesteuerte Video-Workflows",
      s027: "Fragen Sie den Agenten etwas über Ihre Bibliothek oder fügen Sie einen freigegebenen Clips-Link in einen anderen Agenten ein – er kann Transkripte lesen, mit Zeitstempeln versehene Frames überprüfen, die erfassten Konsolenfehler und fehlgeschlagenen Anfragen hinter einem Fehler lesen und schriftliche Folgemaßnahmen aus Ihren Aufzeichnungen erstellen.",
      s028: "„Aktionselemente aus dem heutigen Standup ziehen“",
      s029: "„Finden Sie das Diktat, in dem ich den Startplan beschrieben habe“",
      s030: "„Entwerfen Sie eine Folge-E-Mail zu diesem Meeting.“",
      s031: "„Lesen Sie die Konsolenfehler in diesem Bugclip und schlagen Sie eine Lösung vor.“",
      s032: "Wie es im Vergleich aussieht",
      s033: "Bildschirmaufnahme",
      s034: "Ja",
      s035: "No",
      s036: "Browser-Debug-Erfassung (Konsole + Netzwerk)",
      s037: "Calendar-synchronisierte Besprechungsnotizen",
      s038: "Push-to-Talk-Diktat",
      s039: "AI Zusammenfassungen und Aktionselemente",
      s040: "Begrenzt",
      s041: "Vollständiger Agent: Kapitel, Aktionen, Q&A",
      s042: "Agent bearbeitet Transkripte und Code",
      s043: "Einfügbare Agenten-Medienlinks",
      s044: "Nur Transkript",
      s045: "Protokoll + Screenshot-Paket",
      s046: "Nur Notizen",
      s047: "Nur Text",
      s048: "Transkript + zeitgestempelte Frames",
      s049: "Dateneigentum",
      s050: "Lager des Anbieters",
      s051: "Cloud des Anbieters",
      s052: "Ihre Daten und sogar der App-Code selbst gehören Ihnen.",
      s053: "Preise",
      s054: "$15-30 / Monat pro Nutzer",
      s055: "Kostenlose + kostenpflichtige Stufen",
      s056: "$18-25 / Monat pro Nutzer",
      s057: "$12-15 / Monat pro Nutzer",
      s058: "Kostenlos und Open Source",
      s059: "Jetzt starten",
      s060: "Wählen Sie aus, was Sie aufnehmen möchten, und starten Sie dann die Aufnahme in Clips.",
      s062: "Alle Vorlagen anzeigen",
      faq: {
        question1: "Was ist Agent-Native Clips?",
        answer1:
          "Agent-Native Clips ist ein kostenloser Open-Source-Bildschirmrecorder zum Teilen von Fehlern, Feedback und Anleitungen mit KI-Agenten. Er gibt deinem KI-Agenten ein Transkript und zeitgestempelte Bilder einer Aufnahme, während Menschen sich denselben Clip ansehen können.",
        question2: "Kann ich Aufnahmen mit Claude, ChatGPT oder Cursor teilen?",
        answer2:
          "Clips stellt einen für Agenten lesbaren Link mit Transkript und zeitgestempelten Bildern bereit. Dein Agent muss den verlinkten Inhalt öffnen und Bilder lesen können, um beides zu nutzen. Manche Chat-Modi können das Transkript lesen, benötigen aber ein separat hochgeladenes Bild.",
        question3:
          "Brauche ich die Chrome-Erweiterung, um meinen Bildschirm aufzunehmen?",
        answer3:
          "Nein. Du kannst in der Clips-Web-App aufnehmen. Nutze die Chrome-Erweiterung, wenn du zusätzlich Konsolenmeldungen und Netzwerkdiagnosen aus dem gezeigten Tab möchtest.",
        question4: "Können KI-Agenten meine Bildschirmaufnahmen ansehen?",
        answer4:
          "Mit Clips können kompatible KI-Agenten deine Aufnahme über ein Transkript und zeitgestempelte Bilder verstehen. Sie nutzen den Text und die Bilder statt das Video abzuspielen, sodass du Fragen zum Geschehenen stellen oder deinem KI-Agenten eine Aufgabe auf Basis der Aufnahme geben kannst.",
        question5: "Wer kann auf eine geteilte Aufnahme zugreifen?",
        answer5:
          "Aufnahmen verwenden standardmäßig öffentliche Links, sofern deine Organisation diese Einstellung nicht ändert. Jeder mit dem Link kann darauf zugreifen. Optionen für privaten und organisationsweiten Zugriff sind verfügbar, und private Clips können über temporäre Links mit Agenten geteilt werden, ohne die Aufnahme öffentlich zu machen.",
      },
      quickStart: {
        recordingMode: "Aufnahmemodus",
        modeScreenCamera: "Bildschirm + Kamera",
        modeScreenOnly: "Nur Bildschirm",
        modeCameraOnly: "Nur Kamera",
        captureSource: "Aufnahmequelle",
        surfaceWindow: "Fenster",
        surfaceBrowser: "Browser-Tab",
        surfaceScreen: "Bildschirm",
        audioSource: "Audioquelle",
        defaultMicrophone: "Standardmikrofon",
        startRecording: "Aufnahme starten",
        uploadVideo: "Video hochladen",
        importLoom: "Aus Loom importieren",
      },
    },
    content: {
      faq: {
        question1: "Was ist Agent-Native Content?",
        answer1:
          "Agent-Native Content ist ein kostenloser Open-Source-Arbeitsbereich für Dokumente, Aufgaben und Datenbanken. Er kombiniert einen KI-Dokumenteditor mit strukturierten Tabellen und gemeinsamen Seiten, die Menschen und verbundene KI-Agenten gemeinsam lesen und bearbeiten können.",
        question2: "Kann ich meinen eigenen KI-Agenten mit Content verwenden?",
        answer2:
          "Ja. Content bietet eine MCP-Verbindung für unterstützte Tools wie Claude Code, Codex und Cursor. Nach dem Verbinden und Autorisieren des Zugriffs kann dein Agent mit den Dokumenten und Datenbanken arbeiten, auf die er Zugriff hat. Du kannst auch den in Content integrierten Agenten verwenden.",
        question3:
          "Kann ich die KI bitten, meinen Text zu überprüfen, ohne ihn umzuschreiben?",
        answer3:
          "Ja. Bitte deinen KI-Agenten, Kommentare zu einem Dokument oder einer Textstelle zu hinterlassen. Du kannst das Feedback lesen und die Änderungen selbst vornehmen oder den Agenten bitten, den Text zu bearbeiten. Um Kommentare zu erhalten, musst du den Text nicht aus der Hand geben.",
        question4: "Kann Content Aufgaben verfolgen und Team-Anfragen sammeln?",
        answer4:
          "Ja. Erstelle eine Datenbank mit Feldern wie Verantwortlicher, Status, Liefertermin und nächstem Schritt. Füge Beschreibungen hinzu, die erklären, was in jedes Feld gehört. Diese Beschreibungen leiten deinen KI-Agenten beim Erstellen oder Aktualisieren von Einträgen, einschließlich der Nachfrage nach fehlenden Informationen.",
        question5:
          "Kann ich kontrollieren, wer meine Arbeit bearbeitet, und eine frühere Version wiederherstellen?",
        answer5:
          "Ja. Neue Dokumente sind standardmäßig privat. Teile sie mit Betrachter-, Bearbeiter- oder Admin-Zugriff und nutze den Versionsverlauf der Seite, um einen früheren Stand wiederherzustellen. Das Wiederherstellen eines Stands ersetzt den aktuellen Inhalt der Seite.",
      },
      s001: "Screenshot der Vorlage Content",
      // V4 landing page copy (2026-09-14) — hero through final CTA below.
      heroEyebrow: "Content",
      heroTitle: "Erstelle und organisiere deine Arbeit mit deinem KI-Agenten",
      heroDescription:
        "Content ist ein kostenloser Open-Source-Arbeitsbereich für Dokumente, Aufgabenlisten und Datenbanken, die du und deine KI-Agenten gemeinsam lesen und bearbeiten könnt.",
      heroCta: "Organisiere deine Arbeit",
      useCasesHeading: "Was kannst du mit Content machen?",
      useCasesBody:
        "Arbeite an einem Entwurf, behalte im Blick, was noch zu erledigen ist, oder sammle die Details für eine neue Anfrage.",
      useCase1Title: "Content schreiben und überarbeiten",
      useCase1Body:
        "Bitte deinen KI-Agenten, eine Seite zu entwerfen, eine Passage zu überarbeiten oder Kommentare zu deinem Text zu hinterlassen. Entscheide selbst, wie er dir helfen soll.",
      useCase2Title: "Arbeit mit deinen Agenten verfolgen",
      useCase2Body:
        "Halte Aufgaben, Status und nächste Schritte in einer gemeinsamen Tabelle fest. Bitte deine verbundenen KI-Agenten, sie zu aktualisieren, während du ein Projekt bearbeitest.",
      useCase3Title: "Projektanfragen sammeln",
      useCase3Body:
        "Richte eine Tabelle für Design-Anfragen oder andere Teamarbeit ein. Gib jedem Feld Anweisungen, damit dein KI-Agent nach fehlenden Details fragen kann.",
      keyFeaturesEyebrow: "Wichtige Funktionen",
      keyFeaturesHeading:
        "Alles, was du zum Schreiben, Organisieren und Zusammenarbeiten brauchst",
      feature1Title: "KI-Schreiben und -Überarbeitung",
      feature1Body:
        "Hol dir einen ersten Entwurf, fordere Änderungen an markiertem Text an oder bitte um Kommentare. Dein KI-Agent arbeitet direkt im Dokument.",
      feature2Title: "Dokumente und verschachtelte Seiten",
      feature2Body:
        "Schreibe Seiten mit Überschriften, Tabellen, Bildern und Codeblöcken. Gruppiere zugehörige Dokumente unter einem Projekt und durchsuche Titel und Inhalt, um sie zu finden.",
      feature3Title: "Datenbanken und Ansichten",
      feature3Body:
        "Organisiere Arbeit in Tabellen, Boards oder Kalendern. Füge Felder für Verantwortliche, Termine und Status hinzu — mit einem vollständigen Dokument hinter jeder Zeile.",
      feature4Title: "Anweisungen für Seiten und Felder",
      feature4Body:
        "Beschreibe, was auf eine Seite oder in ein Datenbankfeld gehört. Gib deinen KI-Agenten Hinweise zu den Informationen und dem Format, das du erwartest.",
      feature5Title: "Verbundene KI-Agenten",
      feature5Body:
        "Verbinde Agenten aus Tools wie Claude Code, Codex oder Cursor, um zusammen mit dem integrierten Agenten deine Dokumente und Datenbanken zu lesen und zu aktualisieren.",
      feature6Title: "Teamzusammenarbeit",
      feature6Body:
        "Bearbeite Seiten gemeinsam, kommentiere Textstellen und antworte in Threads. Teile sie mit bestimmten Personen oder deiner Organisation und lege deren Zugriffsebene fest.",
      finalCtaHeading: "Bring dein nächstes Projekt in Content",
      finalCtaBody:
        "Starte mit einem Dokument, einer Aufgabenliste oder einer Tabelle, die dein Team bereits nutzt.",
      finalCtaButton: "Organisiere deine Arbeit",
      s002: "Alle Vorlagen",
      s003: "Open-Source-Obsidian für MDX",
      s004: "Bearbeiten Sie lokale Markdown/MDX-Dateien wie Obsidian, generieren Sie umfangreiche interaktive benutzerdefinierte Blöcke und schreiben Sie mit einem AI-Agenten, der Ihre Dokumente kennt.",
      s005: "Ausprobieren",
      s006: "Schreiben",
      s007: "Umfangreicher Editor für lokale Markdown/MDX mit Formatierung, Überschriften, Codeblöcken und Medien.",
      s008: "Verfeinern mit AI",
      s009: "Schreiben Sie jede Auswahl neu, erweitern Sie sie, fassen Sie sie zusammen oder ändern Sie den Ton.",
      s010: "Erstellen Sie MDX-Blöcke",
      s011: "Generieren Sie interaktive Komponenten und halten Sie sie in Ihren Dokumenten bearbeitbar.",
      s012: "Alles was Sie brauchen",
      s013: "Ein vollständiger Inhaltsarbeitsbereich – wie Obsidian für MDX, mit Zusammenarbeit im Notion-Stil, wenn Sie sie brauchen.",
      s014: "Projekte & Dokumente",
      s015: "Organisieren Sie Projekte mit verschachtelten Dokumenten. Navigation und Suche im Seitenleistenbaum.",
      s016: "Markenbewusst AI",
      s017: "Der Agent lernt Ihre Stimme, Ihren Styleguide und Ihren Ton. Jeder Entwurf klingt nach Ihnen.",
      s018: "Zwei-Wege-Notion-Synchronisierung. Importieren Sie Seiten aus Notion, bearbeiten Sie sie lokal und übertragen Sie Änderungen zurück.",
      s019: "Lokale Markdown/MDX-Dateien",
      s020: "Bearbeiten Sie Repo-Dokumente direkt wie Obsidian, zeigen Sie Änderungen in der Vorschau an und synchronisieren Sie sie wieder, wenn Sie den gehosteten Modus verwenden.",
      s021: "Benutzerdefinierte MDX-Blöcke",
      s022: "Generieren Sie interaktive lokale Komponenten, fügen Sie sie in MDX ein und bearbeiten Sie ihre Requisiten aus dem Dokument UI.",
      s023: "Skriptautomatisierung",
      s024: "Batch-Content-Generierung, Querverweise und Veröffentlichungspipelines.",
      s025: "Selbstverbesserung",
      s026: "Der Agent ändert die App selbst. Benötigen Sie einen neuen Workflow? Fragen Sie einfach.",
      s027: "Hier schreiben, überall veröffentlichen",
      s028: "Stellen Sie über Skripte eine Verbindung zu jedem Headless-CMS her. Der Agent übernimmt den gesamten Workflow.",
      s029: "Der Agent führt Veröffentlichungsskripte autonom aus",
      s030: "Markdown, HTML oder jedes beliebige Format, das Sie bevorzugen",
      s031: "Optionale lokale Markdown/MDX-Synchronisierung für File-First-Workflows",
      s032: "Entwerfen Sie Inhalte im Editor",
      s033: "„Veröffentlichen Sie dies an WordPress“",
      s034: "Der Agent führt das Veröffentlichungsskript aus",
      s035: "Content live auf Ihrer Website",
      s036: "Wie es im Vergleich aussieht",
      s037: "Herausgeber UI",
      s038: "Voll, starr",
      s039: "Nur Chat",
      s040: "Vollständig, anpassbar",
      s041: "Markenbekanntheit",
      s042: "Pro Gespräch",
      s043: "Beharrlich, geschult",
      s044: "Lokale MDX-Dateien",
      s045: "Markdown in einigen Tools",
      s046: "Manuelles Kopieren und Einfügen",
      s047: "Direkte Dateibearbeitung mit benutzerdefinierten Blöcken",
      s048: "CMS-Veröffentlichung",
      s049: "Separater Schritt",
      s050: "Integrierter Workflow",
      s051: "Anpassung",
      s052: "Nur Plugins",
      s053: "Nur Aufforderung",
      s054: "Vollständiger Quellcode",
      s055: "Preise",
      s056: "Pro Sitzplatz",
      s057: "Abonnement",
      s058: "Kostenlos und Open Source",
      s059: "Beginnen Sie in wenigen Minuten",
      s060: "Bringen Sie Ihre MDX-Dokumente mit, generieren Sie interaktive Blöcke und beginnen Sie mit dem Schreiben mit AI.",
      s061: "Lesen Sie die Dokumente",
      s062: "Alle Vorlagen anzeigen",
    },
    design: {
      faq: {
        question1: "Was ist Agent-Native Design?",
        answer1:
          "Agent-Native Design ist ein kostenloses Open-Source-Tool für KI-Design und Prototyping. Erstelle mit einem KI-Agenten interaktive HTML-Prototypen, wende deine Marke an und verfeinere Designs mit visuellen Steuerelementen oder im Chat. Teile das Ergebnis für Feedback oder exportiere es für die Entwicklung.",
        question2:
          "Kann ich ein Design bearbeiten, nachdem die KI es generiert hat?",
        answer2:
          "Ja. Passe Text, Abstände und Stil mit visuellen Steuerelementen an, oder bitte den KI-Agenten, das Design zu ändern. Du kannst verschiedene Richtungen vergleichen und die gewählte weiter verfeinern.",
        question3: "Kann ich mein eigenes Design-System verwenden?",
        answer3:
          "Ja. Verknüpfe ein Design-System, um Farben, Typografie, Stil und Markenvorgaben festzulegen. Du kannst es über mehrere Designs hinweg wiederverwenden und als Kontext für die Überarbeitungen des KI-Agenten nutzen.",
        question4: "Kann ich mit Designs aus Figma arbeiten?",
        answer4:
          "Ja. Design unterstützt Figma-Importe und einen speziellen Figma-fähigen SVG-Export. Überprüfe nach der Übertragung eines Designs Schriften, Layouts und bearbeitbare Elemente, da die Kompatibilität von Quelle und Exportformat abhängt.",
        question5: "Was kann ich exportieren, und ist es eine fertige App?",
        answer5:
          "Exportiere HTML oder ein ZIP der Design-Dateien, oder bereite eine Übergabe für einen Coding-Agenten vor. Der Prototyp bietet einen Ausgangspunkt für die Entwicklung; Anwendungslogik, Integrationen, Tests und Deployment müssen noch implementiert und geprüft werden. HTML-Exporte können externe Laufzeit-Ressourcen verwenden.",
      },
      s001: "Screenshot der Vorlage Design",
      // V4 landing page copy (2026-09-14) — hero through final CTA below.
      heroEyebrow: "Design",
      heroTitle: "Interaktive Prototypen mit deinem KI-Agenten gestalten",
      heroDescription:
        "Design ist ein kostenloses Open-Source-Tool für KI-Design und Prototyping, mit dem du markenkonforme Seiten und Produktoberflächen erstellst – mit Designs, die du selbst bearbeiten kannst.",
      heroCta: "Gestalte kostenlos",
      useCasesHeading: "Was kannst du mit Design machen?",
      useCasesBody:
        "Erkunde eine neue Seite, einen Produkt-Flow oder eine Oberfläche, bevor du sie baust. Gib deinem KI-Agenten das Briefing und die Details, auf die es ankommt.",
      useCase1Title: "Landingpage-Ideen erkunden",
      useCase1Body:
        "Verwandle ein Kampagnen- oder Produkt-Briefing in einen Landingpage-Prototyp. Bespreche Botschaft, Layout und Call-to-Actions mit deinem Team.",
      useCase2Title: "Produkt-Flows durcharbeiten",
      useCase2Body:
        "Prototype einen Onboarding-, Anmelde- oder Checkout-Flow. Gehe die Schritte durch und verfeinere das Erlebnis, bevor du dich auf die Umsetzung festlegst.",
      useCase3Title: "Dashboards und interne Tools gestalten",
      useCase3Body:
        "Verwandle Workflow-Anforderungen in ein Dashboard oder eine Admin-Oberfläche. Erkunde, wie Nutzer Informationen finden und ihre täglichen Aufgaben erledigen.",
      keyFeaturesEyebrow: "Wichtige Funktionen",
      keyFeaturesHeading:
        "Alles, was du zum Gestalten, Prototypen und Teilen brauchst",
      feature1Title: "Interaktive Prototypen",
      feature1Body:
        "Beschreibe die Seite oder den Flow, den du brauchst. Dein KI-Agent erstellt einen HTML-Prototyp mit Interaktionen, die du direkt in der Vorschau ausprobieren kannst.",
      feature2Title: "KI- und visuelle Bearbeitung",
      feature2Body:
        "Passe Text, Abstände und Stil mit visuellen Steuerelementen an, oder bitte deinen KI-Agenten, Layout und Interaktionen zu ändern.",
      feature3Title: "Design-Varianten nebeneinander",
      feature3Body:
        "Bitte deinen KI-Agenten um verschiedene Design-Richtungen. Vergleiche sie auf der Canvas, wähle einen Ansatz und verfeinere ihn weiter.",
      feature4Title: "Wiederverwendbare Markenstile",
      feature4Body:
        "Verknüpfe ein Design-System mit deinen Farben, deiner Typografie und deinem Stil. Nutze es, um neue Designs und Überarbeitungen in deinem Projekt zu leiten.",
      feature5Title: "Design-Feedback-Kommentare",
      feature5Body:
        "Hefte Feedback an ein bestimmtes Element, damit der Kontext klar bleibt. Schicke einen Kommentar an deinen KI-Agenten, um die Änderung durchzugehen.",
      feature6Title: "HTML-Export und Code-Übergabe",
      feature6Body:
        "Exportiere HTML oder ein ZIP deiner Design-Dateien. Gib einem Entwickler oder Coding-Agenten den Prototyp und den Kontext, um mit der Umsetzung fortzufahren.",
      finalCtaHeading: "Starte dein nächstes Design",
      finalCtaBody:
        "Bring ein Briefing mit. Erkunde die Möglichkeiten. Verfeinere die Details.",
      finalCtaButton: "Gestalte kostenlos",
      s002: "Beschreiben",
      s003: "Generieren",
      s004: "Verfeinern",
      s005: "Alle Vorlagen",
      s006: "Das Open-Source-Prototyping-Studio AI HTML",
      s007: "Erstellen Sie interaktive Designs und Prototypen. Verfeinern Sie sie mit gewohnten Werkzeugen oder nehmen Sie Konversationsbearbeitungen vor. Exportieren Sie überall hin.",
      s008: "Etwas gestalten",
      s009: "Wie es funktioniert",
      s010: "Alles was Sie brauchen",
      s011: "Ein Prototypenstudio mit einem Agenten, der die Quelle schreibt und verfeinert.",
      s012: "Komplette HTML-Prototypen",
      s013: "Generieren Sie eigenständige Alpine/Tailwind HTML, die im Vorschau-Iframe gerendert werden und direkt exportiert werden können.",
      s014: "Variantengenerierung",
      s015: "Beginnen Sie aus mehreren Richtungen, vergleichen Sie sie in der App und verfeinern Sie das stärkste Design weiter.",
      s016: "Optimieren Sie die Steuerelemente",
      s017: "Passen Sie allgemeine Designvariablen visuell an, während der Agent größere Struktur- und Kopieränderungen durchführt.",
      s018: "Konversationsbearbeitungen",
      s019: "„Machen Sie die Überschrift fetter“, „versuchen Sie es mit einer wärmeren Farbpalette“, „fügen Sie eine CTA-Schaltfläche hinzu“. Der Agent aktualisiert den zugrunde liegenden HTML.",
      s020: "Design Systeme",
      s021: "Speichern Sie wiederverwendbare Designsystemeinstellungen, damit neue Generationen näher an Ihrer Produktsprache bleiben.",
      s022: "Überall exportieren",
      s023: "Exportieren Sie HTML, ZIP oder PDF aus dem generierten Prototyp, wenn Sie zum Teilen oder Übergeben bereit sind.",
      s024: "Source-First-Vorschau",
      s025: "Die Vorschau wird aus derselben HTML gerendert, die der Agent bearbeitet und die der Export verwendet, sodass weniger Übersetzung zwischen Konzept und Übergabe erfolgt.",
      s026: "Iframe-Vorschau des generierten Prototyps",
      s027: "Exportierbare HTML-, ZIP- und PDF-Artefakte",
      s028: "Konversationsverfeinerung",
      s029: "Der Agent bearbeitet die Prototypquelle. Anweisungen in einfachem Englisch werden zu Änderungen an Text, Layout, Farben, Abständen und Interaktionen.",
      s030: "„Lassen Sie es hochwertiger aussehen“",
      s031: "„Versuchen Sie es mit einer dunkleren Farbpalette“",
      s032: "„Machen Sie das Helden-Layout redaktioneller“",
      s033: "„Generieren Sie drei Variationen davon“",
      s034: "Wie es im Vergleich aussieht",
      s035: "Statische Mockup-Tools",
      s036: "One-Shot-Generatoren",
      s037: "Visueller Editor",
      s038: "Visuell zuerst",
      s039: "Prompt-zuerst",
      s040: "Agent + Vorschau + Code",
      s041: "AI Generation",
      s042: "Begrenzt / Plugins",
      s043: "One-Shot-Eingabeaufforderung",
      s044: "Iterativ, gesprächig",
      s045: "Bearbeitbare Ausgabe",
      s046: "Tool-native Datei",
      s047: "Oft statisch",
      s048: "Vervollständigen Sie HTML/CSS/JS",
      s049: "Anpassung",
      s050: "Nur Plugins",
      s051: "Nur Aufforderung",
      s052: "Vollständiger Quellcode",
      s053: "Preise",
      s054: "Ab 15 $/Monat pro Nutzer",
      s055: "Bildnachweis pro Bild",
      s056: "Kostenlos und Open Source",
      s057: "Beginnen Sie in wenigen Minuten",
      s058: "Starten Sie mit der Vorlage und beginnen Sie mit der Erstellung interaktiver Prototypen mit einem Agenten, der die Quelle bearbeitet.",
      s059: "Lesen Sie die Dokumente",
      s060: "Alle Vorlagen anzeigen",
      s061: "100 % kostenlos, Open Source und anpassbar.",
    },
    dispatch: {
      faq: {
        question1: "Was ist Agent-Native Dispatch?",
        answer1:
          "Agent-Native Dispatch ist eine kostenlose Open-Source-KI-Agent-Orchestrierungs-App für einen Agent-Native-Workspace. Sie koordiniert Anfragen über verbundene Apps hinweg, empfängt Nachrichten von unterstützten Kanälen, plant wiederkehrende Aufgaben und verwaltet gemeinsame Integrationen.",
        question2: "Mit welchen Apps kann Dispatch zusammenarbeiten?",
        answer2:
          "Dispatch delegiert an Apps, die in deinem Workspace verbunden und verfügbar sind, etwa Analytics oder Mail. Jede App übernimmt ihre eigenen Aufgaben und Daten. Richte die entsprechenden Verbindungen und Berechtigungen ein, bevor du Dispatch bittest, sie zu nutzen.",
        question3: "Kann ich Dispatch über Slack oder Telegram nutzen?",
        answer3:
          "Ja. Richte den Nachrichtenkanal ein und verknüpfe bei Bedarf deine Identität mit deinem Workspace-Konto. Dispatch kann Anfragen über diesen Kanal empfangen und Ergebnisse zurückgeben. Das Verbinden eines Kanals gibt nicht automatisch jedem Absender Zugriff auf jede App.",
        question4: "Können Agents Aufgaben nach einem Zeitplan ausführen?",
        answer4:
          "Ja. Richte eine wiederkehrende Aufgabe ein und bei Bedarf ein Zustellziel für ihre Ergebnisse. Dispatch zeigt die letzte Ausführung, die nächste Ausführung und den Fehlerstatus der Aufgabe an, damit du prüfen kannst, ob sie erfolgreich lief.",
        question5: "Decken Dispatch-Freigaben alles ab, was ein Agent tut?",
        answer5:
          "Nein. In einem Team-Workspace kann Dispatch eine Überprüfung seiner eigenen Änderungen an gemeinsamen Ressourcen und Einstellungen verlangen. Aktionen innerhalb verbundener Apps, etwa das Versenden einer E-Mail, folgen den Kontrollen dieser Apps. Die Dispatch-Freigabe-Warteschlange ist kein universelles Tor für jede Agentenaktion.",
      },
      s001: "Screenshot der Vorlage Dispatch",
      // V3 landing page copy (2026-09-12) — hero through final CTA below.
      heroEyebrow: "Dispatch",
      heroTitle: "Koordiniere deine KI-Agents an einem Ort",
      heroDescription:
        "Dispatch ist eine kostenlose Open-Source-KI-Agent-Orchestrierungs-App, um Arbeit an verbundene Agent-Native-Apps zu delegieren, wiederkehrende Aufgaben zu planen und gemeinsame Verbindungen zu verwalten.",
      heroCta: "Delegiere eine Aufgabe",
      useCasesHeading: "Was kannst du mit Dispatch machen?",
      useCasesBody:
        "Bitte eine verbundene App um Hilfe, richte ein regelmäßiges Update ein oder untersuche einen Agentenlauf, der Aufmerksamkeit braucht.",
      useCase1Title: "Arbeit aus einer Unterhaltung delegieren",
      useCase1Body:
        "Bitte um eine Kennzahlen-Zusammenfassung oder einen Antwortentwurf. Dispatch leitet die Anfrage an den verbundenen Analytics- oder Mail-Agenten weiter und gibt das Ergebnis zurück.",
      useCase2Title: "Wiederkehrende Team-Updates einrichten",
      useCase2Body:
        "Plane eine tägliche Kennzahlen-Zusammenfassung oder einen wöchentlichen Digest aus deinen verbundenen Apps. Wähle einen konfigurierten Kanal oder ein Postfach, an das das Ergebnis gehen soll.",
      useCase3Title: "Agentenaktivität untersuchen",
      useCase3Body:
        "Prüfe die letzte Ausführung einer Aufgabe und etwaige Fehler. Nutze verfügbare Thread- und Überwachungsdetails, um zu untersuchen, was passiert ist, wenn ein Workflow Aufmerksamkeit braucht.",
      keyFeaturesEyebrow: "Wichtige Funktionen",
      keyFeaturesHeading:
        "Alles, was du zum Delegieren, Planen und Überwachen brauchst",
      feature1Title: "App-übergreifende Delegierung",
      feature1Body:
        "Sende Anfragen an die verbundene App, die die Arbeit erledigt. Jede App nutzt ihren eigenen Agenten, ihre Aktionen und Daten, um zu antworten.",
      feature2Title: "Messaging-Verbindungen",
      feature2Body:
        "Verbinde Kanäle wie Slack oder Telegram, um Anfragen zu senden und Antworten zu empfangen. Verknüpfe Identitäten, damit Dispatch weiß, welcher Workspace-Nutzer fragt.",
      feature3Title: "Geplante Aufgaben",
      feature3Body:
        "Gib wiederkehrender Arbeit einen Zeitplan. Sieh, ob eine Aufgabe aktiviert ist, wann sie zuletzt lief, ihre nächste Ausführung und etwaige protokollierte Fehler.",
      feature4Title: "Gespeicherte Zustellziele",
      feature4Body:
        "Speichere einen Slack-Kanal, einen Telegram-Chat oder eine E-Mail-Adresse als Zustellziel. Nutze es für geplante Ergebnisse wieder und prüfe den Zustellstatus.",
      feature5Title: "Gemeinsame Integrationen",
      feature5Body:
        "Richte eine Anbieterverbindung einmal ein und gewähre den Apps, die sie benötigen, Zugriff. Verwalte gemeinsame Verbindungen und App-Zugriff von Dispatch aus.",
      feature6Title: "Freigaben für Workspace-Änderungen",
      feature6Body:
        "Verlange, dass ein weiterer Admin Dispatchs Änderungen an gemeinsamen Ressourcen und Einstellungen überprüft. Prüfe ausstehende Anfragen und genehmige oder lehne sie in einem Team-Workspace ab.",
      finalCtaHeading: "Beginne mit einer verbundenen Aufgabe",
      finalCtaBody:
        "Wähle die Apps, die du brauchst, und bitte Dispatch, die Arbeit zu koordinieren.",
      finalCtaButton: "Delegiere eine Aufgabe",
      s002: "+ Telegram dabei",
      s003: "Inter-Agent",
      s004: "Erinnerung",
      s005: "Wiederkehrende Jobs",
      s006: "Alle Vorlagen",
      s007: "Die Heimatbasis Ihres Agenten",
      s008: "Sprechen Sie mit Ihrem Agenten über Slack, Telegram oder einen beliebigen Messenger und er wird an Ihre anderen Apps weitergeleitet. Jobs, Speicher, Genehmigungen und A2A-Delegierung – alles an einem Ort.",
      s009: "Ausprobieren",
      s010: "Was Sie tun können",
      s011: "Dispatch ist die dem Messenger zugewandte Eingangstür für Ihren gesamten Agent-Native-Stack.",
      s012: "Bidirektionale Nachrichtenübermittlung mit Thread-Kontext, Block Kit-Antworten und Inline-Genehmigungen. Sprechen Sie von überall.",
      s013: "Dispatch leitet Arbeit über das A2A-Protokoll an Ihre anderen agentennativen Apps weiter. Mail, Folien, Design – alles über einen Chat erreichbar.",
      s014: "Wiederkehrende Jobs",
      s015: "Planen Sie die Ausführung des Agenten auf einem Cron – tägliche Standups, wöchentliche Zusammenfassungen, stündliche Überprüfungen. Die Ergebnisse landen in Ihrem Messenger.",
      s016: "Zulassungen",
      s017: "Schützen Sie sensible Aktionen hinter einer One-Tap-Genehmigung in Slack. Konfigurieren Sie pro Aktion: E-Mail senden, Update veröffentlichen, Automatisierung ausführen.",
      s018: "Persistenter Agentenspeicher",
      s019: "Dispatch merkt sich den Kontext über Konversationen, Threads und Kanäle hinweg. Sagen Sie ihm einmal Ihre Vorlieben – er übernimmt sie.",
      s020: "Automatisch erfasste Erkenntnisse aus jedem Gespräch",
      s021: "Speicherbereiche pro Benutzer, pro Organisation und global",
      s022: "Überprüfen und bearbeiten Sie, woran sich der Agent erinnert",
      s023: "App-übergreifendes Routing",
      s024: "Dispatch ist der Hub. Verbinden Sie Ihre anderen agentennativen Apps und jede Anfrage wird an den Agenten weitergeleitet, der die Aufgabe erledigen kann.",
      s025: "„Senden Sie ein Deck an das Designteam“ → Slides Agent",
      s026: "„Auf die neueste Vertriebs-E-Mail antworten“ → Mail Agent",
      s027: "„Ereignisse dieses Quartals zusammenfassen“ → Analytics Agent",
      s028: "Sprechen Sie von überall aus mit Ihrem Agenten",
      s029: "Schreiben Sie Ihrem Agenten eine DM unter Slack um 7 Uhr AM, setzen Sie sich von Telegram im Zug aus in Verbindung und erhalten Sie eine Antwort von Block Kit mit der Schaltfläche „Thread öffnen“, um in die vollständige Konversation einzusteigen.",
      s030: "„Was steht morgen in meinem Kalender?“",
      s031: "„Erstelle ein Deck für die Monday All-Hands“",
      s032: "„Machen Sie jeden Wochentag um 9 AM meinen morgendlichen Standup“",
      s033: "„Sagen Sie mir, wann die Bereitstellung abgeschlossen ist.“",
      s034: "Wie es im Vergleich aussieht",
      s035: "Geschlossene AI Assistenten",
      s036: "App-übergreifendes Routing",
      s037: "Pro-Bot",
      s038: "Einzelprodukt",
      s039: "Vom Anbieter definiert",
      s040: "Beharrlich, zielgerichtet, inspizierbar",
      s041: "Benutzerdefinierter Code",
      s042: "Begrenzt",
      s043: "Anpassung",
      s044: "SDK-Klempnerarbeiten",
      s045: "Geschlossen",
      s046: "Vollständiger Quellcode",
      s047: "Preise",
      s048: "Gebühren pro App",
      s049: "Ab 20 $/Monat pro Nutzer",
      s050: "Kostenlos und Open Source",
      s051: "Beginnen Sie in wenigen Minuten",
      s052: "Starten Sie mit der Vorlage, verbinden Sie Slack oder Telegram und beziehen Sie Ihren Agenten in jedes Gespräch ein.",
      s053: "Lesen Sie die Dokumente",
      s054: "Alle Vorlagen anzeigen",
    },
    forms: {
      faq: {
        question1: "Was ist Agent-Native Forms?",
        answer1:
          "Agent-Native Forms ist ein kostenloser Open-Source-KI-Formular-Builder. Erstelle Formulare und Umfragen mit einem KI-Agenten, bearbeite Felder visuell, veröffentliche einen öffentlichen Link und sieh dir die Antworten in derselben App an oder lass sie analysieren.",
        question2:
          "Kann ich ein Formular bearbeiten, nachdem die KI es erstellt hat?",
        answer2:
          "Ja. Ändere Fragen, Beschriftungen, Optionen, Pflichtfelder und die Feldreihenfolge im visuellen Editor, oder bitte deinen KI-Agenten, die Änderungen vorzunehmen. Beide Wege aktualisieren dasselbe Formular. Du kannst auch bedingte Fragen basierend auf vorherigen Antworten hinzufügen.",
        question3: "Brauchen Personen ein Konto, um mein Formular auszufüllen?",
        answer3:
          "Nein. Jeder mit dem öffentlichen Link eines veröffentlichten Formulars kann eine Antwort ohne Konto senden. Formulare im Entwurfsstatus sind nicht öffentlich, und geschlossene Formulare nehmen keine neuen Antworten mehr an.",
        question4: "Kann ich anonymes Feedback sammeln?",
        answer4:
          "Ja. Aktiviere den anonymen Modus, um die Identität der einreichenden Person und Quell-Metadaten wegzulassen. Lass außerdem Fragen nach Namen, E-Mail-Adressen oder anderen identifizierenden Angaben weg, wenn die Antworten anonym bleiben sollen.",
        question5: "Kann ich Antworten an Google Sheets oder Slack senden?",
        answer5:
          "Ja, nachdem du ein Ziel für das Formular konfiguriert hast. Slack und Discord verwenden Webhook-URLs. Google Sheets benötigt einen bereitgestellten Google-Apps-Script-Endpunkt, der Einreichungen empfängt; ein reiner Tabellenlink funktioniert nicht. Du kannst auch einen Webhook verwenden oder Antworten als CSV exportieren. Agenten-Exporte aller Antworten als CSV oder JSON erfordern verbundenen Dateispeicher.",
      },
      s001: "Screenshot der Vorlage Forms",
      heroEyebrow: "Forms",
      heroTitle: "Erstelle Formulare mit deinem KI-Agenten",
      heroDescription:
        "Forms ist ein kostenloser Open-Source-KI-Formular-Builder zum Erstellen von Umfragen, Anmeldeformularen und Anfrageformularen, mit Fragen, die du selbst bearbeiten kannst, und Antworten, bei deren Analyse dein KI-Agent hilft.",
      heroCta: "Formular erstellen",
      useCasesHeading: "Was kannst du mit Forms machen?",
      useCasesBody:
        "Sammle Kundenfeedback, melde Personen für eine Veranstaltung an oder erfasse die Details, die dein Team für eine Anfrage braucht.",
      useCase1Title: "Kundenfeedback sammeln",
      useCase1Body:
        "Frage Kunden nach ihrer Erfahrung mit Bewertungen, Multiple-Choice-Fragen und Freitextantworten. Lass deinen KI-Agenten das erhaltene Feedback zusammenfassen.",
      useCase2Title: "Anmeldungen und Registrierungen erfassen",
      useCase2Body:
        "Erstelle ein Formular für ein Webinar, eine Veranstaltung oder eine Produkt-Warteliste. Erfasse Kontaktdaten und Präferenzen und sieh dir die Einreichungen an oder exportiere sie.",
      useCase3Title: "Projektanfragen sammeln",
      useCase3Body:
        "Gib Leuten ein Formular für Designanfragen, Projekt-Briefings oder internen Support. Frage nach Fristen, Anforderungen und anderen Details, die dein Team braucht.",
      keyFeaturesEyebrow: "Hauptfunktionen",
      keyFeaturesHeading:
        "Alles, was du zum Erstellen, Teilen und Auswerten brauchst",
      feature1Title: "KI-Formular-Generierung",
      feature1Body:
        "Beschreibe, was du erfassen willst, und dein KI-Agent baut das Formular. Bitte ihn, Fragen hinzuzufügen oder bestehende Felder zu überarbeiten.",
      feature2Title: "Visuelle Feldbearbeitung",
      feature2Body:
        "Bearbeite Beschriftungen, Optionen, Pflichtfelder und die Fragenreihenfolge selbst. Wähle Feldtypen wie Text, E-Mail, Multiple-Choice, Datum, Bewertung und Skala.",
      feature3Title: "Bedingte Fragen",
      feature3Body:
        "Zeige eine Folgefrage, wenn eine frühere Antwort einer Regel entspricht. Frage zum Beispiel nach mehr Details, wenn jemand „Sonstiges“ auswählt.",
      feature4Title: "Öffentliche Formular-Links",
      feature4Body:
        "Veröffentliche ein Formular und teile seinen Link. Lege eine Abschlussnachricht oder Weiterleitung fest und schließe das Formular, wenn du keine Antworten mehr annimmst.",
      feature5Title: "Antwortauswertung und Exporte",
      feature5Body:
        "Sieh dir Einreichungen in einer Tabelle an oder lass dir von deinem KI-Agenten Zusammenfassungen und Trends erstellen. Lade die Antworttabelle als CSV herunter.",
      feature6Title: "Einreichungsintegrationen",
      feature6Body:
        "Richte die Zustellung an Slack, Discord, Google Sheets oder einen Webhook ein. Neue Antworten gehen an das Ziel, das du für dieses Formular eingerichtet hast.",
      finalCtaHeading: "Erstelle dein nächstes Formular",
      finalCtaBody: "Sag deinem KI-Agenten, was du erfassen möchtest.",
      finalCtaButton: "Formular erstellen",
      s002: "Beschreiben",
      s003: "Generieren",
      s004: "Weiterleiten",
      s005: "Alle Vorlagen",
      s006Primary: "Die Open-Source-Alternative AI zu",
      s006Secondary: "Typeform und Google Forms",
      s007: "Generieren Sie ein vollständiges Formular aus einer Eingabeaufforderung, verfeinern Sie Felder im Dialog und leiten Sie Übermittlungen an Slack, Discord, Google Sheets oder Webhooks weiter. Besitzen Sie Ihre Daten und Ihren Workflow – keine Gebühren pro Antwort.",
      s008: "Ausprobieren",
      s009: "Wie es funktioniert",
      s010: "Alles was Sie brauchen",
      s011: "Ein vollständiger Formular-Builder mit integriertem AI.",
      s012: "Alle Feldtypen",
      s013: "Text, E-Mail, Nummer, Langtext, Auswahl, Mehrfachauswahl, Kontrollkästchen, Radio, Datum, Bewertung und Skala.",
      s014: "Gesichtsfeldbearbeitung",
      s015: "Aktualisieren Sie Beschriftungen, Platzhalter, Optionen, erforderlichen Status und Feldreihenfolge im Editor oder indem Sie den Agenten fragen.",
      s016: "Individuelles Styling",
      s017: "Passen Sie Ihre Marke an – Farben, Schriftarten, Layout. Oder bitten Sie den Agenten einfach, „es wie unsere Marketing-Website aussehen zu lassen“.",
      s018: "Einreichungsintegrationen",
      s019: "Senden Sie strukturierte Übermittlungen an Slack, Discord, Google Sheets oder einen Webhook, wenn jede Antwort eintrifft.",
      s020: "Öffentliche Freigabeseiten",
      s021: "Jedes Formular erhält eine öffentliche URL mit vollständigem SEO. Betten Sie es auf einer beliebigen Website ein oder hosten Sie es auf Ihrer eigenen Domain.",
      s022: "Einreichungs-Dashboard",
      s023: "Sortierbare Tabelle, Filter, CSV-Export und Detailansichten pro Übermittlung. Alle Daten befinden sich in Ihrer SQL-Datenbank.",
      s024: "Visuelle und konversationale Bearbeitung",
      s025: "Ziehen Sie Felder, bearbeiten Sie Beschriftungen, legen Sie die Validierung fest. Oder beschreiben Sie einfach die Änderung und der Agent aktualisiert dasselbe Formularschema.",
      s026: "Neuordnung der Felder per Drag-and-Drop",
      s027: "Live-Vorschau neben dem Editor",
      s028: "Rückgängigmachen/Wiederherstellen mit vollständigem Verlauf",
      s029: "Aufbau von Konversationsformen",
      s030: "Überspringen Sie das Feld-für-Feld-Grinden. Beschreiben Sie das Formular einmal und verfeinern Sie es dann mit einfacher Sprache.",
      s031: "„Bewerbungsformular erstellen“",
      s032: "„Fügen Sie ein Dropdown-Menü für die erforderliche Erfahrungsstufe hinzu“",
      s033: "„Machen Sie das E-Mail-Feld zu einem Pflichtfeld“",
      s034: "„Posten Sie jede Einreichung an Slack“",
      s035: "Wie es im Vergleich aussieht",
      s036: "AI Formulargeneratoren",
      s037: "Visueller Editor",
      s038: "Ja, vorlagengebunden",
      s039: "Begrenzt/keine",
      s040: "Visuell + Agent + Code",
      s041: "AI Generation",
      s042: "Keine / einfach",
      s043: "One-Shot, starr",
      s044: "Iterativ, gesprächig",
      s045: "Einreichungsintegrationen",
      s046: "Handbuch",
      s047: "Begrenzt",
      s048: "Dateneigentum",
      s049: "Server des Anbieters",
      s050: "Vom Anbieter gehostet",
      s051: "Ihre SQL-Datenbank",
      s052: "Preise",
      s053: "Gebühren pro Antwort",
      s054: "Abonnement",
      s055: "Kostenlos und Open Source",
      s056: "Beginnen Sie in wenigen Minuten",
      s057: "Starten Sie mit der Vorlage und beginnen Sie mit dem Sammeln von Einsendungen, die Ihnen vollständig gehören.",
      s058: "Lesen Sie die Dokumente",
      s059: "Alle Vorlagen anzeigen",
    },
    mail: {
      faq: {
        question1: "Was ist Agent-Native Mail?",
        answer1:
          "Agent-Native Mail ist ein kostenloser, quelloffener E-Mail-Client für Gmail mit einem KI-E-Mail-Assistenten. Lies und durchsuche Nachrichten, fasse Unterhaltungen zusammen, entwirf Antworten und organisiere deine E-Mails über den Posteingang oder deinen KI-Agenten.",
        question2: "Funktioniert Mail mit meinem bestehenden Gmail-Konto?",
        answer2:
          "Ja. Verbinde dein bestehendes Gmail-Konto, um E-Mails über Mail zu lesen und zu senden. Du kannst mehrere Gmail-Konten verbinden und kontoübergreifend suchen. Mail stellt keine neue E-Mail-Adresse bereit und unterstützt derzeit Gmail statt Outlook oder anderer E-Mail-Anbieter.",
        question3: "Sendet der KI-Agent E-Mails ohne meine Freigabe?",
        answer3:
          "Wenn du den KI-Agenten im Chat bittest, eine E-Mail zu senden, benötigt er deine Freigabe. Auch durch Automatisierungen ausgelöste Sendevorgänge erfordern eine Freigabe, sofern du das automatische Senden nicht ausdrücklich in den Mail-Einstellungen aktivierst. Du kannst Entwürfe vor dem Senden prüfen und bearbeiten.",
        question4: "Kann KI meinen Posteingang automatisch organisieren?",
        answer4:
          "Ja. Erstelle Regeln in natürlicher Sprache, um eingehende Nachrichten zu kennzeichnen, zu archivieren, mit einem Stern zu markieren oder als gelesen zu markieren. Mail unterstützt außerdem native Gmail-Filter für Bedingungen wie Absender oder Betreff. Gmail-Filter laufen in Gmail und funktionieren weiter, auch wenn Mail geschlossen ist.",
        question5:
          "Kann ein Teammitglied eine E-Mail für mich zur Prüfung vorbereiten?",
        answer5:
          "Ja. Ein Teammitglied kann einen Entwurf anfordern, der in deiner Prüfungswarteschlange erscheint. Öffne ihn, bearbeite die Nachricht und sende sie, wenn sie fertig ist. Die anfragende Person kann sie nicht in deinem Namen senden; die Eigentümerin oder der Eigentümer des Entwurfs oder eine Organisationsadministration steuert das Senden.",
      },
      s001: "Screenshot der Vorlage Mail",
      // V3 landing page copy (2026-09-10) — hero through final CTA below.
      heroEyebrow: "Mail",
      heroTitle: "Übernimm mit Jev die Kontrolle über deinen Posteingang",
      heroDescription:
        "Sag Jev in einfacher Sprache, was wichtig ist. Es hält menschliche GitHub-Kommentare sichtbar, rückt die Nachrichten deiner Führungskraft nach oben und räumt Bot-Benachrichtigungen weg – und lernt aus deinen Korrekturen.",
      heroCta: "Verwalte deinen Posteingang",
      useCasesHeading: "Ein intelligenterer Posteingang, unterstützt von Jev",
      useCasesBody:
        "Lege eine Regel in natürlicher Sprache fest. Jev priorisiert wichtige Personen und Unterhaltungen, vergibt passende Labels und archiviert wiederkehrende Nachrichten automatisch.",
      useCase1Title: "Menschen im Blick. Bots im Archiv.",
      useCase1Body:
        "Sag Jev, was wichtig ist: Behalte menschliche GitHub-Pull-Request-Kommentare in Product, archiviere Bot-Benachrichtigungen und verschiebe die Nachrichten deiner Führungskraft nach Important. Passe jede Regel per Prompt an und verbessere den Spamfilter mit deinem Feedback.",
      useCase2Title: "Jede E-Mail erhält ihr passendes Label",
      useCase2Body:
        "Jev ordnet Unterhaltungen nach Bedeutung statt nur nach Stichwörtern ein, damit Kundennotizen, Belege und Recherche am richtigen Ort landen.",
      useCase3Title: "Automatisieren Sie die Routinearbeit",
      useCase3Body:
        "Legen Sie Regeln fest, um neue E-Mails im Hintergrund zu kennzeichnen oder zu archivieren, und überprüfen Sie dann den Ausführungsverlauf, wann immer Sie möchten.",
      keyFeaturesEyebrow: "Wichtige Funktionen",
      keyFeaturesHeading:
        "Alles, was du zum Lesen, Schreiben und Organisieren von E-Mails brauchst",
      feature1Title: "Prioritätssortierung",
      feature1Body:
        "Ordnen Sie eingehende Threads nach Dringlichkeit und Kontext, sodass Fristen und Personen, die auf eine Antwort warten, ganz oben stehen.",
      feature2Title: "Kontextbezogene KI-Beschriftungen",
      feature2Body:
        "Klassifizieren Sie Nachrichten danach, worum es in der Konversation geht, und gruppieren Sie dann ähnliche E-Mails, wenn sie eintreffen.",
      feature3Title: "Agentengesteuerter Posteingang",
      feature3Body:
        "Bitten Sie den Agenten, den von Ihnen angezeigten Posteingang zu durchsuchen, zusammenzufassen, zu kennzeichnen, zu archivieren, zu markieren oder eine Antwort vorzubereiten.",
      feature4Title: "Hintergrundautomatisierungen",
      feature4Body:
        "Wenden Sie Klartextregeln auf eingehende Nachrichten an und überprüfen Sie die von Mail durchgeführten Aktionen.",
      feature5Title: "Überprüfen Sie es vor dem Senden",
      feature5Body:
        "Lassen Sie den Agenten eine Antwort entwerfen oder überarbeiten, überprüfen und bearbeiten Sie sie dann, bevor sie Ihren Posteingang verlässt.",
      feature6Title: "Ein Spamfilter, der dazulernt",
      feature6Body:
        "Markiere eine gefilterte Nachricht als erwünscht oder melde unerwünschte E-Mails. Jev lernt aus jeder Korrektur und wendet sie auf ähnliche Nachrichten an.",
      finalCtaHeading: "Starte mit deiner nächsten E-Mail",
      finalCtaBody:
        "Öffne eine Unterhaltung und bitte deinen KI-Agenten um eine Zusammenfassung oder einen Antwortentwurf.",
      finalCtaButton: "Verwalte deinen Posteingang",
      s002: "Zuerst die Tastatur",
      s003: "Posteingangs-Sortierung",
      s004: "Ansichten",
      s005: "Anpassbar",
      s006: "Alle Vorlagen",
      s007Primary: "Die Open-Source-Alternative zu",
      s007Secondary: "Superhuman und Gmail",
      s008: "Ausprobieren",
      s009: "Die gehostete Demo nutzt die gemeinsame Google-App von Agent-Native für den Zugriff auf Gmail, sodass Google Sie möglicherweise um eine Bestätigung bittet, bevor Sie fortfahren. Lokal ausführen, um Ihren eigenen Google OAuth-Client zu verwenden.",
      s010: "Was Sie tun können",
      s011: "Alles, was Sie brauchen, um Ihren E-Mail-Client durch einen AI-basierten Posteingang zu ersetzen, der Ihnen vollständig gehört.",
      s012: "Tastaturkürzel",
      s013: "KI-Triage",
      s014: "Der Agent liest Ihren Posteingang, zeigt auf, worauf es ankommt, verfasst Antworten und bearbeitet automatisch Routine-E-Mails. Richten Sie Automatisierungen für die automatische Kennzeichnung und Archivierung ein.",
      s015: "Intelligente Suche",
      s016: "Suche in natürlicher Sprache in Ihrem gesamten Posteingang. „E-Mails von letzter Woche zum Budget“ funktioniert einfach.",
      s017: "Selbstverbesserung",
      s018: "Der Agent ändert die App selbst. Benötigen Sie einen benutzerdefinierten Ordner, Filter oder eine Automatisierung? Fragen Sie einfach.",
      s019: "AI-gestützte Posteingangsverwaltung",
      s020: "Überlassen Sie dem Agenten die schwere Arbeit – Triage, Kennzeichnung, Archivierung und Entwurf von Antworten anhand natürlichsprachlicher Anweisungen.",
      s021: "Automatische Beschriftung, Prioritätssortierung und automatische Archivierungsregeln",
      s022: "AI-entworfene Antworten für Routinenachrichten",
      s023: "Thread-Zusammenfassung und Aktionselemente",
      s024: "Tastaturorientiertes Verfassen",
      s025: "Schreiben und versenden Sie E-Mails in Gedankengeschwindigkeit. Vollständige Tastaturnavigation, Tastenkombinationen im Notion-Stil und AI-unterstütztes Zeichnen.",
      s026: "Mehrere Entwurfsregisterkarten zum gleichzeitigen Verfassen mehrerer E-Mails",
      s027: "AI erweitert kurze Entwürfe zu vollständigen E-Mails",
      s028: "Später senden, Schlummer- und Folgeerinnerungen",
      s029: "Agentengesteuerte E-Mail-Workflows",
      s030: "Der Agent liest, verfasst und organisiert Ihre E-Mails in natürlicher Sprache. Jeder Workflow ist ein Skript, das Sie überprüfen und erweitern können.",
      s031: "„Meine ungelesenen E-Mails dieser Woche zusammenfassen“",
      s032: "„Erstellen Sie eine Antwort auf den Investor-Update-Thread.“",
      s033: "„Alle Newsletter archivieren, die älter als 7 Tage sind“",
      s034: "„Alle E-Mails finden, die auf eine Antwort von mir warten“",
      s035: "Wie es im Vergleich aussieht",
      s036: "Tastaturkürzel",
      s037: "Einfach",
      s038: "Ausgezeichnet",
      s039: "Vollständig anpassbar",
      s040: "AI Hilfe",
      s041: "Intelligentes Komponieren",
      s042: "AI antwortet",
      s043: "Vollständiger Agent: Triage, Entwurf, Automatisierung",
      s044: "Anpassung",
      s045: "Nur Einstellungen",
      s046: "Nur Themen",
      s047: "Vollständiger Quellcode",
      s048: "Dateneigentum",
      s049: "Googles Server",
      s050: "Vom Anbieter gehostet",
      s051: "Der Code gehört Ihnen",
      s052: "Preise",
      s053: "Frei / Arbeitsbereich",
      s054: "$30/Monat pro Benutzer",
      s055: "Kostenlos und Open Source",
      s056: "Beginnen Sie in wenigen Minuten",
      s057: "Starten Sie mit der Vorlage, verbinden Sie Ihren E-Mail-Anbieter und beginnen Sie mit der Verwaltung Ihres Posteingangs mit AI.",
      s058: "Lesen Sie die Dokumente",
      s059: "Alle Vorlagen anzeigen",
      s060: "Hinweis zur gehosteten Demo",
    },
    plan: {
      faq: {
        question1: "Was ist Agent-Native Plans?",
        answer1:
          "Agent-Native Plans ist ein kostenloses Open-Source-Tool zur visuellen Planung für KI-Coding-Agenten. Prüfe Implementierungspläne mit Diagrammen, Wireframes, kommentiertem Code und Kommentaren, oder lass dir visuelle Zusammenfassungen abgeschlossener Änderungen erstellen.",
        question2: "Wie verwende ich Plans mit meinem Coding-Agenten?",
        answer2:
          "Installiere die Planungs-Skills und den Connector mit `npx @agent-native/core@latest skills add visual-plan` und schließe anschließend die Authentifizierung für deinen Client ab. Der Installationsleitfaden deckt Clients wie Claude Code und Codex ab. Nutze `/visual-plan`, um deinen Agenten um einen visuellen Implementierungsplan zu bitten.",
        question3:
          "Kann mein Agent einen Plan aufgrund meiner Kommentare überarbeiten?",
        answer3:
          "Ja. Hinterlasse Kommentare im Text oder pinne sie an eine Visualisierung und bitte deinen Agenten anschließend, das Feedback zu lesen und zu berücksichtigen. Er kann den Plan aktualisieren und auf Review-Threads antworten. Das unterstützt deinen Review-Prozess, hindert den Agenten aber nicht automatisch daran, Code zu ändern.",
        question4: "Kann ich mit Plans bereits geschriebenen Code überprüfen?",
        answer4:
          "Ja. Nutze `/visual-recap` mit einem Pull Request, Commit, Branch oder Diff, um eine visuelle Erklärung der Änderung zu erhalten. Verwende den Recap, um deine Prüfung des eigentlichen Codes und der Tests zu leiten.",
        question5: "Wo werden Pläne gespeichert, und kann ich sie teilen?",
        answer5:
          "Die Standardinstallation verbindet deinen Agenten mit der gehosteten Plans-App. Neue gehostete Pläne sind privat, bis du sie teilst. Teammitglieder können freigegebene Pläne im Browser prüfen; für Kommentare ist ein Konto erforderlich. Lokale Workflows stehen ebenfalls über den Einrichtungsleitfaden zur Verfügung.",
      },
      s001: "Screenshot der Plans-App",
      heroEyebrow: "Plans",
      heroTitle: "Sieh, was dein KI-Coding-Agent bauen will",
      heroDescription:
        "Plans ist ein kostenloses Open-Source-Tool zur visuellen Planung, mit dem du den Ansatz deines Coding-Agenten prüfst, Feedback gibst und Codeänderungen anhand von Diagrammen, Wireframes und kommentiertem Code verstehst.",
      heroCta: "Plane visuell",
      heroSecondaryCta: "Plans öffnen",
      useCasesHeading: "Was kannst du mit Plans machen?",
      useCasesBody:
        "Prüfe einen Implementierungsansatz, arbeite eine Oberfläche durch oder verstehe eine abgeschlossene Änderung gemeinsam mit deinem KI-Coding-Agenten.",
      useCase1Title: "Architektur vor der Umsetzung prüfen",
      useCase1Body:
        "Bitte deinen Coding-Agenten, ein geplantes Feature oder Refactoring zu diagrammieren. Prüfe Datenfluss, Abhängigkeiten und Fehlerpfade, bevor er mit den Codeänderungen beginnt.",
      useCase2Title: "Oberflächenänderungen durcharbeiten",
      useCase2Body:
        "Prüfe vorgeschlagene Screens und Nutzerflüsse gemeinsam mit deinem Coding-Agenten. Weise auf fehlende Zustände oder Interaktionen hin und bitte ihn, den Plan zu überarbeiten.",
      useCase3Title: "Abgeschlossene Codeänderungen verstehen",
      useCase3Body:
        "Bitte deinen Coding-Agenten um eine visuelle Zusammenfassung eines Pull Requests, Commits oder Branches. Prüfe die Verhaltensänderungen und betroffenen Dateien.",
      keyFeaturesEyebrow: "Wichtige Funktionen",
      keyFeaturesHeading:
        "Alles, was du zum Visualisieren, Prüfen und Diskutieren brauchst",
      feature1Title: "Architekturdiagramme",
      feature1Body:
        "Zeige Request-Flows, Systembeziehungen und Datenmodelle direkt im Plan. Bitte deinen KI-Coding-Agenten, die Diagramme zu aktualisieren, sobald sich der Ansatz ändert.",
      feature2Title: "Wireframes und Prototypen",
      feature2Body:
        "Prüfe Bildschirmlayouts und interaktive Prototyp-Optionen direkt neben dem Implementierungsplan. Gib Feedback zur vorgeschlagenen Oberfläche, bevor du deinen Agenten bittest, sie umzusetzen.",
      feature3Title: "Kommentierte Code-Walkthroughs",
      feature3Body:
        "Lies Quelldateien mit zeilenweisen Notizen und Erklärungen zu den Änderungen. Nutze Dateibäume, um zu sehen, wo die geplante Arbeit im Code ansetzt.",
      feature4Title: "Kommentare und Anmerkungen",
      feature4Body:
        "Kommentiere Text oder pinne Feedback an eine bestimmte Stelle in einer Visualisierung. Richte Fragen direkt an deinen Agenten oder ein Teammitglied.",
      feature5Title: "Visuelle Code-Recaps",
      feature5Body:
        "Nutze `/visual-recap`, um einen bestehenden Pull Request, Commit, Branch oder Diff in einen Walkthrough mit Diagrammen und Erklärungen der Änderungen zu verwandeln.",
      feature6Title: "Teilen und Exportieren",
      feature6Body:
        "Teile einen Plan, damit Teammitglieder ihn im Browser prüfen können. Exportiere ihn als HTML, Markdown, JSON oder MDX, wenn du eine separate Kopie brauchst.",
      finalCtaHeading: "Prüfe deine nächste Coding-Aufgabe visuell",
      finalCtaBody:
        "Bitte deinen Agenten um einen Plan und arbeite die Details anschließend gemeinsam durch.",
      finalCtaButton: "Plane visuell",
    },
    slides: {
      faq: {
        question1: "Was ist Agent-Native Slides?",
        answer1:
          "Agent-Native Slides ist ein kostenloser Open-Source-KI-Präsentationsersteller. Erstelle mit einem KI-Agenten markenkonforme Decks aus deinen Ideen und Quellmaterialien, bearbeite die Folien dann selbst, präsentiere sie oder exportiere sie nach PowerPoint.",
        question2:
          "Kann ich Folien bearbeiten, nachdem die KI sie generiert hat?",
        answer2:
          "Ja. Bearbeite Text, Layout und Stil direkt im visuellen Editor, oder bitte den KI-Agenten, eine ausgewählte Folie zu überarbeiten. Du kannst die Präsentation auch nach dem ersten Entwurf weiter verfeinern.",
        question3:
          "Kann ich eine Präsentation aus einem bestehenden Deck oder Dokument erstellen?",
        answer3:
          "Ja. Hänge ein Deck oder Dokument als Referenzmaterial für eine neue Präsentation an. Um am bestehenden Deck selbst zu arbeiten, importiere es explizit. Überprüfe importierte Folien auf Layoutänderungen oder fehlende Bilder.",
        question4:
          "Kann ich meine eigenen Markenfarben, Schriften und mein Logo verwenden?",
        answer4:
          "Ja. Wende ein Design-System mit den Farben, der Typografie und den Logos deiner Marke an und verwende es in mehreren Decks wieder. Du kannst auch eine Referenzpräsentation bereitstellen, um die Designentscheidungen des KI-Agenten zu leiten.",
        question5:
          "Kann ich meine Präsentation in PowerPoint oder Google Slides verwenden?",
        answer5:
          "Exportiere eine PPTX-Datei, um sie in PowerPoint zu öffnen. Um die Präsentation in Google Slides zu verwenden, importiere die Datei dort. Überprüfe Schriften und Layouts nach dem Export, da sie sich zwischen Editoren unterschiedlich darstellen können.",
      },
      s001: "Screenshot der Vorlage Slides",
      // V4 landing page copy (2026-09-11) — hero through final CTA below.
      heroEyebrow: "Slides",
      heroTitle: "Präsentationen mit deinem KI-Agenten erstellen",
      heroDescription:
        "Slides ist ein kostenloser Open-Source-KI-Präsentationsersteller für markenkonforme Decks aus deinen Ideen und Quellmaterialien – mit Folien, die du selbst bearbeiten kannst.",
      heroCta: "Deck erstellen",
      useCasesHeading: "Was kannst du mit Slides machen?",
      useCasesBody:
        "Bereite eine Pitch vor, präsentiere einen Plan oder teile ein Update. Gib deinem KI-Agenten das Material und das Publikum, das du im Kopf hast.",
      useCase1Title: "Vertriebs- und Pitch-Decks erstellen",
      useCase1Body:
        "Verwandle dein Produkt-Briefing in ein Deck für Interessenten oder Investoren. Passe die Geschichte an das Publikum an, vor dem du präsentierst.",
      useCase2Title: "Pläne und Strategien präsentieren",
      useCase2Body:
        "Gib deinem KI-Agenten ein Strategie-Briefing oder einen Launch-Plan, damit er daraus Folien erstellt, die Richtung und nächste Schritte erklären.",
      useCase3Title: "Business-Updates teilen",
      useCase3Body:
        "Verwandle Projektnotizen oder Leistungsberichte in eine Präsentation, die Fortschritt zeigt, Ergebnisse erklärt und hervorhebt, was Aufmerksamkeit braucht.",
      keyFeaturesEyebrow: "Wichtige Funktionen",
      keyFeaturesHeading:
        "Alles, was du zum Erstellen, Bearbeiten und Präsentieren brauchst",
      feature1Title: "KI-Präsentationserstellung",
      feature1Body:
        "Starte mit einem Prompt, einem Dokument oder einem Referenz-Deck. Gib deinem KI-Agenten das Thema und das Publikum, um die Präsentation darum herum aufzubauen.",
      feature2Title: "KI- und visuelle Bearbeitung",
      feature2Body:
        "Markiere Text, damit dein KI-Agent ihn überarbeitet, oder bearbeite Text, Layout und Stil direkt auf der Folie selbst.",
      feature3Title: "Wiederverwendbare Markenstile",
      feature3Body:
        "Speichere deine Farben, Schriften und Logos in einem Design-System. Wende es auf mehrere Decks an, damit Präsentationen zu deiner Marke passen.",
      feature4Title: "Bilder und Logos",
      feature4Body:
        "Bitte deinen KI-Agenten, Bilder zu generieren, Fotos zu finden oder Firmenlogos für deine Folien zu suchen.",
      feature5Title: "Teamzusammenarbeit",
      feature5Body:
        "Arbeite mit Teammitgliedern an Decks, hinterlasse Kommentare zu bestimmten Folien und stelle bei Bedarf eine frühere Version wieder her.",
      feature6Title: "Präsentation und Export",
      feature6Body:
        "Präsentiere im Vollbild mit Sprechernotizen, teile einen Ansichtslink oder exportiere dein Deck als PowerPoint-Datei.",
      finalCtaHeading: "Starte deine nächste Präsentation",
      finalCtaBody:
        "Bring eine Idee, ein Briefing oder ein bestehendes Deck mit.",
      finalCtaButton: "Deck erstellen",
      s002: "Beschreiben",
      s003: "Generieren",
      s004: "Verfeinern",
      s005: "Alle Vorlagen",
      s006Primary: "Folienpräsentationen",
      s006Secondary: "Markenkonform & bearbeitbar",
      s007: "Erstelle mit deinem KI-Agenten markenkonforme Präsentationen, bearbeite die Folien dann selbst und exportiere sie überallhin.",
      s008: "Ausprobieren",
      s009: "Wie es funktioniert",
      s010: "Alles was Sie brauchen",
      s011: "Ein komplettes Präsentationsstudio mit integriertem AI.",
      s012: "Vorgefertigte Folienlayouts",
      s013: "Nutzen Sie unsere Starter-Folienvorlagen. Erstellen Sie eigene Vorlagen und verwenden Sie sie später wieder.",
      s014: "Visuelle + Codebearbeitung",
      s015: "Klicken Sie, um Stile zu bearbeiten, und doppelklicken Sie, um Text anzuzeigen. Wechseln Sie zu unformatiertem HTML für volle Kontrolle.",
      s016: "Nahtlose Bilderzeugung",
      s017: "Nutzen Sie Stilreferenzen und Markenrichtlinien. Wählen Sie aus den von Gemini AI generierten Optionen.",
      s018: "Logo- und Bildsuche",
      s019: "Suchen Sie nach Firmenlogos über Logo.dev oder Brandfetch. Google Bilder für Stockfotos.",
      s020: "Neuordnung per Drag & Drop",
      s021: "Ordnen Sie Folien in der Seitenleiste neu an. Mit Hover-Aktionen duplizieren oder löschen.",
      s022: "Präsentationsmodus",
      s023: "Vollbild mit Tastaturnavigation, Steuerelementen zum automatischen Ausblenden und Sprechernotizen.",
      s024: "Teilen und Zusammenarbeit",
      s025: "Generieren Sie Freigabelinks für den schreibgeschützten Zugriff auf die Präsentation. Vollständiger Rückgängig-/Wiederholen-Verlauf mit beschrifteten Einträgen.",
      s026: "Teilen Sie Links mit schreibgeschütztem Zugriff",
      s027: "Cmd+Z Rückgängigmachen/Wiederherstellen mit vollständigem Verlauf",
      s028: "Navigieren Sie zu einem beliebigen Punkt im Verlauf",
      s029: "Konversationsverfeinerung",
      s030: "Der Agent bearbeitet Folien direkt und UI wird durch Abfragesynchronisierung aktualisiert.",
      s031: "„Machen Sie den Titel größer“",
      s032: "„Fügen Sie ein Diagramm auf Folie 3 hinzu“",
      s033: "„Ändern Sie das Farbschema in Blau“",
      s034: "„Sprechernotizen für Folie 5 hinzufügen“",
      s035: "Wie es im Vergleich aussieht",
      s036: "AI Foliengeneratoren",
      s037: "Visueller Editor",
      s038: "Ja, vorlagengebunden",
      s039: "Begrenzt/keine",
      s040: "Visuell + Code + Agent",
      s041: "AI Generation",
      s042: "Einfach/keine",
      s043: "One-Shot, starr",
      s044: "Iterativ, gesprächig",
      s045: "Bilderzeugung",
      s046: "Einfach",
      s047: "Anpassung",
      s048: "Nur Themen",
      s049: "Nur Aufforderung",
      s050: "Vollständiger Quellcode",
      s051: "Preise",
      s052: "Kostenlos / pro Sitzplatz",
      s053: "Abonnement",
      s054: "Kostenlos und Open Source",
      s055: "Jetzt eine Präsentation erstellen",
      s056: "Wählen Sie Ihre Designvorlieben und geben Sie zum Start einen Prompt ein. Immer kostenlos.",
      s057: "Lesen Sie die Dokumente",
      s058: "Alle Vorlagen anzeigen",
      howItWorksDescribe:
        "Beschreiben Sie Ihr Thema, Ihre Zielgruppe und den gewünschten Ton. Fügen Sie eine Referenzpräsentation an. Starten Sie in der Benutzeroberfläche oder über Ihren eigenen KI-Workflow.",
      signInIntegration:
        "Melden Sie sich an, um über eine Webhook-, MCP- oder A2A-Integration auf Slides zuzugreifen.",
      signIn: "Anmelden",
      tryNow: {
        step: "Schritt {{current}} von {{total}}",
        q1: "Welche Art von Präsentation brauchen Sie?",
        q1Pitch: "Investoren-Pitchdeck",
        q1Sales: "Vertriebspräsentation für Kunden",
        q1Talk: "Begleitfolien für einen Vortrag oder Unterricht",
        q1Other: "Etwas anderes",
        q1OtherPlaceholder: "Beschreiben Sie die Art der Präsentation",
        q2Pitch:
          "Um welches Unternehmen und welche Finanzierungsrunde geht es?",
        q2Sales: "Was verkaufen Sie, und an wen?",
        q2Talk: "Worum geht es im Vortrag, und wer sitzt im Publikum?",
        q2Other: "Was soll die Präsentation abdecken?",
        q2Detail:
          "Schreiben Sie Notizen oder geben Sie mir einfach eine Website-URL",
        q2Placeholder: "Notizen oder https://example.com",
        q3: "Geben Sie mir einen Stil als Vorlage",
        q3Detail:
          "Fügen Sie eine Website ein, an der wir uns orientieren, oder wählen Sie stattdessen eine Stimmung",
        q3Placeholder: "https://example.com",
        q3VibeToggle: "Keine Website? Wählen Sie eine Stimmung",
        q3VibeMinimal: "Minimalistisch und redaktionell",
        q3VibeBold: "Kräftig und kontrastreich",
        q3VibeWarm: "Warm und menschlich",
        q3VibeTechnical: "Technisch und datenreich",
        answerAction: "Zum Prompt hinzufügen",
        composerLabel: "Ihr Prompt",
        composerPlaceholder:
          "Beschreiben Sie die gewünschte Präsentation oder beantworten Sie die Fragen oben.",
        promptTip: "Prompt-Tipp",
        promptPlaceholder:
          "Seien Sie konkret. Sagen Sie, für wen es ist, fügen Sie Ihre Notizen ein oder verweisen Sie auf ein Website-Design...",
        submit: "Meine Präsentation generieren",
        readyHint: "Ihr Prompt ist fertig — senden Sie ihn an den Agenten.",
        promptDeck: "Erstelle {{deck}}.",
        promptSubject: "Das soll sie abdecken: {{subject}}",
        promptStyleSite: "Übernimm das Look and Feel von {{style}}.",
        promptStyleVibe: "Stil: {{style}}.",
        promptClose:
          "Entwirf die komplette Präsentation mit Sprechernotizen und führe mich dann durch die Gliederung.",
        deckPitch: "ein Investoren-Pitchdeck",
        deckSales: "eine Vertriebspräsentation für Kunden",
        deckTalk: "eine Begleitpräsentation für einen Live-Vortrag",
        designReference: "Designreferenz",
        websiteUrl: "Website-URL",
        websiteUrlPlaceholder: "https://example.com",
        crawlWebsite: "Website prüfen",
        crawlError:
          "Wir konnten diese Website nicht prüfen. Möglicherweise blockiert sie automatisierte Zugriffe. Versuche eine andere URL oder lade eine Designreferenz hoch.",
        or: "oder",
        uploadDesignReference: "Designreferenz hochladen",
        importDesignSystem: "Designsystem importieren",
        loginDesignSystems:
          "Melden Sie sich an, um Designsysteme zu verwalten.",
        promptCreatePrefix: "Erstelle ein",
        deckTypeLabel: "Art der Präsentation",
        deckCapitalRaise: "Fundraising-Deck",
        deckOfferingMemorandum: "Angebotsmemorandum",
        deckB2bSales: "B2B-Vertriebsdeck",
        deckTeamMeeting: "Tagesordnung für Teammeeting",
        deckLiveTalk: "Live-Vortragsdeck",
        promptDeckFor: "für",
        promptTextShouldBe: "Der Text sollte",
        textAmountLabel: "Textmenge",
        textMinimal: "minimal",
        textBrief: "knapp",
        textThorough: "ausführlich",
        findingTitle: "Titel",
        findingDescription: "Beschreibung",
        findingColors: "Farben",
        findingFonts: "Schriftarten",
        findingPrimaryColor: "Primärfarbe",
        findingAccentColor: "Akzentfarbe",
        findingHeadingFont: "Überschriftenschrift",
        findingBodyFont: "Fließtextschrift",
        styleGuidePrefix: "Styleguide für",
      },
    },
  },
  skillsPage: {
    metaTitle:
      "Agent Skills - Visual Plan, Visual Recap und Visual Edit fuer Coding Agents",
    metaDescription:
      "Installiere Agent-Native appgestuetzte Skills fuer visuelle Planung, PR-Recaps und lokale visuelle Bearbeitung in deinem Coding Agent.",
    metaOgDescription:
      "Gib deinem Coding Agent Slash-Commands auf Basis von Agent-Native Apps, die du hosten, pruefen und anpassen kannst.",
    metaKeywords:
      "Agent Skills, Visual Plan, Visual Recap, Visual Edit, Coding Agent, Claude Code, Codex, PR Review, Planung, agent-native",
    heroTitle: "Gib deinem Coding Agent neue Superkraefte",
    heroBody:
      "Installiere appgestuetzte Skills mit Agent-Native Apps, die du voll anpassen kannst: visuelle Planung vor der Umsetzung, visuelle PR-Recaps nach den Aenderungen und visuelle Bearbeitung lokaler UI-Flows.",
    sectionTitle: "Appgestuetzte Skills fuer Coding Agents",
    sectionBody:
      "Nutze gehostete teilbare App-Links, lokale Dateien oder eine selbst gehostete/angepasste App; dein Agent erhaelt Anweisungen plus die passende MCP-Oberflaeche, wenn sie gebraucht wird.",
    ctaBody:
      "Funktioniert mit Claude Code, Codex, Cursor, Pi, OpenCode, GitHub Copilot / VS Code und aehnlichen Coding Agents.",
    readVisualPlansDocs: "Visual Plans Dokumentation lesen",
    browseTemplates: "Templates ansehen",
    visualPlan: {
      name: "Visueller Plan",
      tagline: "Vor dem Code pruefen",
      description:
        "Verwandelt eine Coding-Aufgabe in einen teilbaren Plan mit Diagrammen, Dateinotizen und optionalen UI-Skizzen.",
      feature1: "Sieh die Umsetzungsform, bevor Aenderungen landen",
      feature2: "Kommentieren, ueberarbeiten, genehmigen oder uebergeben",
      videoAriaLabel: "Demo-Video zum Visual Plan Skill",
    },
    visualRecap: {
      name: "Visuelle Zusammenfassung",
      tagline: "Nach Aenderungen pruefen",
      description:
        "Verwandelt einen PR oder git diff in einen teilbaren Recap dessen, was sich geaendert hat und warum.",
      feature1: "Fasst Schema-, API- und Dateiaenderungen zusammen",
      feature2: "Kann optional einen fixierten PR-Kommentar posten",
      videoAriaLabel: "Demo-Video zum Visual Recap Skill",
    },
    visualEdit: {
      name: "Visuelle Bearbeitung",
      tagline: "Lokale UI-Flows bearbeiten",
      description:
        "Oeffnet eine laufende localhost-App in Design als URL-gestuetzte Screens fuer visuelle Pruefung und Bearbeitung.",
      feature1: "Mehrere Flow-Screens aus geordneten URLs anlegen",
      feature2: "Live-Routenzustaende pruefen, duplizieren und verfeinern",
      videoAriaLabel: "Demo-Video zum Visual Edit Skill",
    },
  },
  downloadPage: {
    title: "Agent-Native herunterladen",
    body: "Probieren Sie agentische Apps für Meetings, Design, Präsentationen, Daten, Terminplanung, E-Mail und mehr aus – alles in einer Desktop-App.",
    openDesktop: "Agent-Native öffnen",
    downloadInstaller: "Installer herunterladen",
    downloadStarted: "Download gestartet",
    downloadAgain: "Hat es nicht funktioniert? Erneut herunterladen",
    loadError: "Der neueste Desktop-Installer konnte nicht geladen werden.",
    checkingRelease: "Neueste Desktop-Version wird geprüft...",
    retry: "Erneut versuchen",
    unavailable: "Installer für diese Plattform nicht verfügbar",
    allPlatforms: "Alle Plattformen",
    stable: "Stabil",
    nightly: "Nightly",
    runFromSource: "Bauen Sie Ihr eigenes",
    runFromSourceBody:
      "Erstellen Sie eine Agent-Native-App über die Befehlszeile und führen Sie sie lokal unter macOS, Windows oder Linux aus.",
    platforms: {
      mac: {
        primary: "Für Apple Silicon herunterladen",
        alternative: "Intel-Mac",
        gridPrimary: "Apple Silicon",
        gridAlternative: "Intel",
      },
      windows: {
        primary: "Für Windows herunterladen",
        alternative: "ARM64",
        gridPrimary: "x64-Installer",
        gridAlternative: "Arm64-Installer",
        note: "Windows 10 oder neuer.",
      },
      linux: {
        primary: "Linux-Archiv herunterladen",
        appImage: "AppImage herunterladen",
        deb: ".deb herunterladen",
        gridPrimary: "x86_64",
        gridAppImage: "Universal",
        gridDeb: "Debian / Ubuntu",
        note: "Das Archiv funktioniert ohne FUSE. AppImage benötigt auf einigen Distributionen eventuell FUSE 2.",
      },
    },
  },
  brandPage: {
    eyebrow: "Markenmaterial",
    title: "Agent-Native-Logos",
    body: "Lade die offiziellen Logos und Bildmarken für Artikel, Präsentationen und Community-Projekte herunter. SVG-Dateien bleiben in jeder Größe scharf und unterstützen transparente Hintergründe.",
    horizontal: {
      title: "Horizontales Logo",
      body: "Die bevorzugte Variante für Artikel-Header, Websites, Präsentationen und andere breite Formate.",
    },
    symbol: {
      title: "Bildmarke",
      body: "Verwende die eigenständige Bildmarke für Avatare, App-Symbole und kompakte Platzierungen.",
    },
    lightBackground: "Für helle Hintergründe",
    darkBackground: "Für dunkle Hintergründe",
    downloadSvg: "SVG herunterladen",
    usage: {
      title: "Verwendung der Marke",
      clear: {
        title: "Ausreichend Freiraum",
        body: "Bewahre die Proportionen des Logos und lasse rundherum genügend freien Raum.",
      },
      contrast: {
        title: "Auf Kontrast achten",
        body: "Nutze die dunkle Variante auf hellen und die helle Variante auf dunklen Hintergründen.",
      },
      original: {
        title: "Originaldateien verwenden",
        body: "Logo und Bildmarke dürfen nicht umgefärbt, beschnitten, gedreht, gestreckt oder neu angeordnet werden.",
      },
    },
  },
  legal: {
    lastUpdated: "Zuletzt aktualisiert: {{date}}",
    resources: {
      eyebrow: "Rechtliche Ressourcen",
      title: "Rechtliche Ressourcen für Agent-Native",
      intro:
        "Eigenständige rechtliche Richtlinien von Agent-Native für gehostete Anwendungen und Dienste.",
      agentNative: {
        title: "Agent-Native-Richtlinien",
        body: "Diese Seiten passen den gemeinsamen Richtlinienrahmen an das Open-Source-Projekt und die gehosteten Beispiele von Agent-Native an.",
        terms: "Agent-Native-Nutzungsbedingungen",
        privacy: "Agent-Native-Datenschutzerklärung",
      },
      builder: {
        title: "Weitere Richtlinien für den gehosteten Dienst",
        body: "Diese lokalen Kopien behandeln zulässige Nutzung, KI-Funktionen, Plattformregeln, Sperrungen und Entfernungen, Urheberrecht sowie behördliche Anfragen. Die englische Fassung ist maßgeblich.",
      },
      links: {
        terms: "SaaS-Servicevereinbarung",
        privacy: "Datenschutzerklärung",
        acceptableUse: "Richtlinie zur akzeptablen Nutzung",
        aiTerms: "KI-Bedingungen",
        platformRules: "Plattformregeln",
        takedown: "Richtlinie zu Sperrung, Entfernung und Datenverarbeitung",
        lawEnforcement: "Richtlinie für Anfragen von Strafverfolgungsbehörden",
      },
      notIncluded: {
        title: "Nicht enthaltene kommerzielle Bedingungen",
        body: "Agent-Native hat keine kostenpflichtigen Tarife und keinen Enterprise-Vertrag. Kommerzielle Unterlagen wie Enterprise-SLAs, Supportbedingungen, DPAs, Sicherheitszusätze, Professional-Services-Bedingungen und Gebühren sind nicht enthalten.",
      },
    },
    privacy: {
      eyebrow: "Datenschutzrichtlinie",
      title: "Agent-Native gehostete Anwendungen",
      intro:
        "In dieser Richtlinie wird erläutert, wie Builder.io Daten sammelt, verwendet, weitergibt und speichert, wenn es von Agent-Native gehostete Anwendungen, gehostete Vorlagen, Demos und offizielle Browsererweiterungen betreibt.",
      scopeCards: {
        hosted: {
          title: "Gehostete Apps",
          body: "Abgedeckt, wenn Builder.io den Agent-Native-Dienst oder die gehostete Vorlage für Sie betreibt.",
        },
        openSource: {
          title: "Open Source",
          body: "Nicht abgedeckt für Ihre Nutzung des MIT-lizenzierten Quellcodes selbst.",
        },
        selfHosted: {
          title: "Selbst gehostet",
          body: "Nicht abgedeckt für Forks, Anpassungen oder Bereitstellungen, die von einer anderen Person durchgeführt werden.",
        },
      },
      sections: {
        scope: "Umfang",
        information: "Informationen, die wir sammeln",
        cookies: "Cookies und Analysen",
        clipsExtension: "Agent-Native Clips Chrome-Erweiterung",
        use: "Wie wir Informationen nutzen",
        sharing: "Weitergabe und Dritte",
        chromeLimitedUse: "Chrome Web Store eingeschränkte Nutzung",
        retention: "Aufbewahrung und Löschung",
        security: "Sicherheit",
        changes: "Änderungen und Kontakt",
      },
      paragraphs: {
        scope1:
          "Agent-Native ist Open Source und der Quellcode ist unter der MIT-Lizenz verfügbar. Diese Richtlinie gilt nur für gehostete Anwendungen und Dienste, die von Builder.io für Agent-Native-Benutzer betrieben werden. Sie gilt nicht für die Nutzung des Codes durch Dritte, einschließlich Forks, benutzerdefinierter Vorlagen, privater Bereitstellungen oder selbst gehosteter Versionen. Wenn Sie Ihre eigene Bereitstellung betreiben, sind Sie für Ihre eigenen Datenpraktiken und Datenschutzrichtlinien verantwortlich.",
        scope2Prefix:
          "Diese Richtlinie soll das allgemeinere von Builder.io ergänzen",
        scope2Suffix:
          "für das Verhalten gehosteter Anwendungen von Agent-Native.",
        cookies:
          "Die Agent-Native-Dokumentationsseite und gehostete Anwendungen können notwendige Cookies für Authentifizierung und Sicherheit, für Präferenzen wie Sprache oder Design sowie konfigurierte Analysetechnologien verwenden. Die Dokumentationsseite kann Google Analytics oder Google Tag Manager laden, wenn die Bereitstellung dies konfiguriert, und der gehostete Dienst kann First-Party-Analysen zur Messung von Zuverlässigkeit und Funktionsnutzung verwenden. Wir nutzen Inhalte gehosteter Anwendungen nicht für Werbung Dritter. Cookies lassen sich über die Browsereinstellungen steuern; das Deaktivieren notwendiger Cookies kann jedoch die Anmeldung oder andere Funktionen verhindern.",
        clips1:
          "Mit Agent-Native Clips Chrome extension können Sie browserbasierte Aufzeichnungen starten und, wenn aktiviert, Browser-Diagnosen an einen Clip anhängen. Möglicherweise werden die ausgewählte Aufnahmequelle, die von Ihnen ausgewählten Kamera- und Mikrofonmedien, der Titel und die URL der aktiven Registerkarte sowie der Authentifizierungsstatus erfasst, der zum Herstellen einer Verbindung der Erweiterung mit dem gehosteten Clips erforderlich ist.",
        clips2:
          "Entwicklerprotokolle sind optional. Wenn die Erweiterung aktiviert ist, kann sie geschwärzte Konsolenmeldungen, JavaScript-Ausnahmen und fetch/XHR-Metadaten wie Methode, URL, Status, Timing und Fehlerdetails von der ausgewählten Registerkarte sammeln, während eine Aufzeichnung aktiv ist. Die Erweiterung ist nicht zum Sammeln von Anforderungstexten, Antworttexten, Cookies oder Autorisierungsheadern konzipiert.",
        clipsAnchor:
          "Für Chrome Web Store-Offenlegungen verwenden Sie diesen Abschnitt als Erweiterung der Datenschutzrichtlinie:",
        sharing1:
          "Wir verkaufen von Agent-Native gehostete Anwendungsdaten nicht und verwenden sie nicht für Werbung Dritter. Wir geben Daten an Dienstanbieter weiter, die beim Betrieb des gehosteten Dienstes helfen, z. B. Cloud-Infrastruktur, Speicherung, Authentifizierung, E-Mail, Observability, AI und Transkriptionsanbieter, wenn diese Dienste für die von Ihnen genutzte Funktion benötigt werden.",
        sharing2:
          "Wenn Sie eine Integration verbinden, kann die gehostete App entsprechend Ihrer Konfiguration und den eigenen Bedingungen des Anbieters Daten an diesen Anbieter senden oder Daten von diesem empfangen. Wir können Informationen auch offenlegen, wenn dies aus Sicherheitsgründen, zur Verhinderung von Missbrauch, zur Einhaltung gesetzlicher Vorschriften oder zum Schutz von Benutzern und des Dienstes erforderlich ist.",
        chromeLimitedUse:
          "Für die Agent-Native Clips Chrome extension richtet sich unsere Nutzung der von Chrome extension APIs erhaltenen Informationen nach der Chrome Web Store-Benutzerdatenrichtlinie, einschließlich der Anforderungen zur eingeschränkten Nutzung. Die von der Erweiterung gesammelten Browseraktivitäten werden zur Bereitstellung des benutzerseitigen Aufzeichnungs- und Diagnose-Workflows verwendet, nicht für Werbung, Weiterverkauf, Kreditwürdigkeit oder unabhängige Profilerstellung.",
        retention1:
          "Wir bewahren gehostete Anwendungsdaten so lange auf, wie es für die Bereitstellung des Dienstes, die Pflege des Arbeitsbereichsverlaufs, die Einhaltung von Verpflichtungen, die Beilegung von Streitigkeiten oder die Verbesserung der Zuverlässigkeit und Sicherheit erforderlich ist. Benutzer können Clips, Dokumente, Ressourcen und andere gehostete App-Inhalte über die entsprechenden Anwendungssteuerelemente löschen, sofern verfügbar.",
        retention2:
          "Gelöschte Inhalte können für einen begrenzten Zeitraum in Backups, Protokollen oder Prüfaufzeichnungen verbleiben, bevor sie gemäß den betrieblichen Aufbewahrungsplänen entfernt werden.",
        security:
          "Wir nutzen angemessene administrative, technische und organisatorische Sicherheitsmaßnahmen zum Schutz gehosteter Anwendungsdaten, einschließlich Zugriffskontrollen, Transportverschlüsselung, Überwachung und betrieblicher Sicherheitspraktiken. Kein Onlinedienst kann perfekte Sicherheit garantieren, daher sollten Benutzer es vermeiden, Geheimnisse oder sensible Informationen in Aufzeichnungen oder Eingabeaufforderungen aufzunehmen, es sei denn, sie beabsichtigen, diese Informationen mit der gehosteten Anwendung zu teilen.",
        changes1:
          "Wir können diese Richtlinie aktualisieren, wenn sich die von Agent-Native gehosteten Anwendungen ändern. Das Aktualisierungsdatum oben auf der Seite zeigt an, wann die Richtlinie zuletzt überarbeitet wurde.",
        changes2Prefix:
          "Bei Anfragen oder Fragen zum Datenschutz wenden Sie sich über die im aufgeführten Support- und Datenschutzkanäle an Builder.io",
      },
      dataCategories: {
        account: {
          title: "Konto- und Arbeitsbereichsinformationen",
          body: "Name, E-Mail-Adresse, Organisationsmitgliedschaft, Authentifizierungskennungen und App-Einstellungen, mit denen Sie sich anmelden und gehostete Arbeitsbereiche getrennt halten.",
        },
        hostedContent: {
          title: "Gehostete Anwendungsinhalte",
          body: "Content Sie erstellen oder laden in gehostete Agent-Native-Vorlagen hoch, z. B. Aufzeichnungen, Transkripte, Dokumente, Kommentare, Aufgaben, Eingabeaufforderungen, Agentenantworten, Dateien und Konfigurationen.",
        },
        integrations: {
          title: "Verbundene Integrationsdaten",
          body: "Daten von Diensten, die Sie verbinden möchten, z. B. Kalender, Slack, E-Mail, Speicher oder Entwicklertools, beschränkt auf die in der gehosteten App angezeigten Bereiche und Workflows.",
        },
        usage: {
          title: "Nutzungs- und technische Daten",
          body: "Gerät, Browser, IP-Adresse, Diagnoseprotokolle, Seiten- und Funktionsnutzung, Fehler und Sicherheitsereignisse, die zum Betrieb, zur Sicherung und zur Verbesserung gehosteter Dienste verwendet werden.",
        },
      },
      uses: {
        provide:
          "Bereitstellen, Synchronisieren und Betreiben gehosteter Agent-Native-Anwendungen und ihrer Agent-Workflows.",
        transform:
          "Zeichnen Sie Inhalte auf, transkribieren Sie sie, fassen Sie sie zusammen, suchen Sie sie, teilen Sie sie mit anderen oder transformieren Sie sie, wenn Sie die gehostete App dazu auffordern.",
        auth: "Authentifizieren Sie Benutzer, verwalten Sie Organisationen, erzwingen Sie Zugriffskontrollen und verhindern Sie Missbrauch.",
        support:
          "Debuggen Sie Vorfälle, bieten Sie Support, messen Sie die Zuverlässigkeit und verbessern Sie das gehostete Produkterlebnis.",
        comply:
          "Halten Sie rechtliche, Sicherheits- und Plattformverpflichtungen ein.",
      },
      links: {
        builderPrivacy: "Datenschutzrichtlinie",
        builderPrivacyFull: "Builder.io Datenschutzrichtlinie",
      },
    },
    about: {
      eyebrow: "Über Agent-Native",
      title: "Open-Source-Apps für Agents und Menschen",
      intro:
        "Agent-Native ist ein Open-Source-Framework für Anwendungen, in denen KI-Agents und Benutzeroberflächen dieselben Aktionen, Daten und den Anwendungsstatus teilen.",
      sections: {
        project: {
          title: "Ein gemeinsames Betriebsmodell",
          body: "Agent-Native behandelt Agent und Oberfläche als gleichwertige Partner. Eine Aktion kann ein UI-Steuerelement, ein Agent-Tool, eine HTTP-Route, eine MCP- oder A2A-Fähigkeit, einen CLI-Befehl und einen prüfbaren Ablauf versorgen. Gemeinsamer SQL-Status hält die menschliche und die Agentenansicht synchron.",
        },
        openSource: {
          title: "Standardmäßig Open Source",
          body: "Der Quellcode steht unter der MIT-Lizenz im Repository BuilderIO/agent-native zur Verfügung. Entwickler können ihn prüfen, lokal ausführen, Datenbank- und Modellanbieter wählen und an ihr Produkt anpassen. Gehostete Dienste werden getrennt von Forks und eigenen Deployments betrieben.",
        },
        hosted: {
          title: "Gehostet und selbst gehostet",
          body: "Builder.io betreibt die gehosteten Agent-Native-Anwendungen und die Dokumentation auf agent-native.com. Das Framework ist auch für Teams gedacht, die eigene Anwendungen bereitstellen und betreuen möchten. Aktionsverträge, Zugriffsgrenzen, Agentenanweisungen und öffentliche Protokolle sind im Code und in der Dokumentation prüfbar.",
        },
        community: {
          title: "Öffentlich entwickelt",
          body: "Das Projekt wird offen über GitHub-Issues, Pull Requests, Dokumentation und die Agent-Native-Community entwickelt. Lies die Dokumentation zur Architektur, prüfe den Quellcode einer Implementierung oder tausche dich über einen Anwendungsfall aus und trage eine Änderung bei.",
        },
      },
    },
    contact: {
      eyebrow: "Kontakt",
      title: "Builder.io zu Agent-Native kontaktieren",
      intro:
        "Nutze die Support-, Quellcode- und Community-Kanäle für Fragen, Fehlerberichte, Verbesserungsvorschläge oder Sicherheitsmeldungen zu Agent-Native.",
      emailLabel: "support@builder.io per E-Mail kontaktieren",
      sections: {
        support: {
          title: "Produkt- und gehosteter Service-Support",
          body: "Bei Fragen zu einer gehosteten Anwendung, zum Kontozugriff, zu einem Dokumentationsproblem oder zu nicht lösbarem Verhalten schreibe an support@builder.io. Füge die öffentliche URL, eine reproduzierbare Beschreibung und relevante Anfrage- oder Run-IDs hinzu. Sende keine Passwörter, API-Schlüssel, Bearer-Tokens oder privaten Kundendaten.",
        },
        source: {
          title: "Open-Source-Projekt und Community",
          body: "Nutze das GitHub-Repository für Quellcodefehler, Vorschläge, Pull Requests und Implementierungsdiskussionen. Discord eignet sich für Fragen, die vom Austausch mit anderen Entwicklern profitieren. Suche zuerst in Issues und Dokumentation, damit Maintainer den nötigen Kontext erhalten.",
        },
        security: {
          title: "Sicherheitsmeldungen",
          body: "Veröffentliche eine ungepatchte Schwachstelle nicht in einem öffentlichen Issue oder Chat. Kontaktiere Builder.io über den verfügbaren Sicherheitskanal und sende nur die zur Reproduktion und Bewertung nötigen Informationen. Halte Zugangsdaten, private Daten und Exploit-Material aus normalen Supportanfragen heraus.",
        },
        legal: {
          title: "Rechtliches und Datenschutz",
          body: "Bei Datenschutzfragen lies zuerst die Agent-Native-Datenschutzrichtlinie und die rechtlichen Ressourcen von Builder.io. Builder.io, Inc. befindet sich in 95 3rd Street, 2nd Floor, San Francisco, CA 94103, Vereinigte Staaten. Bedingungen für den gehosteten Dienst und Pflichten beim Self-Hosting stehen in den Nutzungsbedingungen.",
        },
      },
    },
    terms: {
      eyebrow: "Nutzungsbedingungen",
      title: "Agent-Native gehostete Anwendungen",
      intro:
        "Diese Bedingungen gelten, wenn Builder.io von Agent-Native gehostete Anwendungen, gehostete Vorlagen, Demos und offizielle gehostete Dienste für Sie betreibt.",
      scopeCards: {
        hosted: {
          title: "Gehostete Apps",
          body: "Abgedeckt, wenn Sie eine von Builder.io betriebene Agent-Native-App oder -Vorlage verwenden.",
        },
        openSource: {
          title: "Open Source",
          body: "Der von MIT lizenzierte Quellcode bleibt unter seiner Open-Source-Lizenz verfügbar.",
        },
        selfHosted: {
          title: "Selbst gehostet",
          body: "Separate Bereitstellungen, die von Ihnen oder einer anderen Person betrieben werden, sind keine Builder.io gehosteten Dienste.",
        },
      },
      sections: {
        scope: "Geltungsbereich und verwandte Begriffe",
        hostedService: "Gehosteter Dienst",
        accounts: "Konten und Arbeitsbereiche",
        content: "Ihre Inhalte und Berechtigungen",
        agents: "Agenten, AI-Ausgaben und Integrationen",
        acceptableUse: "Akzeptable Verwendung",
        openSource: "Open Source und Selbsthosting",
        suspension: "Aussetzung und Kündigung",
        disclaimers: "Haftungsausschluss und Haftung",
        changes: "Änderungen und Kontakt",
      },
      paragraphs: {
        scope1:
          "Agent-Native ist Open Source und sein Quellcode ist unter der MIT-Lizenz verfügbar. Diese Bedingungen gelten nur für gehostete Anwendungen und Dienste, die von Builder.io für Agent-Native-Benutzer betrieben werden. Sie gelten nicht für Forks, benutzerdefinierte Vorlagen, private Bereitstellungen oder selbst gehostete Versionen, die außerhalb von Builder.io betrieben werden.",
        scope2Prefix: "Diese Begriffe ergänzen das allgemeinere von Builder.io",
        scope2Middle: "und der Agent-Native",
        scope2Suffix:
          "Wenn Sie eine gehostete Agent-Native-App im Namen eines Unternehmens oder einer Organisation nutzen, erklären Sie, dass Sie befugt sind, diese Bedingungen für diese Organisation zu akzeptieren.",
        scope3:
          "Agent-Native bietet keine kostenpflichtigen Tarife oder kostenpflichtigen Hosting-Abonnements an. Kommerzielle Bedingungen von Builder.io, etwa Bestellformulare, Gebühren, Enterprise-Support, Service-Level und Nachträge zur Datenverarbeitung, sind nicht Teil dieses Angebots, sofern sie nicht separat schriftlich vereinbart wurden.",
        hostedService:
          "Builder.io kann gehostete Agent-Native-Anwendungen, Vorlagen, Demos, freigegebene Arbeitsbereiche, Browsererweiterungen und zugehörige Agenten-Workflows bereitstellen. Der gehostete Dienst kann im Zuge der Weiterentwicklung des Produkts aktualisiert, eingeschränkt, ausgesetzt oder eingestellt werden.",
        accounts1:
          "Sie sind für die Richtigkeit der Kontoinformationen, der Aktivitäten unter Ihrem Konto und die Sicherheit der Anmeldeinformationen verantwortlich. Gehostete Agent-Native-Apps können Organisationsfunktionen, Einladungen, freigegebene Ressourcen, verbundene Integrationen und app-spezifische Zugriffskontrollen umfassen. Laden Sie nur Benutzer ein und verbinden Sie Dienste, zu deren Nutzung Sie berechtigt sind.",
        accounts2:
          "Wenn Sie glauben, dass ein Konto, ein Arbeitsbereich, eine Integration oder eine freigegebene Ressource kompromittiert oder missbraucht wurde, wenden Sie sich umgehend an den Builder.io-Support.",
        content1:
          "Sie behalten das Eigentum an den Inhalten, die Sie erstellen, hochladen, aufzeichnen, importieren oder mit gehosteten Agent-Native-Apps verbinden. Sie erteilen Builder.io die eingeschränkte Berechtigung, die zum Hosten, Verarbeiten, Übertragen, Anzeigen, Transformieren, Analysieren und Speichern dieser Inhalte erforderlich ist, damit die gehostete App und ihre Agent-Workflows funktionieren können.",
        content2:
          "Sie sind dafür verantwortlich, über die erforderlichen Rechte und Berechtigungen für Inhalte, Aufzeichnungen, Eingabeaufforderungen, Dateien, Anmeldeinformationen und verbundene Integrationsdaten zu verfügen, die Sie dem Dienst bereitstellen.",
        agents1:
          "Gehostete Agent-Native-Apps können auf Ihren Wunsch AI-Agenten, Tools, Automatisierungen und Anbieterintegrationen ausführen. Die von AI generierte Ausgabe ist möglicherweise unvollständig, ungenau oder für eine bestimmte Verwendung ungeeignet. Überprüfen Sie wichtige Ausgaben, Aktionen, Exporte und Nachrichten, bevor Sie sich darauf verlassen.",
        agents2:
          "Wenn Sie Dienste Dritter verbinden, unterliegt Ihre Nutzung dieser Dienste weiterhin deren eigenen Bedingungen, Beschränkungen, Berechtigungen und Datenschutzpraktiken.",
        openSource:
          "Diese Bedingungen ändern nicht die Open-Source-Lizenz für Agent-Native-Code. Wenn Sie Agent-Native herunterladen, forken, ändern oder selbst hosten, regeln die MIT-Lizenz und die Bedingungen, die Sie für Ihre eigene Bereitstellung festlegen, diese Nutzung. Sie sind für Sicherheit, Datenschutz, Compliance, Betrieb und Benutzerunterstützung für die von Ihnen betriebenen Bereitstellungen verantwortlich.",
        suspensionPrefix:
          "Builder.io kann den Zugriff auf gehostete Agent-Native-Dienste aussetzen oder einschränken, wenn dies zum Schutz von Benutzern, zur Einhaltung von Gesetzen, zur Verhinderung von Missbrauch, zur Bewältigung von Sicherheitsrisiken oder zum Betrieb des Dienstes erforderlich ist. Sie können die Nutzung des gehosteten Dienstes jederzeit beenden. Einige Daten können für einen begrenzten Zeitraum in Backups, Protokollen oder Prüfaufzeichnungen verbleiben, wie im beschrieben",
        disclaimers1:
          "Gehostete Agent-Native-Dienste werden im Ist-Zustand und nach Verfügbarkeit bereitgestellt, vorbehaltlich des geltenden Rechts und einer separaten schriftlichen Vereinbarung, die Sie mit Builder.io haben. Builder.io garantiert nicht, dass gehostete Apps, Integrationen, Automatisierungen oder AI-Ausgaben unterbrechungsfrei und fehlerfrei sind oder alle Anforderungen erfüllen.",
        disclaimers2Prefix:
          "Im größtmöglichen gesetzlich zulässigen Umfang ist die Haftung von Builder.io für gehostete Agent-Native-Dienste wie in den allgemeinen Bestimmungen von Builder.io beschrieben beschränkt",
        disclaimers2Suffix:
          "oder eine andere schriftliche Vereinbarung, die für Ihre Nutzung gilt.",
        changes1:
          "Wir können diese Bedingungen aktualisieren, wenn sich die von Agent-Native gehosteten Anwendungen ändern. Das Aktualisierungsdatum oben auf der Seite zeigt an, wann die Bedingungen zuletzt überarbeitet wurden.",
        changes2Prefix:
          "Bei Fragen zu diesen Bedingungen wenden Sie sich über die in Builder.io aufgeführten Supportkanäle an Builder.io",
      },
      hostedServicePoints: {
        create:
          "Erstellen und betreiben Sie gehostete Agent-Native-Arbeitsbereiche und Vorlagen-Apps.",
        workflows:
          "Führen Sie Agenten-Workflows, Aktionen, Automatisierungen und Integrationen aus, die Sie verwenden möchten.",
        store:
          "Speichern Sie gehostete App-Inhalte, Einstellungen, Organisationsdaten und den Status des verbundenen Kontos, die für die Bereitstellung des Dienstes erforderlich sind.",
        improve:
          "Messen, sichern, debuggen und verbessern Sie gehostete Agent-Native-Dienste.",
      },
      acceptableUse: {
        laws: "Verwenden Sie gehostete Agent-Native-Apps nicht, um gegen Gesetze zu verstoßen, Rechte zu verletzen oder Personen oder Systemen zu schaden.",
        bypass:
          "Versuchen Sie nicht, Zugriffskontrollen, Ratenbeschränkungen, Sicherheitsgrenzen oder die Isolierung von Mandanten zu umgehen.",
        malware:
          "Laden Sie keine Malware, kein Material zum Diebstahl von Zugangsdaten oder Inhalte hoch, die den Dienst stören sollen.",
        spam: "Nutzen Sie den Dienst nicht zum Versenden von Spam, zum Scrapen ohne Autorisierung oder zum Missbrauch verbundener Anbieter.",
        sensitive:
          "Geben Sie keine Geheimnisse oder sensiblen regulierten Daten in gehostete Apps ein, es sei denn, Sie sind dazu berechtigt und die App ist für diese Verwendung geeignet.",
      },
      links: {
        builderTerms: "Nutzungsbedingungen",
        privacyPolicy: "Datenschutzrichtlinie",
      },
    },
  },
  nav: {
    overview: "Überblick",
    coreArchitecture: "Kernarchitektur",
    dataAuthGovernance: "Daten, Auth und Governance",
    usingYourAgent: "Deinen Agent verwenden",
    agentResources: "Agent-Ressourcen",
    integrations: "Integrationen",
    advancedRuntime: "Fortgeschritten: Runtime erweitern",
    templatesSection: "Apps",
    gettingStarted: "Erste Schritte",
    gettingStartedActions: "Add an Action",
    gettingStartedPages: "Add a Page",
    whatIsAgentNative: "Was ist Agent-Native?",
    agentSurfaces: "Agent-Oberflächen",
    agentNativeConfig: "Agent-Native Config",
    keyConcepts: "Schlüsselkonzepte",
    agentNativeToolkit: "Toolkit",
    toolkitOverview: "Überblick",
    toolkitUiPrimitives: "UI-Primitiven",
    customDesignSystem: "Eigene Design-Systeme",
    toolkitEditorsCanvases: "Editor und Arbeitsflächen",
    toolkitContextKnowledge: "Kontext und Wissen",
    toolkitSharing: "Freigabe",
    toolkitCollaboration: "Zusammenarbeit",
    toolkitSettings: "Einstellungen",
    toolkitOrgTeam: "Organisation und Team",
    toolkitSetupConnections: "Setup und Verbindungen",
    toolkitCommandNavigation: "Befehle und Navigation",
    toolkitResources: "Ressourcen",
    toolkitAgentUx: "Agent-Erlebnis",
    toolkitHistory: "Verlauf",
    toolkitCommentsReview: "Kommentare und Review",
    toolkitObservability: "Observability",
    featureKits: "Feature-Kits",
    appChrome: "App-Rahmen",
    capabilityPackages: "Capability-Pakete",
    capabilityPackagesOverview: "Überblick",
    packageLifecycle: "Paketlebenszyklus",
    versioningAndStability: "Versionierung und Stabilität",
    templatesOverview: "Vorlagen",
    pureAgentApps: "Automatisierungsorientierte Apps",
    faq: "FAQ",
    server: "Server",
    serverOverview: "Überblick",
    serverMiddleware: "Middleware",
    serverPlugins: "Plugins",
    serverRoutes: "Routen",
    client: "Client",
    clientOverview: "Überblick",
    clientDataSync: "Daten & Synchronisierung",
    clientAgentChat: "Agent-Chat",
    clientAdvanced: "Fortgeschritten",
    clientSyncInternals: "Sync-Interna",
    clientEntryPoints: "Einstiegspunkte",
    routing: "Routing",
    actions: "Aktionen",
    actionsOverview: "Überblick",
    actionsDefining: "Actions definieren",
    actionsAccessControl: "Zugriff & Autorisierung",
    actionsRunContext: "Ausführungskontext",
    actionsOtherSurfaces: "Weitere Oberflächen",
    actionsAdvanced: "Fortgeschritten & Legacy",
    actionsAgentTools: "Agent-Zugriff in Produktion",
    publicAgentWeb: "Öffentliches Agent Web",
    database: "Datenbank",
    databaseProviders: "Datenbankanbieter",
    databaseNeon: "Neon Postgres",
    databaseSupabase: "Supabase Postgres",
    databaseAwsRds: "Amazon RDS for PostgreSQL",
    databaseCloudSql: "Cloud SQL for PostgreSQL",
    databaseAzurePostgres: "Azure Database for PostgreSQL",
    databasePostgres: "Plain Postgres",
    internationalization: "Internationalisierung",
    localFileMode: "Lokaler Dateimodus",
    fileUploads: "Datei-Uploads",
    deployment: "Deployment",
    deploymentOverview: "Überblick",
    deploymentProviders: "Hosting-Anbieter",
    deploymentProduction: "Produktion & erweitert",
    deployAnApp: "Eine App bereitstellen",
    workspaceDeployment: "Workspace-Deployment",
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
    deploymentOtherPlatforms: "Weitere Plattformen",
    ssrCaching: "SSR-Caching",
    deploymentEnvironmentVariables: "Deployment: Umgebungsvariablen",
    updatingUiInProduction: "UI in Produktion Aktualisieren",
    environmentVariables: "Umgebungsvariablen",
    progress: "Fortschritt",
    authentication: "Authentifizierung",
    multiTenancy: "Mandantenfähigkeit",
    organizationsTeamsPermissions: "Organisationen, Teams und Berechtigungen",
    administeredDeployments: "Verwaltete Bereitstellungen",
    securityDataScoping: "Sicherheit und Datenbereich",
    sharingPrivacy: "Teilen und Datenschutz",
    trackingAnalytics: "Tracking und Analytics",
    auditLog: "Audit-Log",
    doctorCodeChecks: "Doctor (Code-Prüfungen)",
    observability: "Beobachtbarkeit",
    observationalMemory: "Beobachtungsspeicher",
    ciEvalGate: "CI-Eval-Gate",
    usingYourAgentOverview: "Überblick",
    contextAwareness: "Kontextbewusstsein",
    agentMentions: "Agent-Erwähnungen",
    voiceInput: "Spracheingabe",
    dropInAgent: "Drop-in-Agent",
    componentApi: "Komponenten-API",
    nativeChatUi: "Native Chat-UI",
    agentkit: "AgentKit",
    generativeUi: "Generative Oberfläche",
    realTimeCollaboration: "Echtzeit-Zusammenarbeit",
    agentResourcesOverview: "Übersicht über Agent-Ressourcen",
    skills: "Fähigkeiten",
    customAgentsTeams: "Eigene Agents und Teams",
    workspaceGovernance: "Workspace-Governance",
    recurringJobs: "Wiederkehrende Jobs",
    automations: "Automatisierungen",
    extensions: "Erweiterungen",
    dataPrograms: "Datenprogramme",
    multiAppWorkspaces: "Multi-App-Workspaces",
    onboardingApiKeys: "Onboarding und API-Schlüssel",
    messaging: "Messaging (Slack, Email...)",
    messagingRecipes: "Messaging-Rezepte",
    messagingInternals: "Messaging-Interna",
    dispatch: "Dispatch",
    portal: "Portal",
    a2aProtocol: "A2A-Protokoll",
    mcpClients: "MCP-Clients (Tools hinzufügen)",
    httpApi: "HTTP-API (Aktionen aufrufen)",
    mcpServer: "MCP-Server (App bereitstellen)",
    externalAgents: "Externe Agents (Host verbinden)",
    externalAgentsCatalog: "Katalog externer Agents",
    mcpApps: "MCP Apps (Inline-UIs)",
    webMcp: "WebMCP (Browser-Tools)",
    crossAppSso: "Cross-App-SSO",
    notifications: "Benachrichtigungen",
    automationConnectors: "Workflow-Connectors",
    workspaceConnections: "Workspace-Verbindungen",
    creatingTemplates: "Templates erstellen",
    syncingTemplateChanges: "Template-Änderungen synchronisieren",
    writingAgentInstructions: "Agent-Anweisungen schreiben",
    embeddingSdk: "Einbettungs-SDK",
    agentNativeCodeUi: "Agent-Native-Code-UI",
    harnessAgents: "Harness-Agents",
    adapters: "Adapter",
    cliAdapters: "CLI-Adapter",
    processors: "In-Loop-Prozessoren",
    durableBackgroundRuns: "Dauerhafte Hintergrundläufe",
    durableResume: "Dauerhafte Wiederaufnahme",
    blueprintInstaller: "Blueprint-Installer",
    chat: "Chat",
    chatOverview: "Überblick",
    chatFirstEdits: "Deine erste Funktion",
    chatDevelopers: "Entwicklerhandbuch",
    calendar: "Kalender",
    calendarOverview: "Überblick",
    calendarAgent: "Mit dem Agent sprechen",
    calendarFeatures: "Funktionen",
    calendarIntegrations: "Cross-App-Nutzung",
    calendarDevelopers: "Entwicklerhandbuch",
    content: "Inhalt",
    contentOverview: "Überblick",
    contentEditing: "Schreiben und Organisieren",
    contentDatabases: "Sammlungen und Formulare",
    contentSync: "Lokale Dateien und Sync",
    contentDevelopers: "Entwicklerhandbuch",
    plans: "Plans",
    visualPlans: "Visuelle Pläne",
    planReviewWorkflow: "Review und Kommentare",
    planAutomations: "Ereignisse und Automatisierungen",
    planLocalAndDesktop: "Lokale Dateien und Desktop",
    planDevelopers: "Entwicklerhandbuch",
    prVisualRecap: "Visuelle PR-Zusammenfassung",
    planPluginMarketplace: "Plan-Plugin und Marketplace",
    slides: "Folien",
    slidesOverview: "Überblick",
    slidesFeatures: "Funktionen",
    slidesAgent: "Mit dem Agent sprechen",
    slidesIntegrations: "Cross-App-Nutzung",
    slidesDevelopers: "Entwicklerhandbuch",
    analytics: "Analysen",
    analyticsOverview: "Überblick",
    analyticsDashboards: "Dashboards und Analysen",
    analyticsConnectors: "Datenquellen verbinden",
    analyticsMonitoringAndSessions: "Monitoring und Session-Replay",
    analyticsDevelopers: "Entwicklerhandbuch",
    mail: "Mail",
    mailOverview: "Überblick",
    mailAgent: "Mit dem Agent sprechen",
    mailInbox: "Posteingang und Automatisierungen",
    mailDraftsAndQueue: "Entwürfe und Terminplanung",
    mailDevelopers: "Entwicklerhandbuch",
    clips: "Clips",
    clipsOverview: "Überblick",
    clipsFeatures: "Funktionen",
    clipsAgent: "Mit dem Agent sprechen",
    clipsIntegrations: "Cross-App-Nutzung",
    clipsDevelopers: "Entwicklerhandbuch",
    clipsEmbed: "Clips einbetten",
    assets: "Assets",
    assetsOverview: "Überblick",
    assetsGeneration: "Erstellen und Verfeinern",
    assetsPresets: "Voreinstellungen",
    assetsIntegrations: "Cross-App-Nutzung",
    assetsDevelopers: "Entwicklerhandbuch",
    design: "Design",
    designOverview: "Überblick",
    designFeatures: "Funktionen",
    designAgent: "Mit dem Agent sprechen",
    designIntegrations: "Cross-App-Nutzung",
    designDevelopers: "Entwicklerhandbuch",
    dispatchOverview: "Überblick",
    dispatchFeatures: "Funktionen",
    dispatchAgent: "Mit dem Agent sprechen",
    dispatchIntegrations: "Cross-App-Nutzung",
    dispatchDevelopers: "Entwicklerhandbuch",
    dispatchReference: "Aktions- und Datenreferenz",
    forms: "Formulare",
    formsOverview: "Überblick",
    formsFeatures: "Funktionen",
    formsAgent: "Mit dem Agent sprechen",
    formsIntegrations: "Cross-App-Nutzung",
    docsComponents: "Docs Components",
    formsDevelopers: "Entwicklerhandbuch",
  },
} satisfies typeof enUS;

export default deDE;
