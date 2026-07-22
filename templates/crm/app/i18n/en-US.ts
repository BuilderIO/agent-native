const messages = {
  intelligence: {
    title: "Intelligence",
    description:
      "Choose the moments CRM should notice in bounded call evidence. Smart trackers are evaluated through Ask CRM, never directly in the settings screen.",
    loading: "Loading trackers…",
    kindKeyword: "Keyword",
    kindSmart: "Smart",
    enable: "Enable",
    disable: "Disable",
    toggleTracker: "{{action}} {{name}}",
    emptyTitle: "No signal trackers yet",
    emptyDescription:
      "Add a keyword for deterministic matching or a smart criterion for Ask CRM to review.",
    trackerDeleted: "Tracker deleted.",
    trackerEnabled: "Tracker enabled.",
    trackerDisabled: "Tracker disabled.",
    trackerUpdateFailed: "Tracker update failed.",
    trackerCreated: "Tracker created.",
    trackerCreationFailed: "Tracker creation failed.",
    newTracker: "New tracker",
    createTitle: "Create signal tracker",
    createDescription:
      "Track deterministic keywords or define a bounded smart criterion for Ask CRM to evaluate against call evidence.",
    name: "Name",
    trackerDescription: "Description",
    detector: "Detector",
    keywords: "Keywords",
    keywordsPlaceholder: "pricing, renewal, security review",
    keywordsHelp: "Separate up to 40 keywords with commas.",
    classificationCriterion: "Classification criterion",
    criterionPlaceholder: "Match a clear concern about implementation timing.",
    creating: "Creating…",
    create: "Create tracker",
    deleteTrackerAria: "Delete {{name}}",
    deleteTrackerTitle: "Delete {{name}}?",
    deleteTrackerDescription:
      "This stops future signal runs from using this tracker. Existing reviewed signals stay unchanged.",
    cancel: "Cancel",
    deleteTracker: "Delete tracker",
    keywordsSummary: "Keywords: {{keywords}}",
    noKeywordsConfigured: "No keywords configured.",
    evaluatedThroughAsk: "Evaluated through Ask CRM.",
  },
  recordActions: {
    evidenceAttached: "Call evidence attached.",
    evidenceAttachFailed: "Evidence could not be attached.",
    addEvidence: "Add evidence",
    attachEvidenceTitle: "Attach Clips evidence",
    attachEvidenceDescription:
      "Use a durable Clips page link. CRM stores only the artifact reference, page URL, and a bounded excerpt—never media or a transcript.",
    artifactId: "Artifact ID",
    clipsUrl: "Clips URL",
    summary: "Summary",
    shortExcerpt: "Short excerpt",
    attachEvidence: "Attach evidence",
    automate: "Automate",
    reviewNewClipsCalls: "Review new Clips calls",
    reviewDescription:
      "Prepare a review recipe for this CRM record without copying Clips media or transcripts.",
    disabledAutomationDescription:
      "This starts disabled and stays tied to {{name}}. Once explicitly activated, each new clip may attach only its access-checked recording-page reference to this record.",
    handoffDescription:
      "The handoff keeps only an opaque clip ID, a durable {{path}} page URL, and capture time. It rejects event URLs, media, access tokens, transcripts, inferred records, and provider writes.",
    manageAutomations: "Manage automations",
    configureWithAgent: "Configure with agent",
  },
  dashboard: {
    metaTitle: "Pipeline · CRM",
    pipeline: "Pipeline",
    ready: "Pipeline dashboard is ready.",
    installFailed: "Pipeline dashboard could not be installed.",
    loadingDescription: "Loading your access-scoped pipeline dashboard…",
    emptyDescription:
      "A live, permission-aware view of opportunity value by stage.",
    installTitle: "Install the Pipeline dashboard",
    installDescription:
      "It creates a CRM-owned data program and a private dashboard for your current workspace.",
    installAction: "Install Pipeline dashboard",
    liveDescription:
      "Live opportunity totals use the current viewer’s CRM access and refresh from a cached data program.",
    updating: "Updating…",
    updatePack: "Update pack",
  },
};

export const crmDashboardMetaTitle = messages.dashboard.metaTitle;

export default messages;
