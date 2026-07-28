const messages = {
  common: {
    cancel: "Annuler",
    delete: "Supprimer",
    add: "Ajouter",
    noneSelected: "Aucune sélection",
    closePanel: "Fermer le panneau",
    editTitleAriaLabel: "Modifier le titre",
    rowActionsAriaLabel: "Actions pour {{title}}",
    reorderAriaLabel: "Réorganiser {{title}}",
    removeAriaLabel: "Retirer {{label}}",
    showAll: "Tout afficher",
    markReady: "Marquer comme prêt",
  },
  sidebar: {
    navInbox: "Boîte de réception",
    navTasks: "Tâches",
    navFields: "Champs",
    collapseSidebar: "Réduire la barre latérale",
    expandSidebar: "Développer la barre latérale",
    navigationTitle: "Navigation",
    navigationDescription: "Liens de navigation de l'application",
  },
  header: {
    openNavigation: "Ouvrir la navigation",
    pageTasks: "Tâches",
    pageSettings: "Paramètres",
    pageTeam: "Équipe",
    pageExtension: "Extension",
    pageExtensions: "Extensions",
  },
  agent: {
    emptyState:
      "Demandez à l'agent d'inspecter ou de modifier cette application.",
    suggestionCalendar:
      "Vérifie mon calendrier et mes e-mails : ai-je des tâches pour aujourd'hui ?",
    suggestionPrioritize: "Priorise mes tâches",
    suggestionCleanHouse:
      "Je dois nettoyer ma maison, crée une liste de tâches pour ça",
  },
  team: {
    createOrgDescription:
      "Créez une équipe pour partager cette application avec vos collègues.",
  },
  tasks: {
    pageTitle: "Tâches",
    pageDescription:
      "Gérez votre liste de tâches, glissez-déposez pour la réorganiser ou demandez au chat d'ajouter des rappels.",
    loadError: "Échec du chargement des tâches.",
    allCompleteHeading: "Toutes les tâches sont terminées",
    allCompleteDescription:
      "Activez Tout afficher pour revoir les tâches terminées.",
    emptyHeading: "Aucune tâche pour le moment",
    emptyDescription:
      "Ajoutez-en une ci-dessus ou demandez au chat d'en créer une pour vous.",
    listAriaLabel: "Liste des tâches",
    bulkDeleteError: "Impossible de supprimer les tâches sélectionnées.",
    entitySingular: "tâche",
    entityPlural: "tâches",
    taskColumnHeader: "Tâche",
    visibleTaskFieldsAriaLabel: "Champs visibles de la tâche",
    markCompleteAriaLabel: "Marquer {{title}} comme terminée",
    markIncompleteAriaLabel: "Marquer {{title}} comme non terminée",
    addPlaceholder: "Ajouter une tâche...",
    addButtonLabel: "Ajouter une tâche",
    addInputAriaLabel: "Titre de la nouvelle tâche",
    addErrorMessage: "Échec de la création de la tâche. Veuillez réessayer.",
  },
  inbox: {
    pageTitle: "Boîte de réception",
    pageDescription:
      "Notez ici vos idées brutes, puis marquez-les comme prêtes lorsqu'elles deviennent des tâches.",
    loadError: "Échec du chargement des éléments de la boîte de réception.",
    emptyHeading: "La boîte de réception est vide",
    emptyDescription:
      "Ajoutez un élément ci-dessus ou demandez au chat de noter quelque chose à trier.",
    listAriaLabel: "Liste de la boîte de réception",
    bulkDeleteError:
      "Impossible de supprimer les éléments sélectionnés de la boîte de réception.",
    entitySingular: "élément de la boîte de réception",
    entityPlural: "éléments de la boîte de réception",
    addPlaceholder: "Ajouter à la boîte de réception...",
    addButtonLabel: "Ajouter un élément",
    addInputAriaLabel: "Titre du nouvel élément de la boîte de réception",
    addErrorMessage:
      "Échec de l'ajout de l'élément à la boîte de réception. Veuillez réessayer.",
  },
  fields: {
    pageTitle: "Champs",
    pageDescription:
      "Définissez les champs réutilisables que chaque tâche peut renseigner.",
    loadError: "Échec du chargement des champs.",
    emptyHeading: "Aucun champ pour le moment",
    emptyDescription:
      "Créez un champ ci-dessus pour commencer à structurer vos tâches.",
    listAriaLabel: "Liste des champs",
    createdToast: "Champ créé.",
    createError: "Impossible de créer le champ.",
    deletedToast: "{{title}} supprimé.",
    deletedWithValuesToast:
      "{{title}} et {{count}} valeurs de tâches supprimés.",
    deleteError: "Impossible de supprimer le champ.",
    taskCardFieldsLabel: "Champs de la fiche de tâche",
    addFieldButtonLabel: "Ajouter un champ",
    noFieldsSelectedLabel: "Aucun champ sélectionné",
    entitySingular: "champ",
    deleteFieldDescription:
      "Cette action supprime le champ et ses valeurs de toutes les tâches.",
    deleteFieldDescriptionWithTitle:
      'Cette action supprime "{{title}}" et ses valeurs de toutes les tâches.',
    deleteFieldAriaLabel: "Supprimer {{title}}",
    createNewFieldHeading: "Créer un nouveau champ",
    fieldTitleLabel: "Titre du champ",
    newFieldTitlePlaceholder: "Titre du nouveau champ",
    fieldTypeAriaLabel: "Type de champ",
    createButton: "Créer",
    currencyDescription: "Devise {{symbol}}",
    decimalsDescription: "{{count}} décimales",
    positiveOnlySuffix: "positifs uniquement",
    optionsCountDescription: "{{count}} options",
    types: {
      text: "Texte",
      richText: "Texte enrichi",
      number: "Nombre",
      percent: "Pourcentage",
      currency: "Devise",
      singleSelect: "Sélection unique",
      multiSelect: "Sélection multiple",
      date: "Date",
    },
  },
  fieldEditor: {
    panelTitle: "Champ",
    closeLabel: "Fermer l'éditeur de champ",
    updateError: "Impossible de mettre à jour le champ.",
    titleLabel: "Titre",
    requiredLabel: "Obligatoire",
    editFieldTitleAriaLabel: "Modifier le titre du champ",
    symbolLabel: "Symbole",
    precisionLabel: "Précision",
    positiveOnlyLabel: "Nombres positifs uniquement",
    optionsLabel: "Options",
    optionNameAriaLabel: "Nom de l'option {{index}}",
    optionColorAriaLabel: "Couleur de l'option {{name}}",
    removeOptionAriaLabel: "Retirer {{name}}",
    newOptionName: "Option {{index}}",
    addOptionButton: "Ajouter une option",
    colors: {
      red: "Rouge",
      orange: "Orange",
      yellow: "Jaune",
      green: "Vert",
      blue: "Bleu",
      purple: "Violet",
      pink: "Rose",
      gray: "Gris",
    },
  },
  taskFields: {
    panelTitle: "Champs",
    panelSubtitle: "Détails de la tâche",
    closeLabel: "Fermer le panneau des champs",
    updateError: "Impossible de mettre à jour la tâche.",
    noFieldsDefined: "Aucun champ défini.",
    titleLabel: "Titre",
    taskBadge: "Tâche",
    editTaskTitleAriaLabel: "Modifier le titre de la tâche",
    noneOption: "Aucun",
    toolBold: "Gras",
    toolItalic: "Italique",
    toolHeading: "Titre",
    toolBulletedList: "Liste à puces",
    toolNumberedList: "Liste numérotée",
    toolLink: "Lien",
  },
  selection: {
    select: "Sélectionner",
    doneSelecting: "Terminer la sélection",
    selectAll: "Tout sélectionner",
    clearAll: "Tout désélectionner",
    exitSelectionMode: "Quitter le mode sélection",
    markComplete: "Marquer comme terminée",
    markIncomplete: "Marquer comme non terminée",
    completeLabel: "Terminée",
    incompleteLabel: "Non terminée",
    selectedCount: "{{count}} sélectionné(s)",
    selectedCountReorder: "{{count}} sélectionné(s) · glisser pour réorganiser",
    tapToSelectTasks: "Touchez les tâches pour les sélectionner.",
    tapToSelectItems: "Touchez les éléments pour les sélectionner.",
    taskSelectionActionsAriaLabel: "Actions de sélection des tâches",
    inboxSelectionActionsAriaLabel:
      "Actions de sélection de la boîte de réception",
    couldNotMarkReady:
      "Impossible de marquer les éléments sélectionnés comme prêts.",
    couldNotUpdateTasks:
      "Impossible de mettre à jour les tâches sélectionnées.",
    markedReadyOne: "{{count}} élément marqué comme prêt",
    markedReadyOther: "{{count}} éléments marqués comme prêts",
    allTasksAlreadyComplete:
      "Toutes les tâches sélectionnées sont déjà terminées.",
    allTasksAlreadyIncomplete:
      "Toutes les tâches sélectionnées sont déjà non terminées.",
    markedDone: "{{count}} {{unit}} marquée(s) comme terminée(s)",
    markedDoneWithSkipped:
      "{{count}} {{unit}} marquée(s) comme terminée(s) ({{skipped}} déjà terminée(s))",
    markedNotDone: "{{count}} {{unit}} marquée(s) comme non terminée(s)",
    markedNotDoneWithSkipped:
      "{{count}} {{unit}} marquée(s) comme non terminée(s) ({{skipped}} déjà non terminée(s))",
  },
  dialogs: {
    deleteEntityTitle: "Supprimer {{entity}} ?",
    deleteItemDescription: "Cette action supprime {{entity}} définitivement.",
    deleteItemDescriptionWithTitle:
      'Cette action supprime "{{title}}" définitivement.',
    bulkDeleteDescriptionOne:
      "Cette action supprime définitivement {{entity}} sélectionné.",
    bulkDeleteDescriptionOther:
      "Cette action supprime définitivement les {{count}} {{entity}} sélectionnés.",
    andMore: "et {{count}} autres",
    deletedCount: "{{count}} {{entity}} supprimé(s)",
  },
};

export default messages;
