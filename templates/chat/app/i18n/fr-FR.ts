const messages = {
  composer: {
    removeAttachment: "Supprimer {{name}}",
    removeReference: "Supprimer la référence {{name}}",
  },
  settings: {
    title: "Paramètres",
    workspaceTitle: "Espace de travail",
    workspaceDescription:
      "Gérez les membres, l’accès de l’organisation et les préférences partagées.",
    openTeamSettings: "Ouvrir les paramètres d’équipe",
    openResourceSettings: "Ouvrir les paramètres des ressources",
    agentTitle: "Gérer l’agent",
    agentDescription:
      "Gérez le modèle de l’agent, les clés API, les automatisations, la voix et les autres contrôles.",
    openAgentSettings: "Gérer l’agent",
  },
  chat: {
    archiveChat: "Archiver le chat",
    archiveFailed: "Échec de l’archivage",
    chats: "Discussions",
    composerPlaceholder: "Demandez à l’agent...",
    emptyState: "Posez-moi une question",
    heroDescription:
      "Demandez à l’agent d’inspecter, d’expliquer ou de modifier cette app.",
    heroTitle: "Comment puis-je aider ?",
    inspectEmptyState: "Posez-moi une question sur cette app",
    inspectSuggestionAction: "Afficher les actions disponibles",
    inspectSuggestionCapabilities: "Que peut faire cette app ?",
    inspectSuggestionHello: "Aidez-moi à démarrer",
    newChat: "Nouveau chat",
    optionsFor: "Options pour",
    pinChat: "Épingler le chat",
    pinned: "Épinglés",
    recents: "Récents",
    retryPreviousRequest:
      "Réessaie ma demande précédente maintenant que le fournisseur du modèle est connecté.",
    invalidHandoffOptions:
      "Le prompt a été enregistré comme brouillon, mais ses paramètres de chat n'ont pas pu être restaurés. Vérifiez le prompt, le contexte et le modèle avant de le renvoyer.",
    recoveryDraftUnsaved:
      "Ces modifications du brouillon ne sont pas enregistrées. Si vous rechargez cette conversation, vous risquez de les perdre.",
    retryAttachmentUnavailable:
      "Chat ne peut pas rouvrir cette pièce jointe pour réessayer. Ajoutez une URL de fichier accessible, puis réessayez.",
    renameChat: "Renommer le chat",
    renameFailed: "Échec du renommage",
    renameThread: "Renommer le fil",
    suggestionActions: "Montrez-moi les actions disponibles",
    suggestionCapabilities: "Que peut faire cette app ?",
    suggestionCustomize: "Aidez-moi à personnaliser cette app",
    unpinChat: "Désépingler le chat",
    untitledChat: "Chat sans titre",
  },
  home: {
    communityDescription: "Rejoignez la communauté Agent-Native",
    composerPlaceholder: "Appelle l’action hello pour Alex",
    communityTitle: "Rejoignez-nous",
    docsAddAction: "Ajouter une action",
    docsAddPage: "Ajouter une page",
    docsDescription: "Guides sur les actions, les pages et les agents",
    docsGettingStarted: "Premiers pas",
    docsKeyConcepts: "Concepts clés",
    docsTitle: "Documentation",
    editHint:
      "Modifiez {{file}}, enregistrez, puis redemandez pour voir le nouveau message.",
    lead: "L’interface de votre app et son agent partagent les mêmes actions.",
    leadTry: "Demandez à l’agent d’appeler l’action hello.",
    llmSetupLink: "Configurer une clé LLM pour toute l’app",
    title: "Commencer",
  },
  navigation: {
    chat: "Chat",
    collapseSidebar: "Réduire la barre latérale",
    database: "Base de données",
    expandSidebar: "Développer la barre latérale",
    extensions: "Rallonges",
    home: "Accueil",
    navigation: "Navigation",
    navigationDescription: "Navigation principale",
    observability: "Observabilité",
    openNavigation: "Ouvrir la navigation",
    settings: "Paramètres",
    team: "Équipe",
  },
  pages: {
    databaseTitle: "Base de données",
    observabilityPageTitle: "Observabilité de l'agent",
    teamTitle: "Équipe",
    teamCreateOrgDescription:
      "Créez une organisation pour inviter des coéquipiers et partager cette app.",
  },
  root: {
    commandActions: "Opérations",
    commandAppearance: "Apparence",
    commandSearch: "Rechercher",
    toggleTheme: "Changer de thème",
  },
};

export default messages;
