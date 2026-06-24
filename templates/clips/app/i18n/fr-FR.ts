const messages = {
  common: {
    cancel: "Annuler",
    create: "Créer",
    save: "Enregistrer",
    saving: "Enregistrement…",
    saveChanges: "Enregistrer les modifications",
    connected: "Connecté",
    notConnected: "Non connecté",
    disconnect: "Déconnecter",
    disconnecting: "Déconnexion...",
  },
  root: {
    commandActions: "Actions",
    commandSearch: "Rechercher",
    commandAppearance: "Apparence",
    toggleTheme: "Changer de thème",
    extensionSignedInTitle: "Connecté",
    extensionSignedInDescription:
      "Ouvrez à nouveau l’extension Clips pour commencer l’enregistrement.",
    gotIt: "Compris",
  },
  navigation: {
    brand: "Clips",
    library: "Bibliothèque",
    spaces: "Espaces",
    meetings: "Réunions",
    dictate: "Dicter",
    archive: "Archive",
    trash: "Corbeille",
    settings: "Paramètres",
    notifications: "Notifications",
    insights: "Analyses",
    space: "Espace",
    folder: "Dossier",
    extensions: "Extensions",
    newRecording: "Nouvel enregistrement",
    folders: "Dossiers",
    newFolder: "Nouveau dossier",
    noSpaces: "Aucun espace pour le moment",
    desktopCta: "Obtenir l’app de bureau",
    desktopTitle: "Obtenez l’app de bureau Clips.",
    desktopBody:
      "Enregistrez depuis la barre de menus, utilisez un raccourci global et profitez des mises à jour automatiques.",
    expandSidebar: "Développer la barre latérale",
    collapseSidebar: "Réduire la barre latérale",
    agentEmptyState: "Comment puis-je vous aider avec vos enregistrements ?",
    agentSuggestionSummary: "Résume mon dernier enregistrement",
    agentSuggestionPricing: "Trouve où j’ai mentionné les prix",
    agentSuggestionFiller: "Supprime les mots de remplissage de ce clip",
    createFolderError: "Échec de la création",
    folderCreated: "Dossier créé",
    folderNamePlaceholder: "Nom du dossier",
  },
  empty: {
    library: {
      title: "Votre bibliothèque est vide",
      body: "Capturez votre premier enregistrement d’écran et il apparaîtra ici, prêt à partager.",
      cta: "Enregistrer votre premier Clip",
    },
    folder: {
      title: "Ce dossier est vide",
      body: "Glissez-y des enregistrements ou lancez l’enregistrement pour commencer dans ce dossier.",
      cta: "Enregistrer ici",
    },
    space: {
      title: "Aucun enregistrement dans cet espace pour le moment",
      body: "Partagez un enregistrement avec l’espace ou créez-en un nouveau ; votre équipe le verra ici.",
      cta: "Enregistrer pour cet espace",
    },
    archive: {
      title: "Rien dans l’archive",
      body: "Les enregistrements archivés sont masqués de la bibliothèque, mais conservés. Vous pourrez toujours les restaurer plus tard.",
    },
    trash: {
      title: "La corbeille est vide",
      body: "Les enregistrements supprimés restent ici pendant 30 jours avant d’être supprimés définitivement.",
    },
    search: {
      title: "Aucun résultat",
      body: "Essayez un autre terme de recherche ou vérifiez vos filtres.",
    },
  },
  settings: {
    title: "Paramètres",
    intro: "Préférences et services connectés pour cet espace Clips.",
    languageTitle: "Langue",
    languageDescription:
      "Choisissez la langue de l’interface pour ce compte. Clips s’en souviendra sur tous vos appareils.",
    languageLabel: "Langue de l’interface",
    profile: "Profil",
    email: "E-mail",
    displayName: "Nom affiché",
    displayNamePlaceholder: "Votre nom",
    playback: "Lecture",
    defaultPlaybackSpeed: "Vitesse de lecture par défaut",
    playbackDescription:
      "Appliquée automatiquement quand vous ouvrez un enregistrement.",
    transcript: "Transcription",
    transcriptCleanup: "Nettoyage en arrière-plan",
    transcriptCleanupDescription:
      "Affichez immédiatement la transcription native, puis nettoyez-la en arrière-plan lorsqu’elle est disponible.",
    notifications: "Notifications",
    emailNotifications: "Notifications par e-mail",
    emailNotificationsDescription:
      "Recevez un e-mail lorsqu’une personne commente, réagit ou partage un enregistrement avec vous.",
    saved: "Paramètres enregistrés",
    saveFailed: "Échec de l’enregistrement",
    builderConnectedToast: "Builder.io connecté",
    videoStorage: "Stockage vidéo",
    videoStorageDescription:
      "Builder.io est le chemin de stockage principal pour les téléversements Clips. S3 est disponible si vous devez utiliser votre propre bucket.",
    checkingBuilder: "Vérification de Builder.io",
    builderConnected: "Builder.io connecté",
    connectBuilder: "Connecter Builder.io",
    builderConnectedFor: "Utilisation de Builder.io pour {{orgName}}.",
    builderConnectedGeneric:
      "Les nouveaux clips utilisent le fournisseur Builder.io connecté.",
    builderIncludes:
      "Inclut le stockage objet, les téléversements et la transcription gérée pour les nouveaux clips.",
    s3Title: "Stockage compatible S3",
    secondary: "Secondaire",
    active: "Actif",
    s3BuilderConnectedDescription:
      "À utiliser uniquement si cet espace doit téléverser vers votre propre bucket plutôt que Builder.io.",
    s3CurrentProvider: "Utilisation actuelle de {{providerName}}.",
    s3OwnBucketDescription:
      "Utilisez votre propre bucket si vous ne voulez pas du stockage Builder.io.",
    configureS3: "Configurer S3",
    hideS3: "Masquer S3",
    saveStorage: "Enregistrer le stockage",
    storageSaved: "Paramètres de stockage enregistrés",
    storageRequired:
      "Endpoint, bucket, access key et secret sont obligatoires.",
    apiSetup: "Configuration IA",
    apiSetupDescription:
      "Builder.io est le chemin par défaut pour les crédits IA gérés. Les clés de fournisseur sont facultatives et peuvent être ajoutées ici.",
    builderEasySetup: "Builder.io est la configuration la plus simple",
    builderAiAvailable:
      "Les crédits IA inclus et la transcription gérée sont disponibles pour Clips.",
    builderAiDescription:
      "Connectez Builder d’abord pour les crédits IA inclus, le stockage objet, les téléversements et la transcription gérée.",
    providerKeyTitle: "Utiliser votre propre clé fournisseur",
    providerKeyDescription:
      "Ajoutez des clés Anthropic, OpenAI, Gemini, Groq ou OpenRouter pour une utilisation facturée par fournisseur.",
    providerKeysSet: "{{count}} définies",
    checkingProviderKeys: "Vérification des clés fournisseur…",
    keySet: "Définie",
    replaceKey: "Remplacer la clé…",
    pasteProviderKey: "Collez d’abord une clé fournisseur.",
    apiKeySaved: "Clé API enregistrée",
    apiKeyFailed: "Échec de l’enregistrement de la clé",
    slackTitle: "Agent-Native Clips pour Slack",
    slackDescription:
      "Partagez un clip public, collez le lien dans Slack, et il se lit directement, sans étape supplémentaire pour les spectateurs. Connectez chaque espace une seule fois.",
    checkingSlack: "Vérification de Slack",
    slackConnected_one: "{{count}} espace connecté",
    slackConnected_many: "{{count}} espaces connectés",
    slackConnected_other: "{{count}} espaces connectés",
    slackOauthNeeded: "Identifiants OAuth requis",
    slackPreviewDescription:
      "Les liens Clips publics peuvent s’afficher comme aperçus lisibles dans Slack.",
    connectSlack: "Connecter Slack",
    slackClientMissing:
      "Définissez SLACK_CLIENT_ID et SLACK_CLIENT_SECRET pour ce déploiement avant de connecter des espaces.",
    slackSigningMissing:
      "Définissez SLACK_SIGNING_SECRET afin de vérifier les callbacks d’événements Slack.",
    connectedBy: "Connecté par {{email}}",
    disconnectSlackLabel: "Déconnecter {{team}}",
    slackConnectedToast: "Slack connecté",
    slackCheckedToast: "Connexion Slack vérifiée",
    slackDisconnectedToast: "Slack déconnecté",
    disconnectSlackTitle: "Déconnecter Slack ?",
    disconnectSlackDescription:
      "Clips supprimera le token bot stocké pour {{team}} et cessera d’envoyer des aperçus Slack lisibles.",
    thisWorkspace: "cet espace",
  },
};

export default messages;
