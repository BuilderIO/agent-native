const messages = {
  root: {
    commandActions: "Actions",
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
    extensions: "Extensions",
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
    suggestionShipped: "What shipped in the last week?",
    suggestionUi: "What does the new checkout UI look like?",
    suggestionAuth: "When did the auth API change?",
    suggestionApi: "What is the shape of the billing API?",
    emptyState: "Ask Plan",
    placeholder:
      "Ask what shipped, what changed, or what the current code shows...",
    heading: "Ask Plan",
    description:
      "Search merged PR recaps, inspect visual blocks, and publish code answers as diagrams, wireframes, API specs, and data models.",
  },
  guest: {
    banner:
      "You're browsing as a guest. Sign in to create plans, leave comments, and keep your work.",
    signIn: "Sign in",
  },
};

export default messages;
