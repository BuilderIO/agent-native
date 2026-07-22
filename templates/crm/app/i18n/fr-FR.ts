const messages = {
  intelligence: {
    title: "Intelligence",
    description:
      "Choisissez les moments que le CRM doit repérer dans des preuves d’appel limitées. Les détecteurs intelligents sont évalués avec Ask CRM, jamais directement dans cet écran.",
    loading: "Chargement des détecteurs…",
    kindKeyword: "Mot-clé",
    kindSmart: "Intelligent",
    enable: "Activer",
    disable: "Désactiver",
    toggleTracker: "{{action}} {{name}}",
    emptyTitle: "Aucun détecteur de signal pour le moment",
    emptyDescription:
      "Ajoutez un mot-clé pour une correspondance déterministe ou un critère intelligent à examiner par Ask CRM.",
    trackerDeleted: "Détecteur supprimé.",
    trackerEnabled: "Détecteur activé.",
    trackerDisabled: "Détecteur désactivé.",
    trackerUpdateFailed: "La mise à jour du détecteur a échoué.",
    trackerCreated: "Détecteur créé.",
    trackerCreationFailed: "La création du détecteur a échoué.",
    newTracker: "Nouveau détecteur",
    createTitle: "Créer un détecteur de signal",
    createDescription:
      "Suivez des mots-clés déterministes ou définissez un critère intelligent limité à évaluer par Ask CRM sur les preuves d’appel.",
    name: "Nom",
    trackerDescription: "Description",
    detector: "Détecteur",
    keywords: "Mots-clés",
    keywordsPlaceholder: "tarification, renouvellement, examen de sécurité",
    keywordsHelp: "Séparez jusqu’à 40 mots-clés par des virgules.",
    classificationCriterion: "Critère de classification",
    criterionPlaceholder:
      "Relevez une préoccupation claire concernant le délai de mise en œuvre.",
    creating: "Création…",
    create: "Créer le détecteur",
    deleteTrackerAria: "Supprimer {{name}}",
    deleteTrackerTitle: "Supprimer {{name}} ?",
    deleteTrackerDescription:
      "Les futures exécutions de signaux n’utiliseront plus ce détecteur. Les signaux déjà examinés restent inchangés.",
    cancel: "Annuler",
    deleteTracker: "Supprimer le détecteur",
    keywordsSummary: "Mots-clés : {{keywords}}",
    noKeywordsConfigured: "Aucun mot-clé configuré.",
    evaluatedThroughAsk: "Évalué avec Ask CRM.",
  },
  recordActions: {
    evidenceAttached: "Preuve d’appel jointe.",
    evidenceAttachFailed: "Impossible de joindre la preuve.",
    addEvidence: "Ajouter une preuve",
    attachEvidenceTitle: "Joindre une preuve Clips",
    attachEvidenceDescription:
      "Utilisez un lien de page Clips durable. Le CRM ne stocke que la référence de l’artefact, l’URL de la page et un extrait limité, jamais de média ni de transcription.",
    artifactId: "ID de l’artefact",
    clipsUrl: "URL Clips",
    summary: "Résumé",
    shortExcerpt: "Court extrait",
    attachEvidence: "Joindre la preuve",
    automate: "Automatiser",
    reviewNewClipsCalls: "Examiner les nouveaux appels Clips",
    reviewDescription:
      "Préparez une recette d’examen pour cet enregistrement CRM sans copier de média ni de transcription Clips.",
    disabledAutomationDescription:
      "Cette automatisation commence désactivée et reste liée à {{name}}. Une fois explicitement activée, chaque nouveau clip ne peut joindre à cet enregistrement que sa référence de page d’enregistrement dont l’accès est vérifié.",
    handoffDescription:
      "Le transfert ne conserve qu’un ID de clip opaque, une URL de page {{path}} durable et l’heure de capture. Il rejette les URL d’événement, les médias, les jetons d’accès, les transcriptions, les enregistrements déduits et les écritures fournisseur.",
    manageAutomations: "Gérer les automatisations",
    configureWithAgent: "Configurer avec l’agent",
  },
  dashboard: {
    metaTitle: "Entonnoir · CRM",
    pipeline: "Entonnoir",
    ready: "Le tableau de bord du pipeline est prêt.",
    installFailed: "Le tableau de bord du pipeline n’a pas pu être installé.",
    loadingDescription:
      "Chargement de votre tableau de bord de pipeline à accès limité…",
    emptyDescription:
      "Une vue en direct, tenant compte des autorisations, de la valeur des opportunités par étape.",
    installTitle: "Installer le tableau de bord du pipeline",
    installDescription:
      "Cette opération crée un programme de données appartenant au CRM et un tableau de bord privé pour votre espace de travail actuel.",
    installAction: "Installer le tableau de bord du pipeline",
    liveDescription:
      "Les totaux d’opportunités en direct utilisent l’accès CRM du lecteur actuel et sont actualisés depuis un programme de données en cache.",
    updating: "Mise à jour…",
    updatePack: "Mettre à jour le pack",
  },
};

export default messages;
