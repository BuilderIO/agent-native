const messages = {
  root: {
    commandActions: "Opérations",
    askPlan: "Demander à Plan",
    openPlans: "Ouvrir les plans",
    openRecaps: "Ouvrir les récapitulatifs",
    commandAppearance: "Apparence",
    toggleTheme: "Changer de thème",
  },
  header: {
    plan: "Plan",
    settings: "Paramètres",
    team: "Équipe",
    extensions: "Rallonges",
  },
  navigation: {
    settings: "Paramètres",
    ask: "Demander",
    plan: "Plan",
  },
  settings: {
    title: "Paramètres",
    description: "Préférences de langue et d’espace de travail pour cette app.",
    languageTitle: "Langue",
    languageDescription:
      "Choisissez la langue de l’interface. Cette préférence est enregistrée dans votre compte.",
    languageLabel: "Langue de l’interface",
    workspaceTitle: "Espace de travail",
    workspaceDescription:
      "Gérez les membres, l’accès de l’organisation et les préférences partagées.",
    openTeamSettings: "Ouvrir les paramètres d’équipe",
    openResourceSettings: "Ouvrir les paramètres des ressources",
    agentTitle: "Paramètres de l’agent",
    agentDescription:
      "Ouvrez les paramètres de l’agent dans la barre latérale pour les modèles, clés API, automatisations, voix et autres contrôles.",
    openAgentSettings: "Ouvrir les paramètres de l’agent",
    editorTitle: "Extension VS Code",
    editorDescription:
      "Ouvrez et examinez les plans dans un panneau latéral de VS Code plutôt que dans un onglet de navigateur séparé.",
    openEditorExtension: "Obtenir l’extension VS Code",
  },
  agent: {
    emptyState:
      "Demandez à l’agent Plan de rechercher les récapitulatifs de PR fusionnées, d’inspecter ce document, d’ajouter des diagrammes ou de répondre aux questions de code sous forme de plans visuels.",
    suggestionShipped: "Qu’est-ce qui a été livré la semaine dernière ?",
    suggestionUi: "À quoi ressemble cette interface ?",
    suggestionApi: "Quelle est la structure de cette API ?",
  },
  sidebar: {
    openNavigation: "Ouvrir la navigation",
    navigation: "Navigation",
    navigationDescription: "Liens de navigation de l’application",
    chats: "Discussions",
    newPlanChat: "Nouvelle discussion Plan",
    newChat: "Nouvelle discussion",
    renameChat: "Renommer la discussion",
    unpinChat: "Retirer l’épingle",
    pinChat: "Épingler la discussion",
    archiveChat: "Archiver la discussion",
    planSection: "Plan",
    newPlan: "Nouveau plan",
    signInCreatePlan: "Connectez-vous pour créer un plan",
    signInToCreate: "Connectez-vous pour créer",
    signInKeepPlans: "Connectez-vous pour créer et conserver des plans.",
    noPlans: "Aucun plan pour le moment.",
    recapBadge: "Récap",
    viewAllPlans: "Voir tous les plans...",
    brandingSentLocal: "Demande de marque envoyée à l’agent de code local",
    brandingSent: "Demande de marque envoyée à l’agent de code",
    customizePlanBranding: "Personnaliser la marque Plan",
    customizeBranding: "Personnaliser la marque",
    customizeBrandingDescription:
      "Décrivez les changements de marque à appliquer dans Plan.",
    customizeBrandingPlaceholder:
      "Utilisez notre logo, changez le nom de l’app, mettez à jour les couleurs...",
    expandSidebar: "Développer la barre latérale",
    collapseSidebar: "Réduire la barre latérale",
    signIn: "Se connecter",
  },
  chat: {
    suggestionShipped: "Qu’est-ce qui a été livré la semaine dernière ?",
    suggestionUi: "À quoi ressemble la nouvelle interface de paiement ?",
    suggestionAuth: "Quand l’API d’authentification a-t-elle changé ?",
    suggestionApi: "Quelle est la structure de l’API de facturation ?",
    emptyState: "Demander à Plan",
    placeholder:
      "Demandez ce qui a ete livre, ce qui a change ou ce que montre le code actuel...",
    heading: "Demander à Plan",
    description:
      "Recherchez les recapitulatifs de PR fusionnees, inspectez les blocs visuels et publiez les reponses de code sous forme de diagrammes, wireframes, specs API et modeles de donnees.",
  },
  editor: {
    slash: {
      text: {
        title: "Texte",
        description: "Paragraphe de texte simple",
      },
      heading1: {
        title: "Titre 1",
        description: "Grand titre",
      },
      heading2: {
        title: "Titre 2",
        description: "Titre de section",
      },
      heading3: {
        title: "Titre 3",
        description: "Sous-titre",
      },
      bulletedList: {
        title: "Liste a puces",
        description: "Liste non ordonnee",
      },
      numberedList: {
        title: "Liste numerotee",
        description: "Liste ordonnee",
      },
      todoList: {
        title: "Liste de taches",
        description: "Elements de checklist",
      },
      quote: {
        title: "Citation",
        description: "Citation en bloc",
      },
      codeBlock: {
        title: "Bloc de code",
        description: "Extrait de code",
      },
      divider: {
        title: "Separateur",
        description: "Regle horizontale",
      },
      table: {
        title: "Tableau",
        description: "Tableau trois par trois",
      },
      image: {
        title: "Image",
        description: "Inserer une image",
      },
      structuredTable: {
        title: "Tableau structure",
      },
    },
  },
  raw: {
    sidebar: {
      archiveChatFailed: "Impossible d archiver le chat.",
      renameChatFailed: "Impossible de renommer le chat.",
    },
    canvas: {
      artboardCanvas: "Canevas de plan",
      zoomIn: "Zoom avant",
      zoomOut: "Zoom arriere",
      markupSaveFailed: "Impossible d enregistrer l annotation. Reessayez.",
    },
    document: {
      replaceImageFailed: "Impossible de remplacer l image.",
      replacingImage: "Remplacement de l image…",
      imageReplaced: "Image remplacee.",
      htmlFragment: "Fragment HTML",
      optionalCss: "CSS facultatif",
      invalidBlockDescription:
        "Ce bloc genere ne correspondait pas au schema Plan, il a donc ete ignore pendant que le reste du recap restait visible.",
      validationDetails: "Details de validation",
    },
    localCodebase: {
      chooseCodebase: "Choisir le codebase",
      clearCodebase: "Effacer le codebase",
      syncCodebase: "Synchroniser le codebase",
      codebaseSynced: "Codebase synchronise",
      codebaseSyncFailed: "Echec de synchronisation du codebase",
      chooseFolderFailed: "Impossible de choisir le dossier",
      syncLocalFailed: "Impossible de synchroniser le codebase local.",
      folderUnavailable:
        "L acces aux dossiers n est pas disponible dans ce navigateur.",
      filesSynced: "{{count}} fichiers synchronises",
      lastSynced: "Derniere synchronisation {{date}}",
      codebaseUnlinked: "Codebase dissocie",
    },
    content: {
      addSummary: "Ajoutez un bref resume du plan",
      changeStatistics: "Statistiques de changement",
      untitledPlan: "Plan sans titre",
      saveFailed: "Impossible d enregistrer",
    },
    imageViewer: {
      actualSize: "Taille reelle",
      closePreview: "Fermer l apercu image",
      copyImage: "Copier l image",
      downloadImage: "Telecharger l image",
      download: "Telecharger",
      editDetails: "Modifier les details",
      fitToScreen: "Ajuster a l ecran",
      imageOptions: "Options de l image",
      more: "Plus",
      openOriginal: "Ouvrir l original",
      replaceImage: "Remplacer l image",
      viewFullSize: "Voir en taille reelle",
      uploadingImage: "Televersement de l image…",
      image: "Image",
    },
    imageActions: {
      copiedUrl: "URL de l image copiee.",
      copyFailed: "Impossible de copier l image.",
      imageCopied: "Image copiee.",
      downloadStarted: "Telechargement de l image demarre.",
      openedNewTab: "Image ouverte dans un nouvel onglet.",
    },
    markdown: {
      copySectionLink: "Copier le lien vers cette section",
    },
    toc: {
      planSections: "Sections du plan",
    },
    visual: {
      clearDesignSelection: "Effacer la selection de design",
      designElement: "Element de design",
      visualReviewMode: "Mode de revue visuelle",
      prototype: "Prototype",
      design: "Design",
      wireframes: "Wireframes",
    },
    blocks: {
      describeChange: "Decrire un changement…",
      describeChangeTo: "Decrire un changement pour {{label}}",
    },
    pages: {
      planActions: "Actions du plan",
    },
  },
  plansPage: {
    comments: {
      addPlaceholder: "Ajouter un commentaire...",
      agent: "Agent",
      agentAction: "Action de l'agent",
      cancelComment: "Annuler le commentaire",
      closeComment: "Fermer le commentaire",
      closeComments: "Fermer les commentaires",
      comment: "Commentaire",
      comments: "Commentaires",
      deleteComment: "Supprimer le commentaire",
      deleteCommentDescription: "Cela supprimera le commentaire du plan.",
      deleteCommentTitle: "Supprimer le commentaire ?",
      deleteThread: "Supprimer le fil",
      deleteThreadDescription: "Supprimer la description du fil de discussion",
      deleteThreadDescription_many:
        "Cela supprimera le commentaire et les réponses {{count}} du plan.",
      deleteThreadDescription_one:
        "Cela supprimera le commentaire et la réponse {{count}} du plan.",
      deleteThreadDescription_other:
        "Cela supprimera le commentaire et les réponses {{count}} du plan.",
      deleteThreadTitle: "Supprimer le fil ?",
      editFirstComment: "Modifier le premier commentaire",
      editPlaceholder: "Modifier le commentaire...",
      expectedResolver: "Résolveur attendu",
      human: "Humain",
      humanReview: "Examen humain",
      markResolved: "Marquer comme résolu",
      noOpen:
        "Aucun commentaire ouvert. Cliquez sur Commentaire, puis cliquez pour en placer un.",
      noResolved: "Aucun commentaire résolu.",
      commentUpdated: "Commentaire mis à jour",
      replyAdded: "Réponse ajoutée",
      commentDeleted: "Commentaire supprimé",
      commentResolved: "Commentaire résolu",
      commentReopened: "Commentaire rouvert",
      mentionMember: "Mentionner un membre de l’organisation",
      searchingPeople: "Recherche de personnes...",
      noMatchingMembers: "Aucun membre de l’organisation correspondant.",
      open: "Ouvrir",
      options: "Options de commentaire",
      reopenThread: "Rouvrir le fil de discussion",
      replyPlaceholder: "Répondre",
      resolved: "Résolu",
      saveFailed: "Impossible d'enregistrer. Essayer à nouveau.",
      saving: "Économie",
      sendFailed: "Impossible d'envoyer. Essayer à nouveau.",
      sendReply: "Envoyer la réponse",
      signInDescription:
        "Créez un compte gratuit pour laisser des commentaires sur ce plan.",
      signInTitle: "Connectez-vous pour commenter",
      toAgent: "À l'agent",
    },
    common: {
      cancel: "Annuler",
      delete: "Supprimer",
      deleting: "Suppression...",
      save: "Sauvegarder",
    },
    create: {
      advanced: "Avancé",
      agentMissing:
        "Connectez l'agent à exécuter - ajoutez une clé API ou utilisez Builder.",
      assessment: {
        ui: "États ou flux d'interface utilisateur détectés automatiquement ; l'agent élaborera d'abord un plan filaire.",
        visual:
          "Auto demandera à l'agent un plan technique riche avec des schémas et des détails de mise en œuvre.",
      },
      autoWithLabel: "Auto : {{label}}",
      describeFirst: "Décrivez d’abord le plan.",
      description:
        "Décrivez le plan souhaité ou collez un plan Codex/Claude existant. L'agent du plan générera les wireframes et examinera la structure.",
      importDetected:
        "Cela ressemble à un plan existant. L'agent le conservera et ajoutera une structure de révision visuelle.",
      kindOptions: {
        auto: {
          description: "Auto : choisissez le bon chemin de planification",
          label: "Auto",
        },
        questions: {
          description: "Questions visuelles - apport explicite",
          label: "Questions visuelles",
        },
        ui: {
          description: "Flux d'interface utilisateur - wireframes et états",
          label: "Flux d'interface utilisateur",
        },
        visual: {
          description: "Visuel général – diagrammes et notes",
          label: "Visuel général",
        },
      },
      placeholder:
        "Demandez à l'agent un flux d'interface utilisateur, une carte de mise en œuvre, des notes de révision...",
      planningHelp:
        "Les plans collés sont détectés et envoyés à l'agent avec un contexte d'importation. Auto maintient le flux normal du plan ; choisissez Questions visuelles lorsque vous souhaitez d'abord un apport.",
      planningStyle: "Style de planification des agents",
      presets: {
        checkout: "Flux de paiement",
        imported: "Forfait importé",
        settings: "Refonte des paramètres",
      },
      presetPrompts: {
        checkout:
          "Planifiez un flux de revue de paiement avec des wireframes bureau et mobile, les principaux états vide/chargement/erreur, des invites de commentaire et des notes d’implémentation.",
        settings:
          "Créez un plan de flux d’interface pour une refonte des paramètres, avec états de navigation, interactions risquées, annotations de revue et notes de transfert au code.",
        imported:
          "# Plan d’implémentation\n\nCollez ici le plan Codex ou Claude Code existant et transformez-le en document de revue visuelle.",
      },
      sent: "Envoyé à l'agent du régime",
      source: "Source",
      sourceHelp:
        "Provenance uniquement. Cela aide à expliquer où le plan a commencé.",
      sourceOptions: {
        "claude-code": "Claude Code",
        codex: "Codex",
        cursor: "Cursor",
        imported: "Importé",
        manual: "Manuel",
        pi: "Pi",
      },
      title: "Demander à l'agent de créer un plan",
    },
    deletePlan: {
      deletePermanently: "Supprimer définitivement",
      description:
        "{{title}} ne sera plus disponible dans les vues de plan normales.",
      fallbackTitle: "Ce forfait hébergé",
      hardOptionDescription:
        "Supprimez les lignes et les références hébergées. Cela ne peut pas être annulé.",
      hardTitle: "Supprimer définitivement cet {{noun}} ?",
      moveToDeleted: "Déplacer vers Supprimé",
      permanentDescription:
        "Cela supprime l'{{noun}} hébergé, les commentaires, les partages, l'activité, les versions, les rapports et les enregistrements d'actifs Plan SQL. Les règles de cycle de vie des fichiers locaux et du fournisseur de téléchargement externe sont distinctes.",
      permanentWarning: "La suppression définitive ne peut pas être annulée.",
      softDescription:
        "La suppression logicielle déplace l'{{noun}} vers l'onglet Supprimé. Les liens directs, le partage public, les commentaires et les lectures d'agents cessent de fonctionner jusqu'à ce que vous les restauriez.",
      softOptionDescription:
        "Cachez-le maintenant, arrêtez l'accès public et gardez la restauration disponible.",
      softTitle: "Supprimer cet {{noun}} ?",
      typePrefix: "Taper",
      typeSuffix: "pour confirmer",
    },
    wireframe: {
      emptyDiagram: "Le contenu du diagramme est vide.",
      usageFree: "1 % utilisé · 198k libres",
      contextXray: "Radiographie du contexte",
      contextXrayPopover: "Fenêtre Context X-Ray",
      pinnedZero: "Épinglés 0",
      evictedZero: "Écartés 0",
      userMessage: "Message utilisateur",
      toolResult: "Résultat de l’outil",
      pinEvict: "Épingler / écarter",
      tokenMap: "Carte des jetons",
      selectedTokens: "Sélectionnés 2.0k",
      chatMessages: "Messages du chat",
      thinkingStatus: "État de réflexion",
      appShell: "Shell de l’app",
      chatThread: "Fil de chat",
      agentSidebar: "Barre latérale de l’agent",
      xray: "Radiographie",
    },
    empty: {
      description:
        "Créez un plan soigné avec des blocs de documents, des diagrammes, des wireframes et des commentaires modifiables avant le début de la mise en œuvre.",
      installPrefix: "Ou installez la compétence et utilisez",
      installSuffix: "auprès de votre agent de codage :",
      newPlan: "Nouveau forfait",
      title: "Commencez par un plan visuel",
    },
    history: {
      back: "Retour à l'histoire",
      description:
        "Parcourez les versions de plan enregistrées et restaurez un instantané précédent.",
      noPreview: "Cet instantané n'a pas de contenu prévisualisable.",
      noVersions: "Aucune version enregistrée pour l'instant",
      noVersionsDescription:
        "Les versions sont enregistrées automatiquement avant les futures modifications du plan.",
      previewTitle: "Aperçu de la version du forfait",
      restore: "Restaurer",
      restoreConfirmDescription:
        "Cela remplace le plan actuel par l'instantané d'{{date}}. Votre version actuelle est d'abord enregistrée dans l'historique, vous pouvez donc annuler cette opération.",
      restoreConfirmTitle: "Restaurer cette version ?",
      restoreFailed: "Échec de la restauration de la version du plan.",
      restoreSuccess: "Version du plan restaurée.",
      restoreThisVersion: "Restaurer cette version",
      restoring: "Restauration...",
      savedFirst:
        "Votre version actuelle est d'abord enregistrée dans l'historique.",
      snapshotUnavailable: "Instantané indisponible",
      surface: {
        blocks: "Blocs",
        blocks_many: "{{count}} blocs",
        blocks_one: "Bloc {{count}}",
        blocks_other: "{{count}} blocs",
        canvas: "Toile",
        prototype: "Prototype",
        sections: "Sections",
        sections_many: "{{count}} sections",
        sections_one: "Section {{count}}",
        sections_other: "{{count}} sections",
      },
      title: "Historique du régime",
      untitled: "Plan sans titre",
      versionActions: "Actions de version",
    },
    loadError: {
      acceptInvite: "Accepter l'invitation",
      acceptingInvite: "Accepter l'invitation",
      accessRequestSent:
        "Demande d'accès envoyée. Vous pourrez ouvrir ce lien une fois qu'un propriétaire aura accordé l'accès.",
      continueWithGoogle: "Continuer avec Google",
      createAccount: "Créer un compte",
      createAccountFailed: "Impossible de créer un compte.",
      didNotLoadTitle: "Le plan n'a pas été chargé",
      domainMessage:
        "Votre email @{{domain}} peut rejoindre {{orgName}}. Rejoignez-le pour ouvrir ce plan.",
      email: "E-mail",
      emailSignInFailed: "Impossible de se connecter avec l'e-mail.",
      genericMessage:
        "Ce plan n'a pas pu être chargé à partir de la session en cours.",
      haveAccount: "j'ai un compte",
      inviteMessage:
        "Vous avez déjà une invitation à {{orgName}}. Acceptez-le pour ouvrir ce plan.",
      joinMessage: "Vous pouvez rejoindre {{orgName}} pour ouvrir ce plan.",
      joinOrg: "Rejoignez {{orgName}}",
      joinedOrg: "A rejoint {{orgName}}. Plan d'ouverture...",
      joiningOrg: "Rejoindre l'organisation",
      maybeOtherOrgBody:
        "Ce plan peut appartenir à une autre organisation ou ce compte peut ne pas y avoir accès.",
      noAccessBody:
        "Ce plan existe, mais ce compte n'a pas accès pour le consulter.",
      notFoundBody:
        "Ce plan n'existe pas ou il appartient à une autre organisation et vous devez y accéder.",
      notFoundTitle: "Plan introuvable",
      orgBody:
        "Ce plan appartient à {{orgName}}. Vous devez être membre d’{{orgName}} pour le voir.",
      orgTitle: "Rejoignez {{orgName}} pour voir ce plan",
      password: "Mot de passe",
      privateBody:
        "Ce plan est privé. Connectez-vous avec un compte auquel vous avez accès.",
      requestAccess: "Demander l'accès",
      requestAccessTitle: "Demander l'accès à ce plan",
      requestSent: "Demande envoyée",
      retry: "Réessayer",
      retryHelp:
        "Réessayez le chargement ou connectez-vous avec un autre compte s'il s'agit d'un lien vers un forfait privé.",
      signIn: "Se connecter",
      signInTitle: "Connectez-vous pour voir ce plan",
      signInWithEmail: "Connectez-vous avec e-mail",
      signedInAs: "Connecté en tant que",
      switchAccount: "Changer de compte",
      verifyEmail:
        "Vérifiez votre courrier électronique pour vérifier le compte, puis rouvrez ce lien.",
    },
    localMode: {
      badge: "Mode local",
      description:
        "Vos données ne sont jamais enregistrées sur notre backend ni consultées par nous. Cette page restitue et modifie uniquement vos fichiers MDX locaux.",
      openDocs: "Ouvrez les documents.",
      privacyDetails: "Détails de confidentialité en mode local",
      title: "Mode local 100% privé",
    },
    localPlanLoadError: {
      message: 'Le dossier du plan local "{{slug}}" n\'a pas pu être lu.',
      title: "Plan local introuvable",
    },
    loggedOut: {
      copied: "Copié",
      copy: "Copie",
      copyInstallCommand: "Copier la commande d'installation",
      description:
        "Installez les compétences Plan dans votre agent de codage, puis utilisez la commande slash pour créer votre premier plan de révision.",
      installCopied: "Commande d'installation copiée",
      installCopyFailed: "Impossible de copier la commande d'installation",
      title: "Commencez par /visual-plan",
      viewDocs: "Consulter les documents",
    },
    nouns: {
      plan: "plan",
      recap: "résumer",
    },
    overview: {
      allAuthors: "Tous les auteurs",
      archive: "Archive",
      createdBy: "Créé par",
      delete: "Supprimer...",
      deletePermanently: "Supprimer définitivement",
      deletedAt: "{{date}} supprimé",
      deletedBadge: "Supprimé",
      documentCount: "Nombre de documents",
      documentCount_many: "{{count}} documents",
      documentCount_one: "Document {{count}}",
      documentCount_other: "{{count}} documents",
      empty: {
        noArchived: "Aucun plan archivé.",
        noDeleted: "Aucun plan supprimé.",
        noMatch: "Aucun plan ne correspond.",
        noPlans: "Pas de projets ici pour l'instant.",
      },
      me: "Moi",
      newPlan: "Nouveau forfait",
      planActions: "Planifier les actions",
      recapBadge: "Résumer",
      restore: "Restaurer",
      searchPlaceholder: "Rechercher des plans...",
      signInToCreate: "Connectez-vous pour créer",
      tabs: {
        all: "Tous",
        archived: "Archivé",
        deleted: "Supprimé",
        plans: "Forfaits",
        recaps: "Récapitulatifs",
      },
      title: "Forfaits",
      unarchive: "Désarchiver",
    },
    reader: {
      appView: "Vue de l'application",
      archiveFailed: "Échec de l'archivage du plan.",
      autoSyncChanges: "Modifications de synchronisation automatique",
      backToPlans: "Retour aux plans",
      changeLocalFolder: "Changer le dossier local",
      cleanWireframes: "Nettoyer les wireframes",
      clickCanvasNote: "Cliquez sur le canevas pour placer une note",
      clickToComment:
        "Cliquez sur {{noun}} ou sélectionnez le texte à commenter",
      clientHtmlWorkingPlan: "Plan de travail",
      copyFeedback: "Copier les commentaires",
      saveLocalPlanToRepo: "Enregistrer le plan local dans le dépôt",
      chooseRepoFolder:
        "Choisissez un dossier relatif au dépôt pour ces fichiers MDX.",
      repoFolder: "Dossier du dépôt",
      replaceExistingFolder: "Remplacer le dossier existant",
      copyForAgent: "Copie pour votre agent",
      copyForAgentDescription:
        "Copie une invite que vous pouvez coller dans le chat.",
      copyHtml: "Copier le HTML",
      copyLink: "Copier le lien",
      copyLocalPath: "Copier le chemin local",
      copyMarkdown: "Copier la démarque",
      darkMode: "Mode sombre",
      desktopSyncUnavailable:
        "La synchronisation des fichiers locaux sur le bureau n'est pas disponible.",
      downloadHtml: "Télécharger HTML",
      downloadMarkdown: "Télécharger la démarque",
      downloadSourceZip: "Source de téléchargement (.zip)",
      dragCanvasCallout:
        "Faites glisser sur le canevas pour dessiner une légende",
      enableLocalSyncFailed:
        "Impossible d'activer la synchronisation des fichiers locaux.",
      enterRepoFolder: "Entrez un chemin de dossier relatif au dépôt.",
      export: "Exporter",
      exportUnavailable: "L'exportation du plan n'était pas disponible.",
      feedbackCopied: "Instructions de commentaires copiées",
      fullPlan: "Forfait complet",
      fullScreen: "Plein écran",
      hideComments: "Masquer les commentaires",
      importLocalEdits: "Importer les modifications locales",
      importedLocalSource: "Fichiers sources locaux importés",
      lightMode: "Mode lumière",
      linkLocalFolder: "Lier le dossier local",
      linksDisabled:
        "Les liens sont désactivés lors de la révision afin que le document reste en place.",
      localFiles: "Fichiers locaux",
      localFilesNoHosted:
        "Aucune écriture ou partage de base de données hébergée.",
      localPathCopied: "Chemin local copié",
      localPlanAlreadySaved: "Le plan local est déjà enregistré dans le dépôt",
      localSourceFilesUnavailable:
        "Les fichiers sources du plan local n'étaient pas encore disponibles.",
      localSourceUnavailable:
        "La source du plan local n'était pas encore disponible.",
      noSourceFiles: "Aucun fichier source de plan n'a été trouvé.",
      openDocs: "Ouvrir des documents",
      openFullPlan: "Plan complet ouvert",
      openPrototypeWindow: "Ouvrir la fenêtre du prototype",
      openingFile: "Ouverture du fichier dans votre éditeur",
      pinComment: "Épingler un commentaire",
      planHtmlCopied: "Plan HTML copié",
      planLinkCopied: "Lien du plan copié",
      planMarkdownCopied: "Plan Markdown copié",
      planMovedToDeleted: "Plan déplacé vers Supprimé.",
      planPermanentlyDeleted: "Plan définitivement supprimé.",
      planRestored: "Plan restauré.",
      planSourceDownloaded: "Source du forfait téléchargée",
      recapLinkCopied: "Lien récapitulatif copié",
      recapMovedToDeleted: "Récapitulatif déplacé vers Supprimé.",
      recapPermanentlyDeleted: "Récapitulatif définitivement supprimé.",
      recapRestored: "Récapitulatif restauré.",
      reviewMarkupTools: "Examiner les outils de balisage",
      runtimeCloseCodePreview: "Fermer l'aperçu du code",
      runtimeComment: "Commentaire",
      runtimeCommentAuthor: "Auteur du commentaire",
      runtimeCommentBy: "{{countLabel}} par {{names}} : {{message}}",
      runtimeCommentCount_many: "{{count}} commentaires",
      runtimeCommentCount_one: "{{count}} commentaire",
      runtimeCommentCount_other: "{{count}} commentaires",
      runtimeCommentTitle: "{{countLabel}} : {{message}}",
      runtimeOpen: "Ouvrir",
      runtimePlanComment: "Commentaire du plan",
      saveAnswersFailed:
        "Impossible d'enregistrer les réponses : elles ont été envoyées uniquement au chat de l'agent.",
      saveSourceToFolder: "Enregistrer la source dans le dossier...",
      saveToRepo: "Enregistrer dans le dépôt...",
      savedLocalFiles: "Fichiers locaux {{count}} enregistrés sur {{path}}",
      sendFeedback: "Envoyer des commentaires",
      sendToAgent: "Envoyer à l'agent",
      sendToInlineAgent: "Envoyer à l'agent en ligne",
      sendToInlineAgentDescription:
        "Publie les commentaires ouverts dans l’agent côté application.",
      sending: "Envoi",
      sentAnswers: "Réponses envoyées à l'agent",
      sentComments: "Commentaires envoyés à l'agent",
      sentCommentsWithScreenshots:
        "Commentaires envoyés et captures d'écran ciblées à l'agent",
      showAllComments: "Afficher tous les commentaires",
      showComments: "Afficher les commentaires",
      sketchyWireframes: "Des wireframes sommaires",
      sourceFilesUnavailable:
        "Les fichiers sources du plan n'étaient pas encore disponibles.",
      stopCommenting: "Arrêtez de commenter",
      syncLocalFailed:
        "Impossible de synchroniser le plan avec les fichiers locaux.",
      syncToLocalFolder: "Synchroniser avec le dossier local",
      syncedLocalFiles: "Fichiers locaux {{count}} synchronisés",
      toggleAgentSidebar: "Activer/désactiver la barre latérale de l'agent",
      toggleSideChat: "Activer/désactiver le chat secondaire",
      unarchiveFailed: "Échec de la désarchivage du plan.",
      visualPromptCopied: "Invite d'admission visuelle copiée",
    },
    report: {
      description: "Dites-nous pourquoi cet {{noun}} public devrait être revu.",
      details: "Détails",
      detailsPlaceholder: "Ajouter une courte note pour les modérateurs",
      reason: "Raison",
      reasons: {
        harassment: "Harcèlement",
        hate: "Contenu haineux",
        illegal: "Activité illégale",
        other: "Quelque chose d'autre",
        privacy: "Problème de confidentialité",
        "self-harm": "L'automutilation",
        sexual: "Contenu sexuel",
        spam: "Spam ou trompeur",
        violence: "Violences ou menaces",
      },
      report: "Signaler {{noun}}",
      reportAria: "Signaler {{noun}}",
      submit: "Soumettre le rapport",
    },
    share: {
      accessNote:
        "Toute personne disposant d'un accès en modification peut modifier le fichier {{noun}}. L'affichage d'un {{noun}} public ne nécessite aucun compte, mais le commenter nécessite un compte natif d'agent.",
      checking: "Vérification",
      copyFailed: "Impossible de copier le lien",
      createAccountToPublish:
        "Créez un compte gratuit pour publier ce {{noun}}",
      createShareableLink: "Créer un lien partageable",
      creatingLink: "Création de lien",
      description:
        "Privé par défaut. Invitez des personnes, partagez avec votre organisation ou définissez Public pour l'examen par toute personne disposant d'un lien.",
      finishAccount:
        "Terminez la création de votre compte, puis revenez et nous générerons le lien.",
      generalAccess: "Accès général à {{noun}}",
      hostedCopy:
        "Cet {{noun}} local dispose d'une copie hébergée pour le partage. Ouvrez l'{{noun}} hébergé pour gérer l'accès.",
      linkCopied: "Lien partageable copié",
      linkLabel: "Lien {{noun}}",
      openHostedPlan: "Plan hébergé ouvert",
      peopleAccess: "Personnes ayant un accès {{noun}}",
      publishDescription:
        "Créez un compte gratuit pour publier cet {{noun}} sur un lien partageable. Vous pouvez continuer à éditer localement avec votre agent de codage jusqu'à ce que vous le fassiez.",
      share: "Partager {{noun}}",
      shareAria: "Partager {{noun}}",
      shareThis: "Partager ceci {{noun}}",
      signedInRetry: "Je suis connecté - réessayez",
      updateLink: "Lien de mise à jour",
      updating: "Mise à jour",
      visibility: {
        org: {
          description:
            "Tous les membres de votre organisation disposant du lien peuvent consulter",
          label: "Organisation",
        },
        private: {
          description:
            "Seules les personnes invitées peuvent ouvrir cet {{noun}}",
          label: "Privé",
        },
        public: {
          description: "Toute personne disposant du lien peut voir",
          label: "Publique",
        },
      },
    },
    skeleton: {
      loadingPlan: "Plan de chargement",
      loadingRecap: "Récapitulatif du chargement",
    },
    skillDemos: {
      "visual-plan": {
        description:
          "Examinez la forme de la mise en œuvre avant que les modifications du code n’arrivent.",
        label: "Plan visuel",
        videoAriaLabel: "Vidéo de démonstration des compétences Visual Plan",
      },
      "visual-recap": {
        description:
          "Transformez un PR ou un diff en un récapitulatif d'évaluation partageable.",
        label: "Récapitulatif visuel",
        videoAriaLabel: "Vidéo de démonstration de la compétence Visual Recap",
      },
    },
    status: {
      labels: {
        approved: "Approuvé",
        archived: "Archivé",
        complete: "Complet",
        draft: "Brouillon",
        in_progress: "En cours",
        review: "En revue",
      },
      setPlanStatus: "Définir le statut du plan",
      setStatus: "Définir le statut",
      updateFailed: "Échec de la mise à jour de l'état du plan.",
    },
  },
  guest: {
    banner:
      "Vous naviguez en tant qu'invite. Connectez-vous pour creer des plans, laisser des commentaires et conserver votre travail.",
    signIn: "Se connecter",
  },
};

export default messages;
