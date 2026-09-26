import enUS from "./en-US";

const frFR = {
  language: {
    label: "Langue",
    system: "Système",
    systemDescription: "Utiliser la langue du navigateur",
    suggestionTitle: "Lire cette page en {{language}} ?",
    suggestionDescription: "La langue de votre navigateur est {{language}}.",
    suggestionSwitch: "Passer à {{language}}",
    suggestionKeepEnglish: "Garder l'anglais",
  },
  header: {
    docs: "Documents",
    templates: "Apps",
    skills: "Compétences",
    searchAria: "Rechercher dans la documentation",
    searchPlaceholder: "Rechercher...",
    askAssistant: "Demander à l'IA",
    toggleNavigation: "Afficher ou masquer la navigation",
    copyLogoSvg: "Copier le logo SVG",
    copyWordmark: "Copier le logotype",
    brandAssets: "Ressources de marque",
    tryNow: "Essayer",
  },
  footer: {
    download: "Télécharger",
    pricing: "Tarifs",
    brand: "Marque",
    privacy: "Confidentialité",
    terms: "Conditions",
  },
  feedback: {
    label: "Retour",
    placeholder: "Dites-nous comment améliorer cette documentation.",
  },
  demoVideo: {
    visualPlanningAria: "Démo de planification visuelle Agent-Native",
  },
  docBlocks: {
    blockLabel: "Bloc {{alias}}",
    unknownBlockType: "type de bloc inconnu",
  },
  theme: {
    light: "clair",
    dark: "sombre",
    toggle: "Changer de thème",
    label: "Thème : {{theme}}",
  },
  docs: {
    navigateAria: "Parcourir les docs",
    onThisPage: "Sur cette page",
    copyMarkdown: "Copier le doc en Markdown",
    copiedMarkdown: "Markdown copié",
    copyMarkdownError: "Impossible de copier le Markdown",
    previous: "Précédent",
    next: "Suivant",
    draftLabel: "Brouillon",
    draftDescription:
      "Cette page est en cours de rédaction. Le contenu peut être incomplet ou sujet à modification avant publication.",
    translationLabel: "Traduction automatique",
    translationDescription:
      "Cette page a été traduite automatiquement et peut ne pas être entièrement exacte.",
    translationViewOriginal: "Voir l'original en anglais",
  },
  search: {
    dialogLabel: "Rechercher la documentation",
    placeholder: "Rechercher la documentation...",
    empty: "Saisissez une requête pour chercher dans toute la documentation",
    toggleChatSidebar: "Afficher ou masquer la barre latérale du chat",
    loadError: "La recherche n’a pas pu se charger. Réessayez.",
    retry: "Réessayer",
    noResults: 'Aucun résultat pour "{{query}}"',
    browseAllDocs: "Parcourir toute la documentation",
    navigate: "naviguer",
    open: "ouvrir",
    close: "fermer",
  },
  agent: {
    emptyState: "Posez-moi une question sur Agent-Native",
    suggestionGettingStarted: "Comment démarrer avec Agent-Native ?",
    suggestionActions: "Comment fonctionnent les actions ?",
    suggestionPolling: "Explique le modèle de synchronisation par polling",
    suggestionDeploy: "Comment déployer en production ?",
  },
  errors: {
    loadingLatest: "Chargement de la dernière version...",
    notFoundTitle: "Page introuvable",
    notFoundBody: "La page recherchée n'existe pas ou a été déplacée.",
    goHome: "Accueil",
    readDocs: "Lire la documentation",
    genericTitle: "Une erreur s'est produite",
    genericBody: "Une erreur inattendue est survenue.",
    sendFeedback: "Envoyer un retour",
    feedbackPlaceholder:
      "Décrivez ce qui s'est passé avant cette erreur de Docs.",
    openGitHubIssue: "Ouvrir une issue GitHub",
  },
  home: {
    hero: {
      titleLine1: "Le framework pour",
      titleAccent: "apps agentic",
      body: "Ne choisissez pas entre les apps et les agents. Les apps Agent-Native sont les deux.",
      primaryCta: "Commencer à construire",
      secondaryCta: "Voir la documentation",
    },
    code: {
      quickStartComment: "Créez une app avec une commande",
      skillInstallComment:
        "Ajoutez la planification Agent-Native à un coding agent que vous utilisez déjà",
      frameworkComment:
        "Un action alimente l'agent, l'UI, HTTP, MCP, A2A et CLI.",
      frameworkDescription: "Dites bonjour depuis l'app-agent loop local.",
    },
    actionSurface: {
      eyebrow: "Profondément agentique, pas une IA ajoutée à côté",
      title: "Une action vous donne toute la surface",
      body: "Définissez une opération une fois. Agent-Native en fait l’action UI, l’outil agent, le endpoint HTTP, la surface MCP/A2A, la commande CLI, le contrôle de permission et la piste d’audit.",
      buildAction: "Créer une action",
      benefits: {
        oneActionDefinition: {
          title: "Une seule définition d’action",
          body: "UI, agent, HTTP, MCP, A2A et CLI appellent tous la même opération.",
        },
        scopedByDefault: {
          title: "Portée par défaut",
          body: "Auth, partage, gouvernance et journaux d’audit accompagnent le travail.",
        },
        headedOrHeadless: {
          title: "Apps, automatisations et agents",
          body: "Exécutez la même opération depuis chat, UI, tâches planifiées, files, agents externes ou scripts.",
        },
        contextRichInput: {
          title: "Entrée riche en contexte",
          body: "Chat, voix, skills, instructions et état UI restent dans la boucle.",
        },
        openAgentProtocols: {
          title: "Protocoles agents ouverts",
          body: "A2A, MCP, MCP apps et agents externes sont des primitives du framework.",
        },
        observableByDesign: {
          title: "Observable par conception",
          body: "Traces, evals, feedback et historique d’audit rendent le travail des agents inspectable.",
        },
      },
    },
    modules: {
      pageEyebrow: "Framework modulaire",
      title: "Modules intégrés pour apps agentiques",
      body: "Des briques vérifiées par des humains pour les parties de production que les agents ne devraient pas inventer depuis zéro. Utilisez-les telles quelles, inspectez la source ou remplacez le module quand votre app demande autre chose.",
      pageBody:
        "Agent-Native fournit des briques vérifiées par des humains pour le travail de production que les agents ne devraient pas improviser. Utilisez-les telles quelles, inspectez la source ou remplacez le module quand votre produit demande autre chose.",
      viewAll: "Voir tous les modules",
      browseApps: "Explorer les apps construites avec ces modules",
      items: {
        autoStateSyncing: {
          title: "Synchronisation automatique de l’état",
          body: "Les changements de l’agent mettent à jour l’UI, et l’état UI reste visible pour l’agent sans autre passerelle.",
        },
        actions: {
          title: "Actions partagées",
          body: "Définissez le travail une fois et utilisez-le depuis l’UI, l’agent, HTTP, MCP, A2A et CLI.",
        },
        sqlStateOrm: {
          title: "État PostgreSQL et ORM",
          body: "Données d’app durables, état applicatif, migrations et schémas PostgreSQL/PGlite.",
        },
        dbAdmin: {
          title: "Admin base de données",
          body: "Schémas lisibles par l’agent, surfaces de requête, migrations et outils admin sans back office personnalisé.",
        },
        authGovernance: {
          title: "Auth et gouvernance",
          body: "Connexion, organisations, multi-tenancy, permissions, approbations et hooks de politique.",
        },
        sharing: {
          title: "Partage",
          body: "Liens de partage, accès borné, ressources publiques ou privées, commentaires et surfaces de revue.",
        },
        realtimeCollaboration: {
          title: "Collaboration temps réel",
          body: "Édition multiutilisateur, présence en direct, UI optimiste et réconciliation côté serveur.",
        },
        agentInteroperability: {
          title: "Interopérabilité agent",
          body: "A2A, MCP, MCP apps, agents externes, harness agents et relais entre apps.",
        },
        automationsQueues: {
          title: "Automatisations et files",
          body: "Travail déclenché par événements, tâches planifiées, exécutions en arrière-plan et mutations fiables.",
        },
        agentUiSurface: {
          title: "Surface UI de l’agent",
          body: "Chat, skills, instructions, UI générative, voix et contexte visible par l’agent.",
        },
        observability: {
          title: "Observabilité",
          body: "Traces, evals, feedback, expériences et preuve de ce que les agents ont affirmé faire.",
        },
        workspaces: {
          title: "Espaces de travail",
          body: "Apps agentic composables qui se découvrent entre elles et se coordonnent via A2A.",
        },
        sourceOwnership: {
          title: "Propriété de la source",
          body: "Docs et source restent là où les agents peuvent inspecter, posséder, éjecter, patcher ou remplacer.",
        },
        auditLogs: {
          title: "Journaux d’audit",
          body: "Un enregistrement durable des changements humains et agents, limité aux ressources accessibles aux utilisateurs.",
        },
      },
    },
    framework: {
      title: "Le framework pour apps agent-native",
      body1:
        "Agent-Native est un framework open source pour construire des agentic applications : commencez avec Chat, définissez des actions partagées, puis ajoutez UI, jobs et collaboration autour du même état.",
      body2:
        "Utilisez PGlite local ou PostgreSQL hébergé, votre fournisseur d’hébergement, votre stack de modèles et votre code d’app.",
      cta: "Lire le guide du framework",
      primitives: {
        actions: {
          title: "Opérations",
          description:
            "Définissez le travail une fois. Utilisez-le depuis agent, UI, API, MCP et A2A.",
        },
        sharedState: {
          title: "État partagé",
          description:
            "L'état d'app adossé à SQL garde humains, agents et sessions synchronisés.",
        },
        agentRuntime: {
          title: "Runtime d'agent",
          description:
            "L'app-agent loop, les tools, skills, memory, jobs et l'observabilité sont livrés ensemble.",
        },
        postgresSpecific: {
          title: "Spécifique à PostgreSQL",
          description:
            "Utilisez les assistants de schéma PostgreSQL du framework avec PGlite local ou Postgres hébergé sur n’importe quel hôte compatible Nitro.",
        },
      },
    },
    templates: {
      title: "Essayez une app Agent-Native",
      eyebrow:
        "Partez d'une app fonctionnelle et laissez l'agent la faire évoluer.",
      cta: "Voir les apps",
    },
    skills: {
      title: "Essayez avec un skill",
      body: "Ajoutez la planification visuelle et les PR recaps à Claude Code, Codex, Cursor, Pi, OpenCode ou VS Code avec une seule commande.",
      planBody:
        "Des plans révisables avec diagrammes, wireframes, cartes de fichiers et commentaires avant les changements de code.",
      recapBody:
        "Un résumé visuel d'une PR ou d'un diff pour que les reviewers voient la forme avant les lignes brutes.",
      cta: "Parcourir le guide Skills",
    },
    connected: {
      title: "Agents et UI, entièrement connectés",
      body: "L'agent et l'UI sont des citoyens égaux du même système. Chaque action fonctionne dans les deux sens : cliquez dessus ou demandez-la.",
      tabs: {
        agentSees: {
          title: "L'agent voit tout",
          description:
            "Il peut lire et mettre à jour toute UI, toute donnée et tout état dans l'application.",
        },
        uiTalks: {
          title: "L'UI parle à l'agent",
          description:
            "Boutons, formulaires et workflows poussent du contenu structuré vers l'agent, ce qui donne des flux guidés qui passent tous par l'agent, y compris skills, rules et instructions.",
        },
        agentUpdates: {
          title: "L'agent met à jour son propre code",
          description:
            "Il peut modifier l'app elle-même pour changer les features et la fonctionnalité. Vos tools s'améliorent avec le temps.",
        },
        everything: {
          title: "Tout fonctionne dans les deux sens",
          description:
            "Chaque action disponible dans l'UI est aussi disponible pour l'agent. Vous pouvez cliquer pour faire quelque chose ou demander à l'agent de le faire.",
        },
      },
    },
    comparison: {
      titleLine1: "Ne choisissez pas entre apps et agents.",
      titleAccent: "Les apps agent-native sont les deux.",
      columns: {
        saas: "Outils SaaS",
        agents: "AI Agents bruts",
        internal: "Outils internes",
        native: "App Agent-Native",
      },
      rows: {
        ui: "UI",
        ai: "AI",
        customization: "Personnalisation",
        ownership: "Propriété",
      },
      cells: {
        polishedButRigid: "Soignés mais rigides",
        none: "Aucune",
        mixedQuality: "Qualité variable",
        fullUi: "UI complète, personnalisez et lancez",
        boltedOn: "Greffée dessus",
        powerful: "Puissante",
        shallowlyConnected: "Connexion superficielle",
        agentFirst: "Agent-first, intégrée",
        cant: "Impossible",
        instructionsAndSkills: "Instructions et skills",
        fullHighMaintenance: "Complète, mais lourde à maintenir",
        agentModifies: "L'Agent modifie l'app",
        rented: "Louée",
        somewhatYours: "Partiellement à vous",
        youOwnCode: "Le code vous appartient",
      },
    },
    quickStart: {
      title: "Commencez avec une commande",
      body: "Une commande crée une app locale chat-first adossée à actions, durable threads et PGlite. Utilisez `--headless` seulement pour les workflows automation-first sans UI navigateur pour le moment.",
    },
    finalCta: {
      title: "Un logiciel conçu pour l'ère agentic",
      body: "Commencez avec une commande ou un durable action, passez-le dans l'app-agent loop, puis faites-le évoluer en UI, jobs et collaboration sans réécrire l'opération. Open source. Cloneable SaaS. À vous.",
      primaryCta: "Commencer avec un Action",
      secondaryCta: "Lire la documentation",
      githubCta: "Voir sur GitHub",
    },
    batteries: {
      titleLine1: "Tout inclus,",
      titleLine2: "éprouvé en production",
      body: "Au lieu de partir d’un prompt vide et de code improvisé, Agent-Native fournit aux agents des composants éprouvés et les bonnes pratiques pour construire de vrais logiciels.",
      browseToolkits: "Parcourir les toolkits",
    },
    featureCloud: {
      notifications: "Alertes",
      recurringJobs: "Tâches récurrentes",
      actions: "Opérations",
      agentTeams: "Équipes d’agents",
      monorepos: "Dépôts monorepo",
      permissions: "Autorisations",
      rbac: "RBAC",
      organizations: "Organisations",
      workspaceSecrets: "Secrets du workspace",
      docsSearch: "Recherche docs",
      sourceSearch: "Recherche source",
      contextAwareness: "Conscience du contexte",
      observability: "Observabilité",
      realtimeSync: "Synchro temps réel",
      sqlState: "État SQL",
      multiTenancy: "Multilocation",
      dataLoaders: "Chargeurs de données",
      liveQueries: "Requêtes en direct",
      agentInstructions: "Instructions aux agents",
      providerGrants: "Subventions aux fournisseurs",
      comments: "Commentaires",
      reviewLinks: "Liens de révision",
      privacyControls: "Contrôles de confidentialité",
      skills: "Compétences",
      security: "Sécurité",
      auditLogs: "Journaux d'audit",
      workspaces: "Espaces de travail",
      voiceInput: "Saisie vocale",
      mcpApps: "MCP applications",
      generativeUi: "Interface générative",
      toolCalls: "Appels d'outils",
      agentSidebar: "Barre latérale de l'agent",
      sharedActions: "Actions partagées",
      uiSurfaces: "Surfaces UI",
      i18n: "i18n",
      mcpAuth: "MCP Authentification",
      battleTestedComponents: "Briques éprouvées",
      mcpA2a: "MCP + A2A",
      externalAgents: "Agents externes",
      a2aHandoffs: "Transferts A2A",
      humanHandoff: "Transfert humain",
      agentContext: "Contexte de l'agent",
      durableResume: "CV durable",
      extensions: "Rallonges",
      sharingPrivacy: "Partage et confidentialité",
      realTimeCollaboration: "Collaboration en temps réel",
      sso: "SSO",
      oauth: "OAuth",
      mcpServers: "Serveurs MCP",
      scopedAccess: "Accès limité",
      dbAdapters: "Adaptateurs de base de données",
      auth: "Authentification",
      approvals: "Approbations",
      automations: "Automatisations",
      governance: "Gouvernance",
      jobs: "Emplois",
      agUi: "AG-UI",
      dispatch: "Dispatch",
      backgroundRuns: "Exécutions en arrière-plan",
      rateLimits: "Limites de taux",
      queues: "Files d'attente",
      cronSchedules: "Horaires Cron",
      analytics: "Analyses",
      experiments: "Expériences",
      feedbackLoops: "Boucles de rétroaction",
      fileUploads: "Téléchargements de fichiers",
      evals: "Évaluations",
      templates: "Apps",
      providerApis: "Fournisseur APIs",
      agentWebSurfaces: "Surfaces Web des agents",
      templateSkills: "Compétences d'app",
      oneClickForks: "Création d'app en un clic",
      localFileMode: "Mode fichier local",
      memory: "Mémoire",
      webhooks: "Webhooks",
      http: "HTTP",
      selfEditingCode: "Code d'auto-édition",
      cli: "CLI",
      crossAppSso: "Multi-applications SSO",
      schemaMigrations: "Migrations de schéma",
      hostedDeploys: "Déploiements hébergés",
      environmentSetup: "Configuration de l'environnement",
      oauthCallbacks: "OAuth rappels",
      exports: "Exportations",
      dashboards: "Tableaux de bord",
    },
  },
  common: {
    copied: "Copié",
    copyFailed: "Échec de la copie",
    copyCommand: "Commande Copier",
    copyCode: "Copier le code",
    tryIt: "Essayer",
    customizeIt: "Personnaliser",
    editOnline: "Modifier en ligne",
    runLocally: "Exécuter localement",
    viewDocs: "Voir les docs",
    source: "Code source",
    readDocs: "Lire la documentation",
    signIn: "Se connecter",
    tryTemplateFree: "Essayer {{name}} gratuitement",
    designForFree: "Concevoir gratuitement",
    recordForFree: "Enregistrer gratuitement",
    getStarted: "Commencer",
    freeAndOpenSource: "100 % gratuit • open source",
    viewAllApps: "Voir toutes les applications",
  },
  homepage: {
    hero: {
      title: "Le framework des applications agentic",
      bodyLine1: "Créez des agents autonomes avec des interfaces intuitives.",
      bodyLine2: "Apportez votre propre LLM. Déployez où vous voulez.",
      tryAnApp: "Essayer une app",
    },
    install: {
      copyCommand: "Copier la commande d'installation",
    },
    actions: {
      title: "Une action alimente chaque surface",
      bodyLine1: "Définissez une capacité une seule fois avec defineAction().",
      bodyLine2:
        "Votre agent, votre UI React, vos clients HTTP et vos intégrations utilisent tous le même code.",
      diagramAlt:
        "Une action alimente l'UI, MCP, le chat de l'agent, A2A, HTTP API et CLI",
    },
    builtIn: {
      title: "Tout ce dont votre agent a besoin",
      body: "UI, contexte, données, autorisations et infrastructure, déjà connectés entre eux.",
      pillars: {
        reactUi: {
          title: "UI React",
          body: "Offrez aux utilisateurs des écrans familiers pour parcourir, éditer et revoir le travail.",
        },
        agentChat: {
          title: "Chat agent intégré",
          body: "Laissez les utilisateurs déléguer du travail, poser des questions et revoir les résultats dans la même UI.",
        },
        sharedState: {
          title: "État d'application partagé",
          body: "L'agent sait ce que les utilisateurs consultent, sélectionnent et éditent.",
        },
        sharedSql: {
          title: "Données PostgreSQL partagées",
          body: "Les utilisateurs et les agents lisent et mettent à jour la même source de vérité.",
        },
        skillsMemory: {
          title: "Compétences et mémoire",
          body: "Donnez aux agents une expertise réutilisable et un contexte persistant.",
        },
        automations: {
          title: "Automatisations",
          body: "Exécutez le travail de l'agent automatiquement selon des horaires ou des événements.",
        },
        agentTeams: {
          title: "Équipes d'agents",
          body: "Déléguez le travail à des agents spécialisés dans le même espace de travail ou entre agents connectés.",
        },
        auth: {
          title: "Authentification et organisations",
          body: "La connexion, les comptes utilisateurs et l'appartenance à une organisation sont intégrés.",
        },
        sharing: {
          title: "Partage et permissions",
          body: "Contrôlez qui peut voir, commenter, éditer ou gérer chaque ressource.",
        },
      },
    },
    stack: {
      title: "Apportez votre propre stack",
      body: "Agent-Native est en TypeScript open source. Choisissez votre modèle, votre base de données et votre hébergement, puis gardez le code de l’application dans votre dépôt.",
      exploreApps: "Explorer les apps créées avec Agent-Native",
    },
    showcase: {
      title: "De vraies apps créées avec Agent-Native",
      body: "Des apps Agent-Native open source que vous pouvez utiliser gratuitement ou personnaliser à l’infini.",
      browseApps: "Parcourir les apps",
      scrollLeft: "Défiler les apps vers la gauche",
      scrollRight: "Défiler les apps vers la droite",
    },
    bottomCta: {
      title: "Créez votre premier agent avec une UI",
      body: "L’agent et l’UI partagent les mêmes capacités. Apportez votre propre LLM et déployez où vous voulez.",
    },
    footer: {
      tagline: "Le framework des applications agentic.",
      framework: "Framework",
      ecosystem: "Écosystème",
      community: "Communauté",
      legal: "Mentions légales",
      docs: "Documentation",
      download: "Télécharger",
      apps: "Apps",
      privacyPolicy: "Politique de confidentialité",
      saasTerms: "Conditions SaaS",
      legalResources: "Ressources juridiques",
    },
  },
  gettingStarted: {
    tabs: {
      label: "Choisissez votre mode de création",
      local: "Développer en local",
      localDescription: "Utilisez la CLI pour développer sur votre machine.",
      cloud: "Développer dans le cloud",
      cloudDescription: "Développez dans le navigateur avec Builder.io.",
    },
    cloud: {
      intro:
        "Développez les mêmes applications sans rien installer. Décrivez ce que vous voulez et l’agent écrit et exécute le code dans un espace de travail hébergé par Builder.",
      stepOneTitle: "Créer un compte Builder",
      stepOneBody:
        "Utilisez votre compte Builder pour développer dans le navigateur. Commencez gratuitement, sans fournir de clés API.",
      stepTwoTitle: "À vous de prompter",
      stepTwoBody:
        "Décrivez en langage courant ce que vous voulez créer et l’agent le fera pour vous.",
      stepThreeTitle: "Déployer",
      stepThreeBody:
        "Quand vous êtes prêt, déployez votre agent et son UI en un clic dans Builder.",
    },
  },
  templatesPage: {
    title: "Applications open source natives pour agents que vous possédez",
    eyebrow:
      "Partez d'une app fonctionnelle et laissez l'agent la faire évoluer.",
    body: "Vous pouvez tout personnaliser.",
    firstPartyTitle: "Créées par Agent-Native",
    community:
      "Vous préférez une app vide ? Commencez de zéro avec le guide du framework.",
    createYourOwn: "Commencer de zéro",
    communityTitle: "Applications de la communauté",
    communityDescription:
      "Découvrez des applications maintenues par leurs auteurs. Essayez une version hébergée lorsqu’elle existe, ou consultez le code source pour la personnaliser.",
    submitCommunityTemplate: "Proposer une application",
    communityEmpty:
      "Les soumissions communautaires sont ouvertes. Publiez une application Agent-Native ciblée et proposez-la au catalogue.",
    publishGuide: "Lire le guide de publication",
    communityTrust:
      "Les applications communautaires sont du code tiers. Vérifiez le code source, la licence, les dépendances et les scripts d’installation avant de les exécuter.",
    copyCommunityInstallCommand: "Copier la commande d’installation",
    viewRepository: "Voir le dépôt",
    tryCommunityDemo: "Essayer la démo",
    customizeDescription: "Utilisez cette app comme point de départ.",
    customizeOnline: "En ligne",
    customizeOnlineBadge: "Rejoindre la liste d'attente",
    customizeLocally: "Local",
    communityNew: "Nouveau",
    communityComingSoon: "Bientôt disponible",
    communityGithubStars: "{{count}} étoiles GitHub",
    tryCommunityApp: "Essayer l’application",
    viewCommunitySource: "Voir le code source",
    communityEyebrow: "Application communautaire",
    communityScreenshots: "Captures d’écran",
    previousScreenshot: "Capture précédente",
    nextScreenshot: "Capture suivante",
    communityNoScreenshots: "Les captures apparaîtront ici après validation.",
    communityScreenshotAlt: "Capture {{index}} de {{name}}",
    communityNoHostedVersion:
      "Une version hébergée arrive bientôt. Suivez le développement via le code source.",
    communitySubmissionTitle: "Partager une application communautaire",
    communitySubmissionDescription:
      "Indiquez où trouver votre application et ce qu’elle fait. Nous vérifierons les informations avant de publier la fiche.",
    communitySubmissionName: "Nom de l’application",
    communitySubmissionNamePlaceholder: "Centre de support client",
    communitySubmissionUrl: "URL de l’application",
    communitySubmissionUrlPlaceholder: "example.com",
    communitySubmissionDescriptionLabel: "Description",
    communitySubmissionDescriptionPlaceholder:
      "Que fait l’application et à qui s’adresse-t-elle ?",
    communitySubmissionRepository: "Dépôt GitHub (facultatif)",
    communitySubmissionRepositoryPlaceholder: "github.com/owner/repository",
    communitySubmissionScreenshots: "Captures d’écran (facultatif)",
    communitySubmissionScreenshotsPlaceholder: "Déposez jusqu’à 5 images ici",
    communitySubmissionScreenshotDropHint:
      "PNG, JPG ou WebP. 1,5 Mo maximum chacune.",
    communitySubmissionScreenshotSlot: "Capture {{index}}",
    communitySubmissionScreenshotsAdd: "Ajouter des captures",
    communitySubmissionScreenshotsCount: "{{count}} / 5 sélectionnées",
    communitySubmissionScreenshotRemove: "Supprimer la capture {{index}}",
    communitySubmissionSubmit: "Envoyer l’application",
    communitySubmissionReady:
      "Merci. Nous examinerons votre application avant de la publier.",
    communitySubmissionNameError: "Saisissez un nom d’application.",
    communitySubmissionDescriptionError: "Ajoutez une courte description.",
    communitySubmissionUrlError:
      "Saisissez un lien d’application valide, par exemple example.com.",
    communitySubmissionRepositoryError:
      "Saisissez un lien vers un dépôt GitHub.",
    communitySubmissionScreenshotsError:
      "Utilisez des images PNG, JPG ou WebP de 1,5 Mo maximum chacune, avec 5 images au maximum.",
    communitySubmissionSubmitError:
      "Impossible d’envoyer le formulaire pour le moment. Vérifiez les champs signalés, puis réessayez.",
    communitySubmissionSubmitting: "Envoi…",
  },
  buildFromScratch: {
    title: "Créer de zéro",
    description:
      "Commencez avec le guide du framework ou créez en ligne avec l'agent de code cloud de Builder.io.",
    readDocs: "Lire la documentation",
    buildOnline: "Créer en ligne",
    popoverTitle: "Créer dans le navigateur",
    popoverBody:
      "Générez rapidement des apps agent-native dans le cloud avec Builder.io.",
    waitlistBody:
      "Builder.io peut lancer et personnaliser une app agent-native dans le cloud — actions, auth, état SQL et chat agent inclus. Rejoignez la liste d'attente pour un accès anticipé.",
    emailLabel: "E-mail",
    emailPlaceholder: "vous@entreprise.com",
    joinWaitlist: "Rejoindre la liste d'attente",
    joining: "Inscription…",
    joined:
      "Vous êtes sur la liste d'attente. Nous vous enverrons un e-mail quand l'accès à la création en ligne ouvrira.",
    invalidEmail: "Saisissez une adresse e-mail valide.",
    submitError: "Impossible de rejoindre la liste d'attente. Réessayez.",
    waitlistUnavailable:
      "Les inscriptions à la liste d'attente ne sont pas encore disponibles dans cet environnement. Essayez plutôt le site de documentation hébergé.",
    launchBuilder: "Lancer Builder",
  },
  templateCard: {
    pasteIntoTerminal: "Collez dans votre terminal.",
    newToCli: "Nouveau sur le CLI?",
    screenshotAlt: "Capture d'écran de l'app {{name}}",
  },
  templateDetail: {
    allTemplates: "Toutes les apps",
    notFoundMetaTitle: "App introuvable — Agent-Native",
    notFoundTitle: "App introuvable",
    notFoundBody:
      "Parcourez le catalogue d'apps pour trouver une application disponible.",
    badge: "Agent-Native {{name}}",
    title: "app {{name}}",
  },
  templates: {
    clips: {
      replaces: "Remplace ou complète Loom, Granola et Wisprflow",
      description:
        "Enregistre votre écran, vos réunions et vos notes vocales afin que les agents comprennent ce qui s’est passé et agissent.",
    },
    plan: {
      replaces: "Mode plan visuel pour Codex, Claude Code et agents de code",
      description:
        "Installe la planification visuelle comme skill adossée à une app. Votre agent de code ouvre des plans structurés avec diagrammes, wireframes, prototypes, annotations, commentaires et liens de revue.",
    },
    design: {
      replaces: "Remplace ou complète les outils de prototypage design",
      description:
        "Transforme vos instructions en designs interactifs conformes à votre système de design tandis que l’agent affine chaque écran selon vos retours.",
    },
    content: {
      replaces: "Remplace ou augmente Obsidian pour MDX, Notion, Google Docs",
      description:
        "Travaille avec vos documents pendant qu’un agent rédige dans votre style, crée du contenu interactif et publie sur votre site.",
    },
    slides: {
      replaces: "Remplace ou augmente Google Slides, Pitch",
      description:
        "Crée des présentations modifiables et conformes à votre marque à partir d’instructions ou de diapositives existantes, que l’agent peut créer, modifier et affiner.",
    },
    analytics: {
      replaces: "Alternative open source à Amplitude et FullStory",
      description:
        "Connecte vos données pour qu’un agent réponde aux questions en langage courant et transforme les résultats en graphiques et tableaux de bord.",
    },
    mail: {
      replaces: "Remplace ou augmente Superhuman, Gmail",
      description:
        "Une boîte de réception pensée pour le clavier, où un agent hiérarchise les e-mails, rédige les réponses, résume les fils et assure le suivi.",
    },
    forms: {
      replaces: "Remplace ou augmente Typeform, Google Forms",
      description:
        "Générateur de formulaires natif pour les agents. Générez des formulaires à partir d'une invite, modifiez les champs visuellement ou par conversation et envoyez les soumissions à Slack, Discord, Google Sheets ou à des webhooks.",
    },
    assets: {
      replaces:
        "Remplace ou augmente DAMs, les bibliothèques d'actifs de marque et les générateurs multimédia AI",
      description:
        "Offre aux agents une bibliothèque partagée de règles, d’images et de vidéos de marque pour créer et choisir des médias conformes dans vos applications.",
    },
    calendar: {
      replaces: "Remplace ou augmente Google Calendar, Calendly",
      description:
        "Réunit vos calendriers Google afin qu’un agent trouve des créneaux, planifie ou reprogramme des événements et gère les réservations.",
    },
    dispatch: {
      replaces: "Contrôle de mission pour vos applications natives d'agent",
      description:
        "Messagerie et gestion centralisées pour chaque agent de votre pile. Parlez à vos agents depuis Slack, Telegram ou sur le Web; acheminez les tâches, conservez la mémoire, approuvez les actions et déléguez entre les applications via A2A.",
    },
    chat: {
      replaces:
        "Une application minimale de style ChatGPT pour votre propre agent",
      description:
        "Chat, le premier échafaudage d'applications avec des threads durables, une barre latérale standard, des actions, une authentification, une synchronisation en direct et un chemin propre pour ajouter des écrans ou brancher votre propre backend d'agent.",
    },
  },
  templateLanding: {
    faq: {
      eyebrow: "Questions fréquentes",
      title: "Réponses aux questions fréquentes",
    },
    analytics: {
      faq: {
        question1: "Qu'est-ce qu'Agent-Native Analytics ?",
        answer1:
          "Agent-Native Analytics est un outil d'analyse IA gratuit et open source. Posez des questions à un agent IA sur vos données connectées, examinez les requêtes et créez des tableaux de bord réutilisables. Il inclut aussi la relecture de session, le suivi des erreurs et la surveillance de la disponibilité.",
        question2: "Dois-je connaître SQL pour utiliser Analytics ?",
        answer2:
          "Vous pouvez poser des questions en langage courant et laisser votre agent IA écrire les requêtes. Pour BigQuery, vous pouvez aussi créer des graphiques en sélectionnant des tables, des métriques et des filtres dans l'Explorateur. Le SQL reste disponible pour être examiné, et quelqu'un qui connaît bien vos données peut devoir aider à connecter les sources et définir les métriques.",
        question3: "Quelles sources de données puis-je connecter ?",
        answer3:
          "Les sources prises en charge incluent BigQuery, Google Analytics 4, Amplitude, Mixpanel, PostHog, HubSpot et Stripe. Chaque source nécessite les identifiants appropriés ou une connexion d'espace de travail partagée accordée à Analytics. Les réponses disponibles dépendent des données et des autorisations que vous connectez.",
        question4: "Puis-je utiliser nos propres définitions de métriques ?",
        answer4:
          "Oui. Utilisez le dictionnaire de données pour documenter les définitions, les noms de tables et de colonnes, des exemples de requêtes et des exceptions, comme l'exclusion des comptes internes. Votre agent IA peut utiliser ces définitions lors de l'écriture des requêtes. Vérifiez le SQL et les résultats lors du contrôle d'une métrique métier.",
        question5:
          "Puis-je partager des tableaux de bord et planifier des rapports ?",
        answer5:
          "Oui. Partagez des tableaux de bord avec des coéquipiers ou votre organisation avec un accès lecteur, éditeur ou administrateur. Vous pouvez aussi planifier des rapports par e-mail avec les résultats actuels du tableau de bord, ou configurer des alertes pour les conditions que vous souhaitez surveiller.",
      },
      // Copy V3 de la landing page (2026-09-14) — du hero au CTA final ci-dessous.
      heroEyebrow: "Analytics",
      heroTitle:
        "Posez une question. Obtenez le graphique, la requête et le contexte.",
      heroDescription:
        "Rassemblez les données d’entrepôt, de produits et de revenus. L'agent vérifie vos définitions de métriques, écrit le code SQL et transforme la réponse en un tableau de bord réutilisable.",
      heroCta: "Explorez vos données",
      useCasesHeading: "Suivez le signal de la métrique à la session",
      useCasesBody:
        "Conservez le raisonnement à côté de chaque résultat, puis intégrez un graphique dans un tableau de bord ou une enquête de session.",
      useCase1Title: "Expliquer un changement d'activation",
      useCase1Body:
        "Comparez les cohortes et les canaux dans une conversation. L'agent utilise vos définitions de métriques documentées, écrit la requête et affiche les preuves derrière le changement.",
      useCase2Title: "Construire un examen des revenus vitaux",
      useCase2Body:
        "Demandez à l'agent de combiner les mesures de facturation, de CRM ou d'entrepôt dans un tableau de bord. Les filtres et les panneaux persistent pour votre prochain examen.",
      useCase3Title: "Tracer une métrique jusqu'à une session réelle",
      useCase3Body:
        "Passez d’un pic ou d’une erreur à la session derrière. Inspectez l’activité de la console et du réseau, puis partagez le contexte de diagnostic temporaire avec l’agent.",
      keyFeaturesEyebrow: "Fonctionnalités clés",
      keyFeaturesHeading:
        "Tout ce qu'il faut pour interroger, visualiser et explorer",
      feature1Title: "Interrogez sur les données connectées",
      feature1Body:
        "Posez une question sur les entrepôts, les produits et les sources de revenus. L'agent transforme la réponse en graphique et prend en charge les analyses de suivi.",
      feature2Title: "Tableaux de bord que l'agent peut modifier",
      feature2Body:
        "Demandez à l'agent d'ajouter ou de remodeler les panneaux, les filtres et les pannes. Les modifications restent dans un tableau de bord réutilisable que votre équipe peut partager.",
      feature3Title: "Contexte SQL et métrique visible",
      feature3Body:
        "Inspectez la requête derrière un résultat et la définition de métrique utilisée pour l'écrire. Affinez le SQL lorsque vous avez besoin de plus de contrôle.",
      feature4Title: "Un espace de travail pour les sources de données",
      feature4Body:
        "Connectez BigQuery, GA4, Product Analytics, HubSpot et Stripe, puis explorez leurs données autorisées à partir de la même application.",
      feature5Title: "Définitions suivies par l'agent",
      feature5Body:
        "Documentez les règles de métriques, les jointures, les exemples et les pièges connus. Analytics donne ce contexte à l'agent lorsqu'il écrit des requêtes.",
      feature6Title: "Relecture de session avec diagnostics",
      feature6Body:
        "Passez d'une erreur à un enregistrement en affichant les événements de la console et du réseau. Partagez un lien de diagnostic temporaire pour une enquête assistée par un agent.",
      finalCtaHeading: "Commencez par une question sur vos données",
      finalCtaBody:
        "Connectez une source et demandez à votre agent IA le premier graphique.",
      finalCtaButton: "Explorez vos données",
      s001: "Capture d'écran du modèle Analytics",
      s002: "Connecteurs de données",
      s003: "Types de graphiques",
      s004: "Explorateur de requêtes",
      s005: "Langage naturel",
      s006: "Tous les modèles",
      s007Primary: "L'alternative open source à",
      s007Secondary: "Amplitude et FullStory",
      s008: "Connectez n'importe quelle source de données, demandez n'importe quel graphique, créez des tableaux de bord réutilisables: l'agent AI écrit le SQL.",
      s009: "Essayer",
      s010: "Ce que tu peux faire",
      s011: "Tout ce dont vous avez besoin pour remplacer votre pile analytique.",
      s012: "Requêtes en langage naturel",
      s013: "Demandez dans un anglais simple. L'agent écrit le SQL et construit le graphique.",
      s014: "Tableaux de bord réutilisables",
      s015: "Tableaux de bord persistants avec contrôles de date, sous-vues et panneaux redimensionnables.",
      s016: "Accès direct à BigQuery avec historique, nombre de lignes et URL partageables.",
      s017: "Auto-amélioration",
      s018: "L'agent modifie lui-même l'application. Besoin d'un nouveau type de graphique? Demandez simplement.",
      s019: "Connectez tout",
      s020: "Plusieurs connecteurs intégrés pour les services populaires. L'agent en rédige de nouveaux sur demande.",
      s021: "CRM et revenus",
      s022: "Ingénierie",
      s023: "GitHub, Jira, Sentry — PRs, tickets, sprints et suivi des erreurs.",
      s024: "Infrastructures",
      s025: "Communications",
      s026: "Content et SEO",
      s027: "Communauté",
      s028: "Dictionnaire de données vivantes",
      s029: "Définitions de métriques avec modèles de requête, modèles de jointure, pièges connus et fréquence de mise à jour. Synchronisé depuis Notion avec validation communautaire.",
      s030: "Modèles de requête et exemples de résultats pour chaque métrique",
      s031: "Notation de confiance et validation avec approbations des évaluateurs",
      s032: "Suggestions et découverte de métriques basées sur AI",
      s033: "Décalage des données, dépendances et plages de dates valides documentées",
      s034: "Utilisateurs actifs hebdomadaires",
      s035: "Quotidiennement",
      s036: "~2 heures",
      s037: "Exclut les e-mails internes de l'entreprise",
      s038: "Validé ✓",
      s039: "Comment ça se compare",
      s040: "Tableau de bord UI",
      s041: "Oui, rigide",
      s042: "No",
      s043: "Oui, entièrement personnalisable",
      s044: "Limité",
      s045: "Oui, éphémère",
      s046: "Oui, des graphiques persistants",
      s047: "SDKs intégré",
      s048: "Téléchargement manuel",
      s049: "Sources multiples + personnalisé",
      s050: "Dictionnaire de données",
      s051: "De base",
      s052: "Métriques complètes avec contexte",
      s053: "Personnalisation",
      s054: "Configuration uniquement",
      s055: "Invite uniquement",
      s056: "Code source complet",
      s057: "Tarifs",
      s058: "Par siège, par événement",
      s059: "Abonnement",
      s060: "Gratuit et open source",
      s061: "Commencez en quelques minutes",
      s062: "Créez le modèle, connectez vos données, commencez à créer des tableaux de bord.",
      s063: "Lire la documentation",
      s064: "Afficher tous les modèles",
    },
    calendar: {
      faq: {
        question1: "Qu'est-ce qu'Agent-Native Calendar ?",
        answer1:
          "Agent-Native Calendar est un assistant de planification IA gratuit et open source qui se connecte à Google Calendar. Utilisez un agent IA pour gérer vos événements et trouver des créneaux, ou partagez des liens de réservation pour que d'autres puissent planifier avec vous.",
        question2: "Quels calendriers puis-je connecter ?",
        answer2:
          "Connectez plusieurs comptes Google pour afficher leurs événements ensemble. Les événements nouveaux et modifiés sont écrits dans le calendrier principal du compte sélectionné. Vous pouvez aussi afficher des flux ICS ou webcal en lecture seule ; ce ne sont pas des intégrations bidirectionnelles avec Outlook ou Apple Calendar. Les calendriers Google partagés sont en lecture seule et ne bloquent pas la disponibilité de réservation.",
        question3: "Que peut faire l'agent IA avec mon calendrier ?",
        answer3:
          "Votre agent IA peut consulter votre emploi du temps, trouver des créneaux disponibles et créer ou reprogrammer des événements. Lorsque vous lui demandez de trouver un créneau, il vérifie vos règles de disponibilité et vos événements existants, ainsi que les informations libre/occupé des participants nommés lorsqu'elles sont accessibles. Vous choisissez le créneau suggéré avant qu'il ne réserve la réunion.",
        question4: "Faut-il un compte pour réserver une réunion avec moi ?",
        answer4:
          "Non. Toute personne disposant de votre lien de réservation public peut choisir un créneau disponible et répondre à vos questions de réservation sans se connecter. Après la réservation, elle reçoit un lien privé pour reprogrammer ou annuler la réunion.",
        question5:
          "Un lien de réservation peut-il vérifier la disponibilité de plusieurs hôtes ?",
        answer5:
          "Oui. Ajoutez des co-hôtes obligatoires, et Calendar vérifie leurs informations libre/occupé avant de proposer un créneau. Pour respecter également les horaires de travail configurés de chaque co-hôte, vous et ce co-hôte devez ajouter mutuellement vos calendriers en superposition. Sans ce partage mutuel, Calendar ne vérifie que leurs informations libre/occupé.",
      },
      s001: "Capture d'écran du modèle Calendar",
      // V3 landing page copy (2026-09-10) — hero through final CTA below.
      heroEyebrow: "Calendar",
      heroTitle:
        "Trouvez du temps, réservez des rendez-vous et adaptez votre journée avec un agent",
      heroDescription:
        "Agenda rassemble vos agendas Google et vos règles de disponibilité afin que l'agent puisse rechercher des ouvertures partagées, préparer des réservations et vous aider à mettre à jour les événements.",
      heroCta: "Commencez à planifier",
      useCasesHeading: "Laissez l'agent gérer les détails de la planification",
      useCasesBody:
        "Vérifiez la disponibilité réelle dans les calendriers, puis examinez une proposition claire avant de créer ou de déplacer une réunion.",
      useCase1Title:
        "Transformez un lien de réservation en une réunion préparée",
      useCase1Body:
        "Proposez uniquement des horaires qui respectent les horaires de travail, les préavis et les délais. Collectez les détails dont vous avez besoin, puis ajoutez le lien vidéo lorsque les invités réservent.",
      useCase2Title: "Trouvez un créneau que tout le monde peut créer",
      useCase2Body:
        "Demandez à l'agent de comparer les heures de disponibilité et de disponibilité des participants et les superpositions de calendrier. Il renvoie l'ouverture partagée et les calendriers qu'il a vérifiés.",
      useCase3Title: "Reprogrammer sans perdre le fil",
      useCase3Body:
        "Demandez une heure ultérieure et laissez l'agent vérifier les invités, conserver les détails de la réunion et préparer l'invitation mise à jour pour votre examen.",
      keyFeaturesEyebrow: "Fonctionnalités clés",
      keyFeaturesHeading:
        "Tout ce dont vous avez besoin pour planifier, réserver et reprogrammer",
      feature1Title: "Planification en langage naturel",
      feature1Body:
        "Demandez à l'agent de vérifier la disponibilité, de proposer une heure et de créer ou déplacer un événement avec ses invités et les détails de la réunion.",
      feature2Title: "Disponibilité sur tous les comptes",
      feature2Body:
        "Affichez ensemble les calendriers Google connectés et incluez des flux en lecture seule comme contexte de planification.",
      feature3Title: "Pages de réservation avec admission",
      feature3Body:
        "Créez des liens pour différents types de réunions, définissez la durée et les questions de réservation, et laissez les invités choisir un créneau disponible.",
      feature4Title: "Des règles qui façonnent chaque machine à sous",
      feature4Body:
        "Définissez les heures de travail, les délais, les préavis, le fuseau horaire et l'horizon de réservation de manière à ce que les heures suggérées et publiques correspondent à votre emploi du temps.",
      feature5Title: "De véritables contrôles multi-hôtes",
      feature5Body:
        "Ajoutez les co-hôtes requis et vérifiez leur disponibilité avant de proposer une heure. Le calendrier respecte également les superpositions d’heures de travail partagées lorsqu’il est configuré.",
      feature6Title: "Suivi des réunions gérées par l'agent",
      feature6Body:
        "Conservez les détails de Google Meet ou Zoom en pièce jointe pendant que l'agent prépare les modifications de l'événement et les invitations mises à jour.",
      finalCtaHeading: "Ajoutez votre prochaine réunion au calendrier",
      finalCtaBody:
        "Trouvez un créneau avec votre agent IA, ou envoyez un lien de réservation.",
      finalCtaButton: "Commencez à planifier",
      s002: "Calendar vues",
      s003: "Actions des agents",
      s004: "Types de liens de réservation",
      s005: "Tous les modèles",
      s006Primary: "L'alternative open source",
      s006Secondary: "Google Calendar et Calendly",
      s007: "Synchronisation Google Calendar multi-comptes, disponibilité configurable et liens de réservation personnalisables de style Calendly — avec un agent AI qui planifie en votre nom.",
      s008: "Essayer",
      s009: "La connexion utilise uniquement l'identité de base Google, mais la connexion à la synchronisation Calendar demande un accès au calendrier. Certains administrateurs Workspace peuvent exiger une approbation pour la démo hébergée. Exécutez localement pour utiliser votre propre client Google OAuth.",
      s010: "Ce que tu peux faire",
      s011: "Tout ce dont vous avez besoin pour remplacer votre calendrier et votre pile de planification.",
      s012: "Plusieurs vues Calendar",
      s013: "Vues mensuelles, hebdomadaires et quotidiennes avec gestion des événements par glisser-déposer.",
      s014: "Planification du langage naturel",
      s015: "Dites à l’agent de trouver un créneau, de créer un événement ou de reprogrammer – il s’occupe du reste.",
      s016: "Liens de réservation personnalisables",
      s017: "Créez plusieurs pages de réservation de style Calendly avec différentes durées et disponibilités. Les visiteurs choisissent un créneau qui fonctionne.",
      s018: "Auto-amélioration",
      s019: "L'agent modifie lui-même l'application. Besoin d'une nouvelle vue ou d'un nouveau flux de réservation? Demandez simplement.",
      s020: "Connectez plusieurs comptes Google via OAuth 2.0. Extrayez les événements de tous vos calendriers et créez des événements qui se synchronisent avec Google.",
      s021: "OAuth 2.0 multi-comptes avec actualisation automatique des jetons",
      s022: "Synchronisation basée sur l'extraction: aucun webhook n'est nécessaire",
      s023: "Créer, mettre à jour et supprimer des événements sur Google",
      s024: "Créez des liens de réservation personnalisables où n'importe qui peut réserver du temps avec vous. Paramètres de disponibilité configurables par type de réservation.",
      s025: "Sélecteur de date + sélection de créneau horaire",
      s026: "Respecte vos disponibilités et les événements existants",
      s027: "Capture d'informations sur les visiteurs + confirmation",
      s028: "Planification alimentée par les agents",
      s029: "L'agent exécute des scripts pour synchroniser les calendriers, créer des événements, vérifier la disponibilité et gérer les réservations. Tout cela grâce au langage naturel.",
      s030: '"Synchronisez mon Google Calendar pour ce mois"',
      s031: '"Trouver un créneau de 30 minutes mardi prochain pour une réunion d\'équipe"',
      s032: '"Créez un stand-up récurrent à 9h tous les jours de la semaine"',
      s033: '"Montre-moi mes disponibilités pour la semaine prochaine"',
      s034: "Comment ça se compare",
      s035: "Interface du calendrier",
      s036: "Complet, rigide",
      s037: "Minime",
      s038: "Complet, entièrement personnalisable",
      s039: "Planification AI",
      s040: "Langage naturel, contrôle total",
      s041: "Page de réservation",
      s042: "Créneaux de rendez-vous",
      s043: "Oui, image de marque limitée",
      s044: "Entièrement personnalisable, propre domaine",
      s045: "Personnalisation",
      s046: "Paramètres uniquement",
      s047: "Marquage uniquement",
      s048: "Code source complet",
      s049: "Tarifs",
      s050: "Gratuit / Espace de travail",
      s051: "$10+ / mois par utilisateur",
      s052: "Gratuit et open source",
      s053: "Commencez en quelques minutes",
      s054: "Partez du modèle, connectez Google Calendar et commencez à planifier avec AI.",
      s055: "Lire la documentation",
      s056: "Afficher tous les modèles",
      s057: "Note sur la démo hébergée",
      s058: "Synchronisation bidirectionnelle",
    },
    assets: {
      faq: {
        question1: "Qu'est-ce qu'Agent-Native Assets ?",
        answer1:
          "Agent-Native Assets est une bibliothèque d'assets de marque gratuite et open source avec génération d'images et de vidéos par IA. Organisez vos médias existants, fournissez vos références de marque, et travaillez avec un agent IA pour générer, modifier et réutiliser des assets sur plusieurs projets.",
        question2: "Comment Assets utilise-t-il mes consignes de marque ?",
        answer2:
          "Ajoutez votre logo, des images de référence, des couleurs et des notes de style à un kit de marque. Des modèles réutilisables fournissent des instructions pour des types de contenu spécifiques. Votre agent IA s'appuie sur ce contexte pour guider la génération, et vous pouvez revoir et affiner les résultats avant de les enregistrer.",
        question3:
          "Puis-je importer et organiser des images et vidéos existantes ?",
        answer3:
          "Oui. Importez des médias existants ou un asset depuis une URL, puis organisez-le dans des bibliothèques et des dossiers aux côtés des contenus générés. Vous pouvez parcourir et rechercher dans la bibliothèque, réutiliser des assets comme références, ou les exporter pour un autre projet.",
        question4:
          "Mon agent IA peut-il utiliser Assets depuis une autre app ?",
        answer4:
          "Oui. Connectez un agent compatible via l'intégration MCP d'Assets pour rechercher, générer et sélectionner des médias depuis le chat. Les apps Agent-Native peuvent aussi demander des assets ou intégrer un sélecteur. L'expérience disponible dépend de l'app hôte et de sa connexion à Assets.",
        question5:
          "Assets peut-il utiliser mon vrai logo dans les images générées ?",
        answer5:
          "Oui. Définissez un logo canonique dans votre kit de marque et activez le compositing de logo pour la génération. Assets place le logo original sur l'image après la génération, de sorte que le modèle d'image ne le redessine pas. Vérifiez son emplacement et l'image environnante avant utilisation.",
      },
      s001: "Capture d'écran de l'app Assets",
      imageCredits: "Crédits des images",
      heroEyebrow: "Assets",
      heroTitle: "Générez des images de marque dans une conversation",
      heroDescription:
        "Décrivez ce dont vous avez besoin, donnez à votre agent un kit ou une référence de marque et comparez les variantes générées tout au long de la conversation.",
      heroCta: "Générez une image",
      useCasesHeading: "Que pouvez-vous faire avec Assets ?",
      useCasesBody:
        "Créez des images de campagne, adaptez des visuels pour de nouveaux projets, ou donnez à votre équipe et à vos agents IA une bibliothèque de marque partagée.",
      useCase1Title: "Créer des visuels de campagne",
      useCase1Body:
        "Demandez à votre agent IA des images de blog, des visuels pour les réseaux sociaux ou des visuels de lancement à partir de vos références de marque. Comparez les options et affinez celle que vous choisissez.",
      useCase2Title: "Adapter des images pour de nouveaux projets",
      useCase2Body:
        "Donnez à votre agent IA une image existante et décrivez les changements dont vous avez besoin, comme un arrière-plan différent ou un espace pour un titre.",
      useCase3Title: "Partager les assets de marque dans tout votre travail",
      useCase3Body:
        "Regroupez logos, images produit et références de marque afin que vos collègues et les agents IA connectés puissent trouver des médias pour des présentations, des sites web et d'autres projets.",
      keyFeaturesEyebrow: "Fonctionnalités clés",
      keyFeaturesHeading:
        "Tout ce qu'il faut pour générer, affiner et réutiliser",
      feature1Title: "Bibliothèques d'assets de marque",
      feature1Body:
        "Organisez les médias importés et générés dans des bibliothèques et des dossiers. Ajoutez logos, images de référence et notes de style que votre agent IA pourra utiliser.",
      feature2Title: "Génération d'images et de vidéos par IA",
      feature2Body:
        "Décrivez le média dont vous avez besoin et choisissez vos références de marque. Générez plusieurs options d'image ou de courtes vidéos, puis passez en revue les résultats avant d'enregistrer.",
      feature3Title: "Retouche d'image",
      feature3Body:
        "Demandez à votre agent IA de modifier ou de restyliser une image. Utilisez l'asset existant comme référence et affinez-le grâce à vos retours.",
      feature4Title: "Modèles réutilisables",
      feature4Body:
        "Enregistrez des instructions de génération pour vos tâches récurrentes, comme les visuels de blog ou les visuels réseaux sociaux. Associez un modèle à un kit de marque pour réutiliser ses références.",
      feature5Title: "Placement du logo original",
      feature5Body:
        "Définissez le logo de votre kit de marque et ajoutez-le aux images générées. Le compositing de logo place le fichier original au lieu d'en générer une nouvelle version.",
      feature6Title: "Accès agent",
      feature6Body:
        "Connectez votre agent IA pour rechercher dans la bibliothèque, générer des médias et choisir des assets depuis le chat. Les apps compatibles peuvent aussi intégrer un sélecteur d'assets.",
      finalCtaHeading: "Créez votre prochain asset de marque",
      finalCtaBody:
        "Choisissez vos références et dites à votre agent IA ce dont vous avez besoin.",
      finalCtaButton: "Générez une image",
    },
    chat: {
      faq: {
        question1: "Qu'est-ce qu'Agent-Native Chat ?",
        answer1:
          "Agent-Native Chat est une app de chat IA gratuite et open source pour les développeurs. Elle inclut des fils de discussion enregistrés, une interface de chat avec un agent, l'authentification, des actions partagées et la synchronisation en direct. Vous ajoutez les données et le comportement propres à votre application.",
        question2: "Chat est-il un assistant IA fini ?",
        answer2:
          "Chat fournit une interface de conversation fonctionnelle et le framework qui la fait tourner. Elle inclut une action d'exemple, mais les workflows métier et les intégrations avec des fournisseurs sont à vous d'implémenter et de configurer.",
        question3:
          "Puis-je ajouter des écrans au-delà de l'interface de chat ?",
        answer3:
          "Oui. Ajoutez des routes et des composants pour des listes, des files d'attente, des éditeurs ou toute autre vue dont votre workflow a besoin. Connectez-les aux mêmes actions et données d'application que l'agent utilise.",
        question4: "Chat inclut-il des connexions à mes outils métier ?",
        answer4:
          "Le modèle minimal n'inclut pas d'intégrations fournisseurs propres à un domaine. Ajoutez les connexions et règles d'accès dont votre app a besoin. Si une app Agent-Native existante correspond déjà à votre workflow, son modèle est peut-être un meilleur point de départ.",
        question5: "Puis-je personnaliser et déployer ma propre version ?",
        answer5:
          "Oui. Créez une copie avec la CLI, ajoutez vos actions, données et interface, puis déployez votre application. Configurez l'authentification et l'accès aux fournisseurs pour votre environnement, et testez les workflows que vous ajoutez avant de les partager avec vos utilisateurs.",
      },
      s001: "Capture d'écran de l'app Chat",
      // V3 landing page copy (2026-09-14) — hero through final CTA below.
      heroEyebrow: "Chat",
      heroTitle: "Créez votre propre app de chat IA",
      heroDescription:
        "Un démarreur de chat gratuit et open source avec des fils de discussion durables, une authentification, des actions partagées et un agent que vous pouvez étendre avec vos propres outils et écrans.",
      heroCta: "Créez votre chat",
      heroSecondaryCta: "Ouvrir Chat",
      useCasesHeading: "Transformez les conversations en assistants de travail",
      useCasesBody:
        "Ajoutez les actions, les données et les écrans qui permettent à votre agent de répondre aux questions et de faire avancer le travail.",
      useCase1Title: "Répondez aux questions avec le contexte de votre équipe",
      useCase1Body:
        "Connectez les sources dont votre application a besoin via des actions, puis laissez l'agent rassembler les notes, les fichiers et les détails du projet en une seule réponse.",
      useCase2Title: "Donnez à votre agent les outils pour agir",
      useCase2Body:
        "Prototypez un workflow dans le chat, appelez les actions que vous définissez et affinez la façon dont l'agent gère chaque étape.",
      useCase3Title: "Rendre les résultats utilisables",
      useCase3Body:
        "L'agent ouvert fonctionne dans une file d'attente, une table ou un éditeur afin que les utilisateurs puissent inspecter et continuer à partir des mêmes données partagées.",
      keyFeaturesEyebrow: "Fonctionnalités clés",
      keyFeaturesHeading: "Une base pour votre agent et son interface",
      feature1Title: "Des conversations durables",
      feature1Body:
        "Créez, rouvrez, renommez, épinglez et archivez des fils de discussion à partir de la barre latérale d'historique incluse.",
      feature2Title: "Chat d'agent pleine page",
      feature2Body:
        "Commencez par la surface de discussion et le runtime, prêts à recevoir vos propres instructions, outils et flux de travail.",
      feature3Title: "Connectez vos propres services",
      feature3Body:
        "Ajoutez des actions de fournisseur et des flux de connexion pour des outils tels que Granola, Linear, Drive ou Notion ; le démarreur laisse ces intégrations à votre application.",
      feature4Title: "Actions partagées",
      feature4Body:
        "Conservez les outils d’agent et les opérations d’interface sur la même surface d’action.",
      feature5Title: "État de l'espace de travail en direct",
      feature5Body:
        "Gardez la navigation actuelle et le travail sélectionné synchronisés pour l'utilisateur et l'agent.",
      feature6Title: "Écrans personnalisés",
      feature6Body:
        "Ajoutez des vues ciblées lorsqu'une conversation nécessite une file d'attente, un éditeur ou une autre interface de domaine.",
      finalCtaHeading: "Construisez votre premier workflow d'agent",
      finalCtaBody:
        "Créez votre copie et ajoutez la première action dont vos utilisateurs ont besoin.",
      finalCtaButton: "Créez votre chat",
    },
    clips: {
      s001: "Capture d'écran du modèle Clips",
      // V5 landing page copy (2026-09-09) — hero through final CTA below.
      heroEyebrow: "Clips",
      heroTitle:
        "Des enregistrements d'écran que votre agent IA peut voir et entendre",
      heroDescription:
        "Clips est un enregistreur d'écran gratuit et open source pour partager des bugs, des retours et des tutoriels avec des agents IA.",
      heroCta: "Enregistrer un clip",
      useCasesHeading: "Que pouvez-vous faire avec Clips ?",
      useCasesBody:
        "Commencez avec un clip que vous avez enregistré ou qu'on vous a partagé. Donnez le contexte à votre agent IA et dites-lui ce dont vous avez besoin.",
      useCase1Title: "Agir sur un retour enregistré",
      useCase1Body:
        "Donnez à votre agent IA un retour enregistré à transformer en plan ou aidez-le à mettre en œuvre les modifications demandées.",
      useCase2Title: "Enquêter sur un bug signalé",
      useCase2Body:
        "Partagez un enregistrement de bug avec votre agent IA pour qu'il enquête sur ce qui s'est mal passé et détermine les prochaines étapes.",
      useCase3Title: "Créer à partir d'un brief enregistré",
      useCase3Body:
        "Utilisez un brief enregistré pour guider votre agent IA dans la création d'une présentation, d'un design, d'un contenu ou d'une modification d'application.",
      keyFeaturesEyebrow: "Fonctionnalités clés",
      keyFeaturesHeading:
        "Tout ce qu'il faut pour enregistrer, transcrire et partager",
      feature1Title: "Enregistrements lisibles par un agent",
      feature1Body:
        "Partagez la transcription et les images horodatées d'un clip avec votre agent IA via un seul lien lisible par un agent.",
      feature2Title: "Transcriptions automatiques",
      feature2Body:
        "Obtenez les transcriptions des enregistrements, réunions et dictées. Cliquez sur une ligne de transcription pour revenir à ce moment.",
      feature3Title: "Journaux de débogage du navigateur",
      feature3Body:
        "Capturez les erreurs de console et les requêtes échouées avec votre enregistrement grâce à l'extension Chrome de Clips.",
      feature4Title: "Agent IA intégré",
      feature4Body:
        "Interrogez l'agent IA intégré sur un clip ou sur toute votre bibliothèque, et laissez-le modifier les transcriptions dans le chat.",
      feature5Title: "Bibliothèque d'enregistrements consultable",
      feature5Body:
        "Trouvez des clips en recherchant dans leurs transcriptions. Organisez vos enregistrements avec des dossiers, des tags et des espaces d'équipe.",
      feature6Title: "Dictée à réponse par pression",
      feature6Body:
        "Maintenez Fn dans l'application de bureau pour dicter dans d'autres applications. Retrouvez les transcriptions et le texte nettoyé dans votre historique.",
      teammatesLine:
        "Vos coéquipiers peuvent regarder le même enregistrement dans le lecteur.",
      teammatesLinkLabel: "Lire le guide de partage avec les agents",
      seeInActionHeading: "Voir Clips en action",
      seeInActionBody:
        "Regardez Clips en action, de l'enregistrement d'un workflow dans le navigateur à la démonstration d'une tâche à un agent IA.",
      watchClipLabel: "Regarder le clip",
      finalCtaHeading: "Mettez votre prochain clip au travail",
      finalCtaBody:
        "Enregistrez une explication ou apportez un clip partagé à votre agent IA.",
      finalCtaButton: "Enregistrer un clip",
      s002: "Enregistrement d'écran",
      s003: "Journaux de débogage du navigateur",
      s004: "Dicter",
      s005: "Peut voir + entendre",
      s006: "Tous les modèles",
      s007Primary: "Des enregistrements d'écran que votre",
      s007Secondary: "AI peut voir et entendre.",
      s008: "Capturez les journaux de débogage du navigateur, obtenez des transcriptions et utilisez la dictée intégrée. 100 % gratuit, open source et personnalisable.",
      s063: "Obtenez une recommandation personnalisée",
      s064: "Collez cette invite dans Claude, ChatGPT ou Cursor pour découvrir comment Clips pourrait transformer votre flux de travail.",
      s009: "Essayez-le",
      s010: "Ce que tu peux faire",
      s011: "Enregistrez, transcrivez et déboguez: une application, une bibliothèque, sans la pile d'abonnement.",
      s012: "Enregistrement d'écran en un clic",
      s013: "Transcriptions automatiques",
      s014: "Chaque enregistrement d'écran, réunion et dictée reçoit une transcription complète. Les agents peuvent l'utiliser comme couche audio, et les téléspectateurs peuvent cliquer sur n'importe quelle ligne pour accéder à ce moment.",
      s015: "Dictée Push-to-Talk",
      s016: "Bibliothèque Video consultable",
      s017: "Enregistrements d'écran, transcriptions de réunions et dictées, tous indexés ensemble. Recherchez dans toute votre bibliothèque par ce qui a été dit, pas seulement par titre.",
      s018: "Recherche en texte intégral dans chaque transcription",
      s019: "Dossiers, balises et espaces de travail d'équipe",
      s020: "Commentaires et réactions horodatés",
      s021: "Page de joueur de marque",
      s022: "Auto-hébergez le joueur. Personnalisez la marque, l'appel à l'action et les analyses: c'est votre code.",
      s023: "Domaine et thème personnalisés",
      s024: "Afficher le nombre, le taux de surveillance et les abandons",
      s025: "Intégrable sur n'importe quel site",
      s026: "Flux de travail vidéo alimentés par des agents",
      s027: "Demandez à l'agent n'importe quoi sur votre bibliothèque ou collez un lien Clips partagé dans un autre agent: il peut lire les transcriptions, inspecter les images horodatées, lire les erreurs de console capturées et les requêtes ayant échoué derrière un bug, et rédiger des suivis écrits à partir de vos enregistrements.",
      s028: "\"Récupérez les éléments d'action du stand-up d'aujourd'hui\"",
      s029: '"Trouvez la dictée où j\'ai décrit le plan de lancement"',
      s030: '"Rédigez un e-mail de suivi de cette réunion"',
      s031: '"Lisez les erreurs de la console dans ce clip de bug et proposez un correctif"',
      s032: "Comment ça se compare",
      s033: "Enregistrement d'écran",
      s034: "Oui",
      s035: "No",
      s036: "Capture de débogage du navigateur (console + réseau)",
      s037: "Notes de réunion synchronisées Calendar",
      s038: "Dictée Push-to-talk",
      s039: "AI résumés et mesures à prendre",
      s040: "Limité",
      s041: "Agent complet: chapitres, actions, Q&A",
      s042: "L'agent modifie les transcriptions et le code",
      s043: "Liens multimédias d'agent pouvant être collés",
      s044: "Transcription seulement",
      s045: "Pack journal + capture d'écran",
      s046: "Remarques uniquement",
      s047: "Texte uniquement",
      s048: "Transcription + frames horodatées",
      s049: "Propriété des données",
      s050: "Stockage du vendeur",
      s051: "Le cloud du fournisseur",
      s052: "Vos données vous appartiennent, tout comme le code de l’application elle-même.",
      s053: "Tarifs",
      s054: "$15-30 / mois par utilisateur",
      s055: "Niveaux gratuits + payants",
      s056: "$18-25 / mois par utilisateur",
      s057: "$12-15 / mois par utilisateur",
      s058: "Gratuit et open source",
      s059: "Commencez maintenant",
      s060: "Choisissez ce que vous souhaitez capturer, puis commencez à enregistrer dans Clips.",
      s062: "Afficher tous les modèles",
      faq: {
        question1: "Qu'est-ce qu'Agent-Native Clips ?",
        answer1:
          "Agent-Native Clips est un enregistreur d'écran gratuit et open source pour partager des bugs, des retours et des tutoriels avec des agents IA. Il fournit à votre agent IA une transcription et des images horodatées d'un enregistrement, tandis que les personnes peuvent regarder le même clip.",
        question2:
          "Puis-je partager des enregistrements avec Claude, ChatGPT ou Cursor ?",
        answer2:
          "Clips fournit un lien lisible par un agent, avec une transcription et des images horodatées. Votre agent doit pouvoir ouvrir le contenu lié et lire les images pour utiliser les deux. Certains modes de chat peuvent lire la transcription mais nécessitent que vous téléchargiez une image séparément.",
        question3:
          "Ai-je besoin de l'extension Chrome pour enregistrer mon écran ?",
        answer3:
          "Non. Vous pouvez enregistrer depuis l'application web Clips. Utilisez l'extension Chrome lorsque vous voulez aussi les messages de console et les diagnostics réseau de l'onglet que vous montrez.",
        question4:
          "Les agents IA peuvent-ils regarder mes enregistrements d'écran ?",
        answer4:
          "Avec Clips, les agents IA compatibles peuvent comprendre votre enregistrement grâce à une transcription et des images horodatées. Ils utilisent le texte et les images plutôt que de lire la vidéo, ce qui vous permet de poser des questions sur ce qui s'est passé ou de confier une tâche à votre agent IA à partir de l'enregistrement.",
        question5: "Qui peut accéder à un enregistrement partagé ?",
        answer5:
          "Les enregistrements utilisent des liens publics par défaut, sauf si votre organisation modifie ce paramètre. Toute personne disposant du lien peut y accéder. Des options d'accès privé et organisationnel sont disponibles, et les clips privés peuvent être partagés avec des agents via des liens temporaires sans rendre l'enregistrement public.",
      },
      quickStart: {
        recordingMode: "Mode d’enregistrement",
        modeScreenCamera: "Écran + caméra",
        modeScreenOnly: "Écran uniquement",
        modeCameraOnly: "Caméra uniquement",
        captureSource: "Source de capture",
        surfaceWindow: "Fenêtre",
        surfaceBrowser: "Onglet du navigateur",
        surfaceScreen: "Écran",
        audioSource: "Source audio",
        defaultMicrophone: "Microphone par défaut",
        startRecording: "Démarrer l’enregistrement",
        uploadVideo: "Mettre en ligne une vidéo",
        importLoom: "Importer depuis Loom",
      },
    },
    content: {
      faq: {
        question1: "Qu'est-ce qu'Agent-Native Content ?",
        answer1:
          "Agent-Native Content est un espace de travail gratuit et open source pour les documents, les tâches et les bases de données. Il combine un éditeur de documents IA avec des tableaux structurés et des pages partagées que les utilisateurs et les agents IA connectés peuvent consulter et modifier ensemble.",
        question2: "Puis-je utiliser mon propre agent IA avec Content ?",
        answer2:
          "Oui. Content propose une connexion MCP pour les outils pris en charge tels que Claude Code, Codex et Cursor. Après connexion et autorisation d'accès, votre agent peut travailler avec les documents et bases de données auxquels il a accès. Vous pouvez aussi utiliser l'agent intégré de Content.",
        question3:
          "Puis-je demander à l'IA de relire mon texte sans le réécrire ?",
        answer3:
          "Oui. Demandez à votre agent IA de laisser des commentaires sur un document ou un passage. Vous pouvez lire les retours et apporter vous-même les modifications, ou demander à l'agent de modifier le texte. Demander des commentaires ne nécessite pas de lui confier la rédaction.",
        question4:
          "Content peut-il suivre les tâches et recueillir les demandes de l'équipe ?",
        answer4:
          "Oui. Créez une base de données avec des champs tels que responsable, statut, date de livraison et prochaine étape. Ajoutez des descriptions expliquant ce que chaque champ doit contenir. Ces descriptions guident votre agent IA lors de la création ou de la mise à jour des entrées, y compris pour demander les informations manquantes.",
        question5:
          "Puis-je contrôler qui modifie mon travail et restaurer une version antérieure ?",
        answer5:
          "Oui. Les nouveaux documents sont privés par défaut. Partagez-les avec un accès lecteur, éditeur ou administrateur, et utilisez l'historique des versions de la page pour restaurer un instantané antérieur. La restauration d'un instantané remplace le contenu actuel de la page.",
      },
      s001: "Capture d'écran du modèle Content",
      // V4 landing page copy (2026-09-14) — hero through final CTA below.
      heroEyebrow: "Content",
      heroTitle: "Créez et organisez votre travail avec votre agent IA",
      heroDescription:
        "Content est un espace de travail gratuit et open source pour les documents, les listes de tâches et les bases de données, que vous et vos agents IA pouvez consulter et modifier ensemble.",
      heroCta: "Organisez votre travail",
      useCasesHeading: "Que pouvez-vous faire avec Content ?",
      useCasesBody:
        "Travaillez sur un brouillon, suivez ce qu'il reste à faire, ou recueillez les détails d'une nouvelle demande.",
      useCase1Title: "Rédiger et relire du contenu",
      useCase1Body:
        "Demandez à votre agent IA de rédiger une page, de revoir un passage ou de laisser des commentaires sur votre texte. Choisissez comment vous voulez qu'il vous aide.",
      useCase2Title: "Suivre le travail avec vos agents",
      useCase2Body:
        "Conservez les tâches, le statut et les prochaines étapes dans un tableau partagé. Demandez à vos agents IA connectés de le mettre à jour au fil de votre projet.",
      useCase3Title: "Recueillir les demandes de projet",
      useCase3Body:
        "Configurez un tableau pour les demandes de design ou d'autres tâches d'équipe. Donnez des instructions à chaque champ pour que votre agent IA puisse demander les détails manquants.",
      keyFeaturesEyebrow: "Fonctionnalités clés",
      keyFeaturesHeading:
        "Tout ce dont vous avez besoin pour rédiger, organiser et collaborer",
      feature1Title: "Rédaction et relecture par IA",
      feature1Body:
        "Obtenez un premier brouillon, demandez des modifications sur un texte sélectionné, ou demandez des commentaires. Votre agent IA travaille directement dans le document.",
      feature2Title: "Documents et pages imbriquées",
      feature2Body:
        "Rédigez des pages avec titres, tableaux, images et blocs de code. Regroupez les documents associés sous un projet, et recherchez par titre et par contenu pour les retrouver.",
      feature3Title: "Bases de données et vues",
      feature3Body:
        "Organisez le travail en tableaux, tableaux Kanban ou calendriers. Ajoutez des champs pour les responsables, les dates et le statut, avec un document complet derrière chaque ligne.",
      feature4Title: "Instructions de page et de champ",
      feature4Body:
        "Décrivez ce qui doit figurer sur une page ou dans un champ de base de données. Donnez à vos agents IA des indications sur les informations et le format attendus.",
      feature5Title: "Agents IA connectés",
      feature5Body:
        "Connectez des agents provenant d'outils tels que Claude Code, Codex ou Cursor pour lire et mettre à jour vos documents et bases de données aux côtés de l'agent intégré.",
      feature6Title: "Collaboration en équipe",
      feature6Body:
        "Modifiez des pages ensemble, commentez des passages et répondez dans des fils de discussion. Partagez avec des personnes précises ou avec votre organisation, et choisissez leur niveau d'accès.",
      finalCtaHeading: "Faites entrer votre prochain projet dans Content",
      finalCtaBody:
        "Commencez avec un document, une liste de tâches ou un tableau que votre équipe utilise déjà.",
      finalCtaButton: "Organisez votre travail",
      s002: "Tous les modèles",
      s003: "Obsidian open source pour MDX",
      s004: "Modifiez les fichiers Markdown/MDX locaux comme Obsidian, générez de riches blocs personnalisés interactifs et écrivez avec un agent AI qui connaît vos documents.",
      s005: "Essayer",
      s006: "Écrire",
      s007: "Éditeur riche pour Markdown/MDX local avec formatage, titres, blocs de code et médias.",
      s008: "Affiner avec AI",
      s009: "Réécrivez, développez, résumez ou changez le ton de n'importe quelle sélection.",
      s010: "Construire des blocs MDX",
      s011: "Générez des composants interactifs et conservez-les modifiables dans vos documents.",
      s012: "Tout ce dont vous avez besoin",
      s013: "Un espace de travail de contenu complet - comme Obsidian pour MDX, avec une collaboration de style Notion lorsque vous en avez besoin.",
      s014: "Projets et documents",
      s015: "Organisez-vous en projets avec des documents imbriqués. Navigation et recherche dans l'arborescence de la barre latérale.",
      s016: "Conscient de la marque AI",
      s017: "L'agent apprend votre voix, votre guide de style et votre ton. Chaque brouillon vous ressemble.",
      s018: "Synchronisation bidirectionnelle Notion. Importez des pages depuis Notion, modifiez-les localement et repoussez les modifications.",
      s019: "Fichiers locaux Markdown/MDX",
      s020: "Modifiez les documents du dépôt directement comme Obsidian, prévisualisez les modifications et synchronisez-les lorsque vous utilisez le mode hébergé.",
      s021: "Blocs MDX personnalisés",
      s022: "Générez des composants locaux interactifs, insérez-les dans MDX et modifiez leurs accessoires à partir du document UI.",
      s023: "Automatisation des scripts",
      s024: "Pipelines de génération de contenu par lots, de références croisées et de publication.",
      s025: "Auto-amélioration",
      s026: "L'agent modifie lui-même l'application. Besoin d'un nouveau flux de travail? Demandez simplement.",
      s027: "Écrivez ici, publiez partout",
      s028: "Connectez-vous à n'importe quel CMS sans tête via des scripts. L'agent gère l'intégralité du flux de travail.",
      s029: "L'agent exécute les scripts de publication de manière autonome",
      s030: "Markdown, HTML ou tout autre format que vous préférez",
      s031: "Synchronisation locale Markdown/MDX en option pour les flux de travail axés sur les fichiers",
      s032: "Brouillon de contenu dans l'éditeur",
      s033: '"Publiez ceci sur WordPress"',
      s034: "L'agent exécute le script de publication",
      s035: "Content en direct sur votre site",
      s036: "Comment ça se compare",
      s037: "Éditeur UI",
      s038: "Complet, rigide",
      s039: "Chat uniquement",
      s040: "Complet, personnalisable",
      s041: "Notoriété de la marque",
      s042: "Par conversation",
      s043: "Persistant, formé",
      s044: "Fichiers MDX locaux",
      s045: "Markdown dans certains outils",
      s046: "Copier-coller manuel",
      s047: "Édition directe de fichiers avec des blocs personnalisés",
      s048: "Publication CMS",
      s049: "Étape séparée",
      s050: "Flux de travail intégré",
      s051: "Personnalisation",
      s052: "Plugins uniquement",
      s053: "Invite uniquement",
      s054: "Code source complet",
      s055: "Tarifs",
      s056: "Par siège",
      s057: "Abonnement",
      s058: "Gratuit et open source",
      s059: "Commencez en quelques minutes",
      s060: "Apportez vos documents MDX, générez des blocs interactifs et commencez à écrire avec AI.",
      s061: "Lire la documentation",
      s062: "Afficher tous les modèles",
    },
    design: {
      faq: {
        question1: "Qu'est-ce qu'Agent-Native Design ?",
        answer1:
          "Agent-Native Design est un outil de design et de prototypage IA gratuit et open source. Créez des prototypes HTML interactifs avec un agent IA, appliquez votre marque et affinez vos designs avec des contrôles visuels ou par chat. Partagez le résultat pour recueillir des retours ou exportez-le pour le développement.",
        question2: "Puis-je modifier un design une fois que l'IA l'a généré ?",
        answer2:
          "Oui. Ajustez le texte, les espacements et le style avec des contrôles visuels, ou demandez à l'agent IA de modifier le design. Vous pouvez comparer plusieurs directions et continuer à affiner celle que vous choisissez.",
        question3: "Puis-je utiliser mon propre système de design ?",
        answer3:
          "Oui. Associez un système de design pour guider les couleurs, la typographie, le style et les consignes de marque. Vous pouvez le réutiliser sur plusieurs designs et vous en servir comme contexte pour les révisions de l'agent IA.",
        question4: "Puis-je travailler avec des designs venant de Figma ?",
        answer4:
          "Oui. Design prend en charge les imports depuis Figma et propose un export SVG dédié, prêt pour Figma. Vérifiez les polices, les mises en page et les éléments modifiables après le transfert d'un design, car la compatibilité dépend de la source et du format d'export.",
        question5: "Que puis-je exporter, et est-ce une application terminée ?",
        answer5:
          "Exportez le HTML ou un ZIP des fichiers de design, ou préparez une passation pour un agent de développement. Le prototype offre un point de départ pour le développement : la logique applicative, les intégrations, les tests et le déploiement restent à mettre en œuvre et à vérifier. Les exports HTML peuvent utiliser des ressources externes au moment de l'exécution.",
      },
      s001: "Capture d'écran du modèle Design",
      // V4 landing page copy (2026-09-14) — hero through final CTA below.
      heroEyebrow: "Design",
      heroTitle: "Concevez des prototypes interactifs avec votre agent IA",
      heroDescription:
        "Design est un outil de design et de prototypage IA gratuit et open source pour créer des pages et des interfaces produit à l'image de votre marque, avec des designs que vous pouvez modifier vous-même.",
      heroCta: "Concevez gratuitement",
      useCasesHeading: "Que pouvez-vous faire avec Design ?",
      useCasesBody:
        "Explorez une nouvelle page, un flux produit ou une interface avant de la construire. Donnez à votre agent IA le brief et les détails qui comptent.",
      useCase1Title: "Explorer des idées de landing page",
      useCase1Body:
        "Transformez un brief de campagne ou de produit en prototype de landing page. Passez en revue le message, la mise en page et les appels à l'action avec votre équipe.",
      useCase2Title: "Travailler des parcours produit",
      useCase2Body:
        "Prototypez un parcours d'onboarding, d'inscription ou de paiement. Parcourez les étapes et affinez l'expérience avant de vous engager dans l'implémentation.",
      useCase3Title: "Concevoir des dashboards et outils internes",
      useCase3Body:
        "Transformez des besoins de workflow en dashboard ou en interface d'administration. Explorez comment les utilisateurs trouveront l'information et accompliront leurs tâches quotidiennes.",
      keyFeaturesEyebrow: "Fonctionnalités clés",
      keyFeaturesHeading:
        "Tout ce qu'il faut pour concevoir, prototyper et partager",
      feature1Title: "Prototypes interactifs",
      feature1Body:
        "Décrivez la page ou le parcours dont vous avez besoin. Votre agent IA crée un prototype HTML avec des interactions que vous pouvez essayer dans l'aperçu.",
      feature2Title: "Édition par IA et visuelle",
      feature2Body:
        "Ajustez le texte, les espacements et le style avec des contrôles visuels, ou demandez à votre agent IA de modifier la mise en page et les interactions.",
      feature3Title: "Variantes de design côte à côte",
      feature3Body:
        "Demandez à votre agent IA plusieurs directions de design. Comparez-les sur le canevas, choisissez une approche et continuez à l'affiner.",
      feature4Title: "Styles de marque réutilisables",
      feature4Body:
        "Associez un système de design avec vos couleurs, votre typographie et votre style. Utilisez-le pour guider les nouveaux designs et les révisions dans tout votre projet.",
      feature5Title: "Commentaires de revue de design",
      feature5Body:
        "Épinglez un retour à un élément précis pour garder le contexte clair. Envoyez un commentaire à votre agent IA pour traiter la modification.",
      feature6Title: "Export HTML et transfert de code",
      feature6Body:
        "Exportez le HTML ou un ZIP de vos fichiers de design. Donnez à un développeur ou à un agent de développement le prototype et le contexte pour poursuivre l'implémentation.",
      finalCtaHeading: "Commencez votre prochain design",
      finalCtaBody:
        "Apportez un brief. Explorez les possibilités. Affinez les détails.",
      finalCtaButton: "Concevez gratuitement",
      s002: "Décrire",
      s003: "Générer",
      s004: "Affiner",
      s005: "Tous les modèles",
      s006: "Le studio de prototypage open source AI HTML",
      s007: "Créez des designs et des prototypes interactifs. Affinez avec des outils familiers ou effectuez des modifications conversationnelles. Exportez où vous voulez.",
      s008: "Créez quelque chose",
      s009: "Comment ça marche",
      s010: "Tout ce dont vous avez besoin",
      s011: "Un studio prototype avec un agent qui écrit et affine le source.",
      s012: "Prototypes HTML complets",
      s013: "Générez des Alpine/Tailwind HTML autonomes qui s'affichent dans l'iframe d'aperçu et peuvent être exportés directement.",
      s014: "Génération de variantes",
      s015: "Partez de plusieurs directions, comparez-les dans l’application et continuez à affiner la conception la plus solide.",
      s016: "Ajuster les contrôles",
      s017: "Ajustez visuellement les variables de conception communes pendant que l'agent gère des modifications structurelles et de copie plus importantes.",
      s018: "Modifications conversationnelles",
      s019: '"Rendre le titre plus audacieux", "essayez une palette plus chaude", "ajoutez un bouton CTA". L\'agent met à jour le HTML sous-jacent.',
      s020: "Systèmes Design",
      s021: "Enregistrez les préférences du système de conception réutilisable afin que les nouvelles générations restent plus proches du langage de votre produit.",
      s022: "Exporter n'importe où",
      s023: "Exportez HTML, ZIP ou PDF à partir du prototype généré lorsque vous êtes prêt à le partager ou à le transférer.",
      s024: "Aperçu de la source d'abord",
      s025: "L'aperçu est rendu à partir du même HTML que l'agent modifie et utilise l'exportation, il y a donc moins de traduction entre le concept et le transfert.",
      s026: "Aperçu Iframe du prototype généré",
      s027: "Artefacts HTML, ZIP et PDF exportables",
      s028: "Raffinement conversationnel",
      s029: "L'agent modifie la source du prototype. Les instructions en anglais simple deviennent des modifications de la copie, de la mise en page, des couleurs, de l'espacement et des interactions.",
      s030: '"Rendez cela plus premium"',
      s031: '"Essayez une palette de couleurs plus foncées"',
      s032: '"Rendre la mise en page du héros plus éditoriale"',
      s033: '"Générez trois variantes de ceci"',
      s034: "Comment ça se compare",
      s035: "Outils de maquette statique",
      s036: "Générateurs ponctuels",
      s037: "Éditeur visuel",
      s038: "Le visuel d’abord",
      s039: "Inviter d'abord",
      s040: "Agent + aperçu + code",
      s041: "Génération AI",
      s042: "Limité / plugins",
      s043: "Invite ponctuelle",
      s044: "Itératif, conversationnel",
      s045: "Sortie modifiable",
      s046: "Fichier natif de l'outil",
      s047: "Souvent statique",
      s048: "Compléter HTML/CSS/JS",
      s049: "Personnalisation",
      s050: "Plugins uniquement",
      s051: "Invite uniquement",
      s052: "Code source complet",
      s053: "Tarifs",
      s054: "À partir de 15 $/mois par utilisateur",
      s055: "Crédits par image",
      s056: "Gratuit et open source",
      s057: "Commencez en quelques minutes",
      s058: "Partez du modèle et commencez à générer des prototypes interactifs avec un agent qui édite la source.",
      s059: "Lire la documentation",
      s060: "Afficher tous les modèles",
      s061: "100 % gratuit, open source et personnalisable.",
    },
    dispatch: {
      faq: {
        question1: "Qu'est-ce qu'Agent-Native Dispatch ?",
        answer1:
          "Agent-Native Dispatch est une application gratuite et open source d'orchestration d'agents IA pour un espace de travail Agent-Native. Elle coordonne les demandes entre les applications connectées, reçoit des messages depuis les canaux pris en charge, planifie des tâches récurrentes et gère les intégrations partagées.",
        question2: "Avec quelles applications Dispatch peut-il fonctionner ?",
        answer2:
          "Dispatch délègue aux applications connectées et disponibles dans votre espace de travail, comme Analytics ou Mail. Chaque application gère ses propres tâches et données. Configurez les connexions et les autorisations concernées avant de demander à Dispatch de les utiliser.",
        question3: "Puis-je utiliser Dispatch depuis Slack ou Telegram ?",
        answer3:
          "Oui. Configurez le canal de messagerie et associez votre identité à votre compte d'espace de travail si nécessaire. Dispatch peut recevoir des demandes et renvoyer des résultats via ce canal. Connecter un canal ne donne pas automatiquement à chaque expéditeur l'accès à toutes les applications.",
        question4:
          "Les agents peuvent-ils exécuter des tâches selon un planning ?",
        answer4:
          "Oui. Configurez une tâche récurrente et, si nécessaire, une destination de livraison pour ses résultats. Dispatch affiche la dernière exécution de la tâche, sa prochaine exécution et son état d'erreur afin que vous puissiez vérifier si elle s'est bien déroulée.",
        question5:
          "Les approbations Dispatch couvrent-elles tout ce que fait un agent ?",
        answer5:
          "Non. Dans un espace de travail d'équipe, Dispatch peut exiger une vérification de ses propres modifications aux ressources et paramètres partagés. Les actions effectuées dans les applications connectées, comme l'envoi d'un e-mail, suivent les contrôles propres à ces applications. La file d'approbation de Dispatch n'est pas un point de contrôle universel pour chaque action d'agent.",
      },
      s001: "Capture d'écran du modèle Dispatch",
      // V3 landing page copy (2026-09-12) — hero through final CTA below.
      heroEyebrow: "Dispatch",
      heroTitle: "Coordonnez vos agents IA depuis un seul endroit",
      heroDescription:
        "Dispatch est une application gratuite et open source d'orchestration d'agents IA pour déléguer du travail aux applications Agent-Native connectées, planifier des tâches récurrentes et gérer les connexions partagées.",
      heroCta: "Déléguez une tâche",
      useCasesHeading: "Que pouvez-vous faire avec Dispatch ?",
      useCasesBody:
        "Demandez de l'aide à une application connectée, mettez en place une mise à jour régulière ou examinez une exécution d'agent qui nécessite votre attention.",
      useCase1Title: "Déléguer du travail depuis une seule conversation",
      useCase1Body:
        "Demandez un résumé de métriques ou un brouillon de réponse. Dispatch transmet la demande à l'agent Analytics ou Mail connecté et renvoie le résultat.",
      useCase2Title: "Mettre en place des mises à jour d'équipe récurrentes",
      useCase2Body:
        "Planifiez un résumé quotidien de métriques ou une synthèse hebdomadaire depuis vos applications connectées. Choisissez un canal ou une boîte de réception configurés où le résultat doit arriver.",
      useCase3Title: "Examiner l'activité des agents",
      useCase3Body:
        "Vérifiez la dernière exécution d'une tâche et ses éventuelles erreurs. Utilisez les détails de fil de discussion et de surveillance disponibles pour comprendre ce qui s'est passé lorsqu'un workflow nécessite votre attention.",
      keyFeaturesEyebrow: "Fonctionnalités clés",
      keyFeaturesHeading:
        "Tout ce qu'il faut pour déléguer, planifier et surveiller",
      feature1Title: "Délégation entre applications",
      feature1Body:
        "Envoyez des demandes à l'application connectée qui prend en charge le travail. Chaque application utilise son propre agent, ses propres actions et ses propres données pour répondre.",
      feature2Title: "Connexions de messagerie",
      feature2Body:
        "Connectez des canaux comme Slack ou Telegram pour envoyer des demandes et recevoir des réponses. Associez les identités afin que Dispatch sache quel utilisateur de l'espace de travail fait la demande.",
      feature3Title: "Tâches planifiées",
      feature3Body:
        "Donnez un planning à un travail récurrent. Vérifiez si une tâche est activée, sa dernière exécution, sa prochaine exécution et toute erreur enregistrée.",
      feature4Title: "Destinations de livraison enregistrées",
      feature4Body:
        "Enregistrez un canal Slack, une conversation Telegram ou une adresse e-mail comme destination de livraison. Réutilisez-la pour les résultats planifiés et vérifiez l'état de la livraison.",
      feature5Title: "Intégrations partagées",
      feature5Body:
        "Configurez une connexion à un fournisseur une seule fois et accordez l'accès aux applications qui en ont besoin. Gérez les connexions partagées et l'accès aux applications depuis Dispatch.",
      feature6Title: "Approbations des modifications de l'espace de travail",
      feature6Body:
        "Exigez qu'un autre administrateur vérifie les modifications apportées par Dispatch aux ressources et paramètres partagés. Examinez les demandes en attente et approuvez-les ou rejetez-les dans un espace de travail d'équipe.",
      finalCtaHeading: "Commencez avec une seule tâche connectée",
      finalCtaBody:
        "Choisissez les applications dont vous avez besoin et demandez à Dispatch de coordonner le travail.",
      finalCtaButton: "Déléguez une tâche",
      s002: "+ Telegram inclus",
      s003: "Entre agents",
      s004: "Mémoire",
      s005: "Tâches récurrentes",
      s006: "Tous les modèles",
      s007: "Le port d'attache de votre agent",
      s008: "Parlez à votre agent depuis Slack, Telegram ou n'importe quel messager et il sera redirigé vers vos autres applications. Tâches, mémoire, approbations et délégation A2A, le tout au même endroit.",
      s009: "Essayer",
      s010: "Ce que tu peux faire",
      s011: "Dispatch est la porte d'entrée orientée messager pour l'ensemble de votre pile d'agents natifs.",
      s012: "Messagerie bidirectionnelle avec contexte de fil de discussion, réponses Block Kit et approbations en ligne. Parlez de n'importe où.",
      s013: "Dispatch achemine le travail vers vos autres applications natives d'agent via le protocole A2A. Mail, diapositives, conception – tous accessibles à partir d'un seul chat.",
      s014: "Emplois récurrents",
      s015: "Planifiez l'exécution de l'agent sur un cron: standups quotidiens, résumés hebdomadaires, vérifications horaires. Les résultats arrivent dans votre messagerie.",
      s016: "Approbations",
      s017: "Gérez les actions sensibles derrière une approbation en un seul clic dans Slack. Configurez par action: envoyer un e-mail, publier une mise à jour, exécuter l'automatisation.",
      s018: "Mémoire d'agent persistante",
      s019: "Dispatch mémorise le contexte dans les conversations, les fils de discussion et les canaux. Dites-lui vos préférences une fois – il les transmet.",
      s020: "Apprentissages capturés automatiquement de chaque conversation",
      s021: "Étendues de mémoire par utilisateur, par organisation et globale",
      s022: "Inspecter et modifier ce dont l'agent se souvient",
      s023: "Routage inter-applications",
      s024: "Dispatch est la plaque tournante. Connectez vos autres applications natives d'agent et chaque demande est acheminée vers l'agent capable d'effectuer le travail.",
      s025: '"Envoyer un deck à l\'équipe de conception" → Agent Slides',
      s026: '"Répondre au dernier email de vente" → Agent Mail',
      s027: '"Résumer les événements de ce trimestre" → Agent Analytics',
      s028: "Parlez à votre agent de n'importe où",
      s029: "DM votre agent sur Slack à 7 AM, faites un suivi depuis Telegram dans le train, obtenez une réponse Block Kit avec un bouton « Ouvrir le fil de discussion » pour accéder à la conversation complète.",
      s030: "\"Qu'est-ce qu'il y a sur mon calendrier demain?\"",
      s031: '"Créez un deck pour les Monday all-hands"',
      s032: "« Organisez mon stand-up matinal à 9 AM chaque jour de la semaine »",
      s033: '"Dites-moi quand le déploiement est terminé"',
      s034: "Comment ça se compare",
      s035: "Fermé AI Assistants",
      s036: "Routage inter-applications",
      s037: "Par bot",
      s038: "Produit unique",
      s039: "Défini par le fournisseur",
      s040: "Persistant, limité, inspectable",
      s041: "Code personnalisé",
      s042: "Limité",
      s043: "Personnalisation",
      s044: "SDK plomberie",
      s045: "Fermé",
      s046: "Code source complet",
      s047: "Tarifs",
      s048: "Frais par application",
      s049: "À partir de 20 $/mois par utilisateur",
      s050: "Gratuit et open source",
      s051: "Commencez en quelques minutes",
      s052: "Créez le modèle, connectez Slack ou Telegram et placez votre agent dans chaque conversation.",
      s053: "Lire la documentation",
      s054: "Afficher tous les modèles",
    },
    forms: {
      faq: {
        question1: "Qu'est-ce qu'Agent-Native Forms ?",
        answer1:
          "Agent-Native Forms est un créateur de formulaires IA gratuit et open source. Créez des formulaires et des sondages avec un agent IA, modifiez les champs visuellement, publiez un lien public, puis consultez ou analysez les réponses dans la même application.",
        question2: "Puis-je modifier un formulaire après que l'IA l'a créé ?",
        answer2:
          "Oui. Modifiez les questions, les libellés, les options, les champs obligatoires et l'ordre des champs dans l'éditeur visuel, ou demandez à votre agent IA de faire les changements. Les deux méthodes mettent à jour le même formulaire. Vous pouvez aussi ajouter des questions conditionnelles basées sur des réponses précédentes.",
        question3:
          "Les personnes ont-elles besoin d'un compte pour remplir mon formulaire ?",
        answer3:
          "Non. Toute personne disposant du lien public d'un formulaire publié peut envoyer une réponse sans compte. Les formulaires en brouillon ne sont pas publics, et les formulaires fermés n'acceptent plus de nouvelles réponses.",
        question4: "Puis-je recueillir des retours anonymes ?",
        answer4:
          "Oui. Activez le mode anonyme pour omettre l'identité de la personne qui répond et les métadonnées de provenance. Évitez aussi les questions demandant nom, e-mail ou autres informations identifiantes si vous voulez que les réponses restent anonymes.",
        question5: "Puis-je envoyer les réponses vers Google Sheets ou Slack ?",
        answer5:
          "Oui, après avoir configuré une destination pour le formulaire. Slack et Discord utilisent des URL de webhook. Google Sheets nécessite un point de terminaison Google Apps Script déployé qui reçoit les soumissions ; un simple lien de feuille de calcul ne suffit pas. Vous pouvez aussi utiliser un webhook ou exporter les réponses en CSV. Les exports agent de toutes les réponses en CSV ou JSON nécessitent un stockage de fichiers connecté.",
      },
      s001: "Capture d'écran du modèle Forms",
      heroEyebrow: "Forms",
      heroTitle: "Créez des formulaires avec votre agent IA",
      heroDescription:
        "Forms est un créateur de formulaires IA gratuit et open source pour créer des sondages, des formulaires d'inscription et des formulaires de demande, avec des questions que vous pouvez modifier vous-même et des réponses que votre agent IA peut vous aider à analyser.",
      heroCta: "Créer un formulaire",
      useCasesHeading: "Que pouvez-vous faire avec Forms ?",
      useCasesBody:
        "Recueillez les retours de vos clients, inscrivez des personnes à un événement, ou rassemblez les informations dont votre équipe a besoin pour traiter une demande.",
      useCase1Title: "Recueillir les retours clients",
      useCase1Body:
        "Interrogez vos clients sur leur expérience avec des notes, des questions à choix multiples et des réponses libres. Demandez à votre agent IA de résumer les retours reçus.",
      useCase2Title: "Recueillir des inscriptions",
      useCase2Body:
        "Créez un formulaire pour un webinaire, un événement ou une liste d'attente produit. Recueillez coordonnées et préférences, puis consultez ou exportez les soumissions.",
      useCase3Title: "Recueillir des demandes de projet",
      useCase3Body:
        "Proposez un formulaire pour des demandes de design, des briefs de projet ou du support interne. Demandez délais, exigences et autres détails dont votre équipe a besoin.",
      keyFeaturesEyebrow: "Fonctionnalités clés",
      keyFeaturesHeading: "Tout ce qu'il faut pour créer, partager et analyser",
      feature1Title: "Génération de formulaires par IA",
      feature1Body:
        "Décrivez ce que vous voulez recueillir et votre agent IA construit le formulaire. Demandez-lui d'ajouter des questions ou de revoir les champs existants.",
      feature2Title: "Édition visuelle des champs",
      feature2Body:
        "Modifiez vous-même les libellés, les options, les champs obligatoires et l'ordre des questions. Choisissez des types de champ comme texte, e-mail, choix multiple, dates, notes et échelles.",
      feature3Title: "Questions conditionnelles",
      feature3Body:
        "Affichez une question complémentaire lorsqu'une réponse précédente correspond à une règle. Demandez plus de détails quand quelqu'un sélectionne « Autre », par exemple.",
      feature4Title: "Liens de formulaire publics",
      feature4Body:
        "Publiez un formulaire et partagez son lien. Définissez un message de fin ou une redirection, et fermez le formulaire quand vous arrêtez d'accepter des réponses.",
      feature5Title: "Analyses et exports des réponses",
      feature5Body:
        "Consultez les soumissions dans un tableau ou demandez à votre agent IA des résumés et des tendances. Téléchargez le tableau des réponses au format CSV.",
      feature6Title: "Intégrations de soumission",
      feature6Body:
        "Configurez l'envoi vers Slack, Discord, Google Sheets ou un webhook. Chaque nouvelle réponse part vers la destination configurée pour ce formulaire.",
      finalCtaHeading: "Créez votre prochain formulaire",
      finalCtaBody: "Dites à votre agent IA ce que vous voulez recueillir.",
      finalCtaButton: "Créer un formulaire",
      s002: "Décrire",
      s003: "Générer",
      s004: "Itinéraire",
      s005: "Tous les modèles",
      s006Primary: "L'alternative open source AI à",
      s006Secondary: "Typeform et Google Forms",
      s007: "Générez un formulaire complet à partir d'une invite, affinez les champs de manière conversationnelle et acheminez les soumissions vers Slack, Discord, Google Sheets ou des webhooks. Possédez vos données et votre flux de travail – pas de frais par réponse.",
      s008: "Essayer",
      s009: "Comment ça marche",
      s010: "Tout ce dont vous avez besoin",
      s011: "Un générateur de formulaire complet avec AI intégré.",
      s012: "Tous les types de champs",
      s013: "Texte, e-mail, numéro, texte long, sélection, sélection multiple, case à cocher, radio, date, note et échelle.",
      s014: "Édition du champ visuel",
      s015: "Mettez à jour les étiquettes, les espaces réservés, les options, l'état requis et l'ordre des champs dans l'éditeur ou en demandant à l'agent.",
      s016: "Style personnalisé",
      s017: "Faites correspondre votre marque: couleurs, polices, mise en page. Ou demandez simplement à l'agent de « faire en sorte que cela ressemble à notre site marketing ».",
      s018: "Intégrations de soumission",
      s019: "Envoyez des soumissions structurées à Slack, Discord, Google Sheets ou à un webhook lorsque chaque réponse arrive.",
      s020: "Pages de partage publiques",
      s021: "Chaque formulaire obtient une URL publique avec SEO complet. Intégrez-le sur n'importe quel site ou hébergez-le sur votre propre domaine.",
      s022: "Tableau de bord des soumissions",
      s023: "Tableau triable, filtres, exportation CSV et vues détaillées par soumission. Toutes les données se trouvent dans votre base de données SQL.",
      s024: "Édition visuelle + conversationnelle",
      s025: "Faites glisser les champs, modifiez les étiquettes, définissez la validation. Ou décrivez simplement le changement et l'agent met à jour le même schéma de formulaire.",
      s026: "Réorganisation des champs par glisser-déposer",
      s027: "Aperçu en direct aux côtés de l'éditeur",
      s028: "Annuler/rétablir avec historique complet",
      s029: "Création de formulaires conversationnels",
      s030: "Évitez la routine champ par champ. Décrivez le formulaire une fois, puis affinez-le dans un langage simple.",
      s031: '"Créer un formulaire de demande d\'emploi"',
      s032: '"Ajouter une liste déroulante de niveau d\'expérience requis"',
      s033: '"Rendre le champ email obligatoire"',
      s034: '"Publiez chaque soumission à Slack"',
      s035: "Comment ça se compare",
      s036: "AI Générateurs de formulaires",
      s037: "Éditeur visuel",
      s038: "Oui, lié à un modèle",
      s039: "Limité / aucun",
      s040: "Visuel + agent + code",
      s041: "Génération AI",
      s042: "Aucun / basique",
      s043: "One-shot, rigide",
      s044: "Itératif, conversationnel",
      s045: "Intégrations de soumission",
      s046: "Manuel",
      s047: "Limité",
      s048: "Propriété des données",
      s049: "Serveurs du fournisseur",
      s050: "Hébergé par le fournisseur",
      s051: "Votre base de données SQL",
      s052: "Tarifs",
      s053: "Frais par réponse",
      s054: "Abonnement",
      s055: "Gratuit et open source",
      s056: "Commencez en quelques minutes",
      s057: "Partez du modèle et commencez à collecter les soumissions que vous possédez entièrement.",
      s058: "Lire la documentation",
      s059: "Afficher tous les modèles",
    },
    mail: {
      faq: {
        question1: "Qu'est-ce qu'Agent-Native Mail ?",
        answer1:
          "Agent-Native Mail est un client de messagerie gratuit et open source pour Gmail, avec un assistant e-mail par IA. Lisez et recherchez des messages, résumez des conversations, rédigez des réponses et organisez vos e-mails depuis la boîte de réception ou avec votre agent IA.",
        question2: "Mail fonctionne-t-il avec mon compte Gmail existant ?",
        answer2:
          "Oui. Connectez votre compte Gmail existant pour lire et envoyer des e-mails via Mail. Vous pouvez connecter plusieurs comptes Gmail et effectuer des recherches sur l'ensemble d'entre eux. Mail ne fournit pas de nouvelle adresse e-mail, et prend actuellement en charge Gmail plutôt qu'Outlook ou d'autres fournisseurs de messagerie.",
        question3: "L'agent IA enverra-t-il des e-mails sans mon approbation ?",
        answer3:
          "Lorsque vous demandez à l'agent IA d'envoyer un e-mail dans le chat, il a besoin de votre approbation. Les envois déclenchés par une automatisation nécessitent également une approbation, sauf si vous activez explicitement l'envoi automatique dans les paramètres de Mail. Vous pouvez relire et modifier les brouillons avant leur envoi.",
        question4:
          "L'IA peut-elle organiser automatiquement ma boîte de réception ?",
        answer4:
          "Oui. Créez des règles en langage naturel pour libeller, archiver, marquer d'une étoile ou marquer comme lus les messages entrants. Mail prend également en charge les filtres natifs de Gmail pour des conditions telles que l'expéditeur ou l'objet. Les filtres Gmail s'exécutent dans Gmail et continuent de fonctionner même lorsque Mail est fermé.",
        question5:
          "Un collègue peut-il préparer un e-mail que je dois relire ?",
        answer5:
          "Oui. Un collègue peut demander un brouillon qui apparaît dans votre file de relecture. Ouvrez-le, modifiez le message et envoyez-le lorsqu'il est prêt. La personne à l'origine de la demande ne peut pas l'envoyer à votre place ; c'est le propriétaire du brouillon ou un administrateur de l'organisation qui contrôle l'envoi.",
      },
      s001: "Capture d'écran du modèle Mail",
      // V3 landing page copy (2026-09-10) — hero through final CTA below.
      heroEyebrow: "Mail",
      heroTitle: "Gérez votre boîte de réception avec votre agent IA",
      heroDescription:
        "Mail regroupe le tri par priorité, les étiquettes contextuelles, les résumés de fils de discussion et les règles d'arrière-plan dans une boîte de réception Gmail dotée d'un clavier d'abord, avec un agent qui peut passer à l'étape suivante.",
      heroCta: "Gérez votre boîte de réception",
      useCasesHeading: "Laissez Mail prendre le premier passage",
      useCasesBody:
        "Faites apparaître les fils de discussion urgents, étiquetez les messages selon leur signification et continuez le travail répétitif de la boîte de réception tout en gardant le contrôle.",
      useCase1Title:
        "Une boîte de réception plus intelligente, propulsée par Jev",
      useCase1Body:
        "Dites à Jev ce qui compte : gardez visibles dans Product les commentaires humains des pull requests GitHub, archivez les notifications de bots et déplacez les e-mails de votre responsable vers Important. Ajustez chaque règle avec un prompt et améliorez le filtre anti-spam au fil de vos retours.",
      useCase2Title: "Étiquetez les messages par leur signification",
      useCase2Body:
        "L'agent peut appliquer des étiquettes à partir du contexte de l'expéditeur et de la conversation, afin que les fils de recherche, financiers et clients restent faciles à trouver.",
      useCase3Title: "Automatisez le travail de routine",
      useCase3Body:
        "Définissez des règles pour étiqueter ou archiver les nouveaux messages en arrière-plan, puis consultez l'historique d'exécution quand vous le souhaitez.",
      keyFeaturesEyebrow: "Fonctionnalités clés",
      keyFeaturesHeading:
        "Tout ce dont vous avez besoin pour lire, écrire et organiser vos e-mails",
      feature1Title: "Tri prioritaire",
      feature1Body:
        "Classez les fils de discussion entrants par urgence et contexte, afin que les délais et les personnes en attente de réponse arrivent en tête.",
      feature2Title: "Étiquettes d'IA contextuelles",
      feature2Body:
        "Classez les messages en fonction du sujet de la conversation, puis regroupez les messages similaires au fur et à mesure de leur arrivée.",
      feature3Title: "Boîte de réception gérée par les agents",
      feature3Body:
        "Demandez à l'agent de rechercher, résumer, étiqueter, archiver, suivre ou préparer une réponse à partir de la boîte de réception que vous consultez.",
      feature4Title: "Automatisations en arrière-plan",
      feature4Body:
        "Appliquez des règles en langage clair aux messages entrants et inspectez les actions entreprises par Mail.",
      feature5Title: "Vérifier avant d'envoyer",
      feature5Body:
        "Demandez à l'agent de rédiger ou de réviser une réponse, puis de la réviser et de la modifier avant qu'elle ne quitte votre boîte de réception.",
      feature6Title: "Recherche multi-comptes",
      feature6Body:
        "Recherchez parmi les comptes Gmail connectés et utilisez les mêmes outils de priorité, de libellés et d'agent en un seul endroit.",
      finalCtaHeading: "Commencez avec votre prochain e-mail",
      finalCtaBody:
        "Ouvrez une conversation et demandez à votre agent IA un résumé ou un brouillon de réponse.",
      finalCtaButton: "Gérez votre boîte de réception",
      s002: "Le clavier d'abord",
      s003: "Triage de la boîte de réception",
      s004: "Vues",
      s005: "Personnalisable",
      s006: "Tous les modèles",
      s007Primary: "L'alternative open source à",
      s007Secondary: "Superhuman et Gmail",
      s008: "Essayer",
      s009: "La démo hébergée utilise l'application Google partagée de Agent-Native pour l'accès à Gmail, donc Google peut vous demander de confirmer avant de continuer. Exécutez localement pour utiliser votre propre client Google OAuth.",
      s010: "Ce que tu peux faire",
      s011: "Tout ce dont vous avez besoin pour remplacer votre client de messagerie par une boîte de réception alimentée par AI que vous possédez entièrement.",
      s012: "Raccourcis clavier",
      s013: "Tri IA",
      s014: "L'agent lit votre boîte de réception, fait apparaître ce qui compte, rédige les réponses et gère automatiquement les e-mails de routine. Configurez des automatisations pour l’étiquetage automatique et l’archivage automatique.",
      s015: "Recherche intelligente",
      s016: 'Recherche en langage naturel dans l\'ensemble de votre boîte de réception. "E-mails de la semaine dernière concernant le budget" fonctionne tout simplement.',
      s017: "Auto-amélioration",
      s018: "L'agent modifie lui-même l'application. Besoin d'un dossier personnalisé, d'un filtre ou d'une automatisation? Demandez simplement.",
      s019: "Gestion de la boîte de réception optimisée par AI",
      s020: "Laissez l’agent faire le gros du travail: trier, étiqueter, archiver et rédiger les réponses à partir d’instructions en langage naturel.",
      s021: "Étiquetage automatique, tri prioritaire et règles d'archivage automatique",
      s022: "Réponses rédigées par AI pour les messages de routine",
      s023: "Résumé du fil de discussion et actions à entreprendre",
      s024: "Composer d'abord au clavier",
      s025: "Écrivez et envoyez des e-mails à la vitesse de la pensée. Navigation complète au clavier, raccourcis de style Notion et rédaction assistée par AI.",
      s026: "Plusieurs onglets de brouillon pour rédiger plusieurs e-mails à la fois",
      s027: "AI transforme les brouillons courts en e-mails complets",
      s028: "Envoyer plus tard, répéter et relancer des rappels",
      s029: "Flux de travail de messagerie alimentés par des agents",
      s030: "L'agent lit, rédige et organise votre e-mail en langage naturel. Chaque flux de travail est un script que vous pouvez inspecter et étendre.",
      s031: '"Résumer mes emails non lus de cette semaine"',
      s032: '"Rédiger une réponse au fil de discussion sur les investisseurs"',
      s033: '"Archiver toutes les newsletters de plus de 7 jours"',
      s034: '"Trouver tous les emails en attente d\'une réponse de ma part"',
      s035: "Comment ça se compare",
      s036: "Raccourcis clavier",
      s037: "De base",
      s038: "Excellent",
      s039: "Entièrement personnalisable",
      s040: "AI aide",
      s041: "Composition intelligente",
      s042: "AI répond",
      s043: "Agent complet: triage, rédaction, automatisation",
      s044: "Personnalisation",
      s045: "Paramètres uniquement",
      s046: "Thèmes uniquement",
      s047: "Code source complet",
      s048: "Propriété des données",
      s049: "Les serveurs de Google",
      s050: "Hébergé par le fournisseur",
      s051: "Vous possédez le code",
      s052: "Tarifs",
      s053: "Gratuit / Espace de travail",
      s054: "$30/mois par utilisateur",
      s055: "Gratuit et open source",
      s056: "Commencez en quelques minutes",
      s057: "Créez le modèle, connectez votre fournisseur de messagerie et commencez à gérer votre boîte de réception avec AI.",
      s058: "Lire la documentation",
      s059: "Afficher tous les modèles",
      s060: "Note sur la démo hébergée",
    },
    plan: {
      faq: {
        question1: "Qu'est-ce qu'Agent-Native Plans ?",
        answer1:
          "Agent-Native Plans est un outil de planification visuelle gratuit et open source pour les agents de code IA. Examinez les plans d'implémentation avec des diagrammes, des wireframes, du code annoté et des commentaires, ou générez des récapitulatifs visuels des modifications déjà effectuées.",
        question2: "Comment utiliser Plans avec mon agent de code ?",
        answer2:
          "Installez les compétences de planification et le connecteur avec `npx @agent-native/core@latest skills add visual-plan`, puis terminez l'étape d'authentification pour votre client. Le guide d'installation couvre des clients tels que Claude Code et Codex. Utilisez `/visual-plan` pour demander à votre agent un plan d'implémentation visuel.",
        question3:
          "Mon agent peut-il réviser un plan à partir de mes commentaires ?",
        answer3:
          "Oui. Laissez des commentaires sur le texte ou épinglez-les à un élément visuel, puis demandez à votre agent de lire et de traiter les retours. Il peut mettre à jour le plan et répondre aux fils de révision. Cela vient en appui de votre processus de revue ; cela n'empêche pas automatiquement l'agent de modifier le code.",
        question4: "Puis-je utiliser Plans pour examiner du code déjà écrit ?",
        answer4:
          "Oui. Utilisez `/visual-recap` avec une pull request, un commit, une branche ou un diff pour obtenir une explication visuelle de la modification. Utilisez ce récapitulatif pour guider votre revue du code et des tests réels.",
        question5:
          "Où les plans sont-ils enregistrés, et puis-je les partager ?",
        answer5:
          "L'installation par défaut connecte votre agent à l'application Plans hébergée. Les nouveaux plans hébergés sont privés tant que vous ne les partagez pas. Vos coéquipiers peuvent examiner les plans partagés dans le navigateur ; commenter nécessite un compte. Des workflows locaux sont également disponibles via le guide d'installation.",
      },
      s001: "Capture d'écran de l'application Plans",
      heroEyebrow: "Plans",
      heroTitle: "Voyez ce que votre agent de code IA prévoit de construire",
      heroDescription:
        "Plans est un outil de planification visuelle gratuit et open source pour examiner l'approche de votre agent de code, donner des retours et comprendre les modifications de code grâce à des diagrammes, des wireframes et du code annoté.",
      heroCta: "Planifiez visuellement",
      heroSecondaryCta: "Ouvrir Plans",
      useCasesHeading: "Que pouvez-vous faire avec Plans ?",
      useCasesBody:
        "Examinez une approche d'implémentation, travaillez sur une interface ou comprenez une modification déjà effectuée avec votre agent de code IA.",
      useCase1Title: "Examiner l'architecture avant l'implémentation",
      useCase1Body:
        "Demandez à votre agent de code de diagrammer une fonctionnalité ou un refactoring proposé. Vérifiez le flux de données, les dépendances et les scénarios d'échec avant qu'il ne commence à modifier le code.",
      useCase2Title: "Travailler sur les modifications d'interface",
      useCase2Body:
        "Examinez les écrans et parcours utilisateurs proposés avec votre agent de code. Signalez les états ou interactions manquants et demandez-lui de réviser le plan.",
      useCase3Title: "Comprendre les modifications de code effectuées",
      useCase3Body:
        "Demandez à votre agent de code un récapitulatif visuel d'une pull request, d'un commit ou d'une branche. Examinez les changements de comportement et les fichiers concernés.",
      keyFeaturesEyebrow: "Fonctionnalités clés",
      keyFeaturesHeading:
        "Tout ce qu'il faut pour visualiser, examiner et échanger",
      feature1Title: "Diagrammes d'architecture",
      feature1Body:
        "Montrez les flux de requêtes, les relations entre systèmes et les modèles de données dans un plan. Demandez à votre agent de code IA de mettre à jour les diagrammes à mesure que l'approche évolue.",
      feature2Title: "Wireframes et prototypes",
      feature2Body:
        "Examinez les maquettes d'écran et les options de prototype interactif aux côtés du plan d'implémentation. Donnez vos retours sur l'interface proposée avant de demander à votre agent de la construire.",
      feature3Title: "Parcours de code annoté",
      feature3Body:
        "Lisez les fichiers source avec des notes ligne par ligne et des explications des modifications. Utilisez les arborescences de fichiers pour voir où s'insère le travail proposé dans la base de code.",
      feature4Title: "Commentaires et annotations",
      feature4Body:
        "Commentez le texte ou épinglez un retour à un endroit précis d'un élément visuel. Adressez vos questions à votre agent ou à un coéquipier.",
      feature5Title: "Récapitulatifs de code visuels",
      feature5Body:
        "Utilisez `/visual-recap` pour transformer une pull request, un commit, une branche ou un diff existant en un parcours avec des diagrammes et des explications des modifications.",
      feature6Title: "Partage et exports",
      feature6Body:
        "Partagez un plan pour que vos coéquipiers puissent l'examiner dans le navigateur. Exportez-le en HTML, Markdown, JSON ou MDX lorsque vous avez besoin d'une copie séparée.",
      finalCtaHeading: "Examinez votre prochaine tâche de code visuellement",
      finalCtaBody:
        "Demandez un plan à votre agent, puis travaillez les détails ensemble.",
      finalCtaButton: "Planifiez visuellement",
    },
    slides: {
      faq: {
        question1: "Qu'est-ce qu'Agent-Native Slides ?",
        answer1:
          "Agent-Native Slides est un générateur de présentations IA gratuit et open source. Créez des decks à l'image de votre marque à partir de vos idées et de vos documents source avec un agent IA, puis modifiez les diapositives vous-même, présentez-les ou exportez-les vers PowerPoint.",
        question2:
          "Puis-je modifier les diapositives une fois que l'IA les a générées ?",
        answer2:
          "Oui. Modifiez le texte, la mise en page et le style directement dans l'éditeur visuel, ou demandez à l'agent IA de revoir une diapositive sélectionnée. Vous pouvez continuer à affiner la présentation après le premier brouillon.",
        question3:
          "Puis-je créer une présentation à partir d'un deck ou d'un document existant ?",
        answer3:
          "Oui. Joignez un deck ou un document comme document de référence pour une nouvelle présentation. Pour travailler directement sur le deck existant, importez-le explicitement. Vérifiez les diapositives importées pour détecter des changements de mise en page ou des images manquantes.",
        question4:
          "Puis-je utiliser mes propres couleurs de marque, polices et logo ?",
        answer4:
          "Oui. Appliquez un design system avec les couleurs, la typographie et les logos de votre marque, puis réutilisez-le sur plusieurs decks. Vous pouvez aussi fournir une présentation de référence pour guider les choix de design de l'agent IA.",
        question5:
          "Puis-je utiliser ma présentation dans PowerPoint ou Google Slides ?",
        answer5:
          "Exportez un fichier PPTX pour l'ouvrir dans PowerPoint. Pour utiliser la présentation dans Google Slides, importez-y ce fichier. Vérifiez les polices et les mises en page après l'export, car elles peuvent s'afficher différemment selon les éditeurs.",
      },
      s001: "Capture d'écran du modèle Slides",
      // V4 landing page copy (2026-09-11) — hero through final CTA below.
      heroEyebrow: "Slides",
      heroTitle: "Créez des présentations avec votre agent IA",
      heroDescription:
        "Slides est un générateur de présentations IA gratuit et open source pour créer des decks à l'image de votre marque à partir de vos idées et de vos documents source, avec des diapositives que vous pouvez modifier vous-même.",
      heroCta: "Créer un deck",
      useCasesHeading: "Que pouvez-vous faire avec Slides ?",
      useCasesBody:
        "Préparez un pitch, présentez un plan ou partagez une mise à jour. Donnez à votre agent IA le contenu et le public que vous avez en tête.",
      useCase1Title: "Créer des decks commerciaux et de pitch",
      useCase1Body:
        "Transformez votre brief produit en un deck pour des prospects ou des investisseurs. Adaptez le discours au public devant lequel vous présentez.",
      useCase2Title: "Présenter des plans et des stratégies",
      useCase2Body:
        "Donnez à votre agent IA un brief stratégique ou un plan de lancement à transformer en diapositives qui expliquent la direction et les prochaines étapes proposées.",
      useCase3Title: "Partager des mises à jour d'activité",
      useCase3Body:
        "Transformez des notes de projet ou des rapports de performance en une présentation qui montre l'avancement, explique les résultats et met en avant ce qui nécessite de l'attention.",
      keyFeaturesEyebrow: "Fonctionnalités clés",
      keyFeaturesHeading:
        "Tout ce qu'il faut pour créer, modifier et présenter",
      feature1Title: "Génération de présentations par IA",
      feature1Body:
        "Partez d'un prompt, d'un document ou d'un deck de référence. Donnez à votre agent IA le sujet et le public autour desquels construire la présentation.",
      feature2Title: "Édition par IA et visuelle",
      feature2Body:
        "Sélectionnez du texte pour que votre agent IA le révise, ou modifiez vous-même le texte, la mise en page et le style directement sur la diapositive.",
      feature3Title: "Styles de marque réutilisables",
      feature3Body:
        "Enregistrez vos couleurs, polices et logos dans un design system. Appliquez-le à plusieurs decks pour garder vos présentations cohérentes avec votre marque.",
      feature4Title: "Images et logos",
      feature4Body:
        "Demandez à votre agent IA de générer des images, de trouver des photos ou de rechercher des logos d'entreprise à utiliser dans vos diapositives.",
      feature5Title: "Collaboration en équipe",
      feature5Body:
        "Travaillez sur des decks avec vos coéquipiers, laissez des commentaires sur des diapositives précises et restaurez une version antérieure quand vous en avez besoin.",
      feature6Title: "Présentation et export",
      feature6Body:
        "Présentez en plein écran avec des notes de présentateur, partagez un lien de consultation ou exportez votre deck en fichier PowerPoint.",
      finalCtaHeading: "Commencez votre prochaine présentation",
      finalCtaBody: "Apportez une idée, un brief ou un deck existant.",
      finalCtaButton: "Créer un deck",
      s002: "Décrire",
      s003: "Générer",
      s004: "Affiner",
      s005: "Tous les modèles",
      s006Primary: "Des présentations",
      s006Secondary: "À votre image et modifiables",
      s007: "Générez des présentations à l'image de votre marque avec votre agent IA, modifiez ensuite les diapositives vous-même et exportez-les où vous voulez.",
      s008: "Essayer",
      s009: "Comment ça marche",
      s010: "Tout ce dont vous avez besoin",
      s011: "Un studio de présentation complet avec AI intégré.",
      s012: "Dispositions de diapositives prêtes à l'emploi",
      s013: "Utilisez nos modèles de diapositives de départ. Créez et réutilisez vos propres modèles pour plus tard.",
      s014: "Visuel + Édition de Code",
      s015: "Cliquez pour modifier les styles, double-cliquez pour le texte. Passez au HTML brut pour un contrôle total.",
      s016: "Génération d'images sans effort",
      s017: "Appuyez-vous sur des références de style et des chartes de marque. Choisissez parmi les options générées par Gemini AI.",
      s018: "Recherche de logos et d'images",
      s019: "Recherchez les logos d’entreprise via Logo.dev ou Brandfetch. Google Images pour banque de photos.",
      s020: "Réorganisation par glisser-déposer",
      s021: "Réorganisez les diapositives dans la barre latérale. Dupliquer ou supprimer avec des actions de survol.",
      s022: "Mode Présentation",
      s023: "Plein écran avec navigation au clavier, commandes à masquage automatique et notes du présentateur.",
      s024: "Partage et collaboration",
      s025: "Générez des liens de partage pour un accès aux présentations en lecture seule. Historique complet d'annulation/rétablissement avec entrées étiquetées.",
      s026: "Partager des liens avec un accès en lecture seule",
      s027: "Cmd+Z annuler/rétablir avec historique complet",
      s028: "Accédez à n’importe quel point de l’histoire",
      s029: "Raffinement conversationnel",
      s030: "L'agent modifie les diapositives directement et le UI s'actualise via la synchronisation des interrogations.",
      s031: '"Agrandir le titre"',
      s032: '"Ajouter un graphique sur la diapositive 3"',
      s033: '"Changez la palette de couleurs en bleu"',
      s034: '"Ajouter des notes de présentation pour la diapositive 5"',
      s035: "Comment ça se compare",
      s036: "AI Générateurs de diapositives",
      s037: "Éditeur visuel",
      s038: "Oui, lié à un modèle",
      s039: "Limité / aucun",
      s040: "Visuel + code + agent",
      s041: "Génération AI",
      s042: "De base / aucun",
      s043: "One-shot, rigide",
      s044: "Itératif, conversationnel",
      s045: "Génération d'images",
      s046: "De base",
      s047: "Personnalisation",
      s048: "Thèmes uniquement",
      s049: "Invite uniquement",
      s050: "Code source complet",
      s051: "Tarifs",
      s052: "Gratuit / par siège",
      s053: "Abonnement",
      s054: "Gratuit et open source",
      s055: "Créez une présentation maintenant",
      s056: "Choisissez vos préférences de design et rédigez un prompt pour commencer. Toujours gratuit.",
      s057: "Lire la documentation",
      s058: "Afficher tous les modèles",
      howItWorksDescribe:
        "Décrivez votre sujet, votre public et le ton souhaité. Joignez une présentation de référence. Commencez dans l’interface ou via votre propre flux de travail IA.",
      signInIntegration:
        "Connectez-vous pour accéder à Slides via une intégration webhook, MCP ou A2A.",
      signIn: "Se connecter",
      tryNow: {
        step: "Étape {{current}} sur {{total}}",
        q1: "Quel type de présentation vous faut-il ?",
        q1Pitch: "Pitch deck pour investisseurs",
        q1Sales: "Présentation commerciale pour des clients",
        q1Talk: "Support pour une conférence ou un cours en direct",
        q1Other: "Autre chose",
        q1OtherPlaceholder: "Décrivez le type de présentation",
        q2Pitch: "Quelle est l'entreprise et quelle levée de fonds ?",
        q2Sales: "Que vendez-vous, et à qui ?",
        q2Talk: "De quoi parle la conférence, et qui est dans la salle ?",
        q2Other: "Que doit couvrir la présentation ?",
        q2Detail:
          "Saisissez des notes ou donnez-moi simplement l'URL d'un site",
        q2Placeholder: "Notes, ou https://example.com",
        q3: "Donnez-moi un style à suivre",
        q3Detail:
          "Collez un site web dont s'inspirer, ou choisissez plutôt une ambiance",
        q3Placeholder: "https://example.com",
        q3VibeToggle: "Pas de site web ? Choisissez une ambiance",
        q3VibeMinimal: "Minimaliste et éditorial",
        q3VibeBold: "Audacieux et très contrasté",
        q3VibeWarm: "Chaleureux et humain",
        q3VibeTechnical: "Technique et riche en données",
        answerAction: "Ajouter au prompt",
        composerLabel: "Votre prompt",
        composerPlaceholder:
          "Décrivez la présentation que vous voulez, ou répondez aux questions ci-dessus.",
        promptTip: "Astuce pour le prompt",
        promptPlaceholder:
          "Soyez précis. Dites à qui cela s'adresse, collez vos notes, ou référencez le design d'un site web...",
        submit: "Générer ma présentation",
        readyHint: "Votre prompt est prêt — envoyez-le à l'agent.",
        promptDeck: "Crée {{deck}}.",
        promptSubject: "Voici ce qu'elle doit couvrir : {{subject}}",
        promptStyleSite: "Reprends l'apparence et l'ambiance de {{style}}.",
        promptStyleVibe: "Style : {{style}}.",
        promptClose:
          "Rédige la présentation complète avec les notes du présentateur, puis présente-moi le plan.",
        deckPitch: "un pitch deck pour investisseurs",
        deckSales: "une présentation commerciale pour des clients",
        deckTalk:
          "une présentation d'accompagnement pour une conférence en direct",
        designReference: "Référence de design",
        websiteUrl: "URL du site web",
        websiteUrlPlaceholder: "https://example.com",
        crawlWebsite: "Inspecter le site web",
        crawlError:
          "Nous n’avons pas pu inspecter ce site. Il bloque peut-être les accès automatisés. Essayez une autre URL ou importez une référence de design.",
        or: "ou",
        uploadDesignReference: "Importer une référence de design",
        importDesignSystem: "Importer un système de design",
        loginDesignSystems: "Connectez-vous pour gérer les systèmes de design.",
        promptCreatePrefix: "Créez une présentation de",
        deckTypeLabel: "Type de présentation",
        deckCapitalRaise: "levée de fonds",
        deckOfferingMemorandum: "mémorandum d’offre",
        deckB2bSales: "vente B2B",
        deckTeamMeeting: "ordre du jour de réunion d’équipe",
        deckLiveTalk: "support de conférence en direct",
        promptDeckFor: "pour",
        promptTextShouldBe: "Le texte doit être",
        textAmountLabel: "Quantité de texte",
        textMinimal: "minimal",
        textBrief: "bref",
        textThorough: "détaillé",
        findingTitle: "titre",
        findingDescription: "description",
        findingColors: "couleurs",
        findingFonts: "polices",
        findingPrimaryColor: "couleur principale",
        findingAccentColor: "couleur d’accent",
        findingHeadingFont: "police des titres",
        findingBodyFont: "police du corps de texte",
        styleGuidePrefix: "Guide de style pour",
      },
    },
  },
  skillsPage: {
    metaTitle:
      "Skills agent - Visual Plan, Visual Recap et Visual Edit pour agents de code",
    metaDescription:
      "Installez des skills adossees a des apps Agent-Native pour aider votre agent de code a produire des plans visuels, des recaps de PR et de l edition visuelle locale.",
    metaOgDescription:
      "Donnez a votre agent de code des commandes slash propulsees par des apps Agent-Native que vous pouvez heberger, inspecter et personnaliser.",
    metaKeywords:
      "skills agent, visual plan, visual recap, visual edit, agent de code, Claude Code, Codex, revue PR, planification, agent-native",
    heroTitle: "Donnez de nouveaux superpouvoirs a votre agent de code",
    heroBody:
      "Installez des skills adossees a des apps Agent-Native entierement personnalisables : planification visuelle avant implementation, recaps visuels de PR apres les changements et edition visuelle des flows UI locaux.",
    sectionTitle: "Skills adossees a des apps pour agents de code",
    sectionBody:
      "Utilisez des liens d apps hebergees et partageables, des fichiers locaux ou une app auto-hebergee/personnalisee ; votre agent recoit les instructions et la surface MCP correspondante quand elle est necessaire.",
    ctaBody:
      "Fonctionne avec Claude Code, Codex, Cursor, Pi, OpenCode, GitHub Copilot / VS Code et les agents de code similaires.",
    readVisualPlansDocs: "Lire la documentation Visual Plans",
    browseTemplates: "Parcourir les modeles",
    visualPlan: {
      name: "Plan visuel",
      tagline: "Relire avant le code",
      description:
        "Transforme une tache de code en plan partageable avec diagrammes, notes de fichiers et croquis UI facultatifs.",
      feature1:
        "Voyez la forme de l implementation avant que les changements arrivent",
      feature2: "Commentez, revise, approuvez ou passez le relais",
      videoAriaLabel: "Video de demonstration de la skill Visual Plan",
    },
    visualRecap: {
      name: "Récapitulatif visuel",
      tagline: "Relire apres les changements",
      description:
        "Transforme une PR ou un git diff en recap partageable de ce qui a change et pourquoi.",
      feature1: "Resume les changements de schema, d API et de fichiers",
      feature2: "Peut publier un commentaire PR epingle",
      videoAriaLabel: "Video de demonstration de la skill Visual Recap",
    },
    visualEdit: {
      name: "Edition visuelle",
      tagline: "Modifier les flows UI locaux",
      description:
        "Ouvre une app localhost en cours d execution dans Design comme ecrans adosses a des URL pour revue et edition visuelles.",
      feature1: "Dispose des flows multi-ecrans depuis des URL ordonnees",
      feature2: "Inspecte, duplique et affine les etats de routes en direct",
      videoAriaLabel: "Video de demonstration de la skill Visual Edit",
    },
  },
  downloadPage: {
    title: "Télécharger Agent-Native",
    body: "Essayez des applications agentiques pour les réunions, le design, les présentations, les données, la planification, l'e-mail et plus encore, le tout dans une seule application de bureau.",
    openDesktop: "Ouvrir Agent-Native",
    downloadInstaller: "Télécharger l'installateur",
    downloadStarted: "Téléchargement démarré",
    downloadAgain: "Ça n’a pas fonctionné ? Réessayez le téléchargement",
    loadError: "Impossible de charger le dernier installateur desktop.",
    checkingRelease: "Recherche de la dernière version desktop...",
    retry: "Réessayer",
    unavailable: "Installateur indisponible pour cette plateforme",
    allPlatforms: "Toutes les plateformes",
    stable: "Stable",
    nightly: "Nightly",
    runFromSource: "Créez le vôtre",
    runFromSourceBody:
      "Créez une application Agent-Native depuis la ligne de commande et lancez-la localement sur macOS, Windows ou Linux.",
    platforms: {
      mac: {
        primary: "Télécharger pour Apple Silicon",
        alternative: "Mac Intel",
        gridPrimary: "Apple Silicon",
        gridAlternative: "Intel",
      },
      windows: {
        primary: "Télécharger pour Windows",
        alternative: "ARM64",
        gridPrimary: "Installateur x64",
        gridAlternative: "Installateur Arm64",
        note: "Windows 10 ou version ultérieure.",
      },
      linux: {
        primary: "Télécharger l'archive Linux",
        appImage: "Télécharger l'AppImage",
        deb: "Télécharger le .deb",
        gridPrimary: "x86_64",
        gridAppImage: "Universel",
        gridDeb: "Debian / Ubuntu",
        note: "L'archive fonctionne sans FUSE. AppImage peut nécessiter FUSE 2 sur certaines distributions.",
      },
    },
  },
  brandPage: {
    eyebrow: "Ressources de marque",
    title: "Logos Agent-Native",
    body: "Téléchargez les logos et symboles officiels pour vos articles, présentations et projets communautaires. Les fichiers SVG restent nets à toutes les tailles et prennent en charge les fonds transparents.",
    horizontal: {
      title: "Logo horizontal",
      body: "La composition recommandée pour les en-têtes d’articles, les sites web, les présentations et les formats larges.",
    },
    symbol: {
      title: "Symbole",
      body: "Utilisez le symbole seul pour les avatars, les icônes d’application et les espaces compacts.",
    },
    lightBackground: "Pour fonds clairs",
    darkBackground: "Pour fonds sombres",
    downloadSvg: "Télécharger le SVG",
    usage: {
      title: "Utilisation de la marque",
      clear: {
        title: "Préservez sa lisibilité",
        body: "Conservez les proportions du logo et laissez suffisamment d’espace libre autour de lui.",
      },
      contrast: {
        title: "Choisissez le bon contraste",
        body: "Utilisez la version sombre sur fond clair et la version claire sur fond sombre.",
      },
      original: {
        title: "Utilisez l’original",
        body: "Ne recolorez, recadrez, pivotez, étirez ou réorganisez pas le logo ou le symbole.",
      },
    },
  },
  legal: {
    lastUpdated: "Dernière mise à jour : {{date}}",
    resources: {
      eyebrow: "Ressources juridiques",
      title: "Ressources juridiques pour Agent-Native",
      intro:
        "Politiques juridiques autonomes d’Agent-Native pour les applications et services hébergés.",
      agentNative: {
        title: "Politiques Agent-Native",
        body: "Ces pages adaptent le cadre de politiques commun au projet open source et aux exemples hébergés d’Agent-Native.",
        terms: "Conditions d’utilisation d’Agent-Native",
        privacy: "Politique de confidentialité d’Agent-Native",
      },
      builder: {
        title: "Politiques supplémentaires du service hébergé",
        body: "Ces copies locales couvrent l’utilisation acceptable, les fonctions d’IA, les règles de la plateforme, la suspension et le retrait, les droits d’auteur et les demandes des autorités. La version anglaise fait foi.",
      },
      links: {
        terms: "Accord de services SaaS",
        privacy: "Politique de confidentialité",
        acceptableUse: "Politique d’utilisation acceptable",
        aiTerms: "Conditions relatives à l’IA",
        platformRules: "Règles de la plateforme",
        takedown: "Politique de suspension, retrait et traitement des données",
        lawEnforcement: "Politique relative aux demandes des autorités",
      },
      notIncluded: {
        title: "Conditions commerciales non incluses",
        body: "Agent-Native ne propose aucun forfait payant ni contrat d’entreprise. Les documents commerciaux comme les SLA d’entreprise, les conditions d’assistance, les DPA, les avenants de sécurité, les services professionnels et les frais ne sont pas inclus.",
      },
    },
    privacy: {
      eyebrow: "Politique de confidentialité",
      title: "Agent-Native applications hébergées",
      intro:
        "Cette politique explique comment Builder.io collecte, utilise, partage et conserve les données lorsqu'il exploite des applications hébergées par Agent-Native, des modèles hébergés, des démos et des extensions de navigateur officielles.",
      scopeCards: {
        hosted: {
          title: "Applications hébergées",
          body: "Couvert lorsque Builder.io exploite le service Agent-Native ou le modèle hébergé pour vous.",
        },
        openSource: {
          title: "Source ouverte",
          body: "Non couvert pour votre utilisation du code source sous licence MIT lui-même.",
        },
        selfHosted: {
          title: "Auto-hébergé",
          body: "Non couvert pour les forks, les personnalisations ou les déploiements opérés par quelqu'un d'autre.",
        },
      },
      sections: {
        scope: "Portée",
        information: "Informations que nous collectons",
        cookies: "Cookies et analytique",
        clipsExtension: "Extension Chrome Agent-Native Clips",
        use: "Comment nous utilisons les informations",
        sharing: "Partage et tiers",
        chromeLimitedUse: "Chrome Web Store utilisation limitée",
        retention: "Conservation et suppression",
        security: "Sécurité",
        changes: "Modifications et contact",
      },
      paragraphs: {
        scope1:
          "Agent-Native est open source et le code source est disponible sous la licence MIT. Cette politique s'applique uniquement aux applications et services hébergés exploités par Builder.io pour les utilisateurs Agent-Native. Cela ne s'applique pas à l'utilisation du code par quelqu'un d'autre, y compris les forks, les modèles personnalisés, les déploiements privés ou les versions auto-hébergées. Si vous exploitez votre propre déploiement, vous êtes responsable de vos propres pratiques en matière de données et de votre politique de confidentialité.",
        scope2Prefix:
          "Cette politique est destinée à compléter la politique plus large de Builder.io",
        scope2Suffix:
          "pour le comportement de l’application hébergée Agent-Native.",
        cookies:
          "Le site de documentation et les applications hébergées Agent-Native peuvent utiliser des cookies nécessaires à l’authentification et à la sécurité, au stockage de préférences comme la langue ou le thème, ainsi que des technologies analytiques configurées. Le site de documentation peut charger Google Analytics ou Google Tag Manager lorsque le déploiement les configure, et le service hébergé peut utiliser des analyses propriétaires pour mesurer la fiabilité et l’utilisation des fonctionnalités. Nous n’utilisons pas le contenu des applications hébergées pour la publicité de tiers. Vous pouvez contrôler les cookies dans les paramètres du navigateur, mais la désactivation des cookies nécessaires peut empêcher la connexion ou d’autres fonctions.",
        clips1:
          "Le Agent-Native Clips Chrome extension vous aide à démarrer des enregistrements basés sur le navigateur et, lorsqu'il est activé, à joindre les diagnostics du navigateur à un clip. Il peut collecter la source de capture sélectionnée, le support de caméra et de microphone que vous choisissez d'inclure, le titre et l'URL de l'onglet actif, ainsi que l'état d'authentification nécessaire pour connecter l'extension au Clips hébergé.",
        clips2:
          "Les journaux des développeurs sont facultatifs. Lorsqu'elle est activée, l'extension peut collecter les messages de console expurgés, les exceptions JavaScript et récupérer les métadonnées/XHR telles que la méthode, l'URL, l'état, la synchronisation et les détails d'échec à partir de l'onglet sélectionné pendant qu'un enregistrement est actif. L'extension n'est pas conçue pour collecter des corps de requête, des corps de réponse, des cookies ou des en-têtes d'autorisation.",
        clipsAnchor:
          "Pour les divulgations Chrome Web Store, utilisez cette section comme point d'ancrage de la politique de confidentialité de l'extension:",
        sharing1:
          "Nous ne vendons pas les données des applications hébergées par Agent-Native et ne les utilisons pas à des fins publicitaires par des tiers. Nous partageons des données avec des fournisseurs de services qui aident à exploiter le service hébergé, tels que l'infrastructure cloud, le stockage, l'authentification, la messagerie électronique, l'observabilité, AI et les fournisseurs de transcription, lorsque ces services sont nécessaires pour la fonctionnalité que vous utilisez.",
        sharing2:
          "Lorsque vous connectez une intégration, l'application hébergée peut envoyer ou recevoir des données de ce fournisseur selon votre configuration et les propres conditions du fournisseur. Nous pouvons également divulguer des informations lorsque cela est nécessaire pour des raisons de sécurité, de prévention des abus, de conformité légale ou pour protéger les utilisateurs et le service.",
        chromeLimitedUse:
          "Pour le Agent-Native Clips Chrome extension, notre utilisation des informations reçues de Chrome extension APIs adhère à la politique de données utilisateur Chrome Web Store, y compris les exigences d'utilisation limitée. L'activité du navigateur collectée par l'extension est utilisée pour fournir le flux de travail d'enregistrement et de diagnostic destiné à l'utilisateur, et non à des fins de publicité, de revente, de solvabilité ou de profilage sans rapport.",
        retention1:
          "Nous conservons les données des applications hébergées aussi longtemps que nécessaire pour fournir le service, conserver l'historique de l'espace de travail, respecter les obligations, résoudre les litiges ou améliorer la fiabilité et la sécurité. Les utilisateurs peuvent supprimer des clips, des documents, des ressources et d'autres contenus d'applications hébergées via les contrôles d'application appropriés, le cas échéant.",
        retention2:
          "Le contenu supprimé peut rester dans les sauvegardes, les journaux ou les enregistrements d'audit pendant une période limitée avant d'être supprimé conformément aux calendriers de conservation opérationnels.",
        security:
          "Nous utilisons des mesures de protection administratives, techniques et organisationnelles raisonnables conçues pour protéger les données des applications hébergées, y compris les contrôles d'accès, le cryptage du transport, la surveillance et les pratiques de sécurité opérationnelle. Aucun service en ligne ne peut garantir une sécurité parfaite. Les utilisateurs doivent donc éviter d'inclure des secrets ou des informations sensibles dans les enregistrements ou les invites, à moins qu'ils n'aient l'intention de partager ces informations avec l'application hébergée.",
        changes1:
          "Nous pouvons mettre à jour cette politique à mesure que les applications hébergées Agent-Native changent. La date mise à jour en haut de la page indique la dernière révision de la politique.",
        changes2Prefix:
          "Pour toute demande ou question relative à la confidentialité, contactez Builder.io via les canaux d'assistance et de confidentialité répertoriés dans le",
      },
      dataCategories: {
        account: {
          title: "Informations sur le compte et l'espace de travail",
          body: "Nom, adresse e-mail, appartenance à l'organisation, identifiants d'authentification et paramètres d'application utilisés pour vous connecter et séparer les espaces de travail hébergés.",
        },
        hostedContent: {
          title: "Contenu de l'application hébergée",
          body: "Content que vous créez ou téléchargez dans des modèles Agent-Native hébergés, tels que des enregistrements, des transcriptions, des documents, des commentaires, des tâches, des invites, des réponses d'agent, des fichiers et une configuration.",
        },
        integrations: {
          title: "Données d'intégration connectées",
          body: "Données des services que vous choisissez de vous connecter, tels que le calendrier, Slack, la messagerie électronique, le stockage ou les outils de développement, limitées aux étendues et aux flux de travail affichés dans l'application hébergée.",
        },
        usage: {
          title: "Données d'utilisation et techniques",
          body: "Appareil, navigateur, adresse IP, journaux de diagnostic, utilisation des pages et des fonctionnalités, erreurs et événements de sécurité utilisés pour faire fonctionner, sécuriser et améliorer les services hébergés.",
        },
      },
      uses: {
        provide:
          "Fournissez, synchronisez et exploitez les applications Agent-Native hébergées et leurs flux de travail d'agent.",
        transform:
          "Enregistrez, transcrivez, résumez, recherchez, partagez ou transformez du contenu lorsque vous demandez à l'application hébergée de le faire.",
        auth: "Authentifiez les utilisateurs, gérez les organisations, appliquez des contrôles d'accès et prévenez les abus.",
        support:
          "Déboguer les incidents, fournir une assistance, mesurer la fiabilité et améliorer l'expérience du produit hébergé.",
        comply:
          "Respectez les obligations légales, de sécurité et de plateforme.",
      },
      links: {
        builderPrivacy: "Politique de confidentialité",
        builderPrivacyFull: "Builder.io Politique de confidentialité",
      },
    },
    about: {
      eyebrow: "À propos d’Agent-Native",
      title: "Des applications open source pour les agents et les personnes",
      intro:
        "Agent-Native est un framework open source qui permet de créer des applications où les agents IA et les interfaces partagent les mêmes actions, données et état applicatif.",
      sections: {
        project: {
          title: "Un modèle opérationnel partagé",
          body: "Agent-Native considère l’agent et l’interface comme des partenaires égaux. Une seule action peut alimenter un contrôle UI, un outil d’agent, une route HTTP, une capacité MCP ou A2A, une commande CLI et un flux auditable. L’état SQL partagé garde les vues humaine et agent alignées.",
        },
        openSource: {
          title: "Open source par défaut",
          body: "Le code source est disponible sous licence MIT dans le dépôt BuilderIO/agent-native. Les développeurs peuvent l’inspecter, l’exécuter localement, choisir leur base de données et leurs fournisseurs de modèles, puis l’adapter à leur produit. Les services hébergés sont séparés des forks et déploiements autonomes.",
        },
        hosted: {
          title: "Hébergé ou auto-hébergé",
          body: "Builder.io exploite les applications hébergées et la documentation Agent-Native sur agent-native.com. Le framework est aussi conçu pour les équipes qui souhaitent déployer et maintenir leurs propres applications. Les contrats d’actions, limites d’accès, instructions d’agent et protocoles publics sont vérifiables dans le code et la documentation.",
        },
        community: {
          title: "Développé au grand jour",
          body: "Le projet avance publiquement grâce aux issues GitHub, pull requests, à la documentation et à la communauté Agent-Native. Consultez la documentation pour comprendre l’architecture, le code pour vérifier une implémentation, ou la communauté pour discuter d’un cas d’usage et contribuer.",
        },
      },
    },
    contact: {
      eyebrow: "Contact",
      title: "Contacter Builder.io au sujet d’Agent-Native",
      intro:
        "Utilisez les canaux de support, de code source et de communauté pour poser une question, signaler un problème, proposer une amélioration ou communiquer un sujet de sécurité.",
      emailLabel: "Écrire à support@builder.io",
      sections: {
        support: {
          title: "Support produit et service hébergé",
          body: "Pour une question sur une application hébergée, un accès de compte, un problème de documentation ou un comportement difficile à résoudre, écrivez à support@builder.io. Ajoutez l’URL publique, une description reproductible et tout identifiant de requête ou d’exécution utile. N’envoyez jamais de mot de passe, clé API, jeton ou donnée privée.",
        },
        source: {
          title: "Projet open source et communauté",
          body: "Utilisez le dépôt GitHub pour les bugs du code, propositions, pull requests et discussions d’implémentation. Discord convient aux questions qui profitent d’un échange avec d’autres développeurs. Recherchez d’abord les issues et la documentation afin de fournir le contexte nécessaire aux mainteneurs.",
        },
        security: {
          title: "Signalements de sécurité",
          body: "Ne publiez pas une vulnérabilité non corrigée dans une issue ou un chat public. Contactez Builder.io via le canal de sécurité disponible et transmettez uniquement les éléments nécessaires à la reproduction et à l’évaluation. Gardez les identifiants, données privées et contenus d’exploitation hors du support ordinaire.",
        },
        legal: {
          title: "Juridique et confidentialité",
          body: "Pour les questions de confidentialité, consultez la politique Agent-Native et les ressources juridiques Builder.io avant de contacter le support. Builder.io, Inc. est situé au 95 3rd Street, 2nd Floor, San Francisco, CA 94103, États-Unis. Les conditions du service hébergé et les responsabilités de l’auto-hébergement sont décrites dans les Conditions d’utilisation.",
        },
      },
    },
    terms: {
      eyebrow: "Conditions d'utilisation",
      title: "Agent-Native applications hébergées",
      intro:
        "Ces conditions s'appliquent lorsque Builder.io exploite pour vous des applications hébergées, des modèles hébergés, des démos et des services hébergés officiels Agent-Native.",
      scopeCards: {
        hosted: {
          title: "Applications hébergées",
          body: "Couvert lorsque vous utilisez une application ou un modèle Agent-Native exploité par Builder.io.",
        },
        openSource: {
          title: "Source ouverte",
          body: "Le code source sous licence MIT reste disponible sous sa licence open source.",
        },
        selfHosted: {
          title: "Auto-hébergé",
          body: "Les déploiements distincts opérés par vous ou quelqu'un d'autre ne sont pas des services hébergés Builder.io.",
        },
      },
      sections: {
        scope: "Portée et termes associés",
        hostedService: "Service hébergé",
        accounts: "Comptes et espaces de travail",
        content: "Votre contenu et vos autorisations",
        agents: "Agents, sorties AI et intégrations",
        acceptableUse: "Utilisation acceptable",
        openSource: "Open source et auto-hébergement",
        suspension: "Suspension et résiliation",
        disclaimers: "Avis de non-responsabilité et responsabilité",
        changes: "Modifications et contact",
      },
      paragraphs: {
        scope1:
          "Agent-Native est open source et son code source est disponible sous la licence MIT. Ces conditions s'appliquent uniquement aux applications et services hébergés exploités par Builder.io pour les utilisateurs Agent-Native. Ils ne régissent pas les forks, les modèles personnalisés, les déploiements privés ou les versions auto-hébergées exploitées en dehors de Builder.io.",
        scope2Prefix:
          "Ces termes complètent la définition plus large de Builder.io",
        scope2Middle: "et le Agent-Native",
        scope2Suffix:
          "Si vous utilisez une application Agent-Native hébergée au nom d'une entreprise ou d'une organisation, vous déclarez que vous avez le pouvoir d'accepter ces conditions pour cette organisation.",
        scope3:
          "Agent-Native ne propose ni offres payantes ni abonnements d’hébergement payants. Les conditions commerciales de Builder.io, telles que les bons de commande, les frais, l’assistance entreprise, les niveaux de service et les avenants relatifs au traitement des données, ne font pas partie de cette offre sauf accord écrit distinct.",
        hostedService:
          "Builder.io peut fournir des applications, des modèles, des démos, des espaces de travail partagés, des extensions de navigateur et des flux de travail d'agent associés Agent-Native hébergés. Le service hébergé peut être mis à jour, limité, suspendu ou interrompu à mesure que le produit évolue.",
        accounts1:
          "Vous êtes responsable de l’exactitude des informations de compte, de l’activité sous votre compte et de la sécurité des informations d’identification. Les applications Agent-Native hébergées peuvent inclure des fonctionnalités d'organisation, des invitations, des ressources partagées, des intégrations connectées et des contrôles d'accès spécifiques aux applications. Invitez uniquement les utilisateurs et connectez les services que vous êtes autorisé à utiliser.",
        accounts2:
          "Si vous pensez qu'un compte, un espace de travail, une intégration ou une ressource partagée a été compromis ou utilisé à mauvais escient, contactez rapidement l'assistance Builder.io.",
        content1:
          "Vous conservez la propriété du contenu que vous créez, téléchargez, enregistrez, importez ou vous connectez aux applications Agent-Native hébergées. Vous accordez à Builder.io l'autorisation limitée nécessaire pour héberger, traiter, transmettre, afficher, transformer, analyser et stocker ce contenu afin que l'application hébergée et ses flux de travail d'agent puissent fonctionner.",
        content2:
          "Vous êtes responsable de disposer des droits et autorisations nécessaires pour le contenu, les enregistrements, les invites, les fichiers, les informations d'identification et les données d'intégration connectées que vous fournissez au service.",
        agents1:
          "Les applications Agent-Native hébergées peuvent exécuter des agents, des outils, des automatisations et des intégrations de fournisseurs AI à votre demande. Le résultat généré par AI peut être incomplet, inexact ou inadapté à une utilisation particulière. Passez en revue les résultats, actions, exportations et messages importants avant de vous y fier.",
        agents2:
          "Lorsque vous connectez des services tiers, votre utilisation de ces services reste soumise à leurs propres conditions, limites, autorisations et pratiques de confidentialité.",
        openSource:
          "Ces conditions ne modifient pas la licence open source pour le code Agent-Native. Si vous téléchargez, forkez, modifiez ou auto-hébergez Agent-Native, la licence MIT et les conditions que vous avez définies pour votre propre déploiement régissent cette utilisation. Vous êtes responsable de la sécurité, de la confidentialité, de la conformité, des opérations et du support utilisateur pour les déploiements que vous opérez.",
        suspensionPrefix:
          "Builder.io peut suspendre ou restreindre l'accès aux services Agent-Native hébergés lorsque cela est nécessaire pour protéger les utilisateurs, se conformer à la loi, prévenir les abus, gérer les risques de sécurité ou exploiter le service. Vous pouvez cesser d'utiliser le service hébergé à tout moment. Certaines données peuvent rester dans des sauvegardes, des journaux ou des enregistrements d'audit pendant une période limitée, comme décrit dans le",
        disclaimers1:
          "Les services hébergés Agent-Native sont fournis tels quels et selon leur disponibilité, sous réserve de la loi applicable et de tout accord écrit distinct que vous avez avec Builder.io. Builder.io ne garantit pas que les applications hébergées, les intégrations, les automatisations ou les sorties AI seront ininterrompues, sans erreur ou répondront à toutes les exigences.",
        disclaimers2Prefix:
          "Dans la mesure maximale permise par la loi, la responsabilité de Builder.io pour les services hébergés Agent-Native est limitée comme décrit dans le cadre plus large de Builder.io.",
        disclaimers2Suffix:
          "ou un autre accord écrit qui s'applique à votre utilisation.",
        changes1:
          "Nous pouvons mettre à jour ces conditions à mesure que les applications hébergées Agent-Native changent. La date mise à jour en haut de la page indique la dernière révision des conditions.",
        changes2Prefix:
          "Pour toute question concernant ces conditions, contactez Builder.io via les canaux d'assistance répertoriés dans les Builder.io.",
      },
      hostedServicePoints: {
        create:
          "Créez et exploitez des espaces de travail et des applications modèles Agent-Native hébergés.",
        workflows:
          "Exécutez les workflows d'agent, les actions, les automatisations et les intégrations que vous choisissez d'utiliser.",
        store:
          "Stockez le contenu de l'application hébergée, les paramètres, les données de l'organisation et l'état du compte connecté nécessaires pour fournir le service.",
        improve:
          "Mesurez, sécurisez, déboguez et améliorez les services Agent-Native hébergés.",
      },
      acceptableUse: {
        laws: "N'utilisez pas les applications Agent-Native hébergées pour enfreindre les lois, enfreindre les droits ou nuire aux personnes ou aux systèmes.",
        bypass:
          "N'essayez pas de contourner les contrôles d'accès, les limites de débit, les limites de sécurité ou l'isolement des locataires.",
        malware:
          "Ne téléchargez pas de logiciels malveillants, de matériel de vol d'informations d'identification ou de contenu conçu pour perturber le service.",
        spam: "N'utilisez pas le service pour envoyer du spam, gratter sans autorisation ou abuser des fournisseurs connectés.",
        sensitive:
          "Ne placez pas de secrets ou de données sensibles réglementées dans des applications hébergées, sauf si vous y êtes autorisé et que l'application est appropriée à cette utilisation.",
      },
      links: {
        builderTerms: "Conditions d'utilisation",
        privacyPolicy: "Politique de confidentialité",
      },
    },
  },
  nav: {
    overview: "Vue d'ensemble",
    coreArchitecture: "Architecture centrale",
    dataAuthGovernance: "Données, auth et gouvernance",
    usingYourAgent: "Utiliser votre Agent",
    agentResources: "Ressources de l'agent",
    integrations: "Intégrations",
    advancedRuntime: "Avancé : étendre le runtime",
    templatesSection: "Apps",
    gettingStarted: "Bien démarrer",
    gettingStartedActions: "Add an Action",
    gettingStartedPages: "Add a Page",
    whatIsAgentNative: "Qu'est-ce qu'Agent-Native ?",
    agentSurfaces: "Surfaces Agent",
    agentNativeConfig: "Agent-Native Config",
    keyConcepts: "Concepts clés",
    agentNativeToolkit: "Toolkit",
    toolkitOverview: "Vue d’ensemble",
    toolkitUiPrimitives: "Primitives UI",
    customDesignSystem: "Systèmes de design personnalisés",
    toolkitEditorsCanvases: "Éditeurs et canevas",
    toolkitContextKnowledge: "Contexte et connaissances",
    toolkitSharing: "Partage",
    toolkitCollaboration: "Collaboration",
    toolkitSettings: "Paramètres",
    toolkitOrgTeam: "Organisation et équipe",
    toolkitSetupConnections: "Configuration et connexions",
    toolkitCommandNavigation: "Commande et navigation",
    toolkitResources: "Ressources",
    toolkitAgentUx: "UX de l'agent",
    toolkitHistory: "Historique",
    toolkitCommentsReview: "Commentaires et revue",
    toolkitObservability: "Observabilité",
    featureKits: "Kits de fonctionnalités",
    appChrome: "Cadre de l'app",
    capabilityPackages: "Packages de capacité",
    capabilityPackagesOverview: "Vue d’ensemble",
    packageLifecycle: "Cycle de vie des packages",
    versioningAndStability: "Versions et stabilité",
    templatesOverview: "Modèles",
    pureAgentApps: "Apps orientées automatisation",
    faq: "FAQ",
    server: "Serveur",
    serverOverview: "Vue d’ensemble",
    serverMiddleware: "Middleware",
    serverPlugins: "Plugins",
    serverRoutes: "Routes",
    client: "Client",
    clientOverview: "Vue d’ensemble",
    clientDataSync: "Données et synchronisation",
    clientAgentChat: "Chat de l’Agent",
    clientAdvanced: "Avancé",
    clientSyncInternals: "Synchronisation interne",
    clientEntryPoints: "Points d'entrée",
    routing: "Routage",
    actions: "Opérations",
    actionsOverview: "Vue d’ensemble",
    actionsDefining: "Définir des actions",
    actionsAccessControl: "Accès et autorisation",
    actionsRunContext: "Contexte d’exécution",
    actionsOtherSurfaces: "Autres surfaces",
    actionsAdvanced: "Avancé et hérité",
    actionsAgentTools: "Accès de l'Agent en Production",
    publicAgentWeb: "Agent Web public",
    database: "Base de données",
    databaseProviders: "Fournisseurs de bases de données",
    databaseNeon: "Neon Postgres",
    databaseSupabase: "Supabase Postgres",
    databaseAwsRds: "Amazon RDS for PostgreSQL",
    databaseCloudSql: "Cloud SQL for PostgreSQL",
    databaseAzurePostgres: "Azure Database for PostgreSQL",
    databasePostgres: "Plain Postgres",
    internationalization: "Internationalisation",
    localFileMode: "Mode fichiers locaux",
    fileUploads: "Téléversements",
    deployment: "Déploiement",
    deploymentOverview: "Vue d’ensemble",
    deploymentProviders: "Fournisseurs d’hébergement",
    deploymentProduction: "Production et avancé",
    deployAnApp: "Déployer une application",
    workspaceDeployment: "Déploiement du Workspace",
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
    deploymentOtherPlatforms: "Autres Plateformes",
    ssrCaching: "Mise en Cache SSR",
    deploymentEnvironmentVariables: "Déploiement : Variables d'Environnement",
    updatingUiInProduction: "Mettre à Jour l'UI en Production",
    environmentVariables: "Variables d'environnement",
    progress: "Progression",
    authentication: "Authentification",
    multiTenancy: "Multilocation",
    organizationsTeamsPermissions: "Organisations, équipes et autorisations",
    administeredDeployments: "Déploiements administrés",
    securityDataScoping: "Sécurité et portée des données",
    sharingPrivacy: "Partage et confidentialité",
    trackingAnalytics: "Suivi et analytics",
    auditLog: "Journal d'audit",
    doctorCodeChecks: "Doctor (vérifications du code)",
    observability: "Observabilité",
    observationalMemory: "Mémoire observationnelle",
    ciEvalGate: "Gate d'évals CI",
    usingYourAgentOverview: "Vue d'ensemble",
    contextAwareness: "Contexte écran",
    agentMentions: "Mentions d'Agent",
    voiceInput: "Entrée vocale",
    dropInAgent: "Agent intégrable",
    componentApi: "API de composants",
    nativeChatUi: "UI de chat native",
    agentkit: "AgentKit",
    generativeUi: "Interface générative",
    realTimeCollaboration: "Collaboration temps réel",
    agentResourcesOverview: "Vue d'ensemble des ressources de l'agent",
    skills: "Compétences",
    customAgentsTeams: "Agents et équipes personnalisés",
    workspaceGovernance: "Gouvernance du workspace",
    recurringJobs: "Tâches récurrentes",
    automations: "Automatisations",
    extensions: "Rallonges",
    dataPrograms: "Programmes de données",
    multiAppWorkspaces: "Workspaces multi-apps",
    onboardingApiKeys: "Onboarding et clés API",
    messaging: "Messagerie (Slack, Email...)",
    messagingRecipes: "Recettes de messagerie",
    messagingInternals: "Détails internes",
    dispatch: "Dispatch",
    portal: "Portail",
    a2aProtocol: "Protocole A2A",
    mcpClients: "Clients MCP (ajouter des outils)",
    httpApi: "API HTTP (appeler des opérations)",
    mcpServer: "Serveur MCP (exposer votre app)",
    externalAgents: "Agents externes (connecter un hôte)",
    externalAgentsCatalog: "Catalogue d'agents externes",
    mcpApps: "MCP Apps (UI intégrées)",
    webMcp: "WebMCP (outils du navigateur)",
    crossAppSso: "SSO entre apps",
    notifications: "Alertes",
    automationConnectors: "Connecteurs de workflow",
    workspaceConnections: "Connexions du workspace",
    creatingTemplates: "Créer des modèles",
    syncingTemplateChanges: "Synchroniser les modifications des modèles",
    writingAgentInstructions: "Écrire des instructions d'Agent",
    embeddingSdk: "SDK d'intégration",
    agentNativeCodeUi: "UI de code Agent-Native",
    harnessAgents: "Agents avec harness",
    adapters: "Adaptateurs",
    cliAdapters: "Adaptateurs CLI",
    processors: "Processeurs in-loop",
    durableResume: "Reprise durable",
    durableBackgroundRuns: "Exécutions en arrière-plan durables",
    blueprintInstaller: "Installateur Blueprint",
    chat: "Chat",
    chatOverview: "Vue d'ensemble",
    chatFirstEdits: "Votre première fonctionnalité",
    chatDevelopers: "Guide développeur",
    calendar: "Calendrier",
    calendarOverview: "Vue d'ensemble",
    calendarAgent: "Parler à l'agent",
    calendarFeatures: "Fonctionnalités",
    calendarIntegrations: "Utilisation multi-apps",
    calendarDevelopers: "Guide développeur",
    content: "Contenu",
    contentOverview: "Vue d'ensemble",
    contentEditing: "Rédaction et organisation",
    contentDatabases: "Collections et formulaires",
    contentSync: "Fichiers locaux et synchro",
    contentDevelopers: "Guide développeur",
    plans: "Plans",
    visualPlans: "Plans visuels",
    planReviewWorkflow: "Revue et commentaires",
    planAutomations: "Événements et automatisations",
    planLocalAndDesktop: "Fichiers locaux et bureau",
    planDevelopers: "Guide développeur",
    prVisualRecap: "Récapitulatif visuel de PR",
    planPluginMarketplace: "Plugin Plan et marketplace",
    slides: "Diapositives",
    slidesOverview: "Vue d'ensemble",
    slidesFeatures: "Fonctionnalités",
    slidesAgent: "Parler à l'agent",
    slidesIntegrations: "Utilisation multi-apps",
    slidesDevelopers: "Guide développeur",
    analytics: "Analyses",
    analyticsOverview: "Vue d'ensemble",
    analyticsDashboards: "Tableaux de bord et analyses",
    analyticsConnectors: "Connexion aux sources de données",
    analyticsMonitoringAndSessions: "Suivi et relecture des sessions",
    analyticsDevelopers: "Guide développeur",
    mail: "Mail",
    mailOverview: "Vue d'ensemble",
    mailAgent: "Parler à l'agent",
    mailInbox: "Boîte de réception et automatisations",
    mailDraftsAndQueue: "Brouillons et planification",
    mailDevelopers: "Guide développeur",
    clips: "Clips",
    clipsOverview: "Vue d'ensemble",
    clipsFeatures: "Fonctionnalités",
    clipsAgent: "Parler à l'agent",
    clipsIntegrations: "Utilisation multi-apps",
    clipsDevelopers: "Guide développeur",
    clipsEmbed: "Intégrer Clips",
    assets: "Ressources",
    assetsOverview: "Vue d'ensemble",
    assetsGeneration: "Génération et raffinement",
    assetsPresets: "Préréglages",
    assetsIntegrations: "Utilisation multi-apps",
    assetsDevelopers: "Guide développeur",
    design: "Design",
    designOverview: "Vue d'ensemble",
    designFeatures: "Fonctionnalités",
    designAgent: "Parler à l'agent",
    designIntegrations: "Utilisation multi-apps",
    designDevelopers: "Guide développeur",
    dispatchOverview: "Vue d'ensemble",
    dispatchFeatures: "Fonctionnalités",
    dispatchAgent: "Parler à l'agent",
    dispatchIntegrations: "Utilisation multi-apps",
    dispatchDevelopers: "Guide développeur",
    dispatchReference: "Référence des actions et données",
    forms: "Formulaires",
    formsOverview: "Vue d'ensemble",
    formsFeatures: "Fonctionnalités",
    formsAgent: "Parler à l'agent",
    formsIntegrations: "Utilisation multi-apps",
    docsComponents: "Docs Components",
    formsDevelopers: "Guide développeur",
  },
} satisfies typeof enUS;

export default frFR;
