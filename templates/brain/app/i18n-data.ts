import type { LocaleCode } from "@agent-native/core/client";

import zhTW from "./i18n/zh-TW";

const enUS = {
  common: {
    saving: "Saving",
    saveChanges: "Save changes",
    saved: "Saved",
  },
  routeTitles: {
    extension: "Extension - Brain",
    extensions: "Extensions - Brain",
    team: "Team - Brain",
  },
  team: {
    title: "Team",
    createOrgDescription:
      "Set up a team to share Brain sources, reviewed knowledge, and settings with your colleagues.",
  },
  canonicalPreview: {
    title: "Company context preview",
    publishIntent:
      "Review the exact Markdown Brain will mirror into workspace context.",
    unpublishIntent:
      "Review the Markdown Brain manages before removing this workspace context resource.",
    pathSuffixAssigned: "Path suffix assigned on approval",
    currentlyPublished: "Currently published",
    workspacePath: "Workspace path",
    markdownPreviewLabel: "Canonical company context Markdown preview",
    building: "Building Markdown preview...",
    empty:
      "Open a proposal or knowledge item to preview its canonical Markdown.",
    cancel: "Cancel",
  },
  root: {
    commandNavigate: "Navigate",
    commandAppearance: "Appearance",
    toggleTheme: "Toggle theme",
  },
  navigation: {
    brand: "Brain",
    ask: "Ask",
    askBrain: "Ask Brain",
    search: "Search",
    knowledge: "Knowledge",
    review: "Review",
    reviewQueue: "Review queue",
    sources: "Sources",
    ops: "Ops",
    extensions: "Extensions",
    settings: "Settings",
    openNavigation: "Open navigation",
    brainNavigation: "Brain navigation",
    brainNavigationDescription: "Navigate between Brain work surfaces.",
  },
  settings: {
    agentTitle: "Agent settings",
    agentDescription:
      "Open the agent sidebar settings for model, API keys, automations, voice, and other agent controls.",
    openAgentSettings: "Open agent settings",
    eyebrow: "Customize",
    title: "Customize Brain",
    description:
      "Name the assistant, shape its voice, and set the policies it follows when turning company sources into knowledge.",
    languageTitle: "Language",
    languageDescription: "Choose the interface language for Brain.",
    languageLabel: "Interface language",
    currentPolicy: "Current Policy",
    currentPolicyDescription:
      "The effective settings saved for this Brain workspace.",
    identityTitle: "Identity",
    identityDescription:
      "The names Brain uses when it describes itself and the workspace it is protecting.",
    companyName: "Company name",
    assistantName: "Assistant name",
    assistantBehaviorTitle: "Assistant behavior",
    assistantBehaviorDescription:
      "The default voice and source posture for answers and distilled knowledge proposals.",
    toneLabel: "Tone",
    sourcePolicyLabel: "Source policy",
    tone: {
      direct: {
        label: "Direct",
        description: "Concise, concrete, and decision-oriented.",
      },
      friendly: {
        label: "Friendly",
        description: "Warm and plainspoken without losing precision.",
      },
      formal: {
        label: "Formal",
        description: "Careful, policy-ready, and executive-facing.",
      },
      technical: {
        label: "Technical",
        description: "Detailed, source-heavy, and implementation-aware.",
      },
    },
    sourcePolicy: {
      strict: {
        label: "Strict",
        description: "Answer from approved knowledge and citations only.",
      },
      balanced: {
        label: "Balanced",
        description: "Prefer approved knowledge, then identify source gaps.",
      },
      exploratory: {
        label: "Exploratory",
        description: "Use weaker signals but label uncertainty clearly.",
      },
    },
    coreInstructions: "Core instructions",
    coreInstructionsDescription:
      "Guidance for turning raw captures into durable institutional knowledge.",
    publishingReviewTitle: "Publishing and review",
    publishingReviewDescription:
      "Defaults for visibility, approval, and connector cadence.",
    defaultPublishTier: "Default publish tier",
    defaultPublishTierDescription:
      "Sets the default visibility for newly distilled knowledge.",
    publishTier: {
      private: "Private",
      team: "Team",
      company: "Company",
    },
    connectorPollInterval: "Connector poll interval",
    requireApproval: "Require approval for company knowledge",
    requireApprovalDescription:
      "Queue company-wide knowledge candidates for human review before publishing.",
    autoArchiveResolved: "Auto-archive resolved review items",
    autoArchiveResolvedDescription:
      "Remove approved or rejected queue items from the active review lane.",
    safetyEvidenceTitle: "Safety and evidence",
    safetyEvidenceDescription:
      "Redaction and citation rules for answers that leave the review queue.",
    sanitizeCaptures: "Sanitize transcript captures before storage",
    sanitizeCapturesDescription:
      "Filter Granola, Clips, webhook, and manual transcript imports down to company-relevant content before saving.",
    sanitizationModel: "Sanitization model",
    sanitizationModelPlaceholder:
      "Default agent model or a cheaper flash model",
    sanitizationModelDescription:
      "Optional override for the pre-save filtering pass.",
    sanitizationInstructions: "Sanitization instructions",
    autoRedactEmails: "Auto-redact emails",
    autoRedactEmailsDescription:
      "Remove email addresses from distilled knowledge unless they are essential evidence.",
    requireCitations: "Require citations",
    requireCitationsDescription:
      "Ask Brain must cite approved source rows for factual answers.",
    notifySourceErrors: "Notify on source errors",
    notifySourceErrorsDescription:
      "Surface degraded or failing connectors in the review flow.",
    policy: {
      assistant: "Assistant",
      company: "Company",
      tone: "Tone",
      sources: "Sources",
      publishTier: "Publish tier",
      approval: "Approval",
      redaction: "Redaction",
      preSaveFilter: "Pre-save filter",
    },
    notSet: "Not set",
    required: "Required",
    notRequired: "Not required",
    enabled: "Enabled",
    disabled: "Disabled",
    autoPublishGateTitle: "Auto-publish gate",
    autoPublishGateDescription: "Runtime policy for company-tier knowledge.",
    confidenceThreshold: "Confidence threshold",
    autoPublishGateDetail:
      "High-confidence company knowledge can publish automatically when it is new, unredacted, and does not require an explicit proposal.",
    actionsUnavailableTitle: "Settings actions are not available yet",
    actionsUnavailableDetail:
      "This page is wired to get-brain-settings and update-brain-settings and is using defaults for now.",
    numberFieldRange: "Must be between {{min}} and {{max}} minutes.",
  },
  review: {
    eyebrow: "Review",
    title: "Proposal review",
    description:
      "Approve only the proposed memories that have durable value, source support, and the right privacy posture.",
    pendingProposals: "Pending proposals",
    approvedProposals: "Approved proposals",
    rejectedProposals: "Rejected proposals",
    summary: "{{label}}: {{count}} {{itemLabel}} shown",
    item: "item",
    items: "items",
    status: "Status",
    pending: "Pending",
    approved: "Approved",
    rejected: "Rejected",
    cardAria:
      "{{title}}. Press A to approve, R to reject, or S to save wording changes.",
    reviewerQueue: "Reviewer queue",
    unsavedEdits: "Unsaved edits",
    noProposedKnowledge: "No proposed knowledge.",
    fieldTitle: "Title",
    proposedKnowledge: "Proposed knowledge",
    rationale: "Rationale",
    rationalePlaceholder: "Why this should become durable knowledge",
    reviewerNotes: "Reviewer notes",
    reviewerNotesPlaceholder: "Optional context for this decision",
    publishCompanyContext: "Publish as company context",
    preview: "Preview",
    approvalSavesEdits: "Approval saves wording edits first.",
    reviewGuidance:
      "Approve durable, sourced memories; reject anything too narrow or uncertain.",
    saveWording: "Save wording",
    reject: "Reject",
    emptyTitle: "No {{status}} proposals",
    emptyDetail:
      "New source captures appear here when Brain needs a reviewer before turning them into company knowledge.",
    actionFailedTitle: "Review action failed",
    actionFailedDetail: "Brain could not load or update proposals.",
    approveAndPublish: "Approve and publish",
    notRecorded: "Not recorded",
    rule: "rule",
    rules: "rules",
    target: {
      mergeUpdateSupersede: "Merge update and supersede",
      mergeUpdateSupersedeDetail:
        "Updates {{knowledgeId}} and archives {{supersedesId}}.",
      mergeExisting: "Merge into existing knowledge",
      mergeExistingDetail: "Approving applies this wording to {{knowledgeId}}.",
      supersedeExisting: "Supersede existing knowledge",
      supersedeExistingDetail:
        "Approving creates a replacement and archives {{supersedesId}}.",
      archiveKnowledge: "Archive knowledge",
      archiveKnowledgeDetail:
        "Approving marks the target knowledge as archived.",
      createNew: "Create new knowledge",
      createNewDetail: "Approving adds a new durable company knowledge entry.",
    },
    privacy: {
      redactedContent: "Redacted content",
      redactionRules: "{{count}} redaction {{ruleLabel}}",
      companyTierKnowledge: "Company-tier knowledge",
      publishTier: "{{tier}} publish tier",
      visibility: "{{visibility}} visibility",
      canonicalExport: "Canonical export",
      noPrivacyFlags: "No privacy flags",
    },
    queueReason: {
      privacySensitive:
        "Privacy-sensitive or redacted content needs reviewer confirmation.",
      lowConfidence:
        "Confidence is {{confidence}}, below the auto-publish threshold.",
      companyTier: "Company-tier knowledge requires reviewer approval.",
      default:
        "Queued for reviewer approval before becoming durable company knowledge.",
    },
    approveRedactedDraft: "Approve redacted draft",
    approveReplacement: "Approve replacement",
    approveUpdate: "Approve update",
    approveKnowledge: "Approve knowledge",
    noFlags: "No flags",
    noPrivacyDetail:
      "No redaction, export, or visibility warning was attached.",
    reviewBeforeApproving: "Review before approving.",
    notScored: "Not scored",
    reviewer: "reviewer",
    reviewedSummary: "{{status}} {{date}} by {{reviewer}}.",
    proposalStatusSummary: "This proposal is {{status}}.",
    signal: {
      target: "Target",
      privacy: "Privacy",
      evidence: "Evidence",
    },
    snippetCount: "{{count}} {{snippetLabel}}",
    snippet: "snippet",
    snippets: "snippets",
    noSnippets: "No snippets",
    companyContext: "Company context",
    moreActions: "More review actions",
    hideEditor: "Hide editor",
    editWording: "Edit wording",
    previewCompanyContext: "Preview company context",
    openSource: "Open source",
    capturedSource: "Captured source",
    atTime: "at {{time}}",
    evidenceQuoteUnavailable: "Evidence quote unavailable",
    detailsButton: "Details",
    details: {
      source: "Source",
      capture: "Capture",
      knowledgeTarget: "Knowledge target",
      supersedes: "Supersedes",
      visibility: "Visibility",
      updated: "Updated",
      kind: "Kind",
      topic: "Topic",
      publishTier: "Publish tier",
      resultStatus: "Result status",
      tags: "Tags",
      summary: "Summary",
    },
    reviewSignals: "Review signals",
    whyQueued: "Why queued",
    targetContext: "Target context",
    privacyFlags: "Privacy flags",
    confidence: "Confidence",
    targetAndPayload: "Target and payload",
    draftChanges: "Draft changes",
    queuedProposal: "Queued proposal",
    knowledgeBody: "Knowledge body",
    evidence: "Evidence",
    noSourceSnippets: "No source snippets were attached to this proposal.",
    edited: "Edited",
    queued: "Queued",
    currentDraft: "Current draft",
    current: "Current",
  },
  sources: {
    eyebrow: "Sources",
    title: "Source configuration",
    description:
      "Connect approved places Brain can learn from, then sync and review them as needed.",
    advanced: "Advanced",
    addSource: "Add source",
    emptyTitle: "Connect Brain's first source",
    emptyDetail:
      "Add an approved Slack channel, Granola Team-space source, GitHub repo, Clips export, manual import, or signed webhook.",
    actionFailedTitle: "Source action failed",
    actionFailedDetail:
      "Check source credentials, channel allow-lists, and the latest sync error.",
    advancedTitle: "Advanced source controls",
    advancedDescription:
      "Filter sources, check connection readiness, and run maintenance syncs when the normal source list is not enough.",
    sourceType: "Source type",
    allSources: "All sources",
    runDueSyncs: "Run due syncs",
    reviewRawCaptures: "Review raw captures",
    captureInventoryDescription:
      "{{source}} inventory. Raw bodies stay hidden unless a reviewer enables previews.",
    reviewRawCapturesDescription:
      "Review imported raw material before distillation.",
    status: "Status",
    previews: "Previews",
    previewsDescription: "Show short snippets for intentional review",
    batchDistillation: "Batch distillation",
    batchDistillationDescription:
      "Select queueable captures and hand them to the Brain distillation worker together.",
    selectAll: "Select all",
    unselectAll: "Unselect all",
    queueSelected: "Queue selected",
    clear: "Clear",
    selectedCount: "{{count}} selected",
    queueableCount: "{{count}} queueable",
    bulkResult: "{{queued}} queued, {{existing}} existing, {{errors}} errors",
    captureInventoryFailedTitle: "Capture inventory failed",
    captureInventoryFailedDetail: "Check source access and try again.",
    selectCapture: "Select {{title}}",
    rawContentHidden:
      "Raw content hidden. Enable previews or open the source only when review requires context.",
    distillation: "Distillation",
    attempt: "attempt",
    attempts: "attempts",
    nextCheck: "Next check",
    waitingForWorker:
      "Waiting for the Brain distillation worker to write knowledge or send this capture to review.",
    source: "Source",
    ignore: "Ignore",
    noCapturesTitle: "No captures match this view",
    noCapturesDetail:
      "Try another status, run a source sync, or import a transcript.",
    tuneSource: "Tune source",
    setupDescription:
      "Configure what Brain may ingest. Credentials stay in the workspace credential store; this form only saves allow-lists, cursors, and review rules.",
    name: "Name",
    provider: "Provider",
    notRequired: "Not required",
    workspaceConnection: "Workspace connection",
    automaticCredentialSelection: "Automatic credential selection",
    boundConnectionDescription:
      "This source is bound to {{connection}}; sync will not fall back to another shared connection.",
    pickGrantedConnection:
      "Pick a granted connection to pin this source, or leave automatic to use the existing credential fallback.",
    grantConnectionBeforePinning:
      "Grant a workspace connection to Brain in Dispatch before pinning this source.",
    slackAccessRules: "Slack access rules",
    slackAccessRuleIds:
      "Use one approved channel ID or #name per line. IDs are safest for pilots; names are resolved before validation.",
    slackAccessRuleScopes:
      "Slack access should support auth.test, conversations.info/history, and chat.getPermalink. Add private-channel access when piloting private channels.",
    allowedChannels: "Allowed channels",
    allowedChannelsDescription:
      "Brain verifies the allow-list, rejects DMs/MPIMs, and never stores credential values in source config.",
    messagesPerPage: "Messages per page",
    pollMinutes: "Poll minutes",
    pageSize: "Page size",
    initialUpdatedAfter: "Initial updated-after",
    granolaDescription:
      "Granola Enterprise API returns Team-space notes; private notes are outside the API scope.",
    approvedRepositories: "Approved repositories",
    githubRepositoriesDescription:
      "Brain imports bounded issue and pull request context from these repositories using the workspace GitHub credential.",
    state: "State",
    all: "All",
    open: "Open",
    closed: "Closed",
    itemsPerRepo: "Items per repo",
    includeIssues: "Include issues",
    includePullRequests: "Include pull requests",
    webhookSourceKey: "Webhook source key",
    webhookSourceKeyDescription:
      "New sources receive a one-time ingest token. Existing sources keep their token unless rotated separately.",
    autoSync: "Auto-sync",
    autoSyncDescription: "Background polling uses this source when due",
    reviewRequired: "Review required",
    reviewRequiredDescription: "Queue extracted knowledge before approval",
    cancel: "Cancel",
    saveSource: "Save source",
    createSource: "Create source",
    retryAfter: "Retry after {{date}}",
    lastSyncFailed: "Last sync failed",
    nextSync: "Next sync {{date}}",
    waitingForFirstSync: "Waiting for first sync",
    manualSync: "Manual sync",
    queueDistill: "Queue distill",
    retryDistill: "Retry distill",
    captureStatus: {
      queued: "Queued",
      distilling: "Distilling",
      distilled: "Distilled",
      ignored: "Ignored",
      all: "All captures",
    },
    queueStatus: {
      processing: "Processing",
      done: "Done",
      failed: "Failed",
      queued: "Queued",
    },
    grantState: {
      connected: "Connected",
      granted: "Granted",
      needsGrant: "Needs grant",
      notConnected: "Not connected",
    },
    grantDetail: {
      connected: "{{count}} active connections granted to Brain",
      granted: "Brain can access {{count}} connections",
      needsGrant:
        "Connection exists in Dispatch; grant Brain access to reuse it",
      configuredSources: "{{count}} sources configured with scoped credentials",
      noSharedConnection: "No shared workspace connection yet",
    },
    providerHealth: {
      ready: "Ready",
      grantNeeded: "Grant needed",
      needsRepair: "Needs repair",
      missingKeys: "Missing keys",
      metadataOnly: "Metadata only",
      unknown: "Unknown",
    },
    appAccess: {
      allApps: "All apps",
      brainAllowList: "Brain allow-list",
      brainGrant: "Brain grant",
      needsBrainGrant: "Needs Brain grant",
    },
    workspaceStatus: {
      connected: "Connected",
      checking: "Checking",
      needsReauth: "Needs reauth",
      error: "Error",
      disabled: "Disabled",
    },
    sharedConnection: "Shared connection",
    brainAppGrant: "Brain app grant",
    credentialPath: "Credential path",
    providerConnection: "Provider connection",
    connectProvider: "Connect provider",
    connectionMetadataOnly: "Connection metadata only",
    readinessLabel: "Readiness",
    sharedWorkspaceConnectionReady: "Shared workspace connection ready",
    grantBrainAccess: "Grant Brain access",
    scopedCredentialsReady: "Scoped credentials ready",
    noCredentialRequired: "No credential required",
    connectTheProvider: "Connect the provider",
    connectionProviders: "Connection providers",
    connectionProvidersDescription:
      "Reuse workspace integrations, grant Brain access, or add Brain-local sources without exposing credential values.",
    loading: "Loading",
    providerCount: "{{count}} providers",
    loadingProviderCatalog: "Loading provider catalog...",
    noBrainSourcesYet: "No Brain sources yet",
    connectionReadiness: "Connection readiness",
    valuesHidden: "Values hidden",
    credentialRefs: "Credential refs",
    catalogKeys: "Catalog keys",
    noCredentialKeysRequired: "No credential keys required",
    slackSetupGuide: "Slack setup guide",
    slackSetupAllowList:
      "Allow-list approved channel IDs such as C0123456789, or channel names like #product when name resolution is acceptable.",
    slackSetupScopes:
      "Minimum scopes are channels:read and channels:history. Add groups:read and groups:history for private channels.",
    slackSetupPrivateChannels:
      "Invite the Slack app to private channels before syncing. DMs and MPIMs stay excluded.",
    required: "required",
    credentialProvenance: "Credential provenance",
    workspaceConnections: "Workspace connections",
    noCredentialRefs: "No credential refs on this connection",
    noSharedWorkspaceConnection:
      "No shared workspace connection has been registered for this provider yet.",
    connectionMetadataOnlyDetail:
      "Brain can reuse this connection metadata, but source setup for this provider has not been added to this template yet.",
    hideDetails: "Hide details",
    details: "Details",
    grantInDispatch: "Grant in Dispatch",
    noConnectionProviders:
      "No Brain connection providers are available from the shared catalog.",
    workspaceStatusUnavailable:
      "Workspace integration status is unavailable: {{error}}",
    brainHealth: "Brain health",
    healthReady:
      "Sources, review queue, and retrieval checks are ready for normal use.",
    healthHealthy: "{{healthy}}/{{total}} healthy",
    healthAttention: "{{count}} attention",
    lastSyncWithDate: "Last sync {{date}}",
    noSyncYet: "No sync yet",
    evalScore: "Eval {{score}}%",
    captures: "Captures",
    lastSync: "Last sync",
    never: "Never",
    coverage: "Coverage",
    moreActionsFor: "More actions for {{source}}",
    syncNow: "Sync now",
    provenance: {
      explicitBrainGrant: "explicit Brain grant",
      brainLocalCredential: "Brain-local credential",
      credentialVault: "Credential vault",
      credentialSource: "Credential source",
    },
    readiness: {
      workspaceNotLoaded: "Workspace connection status has not loaded yet.",
      activeConnections:
        "{{count}} active connections can provide credential refs.",
      repair: "Repair",
      grantNeedsAttention:
        "Brain has a grant, but the provider connection needs attention.",
      grantable: "Grantable",
      workspaceConnectionGrantable:
        "A workspace connection exists and can be granted to Brain.",
      scopedLocalCredentialRefs:
        "Brain can still use scoped local credential refs.",
      addReusableConnection: "Add a reusable provider connection in Dispatch.",
      grantedRepair: "Granted, repair",
      brainCanUseSharedConnection:
        "Brain can use the shared workspace connection.",
      accessGrantedConnectionInactive:
        "Access is granted, but the connection is not active yet.",
      needed: "Needed",
      grantExistingConnection:
        "Grant the existing provider connection to the Brain app.",
      notNeeded: "Not needed",
      noGrant: "No grant",
      scopedCredentialsAvailable:
        "Scoped Brain credentials are already available.",
      grantAppearsAfterConnection:
        "A grant appears after a workspace provider connection exists.",
      credentialNotLoaded: "Credential availability has not loaded yet.",
      noCredentialKeyRequired:
        "This provider does not require a credential key.",
      shared: "Shared",
      usingWorkspaceCredentialRefs:
        "Using workspace credential refs; values stay hidden.",
      brainLocal: "Brain-local",
      scopedCredentialRefsConfigured:
        "Scoped Brain credential refs are configured.",
      vault: "Vault",
      registeredCredentialRefAvailable:
        "A registered credential ref is available in the vault.",
      available: "Available",
      requiredCredentialRefsAvailable:
        "Required credential refs are available without exposing values.",
      missing: "Missing",
      addSharedOrScopedCredential:
        "Add a shared provider connection or scoped Brain credential.",
      sourceSetupNotImplemented:
        "Brain source setup is not implemented for this provider.",
      readyThroughSharedConnection:
        "Ready through a shared workspace connection.",
      readyThroughScopedRefs: "Ready through scoped Brain credential refs.",
      readyForSourceSetup: "Ready for source setup.",
      providerNeedsAppAccess:
        "The provider is connected, but Brain needs app access.",
      reauthorizeProviderConnection:
        "Reauthorize or repair the shared provider connection.",
      providerUnknown: "Provider readiness could not be determined.",
      reuseProviderConnection:
        "Brain can reuse the provider connection without showing values.",
      approveBrainAccess:
        "A workspace provider connection exists; approve Brain to use it.",
      local: "Local",
      localCredentialRefsAvailable:
        "Brain has local credential refs available; values stay hidden.",
      providerNoCredential:
        "This provider can be configured without a credential key.",
      connect: "Connect",
    },
    defaultTitle: {
      slack: "Slack knowledge channels",
      granola: "Granola team notes",
      github: "GitHub product repos",
      clips: "Clips exports",
      generic: "Generic transcript webhook",
      manual: "Manual imports",
    },
  },
  chat: {
    emptyState: "Ask Brain about the company.",
    suggestionSecurity: "What do we tell enterprise prospects about security?",
    suggestionStaleFacts: "Find stale onboarding facts that need review.",
    suggestionSyncProblems: "Which sources have sync problems?",
    chats: "Chats",
    newChat: "New chat",
    newBrainChat: "New Brain chat",
    renameChat: "Rename chat",
    pinChat: "Pin chat",
    unpinChat: "Unpin chat",
    archiveChat: "Archive chat",
    archiveFailed: "Could not archive chat.",
    renameFailed: "Could not rename chat.",
    renameThread: "Rename {{title}}",
    optionsFor: "Chat options for {{title}}",
  },
  ask: {
    emptyState: "Ask Brain about company knowledge.",
    composerPlaceholder: "Ask about company knowledge...",
    heroTitle: "What do you want to know?",
    heroDescription: "Brain answers from cited company knowledge.",
  },
  knowledge: {
    title: "Cited company knowledge",
    description:
      "Browse approved, stale, and review-bound memories with the source and confidence signal visible.",
    rows: "{{count}} rows",
    searchPlaceholder: "Search memories, topics, source names...",
    companyContext: "Company context",
    cites: "Cites",
    noSummary: "No summary yet.",
    owner: "Owner: {{owner}}",
    source: "source",
    notApplicable: "n/a",
    emptyTitle: "No company knowledge yet",
    emptyFilteredDetail:
      "Clear the search or filters to broaden the knowledge set.",
    emptyDetail:
      "Connect a source or approve review proposals to build company knowledge.",
    updateFailedTitle: "Company context update failed",
    updateFailedDetail:
      "Brain could not update the workspace context resource.",
    waitingOnSearch: "Waiting on search-knowledge",
    waitingOnSearchDetail:
      "Brain could not load reviewed company knowledge yet.",
    viewStateMirrored:
      "View state is mirrored to application-state as query, status, and source type filters.",
    publishCompanyContext: "Publish company context",
    unpublishCompanyContext: "Unpublish company context",
    notEligible: "Not eligible",
    publishedToContext: "Published to company context",
    publishToContextTitle: "Publish this knowledge to context/company-brain",
    published: "Published",
    publish: "Publish",
  },
  searchPage: {
    eyebrow: "Search",
    title: "Search company knowledge",
    description:
      "Search reviewed knowledge, raw captures, and source records, then open the cited Brain record or original source.",
    searching: "Searching",
    results: "{{count}} results",
    searchPlaceholder:
      "Search decisions, customer facts, source names, transcripts, or policy snippets...",
    type: "Type",
    source: "Source",
    status: "Status",
    limit: "Limit",
    allTypes: "All types",
    allSources: "All sources",
    allStatuses: "All statuses",
    reset: "Reset",
    unavailableTitle: "Search is unavailable",
    unavailableDetail:
      "Refresh the page and try again once Brain has finished loading.",
    noMatchesTitle: "No knowledge matches these filters",
    startTitle: "Start with a company knowledge search",
    noMatchesDetail: "Broaden the query or clear a filter.",
    startDetail: "Enter a phrase to search cited company knowledge.",
    noExcerpt: "No excerpt is available.",
    companyKnowledge: "Company knowledge",
    confidence: "Confidence",
    score: "Score",
    citation: "Citation",
    updated: "Updated",
    viewInBrain: "View in Brain",
    openSource: "Open source",
    details: "Details",
    whyMatched: "Why this matched",
    matchedIndex: "This result matched the current search index.",
    summary: "Summary",
    noSummary: "No summary is available for this result.",
    citationQuote: "Citation quote",
    noCitationQuote: "No citation quote is available.",
    provider: "Provider",
    notAvailable: "Not available",
    openSourceUrl: "Open source URL",
    openBrainRecord: "Open Brain record",
    openRelatedSource: "Open related source",
    inTheseResults: "In these results",
    untitledResult: "Untitled result",
  },
  ops: {
    allQueueItems: "All queue items",
    retryable: "Retryable",
    failed: "Failed",
    staleProcessing: "Stale processing",
    noRetryableFound: "No retryable distillation items found",
    retryFailed: "Retry failed",
    eyebrow: "Ops",
    title: "Distillation operations",
    description:
      "Monitor Brain distillation handoffs, stale workers, and retryable failures from one compact queue view.",
    status: "Status",
    allStatuses: "All statuses",
    queueIssue: "Queue issue",
    retryAllRetryable: "Retry all retryable",
    accessible: "{{count}} accessible",
    shownOf: "{{shown}} shown of {{total}}",
    queued: "Queued",
    processing: "Processing",
    stale: "stale",
    done: "Done",
    completed: "Completed",
    visible: "Visible",
    selected: "{{count}} selected",
    retryControls: "Retry controls",
    retryControlsDetail:
      "{{visible}} retryable in this view, {{total}} across accessible queues.",
    unselectRetryable: "Unselect retryable",
    selectRetryable: "Select retryable",
    retrySelected: "Retry selected",
    clear: "Clear",
    queueUnavailableTitle: "Queue unavailable",
    queueUnavailableDetail:
      "Brain could not load accessible distillation queue items.",
    select: "Select",
    capture: "Capture",
    source: "Source",
    attempts: "Attempts",
    runAfter: "Run after",
    updated: "Updated",
    reason: "Reason",
    action: "Action",
    selectCapture: "Select {{title}}",
    now: "Now",
    unknown: "Unknown",
    noIssueRecorded: "No issue recorded",
    retry: "Retry",
    noItemsTitle: "No queue items match this view",
    noItemsDetail:
      "Change the status or issue filter, or wait for new captures to enter distillation.",
    retryFailedDetail:
      "The queue item may already be done, active, or no longer accessible.",
    queuedForRetry: "{{count}} distillation {{itemLabel}} queued for retry",
    item: "item",
    items: "items",
    retryError: "retry error",
    retryErrors: "retry errors",
  },
};

type Messages = typeof enUS;
type PartialMessages = { [K in keyof Messages]?: Partial<Messages[K]> };

function mergeMessages(overrides: PartialMessages): Messages {
  return {
    common: { ...enUS.common, ...overrides.common },
    routeTitles: { ...enUS.routeTitles, ...overrides.routeTitles },
    team: { ...enUS.team, ...overrides.team },
    canonicalPreview: {
      ...enUS.canonicalPreview,
      ...overrides.canonicalPreview,
    },
    root: { ...enUS.root, ...overrides.root },
    navigation: { ...enUS.navigation, ...overrides.navigation },
    settings: { ...enUS.settings, ...overrides.settings },
    review: { ...enUS.review, ...overrides.review },
    sources: { ...enUS.sources, ...overrides.sources },
    chat: { ...enUS.chat, ...overrides.chat },
    ask: { ...enUS.ask, ...overrides.ask },
    knowledge: { ...enUS.knowledge, ...overrides.knowledge },
    searchPage: { ...enUS.searchPage, ...overrides.searchPage },
    ops: { ...enUS.ops, ...overrides.ops },
  };
}

const baseMessagesByLocale = {
  "en-US": enUS,
  "zh-TW": mergeMessages(zhTW),
  "zh-CN": mergeMessages({
    common: { saving: "正在保存", saveChanges: "保存更改", saved: "已保存" },
    routeTitles: {
      extension: "扩展 - Brain",
      extensions: "扩展 - Brain",
      team: "团队 - Brain",
    },
    team: {
      title: "团队",
      createOrgDescription:
        "设置团队，与同事共享 Brain 来源、已审核知识和设置。",
    },
    canonicalPreview: {
      title: "公司上下文预览",
      publishIntent: "审核 Brain 将镜像到工作区上下文的精确 Markdown。",
      unpublishIntent:
        "在移除此工作区上下文资源前，审核 Brain 管理的 Markdown。",
      pathSuffixAssigned: "批准时分配路径后缀",
      currentlyPublished: "当前已发布",
      workspacePath: "工作区路径",
      markdownPreviewLabel: "规范公司上下文 Markdown 预览",
      building: "正在构建 Markdown 预览...",
      empty: "打开提案或知识项以预览其规范 Markdown。",
      cancel: "取消",
    },
    root: {
      commandNavigate: "导航",
      commandAppearance: "外观",
      toggleTheme: "切换主题",
    },
    navigation: {
      brand: "Brain",
      ask: "提问",
      askBrain: "询问 Brain",
      search: "搜索",
      knowledge: "知识",
      review: "审核",
      reviewQueue: "审核队列",
      sources: "来源",
      ops: "运维",
      extensions: "扩展",
      settings: "设置",
      openNavigation: "打开导航",
      brainNavigation: "Brain 导航",
      brainNavigationDescription: "在 Brain 工作界面之间导航。",
    },
    settings: {
      agentTitle: "代理设置",
      agentDescription:
        "打开代理侧边栏设置，管理模型、API 密钥、自动化、语音和其他代理控制项。",
      openAgentSettings: "打开代理设置",
      eyebrow: "自定义",
      title: "自定义 Brain",
      description:
        "命名助手、塑造语气，并设置将公司来源转化为知识时遵循的策略。",
      languageTitle: "语言",
      languageDescription: "选择 Brain 的界面语言。",
      languageLabel: "界面语言",
      currentPolicy: "当前策略",
      currentPolicyDescription: "此 Brain 工作区已保存的有效设置。",
      identityTitle: "身份",
      companyName: "公司名称",
      assistantName: "助手名称",
      assistantBehaviorTitle: "助手行为",
      toneLabel: "语气",
      sourcePolicyLabel: "来源策略",
      publishingReviewTitle: "发布与审核",
      safetyEvidenceTitle: "安全与证据",
      autoPublishGateTitle: "自动发布门控",
    },
    review: {
      eyebrow: "审核",
      title: "提案审核",
      status: "状态",
      pending: "待处理",
      approved: "已批准",
      rejected: "已拒绝",
      reject: "拒绝",
      approveAndPublish: "批准并发布",
      detailsButton: "详情",
      openSource: "打开来源",
    },
    sources: {
      eyebrow: "来源",
      title: "来源配置",
      advanced: "高级",
      addSource: "添加来源",
      sourceType: "来源类型",
      allSources: "所有来源",
      status: "状态",
      provider: "提供方",
      notRequired: "不需要",
      cancel: "取消",
      saveSource: "保存来源",
      createSource: "创建来源",
      retryAfter: "{{date}} 后重试",
      lastSyncFailed: "上次同步失败",
      nextSync: "下次同步 {{date}}",
      waitingForFirstSync: "等待首次同步",
      manualSync: "手动同步",
      queueDistill: "加入提炼队列",
      retryDistill: "重试提炼",
      captureStatus: {
        queued: "已排队",
        distilling: "提炼中",
        distilled: "已提炼",
        ignored: "已忽略",
        all: "所有捕获",
      },
      queueStatus: {
        processing: "处理中",
        done: "完成",
        failed: "失败",
        queued: "已排队",
      },
      grantState: {
        connected: "已连接",
        granted: "已授权",
        needsGrant: "需要授权",
        notConnected: "未连接",
      },
      grantDetail: {
        connected: "{{count}} 个活动连接已授权给 Brain",
        granted: "Brain 可访问 {{count}} 个连接",
        needsGrant: "Dispatch 中已有连接；授权 Brain 后即可复用",
        configuredSources: "{{count}} 个来源已配置作用域凭据",
        noSharedConnection: "还没有共享工作区连接",
      },
      providerHealth: {
        ready: "就绪",
        grantNeeded: "需要授权",
        needsRepair: "需要修复",
        missingKeys: "缺少密钥",
        metadataOnly: "仅元数据",
        unknown: "未知",
      },
      appAccess: {
        allApps: "所有应用",
        brainAllowList: "Brain 允许列表",
        brainGrant: "Brain 授权",
        needsBrainGrant: "需要 Brain 授权",
      },
      workspaceStatus: {
        connected: "已连接",
        checking: "检查中",
        needsReauth: "需要重新授权",
        error: "错误",
        disabled: "已禁用",
      },
    },
    knowledge: {
      title: "带引用的公司知识",
      description: "浏览已批准、过期和待审核的记忆，并查看来源和置信度信号。",
      rows: "{{count}} 行",
      searchPlaceholder: "搜索记忆、主题、来源名称...",
      companyContext: "公司上下文",
      cites: "引用",
      noSummary: "还没有摘要。",
      owner: "负责人：{{owner}}",
      source: "来源",
      notApplicable: "不适用",
      emptyTitle: "还没有公司知识",
      emptyFilteredDetail: "清除搜索或筛选器以扩大知识范围。",
      emptyDetail: "连接来源或批准审核提案来建立公司知识。",
      updateFailedTitle: "公司上下文更新失败",
      updateFailedDetail: "Brain 无法更新工作区上下文资源。",
      waitingOnSearch: "等待 search-knowledge",
      waitingOnSearchDetail: "Brain 还无法加载已审核的公司知识。",
      viewStateMirrored:
        "视图状态会作为查询、状态和来源类型筛选器镜像到 application-state。",
      publishCompanyContext: "发布公司上下文",
      unpublishCompanyContext: "取消发布公司上下文",
      notEligible: "不符合条件",
      publishedToContext: "已发布到公司上下文",
      publishToContextTitle: "将此知识发布到 context/company-brain",
      published: "已发布",
      publish: "发布",
    },
    chat: {
      emptyState: "向 Brain 询问公司情况。",
      suggestionSecurity: "我们如何向企业潜在客户介绍安全性？",
      suggestionStaleFacts: "查找需要审核的过期入职信息。",
      suggestionSyncProblems: "哪些来源存在同步问题？",
      chats: "聊天",
      newChat: "新聊天",
      newBrainChat: "新建 Brain 聊天",
      renameChat: "重命名聊天",
      pinChat: "置顶聊天",
      unpinChat: "取消置顶聊天",
      archiveChat: "归档聊天",
      archiveFailed: "无法归档聊天。",
      renameFailed: "无法重命名聊天。",
      renameThread: "重命名 {{title}}",
      optionsFor: "{{title}} 的聊天选项",
    },
  }),
  "es-ES": mergeMessages({
    common: {
      saving: "Guardando",
      saveChanges: "Guardar cambios",
      saved: "Guardado",
    },
    routeTitles: {
      extension: "Extensión - Brain",
      extensions: "Extensiones - Brain",
      team: "Equipo - Brain",
    },
    team: {
      title: "Equipo",
      createOrgDescription:
        "Configura un equipo para compartir fuentes de Brain, conocimiento revisado y ajustes con tus colegas.",
    },
    canonicalPreview: {
      title: "Vista previa del contexto de empresa",
      publishIntent:
        "Revisa el Markdown exacto que Brain reflejará en el contexto del espacio de trabajo.",
      unpublishIntent:
        "Revisa el Markdown que Brain gestiona antes de eliminar este recurso de contexto del espacio de trabajo.",
      pathSuffixAssigned: "Sufijo de ruta asignado al aprobar",
      currentlyPublished: "Publicado actualmente",
      workspacePath: "Ruta del espacio de trabajo",
      markdownPreviewLabel:
        "Vista previa Markdown canónica del contexto de empresa",
      building: "Creando vista previa de Markdown...",
      empty:
        "Abre una propuesta o elemento de conocimiento para previsualizar su Markdown canónico.",
      cancel: "Cancelar",
    },
    root: {
      commandNavigate: "Navegar",
      commandAppearance: "Apariencia",
      toggleTheme: "Cambiar tema",
    },
    navigation: {
      ask: "Preguntar",
      askBrain: "Preguntar a Brain",
      search: "Buscar",
      knowledge: "Conocimiento",
      review: "Revisión",
      reviewQueue: "Cola de revisión",
      sources: "Fuentes",
      ops: "Ops",
      extensions: "Extensiones",
      settings: "Ajustes",
      openNavigation: "Abrir navegación",
      brainNavigation: "Navegación de Brain",
      brainNavigationDescription:
        "Navega por las superficies de trabajo de Brain.",
    },
    settings: {
      agentTitle: "Ajustes del agente",
      agentDescription:
        "Abre los ajustes del agente en la barra lateral para modelos, claves API, automatizaciones, voz y otros controles.",
      openAgentSettings: "Abrir ajustes del agente",
      eyebrow: "Personalizar",
      title: "Personalizar Brain",
      description:
        "Nombra el asistente, define su voz y establece las políticas que sigue al convertir fuentes de la empresa en conocimiento.",
      languageTitle: "Idioma",
      languageDescription: "Elige el idioma de la interfaz para Brain.",
      languageLabel: "Idioma de la interfaz",
      currentPolicy: "Política actual",
      currentPolicyDescription:
        "La configuración efectiva guardada para este workspace de Brain.",
      identityTitle: "Identidad",
      companyName: "Nombre de la empresa",
      assistantName: "Nombre del asistente",
      assistantBehaviorTitle: "Comportamiento del asistente",
      toneLabel: "Tono",
      sourcePolicyLabel: "Política de fuentes",
      publishingReviewTitle: "Publicación y revisión",
      safetyEvidenceTitle: "Seguridad y evidencia",
      autoPublishGateTitle: "Control de autopublicación",
    },
    review: {
      eyebrow: "Revisión",
      title: "Revisión de propuestas",
      status: "Estado",
      pending: "Pendiente",
      approved: "Aprobado",
      rejected: "Rechazado",
      reject: "Rechazar",
      approveAndPublish: "Aprobar y publicar",
      detailsButton: "Detalles",
      openSource: "Abrir fuente",
    },
    sources: {
      eyebrow: "Fuentes",
      title: "Configuración de fuentes",
      advanced: "Avanzado",
      addSource: "Añadir fuente",
      sourceType: "Tipo de fuente",
      allSources: "Todas las fuentes",
      status: "Estado",
      provider: "Proveedor",
      notRequired: "No requerido",
      cancel: "Cancelar",
      saveSource: "Guardar fuente",
      createSource: "Crear fuente",
      retryAfter: "Reintentar después de {{date}}",
      lastSyncFailed: "La última sincronización falló",
      nextSync: "Próxima sincronización {{date}}",
      waitingForFirstSync: "Esperando la primera sincronización",
      manualSync: "Sincronización manual",
      queueDistill: "Poner destilación en cola",
      retryDistill: "Reintentar destilación",
      captureStatus: {
        queued: "En cola",
        distilling: "Destilando",
        distilled: "Destilado",
        ignored: "Ignorado",
        all: "Todas las capturas",
      },
      queueStatus: {
        processing: "Procesando",
        done: "Hecho",
        failed: "Fallido",
        queued: "En cola",
      },
      grantState: {
        connected: "Conectado",
        granted: "Concedido",
        needsGrant: "Necesita permiso",
        notConnected: "No conectado",
      },
      grantDetail: {
        connected: "{{count}} conexiones activas concedidas a Brain",
        granted: "Brain puede acceder a {{count}} conexiones",
        needsGrant:
          "La conexión existe en Dispatch; concede acceso a Brain para reutilizarla",
        configuredSources:
          "{{count}} fuentes configuradas con credenciales acotadas",
        noSharedConnection: "Aún no hay conexión compartida del workspace",
      },
      providerHealth: {
        ready: "Listo",
        grantNeeded: "Permiso necesario",
        needsRepair: "Necesita reparación",
        missingKeys: "Faltan claves",
        metadataOnly: "Solo metadatos",
        unknown: "Desconocido",
      },
      appAccess: {
        allApps: "Todas las apps",
        brainAllowList: "Lista permitida de Brain",
        brainGrant: "Permiso de Brain",
        needsBrainGrant: "Necesita permiso de Brain",
      },
      workspaceStatus: {
        connected: "Conectado",
        checking: "Comprobando",
        needsReauth: "Necesita reautorización",
        error: "Error",
        disabled: "Desactivado",
      },
    },
    knowledge: {
      title: "Conocimiento de empresa citado",
      description:
        "Explora memorias aprobadas, obsoletas y pendientes de revisión con la fuente y la confianza visibles.",
      rows: "{{count}} filas",
      searchPlaceholder: "Buscar memorias, temas, nombres de fuentes...",
      companyContext: "Contexto de empresa",
      cites: "Citas",
      noSummary: "Aún no hay resumen.",
      owner: "Responsable: {{owner}}",
      source: "fuente",
      notApplicable: "n/d",
      emptyTitle: "Aún no hay conocimiento de empresa",
      emptyFilteredDetail:
        "Borra la búsqueda o los filtros para ampliar el conjunto de conocimiento.",
      emptyDetail:
        "Conecta una fuente o aprueba propuestas de revisión para crear conocimiento de empresa.",
      updateFailedTitle: "Error al actualizar el contexto de empresa",
      updateFailedDetail:
        "Brain no pudo actualizar el recurso de contexto del workspace.",
      waitingOnSearch: "Esperando search-knowledge",
      waitingOnSearchDetail:
        "Brain aún no pudo cargar el conocimiento de empresa revisado.",
      viewStateMirrored:
        "El estado de la vista se refleja en application-state como filtros de consulta, estado y tipo de fuente.",
      publishCompanyContext: "Publicar contexto de empresa",
      unpublishCompanyContext: "Anular publicación del contexto de empresa",
      notEligible: "No apto",
      publishedToContext: "Publicado en el contexto de empresa",
      publishToContextTitle:
        "Publicar este conocimiento en context/company-brain",
      published: "Publicado",
      publish: "Publicar",
    },
    chat: {
      emptyState: "Pregunta a Brain sobre la empresa.",
      suggestionSecurity:
        "¿Qué contamos a prospects enterprise sobre seguridad?",
      suggestionStaleFacts: "Busca datos de onboarding obsoletos que revisar.",
      suggestionSyncProblems:
        "¿Qué fuentes tienen problemas de sincronización?",
      chats: "Chats",
      newChat: "Nuevo chat",
      newBrainChat: "Nuevo chat de Brain",
      renameChat: "Renombrar chat",
      pinChat: "Fijar chat",
      unpinChat: "Desfijar chat",
      archiveChat: "Archivar chat",
      archiveFailed: "No se pudo archivar el chat.",
      renameFailed: "No se pudo renombrar el chat.",
      renameThread: "Renombrar {{title}}",
      optionsFor: "Opciones de chat para {{title}}",
    },
  }),
  "fr-FR": mergeMessages({
    common: {
      saving: "Enregistrement",
      saveChanges: "Enregistrer",
      saved: "Enregistré",
    },
    routeTitles: {
      extension: "Module d’extension - Brain",
      extensions: "Modules d’extension - Brain",
      team: "Équipe - Brain",
    },
    team: {
      title: "Équipe",
      createOrgDescription:
        "Configurez une équipe pour partager les sources Brain, les connaissances relues et les paramètres avec vos collègues.",
    },
    canonicalPreview: {
      title: "Aperçu du contexte d’entreprise",
      publishIntent:
        "Vérifiez le Markdown exact que Brain copiera dans le contexte de l’espace de travail.",
      unpublishIntent:
        "Vérifiez le Markdown géré par Brain avant de supprimer cette ressource de contexte de l’espace de travail.",
      pathSuffixAssigned: "Suffixe de chemin attribué à l’approbation",
      currentlyPublished: "Actuellement publié",
      workspacePath: "Chemin de l’espace de travail",
      markdownPreviewLabel:
        "Aperçu Markdown canonique du contexte d’entreprise",
      building: "Création de l’aperçu Markdown...",
      empty:
        "Ouvrez une proposition ou un élément de connaissance pour prévisualiser son Markdown canonique.",
      cancel: "Annuler",
    },
    root: {
      commandNavigate: "Naviguer",
      commandAppearance: "Apparence",
      toggleTheme: "Changer de thème",
    },
    navigation: {
      ask: "Demander",
      askBrain: "Demander à Brain",
      search: "Rechercher",
      knowledge: "Connaissance",
      review: "Revue",
      reviewQueue: "File de revue",
      sources: "Sources",
      ops: "Ops",
      extensions: "Extensions",
      settings: "Paramètres",
      openNavigation: "Ouvrir la navigation",
      brainNavigation: "Navigation Brain",
      brainNavigationDescription:
        "Naviguer entre les espaces de travail Brain.",
    },
    settings: {
      agentTitle: "Paramètres de l’agent",
      agentDescription:
        "Ouvrez les paramètres de l’agent dans la barre latérale pour les modèles, clés API, automatisations, voix et autres contrôles.",
      openAgentSettings: "Ouvrir les paramètres de l’agent",
      eyebrow: "Personnaliser",
      title: "Personnaliser Brain",
      description:
        "Nommez l'assistant, définissez sa voix et les règles suivies lorsqu'il transforme les sources de l'entreprise en connaissances.",
      languageTitle: "Langue",
      languageDescription: "Choisissez la langue de l'interface de Brain.",
      languageLabel: "Langue de l'interface",
      currentPolicy: "Politique actuelle",
      currentPolicyDescription:
        "Les paramètres effectifs enregistrés pour cet espace Brain.",
      identityTitle: "Identité",
      companyName: "Nom de l'entreprise",
      assistantName: "Nom de l'assistant",
      assistantBehaviorTitle: "Comportement de l'assistant",
      toneLabel: "Ton",
      sourcePolicyLabel: "Politique des sources",
      publishingReviewTitle: "Publication et revue",
      safetyEvidenceTitle: "Sécurité et preuves",
      autoPublishGateTitle: "Seuil d'autopublication",
    },
    review: {
      eyebrow: "Revue",
      title: "Revue des propositions",
      status: "Statut",
      pending: "En attente",
      approved: "Approuvé",
      rejected: "Rejeté",
      reject: "Rejeter",
      approveAndPublish: "Approuver et publier",
      detailsButton: "Détails",
      openSource: "Ouvrir la source",
    },
    sources: {
      eyebrow: "Sources",
      title: "Configuration des sources",
      advanced: "Avancé",
      addSource: "Ajouter une source",
      sourceType: "Type de source",
      allSources: "Toutes les sources",
      status: "Statut",
      provider: "Fournisseur",
      notRequired: "Non requis",
      cancel: "Annuler",
      saveSource: "Enregistrer la source",
      createSource: "Créer une source",
      retryAfter: "Réessayer après {{date}}",
      lastSyncFailed: "La dernière synchronisation a échoué",
      nextSync: "Prochaine synchronisation {{date}}",
      waitingForFirstSync: "En attente de la première synchronisation",
      manualSync: "Synchronisation manuelle",
      queueDistill: "Mettre la distillation en file",
      retryDistill: "Réessayer la distillation",
      captureStatus: {
        queued: "En file",
        distilling: "Distillation",
        distilled: "Distillé",
        ignored: "Ignoré",
        all: "Toutes les captures",
      },
      queueStatus: {
        processing: "Traitement",
        done: "Terminé",
        failed: "Échec",
        queued: "En file",
      },
      grantState: {
        connected: "Connecté",
        granted: "Accordé",
        needsGrant: "Autorisation requise",
        notConnected: "Non connecté",
      },
      grantDetail: {
        connected: "{{count}} connexions actives accordées à Brain",
        granted: "Brain peut accéder à {{count}} connexions",
        needsGrant:
          "La connexion existe dans Dispatch ; accordez l'accès à Brain pour la réutiliser",
        configuredSources:
          "{{count}} sources configurées avec des identifiants limités",
        noSharedConnection:
          "Aucune connexion d'espace de travail partagée pour l'instant",
      },
      providerHealth: {
        ready: "Prêt",
        grantNeeded: "Autorisation nécessaire",
        needsRepair: "Réparation nécessaire",
        missingKeys: "Clés manquantes",
        metadataOnly: "Métadonnées seules",
        unknown: "Inconnu",
      },
      appAccess: {
        allApps: "Toutes les apps",
        brainAllowList: "Liste autorisée Brain",
        brainGrant: "Autorisation Brain",
        needsBrainGrant: "Autorisation Brain requise",
      },
      workspaceStatus: {
        connected: "Connecté",
        checking: "Vérification",
        needsReauth: "Réauthentification requise",
        error: "Erreur",
        disabled: "Désactivé",
      },
    },
    knowledge: {
      title: "Connaissance d'entreprise citée",
      description:
        "Parcourez les mémoires approuvées, obsolètes et en revue avec la source et le signal de confiance visibles.",
      rows: "{{count}} lignes",
      searchPlaceholder: "Rechercher mémoires, sujets, noms de sources...",
      companyContext: "Contexte d'entreprise",
      cites: "Citations",
      noSummary: "Aucun résumé pour l'instant.",
      owner: "Responsable : {{owner}}",
      source: "source",
      notApplicable: "s.o.",
      emptyTitle: "Aucune connaissance d'entreprise pour l'instant",
      emptyFilteredDetail:
        "Effacez la recherche ou les filtres pour élargir l'ensemble de connaissances.",
      emptyDetail:
        "Connectez une source ou approuvez des propositions de revue pour constituer la connaissance d'entreprise.",
      updateFailedTitle: "Échec de la mise à jour du contexte d'entreprise",
      updateFailedDetail:
        "Brain n'a pas pu mettre à jour la ressource de contexte de l'espace de travail.",
      waitingOnSearch: "En attente de search-knowledge",
      waitingOnSearchDetail:
        "Brain n'a pas encore pu charger la connaissance d'entreprise revue.",
      viewStateMirrored:
        "L'état de la vue est reflété dans application-state sous forme de filtres de requête, statut et type de source.",
      publishCompanyContext: "Publier le contexte d'entreprise",
      unpublishCompanyContext: "Dépublier le contexte d'entreprise",
      notEligible: "Non éligible",
      publishedToContext: "Publié dans le contexte d'entreprise",
      publishToContextTitle:
        "Publier cette connaissance dans context/company-brain",
      published: "Publié",
      publish: "Publier",
    },
    chat: {
      emptyState: "Interrogez Brain sur l'entreprise.",
      suggestionSecurity:
        "Que dit-on aux prospects enterprise sur la sécurité ?",
      suggestionStaleFacts: "Trouve les faits d'onboarding obsolètes à revoir.",
      suggestionSyncProblems: "Quelles sources ont des problèmes de synchro ?",
      chats: "Chats",
      newChat: "Nouveau chat",
      newBrainChat: "Nouveau chat Brain",
      renameChat: "Renommer le chat",
      pinChat: "Épingler le chat",
      unpinChat: "Désépingler le chat",
      archiveChat: "Archiver le chat",
      archiveFailed: "Impossible d'archiver le chat.",
      renameFailed: "Impossible de renommer le chat.",
      renameThread: "Renommer {{title}}",
      optionsFor: "Options du chat pour {{title}}",
    },
  }),
  "de-DE": mergeMessages({
    common: {
      saving: "Speichern",
      saveChanges: "Änderungen speichern",
      saved: "Gespeichert",
    },
    routeTitles: {
      extension: "Erweiterung - Brain",
      extensions: "Erweiterungen - Brain",
      team: "Teamseite - Brain",
    },
    team: {
      title: "Team",
      createOrgDescription:
        "Richte ein Team ein, um Brain-Quellen, geprüfte Wissenseinträge und Einstellungen mit Kollegen zu teilen.",
    },
    canonicalPreview: {
      title: "Vorschau des Unternehmenskontexts",
      publishIntent:
        "Prüfe das genaue Markdown, das Brain in den Workspace-Kontext spiegelt.",
      unpublishIntent:
        "Prüfe das von Brain verwaltete Markdown, bevor diese Workspace-Kontextressource entfernt wird.",
      pathSuffixAssigned: "Pfadsuffix wird bei Genehmigung zugewiesen",
      currentlyPublished: "Derzeit veröffentlicht",
      workspacePath: "Workspace-Pfad",
      markdownPreviewLabel:
        "Kanonische Markdown-Vorschau des Unternehmenskontexts",
      building: "Markdown-Vorschau wird erstellt...",
      empty:
        "Öffne einen Vorschlag oder Wissenseintrag, um dessen kanonisches Markdown anzuzeigen.",
      cancel: "Abbrechen",
    },
    root: {
      commandNavigate: "Navigieren",
      commandAppearance: "Darstellung",
      toggleTheme: "Theme wechseln",
    },
    navigation: {
      ask: "Fragen",
      askBrain: "Brain fragen",
      search: "Suchen",
      knowledge: "Wissen",
      review: "Prüfung",
      reviewQueue: "Prüfwarteschlange",
      sources: "Quellen",
      ops: "Ops",
      extensions: "Erweiterungen",
      settings: "Einstellungen",
      openNavigation: "Navigation öffnen",
      brainNavigation: "Brain-Navigation",
      brainNavigationDescription: "Zwischen Brain-Arbeitsflächen wechseln.",
    },
    settings: {
      agentTitle: "Agent-Einstellungen",
      agentDescription:
        "Öffne die Agent-Einstellungen in der Seitenleiste für Modell, API-Schlüssel, Automatisierungen, Sprache und weitere Steuerungen.",
      openAgentSettings: "Agent-Einstellungen öffnen",
      eyebrow: "Anpassen",
      title: "Brain anpassen",
      description:
        "Benenne den Assistenten, gestalte seine Stimme und lege Richtlinien für die Umwandlung von Unternehmensquellen in Wissen fest.",
      languageTitle: "Sprache",
      languageDescription: "Wähle die Oberflächensprache für Brain.",
      languageLabel: "Oberflächensprache",
      currentPolicy: "Aktuelle Richtlinie",
      currentPolicyDescription:
        "Die wirksamen Einstellungen für diesen Brain-Workspace.",
      identityTitle: "Identität",
      companyName: "Unternehmensname",
      assistantName: "Assistentenname",
      assistantBehaviorTitle: "Assistentenverhalten",
      toneLabel: "Ton",
      sourcePolicyLabel: "Quellenrichtlinie",
      publishingReviewTitle: "Veröffentlichung und Prüfung",
      safetyEvidenceTitle: "Sicherheit und Nachweise",
      autoPublishGateTitle: "Autoveröffentlichungs-Gate",
    },
    review: {
      eyebrow: "Prüfung",
      title: "Vorschlagsprüfung",
      status: "Status",
      pending: "Ausstehend",
      approved: "Genehmigt",
      rejected: "Abgelehnt",
      reject: "Ablehnen",
      approveAndPublish: "Genehmigen und veröffentlichen",
      detailsButton: "Details",
      openSource: "Quelle öffnen",
    },
    sources: {
      eyebrow: "Quellen",
      title: "Quellenkonfiguration",
      advanced: "Erweitert",
      addSource: "Quelle hinzufügen",
      sourceType: "Quellentyp",
      allSources: "Alle Quellen",
      status: "Status",
      provider: "Anbieter",
      notRequired: "Nicht erforderlich",
      cancel: "Abbrechen",
      saveSource: "Quelle speichern",
      createSource: "Quelle erstellen",
      retryAfter: "Erneut versuchen nach {{date}}",
      lastSyncFailed: "Letzte Synchronisierung fehlgeschlagen",
      nextSync: "Nächste Synchronisierung {{date}}",
      waitingForFirstSync: "Warte auf erste Synchronisierung",
      manualSync: "Manuelle Synchronisierung",
      queueDistill: "Destillation einreihen",
      retryDistill: "Destillation erneut versuchen",
      captureStatus: {
        queued: "Eingereiht",
        distilling: "Destilliert",
        distilled: "Destilliert",
        ignored: "Ignoriert",
        all: "Alle Erfassungen",
      },
      queueStatus: {
        processing: "Verarbeitung",
        done: "Fertig",
        failed: "Fehlgeschlagen",
        queued: "Eingereiht",
      },
      grantState: {
        connected: "Verbunden",
        granted: "Gewährt",
        needsGrant: "Freigabe nötig",
        notConnected: "Nicht verbunden",
      },
      grantDetail: {
        connected: "{{count}} aktive Verbindungen für Brain freigegeben",
        granted: "Brain kann auf {{count}} Verbindungen zugreifen",
        needsGrant:
          "Verbindung existiert in Dispatch; gib Brain Zugriff zur Wiederverwendung",
        configuredSources:
          "{{count}} Quellen mit begrenzten Anmeldedaten konfiguriert",
        noSharedConnection: "Noch keine geteilte Workspace-Verbindung",
      },
      providerHealth: {
        ready: "Bereit",
        grantNeeded: "Freigabe nötig",
        needsRepair: "Reparatur nötig",
        missingKeys: "Schlüssel fehlen",
        metadataOnly: "Nur Metadaten",
        unknown: "Unbekannt",
      },
      appAccess: {
        allApps: "Alle Apps",
        brainAllowList: "Brain-Erlaubnisliste",
        brainGrant: "Brain-Freigabe",
        needsBrainGrant: "Brain-Freigabe nötig",
      },
      workspaceStatus: {
        connected: "Verbunden",
        checking: "Wird geprüft",
        needsReauth: "Erneute Autorisierung nötig",
        error: "Fehler",
        disabled: "Deaktiviert",
      },
    },
    knowledge: {
      title: "Zitiertes Unternehmenswissen",
      description:
        "Durchsuche genehmigte, veraltete und prüfpflichtige Erinnerungen mit sichtbarer Quelle und Vertrauenssignal.",
      rows: "{{count}} Zeilen",
      searchPlaceholder: "Erinnerungen, Themen, Quellnamen suchen...",
      companyContext: "Unternehmenskontext",
      cites: "Zitate",
      noSummary: "Noch keine Zusammenfassung.",
      owner: "Verantwortlich: {{owner}}",
      source: "Quelle",
      notApplicable: "k. A.",
      emptyTitle: "Noch kein Unternehmenswissen",
      emptyFilteredDetail:
        "Suche oder Filter löschen, um die Wissensmenge zu erweitern.",
      emptyDetail:
        "Verbinde eine Quelle oder genehmige Prüfungsvorschläge, um Unternehmenswissen aufzubauen.",
      updateFailedTitle:
        "Aktualisierung des Unternehmenskontexts fehlgeschlagen",
      updateFailedDetail:
        "Brain konnte die Workspace-Kontextressource nicht aktualisieren.",
      waitingOnSearch: "Warte auf search-knowledge",
      waitingOnSearchDetail:
        "Brain konnte geprüftes Unternehmenswissen noch nicht laden.",
      viewStateMirrored:
        "Der Ansichtsstatus wird als Abfrage-, Status- und Quellentypfilter in application-state gespiegelt.",
      publishCompanyContext: "Unternehmenskontext veröffentlichen",
      unpublishCompanyContext:
        "Veröffentlichung des Unternehmenskontexts aufheben",
      notEligible: "Nicht geeignet",
      publishedToContext: "Im Unternehmenskontext veröffentlicht",
      publishToContextTitle:
        "Dieses Wissen in context/company-brain veröffentlichen",
      published: "Veröffentlicht",
      publish: "Veröffentlichen",
    },
    chat: {
      emptyState: "Frag Brain nach dem Unternehmen.",
      suggestionSecurity:
        "Was sagen wir Enterprise-Interessenten zur Sicherheit?",
      suggestionStaleFacts: "Finde veraltete Onboarding-Fakten zur Prüfung.",
      suggestionSyncProblems: "Welche Quellen haben Sync-Probleme?",
      chats: "Chats",
      newChat: "Neuer Chat",
      newBrainChat: "Neuer Brain-Chat",
      renameChat: "Chat umbenennen",
      pinChat: "Chat anheften",
      unpinChat: "Chat lösen",
      archiveChat: "Chat archivieren",
      archiveFailed: "Chat konnte nicht archiviert werden.",
      renameFailed: "Chat konnte nicht umbenannt werden.",
      renameThread: "{{title}} umbenennen",
      optionsFor: "Chatoptionen für {{title}}",
    },
  }),
  "ja-JP": mergeMessages({
    common: { saving: "保存中", saveChanges: "変更を保存", saved: "保存済み" },
    routeTitles: {
      extension: "拡張機能 - Brain",
      extensions: "拡張機能 - Brain",
      team: "チーム - Brain",
    },
    team: {
      title: "チーム",
      createOrgDescription:
        "チームを設定して、Brain のソース、レビュー済みナレッジ、設定を同僚と共有します。",
    },
    canonicalPreview: {
      title: "会社コンテキストのプレビュー",
      publishIntent:
        "Brain がワークスペースコンテキストへミラーする正確な Markdown を確認します。",
      unpublishIntent:
        "このワークスペースコンテキストリソースを削除する前に、Brain が管理する Markdown を確認します。",
      pathSuffixAssigned: "承認時にパス接尾辞を割り当て",
      currentlyPublished: "現在公開中",
      workspacePath: "ワークスペースパス",
      markdownPreviewLabel: "正規の会社コンテキスト Markdown プレビュー",
      building: "Markdown プレビューを作成中...",
      empty: "提案またはナレッジ項目を開いて正規 Markdown をプレビューします。",
      cancel: "キャンセル",
    },
    root: {
      commandNavigate: "移動",
      commandAppearance: "外観",
      toggleTheme: "テーマを切り替え",
    },
    navigation: {
      ask: "質問",
      askBrain: "Brain に質問",
      search: "検索",
      knowledge: "ナレッジ",
      review: "レビュー",
      reviewQueue: "レビューキュー",
      sources: "ソース",
      ops: "運用",
      extensions: "拡張機能",
      settings: "設定",
      openNavigation: "ナビゲーションを開く",
      brainNavigation: "Brain ナビゲーション",
      brainNavigationDescription: "Brain の作業画面を移動します。",
    },
    settings: {
      agentTitle: "エージェント設定",
      agentDescription:
        "右サイドバーのエージェント設定を開き、モデル、API キー、自動化、音声などを管理します。",
      openAgentSettings: "エージェント設定を開く",
      eyebrow: "カスタマイズ",
      title: "Brain をカスタマイズ",
      description:
        "アシスタント名、声のトーン、会社ソースをナレッジ化するときのポリシーを設定します。",
      languageTitle: "言語",
      languageDescription: "Brain のインターフェース言語を選択します。",
      languageLabel: "インターフェース言語",
      currentPolicy: "現在のポリシー",
      currentPolicyDescription:
        "この Brain ワークスペースに保存された有効な設定です。",
      identityTitle: "識別情報",
      companyName: "会社名",
      assistantName: "アシスタント名",
      assistantBehaviorTitle: "アシスタントの動作",
      toneLabel: "トーン",
      sourcePolicyLabel: "ソースポリシー",
      publishingReviewTitle: "公開とレビュー",
      safetyEvidenceTitle: "安全性と証拠",
      autoPublishGateTitle: "自動公開ゲート",
    },
    review: {
      eyebrow: "レビュー",
      title: "提案レビュー",
      status: "ステータス",
      pending: "保留中",
      approved: "承認済み",
      rejected: "却下済み",
      reject: "却下",
      approveAndPublish: "承認して公開",
      detailsButton: "詳細",
      openSource: "ソースを開く",
    },
    sources: {
      eyebrow: "ソース",
      title: "ソース設定",
      advanced: "詳細",
      addSource: "ソースを追加",
      sourceType: "ソース種別",
      allSources: "すべてのソース",
      status: "ステータス",
      provider: "プロバイダー",
      notRequired: "不要",
      cancel: "キャンセル",
      saveSource: "ソースを保存",
      createSource: "ソースを作成",
      retryAfter: "{{date}} 後に再試行",
      lastSyncFailed: "前回の同期に失敗しました",
      nextSync: "次回同期 {{date}}",
      waitingForFirstSync: "初回同期を待機中",
      manualSync: "手動同期",
      queueDistill: "抽出をキューに追加",
      retryDistill: "抽出を再試行",
      captureStatus: {
        queued: "キュー済み",
        distilling: "抽出中",
        distilled: "抽出済み",
        ignored: "無視済み",
        all: "すべてのキャプチャ",
      },
      queueStatus: {
        processing: "処理中",
        done: "完了",
        failed: "失敗",
        queued: "キュー済み",
      },
      grantState: {
        connected: "接続済み",
        granted: "許可済み",
        needsGrant: "許可が必要",
        notConnected: "未接続",
      },
      grantDetail: {
        connected: "{{count}} 個のアクティブ接続が Brain に許可済み",
        granted: "Brain は {{count}} 個の接続にアクセスできます",
        needsGrant:
          "Dispatch に接続があります。再利用するには Brain にアクセスを許可してください",
        configuredSources:
          "{{count}} 個のソースがスコープ付き認証情報で設定済み",
        noSharedConnection: "共有ワークスペース接続はまだありません",
      },
      providerHealth: {
        ready: "準備完了",
        grantNeeded: "許可が必要",
        needsRepair: "修復が必要",
        missingKeys: "キー不足",
        metadataOnly: "メタデータのみ",
        unknown: "不明",
      },
      appAccess: {
        allApps: "すべてのアプリ",
        brainAllowList: "Brain 許可リスト",
        brainGrant: "Brain 許可",
        needsBrainGrant: "Brain 許可が必要",
      },
      workspaceStatus: {
        connected: "接続済み",
        checking: "確認中",
        needsReauth: "再認証が必要",
        error: "エラー",
        disabled: "無効",
      },
    },
    knowledge: {
      title: "引用付き会社ナレッジ",
      description:
        "承認済み、古い、レビュー待ちの記憶を、ソースと信頼度シグナル付きで閲覧します。",
      rows: "{{count}} 行",
      searchPlaceholder: "記憶、トピック、ソース名を検索...",
      companyContext: "会社コンテキスト",
      cites: "引用",
      noSummary: "まだ要約はありません。",
      owner: "所有者: {{owner}}",
      source: "ソース",
      notApplicable: "該当なし",
      emptyTitle: "会社ナレッジはまだありません",
      emptyFilteredDetail:
        "検索やフィルターをクリアしてナレッジ範囲を広げてください。",
      emptyDetail:
        "ソースを接続するかレビュー提案を承認して会社ナレッジを構築してください。",
      updateFailedTitle: "会社コンテキストの更新に失敗しました",
      updateFailedDetail:
        "Brain はワークスペースのコンテキストリソースを更新できませんでした。",
      waitingOnSearch: "search-knowledge を待機中",
      waitingOnSearchDetail:
        "Brain はレビュー済み会社ナレッジをまだ読み込めませんでした。",
      viewStateMirrored:
        "ビュー状態は、クエリ、ステータス、ソース種別フィルターとして application-state に反映されます。",
      publishCompanyContext: "会社コンテキストを公開",
      unpublishCompanyContext: "会社コンテキストの公開を解除",
      notEligible: "対象外",
      publishedToContext: "会社コンテキストに公開済み",
      publishToContextTitle: "このナレッジを context/company-brain に公開",
      published: "公開済み",
      publish: "公開",
    },
    chat: {
      emptyState: "会社について Brain に質問してください。",
      suggestionSecurity: "企業見込み客にセキュリティをどう説明する？",
      suggestionStaleFacts: "レビューが必要な古いオンボーディング情報を探す。",
      suggestionSyncProblems: "同期問題のあるソースは？",
      chats: "チャット",
      newChat: "新しいチャット",
      newBrainChat: "新しい Brain チャット",
      renameChat: "チャット名を変更",
      pinChat: "チャットを固定",
      unpinChat: "固定を解除",
      archiveChat: "チャットをアーカイブ",
      archiveFailed: "チャットをアーカイブできませんでした。",
      renameFailed: "チャット名を変更できませんでした。",
      renameThread: "{{title}} の名前を変更",
      optionsFor: "{{title}} のチャットオプション",
    },
  }),
  "ko-KR": mergeMessages({
    common: {
      saving: "저장 중",
      saveChanges: "변경 사항 저장",
      saved: "저장됨",
    },
    routeTitles: {
      extension: "확장 - Brain",
      extensions: "확장 - Brain",
      team: "팀 - Brain",
    },
    team: {
      title: "팀",
      createOrgDescription:
        "팀을 설정해 Brain 소스, 검토된 지식, 설정을 동료와 공유하세요.",
    },
    canonicalPreview: {
      title: "회사 컨텍스트 미리보기",
      publishIntent:
        "Brain이 워크스페이스 컨텍스트로 미러링할 정확한 Markdown을 검토합니다.",
      unpublishIntent:
        "이 워크스페이스 컨텍스트 리소스를 제거하기 전에 Brain이 관리하는 Markdown을 검토합니다.",
      pathSuffixAssigned: "승인 시 경로 접미사가 할당됨",
      currentlyPublished: "현재 게시됨",
      workspacePath: "워크스페이스 경로",
      markdownPreviewLabel: "표준 회사 컨텍스트 Markdown 미리보기",
      building: "Markdown 미리보기 작성 중...",
      empty: "제안 또는 지식 항목을 열어 표준 Markdown을 미리 봅니다.",
      cancel: "취소",
    },
    root: {
      commandNavigate: "이동",
      commandAppearance: "모양",
      toggleTheme: "테마 전환",
    },
    navigation: {
      ask: "질문",
      askBrain: "Brain에 질문",
      search: "검색",
      knowledge: "지식",
      review: "검토",
      reviewQueue: "검토 대기열",
      sources: "소스",
      ops: "운영",
      extensions: "확장",
      settings: "설정",
      openNavigation: "탐색 열기",
      brainNavigation: "Brain 탐색",
      brainNavigationDescription: "Brain 작업 화면 사이를 이동합니다.",
    },
    settings: {
      agentTitle: "에이전트 설정",
      agentDescription:
        "오른쪽 사이드바의 에이전트 설정을 열어 모델, API 키, 자동화, 음성 및 기타 제어를 관리합니다.",
      openAgentSettings: "에이전트 설정 열기",
      eyebrow: "사용자 지정",
      title: "Brain 사용자 지정",
      description:
        "어시스턴트 이름과 목소리를 정하고, 회사 소스를 지식으로 바꿀 때 따를 정책을 설정합니다.",
      languageTitle: "언어",
      languageDescription: "Brain의 인터페이스 언어를 선택하세요.",
      languageLabel: "인터페이스 언어",
      currentPolicy: "현재 정책",
      currentPolicyDescription:
        "이 Brain 워크스페이스에 저장된 실제 설정입니다.",
      identityTitle: "ID",
      companyName: "회사 이름",
      assistantName: "어시스턴트 이름",
      assistantBehaviorTitle: "어시스턴트 동작",
      toneLabel: "어조",
      sourcePolicyLabel: "소스 정책",
      publishingReviewTitle: "게시 및 검토",
      safetyEvidenceTitle: "안전 및 증거",
      autoPublishGateTitle: "자동 게시 게이트",
    },
    review: {
      eyebrow: "검토",
      title: "제안 검토",
      status: "상태",
      pending: "대기 중",
      approved: "승인됨",
      rejected: "거부됨",
      reject: "거부",
      approveAndPublish: "승인 및 게시",
      detailsButton: "세부 정보",
      openSource: "소스 열기",
    },
    sources: {
      eyebrow: "소스",
      title: "소스 구성",
      advanced: "고급",
      addSource: "소스 추가",
      sourceType: "소스 유형",
      allSources: "모든 소스",
      status: "상태",
      provider: "제공자",
      notRequired: "필요 없음",
      cancel: "취소",
      saveSource: "소스 저장",
      createSource: "소스 만들기",
      retryAfter: "{{date}} 후 다시 시도",
      lastSyncFailed: "마지막 동기화 실패",
      nextSync: "다음 동기화 {{date}}",
      waitingForFirstSync: "첫 동기화 대기 중",
      manualSync: "수동 동기화",
      queueDistill: "증류 대기열에 추가",
      retryDistill: "증류 다시 시도",
      captureStatus: {
        queued: "대기 중",
        distilling: "증류 중",
        distilled: "증류됨",
        ignored: "무시됨",
        all: "모든 캡처",
      },
      queueStatus: {
        processing: "처리 중",
        done: "완료",
        failed: "실패",
        queued: "대기 중",
      },
      grantState: {
        connected: "연결됨",
        granted: "승인됨",
        needsGrant: "승인 필요",
        notConnected: "연결되지 않음",
      },
      grantDetail: {
        connected: "{{count}}개의 활성 연결이 Brain에 승인됨",
        granted: "Brain이 {{count}}개의 연결에 접근할 수 있음",
        needsGrant:
          "Dispatch에 연결이 있습니다. 재사용하려면 Brain 접근을 승인하세요",
        configuredSources: "{{count}}개 소스가 범위 지정 자격 증명으로 구성됨",
        noSharedConnection: "아직 공유 워크스페이스 연결이 없음",
      },
      providerHealth: {
        ready: "준비됨",
        grantNeeded: "승인 필요",
        needsRepair: "복구 필요",
        missingKeys: "키 누락",
        metadataOnly: "메타데이터만",
        unknown: "알 수 없음",
      },
      appAccess: {
        allApps: "모든 앱",
        brainAllowList: "Brain 허용 목록",
        brainGrant: "Brain 승인",
        needsBrainGrant: "Brain 승인 필요",
      },
      workspaceStatus: {
        connected: "연결됨",
        checking: "확인 중",
        needsReauth: "재인증 필요",
        error: "오류",
        disabled: "비활성화됨",
      },
    },
    knowledge: {
      title: "인용된 회사 지식",
      description:
        "승인됨, 오래됨, 검토 대기 중인 기억을 소스와 신뢰도 신호와 함께 살펴봅니다.",
      rows: "{{count}}행",
      searchPlaceholder: "기억, 주제, 소스 이름 검색...",
      companyContext: "회사 컨텍스트",
      cites: "인용",
      noSummary: "아직 요약이 없습니다.",
      owner: "소유자: {{owner}}",
      source: "소스",
      notApplicable: "해당 없음",
      emptyTitle: "아직 회사 지식이 없습니다",
      emptyFilteredDetail: "검색이나 필터를 지워 지식 범위를 넓히세요.",
      emptyDetail: "소스를 연결하거나 검토 제안을 승인해 회사 지식을 만드세요.",
      updateFailedTitle: "회사 컨텍스트 업데이트 실패",
      updateFailedDetail:
        "Brain이 워크스페이스 컨텍스트 리소스를 업데이트하지 못했습니다.",
      waitingOnSearch: "search-knowledge 대기 중",
      waitingOnSearchDetail:
        "Brain이 아직 검토된 회사 지식을 로드하지 못했습니다.",
      viewStateMirrored:
        "보기 상태는 쿼리, 상태, 소스 유형 필터로 application-state에 반영됩니다.",
      publishCompanyContext: "회사 컨텍스트 게시",
      unpublishCompanyContext: "회사 컨텍스트 게시 취소",
      notEligible: "대상 아님",
      publishedToContext: "회사 컨텍스트에 게시됨",
      publishToContextTitle: "이 지식을 context/company-brain에 게시",
      published: "게시됨",
      publish: "게시",
    },
    chat: {
      emptyState: "회사에 대해 Brain에 물어보세요.",
      suggestionSecurity:
        "엔터프라이즈 잠재 고객에게 보안을 어떻게 설명하나요?",
      suggestionStaleFacts: "검토가 필요한 오래된 온보딩 사실 찾기.",
      suggestionSyncProblems: "동기화 문제가 있는 소스는 무엇인가요?",
      chats: "채팅",
      newChat: "새 채팅",
      newBrainChat: "새 Brain 채팅",
      renameChat: "채팅 이름 변경",
      pinChat: "채팅 고정",
      unpinChat: "채팅 고정 해제",
      archiveChat: "채팅 보관",
      archiveFailed: "채팅을 보관할 수 없습니다.",
      renameFailed: "채팅 이름을 변경할 수 없습니다.",
      renameThread: "{{title}} 이름 변경",
      optionsFor: "{{title}} 채팅 옵션",
    },
  }),
  "pt-BR": mergeMessages({
    common: {
      saving: "Salvando",
      saveChanges: "Salvar alterações",
      saved: "Salvo",
    },
    routeTitles: {
      extension: "Extensão - Brain",
      extensions: "Extensões - Brain",
      team: "Equipe - Brain",
    },
    team: {
      title: "Equipe",
      createOrgDescription:
        "Configure uma equipe para compartilhar fontes do Brain, conhecimento revisado e configurações com seus colegas.",
    },
    canonicalPreview: {
      title: "Prévia do contexto da empresa",
      publishIntent:
        "Revise o Markdown exato que o Brain espelhará no contexto do workspace.",
      unpublishIntent:
        "Revise o Markdown gerenciado pelo Brain antes de remover este recurso de contexto do workspace.",
      pathSuffixAssigned: "Sufixo de caminho atribuído na aprovação",
      currentlyPublished: "Publicado no momento",
      workspacePath: "Caminho do workspace",
      markdownPreviewLabel: "Prévia Markdown canônica do contexto da empresa",
      building: "Criando prévia de Markdown...",
      empty:
        "Abra uma proposta ou item de conhecimento para visualizar seu Markdown canônico.",
      cancel: "Cancelar",
    },
    root: {
      commandNavigate: "Navegar",
      commandAppearance: "Aparência",
      toggleTheme: "Alternar tema",
    },
    navigation: {
      ask: "Perguntar",
      askBrain: "Perguntar ao Brain",
      search: "Buscar",
      knowledge: "Conhecimento",
      review: "Revisão",
      reviewQueue: "Fila de revisão",
      sources: "Fontes",
      ops: "Ops",
      extensions: "Extensões",
      settings: "Configurações",
      openNavigation: "Abrir navegação",
      brainNavigation: "Navegação do Brain",
      brainNavigationDescription:
        "Navegue entre as superfícies de trabalho do Brain.",
    },
    settings: {
      agentTitle: "Configurações do agente",
      agentDescription:
        "Abra as configurações do agente na barra lateral para modelos, chaves de API, automações, voz e outros controles.",
      openAgentSettings: "Abrir configurações do agente",
      eyebrow: "Personalizar",
      title: "Personalizar Brain",
      description:
        "Nomeie o assistente, defina sua voz e as políticas usadas ao transformar fontes da empresa em conhecimento.",
      languageTitle: "Idioma",
      languageDescription: "Escolha o idioma da interface do Brain.",
      languageLabel: "Idioma da interface",
      currentPolicy: "Política atual",
      currentPolicyDescription:
        "As configurações efetivas salvas para este workspace Brain.",
      identityTitle: "Identidade",
      companyName: "Nome da empresa",
      assistantName: "Nome do assistente",
      assistantBehaviorTitle: "Comportamento do assistente",
      toneLabel: "Tom",
      sourcePolicyLabel: "Política de fontes",
      publishingReviewTitle: "Publicação e revisão",
      safetyEvidenceTitle: "Segurança e evidências",
      autoPublishGateTitle: "Portão de autopublicação",
    },
    review: {
      eyebrow: "Revisão",
      title: "Revisão de propostas",
      status: "Status",
      pending: "Pendente",
      approved: "Aprovado",
      rejected: "Rejeitado",
      reject: "Rejeitar",
      approveAndPublish: "Aprovar e publicar",
      detailsButton: "Detalhes",
      openSource: "Abrir fonte",
    },
    sources: {
      eyebrow: "Fontes",
      title: "Configuração de fontes",
      advanced: "Avançado",
      addSource: "Adicionar fonte",
      sourceType: "Tipo de fonte",
      allSources: "Todas as fontes",
      status: "Status",
      provider: "Provedor",
      notRequired: "Não obrigatório",
      cancel: "Cancelar",
      saveSource: "Salvar fonte",
      createSource: "Criar fonte",
      retryAfter: "Tentar novamente após {{date}}",
      lastSyncFailed: "A última sincronização falhou",
      nextSync: "Próxima sincronização {{date}}",
      waitingForFirstSync: "Aguardando primeira sincronização",
      manualSync: "Sincronização manual",
      queueDistill: "Enfileirar destilação",
      retryDistill: "Tentar destilação novamente",
      captureStatus: {
        queued: "Na fila",
        distilling: "Destilando",
        distilled: "Destilado",
        ignored: "Ignorado",
        all: "Todas as capturas",
      },
      queueStatus: {
        processing: "Processando",
        done: "Concluído",
        failed: "Falhou",
        queued: "Na fila",
      },
      grantState: {
        connected: "Conectado",
        granted: "Concedido",
        needsGrant: "Precisa de concessão",
        notConnected: "Não conectado",
      },
      grantDetail: {
        connected: "{{count}} conexões ativas concedidas ao Brain",
        granted: "Brain pode acessar {{count}} conexões",
        needsGrant:
          "A conexão existe no Dispatch; conceda acesso ao Brain para reutilizá-la",
        configuredSources:
          "{{count}} fontes configuradas com credenciais escopadas",
        noSharedConnection: "Ainda não há conexão compartilhada do workspace",
      },
      providerHealth: {
        ready: "Pronto",
        grantNeeded: "Concessão necessária",
        needsRepair: "Precisa de reparo",
        missingKeys: "Chaves ausentes",
        metadataOnly: "Somente metadados",
        unknown: "Desconhecido",
      },
      appAccess: {
        allApps: "Todos os apps",
        brainAllowList: "Lista permitida do Brain",
        brainGrant: "Concessão do Brain",
        needsBrainGrant: "Precisa de concessão do Brain",
      },
      workspaceStatus: {
        connected: "Conectado",
        checking: "Verificando",
        needsReauth: "Precisa reautorizar",
        error: "Erro",
        disabled: "Desativado",
      },
    },
    knowledge: {
      title: "Conhecimento da empresa citado",
      description:
        "Navegue por memórias aprovadas, antigas e pendentes de revisão com fonte e sinal de confiança visíveis.",
      rows: "{{count}} linhas",
      searchPlaceholder: "Buscar memórias, tópicos, nomes de fontes...",
      companyContext: "Contexto da empresa",
      cites: "Citações",
      noSummary: "Ainda sem resumo.",
      owner: "Responsável: {{owner}}",
      source: "fonte",
      notApplicable: "n/d",
      emptyTitle: "Ainda não há conhecimento da empresa",
      emptyFilteredDetail:
        "Limpe a busca ou os filtros para ampliar o conjunto de conhecimento.",
      emptyDetail:
        "Conecte uma fonte ou aprove propostas de revisão para criar conhecimento da empresa.",
      updateFailedTitle: "Falha ao atualizar o contexto da empresa",
      updateFailedDetail:
        "Brain não conseguiu atualizar o recurso de contexto do workspace.",
      waitingOnSearch: "Aguardando search-knowledge",
      waitingOnSearchDetail:
        "Brain ainda não conseguiu carregar conhecimento revisado da empresa.",
      viewStateMirrored:
        "O estado da visualização é espelhado em application-state como filtros de consulta, status e tipo de fonte.",
      publishCompanyContext: "Publicar contexto da empresa",
      unpublishCompanyContext: "Despublicar contexto da empresa",
      notEligible: "Não elegível",
      publishedToContext: "Publicado no contexto da empresa",
      publishToContextTitle:
        "Publicar este conhecimento em context/company-brain",
      published: "Publicado",
      publish: "Publicar",
    },
    chat: {
      emptyState: "Pergunte ao Brain sobre a empresa.",
      suggestionSecurity:
        "O que dizemos a prospects enterprise sobre segurança?",
      suggestionStaleFacts:
        "Encontre fatos de onboarding antigos para revisar.",
      suggestionSyncProblems: "Quais fontes têm problemas de sincronização?",
      chats: "Chats",
      newChat: "Novo chat",
      newBrainChat: "Novo chat do Brain",
      renameChat: "Renomear chat",
      pinChat: "Fixar chat",
      unpinChat: "Desafixar chat",
      archiveChat: "Arquivar chat",
      archiveFailed: "Não foi possível arquivar o chat.",
      renameFailed: "Não foi possível renomear o chat.",
      renameThread: "Renomear {{title}}",
      optionsFor: "Opções de chat para {{title}}",
    },
  }),
  "hi-IN": mergeMessages({
    common: {
      saving: "सहेज रहे हैं",
      saveChanges: "बदलाव सहेजें",
      saved: "सहेजा गया",
    },
    routeTitles: {
      extension: "एक्सटेंशन - Brain",
      extensions: "एक्सटेंशन - Brain",
      team: "टीम - Brain",
    },
    team: {
      title: "टीम",
      createOrgDescription:
        "सहकर्मियों के साथ Brain स्रोत, समीक्षा किया गया ज्ञान और सेटिंग्स साझा करने के लिए टीम सेट अप करें।",
    },
    canonicalPreview: {
      title: "कंपनी संदर्भ पूर्वावलोकन",
      publishIntent:
        "Brain जिस सटीक Markdown को कार्यस्थान संदर्भ में मिरर करेगा, उसकी समीक्षा करें।",
      unpublishIntent:
        "इस कार्यस्थान संदर्भ संसाधन को हटाने से पहले Brain द्वारा प्रबंधित Markdown की समीक्षा करें।",
      pathSuffixAssigned: "स्वीकृति पर पाथ suffix असाइन होगा",
      currentlyPublished: "अभी प्रकाशित",
      workspacePath: "कार्यस्थान पाथ",
      markdownPreviewLabel: "कैनॉनिकल कंपनी संदर्भ Markdown पूर्वावलोकन",
      building: "Markdown पूर्वावलोकन बन रहा है...",
      empty:
        "किसी प्रस्ताव या ज्ञान आइटम को खोलकर उसका कैनॉनिकल Markdown पूर्वावलोकन देखें।",
      cancel: "रद्द करें",
    },
    root: {
      commandNavigate: "नेविगेट",
      commandAppearance: "रूप",
      toggleTheme: "थीम बदलें",
    },
    navigation: {
      ask: "पूछें",
      askBrain: "Brain से पूछें",
      search: "खोजें",
      knowledge: "ज्ञान",
      review: "समीक्षा",
      reviewQueue: "समीक्षा कतार",
      sources: "स्रोत",
      ops: "Ops",
      extensions: "एक्सटेंशन",
      settings: "सेटिंग्स",
      openNavigation: "नेविगेशन खोलें",
      brainNavigation: "Brain नेविगेशन",
      brainNavigationDescription: "Brain कार्य सतहों के बीच जाएं।",
    },
    settings: {
      agentTitle: "एजेंट सेटिंग्स",
      agentDescription:
        "मॉडल, API कुंजियों, ऑटोमेशन, आवाज़ और अन्य एजेंट नियंत्रणों के लिए साइडबार सेटिंग्स खोलें।",
      openAgentSettings: "एजेंट सेटिंग्स खोलें",
      eyebrow: "कस्टमाइज़",
      title: "Brain कस्टमाइज़ करें",
      description:
        "असिस्टेंट का नाम, आवाज़ और कंपनी स्रोतों को ज्ञान में बदलते समय पालन की जाने वाली नीतियां सेट करें।",
      languageTitle: "भाषा",
      languageDescription: "Brain की इंटरफ़ेस भाषा चुनें।",
      languageLabel: "इंटरफ़ेस भाषा",
      currentPolicy: "वर्तमान नीति",
      currentPolicyDescription:
        "इस Brain workspace के लिए सहेजी गई प्रभावी सेटिंग्स।",
      identityTitle: "पहचान",
      companyName: "कंपनी का नाम",
      assistantName: "असिस्टेंट का नाम",
      assistantBehaviorTitle: "असिस्टेंट व्यवहार",
      toneLabel: "स्वर",
      sourcePolicyLabel: "स्रोत नीति",
      publishingReviewTitle: "प्रकाशन और समीक्षा",
      safetyEvidenceTitle: "सुरक्षा और प्रमाण",
      autoPublishGateTitle: "ऑटो-पब्लिश गेट",
    },
    review: {
      eyebrow: "समीक्षा",
      title: "प्रस्ताव समीक्षा",
      status: "स्थिति",
      pending: "लंबित",
      approved: "स्वीकृत",
      rejected: "अस्वीकृत",
      reject: "अस्वीकार करें",
      approveAndPublish: "स्वीकृत करें और प्रकाशित करें",
      detailsButton: "विवरण",
      openSource: "स्रोत खोलें",
    },
    sources: {
      eyebrow: "स्रोत",
      title: "स्रोत कॉन्फ़िगरेशन",
      advanced: "उन्नत",
      addSource: "स्रोत जोड़ें",
      sourceType: "स्रोत प्रकार",
      allSources: "सभी स्रोत",
      status: "स्थिति",
      provider: "प्रदाता",
      notRequired: "आवश्यक नहीं",
      cancel: "रद्द करें",
      saveSource: "स्रोत सहेजें",
      createSource: "स्रोत बनाएं",
      retryAfter: "{{date}} के बाद फिर कोशिश करें",
      lastSyncFailed: "पिछला sync विफल रहा",
      nextSync: "अगला sync {{date}}",
      waitingForFirstSync: "पहले sync की प्रतीक्षा",
      manualSync: "मैन्युअल sync",
      queueDistill: "डिस्टिलेशन कतार में डालें",
      retryDistill: "डिस्टिलेशन फिर कोशिश करें",
      captureStatus: {
        queued: "कतार में",
        distilling: "डिस्टिल हो रहा है",
        distilled: "डिस्टिल किया गया",
        ignored: "अनदेखा",
        all: "सभी captures",
      },
      queueStatus: {
        processing: "प्रोसेस हो रहा है",
        done: "पूरा",
        failed: "विफल",
        queued: "कतार में",
      },
      grantState: {
        connected: "कनेक्टेड",
        granted: "अनुमति दी गई",
        needsGrant: "अनुमति चाहिए",
        notConnected: "कनेक्टेड नहीं",
      },
      grantDetail: {
        connected: "{{count}} सक्रिय connections Brain को दी गईं",
        granted: "Brain {{count}} connections तक पहुंच सकता है",
        needsGrant: "Connection Dispatch में मौजूद है; reuse के लिए Brain access दें",
        configuredSources:
          "{{count}} sources scoped credentials के साथ configured हैं",
        noSharedConnection: "अभी कोई shared workspace connection नहीं",
      },
      providerHealth: {
        ready: "तैयार",
        grantNeeded: "अनुमति चाहिए",
        needsRepair: "मरम्मत चाहिए",
        missingKeys: "कुंजियां गायब",
        metadataOnly: "केवल metadata",
        unknown: "अज्ञात",
      },
      appAccess: {
        allApps: "सभी apps",
        brainAllowList: "Brain allow-list",
        brainGrant: "Brain अनुमति",
        needsBrainGrant: "Brain अनुमति चाहिए",
      },
      workspaceStatus: {
        connected: "कनेक्टेड",
        checking: "जांच रहे हैं",
        needsReauth: "फिर से authorization चाहिए",
        error: "त्रुटि",
        disabled: "अक्षम",
      },
    },
    knowledge: {
      title: "उद्धृत कंपनी ज्ञान",
      description:
        "स्वीकृत, पुराने और review-bound memories को source और confidence signal के साथ देखें।",
      rows: "{{count}} पंक्तियां",
      searchPlaceholder: "memories, topics, source names खोजें...",
      companyContext: "कंपनी संदर्भ",
      cites: "उद्धरण",
      noSummary: "अभी कोई summary नहीं।",
      owner: "Owner: {{owner}}",
      source: "स्रोत",
      notApplicable: "लागू नहीं",
      emptyTitle: "अभी कोई कंपनी ज्ञान नहीं",
      emptyFilteredDetail: "knowledge set बढ़ाने के लिए search या filters साफ़ करें।",
      emptyDetail:
        "कंपनी ज्ञान बनाने के लिए source connect करें या review proposals approve करें।",
      updateFailedTitle: "कंपनी संदर्भ update विफल",
      updateFailedDetail: "Brain workspace context resource update नहीं कर सका।",
      waitingOnSearch: "search-knowledge की प्रतीक्षा",
      waitingOnSearchDetail:
        "Brain अभी reviewed company knowledge load नहीं कर सका।",
      viewStateMirrored:
        "View state query, status और source type filters के रूप में application-state में mirrored है।",
      publishCompanyContext: "कंपनी संदर्भ प्रकाशित करें",
      unpublishCompanyContext: "कंपनी संदर्भ अप्रकाशित करें",
      notEligible: "योग्य नहीं",
      publishedToContext: "कंपनी संदर्भ में प्रकाशित",
      publishToContextTitle:
        "इस knowledge को context/company-brain में publish करें",
      published: "प्रकाशित",
      publish: "प्रकाशित करें",
    },
    chat: {
      emptyState: "कंपनी के बारे में Brain से पूछें।",
      suggestionSecurity:
        "enterprise prospects को security के बारे में क्या बताते हैं?",
      suggestionStaleFacts: "review की जरूरत वाले stale onboarding facts खोजें।",
      suggestionSyncProblems: "किन sources में sync problems हैं?",
      chats: "चैट",
      newChat: "नई चैट",
      newBrainChat: "नई Brain चैट",
      renameChat: "चैट का नाम बदलें",
      pinChat: "चैट पिन करें",
      unpinChat: "चैट अनपिन करें",
      archiveChat: "चैट आर्काइव करें",
      archiveFailed: "चैट आर्काइव नहीं कर सके।",
      renameFailed: "चैट का नाम नहीं बदल सके।",
      renameThread: "{{title}} का नाम बदलें",
      optionsFor: "{{title}} के लिए चैट विकल्प",
    },
  }),
  "ar-SA": mergeMessages({
    common: {
      saving: "جارٍ الحفظ",
      saveChanges: "حفظ التغييرات",
      saved: "تم الحفظ",
    },
    routeTitles: {
      extension: "إضافة - Brain",
      extensions: "الإضافات - Brain",
      team: "الفريق - Brain",
    },
    team: {
      title: "الفريق",
      createOrgDescription:
        "أعد فريقاً لمشاركة مصادر Brain والمعرفة التي تمت مراجعتها والإعدادات مع زملائك.",
    },
    canonicalPreview: {
      title: "معاينة سياق الشركة",
      publishIntent:
        "راجع Markdown الدقيق الذي سيعكسه Brain في سياق مساحة العمل.",
      unpublishIntent:
        "راجع Markdown الذي يديره Brain قبل إزالة مورد سياق مساحة العمل هذا.",
      pathSuffixAssigned: "يتم تعيين لاحقة المسار عند الموافقة",
      currentlyPublished: "منشور حالياً",
      workspacePath: "مسار مساحة العمل",
      markdownPreviewLabel: "معاينة Markdown القانونية لسياق الشركة",
      building: "جار إنشاء معاينة Markdown...",
      empty: "افتح اقتراحاً أو عنصر معرفة لمعاينة Markdown القانوني الخاص به.",
      cancel: "إلغاء",
    },
    root: {
      commandNavigate: "التنقل",
      commandAppearance: "المظهر",
      toggleTheme: "تبديل السمة",
    },
    navigation: {
      ask: "اسأل",
      askBrain: "اسأل Brain",
      search: "بحث",
      knowledge: "المعرفة",
      review: "المراجعة",
      reviewQueue: "قائمة المراجعة",
      sources: "المصادر",
      ops: "العمليات",
      extensions: "الإضافات",
      settings: "الإعدادات",
      openNavigation: "فتح التنقل",
      brainNavigation: "تنقل Brain",
      brainNavigationDescription: "التنقل بين مساحات عمل Brain.",
    },
    settings: {
      agentTitle: "إعدادات الوكيل",
      agentDescription:
        "افتح إعدادات الوكيل في الشريط الجانبي لإدارة النموذج ومفاتيح API والأتمتة والصوت وعناصر التحكم الأخرى.",
      openAgentSettings: "فتح إعدادات الوكيل",
      eyebrow: "تخصيص",
      title: "تخصيص Brain",
      description:
        "سمّ المساعد وشكّل صوته وحدد السياسات التي يتبعها عند تحويل مصادر الشركة إلى معرفة.",
      languageTitle: "اللغة",
      languageDescription: "اختر لغة واجهة Brain.",
      languageLabel: "لغة الواجهة",
      currentPolicy: "السياسة الحالية",
      currentPolicyDescription: "الإعدادات الفعلية المحفوظة لمساحة Brain هذه.",
      identityTitle: "الهوية",
      companyName: "اسم الشركة",
      assistantName: "اسم المساعد",
      assistantBehaviorTitle: "سلوك المساعد",
      toneLabel: "النبرة",
      sourcePolicyLabel: "سياسة المصادر",
      publishingReviewTitle: "النشر والمراجعة",
      safetyEvidenceTitle: "السلامة والأدلة",
      autoPublishGateTitle: "بوابة النشر التلقائي",
    },
    review: {
      eyebrow: "المراجعة",
      title: "مراجعة المقترحات",
      status: "الحالة",
      pending: "قيد الانتظار",
      approved: "تمت الموافقة",
      rejected: "مرفوض",
      reject: "رفض",
      approveAndPublish: "الموافقة والنشر",
      detailsButton: "التفاصيل",
      openSource: "فتح المصدر",
    },
    sources: {
      eyebrow: "المصادر",
      title: "إعداد المصادر",
      advanced: "متقدم",
      addSource: "إضافة مصدر",
      sourceType: "نوع المصدر",
      allSources: "كل المصادر",
      status: "الحالة",
      provider: "المزوّد",
      notRequired: "غير مطلوب",
      cancel: "إلغاء",
      saveSource: "حفظ المصدر",
      createSource: "إنشاء مصدر",
      retryAfter: "إعادة المحاولة بعد {{date}}",
      lastSyncFailed: "فشلت آخر مزامنة",
      nextSync: "المزامنة التالية {{date}}",
      waitingForFirstSync: "بانتظار أول مزامنة",
      manualSync: "مزامنة يدوية",
      queueDistill: "إضافة الاستخلاص إلى القائمة",
      retryDistill: "إعادة محاولة الاستخلاص",
      captureStatus: {
        queued: "في القائمة",
        distilling: "جارٍ الاستخلاص",
        distilled: "تم الاستخلاص",
        ignored: "تم التجاهل",
        all: "كل الالتقاطات",
      },
      queueStatus: {
        processing: "قيد المعالجة",
        done: "تم",
        failed: "فشل",
        queued: "في القائمة",
      },
      grantState: {
        connected: "متصل",
        granted: "ممنوح",
        needsGrant: "يحتاج منحة",
        notConnected: "غير متصل",
      },
      grantDetail: {
        connected: "{{count}} اتصالات نشطة ممنوحة لـ Brain",
        granted: "يمكن لـ Brain الوصول إلى {{count}} اتصالات",
        needsGrant:
          "الاتصال موجود في Dispatch؛ امنح Brain الوصول لإعادة استخدامه",
        configuredSources: "{{count}} مصادر مهيأة ببيانات اعتماد محددة النطاق",
        noSharedConnection: "لا يوجد اتصال مساحة عمل مشترك بعد",
      },
      providerHealth: {
        ready: "جاهز",
        grantNeeded: "تحتاج منحة",
        needsRepair: "يحتاج إصلاحًا",
        missingKeys: "مفاتيح مفقودة",
        metadataOnly: "بيانات وصفية فقط",
        unknown: "غير معروف",
      },
      appAccess: {
        allApps: "كل التطبيقات",
        brainAllowList: "قائمة السماح لـ Brain",
        brainGrant: "منحة Brain",
        needsBrainGrant: "تحتاج منحة Brain",
      },
      workspaceStatus: {
        connected: "متصل",
        checking: "جارٍ الفحص",
        needsReauth: "تحتاج إعادة تفويض",
        error: "خطأ",
        disabled: "معطل",
      },
    },
    knowledge: {
      title: "معرفة الشركة المستشهد بها",
      description:
        "تصفح الذكريات المعتمدة والقديمة وتلك التي تنتظر المراجعة مع إظهار المصدر وإشارة الثقة.",
      rows: "{{count}} صفوف",
      searchPlaceholder: "ابحث في الذكريات والموضوعات وأسماء المصادر...",
      companyContext: "سياق الشركة",
      cites: "استشهادات",
      noSummary: "لا يوجد ملخص بعد.",
      owner: "المالك: {{owner}}",
      source: "مصدر",
      notApplicable: "غير منطبق",
      emptyTitle: "لا توجد معرفة شركة بعد",
      emptyFilteredDetail: "امسح البحث أو عوامل التصفية لتوسيع مجموعة المعرفة.",
      emptyDetail: "صل مصدرًا أو وافق على مقترحات المراجعة لبناء معرفة الشركة.",
      updateFailedTitle: "فشل تحديث سياق الشركة",
      updateFailedDetail: "تعذر على Brain تحديث مورد سياق مساحة العمل.",
      waitingOnSearch: "بانتظار search-knowledge",
      waitingOnSearchDetail:
        "لم يتمكن Brain بعد من تحميل معرفة الشركة التي تمت مراجعتها.",
      viewStateMirrored:
        "تتم مزامنة حالة العرض إلى application-state كعوامل تصفية للاستعلام والحالة ونوع المصدر.",
      publishCompanyContext: "نشر سياق الشركة",
      unpublishCompanyContext: "إلغاء نشر سياق الشركة",
      notEligible: "غير مؤهل",
      publishedToContext: "منشور في سياق الشركة",
      publishToContextTitle: "انشر هذه المعرفة إلى context/company-brain",
      published: "منشور",
      publish: "نشر",
    },
    chat: {
      emptyState: "اسأل Brain عن الشركة.",
      suggestionSecurity: "ماذا نقول للعملاء المحتملين من المؤسسات عن الأمان؟",
      suggestionStaleFacts:
        "اعثر على حقائق onboarding القديمة التي تحتاج مراجعة.",
      suggestionSyncProblems: "ما المصادر التي لديها مشاكل مزامنة؟",
      chats: "المحادثات",
      newChat: "محادثة جديدة",
      newBrainChat: "محادثة Brain جديدة",
      renameChat: "إعادة تسمية المحادثة",
      pinChat: "تثبيت المحادثة",
      unpinChat: "إلغاء تثبيت المحادثة",
      archiveChat: "أرشفة المحادثة",
      archiveFailed: "تعذرت أرشفة المحادثة.",
      renameFailed: "تعذرت إعادة تسمية المحادثة.",
      renameThread: "إعادة تسمية {{title}}",
      optionsFor: "خيارات المحادثة لـ {{title}}",
    },
  }),
} satisfies Record<LocaleCode, Messages>;

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown>
    ? DeepPartial<T[K]>
    : T[K];
};

const exactEnglishDebtOverrides: Partial<
  Record<LocaleCode, DeepPartial<Messages>>
> = {
  "ar-SA": {
    ask: {
      composerPlaceholder: "اسأل عن معرفة الشركة...",
      emptyState: "اسأل Brain عن معرفة الشركة.",
      heroDescription: "Brain إجابات من معرفة الشركة المذكورة.",
      heroTitle: "ماذا تريد أن تعرف؟",
    },
    ops: {
      allQueueItems: "جميع عناصر قائمة الانتظار",
      allStatuses: "جميع الحالات",
      description:
        "مراقبة عمليات تسليم التقطير Brain والعمال الذين لا معنى لهم والفشل القابل لإعادة المحاولة من عرض قائمة انتظار مضغوط واحد.",
      noIssueRecorded: "لم يتم تسجيل أي مشكلة",
      noItemsDetail:
        "قم بتغيير الحالة أو عامل تصفية الإصدار، أو انتظر حتى تدخل اللقطات الجديدة في عملية التقطير.",
      noItemsTitle: "لا توجد عناصر قائمة انتظار تطابق طريقة العرض هذه",
      noRetryableFound:
        "لم يتم العثور على عناصر التقطير القابلة لإعادة المحاولة",
      queueIssue: "مشكلة قائمة الانتظار",
      queueUnavailableDetail:
        "تعذر على Brain تحميل عناصر قائمة انتظار التقطير التي يمكن الوصول إليها.",
      queueUnavailableTitle: "قائمة الانتظار غير متاحة",
      retryAllRetryable: "إعادة المحاولة كلها قابلة لإعادة المحاولة",
      retryControls: "أعد محاولة التحكم",
      retryFailedDetail:
        "قد يكون عنصر قائمة الانتظار قد تم إنجازه بالفعل، أو أنه نشط، أو لم يعد من الممكن الوصول إليه.",
      retryFailed: "فشلت إعادة المحاولة",
      retrySelected: "إعادة المحاولة المحددة",
      runAfter: "تشغيل بعد",
      selectRetryable: "حدد قابل لإعادة المحاولة",
      staleProcessing: "معالجة قديمة",
      title: "عمليات التقطير",
      unselectRetryable: "قم بإلغاء تحديد قابل لإعادة المحاولة",
    },
    review: {
      actionFailedDetail: "تعذر على Brain تحميل المقترحات أو تحديثها.",
      actionFailedTitle: "فشل إجراء المراجعة",
      approvalSavesEdits: "الموافقة تحفظ تعديلات الصياغة أولاً.",
      approveKnowledge: "الموافقة على المعرفة",
      approveRedactedDraft: "الموافقة على المسودة المنقحة",
      approveReplacement: "الموافقة على الاستبدال",
      approveUpdate: "الموافقة على التحديث",
      approvedProposals: "المقترحات المعتمدة",
      capturedSource: "المصدر الملتقط",
      companyContext: "سياق الشركة",
      currentDraft: "المسودة الحالية",
      description:
        "قم بالموافقة فقط على الذكريات المقترحة التي لها قيمة دائمة ودعم المصدر ووضع الخصوصية الصحيح.",
      details: {
        knowledgeTarget: "هدف المعرفة",
        publishTier: "نشر الطبقة",
        resultStatus: "حالة النتيجة",
      },
      draftChanges: "مسودة التغييرات",
      editWording: "تحرير الصياغة",
      emptyDetail:
        "تظهر لقطات المصدر الجديدة هنا عندما يحتاج Brain إلى مراجع قبل تحويلها إلى معرفة بالشركة.",
      evidenceQuoteUnavailable: "اقتباس الأدلة غير متوفر",
      hideEditor: "إخفاء المحرر",
      knowledgeBody: "هيئة المعرفة",
      moreActions: "المزيد من إجراءات المراجعة",
      noFlags: "لا أعلام",
      noPrivacyDetail:
        "لم يتم إرفاق أي تحذير بشأن التنقيح أو التصدير أو الرؤية.",
      noProposedKnowledge: "لا توجد معرفة مقترحة.",
      noSnippets: "لا مقتطفات",
      noSourceSnippets: "لم يتم إرفاق أي مقتطفات من المصدر بهذا الاقتراح.",
      notRecorded: "لم يتم تسجيلها",
      notScored: "لم يسجل",
      pendingProposals: "المقترحات المعلقة",
      previewCompanyContext: "معاينة سياق الشركة",
      privacy: {
        canonicalExport: "التصدير الكنسي",
        companyTierKnowledge: "المعرفة على مستوى الشركة",
        noPrivacyFlags: "لا توجد أعلام الخصوصية",
        redactedContent: "المحتوى المنقح",
      },
      privacyFlags: "أعلام الخصوصية",
      proposedKnowledge: "المعرفة المقترحة",
      publishCompanyContext: "نشر كسياق الشركة",
      queueReason: {
        companyTier: "تتطلب المعرفة على مستوى الشركة موافقة المراجع.",
        default:
          "في قائمة الانتظار للحصول على موافقة المراجع قبل أن تصبح معرفة دائمة بالشركة.",
        privacySensitive:
          "يحتاج المحتوى الحساس للخصوصية أو المنقح إلى تأكيد المراجع.",
      },
      queuedProposal: "اقتراح في قائمة الانتظار",
      rationalePlaceholder: "لماذا يجب أن تصبح هذه المعرفة الدائمة",
      rejectedProposals: "المقترحات المرفوضة",
      reviewBeforeApproving: "المراجعة قبل الموافقة.",
      reviewSignals: "إشارات المراجعة",
      reviewerNotesPlaceholder: "السياق الاختياري لهذا القرار",
      reviewerNotes: "ملاحظات المراجع",
      reviewerQueue: "قائمة انتظار المراجعين",
      saveWording: "حفظ الصياغة",
      target: {
        archiveKnowledgeDetail:
          "تشير الموافقة إلى أن المعرفة المستهدفة مؤرشفة.",
        archiveKnowledge: "أرشفة المعرفة",
        createNewDetail: "تضيف الموافقة إدخالاً جديدًا للمعرفة الدائمة للشركة.",
        createNew: "خلق معرفة جديدة",
        mergeExisting: "الاندماج في المعرفة الموجودة",
        mergeUpdateSupersede: "دمج التحديث والاستبدال",
        supersedeExisting: "تحل محل المعرفة الموجودة",
      },
      targetAndPayload: "الهدف والحمولة",
      targetContext: "السياق المستهدف",
      unsavedEdits: "التعديلات غير المحفوظة",
      whyQueued: "لماذا في قائمة الانتظار",
    },
    searchPage: {
      allSources: "جميع المصادر",
      allStatuses: "جميع الحالات",
      allTypes: "جميع الأنواع",
      citationQuote: "اقتباس الاقتباس",
      companyKnowledge: "معرفة الشركة",
      description:
        "ابحث في المعرفة التي تمت مراجعتها، والتقاطات الأولية، وسجلات المصدر، ثم افتح سجل Brain المستشهد به أو المصدر الأصلي.",
      inTheseResults: "في هذه النتائج",
      matchedIndex: "تطابقت هذه النتيجة مع فهرس البحث الحالي.",
      noCitationQuote: "لا يوجد اقتباس الاقتباس متاح.",
      noExcerpt: "لا يوجد مقتطف متاح.",
      noMatchesDetail: "قم بتوسيع الاستعلام أو مسح عامل التصفية.",
      noMatchesTitle: "لا توجد معرفة تتطابق مع هذه المرشحات",
      noSummary: "لا يوجد ملخص متاح لهذه النتيجة.",
      notAvailable: "غير متوفر",
      openBrainRecord: "افتح سجل Brain",
      openRelatedSource: "فتح المصدر ذات الصلة",
      openSourceUrl: "عنوان URL مفتوح المصدر",
      openSource: "مفتوح المصدر",
      searchPlaceholder:
        "قرارات البحث أو حقائق العملاء أو أسماء المصادر أو النصوص أو مقتطفات السياسة...",
      startDetail: "أدخل عبارة للبحث عن معلومات الشركة المذكورة.",
      startTitle: "ابدأ بالبحث عن المعرفة الخاصة بالشركة",
      title: "البحث عن معرفة الشركة",
      unavailableDetail:
        "قم بتحديث الصفحة وحاول مرة أخرى بمجرد انتهاء تحميل Brain.",
      unavailableTitle: "البحث غير متاح",
      untitledResult: "نتيجة بلا عنوان",
      viewInBrain: "عرض في Brain",
      whyMatched: "لماذا هذا المتطابقة",
    },
    settings: {
      actionsUnavailableDetail:
        "هذه الصفحة متصلة بـ get-brain-settings وupdate-brain-settings وتستخدم الإعدادات الافتراضية في الوقت الحالي.",
      actionsUnavailableTitle: "إجراءات الإعدادات غير متاحة بعد",
      assistantBehaviorDescription:
        "الصوت الافتراضي ووضعية المصدر للإجابات ومقترحات المعرفة المقطرة.",
      autoArchiveResolvedDescription:
        "قم بإزالة عناصر قائمة الانتظار المعتمدة أو المرفوضة من مسار المراجعة النشط.",
      autoArchiveResolved: "الأرشفة التلقائية لعناصر المراجعة التي تم حلها",
      autoPublishGateDescription: "سياسة وقت التشغيل للمعرفة على مستوى الشركة.",
      autoPublishGateDetail:
        "يمكن نشر معرفة الشركة عالية الثقة تلقائيًا عندما تكون جديدة وغير منقحة ولا تتطلب اقتراحًا صريحًا.",
      autoRedactEmailsDescription:
        "قم بإزالة عناوين البريد الإلكتروني من المعرفة المقطرة ما لم تكن أدلة أساسية.",
      autoRedactEmails: "تنقيح رسائل البريد الإلكتروني تلقائيًا",
      confidenceThreshold: "عتبة الثقة",
      connectorPollInterval: "الفاصل الزمني لاستقصاء الرابط",
      coreInstructionsDescription:
        "إرشادات لتحويل المواد الخام إلى معرفة مؤسسية دائمة.",
      coreInstructions: "التعليمات الأساسية",
      defaultPublishTierDescription:
        "يضبط الرؤية الافتراضية للمعرفة المقطرة حديثًا.",
      defaultPublishTier: "طبقة النشر الافتراضية",
      identityDescription:
        "الأسماء Brain تستخدم عندما تصف نفسها ومساحة العمل التي تحميها.",
      notRequired: "غير مطلوب",
      notSet: "لم يتم ضبطه",
      notifySourceErrorsDescription:
        "سطح الموصلات المتدهورة أو الفاشلة في تدفق المراجعة.",
      notifySourceErrors: "إخطار على أخطاء المصدر",
      policy: {
        preSaveFilter: "مرشح الحفظ المسبق",
        publishTier: "نشر الطبقة",
      },
      publishingReviewDescription:
        "الإعدادات الافتراضية للرؤية والموافقة وإيقاع الموصل.",
      requireApprovalDescription:
        "قم بوضع المرشحين ذوي المعرفة على مستوى الشركة في قائمة الانتظار للمراجعة البشرية قبل النشر.",
      requireApproval: "تتطلب الموافقة على معرفة الشركة",
      requireCitationsDescription:
        "يجب أن يستشهد السؤال Brain بصفوف المصدر المعتمدة للحصول على الإجابات الواقعية.",
      requireCitations: "تتطلب الاستشهادات",
      safetyEvidenceDescription:
        "قواعد التنقيح والاقتباس للإجابات التي تخرج من قائمة انتظار المراجعة.",
      sanitizationInstructions: "تعليمات التعقيم",
      sanitizationModelDescription:
        "تجاوز اختياري لتمرير التصفية للحفظ المسبق.",
      sanitizationModelPlaceholder: "نموذج الوكيل الافتراضي أو نموذج فلاش أرخص",
      sanitizationModel: "نموذج التعقيم",
      sanitizeCapturesDescription:
        "قم بتصفية Granola وClips وخطاف الويب والنص اليدوي الذي يتم استيراده وصولاً إلى المحتوى ذي الصلة بالشركة قبل الحفظ.",
      sanitizeCaptures: "تعقيم لقطات النص قبل التخزين",
      sourcePolicy: {
        balanced: {
          description: "تفضيل المعرفة المعتمدة، ثم تحديد فجوات المصدر.",
        },
        exploratory: {
          description: "استخدم إشارات أضعف ولكن قم بتسمية عدم اليقين بوضوح.",
        },
        strict: {
          description: "الإجابة من المعرفة المعتمدة والاستشهادات فقط.",
        },
      },
      tone: {
        direct: {
          description: "موجزة وملموسة وموجهة نحو اتخاذ القرار.",
        },
        formal: {
          description: "حذر، وجاهز للسياسة، ويواجه السلطة التنفيذية.",
        },
        friendly: {
          description: "دافئة وصريحة دون فقدان الدقة.",
        },
        technical: {
          description: "تفصيلية، ثقيلة المصدر، واعية بالتنفيذ.",
        },
      },
    },
    sources: {
      actionFailedDetail:
        "تحقق من بيانات اعتماد المصدر وقوائم القنوات المسموح بها وآخر خطأ في المزامنة.",
      actionFailedTitle: "فشل إجراء المصدر",
      advancedDescription:
        "تصفية المصادر والتحقق من جاهزية الاتصال وتشغيل عمليات مزامنة الصيانة عندما لا تكون قائمة المصادر العادية كافية.",
      advancedTitle: "ضوابط المصدر المتقدمة",
      allowedChannelsDescription:
        "يتحقق Brain من القائمة المسموح بها، ويرفض DMs/MPIMs، ولا يخزن أبدًا قيم بيانات الاعتماد في تكوين المصدر.",
      allowedChannels: "القنوات المسموح بها",
      approvedRepositories: "المستودعات المعتمدة",
      autoSyncDescription: "يستخدم استطلاع الخلفية هذا المصدر عند استحقاقه",
      autoSync: "المزامنة التلقائية",
      automaticCredentialSelection: "اختيار بيانات الاعتماد التلقائي",
      batchDistillationDescription:
        "حدد اللقطات القابلة للوضع في قائمة الانتظار وقم بتسليمها إلى عامل التقطير Brain معًا.",
      batchDistillation: "التقطير الدفعي",
      brainAppGrant: "Brain منحة التطبيق",
      brainHealth: "Brain الصحة",
      captureInventoryFailedDetail: "تحقق من الوصول إلى المصدر وحاول مرة أخرى.",
      captureInventoryFailedTitle: "فشل التقاط المخزون",
      catalogKeys: "مفاتيح الكتالوج",
      connectProvider: "ربط المزود",
      connectTheProvider: "قم بتوصيل الموفر",
      connectionMetadataOnlyDetail:
        "يمكن لـ Brain إعادة استخدام بيانات تعريف الاتصال هذه، ولكن لم تتم إضافة إعداد المصدر لهذا الموفر إلى هذا القالب بعد.",
      connectionMetadataOnly: "بيانات تعريف الاتصال فقط",
      connectionProvidersDescription:
        "أعد استخدام عمليات تكامل مساحة العمل، أو امنح Brain حق الوصول، أو أضف Brain-مصادر محلية دون الكشف عن قيم الاعتماد.",
      connectionProviders: "مقدمي الاتصال",
      connectionReadiness: "جاهزية الاتصال",
      credentialPath: "مسار الاعتماد",
      credentialProvenance: "مصدر الاعتماد",
      credentialRefs: "مراجع الاعتماد",
      defaultTitle: {
        clips: "Clips الصادرات",
        generic: "خطاف ويب للنص العام",
        github: "GitHub ريبوش المنتج",
        granola: "Granola ملاحظات الفريق",
        manual: "الواردات اليدوية",
        slack: "Slack قنوات المعرفة",
      },
      description:
        "قم بتوصيل الأماكن المعتمدة التي يمكن لـ Brain التعلم منها، ثم قم بمزامنتها ومراجعتها حسب الحاجة.",
      emptyDetail:
        "أضف قناة Slack معتمدة، أو Granola Team-space مصدر، أو GitHub repo، أو Clips تصدير، أو استيراد يدوي، أو خطاف ويب موقّع.",
      emptyTitle: "قم بتوصيل المصدر الأول لـ Brain",
      githubRepositoriesDescription:
        "يقوم Brain باستيراد الإصدار المحدود وسياق طلب السحب من هذه المستودعات باستخدام بيانات اعتماد مساحة العمل GitHub.",
      grantBrainAccess: "منح حق الوصول Brain",
      grantConnectionBeforePinning:
        "امنح اتصال مساحة عمل بـ Brain في Dispatch قبل تثبيت هذا المصدر.",
      grantInDispatch: "المنحة في Dispatch",
      healthReady:
        "المصادر وقائمة انتظار المراجعة وعمليات التحقق من الاسترجاع جاهزة للاستخدام العادي.",
      hideDetails: "إخفاء التفاصيل",
      includeIssues: "تضمين القضايا",
      includePullRequests: "تضمين طلبات السحب",
      initialUpdatedAfter: "التحديث الأولي بعد",
      itemsPerRepo: "العناصر لكل الريبو",
      lastSync: "آخر مزامنة",
      loadingProviderCatalog: "جارٍ تحميل كتالوج الموفر...",
      messagesPerPage: "الرسائل لكل صفحة",
      nextCheck: "الاختيار التالي",
      noBrainSourcesYet: "لا يوجد مصادر Brain حتى الآن",
      noCapturesDetail:
        "جرب حالة أخرى، أو قم بتشغيل مزامنة المصدر، أو قم باستيراد نص.",
      noCapturesTitle: "لا توجد لقطات تطابق هذا الرأي",
      noConnectionProviders:
        "لا يتوفر أي موفري اتصال Brain من الكتالوج المشترك.",
      noCredentialKeysRequired: "لا توجد مفاتيح الاعتماد المطلوبة",
      noCredentialRefs: "لا توجد مراجع بيانات الاعتماد على هذا الاتصال",
      noCredentialRequired: "لا توجد بيانات الاعتماد المطلوبة",
      noSharedWorkspaceConnection:
        "لم يتم تسجيل أي اتصال بمساحة عمل مشتركة لهذا الموفر حتى الآن.",
      noSyncYet: "لا توجد مزامنة بعد",
      pageSize: "حجم الصفحة",
      pickGrantedConnection:
        "اختر اتصالاً ممنوحًا لتثبيت هذا المصدر، أو اتركه تلقائيًا لاستخدام الإجراء الاحتياطي الحالي لبيانات الاعتماد.",
      pollMinutes: "محضر الاستطلاع",
      previewsDescription: "عرض مقتطفات قصيرة للمراجعة المتعمدة",
      provenance: {
        brainLocalCredential: "Brain-بيانات الاعتماد المحلية",
        credentialSource: "مصدر الاعتماد",
        credentialVault: "قبو بيانات الاعتماد",
        explicitBrainGrant: "منحة Brain صريحة",
      },
      providerConnection: "اتصال المزود",
      queueSelected: "تم تحديد قائمة الانتظار",
      rawContentHidden:
        "المحتوى الخام مخفي. تمكين المعاينات أو فتح المصدر فقط عندما تتطلب المراجعة سياقًا.",
      readiness: {
        accessGrantedConnectionInactive:
          "تم منح الوصول، لكن الاتصال لم يتم تنشيطه بعد.",
        addReusableConnection:
          "أضف اتصال موفر قابل لإعادة الاستخدام في Dispatch.",
        addSharedOrScopedCredential:
          "أضف اتصال موفر مشترك أو بيانات اعتماد Brain محددة النطاق.",
        brainCanUseSharedConnection:
          "يمكن لـ Brain استخدام اتصال مساحة العمل المشتركة.",
        brainLocal: "Brain-محلي",
        credentialNotLoaded: "لم يتم تحميل توفر بيانات الاعتماد بعد.",
        grantAppearsAfterConnection:
          "تظهر المنحة بعد وجود اتصال موفر مساحة العمل.",
        grantExistingConnection: "امنح اتصال الموفر الحالي بتطبيق Brain.",
        grantNeedsAttention:
          "Brain لديه منحة، لكن اتصال الموفر يحتاج إلى الاهتمام.",
        grantedRepair: "منح، إصلاح",
        noCredentialKeyRequired: "لا يتطلب هذا الموفر مفتاح اعتماد.",
        noGrant: "لا منحة",
        notNeeded: "ليست هناك حاجة",
        providerNeedsAppAccess:
          "الموفر متصل، ولكن Brain يحتاج إلى الوصول إلى التطبيق.",
        providerNoCredential: "يمكن تكوين هذا الموفر بدون مفتاح اعتماد.",
        providerUnknown: "لا يمكن تحديد مدى استعداد الموفر.",
        readyForSourceSetup: "جاهز لإعداد المصدر.",
        readyThroughScopedRefs:
          "جاهز من خلال مراجع بيانات الاعتماد Brain المحددة النطاق.",
        readyThroughSharedConnection: "جاهز من خلال اتصال مساحة عمل مشتركة.",
        reauthorizeProviderConnection:
          "إعادة تخويل أو إصلاح اتصال الموفر المشترك.",
        registeredCredentialRefAvailable:
          "يتوفر مرجع بيانات الاعتماد المسجل في الخزنة.",
        requiredCredentialRefsAvailable:
          "تتوفر مراجع بيانات الاعتماد المطلوبة دون الكشف عن القيم.",
        reuseProviderConnection:
          "يمكن لـ Brain إعادة استخدام اتصال الموفر دون إظهار القيم.",
        scopedCredentialRefsConfigured:
          "تم تكوين مراجع بيانات الاعتماد ذات النطاق Brain.",
        scopedCredentialsAvailable:
          "بيانات الاعتماد ذات النطاق Brain متاحة بالفعل.",
        scopedLocalCredentialRefs:
          "لا يزال بإمكان Brain استخدام مراجع بيانات الاعتماد المحلية المحددة النطاق.",
        sourceSetupNotImplemented:
          "لم يتم تنفيذ إعداد المصدر Brain لهذا الموفر.",
        workspaceConnectionGrantable:
          "يوجد اتصال بمساحة العمل ويمكن منحه إلى Brain.",
        workspaceNotLoaded: "لم يتم تحميل حالة اتصال مساحة العمل بعد.",
      },
      reviewRawCapturesDescription:
        "مراجعة المواد الخام المستوردة قبل التقطير.",
      reviewRawCaptures: "مراجعة اللقطات الخام",
      reviewRequiredDescription:
        "قائمة الانتظار استخراج المعرفة قبل الموافقة عليها",
      reviewRequired: "المراجعة مطلوبة",
      runDueSyncs: "تشغيل المزامنات المستحقة",
      scopedCredentialsReady: "أوراق الاعتماد ذات النطاق جاهزة",
      selectAll: "حدد الكل",
      sharedConnection: "اتصال مشترك",
      sharedWorkspaceConnectionReady: "اتصال مساحة العمل المشتركة جاهز",
      slackAccessRuleScopes:
        "يجب أن يدعم الوصول Slack auth.test وconversations.info/history وchat.getPermalink. أضف إمكانية الوصول إلى القناة الخاصة عند تجربة القنوات الخاصة.",
      slackAccessRules: "Slack قواعد الوصول",
      slackSetupAllowList:
        "معرفات القنوات المعتمدة للقائمة المسموح بها مثل C0123456789، أو أسماء القنوات مثل #product عندما يكون تحليل الاسم مقبولاً.",
      slackSetupGuide: "Slack دليل الإعداد",
      slackSetupPrivateChannels:
        "قم بدعوة تطبيق Slack إلى القنوات الخاصة قبل المزامنة. يظل DMs وMPIMs مستبعدين.",
      slackSetupScopes:
        "الحد الأدنى للنطاقات هو channels:read وchannels:history. أضف groups:read وgroups:history للقنوات الخاصة.",
      syncNow: "مزامنة الآن",
      tuneSource: "لحن المصدر",
      unselectAll: "قم بإلغاء تحديد الكل",
      valuesHidden: "القيم مخفية",
      waitingForWorker:
        "في انتظار قيام عامل التقطير Brain بكتابة المعرفة أو إرسال هذا الالتقاط للمراجعة.",
      webhookSourceKeyDescription:
        "تتلقى المصادر الجديدة رمزًا مميزًا للتناول لمرة واحدة. تحتفظ المصادر الموجودة برموزها المميزة ما لم يتم تدويرها بشكل منفصل.",
      webhookSourceKey: "Webhook مفتاح المصدر",
      workspaceConnections: "اتصالات مساحة العمل",
      workspaceConnection: "اتصال مساحة العمل",
    },
  },
  "de-DE": {
    ask: {
      composerPlaceholder: "Fragen Sie nach Unternehmenskenntnissen...",
      emptyState: "Fragen Sie Brain nach Unternehmenskenntnissen.",
      heroDescription: "Brain Antworten aus zitiertem Unternehmenswissen.",
      heroTitle: "Was möchtest du wissen?",
    },
    ops: {
      allQueueItems: "Alle Warteschlangenelemente",
      allStatuses: "Alle Status",
      description:
        "Überwachen Sie Brain-Destillationsübergaben, veraltete Worker und wiederholbare Fehler aus einer kompakten Warteschlangenansicht.",
      noIssueRecorded: "Kein Problem aufgezeichnet",
      noItemsDetail:
        "Ändern Sie den Status oder den Issue-Filter oder warten Sie, bis neue Captures in die Destillation aufgenommen werden.",
      noItemsTitle:
        "Mit dieser Ansicht stimmen keine Warteschlangenelemente überein",
      noRetryableFound:
        "Es wurden keine wiederholbaren Destillationselemente gefunden",
      queueIssue: "Problem mit der Warteschlange",
      queueUnavailableDetail:
        "Brain konnte zugängliche Elemente der Destillationswarteschlange nicht laden.",
      queueUnavailableTitle: "Warteschlange nicht verfügbar",
      retryAllRetryable: "Wiederholen Sie alle wiederholbaren Versuche",
      retryControls: "Wiederholen Sie die Kontrollen",
      retryFailedDetail:
        "Das Warteschlangenelement ist möglicherweise bereits erledigt, aktiv oder nicht mehr zugänglich.",
      retryFailed: "Wiederholungsversuch fehlgeschlagen",
      retrySelected: "Wiederholen ausgewählt",
      runAfter: "Lauf hinterher",
      selectRetryable: "Wählen Sie „Wiederholbar“ aus",
      staleProcessing: "Veraltete Verarbeitung",
      title: "Destillationsvorgänge",
      unselectRetryable: "Deaktivieren Sie „Wiederholbar“.",
    },
    review: {
      actionFailedDetail:
        "Brain konnte Vorschläge nicht laden oder aktualisieren.",
      actionFailedTitle: "Die Überprüfungsaktion ist fehlgeschlagen",
      approvalSavesEdits:
        "Bei der Genehmigung werden zunächst Formulierungsänderungen gespeichert.",
      approveKnowledge: "Wissen genehmigen",
      approveRedactedDraft: "Genehmigen Sie den redigierten Entwurf",
      approveReplacement: "Ersatz genehmigen",
      approveUpdate: "Aktualisierung genehmigen",
      approvedProposals: "Genehmigte Vorschläge",
      capturedSource: "Erfasste Quelle",
      companyContext: "Unternehmenskontext",
      currentDraft: "Aktueller Entwurf",
      description:
        "Genehmigen Sie nur die vorgeschlagenen Erinnerungen, die einen dauerhaften Wert haben, von der Quelle unterstützt werden und den richtigen Datenschutz gewährleisten.",
      details: {
        knowledgeTarget: "Wissensziel",
        publishTier: "Veröffentlichungsstufe",
        resultStatus: "Ergebnisstatus",
      },
      draftChanges: "Entwurfsänderungen",
      editWording: "Bearbeiten Sie den Wortlaut",
      emptyDetail:
        "Neue Quellenerfassungen werden hier angezeigt, wenn Brain einen Prüfer benötigt, bevor sie in Unternehmenswissen umgewandelt werden.",
      evidenceQuoteUnavailable: "Beweiszitat nicht verfügbar",
      hideEditor: "Editor ausblenden",
      knowledgeBody: "Wissenskörper",
      moreActions: "Weitere Bewertungsaktionen",
      noFlags: "Keine Flaggen",
      noPrivacyDetail:
        "Es wurde keine Schwärzungs-, Export- oder Sichtbarkeitswarnung angehängt.",
      noProposedKnowledge: "Kein vorgeschlagenes Wissen.",
      noSnippets: "Keine Schnipsel",
      noSourceSnippets:
        "Diesem Vorschlag wurden keine Quelltextausschnitte beigefügt.",
      notRecorded: "Nicht aufgezeichnet",
      notScored: "Nicht gepunktet",
      pendingProposals: "Ausstehende Vorschläge",
      previewCompanyContext: "Vorschau des Unternehmenskontexts",
      privacy: {
        canonicalExport: "Kanonischer Export",
        companyTierKnowledge: "Wissen auf Unternehmensebene",
        noPrivacyFlags: "Keine Datenschutzflags",
        redactedContent: "Redigierter Inhalt",
      },
      privacyFlags: "Datenschutzflags",
      proposedKnowledge: "Vorgeschlagenes Wissen",
      publishCompanyContext: "Als Unternehmenskontext veröffentlichen",
      queueReason: {
        companyTier:
          "Kenntnisse auf Unternehmensebene erfordern die Genehmigung eines Gutachters.",
        default:
          "Steht für die Genehmigung durch den Prüfer in der Warteschlange, bevor es zu dauerhaftem Unternehmenswissen wird.",
        privacySensitive:
          "Datenschutzrelevante oder redigierte Inhalte benötigen eine Bestätigung durch den Prüfer.",
      },
      queuedProposal: "Vorschlag in der Warteschlange",
      rationalePlaceholder: "Warum daraus dauerhaftes Wissen werden sollte",
      rejectedProposals: "Abgelehnte Vorschläge",
      reviewBeforeApproving: "Überprüfen Sie es vor der Genehmigung.",
      reviewSignals: "Überprüfen Sie Signale",
      reviewerNotesPlaceholder: "Optionaler Kontext für diese Entscheidung",
      reviewerNotes: "Anmerkungen des Rezensenten",
      reviewerQueue: "Prüferwarteschlange",
      saveWording: "Formulierungen speichern",
      target: {
        archiveKnowledgeDetail:
          "Durch die Genehmigung wird das Zielwissen als archiviert markiert.",
        archiveKnowledge: "Archivwissen",
        createNewDetail:
          "Durch die Genehmigung wird ein neuer dauerhafter Unternehmenswissenseintrag hinzugefügt.",
        createNew: "Neues Wissen schaffen",
        mergeExisting: "Einbinden in vorhandenes Wissen",
        mergeUpdateSupersede: "Aktualisierung zusammenführen und ersetzen",
        supersedeExisting: "Vorhandenes Wissen ablösen",
      },
      targetAndPayload: "Ziel und Nutzlast",
      targetContext: "Zielkontext",
      unsavedEdits: "Nicht gespeicherte Änderungen",
      whyQueued: "Warum in der Warteschlange",
    },
    searchPage: {
      allSources: "Alle Quellen",
      allStatuses: "Alle Status",
      allTypes: "Alle Arten",
      citationQuote: "Zitatzitat",
      companyKnowledge: "Unternehmenswissen",
      description:
        "Durchsuchen Sie überprüftes Wissen, Roherfassungen und Quelldatensätze und öffnen Sie dann den zitierten Brain-Datensatz oder die Originalquelle.",
      inTheseResults: "In diesen Ergebnissen",
      matchedIndex:
        "Dieses Ergebnis stimmte mit dem aktuellen Suchindex überein.",
      noCitationQuote: "Es ist kein Zitierangebot verfügbar.",
      noExcerpt: "Es liegt kein Auszug vor.",
      noMatchesDetail:
        "Erweitern Sie die Abfrage oder löschen Sie einen Filter.",
      noMatchesTitle: "Kein Wissen entspricht diesen Filtern",
      noSummary: "Für dieses Ergebnis ist keine Zusammenfassung verfügbar.",
      notAvailable: "Nicht verfügbar",
      openBrainRecord: "Öffnen Sie den Datensatz Brain",
      openRelatedSource: "Öffnen Sie die entsprechende Quelle",
      openSourceUrl: "Open-Source-URL",
      openSource: "Open Source",
      searchPlaceholder:
        "Suchentscheidungen, Kundenfakten, Quellennamen, Transkripte oder Richtlinienausschnitte...",
      startDetail:
        "Geben Sie einen Begriff ein, um nach zitiertem Unternehmenswissen zu suchen.",
      startTitle: "Beginnen Sie mit einer Suche nach Unternehmenswissen",
      title: "Unternehmenswissen durchsuchen",
      unavailableDetail:
        "Aktualisieren Sie die Seite und versuchen Sie es erneut, sobald Brain vollständig geladen ist.",
      unavailableTitle: "Die Suche ist nicht verfügbar",
      untitledResult: "Ergebnis ohne Titel",
      viewInBrain: "Anzeigen in Brain",
      whyMatched: "Warum das zusammenpasste",
    },
    settings: {
      actionsUnavailableDetail:
        "Diese Seite ist mit get-brain-settings und update-brain-settings verbunden und verwendet derzeit die Standardeinstellungen.",
      actionsUnavailableTitle: "Einstellungsaktionen sind noch nicht verfügbar",
      assistantBehaviorDescription:
        "Die standardmäßige Sprach- und Quellenhaltung für Antworten und destillierte Wissensvorschläge.",
      autoArchiveResolvedDescription:
        "Entfernen Sie genehmigte oder abgelehnte Warteschlangenelemente aus der aktiven Überprüfungsspur.",
      autoArchiveResolved:
        "Aufgelöste Bewertungselemente automatisch archivieren",
      autoPublishGateDescription:
        "Laufzeitrichtlinie für Wissen auf Unternehmensebene.",
      autoPublishGateDetail:
        "Unternehmenswissen mit hoher Zuverlässigkeit kann automatisch veröffentlicht werden, wenn es neu und nicht redigiert ist und kein expliziter Vorschlag erforderlich ist.",
      autoRedactEmailsDescription:
        "Entfernen Sie E-Mail-Adressen aus destilliertem Wissen, es sei denn, sie stellen einen wesentlichen Beweis dar.",
      autoRedactEmails: "E-Mails automatisch schwärzen",
      confidenceThreshold: "Vertrauensschwelle",
      connectorPollInterval: "Connector-Abfrageintervall",
      coreInstructionsDescription:
        "Anleitung zur Umwandlung von Rohdaten in dauerhaftes institutionelles Wissen.",
      coreInstructions: "Kernanweisungen",
      defaultPublishTierDescription:
        "Legt die Standardsichtbarkeit für neu destilliertes Wissen fest.",
      defaultPublishTier: "Standardveröffentlichungsebene",
      identityDescription:
        "Die Namen, die Brain verwendet, wenn es sich selbst und den Arbeitsbereich beschreibt, den es schützt.",
      notRequired: "Nicht erforderlich",
      notSet: "Nicht festgelegt",
      notifySourceErrorsDescription:
        "Oberflächenbeeinträchtigung oder fehlerhafte Anschlüsse im Überprüfungsablauf.",
      notifySourceErrors: "Bei Quellfehlern benachrichtigen",
      policy: {
        preSaveFilter: "Vorspeicherfilter",
        publishTier: "Veröffentlichungsstufe",
      },
      publishingReviewDescription:
        "Standardwerte für Sichtbarkeit, Genehmigung und Connector-Taktfrequenz.",
      requireApprovalDescription:
        "Stellen Sie unternehmensweite Wissenskandidaten vor der Veröffentlichung zur menschlichen Prüfung in die Warteschlange.",
      requireApproval:
        "Für Unternehmenskenntnisse ist eine Genehmigung erforderlich",
      requireCitationsDescription:
        "Bitten Sie Brain, für sachliche Antworten müssen genehmigte Quellenzeilen zitiert werden.",
      requireCitations: "Erfordern Zitate",
      safetyEvidenceDescription:
        "Schwärzungs- und Zitierregeln für Antworten, die die Überprüfungswarteschlange verlassen.",
      sanitizationInstructions: "Anweisungen zur Desinfektion",
      sanitizationModelDescription:
        "Optionale Überschreibung für den Filterdurchlauf vor dem Speichern.",
      sanitizationModelPlaceholder:
        "Standard-Agent-Modell oder ein günstigeres Flash-Modell",
      sanitizationModel: "Desinfektionsmodell",
      sanitizeCapturesDescription:
        "Filtern Sie Granola, Clips, Webhook und manuelle Transkriptimporte vor dem Speichern nach unternehmensrelevanten Inhalten.",
      sanitizeCaptures:
        "Bereinigen Sie Transkripterfassungen vor der Speicherung",
      sourcePolicy: {
        balanced: {
          description:
            "Bevorzugen Sie anerkanntes Wissen und identifizieren Sie dann Quellenlücken.",
        },
        exploratory: {
          description:
            "Verwenden Sie schwächere Signale, kennzeichnen Sie die Unsicherheit jedoch deutlich.",
        },
        strict: {
          description: "Antworten Sie nur mit anerkanntem Wissen und Zitaten.",
        },
      },
      tone: {
        direct: {
          description: "Prägnant, konkret und entscheidungsorientiert.",
        },
        formal: {
          description:
            "Sorgfältig, richtlinienorientiert und führungsorientiert.",
        },
        friendly: {
          description: "Warm und klar, ohne an Präzision einzubüßen.",
        },
        technical: {
          description: "Detailliert, quellenlastig und umsetzungsorientiert.",
        },
      },
    },
    sources: {
      actionFailedDetail:
        "Überprüfen Sie die Anmeldeinformationen der Quelle, die Kanalzulassungslisten und den letzten Synchronisierungsfehler.",
      actionFailedTitle: "Quellaktion fehlgeschlagen",
      advancedDescription:
        "Filtern Sie Quellen, prüfen Sie die Verbindungsbereitschaft und führen Sie Wartungssynchronisierungen durch, wenn die normale Quellenliste nicht ausreicht.",
      advancedTitle: "Erweiterte Quellcodeverwaltung",
      allowedChannelsDescription:
        "Brain überprüft die Zulassungsliste, lehnt DMs/MPIMs ab und speichert niemals Anmeldeinformationswerte in der Quellkonfiguration.",
      allowedChannels: "Zulässige Kanäle",
      approvedRepositories: "Zugelassene Repositories",
      autoSyncDescription:
        "Bei der Hintergrundabfrage wird bei Fälligkeit diese Quelle verwendet",
      autoSync: "Automatische Synchronisierung",
      automaticCredentialSelection:
        "Automatische Auswahl der Anmeldeinformationen",
      batchDistillationDescription:
        "Wählen Sie in die Warteschlange stehende Erfassungen aus und übergeben Sie sie gemeinsam an den Brain-Destillationsmitarbeiter.",
      batchDistillation: "Batch-Destillation",
      brainAppGrant: "Brain App-Zuschuss",
      brainHealth: "Brain Gesundheit",
      captureInventoryFailedDetail:
        "Überprüfen Sie den Quellzugriff und versuchen Sie es erneut.",
      captureInventoryFailedTitle:
        "Die Erfassung des Inventars ist fehlgeschlagen",
      catalogKeys: "Katalogschlüssel",
      connectProvider: "Anbieter verbinden",
      connectTheProvider: "Verbinden Sie den Anbieter",
      connectionMetadataOnlyDetail:
        "Brain kann diese Verbindungsmetadaten wiederverwenden, aber die Quelleinrichtung für diesen Anbieter wurde dieser Vorlage noch nicht hinzugefügt.",
      connectionMetadataOnly: "Nur Verbindungsmetadaten",
      connectionProvidersDescription:
        "Verwenden Sie Arbeitsbereichsintegrationen wieder, gewähren Sie Brain-Zugriff oder fügen Sie Brain-lokale Quellen hinzu, ohne Anmeldeinformationswerte offenzulegen.",
      connectionProviders: "Verbindungsanbieter",
      connectionReadiness: "Verbindungsbereitschaft",
      credentialPath: "Anmeldepfad",
      credentialProvenance: "Herkunft des Berechtigungsnachweises",
      credentialRefs: "Ausweisreferenten",
      defaultTitle: {
        clips: "Clips Exporte",
        generic: "Generischer Transkript-Webhook",
        github: "GitHub Produkt-Repos",
        granola: "Granola Teamnotizen",
        manual: "Manuelle Importe",
        slack: "Slack Wissenskanäle",
      },
      description:
        "Verbinden Sie genehmigte Orte, von denen Brain lernen kann, synchronisieren Sie sie und überprüfen Sie sie bei Bedarf.",
      emptyDetail:
        "Fügen Sie einen genehmigten Slack-Kanal, Granola Team-space-Quelle, GitHub-Repo, Clips-Export, manuellen Import oder signierten Webhook hinzu.",
      emptyTitle: "Verbinden Sie die erste Quelle von Brain",
      githubRepositoriesDescription:
        "Brain importiert begrenzten Issue- und Pull-Request-Kontext aus diesen Repositorys unter Verwendung der Workspace-Anmeldeinformationen GitHub.",
      grantBrainAccess: "Gewähren Sie Brain Zugriff",
      grantConnectionBeforePinning:
        "Gewähren Sie eine Arbeitsbereichsverbindung zu Brain in Dispatch, bevor Sie diese Quelle anpinnen.",
      grantInDispatch: "Zuschuss in Dispatch",
      healthReady:
        "Quellen, Überprüfungswarteschlange und Abrufprüfungen sind für den normalen Gebrauch bereit.",
      hideDetails: "Details ausblenden",
      includeIssues: "Beziehen Sie Probleme mit ein",
      includePullRequests: "Fügen Sie Pull-Anfragen ein",
      initialUpdatedAfter: "Ursprünglich aktualisiert-nachher",
      itemsPerRepo: "Artikel pro Repo",
      lastSync: "Letzte Synchronisierung",
      loadingProviderCatalog: "Anbieterkatalog wird geladen...",
      messagesPerPage: "Nachrichten pro Seite",
      nextCheck: "Nächste Kontrolle",
      noBrainSourcesYet: "Noch keine Brain-Quellen",
      noCapturesDetail:
        "Versuchen Sie es mit einem anderen Status, führen Sie eine Quellsynchronisierung durch oder importieren Sie ein Transkript.",
      noCapturesTitle: "Keine Aufnahmen stimmen mit dieser Ansicht überein",
      noConnectionProviders:
        "Im freigegebenen Katalog sind keine Brain-Verbindungsanbieter verfügbar.",
      noCredentialKeysRequired:
        "Keine Anmeldeinformationsschlüssel erforderlich",
      noCredentialRefs:
        "Für diese Verbindung gibt es keine Anmeldedaten-Referenzen",
      noCredentialRequired: "Kein Ausweis erforderlich",
      noSharedWorkspaceConnection:
        "Für diesen Anbieter wurde noch keine Shared-Workspace-Verbindung registriert.",
      noSyncYet: "Noch keine Synchronisierung",
      pageSize: "Seitengröße",
      pickGrantedConnection:
        "Wählen Sie eine gewährte Verbindung aus, um diese Quelle anzupinnen, oder lassen Sie sie automatisch, um den vorhandenen Fallback für Anmeldeinformationen zu verwenden.",
      pollMinutes: "Umfrageprotokoll",
      previewsDescription:
        "Zeigen Sie kurze Ausschnitte zur gezielten Überprüfung an",
      provenance: {
        brainLocalCredential: "Brain-lokale Anmeldeinformationen",
        credentialSource: "Anmeldeinformationsquelle",
        credentialVault: "Tresor für Anmeldeinformationen",
        explicitBrainGrant: "explizite Brain-Gewährung",
      },
      providerConnection: "Anbieteranbindung",
      queueSelected: "Warteschlange ausgewählt",
      rawContentHidden:
        "Rohinhalt ausgeblendet. Aktivieren Sie Vorschauen oder öffnen Sie die Quelle nur, wenn für die Überprüfung Kontext erforderlich ist.",
      readiness: {
        accessGrantedConnectionInactive:
          "Der Zugriff ist gewährt, die Verbindung ist jedoch noch nicht aktiv.",
        addReusableConnection:
          "Fügen Sie eine wiederverwendbare Anbieterverbindung in Dispatch hinzu.",
        addSharedOrScopedCredential:
          "Fügen Sie eine gemeinsam genutzte Anbieterverbindung oder bereichsbezogene Brain-Anmeldeinformationen hinzu.",
        brainCanUseSharedConnection:
          "Brain kann die gemeinsame Arbeitsbereichsverbindung verwenden.",
        brainLocal: "[de-DE] Brain-local",
        credentialNotLoaded:
          "Die Verfügbarkeit der Anmeldeinformationen wurde noch nicht geladen.",
        grantAppearsAfterConnection:
          "Eine Gewährung wird angezeigt, nachdem eine Workspace-Provider-Verbindung besteht.",
        grantExistingConnection:
          "Gewähren Sie der Brain-App die bestehende Anbieterverbindung.",
        grantNeedsAttention:
          "Brain hat eine Bewilligung, aber die Provider-Verbindung erfordert Aufmerksamkeit.",
        grantedRepair: "Zugegeben, reparieren",
        noCredentialKeyRequired:
          "Für diesen Anbieter ist kein Anmeldeinformationsschlüssel erforderlich.",
        noGrant: "Kein Zuschuss",
        notNeeded: "Nicht erforderlich",
        providerNeedsAppAccess:
          "Der Anbieter ist verbunden, aber Brain benötigt App-Zugriff.",
        providerNoCredential:
          "Dieser Anbieter kann ohne Anmeldeinformationsschlüssel konfiguriert werden.",
        providerUnknown:
          "Die Bereitschaft des Anbieters konnte nicht ermittelt werden.",
        readyForSourceSetup: "Bereit für die Quelleneinrichtung.",
        readyThroughScopedRefs:
          "Bereit durch bereichsbezogene Brain-Anmeldeinformationsreferenzen.",
        readyThroughSharedConnection:
          "Bereit über eine gemeinsame Arbeitsbereichsverbindung.",
        reauthorizeProviderConnection:
          "Autorisieren oder reparieren Sie die freigegebene Anbieterverbindung erneut.",
        registeredCredentialRefAvailable:
          "Im Tresor ist eine registrierte Anmeldeinformationsreferenz verfügbar.",
        requiredCredentialRefsAvailable:
          "Erforderliche Anmeldeinformationsreferenzen sind verfügbar, ohne dass Werte offengelegt werden.",
        reuseProviderConnection:
          "Brain kann die Anbieterverbindung wiederverwenden, ohne Werte anzuzeigen.",
        scopedCredentialRefsConfigured:
          "Gültigkeitsbereichsbezogene Brain-Anmeldeinformationsreferenzen sind konfiguriert.",
        scopedCredentialsAvailable:
          "Gültigkeitsbereichsbezogene Brain-Anmeldeinformationen sind bereits verfügbar.",
        scopedLocalCredentialRefs:
          "Brain kann weiterhin bereichsbezogene lokale Anmeldeinformationsreferenzen verwenden.",
        sourceSetupNotImplemented:
          "Die Brain-Quelleneinrichtung ist für diesen Anbieter nicht implementiert.",
        workspaceConnectionGrantable:
          "Eine Workspace-Verbindung ist vorhanden und kann Brain gewährt werden.",
        workspaceNotLoaded:
          "Der Workspace-Verbindungsstatus wurde noch nicht geladen.",
      },
      reviewRawCapturesDescription:
        "Überprüfen Sie importierte Rohstoffe vor der Destillation.",
      reviewRawCaptures: "Überprüfen Sie Rohaufnahmen",
      reviewRequiredDescription:
        "Extrahiertes Wissen vor der Genehmigung in die Warteschlange stellen",
      reviewRequired: "Überprüfung erforderlich",
      runDueSyncs: "Führen Sie fällige Synchronisierungen durch",
      scopedCredentialsReady: "Begrenzte Anmeldeinformationen bereit",
      selectAll: "Alles auswählen",
      sharedConnection: "Gemeinsame Verbindung",
      sharedWorkspaceConnectionReady:
        "Bereit für die Verbindung zum gemeinsamen Arbeitsbereich",
      slackAccessRuleScopes:
        "Der Slack-Zugriff sollte auth.test, conversations.info/history und chat.getPermalink unterstützen. Fügen Sie beim Pilotieren privater Kanäle den Zugriff auf private Kanäle hinzu.",
      slackAccessRules: "Slack Zugriffsregeln",
      slackSetupAllowList:
        "Setzen Sie genehmigte Kanal-IDs wie C0123456789 oder Kanalnamen wie #product auf die Zulassungsliste, wenn die Namensauflösung akzeptabel ist.",
      slackSetupGuide: "Slack Installationsanleitung",
      slackSetupPrivateChannels:
        "Laden Sie die Slack-App vor der Synchronisierung zu privaten Kanälen ein. DMs und MPIMs bleiben ausgeschlossen.",
      slackSetupScopes:
        "Die Mindestbereiche sind channels:read und channels:history.. Fügen Sie groups:read und groups:history für private Kanäle hinzu.",
      syncNow: "Jetzt synchronisieren",
      tuneSource: "Quelle abstimmen",
      unselectAll: "Alle abwählen",
      valuesHidden: "Werte ausgeblendet",
      waitingForWorker:
        "Ich warte darauf, dass der Brain-Destillationsmitarbeiter Wissen schreibt oder diese Aufnahme zur Überprüfung sendet.",
      webhookSourceKeyDescription:
        "Neue Quellen erhalten ein einmaliges Aufnahme-Token. Bestehende Quellen behalten ihr Token, sofern sie nicht separat rotiert werden.",
      webhookSourceKey: "Webhook Quellschlüssel",
      workspaceConnections: "Arbeitsbereichsverbindungen",
      workspaceConnection: "Arbeitsbereichsverbindung",
    },
  },
  "es-ES": {
    ask: {
      composerPlaceholder: "Pregunta por el conocimiento de la empresa...",
      emptyState: "Pregúntele a Brain sobre el conocimiento de la empresa.",
      heroDescription:
        "Brain responde a partir del conocimiento de la empresa citado.",
      heroTitle: "¿Qué quieres saber?",
    },
    ops: {
      allQueueItems: "Todos los elementos de la cola",
      allStatuses: "Todos los estados",
      description:
        "Supervise las transferencias de destilación Brain, los trabajadores obsoletos y los fallos reintentables desde una vista de cola compacta.",
      noIssueRecorded: "No se registró ningún problema",
      noItemsDetail:
        "Cambie el estado o el filtro de emisión, o espere a que nuevas capturas entren en destilación.",
      noItemsTitle: "Ningún elemento de la cola coincide con esta vista",
      noRetryableFound:
        "No se encontraron elementos de destilación reintentables",
      queueIssue: "Problema de cola",
      queueUnavailableDetail:
        "Brain no pudo cargar elementos de la cola de destilación accesibles.",
      queueUnavailableTitle: "Cola no disponible",
      retryAllRetryable: "Reintentar todo reintentable",
      retryControls: "Controles de reintento",
      retryFailedDetail:
        "Es posible que el elemento de la cola ya esté listo, activo o que ya no sea accesible.",
      retryFailed: "Reintentar falló",
      retrySelected: "Reintentar seleccionado",
      runAfter: "correr tras",
      selectRetryable: "Seleccionar reintentable",
      staleProcessing: "Procesamiento obsoleto",
      title: "Operaciones de destilación",
      unselectRetryable: "Deseleccionar reintentable",
    },
    review: {
      actionFailedDetail: "Brain no pudo cargar ni actualizar propuestas.",
      actionFailedTitle: "Error en la acción de revisión",
      approvalSavesEdits:
        "La aprobación guarda primero las ediciones de redacción.",
      approveKnowledge: "Aprobar conocimientos",
      approveRedactedDraft: "Aprobar borrador redactado",
      approveReplacement: "Aprobar reemplazo",
      approveUpdate: "Aprobar actualización",
      approvedProposals: "Propuestas aprobadas",
      capturedSource: "fuente capturada",
      companyContext: "Contexto de la empresa",
      currentDraft: "Borrador actual",
      description:
        "Aprobar sólo las memorias propuestas que tengan valor duradero, soporte de origen y la postura de privacidad adecuada.",
      details: {
        knowledgeTarget: "Objetivo de conocimiento",
        publishTier: "Nivel de publicación",
        resultStatus: "Estado del resultado",
      },
      draftChanges: "Borradores de cambios",
      editWording: "Editar texto",
      emptyDetail:
        "Aquí aparecen nuevas capturas de fuentes cuando Brain necesita un revisor antes de convertirlas en conocimiento de la empresa.",
      evidenceQuoteUnavailable: "Cita de evidencia no disponible",
      hideEditor: "Ocultar editor",
      knowledgeBody: "cuerpo de conocimiento",
      moreActions: "Más acciones de revisión",
      noFlags: "Sin banderas",
      noPrivacyDetail:
        "No se adjuntó ninguna advertencia de redacción, exportación o visibilidad.",
      noProposedKnowledge: "Ningún conocimiento propuesto.",
      noSnippets: "Sin fragmentos",
      noSourceSnippets:
        "No se adjuntaron fragmentos de fuentes a esta propuesta.",
      notRecorded: "No grabado",
      notScored: "No puntuado",
      pendingProposals: "Propuestas pendientes",
      previewCompanyContext: "Vista previa del contexto de la empresa",
      privacy: {
        canonicalExport: "Exportación canónica",
        companyTierKnowledge: "Conocimiento a nivel de empresa",
        noPrivacyFlags: "Sin banderas de privacidad",
        redactedContent: "Contenido redactado",
      },
      privacyFlags: "Banderas de privacidad",
      proposedKnowledge: "Conocimiento propuesto",
      publishCompanyContext: "Publicar como contexto de la empresa",
      queueReason: {
        companyTier:
          "El conocimiento a nivel de empresa requiere la aprobación del revisor.",
        default:
          "Se puso en cola para obtener la aprobación del revisor antes de convertirse en conocimiento duradero de la empresa.",
        privacySensitive:
          "El contenido redactado o sensible a la privacidad necesita la confirmación del revisor.",
      },
      queuedProposal: "propuesta en cola",
      rationalePlaceholder:
        "Por qué esto debería convertirse en conocimiento duradero",
      rejectedProposals: "Propuestas rechazadas",
      reviewBeforeApproving: "Revisar antes de aprobar.",
      reviewSignals: "Revisar señales",
      reviewerNotesPlaceholder: "Contexto opcional para esta decisión",
      reviewerNotes: "Notas del revisor",
      reviewerQueue: "Cola de revisores",
      saveWording: "Guardar texto",
      target: {
        archiveKnowledgeDetail:
          "La aprobación marca el conocimiento de destino como archivado.",
        archiveKnowledge: "Archivar conocimiento",
        createNewDetail:
          "La aprobación agrega una nueva entrada de conocimiento empresarial duradera.",
        createNew: "Crear nuevos conocimientos",
        mergeExisting: "Fusionarse con el conocimiento existente",
        mergeUpdateSupersede: "Fusionar actualización y reemplazar",
        supersedeExisting: "Reemplazar el conocimiento existente",
      },
      targetAndPayload: "Objetivo y carga útil",
      targetContext: "Contexto objetivo",
      unsavedEdits: "Ediciones no guardadas",
      whyQueued: "¿Por qué hacer cola?",
    },
    searchPage: {
      allSources: "Todas las fuentes",
      allStatuses: "Todos los estados",
      allTypes: "Todos los tipos",
      citationQuote: "citación",
      companyKnowledge: "Conocimiento de la empresa",
      description:
        "Busque conocimientos revisados, capturas sin procesar y registros de fuentes, luego abra el registro Brain citado o la fuente original.",
      inTheseResults: "En estos resultados",
      matchedIndex: "Este resultado coincide con el índice de búsqueda actual.",
      noCitationQuote: "No hay ninguna cita disponible.",
      noExcerpt: "No hay ningún extracto disponible.",
      noMatchesDetail: "Amplíe la consulta o borre un filtro.",
      noMatchesTitle: "Ningún conocimiento coincide con estos filtros",
      noSummary: "No hay ningún resumen disponible para este resultado.",
      notAvailable: "No disponible",
      openBrainRecord: "Abrir registro Brain",
      openRelatedSource: "Abrir fuente relacionada",
      openSourceUrl: "URL de código abierto",
      openSource: "Código abierto",
      searchPlaceholder:
        "Decisiones de búsqueda, datos de clientes, nombres de fuentes, transcripciones o fragmentos de políticas...",
      startDetail:
        "Ingrese una frase para buscar el conocimiento de la empresa citado.",
      startTitle: "Comience con una búsqueda de conocimiento de la empresa",
      title: "Buscar conocimiento de la empresa",
      unavailableDetail:
        "Actualice la página e inténtelo nuevamente una vez que Brain haya terminado de cargarse.",
      unavailableTitle: "La búsqueda no está disponible",
      untitledResult: "Resultado sin título",
      viewInBrain: "Ver en Brain",
      whyMatched: "¿Por qué esto coincide?",
    },
    settings: {
      actionsUnavailableDetail:
        "Esta página está conectada a get-brain-settings y update-brain-settings y utiliza los valores predeterminados por ahora.",
      actionsUnavailableTitle:
        "Las acciones de configuración aún no están disponibles",
      assistantBehaviorDescription:
        "La voz predeterminada y la postura de la fuente para respuestas y propuestas de conocimiento destilado.",
      autoArchiveResolvedDescription:
        "Elimine los elementos de la cola aprobados o rechazados del carril de revisión activo.",
      autoArchiveResolved:
        "Archivar automáticamente elementos de revisión resueltos",
      autoPublishGateDescription:
        "Política de tiempo de ejecución para el conocimiento a nivel de empresa.",
      autoPublishGateDetail:
        "El conocimiento empresarial de alta confianza se puede publicar automáticamente cuando es nuevo, no está redactado y no requiere una propuesta explícita.",
      autoRedactEmailsDescription:
        "Elimine las direcciones de correo electrónico del conocimiento destilado a menos que sean evidencia esencial.",
      autoRedactEmails: "Redactar correos electrónicos automáticamente",
      confidenceThreshold: "Umbral de confianza",
      connectorPollInterval: "Intervalo de sondeo del conector",
      coreInstructionsDescription:
        "Orientación para convertir las capturas en bruto en conocimiento institucional duradero.",
      coreInstructions: "Instrucciones básicas",
      defaultPublishTierDescription:
        "Establece la visibilidad predeterminada para el conocimiento recién destilado.",
      defaultPublishTier: "Nivel de publicación predeterminado",
      identityDescription:
        "Los nombres que utiliza Brain cuando se describe a sí mismo y al espacio de trabajo que protege.",
      notRequired: "No requerido",
      notSet: "No establecido",
      notifySourceErrorsDescription:
        "Conectores de superficie degradada o defectuosos en el flujo de revisión.",
      notifySourceErrors: "Notificar sobre errores de origen",
      policy: {
        preSaveFilter: "Filtro de guardado previo",
        publishTier: "Nivel de publicación",
      },
      publishingReviewDescription:
        "Valores predeterminados para visibilidad, aprobación y cadencia de conector.",
      requireApprovalDescription:
        "Ponga en cola a los candidatos con conocimientos de toda la empresa para su revisión humana antes de publicarlos.",
      requireApproval: "Requerir aprobación para conocimiento de la empresa.",
      requireCitationsDescription:
        "Ask Brain debe citar filas de fuentes aprobadas para obtener respuestas objetivas.",
      requireCitations: "Requerir citas",
      safetyEvidenceDescription:
        "Reglas de redacción y citación para respuestas que salen de la cola de revisión.",
      sanitizationInstructions: "Instrucciones de higienización",
      sanitizationModelDescription:
        "Anulación opcional para el pase de filtrado previo al guardado.",
      sanitizationModelPlaceholder:
        "Modelo de agente predeterminado o un modelo flash más económico",
      sanitizationModel: "Modelo de higienización",
      sanitizeCapturesDescription:
        "Filtre las importaciones de Granola, Clips, webhooks y transcripciones manuales hasta obtener contenido relevante para la empresa antes de guardarlas.",
      sanitizeCaptures:
        "Desinfectar las capturas de transcripciones antes de almacenarlas",
      sourcePolicy: {
        balanced: {
          description:
            "Prefiera conocimientos aprobados y luego identifique las lagunas en las fuentes.",
        },
        exploratory: {
          description:
            "Utilice señales más débiles pero etiquete claramente la incertidumbre.",
        },
        strict: {
          description:
            "Responda únicamente a partir de conocimientos y citas aprobados.",
        },
      },
      tone: {
        direct: {
          description: "Conciso, concreto y orientado a la toma de decisiones.",
        },
        formal: {
          description:
            "Cuidadoso, preparado para las políticas y orientado al ejecutivo.",
        },
        friendly: {
          description: "Cálido y sencillo sin perder precisión.",
        },
        technical: {
          description:
            "Detallado, con gran cantidad de fuentes y consciente de la implementación.",
        },
      },
    },
    sources: {
      actionFailedDetail:
        "Verifique las credenciales de origen, las listas de canales permitidos y el último error de sincronización.",
      actionFailedTitle: "Error en la acción de origen",
      advancedDescription:
        "Filtre fuentes, verifique la preparación de la conexión y ejecute sincronizaciones de mantenimiento cuando la lista de fuentes normal no sea suficiente.",
      advancedTitle: "Controles de fuente avanzados",
      allowedChannelsDescription:
        "Brain verifica la lista de permitidos, rechaza DMs/MPIMs y nunca almacena valores de credenciales en la configuración de origen.",
      allowedChannels: "Canales permitidos",
      approvedRepositories: "Repositorios aprobados",
      autoSyncDescription:
        "Las encuestas de antecedentes utilizan esta fuente cuando corresponde",
      autoSync: "Sincronización automática",
      automaticCredentialSelection: "Selección automática de credenciales",
      batchDistillationDescription:
        "Seleccione capturas que se puedan poner en cola y entréguelas juntas al trabajador de destilación Brain.",
      batchDistillation: "destilación por lotes",
      brainAppGrant: "Brain subvención de aplicación",
      brainHealth: "Brain salud",
      captureInventoryFailedDetail:
        "Verifique el acceso a la fuente e inténtelo nuevamente.",
      captureInventoryFailedTitle: "Error al capturar el inventario",
      catalogKeys: "Claves del catálogo",
      connectProvider: "Conectar proveedor",
      connectTheProvider: "Conectar el proveedor",
      connectionMetadataOnlyDetail:
        "Brain puede reutilizar los metadatos de esta conexión, pero la configuración de origen para este proveedor aún no se ha agregado a esta plantilla.",
      connectionMetadataOnly: "Solo metadatos de conexión",
      connectionProvidersDescription:
        "Reutilice las integraciones del espacio de trabajo, otorgue acceso a Brain o agregue fuentes locales Brain sin exponer los valores de las credenciales.",
      connectionProviders: "Proveedores de conexión",
      connectionReadiness: "Preparación de la conexión",
      credentialPath: "Ruta de credenciales",
      credentialProvenance: "Procedencia de la credencial",
      credentialRefs: "Referencias de credenciales",
      defaultTitle: {
        clips: "Clips exportaciones",
        generic: "Webhook de transcripción genérico",
        github: "GitHub repositorios de productos",
        granola: "Granola notas del equipo",
        manual: "Importaciones manuales",
        slack: "Slack canales de conocimiento",
      },
      description:
        "Conecte lugares aprobados de los que Brain pueda aprender, luego sincronícelos y revíselos según sea necesario.",
      emptyDetail:
        "Agregue un canal Slack aprobado, una fuente Granola Team-space, un repositorio GitHub, una exportación Clips, una importación manual o un webhook firmado.",
      emptyTitle: "Conecte la primera fuente de Brain",
      githubRepositoriesDescription:
        "Brain importa el contexto de solicitud de extracción y problema limitado desde estos repositorios utilizando la credencial del espacio de trabajo GitHub.",
      grantBrainAccess: "Conceder acceso a Brain",
      grantConnectionBeforePinning:
        "Otorgue una conexión de espacio de trabajo a Brain en Dispatch antes de fijar esta fuente.",
      grantInDispatch: "Beca en Dispatch",
      healthReady:
        "Las fuentes, la cola de revisión y las comprobaciones de recuperación están listas para su uso normal.",
      hideDetails: "Ocultar detalles",
      includeIssues: "Incluir problemas",
      includePullRequests: "Incluir solicitudes de extracción",
      initialUpdatedAfter: "Actualizado inicial-después",
      itemsPerRepo: "Artículos por repositorio",
      lastSync: "Última sincronización",
      loadingProviderCatalog: "Cargando catálogo de proveedores...",
      messagesPerPage: "Mensajes por página",
      nextCheck: "Próximo cheque",
      noBrainSourcesYet: "Aún no hay fuentes Brain",
      noCapturesDetail:
        "Pruebe con otro estado, ejecute una sincronización de origen o importe una transcripción.",
      noCapturesTitle: "Ninguna captura coincide con esta vista.",
      noConnectionProviders:
        "No hay proveedores de conexión Brain disponibles en el catálogo compartido.",
      noCredentialKeysRequired: "No se requieren claves de credenciales",
      noCredentialRefs: "No hay referencias de credenciales en esta conexión.",
      noCredentialRequired: "No se requiere credencial",
      noSharedWorkspaceConnection:
        "Aún no se ha registrado ninguna conexión de espacio de trabajo compartido para este proveedor.",
      noSyncYet: "Aún no hay sincronización",
      pageSize: "Tamaño de página",
      pickGrantedConnection:
        "Elija una conexión otorgada para fijar esta fuente o déjela automática para usar la reserva de credenciales existente.",
      pollMinutes: "Actas de encuesta",
      previewsDescription:
        "Muestre fragmentos breves para revisión intencional",
      provenance: {
        brainLocalCredential: "Brain-credencial local",
        credentialSource: "Fuente de credenciales",
        credentialVault: "Bóveda de credenciales",
        explicitBrainGrant: "subvención explícita Brain",
      },
      providerConnection: "Conexión de proveedor",
      queueSelected: "Cola seleccionada",
      rawContentHidden:
        "Contenido sin procesar oculto. Habilite vistas previas o abra la fuente solo cuando la revisión requiera contexto.",
      readiness: {
        accessGrantedConnectionInactive:
          "Se concede el acceso, pero la conexión aún no está activa.",
        addReusableConnection:
          "Agregue una conexión de proveedor reutilizable en Dispatch.",
        addSharedOrScopedCredential:
          "Agregue una conexión de proveedor compartida o una credencial Brain con ámbito.",
        brainCanUseSharedConnection:
          "Brain puede utilizar la conexión del espacio de trabajo compartido.",
        brainLocal: "[es-ES] Brain-local",
        credentialNotLoaded:
          "La disponibilidad de credenciales aún no se ha cargado.",
        grantAppearsAfterConnection:
          "Aparece una concesión después de que existe una conexión de proveedor de espacio de trabajo.",
        grantExistingConnection:
          "Otorgue la conexión del proveedor existente a la aplicación Brain.",
        grantNeedsAttention:
          "Brain tiene una subvención, pero la conexión del proveedor necesita atención.",
        grantedRepair: "Concedido, reparación",
        noCredentialKeyRequired:
          "Este proveedor no requiere una clave de credencial.",
        noGrant: "Sin subvención",
        notNeeded: "No es necesario",
        providerNeedsAppAccess:
          "El proveedor está conectado, pero Brain necesita acceso a la aplicación.",
        providerNoCredential:
          "Este proveedor se puede configurar sin una clave de credencial.",
        providerUnknown: "No se pudo determinar la preparación del proveedor.",
        readyForSourceSetup: "Listo para la configuración de la fuente.",
        readyThroughScopedRefs:
          "Listo a través de referencias de credenciales Brain con alcance.",
        readyThroughSharedConnection:
          "Listo a través de una conexión de espacio de trabajo compartido.",
        reauthorizeProviderConnection:
          "Reautorizar o reparar la conexión del proveedor compartido.",
        registeredCredentialRefAvailable:
          "Una referencia de credencial registrada está disponible en la bóveda.",
        requiredCredentialRefsAvailable:
          "Las referencias de credenciales requeridas están disponibles sin exponer valores.",
        reuseProviderConnection:
          "Brain puede reutilizar la conexión del proveedor sin mostrar valores.",
        scopedCredentialRefsConfigured:
          "Las referencias de credenciales con alcance Brain están configuradas.",
        scopedCredentialsAvailable:
          "Las credenciales con alcance Brain ya están disponibles.",
        scopedLocalCredentialRefs:
          "Brain aún puede usar referencias de credenciales locales con alcance.",
        sourceSetupNotImplemented:
          "La configuración de origen Brain no está implementada para este proveedor.",
        workspaceConnectionGrantable:
          "Existe una conexión de espacio de trabajo y se puede otorgar a Brain.",
        workspaceNotLoaded:
          "El estado de conexión del espacio de trabajo aún no se ha cargado.",
      },
      reviewRawCapturesDescription:
        "Revisar la materia prima importada antes de la destilación.",
      reviewRawCaptures: "Revisar capturas sin procesar",
      reviewRequiredDescription:
        "Poner en cola el conocimiento extraído antes de la aprobación",
      reviewRequired: "Revisión requerida",
      runDueSyncs: "Ejecutar sincronizaciones debidas",
      scopedCredentialsReady: "Credenciales con alcance listas",
      selectAll: "Seleccionar todo",
      sharedConnection: "Conexión compartida",
      sharedWorkspaceConnectionReady:
        "Conexión de espacio de trabajo compartido lista",
      slackAccessRuleScopes:
        "El acceso Slack debe admitir auth.test, conversations.info/history y chat.getPermalink. Agregue acceso a canales privados cuando pruebe canales privados.",
      slackAccessRules: "Slack reglas de acceso",
      slackSetupAllowList:
        "Incluya en la lista de permitidos ID de canales aprobados, como C0123456789, o nombres de canales como #product cuando la resolución de nombres sea aceptable.",
      slackSetupGuide: "Slack guía de configuración",
      slackSetupPrivateChannels:
        "Invita a la aplicación Slack a canales privados antes de sincronizar. DMs y MPIMs quedan excluidos.",
      slackSetupScopes:
        "Los alcances mínimos son channels:read y channels:history.. Agregue groups:read y groups:history para canales privados.",
      syncNow: "Sincronizar ahora",
      tuneSource: "fuente de sintonía",
      unselectAll: "Deseleccionar todo",
      valuesHidden: "Valores ocultos",
      waitingForWorker:
        "Esperando que el trabajador de destilación Brain escriba conocimiento o envíe esta captura para revisión.",
      webhookSourceKeyDescription:
        "Las nuevas fuentes reciben un token de ingesta único. Las fuentes existentes conservan su token a menos que se roten por separado.",
      webhookSourceKey: "Webhook clave fuente",
      workspaceConnections: "Conexiones del espacio de trabajo",
      workspaceConnection: "Conexión del espacio de trabajo",
    },
  },
  "fr-FR": {
    ask: {
      composerPlaceholder:
        "Renseignez-vous sur les connaissances de l'entreprise...",
      emptyState: "Interrogez Brain sur les connaissances de l'entreprise.",
      heroDescription:
        "Brain réponses à partir des connaissances citées de l’entreprise.",
      heroTitle: "Que veux-tu savoir?",
    },
    ops: {
      allQueueItems: "Tous les éléments de la file d'attente",
      allStatuses: "Tous les statuts",
      description:
        "Surveillez les transferts de distillation Brain, les travailleurs obsolètes et les échecs réessayables à partir d’une vue de file d’attente compacte.",
      noIssueRecorded: "Aucun problème enregistré",
      noItemsDetail:
        "Modifiez le statut ou le filtre d'émission, ou attendez que de nouvelles captures entrent en distillation.",
      noItemsTitle: "Aucun élément de file d'attente ne correspond à cette vue",
      noRetryableFound: "Aucun élément de distillation réessayable trouvé",
      queueIssue: "Problème de file d'attente",
      queueUnavailableDetail:
        "Brain n'a pas pu charger les éléments accessibles de la file d'attente de distillation.",
      queueUnavailableTitle: "File d'attente indisponible",
      retryAllRetryable: "Réessayer tout ce qui est réessayable",
      retryControls: "Réessayer les contrôles",
      retryFailedDetail:
        "L’élément de la file d’attente est peut-être déjà terminé, actif ou n’est plus accessible.",
      retryFailed: "La nouvelle tentative a échoué",
      retrySelected: "Réessayer la sélection",
      runAfter: "Courir après",
      selectRetryable: "Sélectionnez réessayable",
      staleProcessing: "Traitement obsolète",
      title: "Opérations de distillation",
      unselectRetryable: "Désélectionner, réessayer",
    },
    review: {
      actionFailedDetail:
        "Brain n'a pas pu charger ou mettre à jour les propositions.",
      actionFailedTitle: "L'action de révision a échoué",
      approvalSavesEdits:
        "L’approbation enregistre d’abord les modifications de formulation.",
      approveKnowledge: "Approuver les connaissances",
      approveRedactedDraft: "Approuver le projet rédigé",
      approveReplacement: "Approuver le remplacement",
      approveUpdate: "Approuver la mise à jour",
      approvedProposals: "Propositions approuvées",
      capturedSource: "Source capturée",
      companyContext: "Contexte de l'entreprise",
      currentDraft: "Projet actuel",
      description:
        "Approuvez uniquement les mémoires proposées qui ont une valeur durable, une prise en charge de la source et une bonne posture de confidentialité.",
      details: {
        knowledgeTarget: "Objectif de connaissances",
        publishTier: "Niveau de publication",
        resultStatus: "Statut du résultat",
      },
      draftChanges: "Projet de modifications",
      editWording: "Modifier le libellé",
      emptyDetail:
        "De nouvelles captures de sources apparaissent ici lorsque Brain a besoin d'un réviseur avant de les transformer en connaissances de l'entreprise.",
      evidenceQuoteUnavailable: "Citation de preuve indisponible",
      hideEditor: "Masquer l'éditeur",
      knowledgeBody: "Corps de connaissances",
      moreActions: "Plus d'actions de révision",
      noFlags: "Pas de drapeaux",
      noPrivacyDetail:
        "Aucun avertissement de rédaction, d'exportation ou de visibilité n'a été joint.",
      noProposedKnowledge: "Aucune connaissance proposée.",
      noSnippets: "Aucun extrait",
      noSourceSnippets:
        "Aucun extrait de source n’a été joint à cette proposition.",
      notRecorded: "Non enregistré",
      notScored: "Pas de score",
      pendingProposals: "Propositions en attente",
      previewCompanyContext: "Aperçu du contexte de l'entreprise",
      privacy: {
        canonicalExport: "Exportation canonique",
        companyTierKnowledge: "Connaissance au niveau de l'entreprise",
        noPrivacyFlags: "Aucun indicateur de confidentialité",
        redactedContent: "Contenu rédigé",
      },
      privacyFlags: "Indicateurs de confidentialité",
      proposedKnowledge: "Connaissances proposées",
      publishCompanyContext: "Publier en tant que contexte d'entreprise",
      queueReason: {
        companyTier:
          "Les connaissances au niveau de l'entreprise nécessitent l'approbation de l'évaluateur.",
        default:
          "En file d'attente pour l'approbation des évaluateurs avant de devenir une connaissance durable de l'entreprise.",
        privacySensitive:
          "Le contenu sensible à la confidentialité ou expurgé nécessite la confirmation du réviseur.",
      },
      queuedProposal: "Proposition en file d'attente",
      rationalePlaceholder:
        "Pourquoi cela devrait devenir une connaissance durable",
      rejectedProposals: "Propositions rejetées",
      reviewBeforeApproving: "Examinez avant d’approuver.",
      reviewSignals: "Examiner les signaux",
      reviewerNotesPlaceholder: "Contexte facultatif pour cette décision",
      reviewerNotes: "Notes du réviseur",
      reviewerQueue: "File d'attente des réviseurs",
      saveWording: "Enregistrer le libellé",
      target: {
        archiveKnowledgeDetail:
          "L'approbation marque les connaissances cibles comme archivées.",
        archiveKnowledge: "Archiver les connaissances",
        createNewDetail:
          "L’approbation ajoute une nouvelle entrée de connaissances durables sur l’entreprise.",
        createNew: "Créer de nouvelles connaissances",
        mergeExisting: "Fusionner avec les connaissances existantes",
        mergeUpdateSupersede: "Fusionner la mise à jour et remplacer",
        supersedeExisting: "Remplacer les connaissances existantes",
      },
      targetAndPayload: "Cible et charge utile",
      targetContext: "Contexte cible",
      unsavedEdits: "Modifications non enregistrées",
      whyQueued: "Pourquoi faire la queue",
    },
    searchPage: {
      allSources: "Toutes les sources",
      allStatuses: "Tous les statuts",
      allTypes: "Tous types",
      citationQuote: "Citation de citation",
      companyKnowledge: "Connaissance de l'entreprise",
      description:
        "Recherchez les connaissances examinées, les captures brutes et les enregistrements sources, puis ouvrez l'enregistrement Brain cité ou la source originale.",
      inTheseResults: "Dans ces résultats",
      matchedIndex: "Ce résultat correspondait à l'index de recherche actuel.",
      noCitationQuote: "Aucune citation de citation n’est disponible.",
      noExcerpt: "Aucun extrait n'est disponible.",
      noMatchesDetail: "Élargissez la requête ou supprimez un filtre.",
      noMatchesTitle: "Aucune connaissance ne correspond à ces filtres",
      noSummary: "Aucun résumé n’est disponible pour ce résultat.",
      notAvailable: "Non disponible",
      openBrainRecord: "Ouvrir l'enregistrement Brain",
      openRelatedSource: "Source associée ouverte",
      openSourceUrl: "URL open source",
      openSource: "Source ouverte",
      searchPlaceholder:
        "Recherchez des décisions, des informations sur les clients, des noms de sources, des transcriptions ou des extraits de politiques...",
      startDetail:
        "Saisissez une expression pour rechercher les connaissances citées sur l’entreprise.",
      startTitle:
        "Commencez par une recherche de connaissances sur l'entreprise",
      title: "Rechercher des connaissances sur l'entreprise",
      unavailableDetail:
        "Actualisez la page et réessayez une fois que Brain a terminé le chargement.",
      unavailableTitle: "La recherche n'est pas disponible",
      untitledResult: "Résultat sans titre",
      viewInBrain: "Afficher dans Brain",
      whyMatched: "Pourquoi cela correspondait",
    },
    settings: {
      actionsUnavailableDetail:
        "Cette page est connectée à get-brain-settings et update-brain-settings et utilise les valeurs par défaut pour le moment.",
      actionsUnavailableTitle:
        "Les actions de paramètres ne sont pas encore disponibles",
      assistantBehaviorDescription:
        "La position vocale et source par défaut pour les réponses et les propositions de connaissances distillées.",
      autoArchiveResolvedDescription:
        "Supprimez les éléments de file d'attente approuvés ou rejetés de la voie de révision active.",
      autoArchiveResolved:
        "Archiver automatiquement les éléments de révision résolus",
      autoPublishGateDescription:
        "Politique d'exécution pour les connaissances au niveau de l'entreprise.",
      autoPublishGateDetail:
        "Les connaissances d'entreprise hautement fiables peuvent être publiées automatiquement lorsqu'elles sont nouvelles, non expurgées et ne nécessitent pas de proposition explicite.",
      autoRedactEmailsDescription:
        "Supprimez les adresses e-mail des connaissances distillées, à moins qu'elles ne constituent des preuves essentielles.",
      autoRedactEmails: "Rédiger automatiquement les e-mails",
      confidenceThreshold: "Seuil de confiance",
      connectorPollInterval: "Intervalle d'interrogation du connecteur",
      coreInstructionsDescription:
        "Conseils pour transformer les captures brutes en connaissances institutionnelles durables.",
      coreInstructions: "Instructions de base",
      defaultPublishTierDescription:
        "Définit la visibilité par défaut des connaissances nouvellement distillées.",
      defaultPublishTier: "Niveau de publication par défaut",
      identityDescription:
        "Les noms que Brain utilise lorsqu'il se décrit et décrit l'espace de travail qu'il protège.",
      notRequired: "Non requis",
      notSet: "Non défini",
      notifySourceErrorsDescription:
        "Surface des connecteurs dégradés ou défaillants dans le flux de révision.",
      notifySourceErrors: "Notifier sur les erreurs sources",
      policy: {
        preSaveFilter: "Filtre de pré-enregistrement",
        publishTier: "Niveau de publication",
      },
      publishingReviewDescription:
        "Valeurs par défaut pour la visibilité, l’approbation et la cadence des connecteurs.",
      requireApprovalDescription:
        "Mettez en file d'attente les candidats aux connaissances à l'échelle de l'entreprise pour un examen humain avant de les publier.",
      requireApproval:
        "Exiger une approbation pour les connaissances de l'entreprise",
      requireCitationsDescription:
        "Demandez à Brain de citer les lignes de sources approuvées pour des réponses factuelles.",
      requireCitations: "Exiger des citations",
      safetyEvidenceDescription:
        "Règles de rédaction et de citation pour les réponses qui quittent la file d'attente de révision.",
      sanitizationInstructions: "Instructions de désinfection",
      sanitizationModelDescription:
        "Remplacement facultatif pour la passe de filtrage de pré-enregistrement.",
      sanitizationModelPlaceholder:
        "Modèle d'agent par défaut ou modèle flash moins cher",
      sanitizationModel: "Modèle de désinfection",
      sanitizeCapturesDescription:
        "Filtrez les importations de Granola, Clips, de webhooks et de transcriptions manuelles jusqu'au contenu pertinent pour l'entreprise avant de les enregistrer.",
      sanitizeCaptures:
        "Désinfecter les captures de transcription avant le stockage",
      sourcePolicy: {
        balanced: {
          description:
            "Préférez les connaissances approuvées, puis identifiez les lacunes des sources.",
        },
        exploratory: {
          description:
            "Utilisez des signaux plus faibles mais étiquetez clairement l’incertitude.",
        },
        strict: {
          description:
            "Répondez uniquement à partir de connaissances et de citations approuvées.",
        },
      },
      tone: {
        direct: {
          description: "Concis, concret et orienté décision.",
        },
        formal: {
          description:
            "Prudent, prêt à élaborer des politiques et orienté vers les dirigeants.",
        },
        friendly: {
          description: "Chaleureux et franc sans perdre en précision.",
        },
        technical: {
          description:
            "Détaillé, riche en sources et sensible à la mise en œuvre.",
        },
      },
    },
    sources: {
      actionFailedDetail:
        "Vérifiez les informations d'identification de la source, les listes d'autorisation des canaux et la dernière erreur de synchronisation.",
      actionFailedTitle: "L'action source a échoué",
      advancedDescription:
        "Filtrez les sources, vérifiez l'état de préparation de la connexion et exécutez des synchronisations de maintenance lorsque la liste de sources normale n'est pas suffisante.",
      advancedTitle: "Contrôles de source avancés",
      allowedChannelsDescription:
        "Brain vérifie la liste verte, rejette DMs/MPIMs et ne stocke jamais les valeurs d'informations d'identification dans la configuration source.",
      allowedChannels: "Chaînes autorisées",
      approvedRepositories: "Référentiels approuvés",
      autoSyncDescription:
        "L'interrogation en arrière-plan utilise cette source lorsqu'elle est due",
      autoSync: "Synchronisation automatique",
      automaticCredentialSelection:
        "Sélection automatique des informations d'identification",
      batchDistillationDescription:
        "Sélectionnez les captures pouvant être mises en file d'attente et remettez-les ensemble à l'ouvrier de distillation Brain.",
      batchDistillation: "Distillation par lots",
      brainAppGrant: "Subvention d'application Brain",
      brainHealth: "Brain santé",
      captureInventoryFailedDetail:
        "Vérifiez l'accès à la source et réessayez.",
      captureInventoryFailedTitle: "Échec de la capture de l'inventaire",
      catalogKeys: "Clés du catalogue",
      connectProvider: "Connecter le fournisseur",
      connectTheProvider: "Connecter le fournisseur",
      connectionMetadataOnlyDetail:
        "Brain peut réutiliser ces métadonnées de connexion, mais la configuration source de ce fournisseur n'a pas encore été ajoutée à ce modèle.",
      connectionMetadataOnly: "Métadonnées de connexion uniquement",
      connectionProvidersDescription:
        "Réutilisez les intégrations d'espace de travail, accordez l'accès à Brain ou ajoutez des sources locales Brain sans exposer les valeurs d'informations d'identification.",
      connectionProviders: "Fournisseurs de connexion",
      connectionReadiness: "Préparation à la connexion",
      credentialPath: "Chemin d'accès aux informations d'identification",
      credentialProvenance: "Provenance des informations d'identification",
      credentialRefs: "Références des informations d'identification",
      defaultTitle: {
        clips: "Clips exportations",
        generic: "Webhook de transcription générique",
        github: "Dépôts de produits GitHub",
        granola: "Notes de l'équipe Granola",
        manual: "Importations manuelles",
        slack: "Slack canaux de connaissances",
      },
      description:
        "Connectez les lieux approuvés dont Brain peut apprendre, puis synchronisez-les et examinez-les si nécessaire.",
      emptyDetail:
        "Ajoutez un canal Slack approuvé, une source Granola Team-space, un dépôt GitHub, une exportation Clips, une importation manuelle ou un webhook signé.",
      emptyTitle: "Connectez la première source de Brain",
      githubRepositoriesDescription:
        "Brain importe le contexte de problème limité et de demande d'extraction à partir de ces référentiels à l'aide des informations d'identification de l'espace de travail GitHub.",
      grantBrainAccess: "Accorder l'accès à Brain",
      grantConnectionBeforePinning:
        "Accordez une connexion à l'espace de travail à Brain dans Dispatch avant d'épingler cette source.",
      grantInDispatch: "Subvention en Dispatch",
      healthReady:
        "Les sources, la file d'attente de révision et les contrôles de récupération sont prêts pour une utilisation normale.",
      hideDetails: "Masquer les détails",
      includeIssues: "Inclure les problèmes",
      includePullRequests: "Inclure les demandes d'extraction",
      initialUpdatedAfter: "Mise à jour initiale après",
      itemsPerRepo: "Articles par dépôt",
      lastSync: "Dernière synchronisation",
      loadingProviderCatalog: "Chargement du catalogue des fournisseurs...",
      messagesPerPage: "Messages par page",
      nextCheck: "Vérification suivante",
      noBrainSourcesYet: "Aucune source Brain pour l'instant",
      noCapturesDetail:
        "Essayez un autre statut, exécutez une synchronisation source ou importez une transcription.",
      noCapturesTitle: "Aucune capture ne correspond à cette vue",
      noConnectionProviders:
        "Aucun fournisseur de connexion Brain n’est disponible dans le catalogue partagé.",
      noCredentialKeysRequired: "Aucune clé d'identification requise",
      noCredentialRefs:
        "Aucune référence d'informations d'identification sur cette connexion",
      noCredentialRequired: "Aucun justificatif requis",
      noSharedWorkspaceConnection:
        "Aucune connexion à un espace de travail partagé n'a encore été enregistrée pour ce fournisseur.",
      noSyncYet: "Pas encore de synchronisation",
      pageSize: "Taille des pages",
      pickGrantedConnection:
        "Choisissez une connexion accordée pour épingler cette source ou laissez automatique pour utiliser la solution de secours des informations d'identification existantes.",
      pollMinutes: "Procès-verbal du sondage",
      previewsDescription:
        "Afficher de courts extraits pour un examen intentionnel",
      provenance: {
        brainLocalCredential: "Brain-identifiant local",
        credentialSource: "Source des informations d'identification",
        credentialVault: "Coffre-fort d'informations d'identification",
        explicitBrainGrant: "subvention Brain explicite",
      },
      providerConnection: "Connexion au fournisseur",
      queueSelected: "File d'attente sélectionnée",
      rawContentHidden:
        "Contenu brut masqué. Activez les aperçus ou ouvrez la source uniquement lorsque la révision nécessite un contexte.",
      readiness: {
        accessGrantedConnectionInactive:
          "L'accès est accordé, mais la connexion n'est pas encore active.",
        addReusableConnection:
          "Ajoutez une connexion de fournisseur réutilisable dans Dispatch.",
        addSharedOrScopedCredential:
          "Ajoutez une connexion de fournisseur partagé ou des informations d’identification Brain étendues.",
        brainCanUseSharedConnection:
          "Brain peut utiliser la connexion à l'espace de travail partagé.",
        brainLocal: "[fr-FR] Brain-local",
        credentialNotLoaded:
          "La disponibilité des informations d'identification n'a pas encore été chargée.",
        grantAppearsAfterConnection:
          "Une subvention apparaît après l'existence d'une connexion avec un fournisseur d'espace de travail.",
        grantExistingConnection:
          "Accordez la connexion du fournisseur existant à l'application Brain.",
        grantNeedsAttention:
          "Brain dispose d'une subvention, mais la connexion du fournisseur nécessite une attention particulière.",
        grantedRepair: "Accordé, réparation",
        noCredentialKeyRequired:
          "Ce fournisseur ne nécessite pas de clé d'identification.",
        noGrant: "Aucune subvention",
        notNeeded: "Pas nécessaire",
        providerNeedsAppAccess:
          "Le fournisseur est connecté, mais Brain a besoin d'accéder à l'application.",
        providerNoCredential:
          "Ce fournisseur peut être configuré sans clé d'identification.",
        providerUnknown:
          "L’état de préparation du fournisseur n’a pas pu être déterminé.",
        readyForSourceSetup: "Prêt pour la configuration de la source.",
        readyThroughScopedRefs:
          "Prêt via les références d’informations d’identification Brain.",
        readyThroughSharedConnection:
          "Prêt via une connexion à un espace de travail partagé.",
        reauthorizeProviderConnection:
          "Réautorisez ou réparez la connexion du fournisseur partagé.",
        registeredCredentialRefAvailable:
          "Une référence d’identification enregistrée est disponible dans le coffre-fort.",
        requiredCredentialRefsAvailable:
          "Les références d’informations d’identification requises sont disponibles sans exposer les valeurs.",
        reuseProviderConnection:
          "Brain peut réutiliser la connexion du fournisseur sans afficher les valeurs.",
        scopedCredentialRefsConfigured:
          "Les références d’informations d’identification étendues Brain sont configurées.",
        scopedCredentialsAvailable:
          "Les informations d’identification Brain de portée sont déjà disponibles.",
        scopedLocalCredentialRefs:
          "Brain peut toujours utiliser des références d'informations d'identification locales limitées.",
        sourceSetupNotImplemented:
          "La configuration de la source Brain n'est pas implémentée pour ce fournisseur.",
        workspaceConnectionGrantable:
          "Une connexion à l’espace de travail existe et peut être accordée à Brain.",
        workspaceNotLoaded:
          "L'état de la connexion à l'espace de travail n'a pas encore été chargé.",
      },
      reviewRawCapturesDescription:
        "Examiner les matières premières importées avant la distillation.",
      reviewRawCaptures: "Examiner les captures brutes",
      reviewRequiredDescription:
        "Mettre en file d'attente les connaissances extraites avant l'approbation",
      reviewRequired: "Examen requis",
      runDueSyncs: "Exécuter les synchronisations nécessaires",
      scopedCredentialsReady: "Informations d'identification étendues prêtes",
      selectAll: "Tout sélectionner",
      sharedConnection: "Connexion partagée",
      sharedWorkspaceConnectionReady:
        "Connexion à l'espace de travail partagé prête",
      slackAccessRuleScopes:
        "L'accès Slack doit prendre en charge auth.test, conversations.info/history et chat.getPermalink. Ajoutez un accès aux chaînes privées lors du pilotage des chaînes privées.",
      slackAccessRules: "Règles d'accès Slack",
      slackSetupAllowList:
        "Mettez sur liste verte les ID de chaîne approuvés tels que C0123456789 ou les noms de chaîne comme #product lorsque la résolution de nom est acceptable.",
      slackSetupGuide: "Guide de configuration Slack",
      slackSetupPrivateChannels:
        "Invitez l'application Slack sur des chaînes privées avant la synchronisation. DMs et MPIMs restent exclus.",
      slackSetupScopes:
        "Les étendues minimales sont channels:read et channels:history.. Ajoutez groups:read et groups:history pour les chaînes privées.",
      syncNow: "Synchronisez maintenant",
      tuneSource: "Régler la source",
      unselectAll: "Tout désélectionner",
      valuesHidden: "Valeurs masquées",
      waitingForWorker:
        "En attente que l'ouvrier de distillation Brain rédige ses connaissances ou envoie cette capture pour révision.",
      webhookSourceKeyDescription:
        "Les nouvelles sources reçoivent un jeton d’ingestion unique. Les sources existantes conservent leur jeton à moins d'être pivotées séparément.",
      webhookSourceKey: "Clé source Webhook",
      workspaceConnections: "Connexions à l'espace de travail",
      workspaceConnection: "Connexion à l'espace de travail",
    },
  },
  "hi-IN": {
    ask: {
      composerPlaceholder: "कंपनी के ज्ञान के बारे में पूछें...",
      emptyState: "कंपनी के ज्ञान के बारे में Brain से पूछें।",
      heroDescription: "उद्धृत कंपनी ज्ञान से Brain उत्तर।",
      heroTitle: "आप क्या जानना चाहते हैं?",
    },
    ops: {
      allQueueItems: "सभी कतार आइटम",
      allStatuses: "सभी स्थितियाँ",
      description:
        "एक कॉम्पैक्ट कतार दृश्य से Brain आसवन हैंडऑफ़, पुराने श्रमिकों और पुनः प्रयास योग्य विफलताओं की निगरानी करें।",
      noIssueRecorded: "कोई मुद्दा दर्ज नहीं किया गया",
      noItemsDetail:
        "स्थिति बदलें या फ़िल्टर जारी करें, या आसवन में प्रवेश करने के लिए नए कैप्चर की प्रतीक्षा करें।",
      noItemsTitle: "कोई भी कतार आइटम इस दृश्य से मेल नहीं खाता",
      noRetryableFound: "कोई पुनः प्रयास योग्य आसवन आइटम नहीं मिला",
      queueIssue: "कतार मुद्दा",
      queueUnavailableDetail: "Brain सुलभ आसवन कतार आइटम लोड नहीं कर सका।",
      queueUnavailableTitle: "कतार अनुपलब्ध",
      retryAllRetryable: "सभी पुन:प्रयासयोग्य पुनःप्रयास करें",
      retryControls: "नियंत्रण पुनः प्रयास करें",
      retryFailedDetail:
        "कतार आइटम पहले से ही तैयार हो सकता है, सक्रिय हो सकता है, या अब पहुंच योग्य नहीं रह गया है।",
      retryFailed: "पुनः प्रयास विफल रहा",
      retrySelected: "पुनः प्रयास करें चयनित",
      runAfter: "पीछे भागो",
      selectRetryable: "पुनः प्रयास योग्य का चयन करें",
      staleProcessing: "बासी प्रसंस्करण",
      title: "आसवन संचालन",
      unselectRetryable: "पुनः प्रयास योग्य अचयनित करें",
    },
    review: {
      actionFailedDetail: "Brain प्रस्तावों को लोड या अद्यतन नहीं कर सका।",
      actionFailedTitle: "समीक्षा कार्रवाई विफल रही",
      approvalSavesEdits: "अनुमोदन पहले शब्दों के संपादन को सहेजता है।",
      approveKnowledge: "ज्ञान का अनुमोदन करें",
      approveRedactedDraft: "संशोधित ड्राफ्ट को मंजूरी दें",
      approveReplacement: "प्रतिस्थापन को मंजूरी दें",
      approveUpdate: "अद्यतन स्वीकृत करें",
      approvedProposals: "स्वीकृत प्रस्ताव",
      capturedSource: "कैप्चर किया गया स्रोत",
      companyContext: "कंपनी संदर्भ",
      currentDraft: "वर्तमान मसौदा",
      description:
        "केवल उन्हीं प्रस्तावित स्मृतियों को स्वीकृत करें जिनमें टिकाऊ मूल्य, स्रोत समर्थन और सही गोपनीयता स्थिति हो।",
      details: {
        knowledgeTarget: "ज्ञान लक्ष्य",
        publishTier: "टियर प्रकाशित करें",
        resultStatus: "परिणाम की स्थिति",
      },
      draftChanges: "ड्राफ्ट परिवर्तन",
      editWording: "शब्द संपादित करें",
      emptyDetail:
        "नए स्रोत कैप्चर यहां तब दिखाई देते हैं जब Brain को कंपनी के ज्ञान में बदलने से पहले एक समीक्षक की आवश्यकता होती है।",
      evidenceQuoteUnavailable: "साक्ष्य उद्धरण अनुपलब्ध है",
      hideEditor: "संपादक छिपाएँ",
      knowledgeBody: "ज्ञान शरीर",
      moreActions: "अधिक समीक्षा कार्रवाइयां",
      noFlags: "कोई झंडे नहीं",
      noPrivacyDetail: "कोई संपादन, निर्यात, या दृश्यता चेतावनी संलग्न नहीं की गई थी।",
      noProposedKnowledge: "कोई प्रस्तावित ज्ञान नहीं.",
      noSnippets: "कोई स्निपेट नहीं",
      noSourceSnippets: "इस प्रस्ताव के साथ कोई स्रोत स्निपेट संलग्न नहीं किया गया था।",
      notRecorded: "रिकार्ड नहीं किया गया",
      notScored: "स्कोर नहीं किया गया",
      pendingProposals: "लंबित प्रस्ताव",
      previewCompanyContext: "कंपनी संदर्भ का पूर्वावलोकन करें",
      privacy: {
        canonicalExport: "विहित निर्यात",
        companyTierKnowledge: "कंपनी स्तरीय ज्ञान",
        noPrivacyFlags: "कोई गोपनीयता ध्वज नहीं",
        redactedContent: "संशोधित सामग्री",
      },
      privacyFlags: "गोपनीयता झंडे",
      proposedKnowledge: "प्रस्तावित ज्ञान",
      publishCompanyContext: "कंपनी संदर्भ के रूप में प्रकाशित करें",
      queueReason: {
        companyTier: "कंपनी-स्तरीय ज्ञान के लिए समीक्षक के अनुमोदन की आवश्यकता होती है।",
        default: "टिकाऊ कंपनी ज्ञान बनने से पहले समीक्षक अनुमोदन के लिए कतारबद्ध।",
        privacySensitive:
          "गोपनीयता-संवेदनशील या संपादित सामग्री को समीक्षक की पुष्टि की आवश्यकता होती है।",
      },
      queuedProposal: "कतारबद्ध प्रस्ताव",
      rationalePlaceholder: "यह टिकाऊ ज्ञान क्यों बनना चाहिए?",
      rejectedProposals: "अस्वीकृत प्रस्ताव",
      reviewBeforeApproving: "अनुमोदन से पहले समीक्षा करें.",
      reviewSignals: "संकेतों की समीक्षा करें",
      reviewerNotesPlaceholder: "इस निर्णय के लिए वैकल्पिक संदर्भ",
      reviewerNotes: "समीक्षक नोट",
      reviewerQueue: "समीक्षक कतार",
      saveWording: "शब्दांकन सहेजें",
      target: {
        archiveKnowledgeDetail:
          "अनुमोदन लक्ष्यित ज्ञान को संग्रहीत के रूप में चिह्नित करता है।",
        archiveKnowledge: "ज्ञान संग्रहीत करें",
        createNewDetail: "अनुमोदन से एक नई टिकाऊ कंपनी ज्ञान प्रविष्टि जुड़ती है।",
        createNew: "नया ज्ञान बनाएँ",
        mergeExisting: "मौजूदा ज्ञान में विलय करें",
        mergeUpdateSupersede: "अद्यतन मर्ज करें और प्रतिस्थापित करें",
        supersedeExisting: "मौजूदा ज्ञान का स्थान लें",
      },
      targetAndPayload: "लक्ष्य और पेलोड",
      targetContext: "लक्ष्य प्रसंग",
      unsavedEdits: "सहेजे न गए संपादन",
      whyQueued: "क्यों कतार में लगे",
    },
    searchPage: {
      allSources: "सभी स्रोत",
      allStatuses: "सभी स्थितियाँ",
      allTypes: "सभी प्रकार के",
      citationQuote: "उद्धरण उद्धरण",
      companyKnowledge: "कंपनी का ज्ञान",
      description:
        "समीक्षित ज्ञान, मूल कैप्चर और स्रोत रिकॉर्ड खोजें, फिर उद्धृत Brain रिकॉर्ड या मूल स्रोत खोलें।",
      inTheseResults: "इन नतीजों में",
      matchedIndex: "यह परिणाम वर्तमान खोज सूचकांक से मेल खाता है।",
      noCitationQuote: "कोई उद्धरण उद्धरण उपलब्ध नहीं है.",
      noExcerpt: "कोई अंश उपलब्ध नहीं है.",
      noMatchesDetail: "क्वेरी को विस्तृत करें या फ़िल्टर साफ़ करें.",
      noMatchesTitle: "कोई भी ज्ञान इन फ़िल्टर से मेल नहीं खाता",
      noSummary: "इस परिणाम का कोई सारांश उपलब्ध नहीं है.",
      notAvailable: "उपलब्ध नहीं है",
      openBrainRecord: "Brain रिकॉर्ड खोलें",
      openRelatedSource: "संबंधित स्रोत खोलें",
      openSourceUrl: "ओपन सोर्स यूआरएल",
      openSource: "खुला स्रोत",
      searchPlaceholder:
        "खोज निर्णय, ग्राहक तथ्य, स्रोत नाम, प्रतिलेख, या नीति स्निपेट...",
      startDetail: "उद्धृत कंपनी ज्ञान खोजने के लिए एक वाक्यांश दर्ज करें।",
      startTitle: "कंपनी ज्ञान खोज से शुरुआत करें",
      title: "कंपनी का ज्ञान खोजें",
      unavailableDetail: "पृष्ठ को ताज़ा करें और Brain लोड हो जाने पर पुनः प्रयास करें।",
      unavailableTitle: "खोज अनुपलब्ध है",
      untitledResult: "शीर्षक रहित परिणाम",
      viewInBrain: "Brain में देखें",
      whyMatched: "यह क्यों मेल खाता है",
    },
    settings: {
      actionsUnavailableDetail:
        "यह पृष्ठ get-brain-settings और update-brain-settings से जुड़ा है और अभी डिफ़ॉल्ट का उपयोग कर रहा है।",
      actionsUnavailableTitle: "सेटिंग क्रियाएँ अभी तक उपलब्ध नहीं हैं",
      assistantBehaviorDescription:
        "उत्तर और आसुत ज्ञान प्रस्तावों के लिए डिफ़ॉल्ट आवाज और स्रोत मुद्रा।",
      autoArchiveResolvedDescription:
        "सक्रिय समीक्षा लेन से स्वीकृत या अस्वीकृत कतार आइटम हटाएं।",
      autoArchiveResolved: "समाधानित समीक्षा आइटमों को स्वतः संग्रहित करें",
      autoPublishGateDescription: "कंपनी-स्तरीय ज्ञान के लिए रनटाइम नीति।",
      autoPublishGateDetail:
        "उच्च-विश्वास वाली कंपनी का ज्ञान तब स्वचालित रूप से प्रकाशित हो सकता है जब वह नया हो, अप्रकाशित हो और उसे किसी स्पष्ट प्रस्ताव की आवश्यकता न हो।",
      autoRedactEmailsDescription:
        "आसुत ज्ञान से ईमेल पते हटा दें जब तक कि वे आवश्यक साक्ष्य न हों।",
      autoRedactEmails: "ईमेल को स्वतः संशोधित करें",
      confidenceThreshold: "आत्मविश्वास की सीमा",
      connectorPollInterval: "कनेक्टर पोल अंतराल",
      coreInstructionsDescription:
        "कच्ची जानकारी को टिकाऊ संस्थागत ज्ञान में बदलने के लिए मार्गदर्शन।",
      coreInstructions: "मूल निर्देश",
      defaultPublishTierDescription:
        "नव आसुत ज्ञान के लिए डिफ़ॉल्ट दृश्यता सेट करता है।",
      defaultPublishTier: "डिफ़ॉल्ट प्रकाशन स्तर",
      identityDescription:
        "Brain नामों का उपयोग तब किया जाता है जब वह स्वयं का और उस कार्यक्षेत्र का वर्णन करता है जिसकी वह सुरक्षा कर रहा है।",
      notRequired: "आवश्यक नहीं",
      notSet: "सेट नहीं",
      notifySourceErrorsDescription: "समीक्षा प्रवाह में सतह ख़राब या विफल कनेक्टर।",
      notifySourceErrors: "स्रोत त्रुटियों पर सूचित करें",
      policy: {
        preSaveFilter: "फ़िल्टर को पहले से सहेजें",
        publishTier: "टियर प्रकाशित करें",
      },
      publishingReviewDescription: "दृश्यता, अनुमोदन और कनेक्टर ताल के लिए डिफ़ॉल्ट।",
      requireApprovalDescription:
        "प्रकाशन से पहले मानव समीक्षा के लिए कंपनी-व्यापी ज्ञान वाले उम्मीदवारों की कतार लगाएं।",
      requireApproval: "कंपनी के ज्ञान के लिए अनुमोदन की आवश्यकता है",
      requireCitationsDescription:
        "पूछें Brain को तथ्यात्मक उत्तरों के लिए अनुमोदित स्रोत पंक्तियों का हवाला देना चाहिए।",
      requireCitations: "उद्धरणों की आवश्यकता है",
      safetyEvidenceDescription:
        "समीक्षा कतार छोड़ने वाले उत्तरों के लिए संशोधन और उद्धरण नियम।",
      sanitizationInstructions: "सैनिटाइजेशन के निर्देश",
      sanitizationModelDescription: "प्री-सेव फ़िल्टरिंग पास के लिए वैकल्पिक ओवरराइड।",
      sanitizationModelPlaceholder: "डिफ़ॉल्ट एजेंट मॉडल या सस्ता फ़्लैश मॉडल",
      sanitizationModel: "स्वच्छता मॉडल",
      sanitizeCapturesDescription:
        "फ़िल्टर Granola, Clips, वेबहुक, और मैन्युअल ट्रांसक्रिप्ट सहेजने से पहले कंपनी-प्रासंगिक सामग्री में आयात करता है।",
      sanitizeCaptures: "भंडारण से पहले प्रतिलेख कैप्चर को साफ करें",
      sourcePolicy: {
        balanced: {
          description:
            "अनुमोदित ज्ञान को प्राथमिकता दें, फिर स्रोत अंतराल की पहचान करें।",
        },
        exploratory: {
          description:
            "कमज़ोर संकेतों का उपयोग करें लेकिन अनिश्चितता को स्पष्ट रूप से लेबल करें।",
        },
        strict: {
          description: "केवल अनुमोदित ज्ञान और उद्धरणों से उत्तर दें।",
        },
      },
      tone: {
        direct: {
          description: "संक्षिप्त, ठोस और निर्णय-उन्मुख।",
        },
        formal: {
          description: "सावधान, नीति-तैयार, और कार्यकारी-सामना करने वाला।",
        },
        friendly: {
          description: "सटीकता खोए बिना गर्मजोशीपूर्ण और स्पष्टवादी।",
        },
        technical: {
          description: "विस्तृत, स्रोत-भारी, और कार्यान्वयन-जागरूक।",
        },
      },
    },
    sources: {
      actionFailedDetail:
        "स्रोत क्रेडेंशियल, चैनल अनुमति-सूचियाँ और नवीनतम सिंक त्रुटि की जाँच करें।",
      actionFailedTitle: "स्रोत कार्रवाई विफल रही",
      advancedDescription:
        "स्रोतों को फ़िल्टर करें, कनेक्शन की तैयारी की जाँच करें, और सामान्य स्रोत सूची पर्याप्त न होने पर रखरखाव सिंक चलाएँ।",
      advancedTitle: "उन्नत स्रोत नियंत्रण",
      allowedChannelsDescription:
        "Brain अनुमति-सूची को सत्यापित करता है, DMs/MPIMs को अस्वीकार करता है, और स्रोत कॉन्फ़िगरेशन में कभी भी क्रेडेंशियल मान संग्रहीत नहीं करता है।",
      allowedChannels: "अनुमत चैनल",
      appAccess: {
        brainAllowList: "Brain अनुमति-सूची",
      },
      approvedRepositories: "स्वीकृत भंडार",
      autoSyncDescription: "पृष्ठभूमि मतदान नियत समय पर इस स्रोत का उपयोग करता है",
      autoSync: "स्वतः-सिंक",
      automaticCredentialSelection: "स्वचालित क्रेडेंशियल चयन",
      batchDistillationDescription:
        "कतारबद्ध कैप्चर का चयन करें और उन्हें Brain आसवन कार्यकर्ता को एक साथ सौंप दें।",
      batchDistillation: "बैच आसवन",
      brainAppGrant: "Brain ऐप अनुदान",
      brainHealth: "Brain स्वास्थ्य",
      captureInventoryFailedDetail: "स्रोत पहुंच की जाँच करें और पुनः प्रयास करें।",
      captureInventoryFailedTitle: "इन्वेंट्री कैप्चर करना विफल रहा",
      catalogKeys: "कैटलॉग कुंजियाँ",
      connectProvider: "प्रदाता से कनेक्ट करें",
      connectTheProvider: "प्रदाता से कनेक्ट करें",
      connectionMetadataOnlyDetail:
        "Brain इस कनेक्शन मेटाडेटा का पुन: उपयोग कर सकता है, लेकिन इस प्रदाता के लिए स्रोत सेटअप अभी तक इस टेम्पलेट में नहीं जोड़ा गया है।",
      connectionMetadataOnly: "केवल कनेक्शन मेटाडेटा",
      connectionProvidersDescription:
        "कार्यक्षेत्र एकीकरण का पुन: उपयोग करें, Brain पहुंच प्रदान करें, या क्रेडेंशियल मानों को उजागर किए बिना Brain-स्थानीय स्रोत जोड़ें।",
      connectionProviders: "कनेक्शन प्रदाता",
      connectionReadiness: "कनेक्शन की तैयारी",
      credentialPath: "क्रेडेंशियल पथ",
      credentialProvenance: "प्रमाणिक उद्गम",
      credentialRefs: "क्रेडेंशियल रेफरी",
      defaultTitle: {
        clips: "Clips निर्यात",
        generic: "जेनेरिक ट्रांसक्रिप्ट वेबहुक",
        github: "GitHub उत्पाद रिपो",
        granola: "Granola टीम नोट्स",
        manual: "मैन्युअल आयात",
        slack: "Slack ज्ञान चैनल",
      },
      description:
        "स्वीकृत स्थानों को कनेक्ट करें जिनसे Brain सीख सकते हैं, फिर सिंक करें और आवश्यकतानुसार उनकी समीक्षा करें।",
      emptyDetail:
        "एक स्वीकृत Slack चैनल, Granola Team-space स्रोत, GitHub रेपो, Clips निर्यात, मैन्युअल आयात, या हस्ताक्षरित वेबहुक जोड़ें।",
      emptyTitle: "Brain के पहले स्रोत को कनेक्ट करें",
      githubRepositoriesDescription:
        "Brain बाउंडेड समस्या को आयात करता है और कार्यक्षेत्र GitHub क्रेडेंशियल का उपयोग करके इन रिपॉजिटरी से अनुरोध संदर्भ खींचता है।",
      grantBrainAccess: "Brain पहुँच प्रदान करें",
      grantConnectionBeforePinning:
        "इस स्रोत को पिन करने से पहले Dispatch में Brain को एक कार्यस्थान कनेक्शन प्रदान करें।",
      grantInDispatch: "Dispatch में अनुदान",
      healthReady:
        "स्रोत, समीक्षा कतार और पुनर्प्राप्ति जांच सामान्य उपयोग के लिए तैयार हैं।",
      hideDetails: "विवरण छिपाएँ",
      includeIssues: "मुद्दों को शामिल करें",
      includePullRequests: "पुल अनुरोध शामिल करें",
      initialUpdatedAfter: "आरंभिक अद्यतन-बाद",
      itemsPerRepo: "प्रति रेपो आइटम",
      lastSync: "अंतिम समन्वयन",
      loadingProviderCatalog: "प्रदाता कैटलॉग लोड हो रहा है...",
      messagesPerPage: "प्रति पृष्ठ संदेश",
      nextCheck: "अगली जांच",
      noBrainSourcesYet: "अभी तक कोई Brain स्रोत नहीं है",
      noCapturesDetail:
        "कोई अन्य स्थिति आज़माएँ, स्रोत सिंक चलाएँ, या एक प्रतिलेख आयात करें।",
      noCapturesTitle: "कोई भी कैप्चर इस दृश्य से मेल नहीं खाता",
      noConnectionProviders: "साझा कैटलॉग से कोई Brain कनेक्शन प्रदाता उपलब्ध नहीं हैं।",
      noCredentialKeysRequired: "किसी क्रेडेंशियल कुंजी की आवश्यकता नहीं है",
      noCredentialRefs: "इस संबंध पर कोई क्रेडेंशियल संदर्भ नहीं है",
      noCredentialRequired: "किसी प्रमाण पत्र की आवश्यकता नहीं है",
      noSharedWorkspaceConnection:
        "इस प्रदाता के लिए अभी तक कोई साझा कार्यक्षेत्र कनेक्शन पंजीकृत नहीं किया गया है।",
      noSyncYet: "अभी तक कोई समन्वयन नहीं",
      pageSize: "पृष्ठ का आकार",
      pickGrantedConnection:
        "इस स्रोत को पिन करने के लिए दिए गए कनेक्शन को चुनें, या मौजूदा क्रेडेंशियल फ़ॉलबैक का उपयोग करने के लिए स्वचालित छोड़ दें।",
      pollMinutes: "मतदान मिनट",
      previewsDescription: "जानबूझकर समीक्षा के लिए छोटे स्निपेट दिखाएं",
      provenance: {
        brainLocalCredential: "Brain-स्थानीय क्रेडेंशियल",
        credentialSource: "प्रमाणिक स्रोत",
        credentialVault: "क्रेडेंशियल वॉल्ट",
        explicitBrainGrant: "स्पष्ट Brain अनुदान",
      },
      providerConnection: "प्रदाता कनेक्शन",
      queueSelected: "कतार चयनित",
      rawContentHidden:
        "कच्चा माल छिपा हुआ. पूर्वावलोकन सक्षम करें या स्रोत तभी खोलें जब समीक्षा के लिए संदर्भ की आवश्यकता हो।",
      readiness: {
        accessGrantedConnectionInactive:
          "पहुंच प्रदान की गई है, लेकिन कनेक्शन अभी तक सक्रिय नहीं है।",
        addReusableConnection: "Dispatch में पुन: प्रयोज्य प्रदाता कनेक्शन जोड़ें।",
        addSharedOrScopedCredential:
          "एक साझा प्रदाता कनेक्शन या स्कोप्ड Brain क्रेडेंशियल जोड़ें।",
        brainCanUseSharedConnection:
          "Brain साझा कार्यक्षेत्र कनेक्शन का उपयोग कर सकता है।",
        brainLocal: "Brain-स्थानीय",
        credentialNotLoaded: "क्रेडेंशियल उपलब्धता अभी तक लोड नहीं हुई है.",
        grantAppearsAfterConnection:
          "कार्यस्थान प्रदाता कनेक्शन मौजूद होने के बाद अनुदान प्रकट होता है।",
        grantExistingConnection: "मौजूदा प्रदाता को Brain ऐप से कनेक्शन प्रदान करें।",
        grantNeedsAttention:
          "Brain के पास अनुदान है, लेकिन प्रदाता कनेक्शन पर ध्यान देने की आवश्यकता है।",
        grantedRepair: "स्वीकृत, मरम्मत",
        noCredentialKeyRequired: "इस प्रदाता को क्रेडेंशियल कुंजी की आवश्यकता नहीं है.",
        noGrant: "कोई अनुदान नहीं",
        notNeeded: "जरूरत नहीं",
        providerNeedsAppAccess:
          "प्रदाता कनेक्ट है, लेकिन Brain को ऐप एक्सेस की आवश्यकता है।",
        providerNoCredential:
          "इस प्रदाता को क्रेडेंशियल कुंजी के बिना कॉन्फ़िगर किया जा सकता है।",
        providerUnknown: "प्रदाता की तत्परता निर्धारित नहीं की जा सकी.",
        readyForSourceSetup: "स्रोत सेटअप के लिए तैयार.",
        readyThroughScopedRefs: "स्कोप्ड Brain क्रेडेंशियल रेफरी के माध्यम से तैयार।",
        readyThroughSharedConnection: "साझा कार्यक्षेत्र कनेक्शन के माध्यम से तैयार।",
        reauthorizeProviderConnection:
          "साझा प्रदाता कनेक्शन को पुनः अधिकृत या मरम्मत करें।",
        registeredCredentialRefAvailable:
          "एक पंजीकृत क्रेडेंशियल रेफरी तिजोरी में उपलब्ध है।",
        requiredCredentialRefsAvailable:
          "आवश्यक क्रेडेंशियल रेफरी मूल्यों को उजागर किए बिना उपलब्ध हैं।",
        reuseProviderConnection:
          "Brain मान दिखाए बिना प्रदाता कनेक्शन का पुन: उपयोग कर सकता है।",
        scopedCredentialRefsConfigured:
          "स्कोप्ड Brain क्रेडेंशियल रेफरी कॉन्फ़िगर किए गए हैं।",
        scopedCredentialsAvailable: "स्कोप्ड Brain क्रेडेंशियल पहले से ही उपलब्ध हैं।",
        scopedLocalCredentialRefs:
          "Brain अभी भी स्कोप्ड स्थानीय क्रेडेंशियल रेफरी का उपयोग कर सकता है।",
        sourceSetupNotImplemented:
          "इस प्रदाता के लिए Brain स्रोत सेटअप लागू नहीं किया गया है।",
        workspaceConnectionGrantable:
          "एक कार्यक्षेत्र कनेक्शन मौजूद है और इसे Brain को दिया जा सकता है।",
        workspaceNotLoaded: "कार्यस्थान कनेक्शन स्थिति अभी तक लोड नहीं हुई है.",
      },
      reviewRawCapturesDescription: "आसवन से पहले आयातित कच्चे माल की समीक्षा करें।",
      reviewRawCaptures: "कच्चे कैप्चर की समीक्षा करें",
      reviewRequiredDescription: "अनुमोदन से पहले कतार से ज्ञान निकाला गया",
      reviewRequired: "समीक्षा आवश्यक है",
      runDueSyncs: "उचित सिंक चलाएँ",
      scopedCredentialsReady: "दायरे वाले क्रेडेंशियल तैयार हैं",
      selectAll: "सभी का चयन करें",
      sharedConnection: "साझा कनेक्शन",
      sharedWorkspaceConnectionReady: "साझा कार्यस्थान कनेक्शन तैयार",
      slackAccessRuleScopes:
        "Slack एक्सेस को auth.test, conversations.info/history, और chat.getPermalink का समर्थन करना चाहिए। निजी चैनलों का संचालन करते समय निजी-चैनल पहुंच जोड़ें।",
      slackAccessRules: "Slack पहुँच नियम",
      slackSetupAllowList:
        "अनुमति-सूची स्वीकृत चैनल आईडी जैसे C0123456789, या चैनल नाम जैसे #product जब नाम समाधान स्वीकार्य हो।",
      slackSetupGuide: "Slack सेटअप गाइड",
      slackSetupPrivateChannels:
        "सिंक करने से पहले Slack ऐप को निजी चैनलों पर आमंत्रित करें। DMs और MPIMs बाहर रहेंगे।",
      slackSetupScopes:
        "न्यूनतम दायरे channels:read और channels:history. हैं निजी चैनलों के लिए groups:read और groups:history जोड़ें।",
      syncNow: "अभी सिंक करें",
      tuneSource: "धुन स्रोत",
      unselectAll: "सभी को अचयनित करें",
      valuesHidden: "मूल्य छुपे हुए",
      waitingForWorker:
        "Brain आसवन कार्यकर्ता द्वारा ज्ञान लिखने या इस कैप्चर को समीक्षा के लिए भेजने की प्रतीक्षा की जा रही है।",
      webhookSourceKeyDescription:
        "नए स्रोतों को एक बार का अंतर्ग्रहण टोकन प्राप्त होता है। मौजूदा स्रोत अपना टोकन तब तक बनाए रखते हैं जब तक कि उसे अलग से न घुमाया जाए।",
      webhookSourceKey: "Webhook स्रोत कुंजी",
      workspaceConnections: "कार्यस्थल कनेक्शन",
      workspaceConnection: "कार्यस्थल कनेक्शन",
    },
  },
  "ja-JP": {
    ask: {
      composerPlaceholder: "会社の知識について質問する...",
      emptyState: "会社の知識について Brain に質問してください。",
      heroDescription: "Brain は引用された企業の知識から回答します。",
      heroTitle: "何を知りたいですか?",
    },
    ops: {
      allQueueItems: "すべてのキュー項目",
      allStatuses: "すべてのステータス",
      description:
        "Brain 蒸留ハンドオフ、古いワーカー、および再試行可能なエラーを 1 つのコンパクトなキュー ビューから監視します。",
      noIssueRecorded: "問題は記録されていません",
      noItemsDetail:
        "ステータスを変更するかフィルタを発行するか、新しいキャプチャが蒸留に入るまで待ちます。",
      noItemsTitle: "このビューに一致するキュー項目はありません",
      noRetryableFound: "再試行可能な蒸留アイテムが見つかりませんでした",
      queueIssue: "キューの問題",
      queueUnavailableDetail:
        "Brain は、アクセス可能な蒸留キュー項目をロードできませんでした。",
      queueUnavailableTitle: "キューが使用できません",
      retryAllRetryable: "再試行可能なすべてを再試行する",
      retryControls: "再試行制御",
      retryFailedDetail:
        "キュー項目はすでに完了しているか、アクティブになっているか、アクセスできなくなっている可能性があります。",
      retryFailed: "再試行に失敗しました",
      retrySelected: "選択した再試行",
      runAfter: "追いかけて",
      selectRetryable: "再試行可能を選択",
      staleProcessing: "古い処理",
      title: "蒸留操作",
      unselectRetryable: "再試行可能の選択を解除する",
    },
    review: {
      actionFailedDetail:
        "Brain はプロポーザルをロードまたは更新できませんでした。",
      actionFailedTitle: "レビューアクションが失敗しました",
      approvalSavesEdits: "承認すると、まず文言の編集が保存されます。",
      approveKnowledge: "知識を承認する",
      approveRedactedDraft: "編集されたドラフトを承認する",
      approveReplacement: "交換を承認する",
      approveUpdate: "更新を承認する",
      approvedProposals: "承認された提案",
      capturedSource: "キャプチャされたソース",
      companyContext: "会社の背景",
      currentDraft: "現在のドラフト",
      description:
        "永続的な価値、ソースのサポート、および適切なプライバシー姿勢を備えた、提案されたメモリのみを承認します。",
      details: {
        knowledgeTarget: "知識の対象",
        publishTier: "パブリッシュ層",
        resultStatus: "結果ステータス",
      },
      draftChanges: "ドラフトの変更",
      editWording: "文言を編集する",
      emptyDetail:
        "新しいソース キャプチャは、Brain が会社のナレッジに変換する前にレビュー担当者が必要な場合にここに表示されます。",
      evidenceQuoteUnavailable: "証拠の引用が利用できない",
      hideEditor: "エディタを非表示にする",
      knowledgeBody: "知識体",
      moreActions: "さらなるレビューアクション",
      noFlags: "フラグはありません",
      noPrivacyDetail:
        "編集、エクスポート、可視性に関する警告は添付されませんでした。",
      noProposedKnowledge: "提案された知識はありません。",
      noSnippets: "スニペットなし",
      noSourceSnippets:
        "この提案にはソース スニペットは添付されていませんでした。",
      notRecorded: "記録されていない",
      notScored: "得点されていない",
      pendingProposals: "保留中の提案",
      previewCompanyContext: "会社のコンテキストをプレビューする",
      privacy: {
        canonicalExport: "正規エクスポート",
        companyTierKnowledge: "企業レベルの知識",
        noPrivacyFlags: "プライバシーフラグはありません",
        redactedContent: "編集されたコンテンツ",
      },
      privacyFlags: "プライバシーフラグ",
      proposedKnowledge: "提案された知識",
      publishCompanyContext: "企業コンテキストとして公開",
      queueReason: {
        companyTier: "企業層の知識にはレビュー担当者の承認が必要です。",
        default:
          "企業の永続的な知識となる前に、レビュー担当者の承認を得るために待機しました。",
        privacySensitive:
          "プライバシーに配慮したコンテンツや編集されたコンテンツにはレビュー担当者の確認が必要です。",
      },
      queuedProposal: "キューに入れられた提案",
      rationalePlaceholder: "なぜこれが永続的な知識になるのか",
      rejectedProposals: "拒否された提案",
      reviewBeforeApproving: "承認する前に確認してください。",
      reviewSignals: "シグナルを確認する",
      reviewerNotesPlaceholder: "この決定のオプションのコンテキスト",
      reviewerNotes: "査読者のメモ",
      reviewerQueue: "レビュー担当者キュー",
      saveWording: "文言を保存する",
      target: {
        archiveKnowledgeDetail:
          "承認すると、ターゲット ナレッジがアーカイブ済みとしてマークされます。",
        archiveKnowledge: "知識をアーカイブする",
        createNewDetail:
          "承認すると、新しい永続的な企業ナレッジ エントリが追加されます。",
        createNew: "新しい知識を創造する",
        mergeExisting: "既存の知識と融合する",
        mergeUpdateSupersede: "更新をマージして置き換える",
        supersedeExisting: "既存の知識に取って代わる",
      },
      targetAndPayload: "ターゲットとペイロード",
      targetContext: "ターゲットコンテキスト",
      unsavedEdits: "保存されていない編集内容",
      whyQueued: "列に並んだ理由",
    },
    searchPage: {
      allSources: "すべてのソース",
      allStatuses: "すべてのステータス",
      allTypes: "全種類",
      citationQuote: "引用引用",
      companyKnowledge: "会社の知識",
      description:
        "レビュー済みのナレッジ、生のキャプチャ、およびソース レコードを検索し、引用された Brain レコードまたは元のソースを開きます。",
      inTheseResults: "これらの結果では",
      matchedIndex: "この結果は現在の検索インデックスと一致しました。",
      noCitationQuote: "引用引用は利用できません。",
      noExcerpt: "抜粋はありません。",
      noMatchesDetail: "クエリを拡張するか、フィルターをクリアします。",
      noMatchesTitle: "これらのフィルターに一致する知識はありません",
      noSummary: "この結果に関する要約はありません。",
      notAvailable: "利用できません",
      openBrainRecord: "Brain レコードを開く",
      openRelatedSource: "関連ソースをオープンする",
      openSourceUrl: "オープンソース URL",
      openSource: "オープンソース",
      searchPlaceholder:
        "検索の決定、顧客の事実、ソース名、トランスクリプト、またはポリシーの抜粋...",
      startDetail: "引用された企業ナレッジを検索するには語句を入力します。",
      startTitle: "企業ナレッジ検索から始めましょう",
      title: "企業ナレッジを検索する",
      unavailableDetail:
        "ページを更新し、Brain の読み込みが完了したら、もう一度試してください。",
      unavailableTitle: "検索は利用できません",
      untitledResult: "無題の結果",
      viewInBrain: "Brain で表示",
      whyMatched: "なぜこれが一致したのか",
    },
    settings: {
      actionsUnavailableDetail:
        "このページは get-brain-settings および update-brain-settings に接続されており、現時点ではデフォルトを使用しています。",
      actionsUnavailableTitle: "設定アクションはまだ利用できません",
      assistantBehaviorDescription:
        "回答と抽出された知識の提案に対するデフォルトの音声とソースの姿勢。",
      autoArchiveResolvedDescription:
        "承認または拒否されたキュー項目をアクティブなレビュー レーンから削除します。",
      autoArchiveResolved: "解決されたレビュー項目を自動アーカイブする",
      autoPublishGateDescription: "企業層のナレッジの実行時ポリシー。",
      autoPublishGateDetail:
        "信頼性の高い企業ナレッジは、新しく編集されておらず、明示的な提案を必要としない場合に自動的に公開できます。",
      autoRedactEmailsDescription:
        "重要な証拠でない限り、抽出された知識から電子メール アドレスを削除します。",
      autoRedactEmails: "メールを自動編集する",
      confidenceThreshold: "信頼閾値",
      connectorPollInterval: "コネクタのポーリング間隔",
      coreInstructionsDescription:
        "生のキャプチャを永続的な組織の知識に変えるためのガイダンス。",
      coreInstructions: "コア命令",
      defaultPublishTierDescription:
        "新しく抽出された知識のデフォルトの可視性を設定します。",
      defaultPublishTier: "デフォルトの公開層",
      identityDescription:
        "Brain という名前は、それ自体と保護しているワークスペースを説明するときに使用されます。",
      notRequired: "不要",
      notSet: "未設定",
      notifySourceErrorsDescription:
        "レビュー フローでの表面の劣化または故障したコネクタ。",
      notifySourceErrors: "ソースエラーを通知する",
      policy: {
        preSaveFilter: "事前保存フィルター",
        publishTier: "パブリッシュ層",
      },
      publishingReviewDescription: "可視性、承認、コネクタの頻度のデフォルト。",
      requireApprovalDescription:
        "公開する前に、全社的なナレッジの候補者をキューに入れて人によるレビューを受けます。",
      requireApproval: "社内知識の承認が必要",
      requireCitationsDescription:
        "Ask Brain は、事実に基づく回答として承認されたソース行を引用する必要があります。",
      requireCitations: "引用を要求する",
      safetyEvidenceDescription:
        "レビューキューから出た回答に対する編集と引用のルール。",
      sanitizationInstructions: "消毒手順",
      sanitizationModelDescription:
        "保存前フィルタリング パスのオプションのオーバーライド。",
      sanitizationModelPlaceholder:
        "デフォルトのエージェント モデルまたは安価なフラッシュ モデル",
      sanitizationModel: "サニタイズモデル",
      sanitizeCapturesDescription:
        "保存する前に、Granola、Clips、Webhook、および手動トランスクリプトのインポートを会社関連のコンテンツまでフィルタリングします。",
      sanitizeCaptures: "保存前にトランスクリプトキャプチャをサニタイズする",
      sourcePolicy: {
        balanced: {
          description: "承認された知識を優先し、情報源のギャップを特定します。",
        },
        exploratory: {
          description:
            "弱い信号を使用しますが、不確実性には明確にラベルを付けます。",
        },
        strict: {
          description: "承認された知識と引用に基づいてのみ回答してください。",
        },
      },
      tone: {
        direct: {
          description: "簡潔、具体的、そして意思決定志向。",
        },
        formal: {
          description: "注意深く、政策を準備し、経営陣と向き合います。",
        },
        friendly: {
          description: "正確さを失うことなく、温かく率直な語り口。",
        },
        technical: {
          description: "詳細で、ソースを重視し、実装を意識しています。",
        },
      },
    },
    sources: {
      actionFailedDetail:
        "ソース認証情報、チャネル許可リスト、最新の同期エラーを確認します。",
      actionFailedTitle: "ソースアクションが失敗しました",
      advancedDescription:
        "ソースをフィルタリングし、接続の準備状況を確認し、通常のソース リストでは不十分な場合はメンテナンス同期を実行します。",
      advancedTitle: "高度なソース管理",
      allowedChannelsDescription:
        "Brain は許可リストを検証し、DMs/MPIMs を拒否し、資格情報の値をソース構成に保存しません。",
      allowedChannels: "許可されたチャネル",
      approvedRepositories: "承認されたリポジトリ",
      autoSyncDescription:
        "バックグラウンドポーリングは期限が来るとこのソースを使用します",
      autoSync: "自動同期",
      automaticCredentialSelection: "資格情報の自動選択",
      batchDistillationDescription:
        "キュー可能なキャプチャを選択し、一緒に Brain 蒸留ワーカーに渡します。",
      batchDistillation: "バッチ蒸留",
      brainAppGrant: "Brain アプリの許可",
      brainHealth: "Brain 健康",
      captureInventoryFailedDetail:
        "ソースアクセスを確認して、再試行してください。",
      captureInventoryFailedTitle: "インベントリのキャプチャに失敗しました",
      catalogKeys: "カタログキー",
      connectProvider: "プロバイダーに接続する",
      connectTheProvider: "プロバイダーに接続する",
      connectionMetadataOnlyDetail:
        "Brain はこの接続メタデータを再利用できますが、このプロバイダーのソース セットアップはまだこのテンプレートに追加されていません。",
      connectionMetadataOnly: "接続メタデータのみ",
      connectionProvidersDescription:
        "資格情報の値を公開せずに、ワークスペース統合を再利用したり、Brain アクセスを付与したり、Brain ローカル ソースを追加したりできます。",
      connectionProviders: "接続プロバイダー",
      connectionReadiness: "接続の準備状況",
      credentialPath: "資格情報のパス",
      credentialProvenance: "資格証明の出所",
      credentialRefs: "資格情報参照",
      defaultTitle: {
        clips: "Clips エクスポート",
        generic: "一般的なトランスクリプト Webhook",
        github: "GitHub 製品リポジトリ",
        granola: "Granola チームのメモ",
        manual: "手動インポート",
        slack: "Slack ナレッジ チャネル",
      },
      description:
        "Brain が学習できる承認済みの場所に接続し、必要に応じてそれらを同期して確認します。",
      emptyDetail:
        "承認された Slack チャネル、Granola Team-space ソース、GitHub リポジトリ、Clips エクスポート、手動インポート、または署名付き Webhook を追加します。",
      emptyTitle: "Brain の最初のソースを接続します",
      githubRepositoriesDescription:
        "Brain は、ワークスペース GitHub 資格情報を使用して、これらのリポジトリから制限付きの課題とプル リクエストのコンテキストをインポートします。",
      grantBrainAccess: "Brain へのアクセスを許可する",
      grantConnectionBeforePinning:
        "このソースを固定する前に、Dispatch の Brain へのワークスペース接続を許可してください。",
      grantInDispatch: "Dispatch の助成金",
      healthReady:
        "ソース、レビューキュー、および取得チェックは通常の使用の準備ができています。",
      hideDetails: "詳細を隠す",
      includeIssues: "問題を含める",
      includePullRequests: "プルリクエストを含める",
      initialUpdatedAfter: "初期更新後",
      itemsPerRepo: "リポジトリごとの項目",
      lastSync: "最終同期",
      loadingProviderCatalog: "プロバイダー カタログを読み込んでいます...",
      messagesPerPage: "ページごとのメッセージ数",
      nextCheck: "次のチェック",
      noBrainSourcesYet: "Brain ソースはまだありません",
      noCapturesDetail:
        "別のステータスを試すか、ソース同期を実行するか、トランスクリプトをインポートしてください。",
      noCapturesTitle: "このビューに一致するキャプチャはありません",
      noConnectionProviders:
        "共有カタログから使用できる Brain 接続プロバイダーはありません。",
      noCredentialKeysRequired: "認証キーは必要ありません",
      noCredentialRefs: "この接続には資格情報の参照がありません",
      noCredentialRequired: "資格情報は必要ありません",
      noSharedWorkspaceConnection:
        "このプロバイダーには共有ワークスペース接続がまだ登録されていません。",
      noSyncYet: "まだ同期がありません",
      pageSize: "ページサイズ",
      pickGrantedConnection:
        "許可された接続を選択してこのソースを固定するか、自動のままにして既存の資格情報フォールバックを使用します。",
      pollMinutes: "投票議事録",
      previewsDescription: "意図的なレビューのために短いスニペットを表示する",
      provenance: {
        brainLocalCredential: "Brain - ローカル資格情報",
        credentialSource: "認証情報のソース",
        credentialVault: "資格情報保管庫",
        explicitBrainGrant: "明示的な Brain 許可",
      },
      providerConnection: "プロバイダ接続",
      queueSelected: "選択されたキュー",
      rawContentHidden:
        "生のコンテンツは隠されています。レビューでコンテキストが必要な場合にのみ、プレビューを有効にするかソースを開きます。",
      readiness: {
        accessGrantedConnectionInactive:
          "アクセスは許可されていますが、接続はまだアクティブではありません。",
        addReusableConnection:
          "再利用可能なプロバイダー接続を Dispatch に追加します。",
        addSharedOrScopedCredential:
          "共有プロバイダー接続またはスコープ指定された Brain 資格情報を追加します。",
        brainCanUseSharedConnection:
          "Brain は共有ワークスペース接続を使用できます。",
        brainLocal: "Brain-ローカル",
        credentialNotLoaded: "資格情報の可用性がまだ読み込まれていません。",
        grantAppearsAfterConnection:
          "付与は、ワークスペース プロバイダー接続が確立された後に表示されます。",
        grantExistingConnection:
          "Brain アプリへの既存のプロバイダー接続を許可します。",
        grantNeedsAttention:
          "Brain には許可がありますが、プロバイダー接続には注意が必要です。",
        grantedRepair: "確かに、修理します",
        noCredentialKeyRequired:
          "このプロバイダーには資格情報キーは必要ありません。",
        noGrant: "助成金なし",
        notNeeded: "必要ありません",
        providerNeedsAppAccess:
          "プロバイダーは接続されていますが、Brain にはアプリへのアクセスが必要です。",
        providerNoCredential:
          "このプロバイダーは、資格情報キーなしで構成できます。",
        providerUnknown:
          "プロバイダーの準備ができているかどうかを判断できませんでした。",
        readyForSourceSetup: "ソースのセットアップの準備ができました。",
        readyThroughScopedRefs:
          "スコープ指定された Brain 資格情報参照を介して準備完了。",
        readyThroughSharedConnection:
          "共有ワークスペース接続を通じて準備が整います。",
        reauthorizeProviderConnection:
          "共有プロバイダー接続を再認証または修復します。",
        registeredCredentialRefAvailable:
          "登録された資格情報参照はボールトで使用できます。",
        requiredCredentialRefsAvailable:
          "必要な認証情報の参照は、値を公開せずに利用できます。",
        reuseProviderConnection:
          "Brain は、値を表示せずにプロバイダー接続を再利用できます。",
        scopedCredentialRefsConfigured:
          "スコープ付きの Brain 資格情報参照が構成されています。",
        scopedCredentialsAvailable:
          "スコープ付き Brain 資格情報はすでに使用可能です。",
        scopedLocalCredentialRefs:
          "Brain は、スコープ指定されたローカル資格情報参照を引き続き使用できます。",
        sourceSetupNotImplemented:
          "Brain ソース セットアップはこのプロバイダーには実装されていません。",
        workspaceConnectionGrantable:
          "ワークスペース接続が存在し、Brain に付与できます。",
        workspaceNotLoaded:
          "ワークスペースの接続ステータスがまだ読み込まれていません。",
      },
      reviewRawCapturesDescription: "蒸留前に輸入原料を確認してください。",
      reviewRawCaptures: "生のキャプチャを確認する",
      reviewRequiredDescription: "抽出されたナレッジを承認前にキューに入れる",
      reviewRequired: "要レビュー",
      runDueSyncs: "期限付き同期を実行する",
      scopedCredentialsReady: "スコープ付き認証情報の準備が完了しました",
      selectAll: "すべて選択",
      sharedConnection: "共有接続",
      sharedWorkspaceConnectionReady:
        "共有ワークスペース接続の準備ができました",
      slackAccessRuleScopes:
        "Slack アクセスは、auth.test、conversations.info/history、および chat.getPermalink をサポートする必要があります。プライベート チャネルを試験運用するときにプライベート チャネル アクセスを追加します。",
      slackAccessRules: "Slack アクセス ルール",
      slackSetupAllowList:
        "名前解決が許容される場合は、C0123456789 などの承認済みチャネル ID、または #product などのチャネル名を許可リストに追加します。",
      slackSetupGuide: "Slack セットアップ ガイド",
      slackSetupPrivateChannels:
        "同期する前に、Slack アプリをプライベート チャネルに招待します。 DMs と MPIMs は除外されたままになります。",
      slackSetupScopes:
        "最小スコープは channels:read と channels:history. です。プライベート チャネルには groups:read と groups:history を追加します。",
      syncNow: "今すぐ同期する",
      tuneSource: "チューンソース",
      unselectAll: "すべての選択を解除します",
      valuesHidden: "非表示の値",
      waitingForWorker:
        "Brain 蒸留作業者がナレッジを書き込むか、レビューのためにこのキャプチャを送信するのを待っています。",
      webhookSourceKeyDescription:
        "新しいソースは 1 回限りの取り込みトークンを受け取ります。既存のソースは、個別にローテーションされない限り、トークンを保持します。",
      webhookSourceKey: "Webhook ソースキー",
      workspaceConnections: "ワークスペース接続",
      workspaceConnection: "ワークスペース接続",
    },
  },
  "ko-KR": {
    ask: {
      composerPlaceholder: "회사 지식에 대해 물어보세요...",
      emptyState: "Brain에게 회사 지식에 대해 물어보세요.",
      heroDescription: "Brain은 인용된 회사 지식에서 나온 답변입니다.",
      heroTitle: "무엇을 알고 싶나요?",
    },
    ops: {
      allQueueItems: "모든 대기열 항목",
      allStatuses: "모든 상태",
      description:
        "하나의 압축된 대기열 보기에서 Brain 증류 핸드오프, 오래된 작업자 및 재시도 가능한 실패를 모니터링하세요.",
      noIssueRecorded: "기록된 문제 없음",
      noItemsDetail:
        "상태 또는 문제 필터를 변경하거나 새 캡처가 증류에 들어갈 때까지 기다립니다.",
      noItemsTitle: "이 보기와 일치하는 대기열 항목이 없습니다.",
      noRetryableFound: "재시도 가능한 증류 항목이 없습니다.",
      queueIssue: "대기열 문제",
      queueUnavailableDetail:
        "Brain은 액세스 가능한 증류 대기열 항목을 로드할 수 없습니다.",
      queueUnavailableTitle: "대기열을 사용할 수 없습니다.",
      retryAllRetryable: "재시도 가능한 모든 것을 재시도",
      retryControls: "재시도 제어",
      retryFailedDetail:
        "대기열 항목이 이미 완료되었거나 활성 상태이거나 더 이상 액세스할 수 없을 수 있습니다.",
      retryFailed: "재시도 실패",
      retrySelected: "재시도 선택됨",
      runAfter: "다음 이후에 실행",
      selectRetryable: "재시도 가능 선택",
      staleProcessing: "오래된 처리",
      title: "증류 작업",
      unselectRetryable: "재시도 가능 선택 해제",
    },
    review: {
      actionFailedDetail: "Brain은 제안서를 로드하거나 업데이트할 수 없습니다.",
      actionFailedTitle: "검토 작업 실패",
      approvalSavesEdits: "승인하면 문구 수정사항이 먼저 저장됩니다.",
      approveKnowledge: "지식 승인",
      approveRedactedDraft: "수정된 초안 승인",
      approveReplacement: "교체 승인",
      approveUpdate: "업데이트 승인",
      approvedProposals: "승인된 제안",
      capturedSource: "캡처된 소스",
      companyContext: "회사 상황",
      currentDraft: "현재 초안",
      description:
        "지속적인 가치, 소스 지원 및 올바른 개인 정보 보호 정책을 갖춘 제안된 메모리만 승인하세요.",
      details: {
        knowledgeTarget: "지식대상",
        publishTier: "게시 등급",
        resultStatus: "결과상태",
      },
      draftChanges: "초안 변경",
      editWording: "문구 편집",
      emptyDetail:
        "Brain이(가) 회사 지식으로 전환하기 전에 검토자가 필요할 때 여기에 새로운 소스 캡처가 나타납니다.",
      evidenceQuoteUnavailable: "증거 인용을 사용할 수 없습니다.",
      hideEditor: "편집기 숨기기",
      knowledgeBody: "지식 기관",
      moreActions: "추가 검토 작업",
      noFlags: "플래그 없음",
      noPrivacyDetail: "수정, 내보내기 또는 가시성 경고가 첨부되지 않았습니다.",
      noProposedKnowledge: "제안된 지식이 없습니다.",
      noSnippets: "스니펫 없음",
      noSourceSnippets: "이 제안서에는 소스 조각이 첨부되지 않았습니다.",
      notRecorded: "녹음되지 않음",
      notScored: "득점되지 않음",
      pendingProposals: "대기 중인 제안",
      previewCompanyContext: "회사 상황 미리보기",
      privacy: {
        canonicalExport: "정식 내보내기",
        companyTierKnowledge: "회사 수준의 지식",
        noPrivacyFlags: "개인 정보 보호 플래그 없음",
        redactedContent: "수정된 콘텐츠",
      },
      privacyFlags: "개인 정보 보호 플래그",
      proposedKnowledge: "제안된 지식",
      publishCompanyContext: "회사 컨텍스트로 게시",
      queueReason: {
        companyTier: "회사 계층 지식에는 검토자의 승인이 필요합니다.",
        default:
          "지속적인 회사 지식을 갖추기 전에 검토자의 승인을 위해 대기합니다.",
        privacySensitive:
          "개인정보에 민감한 콘텐츠 또는 수정된 콘텐츠에는 검토자의 확인이 필요합니다.",
      },
      queuedProposal: "대기 중인 제안서",
      rationalePlaceholder: "이것이 지속 가능한 지식이 되어야 하는 이유",
      rejectedProposals: "거부된 제안",
      reviewBeforeApproving: "승인하기 전에 검토하세요.",
      reviewSignals: "신호 검토",
      reviewerNotesPlaceholder: "이 결정에 대한 선택적 컨텍스트",
      reviewerNotes: "리뷰어 메모",
      reviewerQueue: "리뷰어 대기열",
      saveWording: "문구 저장",
      target: {
        archiveKnowledgeDetail:
          "승인하면 대상 지식이 보관된 것으로 표시됩니다.",
        archiveKnowledge: "아카이브 지식",
        createNewDetail:
          "승인하면 새로운 내구성 있는 회사 지식 항목이 추가됩니다.",
        createNew: "새로운 지식을 창조하다",
        mergeExisting: "기존 지식에 병합",
        mergeUpdateSupersede: "업데이트 병합 및 대체",
        supersedeExisting: "기존 지식을 대체합니다.",
      },
      targetAndPayload: "대상 및 페이로드",
      targetContext: "대상 컨텍스트",
      unsavedEdits: "저장되지 않은 수정사항",
      whyQueued: "대기 중인 이유",
    },
    searchPage: {
      allSources: "모든 소스",
      allStatuses: "모든 상태",
      allTypes: "모든 유형",
      citationQuote: "인용 인용",
      companyKnowledge: "회사 지식",
      description:
        "검토된 지식, 원시 캡처 및 소스 레코드를 검색한 다음 인용된 Brain 레코드 또는 원본 소스를 엽니다.",
      inTheseResults: "이 결과에서는",
      matchedIndex: "이 결과는 현재 검색 색인과 일치합니다.",
      noCitationQuote: "인용문이 없습니다.",
      noExcerpt: "발췌된 내용이 없습니다.",
      noMatchesDetail: "쿼리를 확장하거나 필터를 지우세요.",
      noMatchesTitle: "이 필터와 일치하는 지식이 없습니다.",
      noSummary: "이 결과에 대한 요약이 없습니다.",
      notAvailable: "사용할 수 없음",
      openBrainRecord: "Brain 레코드 열기",
      openRelatedSource: "관련 소스 공개",
      openSourceUrl: "오픈소스 URL",
      openSource: "오픈 소스",
      searchPlaceholder:
        "검색 결정, 고객 사실, 출처 이름, 기록 또는 정책 스니펫...",
      startDetail: "인용된 회사 지식을 검색하려면 문구를 입력하세요.",
      startTitle: "회사 지식 검색으로 시작하세요",
      title: "회사 지식 검색",
      unavailableDetail:
        "페이지를 새로 고치고 Brain 로드가 완료되면 다시 시도하세요.",
      unavailableTitle: "검색이 불가능합니다",
      untitledResult: "제목 없는 결과",
      viewInBrain: "Brain에서 보기",
      whyMatched: "이것이 일치하는 이유",
    },
    settings: {
      actionsUnavailableDetail:
        "이 페이지는 get-brain-settings 및 update-brain-settings에 연결되어 있으며 현재는 기본값을 사용하고 있습니다.",
      actionsUnavailableTitle: "아직 설정 작업을 사용할 수 없습니다.",
      assistantBehaviorDescription:
        "답변 및 정제된 지식 제안에 대한 기본 음성 및 소스 자세입니다.",
      autoArchiveResolvedDescription:
        "활성 검토 레인에서 승인되거나 거부된 대기열 항목을 제거합니다.",
      autoArchiveResolved: "해결된 리뷰 항목 자동 보관",
      autoPublishGateDescription: "회사 계층 지식에 대한 런타임 정책입니다.",
      autoPublishGateDetail:
        "신뢰도가 높은 회사 지식은 새롭고 수정되지 않은 것이며 명시적인 제안이 필요하지 않은 경우 자동으로 게시될 수 있습니다.",
      autoRedactEmailsDescription:
        "필수 증거가 아닌 이상 정제된 지식에서 이메일 주소를 제거하세요.",
      autoRedactEmails: "이메일 자동 수정",
      confidenceThreshold: "신뢰도 임계값",
      connectorPollInterval: "커넥터 폴링 간격",
      coreInstructionsDescription:
        "원시 캡처를 내구성 있는 제도적 지식으로 전환하기 위한 지침입니다.",
      coreInstructions: "핵심 지침",
      defaultPublishTierDescription:
        "새로 정제된 지식에 대한 기본 가시성을 설정합니다.",
      defaultPublishTier: "기본 게시 계층",
      identityDescription:
        "Brain이 자신과 보호하는 작업 공간을 설명할 때 사용하는 이름입니다.",
      notRequired: "필요하지 않음",
      notSet: "설정되지 않음",
      notifySourceErrorsDescription:
        "검토 흐름에서 표면 성능이 저하되거나 커넥터에 오류가 발생했습니다.",
      notifySourceErrors: "소스 오류 알림",
      policy: {
        preSaveFilter: "사전 저장 필터",
        publishTier: "게시 등급",
      },
      publishingReviewDescription:
        "가시성, 승인 및 커넥터 흐름에 대한 기본값입니다.",
      requireApprovalDescription:
        "게시하기 전에 사람의 검토를 위해 전사적 지식 후보를 대기열에 추가하세요.",
      requireApproval: "회사 지식에 대한 승인이 필요합니다.",
      requireCitationsDescription:
        "Ask Brain은 사실 답변에 대해 승인된 소스 행을 인용해야 합니다.",
      requireCitations: "인용이 필요합니다",
      safetyEvidenceDescription:
        "검토 대기열을 떠나는 답변에 대한 수정 및 인용 규칙입니다.",
      sanitizationInstructions: "소독 지침",
      sanitizationModelDescription:
        "사전 저장 필터링 패스에 대한 선택적 재정의.",
      sanitizationModelPlaceholder:
        "기본 에이전트 모델 또는 저렴한 플래시 모델",
      sanitizationModel: "살균 모델",
      sanitizeCapturesDescription:
        "저장하기 전에 Granola, Clips, 웹훅 및 수동 기록 가져오기를 필터링하여 회사 관련 콘텐츠로 가져옵니다.",
      sanitizeCaptures: "저장하기 전에 녹취록 캡처를 삭제하세요",
      sourcePolicy: {
        balanced: {
          description: "승인된 지식을 선호하고 소스 격차를 식별하십시오.",
        },
        exploratory: {
          description: "약한 신호를 사용하되 불확실성을 명확하게 표시하십시오.",
        },
        strict: {
          description: "승인된 지식과 인용을 통해서만 답변하십시오.",
        },
      },
      tone: {
        direct: {
          description: "간결하고 구체적이며 의사결정 지향적입니다.",
        },
        formal: {
          description: "신중하고, 정책에 대비하고, 경영진을 대면합니다.",
        },
        friendly: {
          description: "정확성을 잃지 않으면서 따뜻하고 솔직하게 말합니다.",
        },
        technical: {
          description: "상세하고 소스 중심이며 구현을 인식합니다.",
        },
      },
    },
    sources: {
      actionFailedDetail:
        "소스 자격 증명, 채널 허용 목록 및 최신 동기화 오류를 확인하세요.",
      actionFailedTitle: "소스 작업 실패",
      advancedDescription:
        "소스를 필터링하고, 연결 준비 상태를 확인하고, 일반 소스 목록이 충분하지 않은 경우 유지 관리 동기화를 실행하세요.",
      advancedTitle: "고급 소스 제어",
      allowedChannelsDescription:
        "Brain은 허용 목록을 확인하고 DMs/MPIMs을 거부하며 소스 구성에 자격 증명 값을 저장하지 않습니다.",
      allowedChannels: "허용된 채널",
      approvedRepositories: "승인된 저장소",
      autoSyncDescription:
        "백그라운드 폴링은 예정된 경우 이 소스를 사용합니다.",
      autoSync: "자동 동기화",
      automaticCredentialSelection: "자동 자격 증명 선택",
      batchDistillationDescription:
        "대기열에 넣을 수 있는 캡처를 선택하고 이를 Brain 증류 작업자에게 함께 전달합니다.",
      batchDistillation: "배치 증류",
      brainAppGrant: "Brain 앱 부여",
      brainHealth: "Brain 건강",
      captureInventoryFailedDetail: "소스 액세스를 확인하고 다시 시도하세요.",
      captureInventoryFailedTitle: "인벤토리 캡처 실패",
      catalogKeys: "카탈로그 키",
      connectProvider: "공급자 연결",
      connectTheProvider: "공급자 연결",
      connectionMetadataOnlyDetail:
        "Brain은(는) 이 연결 메타데이터를 재사용할 수 있지만 이 공급자에 대한 소스 설정은 아직 이 템플릿에 추가되지 않았습니다.",
      connectionMetadataOnly: "연결 메타데이터만",
      connectionProvidersDescription:
        "자격 증명 값을 노출하지 않고 작업 공간 통합을 재사용하거나, Brain 액세스 권한을 부여하거나, Brain-로컬 소스를 추가하세요.",
      connectionProviders: "연결 공급자",
      connectionReadiness: "연결 준비",
      credentialPath: "자격 증명 경로",
      credentialProvenance: "자격 증명 출처",
      credentialRefs: "자격 증명 참조",
      defaultTitle: {
        clips: "Clips 수출",
        generic: "일반 성적표 웹훅",
        github: "GitHub 제품 저장소",
        granola: "Granola 팀 노트",
        manual: "수동 가져오기",
        slack: "Slack 지식 채널",
      },
      description:
        "Brain이 학습할 수 있는 승인된 장소를 연결한 다음 필요에 따라 동기화하고 검토하세요.",
      emptyDetail:
        "승인된 Slack 채널, Granola Team-space 소스, GitHub 저장소, Clips 내보내기, 수동 가져오기 또는 서명된 웹훅을 추가하세요.",
      emptyTitle: "Brain의 첫 번째 소스를 연결하세요",
      githubRepositoriesDescription:
        "Brain은 작업 공간 GitHub 자격 증명을 사용하여 이러한 저장소에서 제한된 문제 및 끌어오기 요청 컨텍스트를 가져옵니다.",
      grantBrainAccess: "Brain 액세스 권한 부여",
      grantConnectionBeforePinning:
        "이 소스를 고정하기 전에 Dispatch의 Brain에 작업공간 연결을 부여하세요.",
      grantInDispatch: "Dispatch에 부여",
      healthReady:
        "소스, 검토 대기열 및 검색 확인을 정상적으로 사용할 준비가 되었습니다.",
      hideDetails: "세부정보 숨기기",
      includeIssues: "문제 포함",
      includePullRequests: "풀 요청 포함",
      initialUpdatedAfter: "초기 업데이트 이후",
      itemsPerRepo: "저장소당 항목",
      lastSync: "마지막 동기화",
      loadingProviderCatalog: "제공업체 카탈로그 로드 중...",
      messagesPerPage: "페이지당 메시지",
      nextCheck: "다음 확인",
      noBrainSourcesYet: "아직 Brain 소스가 없습니다.",
      noCapturesDetail:
        "다른 상태를 시도하거나, 소스 동기화를 실행하거나, 스크립트를 가져오세요.",
      noCapturesTitle: "이 보기와 일치하는 캡처가 없습니다.",
      noConnectionProviders:
        "공유 카탈로그에서는 Brain 연결 공급자를 사용할 수 없습니다.",
      noCredentialKeysRequired: "자격 증명 키가 필요하지 않습니다",
      noCredentialRefs: "이 연결에는 자격 증명 참조가 없습니다.",
      noCredentialRequired: "자격 증명이 필요하지 않습니다",
      noSharedWorkspaceConnection:
        "이 공급자에 대해 아직 등록된 공유 작업 공간 연결이 없습니다.",
      noSyncYet: "아직 동기화되지 않음",
      pageSize: "페이지 크기",
      pickGrantedConnection:
        "이 소스를 고정하려면 승인된 연결을 선택하고, 기존 자격 증명 대체를 사용하려면 자동으로 두세요.",
      pollMinutes: "설문조사 시간",
      previewsDescription: "의도적인 검토를 위해 짧은 스니펫 표시",
      provenance: {
        brainLocalCredential: "Brain-로컬 자격 증명",
        credentialSource: "자격 증명 소스",
        credentialVault: "자격증명 보관소",
        explicitBrainGrant: "명시적 Brain 부여",
      },
      providerConnection: "공급자 연결",
      queueSelected: "대기열이 선택됨",
      rawContentHidden:
        "원시 콘텐츠가 숨겨져 있습니다. 검토에 컨텍스트가 필요한 경우에만 미리보기를 활성화하거나 소스를 엽니다.",
      readiness: {
        accessGrantedConnectionInactive:
          "액세스가 허용되었지만 연결이 아직 활성화되지 않았습니다.",
        addReusableConnection:
          "Dispatch에 재사용 가능한 공급자 연결을 추가합니다.",
        addSharedOrScopedCredential:
          "공유 공급자 연결 또는 범위가 지정된 Brain 자격 증명을 추가합니다.",
        brainCanUseSharedConnection:
          "Brain은 공유 작업 공간 연결을 사용할 수 있습니다.",
        brainLocal: "Brain-로컬",
        credentialNotLoaded: "자격 증명 가용성이 아직 로드되지 않았습니다.",
        grantAppearsAfterConnection:
          "작업 영역 공급자 연결이 존재하면 권한 부여가 나타납니다.",
        grantExistingConnection:
          "Brain 앱에 대한 기존 공급자 연결을 부여합니다.",
        grantNeedsAttention:
          "Brain에 권한이 있지만 공급자 연결에 주의가 필요합니다.",
        grantedRepair: "물론, 수리",
        noCredentialKeyRequired:
          "이 공급자에는 자격 증명 키가 필요하지 않습니다.",
        noGrant: "보조금 없음",
        notNeeded: "필요하지 않음",
        providerNeedsAppAccess:
          "제공업체가 연결되어 있지만 Brain에 앱 액세스 권한이 필요합니다.",
        providerNoCredential:
          "이 공급자는 자격 증명 키 없이 구성될 수 있습니다.",
        providerUnknown: "공급자 준비 상태를 확인할 수 없습니다.",
        readyForSourceSetup: "소스 설정 준비가 완료되었습니다.",
        readyThroughScopedRefs:
          "범위가 지정된 Brain 자격 증명 참조를 통해 준비되었습니다.",
        readyThroughSharedConnection: "공유 작업 공간 연결을 통해 준비됩니다.",
        reauthorizeProviderConnection:
          "공유 공급자 연결을 다시 인증하거나 복구합니다.",
        registeredCredentialRefAvailable:
          "등록된 자격 증명 참조는 저장소에서 사용할 수 있습니다.",
        requiredCredentialRefsAvailable:
          "값을 노출하지 않고도 필수 자격 증명 참조를 사용할 수 있습니다.",
        reuseProviderConnection:
          "Brain은 값을 표시하지 않고 공급자 연결을 재사용할 수 있습니다.",
        scopedCredentialRefsConfigured:
          "범위가 지정된 Brain 자격 증명 참조가 구성되었습니다.",
        scopedCredentialsAvailable:
          "범위가 지정된 Brain 자격 증명을 이미 사용할 수 있습니다.",
        scopedLocalCredentialRefs:
          "Brain은 범위가 지정된 로컬 자격 증명 참조를 계속 사용할 수 있습니다.",
        sourceSetupNotImplemented:
          "Brain 소스 설정은 이 공급자에 대해 구현되지 않습니다.",
        workspaceConnectionGrantable:
          "작업공간 연결이 존재하며 Brain에 부여될 수 있습니다.",
        workspaceNotLoaded: "Workspace 연결 상태가 아직 로드되지 않았습니다.",
      },
      reviewRawCapturesDescription: "증류하기 전에 수입된 원료를 검토하십시오.",
      reviewRawCaptures: "원시 캡처 검토",
      reviewRequiredDescription: "승인 전 큐 추출 지식",
      reviewRequired: "검토 필요",
      runDueSyncs: "예정된 동기화 실행",
      scopedCredentialsReady: "범위가 지정된 자격 증명 준비됨",
      selectAll: "모두 선택",
      sharedConnection: "공유 연결",
      sharedWorkspaceConnectionReady: "공유 작업공간 연결 준비됨",
      slackAccessRuleScopes:
        "Slack 액세스는 auth.test, conversations.info/history 및 chat.getPermalink을 지원해야 합니다. 비공개 채널을 시험할 때 비공개 채널 액세스를 추가하세요.",
      slackAccessRules: "Slack 액세스 규칙",
      slackSetupAllowList:
        "이름 확인이 허용되는 경우 C0123456789과 같은 승인된 채널 ID 또는 #product과 같은 채널 이름을 허용 목록에 추가하세요.",
      slackSetupGuide: "Slack 설정 가이드",
      slackSetupPrivateChannels:
        "동기화하기 전에 Slack 앱을 비공개 채널에 초대하세요. DMs 및 MPIMs은 제외됩니다.",
      slackSetupScopes:
        "최소 범위는 channels:read 및 channels:history.입니다. 비공개 채널의 경우 groups:read 및 groups:history을 추가하세요.",
      syncNow: "지금 동기화",
      tuneSource: "소스 조정",
      unselectAll: "모두 선택 취소",
      valuesHidden: "숨겨진 값",
      waitingForWorker:
        "Brain 증류 작업자가 지식을 기록하거나 검토를 위해 이 캡처를 보내기를 기다리는 중입니다.",
      webhookSourceKeyDescription:
        "새 소스는 일회성 수집 토큰을 받습니다. 기존 소스는 별도로 순환되지 않는 한 토큰을 유지합니다.",
      webhookSourceKey: "Webhook 소스 키",
      workspaceConnections: "작업 공간 연결",
      workspaceConnection: "작업공간 연결",
    },
  },
  "pt-BR": {
    ask: {
      composerPlaceholder: "Pergunte sobre o conhecimento da empresa...",
      emptyState: "Pergunte a Brain sobre o conhecimento da empresa.",
      heroDescription: "Brain respostas do conhecimento da empresa citado.",
      heroTitle: "O que você quer saber?",
    },
    ops: {
      allQueueItems: "Todos os itens da fila",
      allStatuses: "Todos os status",
      description:
        "Monitore transferências de destilação Brain, trabalhadores obsoletos e falhas repetíveis em uma visualização de fila compacta.",
      noIssueRecorded: "Nenhum problema registrado",
      noItemsDetail:
        "Altere o status ou o filtro de emissão ou aguarde que novas capturas entrem na destilação.",
      noItemsTitle: "Nenhum item da fila corresponde a esta visualização",
      noRetryableFound: "Nenhum item de destilação repetível encontrado",
      queueIssue: "Problema na fila",
      queueUnavailableDetail:
        "Brain não pôde carregar itens acessíveis da fila de destilação.",
      queueUnavailableTitle: "Fila indisponível",
      retryAllRetryable: "Tentar novamente tudo",
      retryControls: "Repetir controles",
      retryFailedDetail:
        "O item da fila pode já estar concluído, ativo ou não estar mais acessível.",
      retryFailed: "Falha na nova tentativa",
      retrySelected: "Tentar novamente selecionado",
      runAfter: "Corra atrás",
      selectRetryable: "Selecione retentável",
      staleProcessing: "Processamento obsoleto",
      title: "Operações de destilação",
      unselectRetryable: "Desmarcar nova tentativa",
    },
    review: {
      actionFailedDetail: "Brain não pôde carregar ou atualizar propostas.",
      actionFailedTitle: "Falha na ação de revisão",
      approvalSavesEdits: "A aprovação salva primeiro as edições de texto.",
      approveKnowledge: "Aprovar conhecimento",
      approveRedactedDraft: "Aprovar rascunho redigido",
      approveReplacement: "Aprovar substituição",
      approveUpdate: "Aprovar atualização",
      approvedProposals: "Propostas aprovadas",
      capturedSource: "Fonte capturada",
      companyContext: "Contexto da empresa",
      currentDraft: "Rascunho atual",
      description:
        "Aprove apenas as memórias propostas que tenham valor durável, suporte de origem e postura correta de privacidade.",
      details: {
        knowledgeTarget: "Meta de conhecimento",
        publishTier: "Publicar nível",
        resultStatus: "Estado do resultado",
      },
      draftChanges: "Rascunhos de alterações",
      editWording: "Editar texto",
      emptyDetail:
        "Novas capturas de fontes aparecem aqui quando Brain precisa de um revisor antes de transformá-las em conhecimento da empresa.",
      evidenceQuoteUnavailable: "Citação de evidência indisponível",
      hideEditor: "Ocultar editor",
      knowledgeBody: "Corpo de conhecimento",
      moreActions: "Mais ações de revisão",
      noFlags: "Sem bandeiras",
      noPrivacyDetail:
        "Nenhum aviso de redação, exportação ou visibilidade foi anexado.",
      noProposedKnowledge: "Nenhum conhecimento proposto.",
      noSnippets: "Sem trechos",
      noSourceSnippets: "Nenhum trecho de origem foi anexado a esta proposta.",
      notRecorded: "Não gravado",
      notScored: "Não marcou",
      pendingProposals: "Propostas pendentes",
      previewCompanyContext: "Pré-visualizar o contexto da empresa",
      privacy: {
        canonicalExport: "Exportação canônica",
        companyTierKnowledge: "Conhecimento do nível da empresa",
        noPrivacyFlags: "Sem sinalizadores de privacidade",
        redactedContent: "Conteúdo redigido",
      },
      privacyFlags: "Sinalizadores de privacidade",
      proposedKnowledge: "Conhecimento proposto",
      publishCompanyContext: "Publicar como contexto da empresa",
      queueReason: {
        companyTier:
          "O conhecimento do nível da empresa requer aprovação do revisor.",
        default:
          "Na fila para aprovação do revisor antes de se tornar um conhecimento durável da empresa.",
        privacySensitive:
          "Conteúdo sensível à privacidade ou editado precisa da confirmação do revisor.",
      },
      queuedProposal: "Proposta na fila",
      rationalePlaceholder:
        "Por que isso deveria se tornar um conhecimento durável",
      rejectedProposals: "Propostas rejeitadas",
      reviewBeforeApproving: "Revise antes de aprovar.",
      reviewSignals: "Revise os sinais",
      reviewerNotesPlaceholder: "Contexto opcional para esta decisão",
      reviewerNotes: "Notas do revisor",
      reviewerQueue: "Fila do revisor",
      saveWording: "Salvar texto",
      target: {
        archiveKnowledgeDetail:
          "A aprovação marca o conhecimento alvo como arquivado.",
        archiveKnowledge: "Arquivar conhecimento",
        createNewDetail:
          "A aprovação adiciona uma nova entrada durável de conhecimento da empresa.",
        createNew: "Crie novos conhecimentos",
        mergeExisting: "Fundir-se com o conhecimento existente",
        mergeUpdateSupersede: "Mesclar atualização e substituição",
        supersedeExisting: "Substitua o conhecimento existente",
      },
      targetAndPayload: "Alvo e carga útil",
      targetContext: "Contexto alvo",
      unsavedEdits: "Edições não salvas",
      whyQueued: "Por que na fila",
    },
    searchPage: {
      allSources: "Todas as fontes",
      allStatuses: "Todos os status",
      allTypes: "Todos os tipos",
      citationQuote: "Citação",
      companyKnowledge: "Conhecimento da empresa",
      description:
        "Pesquise conhecimento revisado, capturas brutas e registros de origem e, em seguida, abra o registro Brain citado ou a fonte original.",
      inTheseResults: "Nestes resultados",
      matchedIndex: "Este resultado correspondeu ao índice de pesquisa atual.",
      noCitationQuote: "Nenhuma cotação está disponível.",
      noExcerpt: "Nenhum trecho está disponível.",
      noMatchesDetail: "Amplie a consulta ou limpe um filtro.",
      noMatchesTitle: "Nenhum conhecimento corresponde a esses filtros",
      noSummary: "Nenhum resumo está disponível para este resultado.",
      notAvailable: "Não disponível",
      openBrainRecord: "Abra o registro Brain",
      openRelatedSource: "Código aberto relacionado",
      openSourceUrl: "URL de código aberto",
      openSource: "Código aberto",
      searchPlaceholder:
        "Pesquise decisões, fatos de clientes, nomes de fontes, transcrições ou trechos de políticas...",
      startDetail:
        "Insira uma frase para pesquisar o conhecimento citado da empresa.",
      startTitle: "Comece com uma pesquisa de conhecimento da empresa",
      title: "Pesquise conhecimento da empresa",
      unavailableDetail:
        "Atualize a página e tente novamente quando Brain terminar de carregar.",
      unavailableTitle: "A pesquisa não está disponível",
      untitledResult: "Resultado sem título",
      viewInBrain: "Ver em Brain",
      whyMatched: "Por que isso combinou",
    },
    settings: {
      actionsUnavailableDetail:
        "Esta página está conectada a get-brain-settings e update-brain-settings e está usando padrões por enquanto.",
      actionsUnavailableTitle:
        "As ações de configuração ainda não estão disponíveis",
      assistantBehaviorDescription:
        "A voz padrão e a postura de origem para respostas e propostas de conhecimento destilado.",
      autoArchiveResolvedDescription:
        "Remova itens da fila aprovados ou rejeitados da via de revisão ativa.",
      autoArchiveResolved:
        "Arquivar automaticamente itens de revisão resolvidos",
      autoPublishGateDescription:
        "Política de tempo de execução para conhecimento no nível da empresa.",
      autoPublishGateDetail:
        "O conhecimento da empresa de alta confiança pode ser publicado automaticamente quando for novo, não editado e não exigir uma proposta explícita.",
      autoRedactEmailsDescription:
        "Remova endereços de e-mail do conhecimento destilado, a menos que sejam evidências essenciais.",
      autoRedactEmails: "Redação automática de e-mails",
      confidenceThreshold: "Limite de confiança",
      connectorPollInterval: "Intervalo de pesquisa do conector",
      coreInstructionsDescription:
        "Orientação para transformar capturas brutas em conhecimento institucional durável.",
      coreInstructions: "Instruções básicas",
      defaultPublishTierDescription:
        "Define a visibilidade padrão para conhecimento recém-destilado.",
      defaultPublishTier: "Camada de publicação padrão",
      identityDescription:
        "Os nomes que Brain usa quando descreve a si mesmo e ao espaço de trabalho que está protegendo.",
      notRequired: "Não obrigatório",
      notSet: "Não definido",
      notifySourceErrorsDescription:
        "Superfície de conectores degradados ou com falha no fluxo de revisão.",
      notifySourceErrors: "Notificar sobre erros de origem",
      policy: {
        preSaveFilter: "Filtro de pré-salvamento",
        publishTier: "Publicar nível",
      },
      publishingReviewDescription:
        "Padrões para visibilidade, aprovação e cadência do conector.",
      requireApprovalDescription:
        "Coloque na fila os candidatos de conhecimento de toda a empresa para revisão humana antes de publicar.",
      requireApproval: "Exigir aprovação para conhecimento da empresa",
      requireCitationsDescription:
        "Ask Brain deve citar linhas de origem aprovadas para respostas factuais.",
      requireCitations: "Exigir citações",
      safetyEvidenceDescription:
        "Regras de redação e citação para respostas que saem da fila de revisão.",
      sanitizationInstructions: "Instruções de higienização",
      sanitizationModelDescription:
        "Substituição opcional para a passagem de filtragem pré-salvamento.",
      sanitizationModelPlaceholder:
        "Modelo de agente padrão ou um modelo flash mais barato",
      sanitizationModel: "Modelo de higienização",
      sanitizeCapturesDescription:
        "Filtre as importações de Granola, Clips, webhook e transcrição manual para conteúdo relevante para a empresa antes de salvar.",
      sanitizeCaptures:
        "Limpe as capturas de transcrição antes do armazenamento",
      sourcePolicy: {
        balanced: {
          description:
            "Prefira o conhecimento aprovado e, em seguida, identifique as lacunas na fonte.",
        },
        exploratory: {
          description:
            "Use sinais mais fracos, mas rotule claramente a incerteza.",
        },
        strict: {
          description:
            "Responda apenas com base em conhecimentos aprovados e citações.",
        },
      },
      tone: {
        direct: {
          description: "Conciso, concreto e orientado para a decisão.",
        },
        formal: {
          description:
            "Cuidadoso, pronto para políticas e voltado para executivos.",
        },
        friendly: {
          description: "Caloroso e franco, sem perder a precisão.",
        },
        technical: {
          description:
            "Detalhado, com muitos recursos e com reconhecimento de implementação.",
        },
      },
    },
    sources: {
      actionFailedDetail:
        "Verifique as credenciais de origem, as listas de permissões de canais e o erro de sincronização mais recente.",
      actionFailedTitle: "Falha na ação de origem",
      advancedDescription:
        "Filtre fontes, verifique a disponibilidade da conexão e execute sincronizações de manutenção quando a lista normal de fontes não for suficiente.",
      advancedTitle: "Controles de origem avançados",
      allowedChannelsDescription:
        "Brain verifica a lista de permissões, rejeita DMs/MPIMs e nunca armazena valores de credenciais na configuração de origem.",
      allowedChannels: "Canais permitidos",
      approvedRepositories: "Repositórios aprovados",
      autoSyncDescription:
        "A pesquisa em segundo plano usa esta fonte quando devido",
      autoSync: "Sincronização automática",
      automaticCredentialSelection: "Seleção automática de credenciais",
      batchDistillationDescription:
        "Selecione capturas enfileiradas e entregue-as ao trabalhador de destilação Brain juntos.",
      batchDistillation: "Destilação em lote",
      brainAppGrant: "Brain concessão de aplicativo",
      brainHealth: "Brain saúde",
      captureInventoryFailedDetail:
        "Verifique o acesso à fonte e tente novamente.",
      captureInventoryFailedTitle: "Falha ao capturar inventário",
      catalogKeys: "Chaves de catálogo",
      connectProvider: "Conectar provedor",
      connectTheProvider: "Conecte o provedor",
      connectionMetadataOnlyDetail:
        "Brain pode reutilizar esses metadados de conexão, mas a configuração de origem deste provedor ainda não foi adicionada a este modelo.",
      connectionMetadataOnly: "Somente metadados de conexão",
      connectionProvidersDescription:
        "Reutilize integrações de espaço de trabalho, conceda acesso Brain ou adicione fontes locais Brain sem expor valores de credenciais.",
      connectionProviders: "Provedores de conexão",
      connectionReadiness: "Prontidão de conexão",
      credentialPath: "Caminho da credencial",
      credentialProvenance: "Proveniência da credencial",
      credentialRefs: "Referências de credenciais",
      defaultTitle: {
        clips: "Clips exportações",
        generic: "Webhook de transcrição genérica",
        github: "GitHub repositórios de produtos",
        granola: "Granola notas da equipe",
        manual: "Importações manuais",
        slack: "Slack canais de conhecimento",
      },
      description:
        "Conecte locais aprovados com os quais Brain pode aprender e, em seguida, sincronize e revise-os conforme necessário.",
      emptyDetail:
        "Adicione um canal Slack aprovado, fonte Granola Team-space, repositório GitHub, exportação Clips, importação manual ou webhook assinado.",
      emptyTitle: "Conecte a primeira fonte de Brain",
      githubRepositoriesDescription:
        "Brain importa o problema limitado e o contexto de pull request desses repositórios usando a credencial do espaço de trabalho GitHub.",
      grantBrainAccess: "Conceder acesso Brain",
      grantConnectionBeforePinning:
        "Conceda uma conexão de espaço de trabalho para Brain em Dispatch antes de fixar esta fonte.",
      grantInDispatch: "Conceder em Dispatch",
      healthReady:
        "Fontes, fila de revisão e verificações de recuperação estão prontas para uso normal.",
      hideDetails: "Ocultar detalhes",
      includeIssues: "Incluir problemas",
      includePullRequests: "Incluir solicitações pull",
      initialUpdatedAfter: "Inicial atualizado depois",
      itemsPerRepo: "Itens por repositório",
      lastSync: "Última sincronização",
      loadingProviderCatalog: "Carregando catálogo de provedores...",
      messagesPerPage: "Mensagens por página",
      nextCheck: "Próxima verificação",
      noBrainSourcesYet: "Nenhuma fonte Brain ainda",
      noCapturesDetail:
        "Tente outro status, execute uma sincronização de origem ou importe uma transcrição.",
      noCapturesTitle: "Nenhuma captura corresponde a esta visualização",
      noConnectionProviders:
        "Nenhum provedor de conexão Brain está disponível no catálogo compartilhado.",
      noCredentialKeysRequired: "Nenhuma chave de credencial necessária",
      noCredentialRefs: "Nenhuma referência de credencial nesta conexão",
      noCredentialRequired: "Nenhuma credencial necessária",
      noSharedWorkspaceConnection:
        "Nenhuma conexão de espaço de trabalho compartilhado foi registrada para este provedor ainda.",
      noSyncYet: "Ainda não há sincronização",
      pageSize: "Tamanho da página",
      pickGrantedConnection:
        "Escolha uma conexão concedida para fixar esta fonte ou deixe automático para usar a credencial substituta existente.",
      pollMinutes: "Minutas da enquete",
      previewsDescription: "Mostrar pequenos trechos para revisão intencional",
      provenance: {
        brainLocalCredential: "Brain-credencial local",
        credentialSource: "Fonte de credencial",
        credentialVault: "Cofre de credenciais",
        explicitBrainGrant: "concessão Brain explícita",
      },
      providerConnection: "Conexão do provedor",
      queueSelected: "Fila selecionada",
      rawContentHidden:
        "Conteúdo bruto oculto. Ative visualizações ou abra a fonte somente quando a revisão exigir contexto.",
      readiness: {
        accessGrantedConnectionInactive:
          "O acesso foi concedido, mas a conexão ainda não está ativa.",
        addReusableConnection:
          "Adicione uma conexão de provedor reutilizável em Dispatch.",
        addSharedOrScopedCredential:
          "Adicione uma conexão de provedor compartilhada ou uma credencial Brain com escopo definido.",
        brainCanUseSharedConnection:
          "Brain pode usar a conexão de espaço de trabalho compartilhado.",
        brainLocal: "[pt-BR] Brain-local",
        credentialNotLoaded:
          "A disponibilidade da credencial ainda não foi carregada.",
        grantAppearsAfterConnection:
          "Uma concessão aparece depois que existe uma conexão do provedor de espaço de trabalho.",
        grantExistingConnection:
          "Conceda a conexão do provedor existente ao aplicativo Brain.",
        grantNeedsAttention:
          "Brain possui concessão, mas a conexão do provedor precisa de atenção.",
        grantedRepair: "Concedido, reparo",
        noCredentialKeyRequired:
          "Este provedor não requer uma chave de credencial.",
        noGrant: "Sem subsídio",
        notNeeded: "Não é necessário",
        providerNeedsAppAccess:
          "O provedor está conectado, mas Brain precisa de acesso ao aplicativo.",
        providerNoCredential:
          "Este provedor pode ser configurado sem uma chave de credencial.",
        providerUnknown: "A prontidão do fornecedor não pôde ser determinada.",
        readyForSourceSetup: "Pronto para configuração de origem.",
        readyThroughScopedRefs:
          "Pronto por meio de referências de credenciais Brain com escopo definido.",
        readyThroughSharedConnection:
          "Pronto por meio de uma conexão de espaço de trabalho compartilhado.",
        reauthorizeProviderConnection:
          "Autorize novamente ou repare a conexão do provedor compartilhado.",
        registeredCredentialRefAvailable:
          "Uma referência de credencial registrada está disponível no cofre.",
        requiredCredentialRefsAvailable:
          "As referências de credenciais necessárias estão disponíveis sem expor valores.",
        reuseProviderConnection:
          "Brain pode reutilizar a conexão do provedor sem mostrar valores.",
        scopedCredentialRefsConfigured:
          "As referências de credenciais Brain com escopo definido estão configuradas.",
        scopedCredentialsAvailable:
          "As credenciais Brain com escopo definido já estão disponíveis.",
        scopedLocalCredentialRefs:
          "Brain ainda pode usar referências de credenciais locais com escopo definido.",
        sourceSetupNotImplemented:
          "A configuração de origem Brain não está implementada para este provedor.",
        workspaceConnectionGrantable:
          "Existe uma conexão de espaço de trabalho e pode ser concedida a Brain.",
        workspaceNotLoaded:
          "O status da conexão do espaço de trabalho ainda não foi carregado.",
      },
      reviewRawCapturesDescription:
        "Revise a matéria-prima importada antes da destilação.",
      reviewRawCaptures: "Revise capturas brutas",
      reviewRequiredDescription:
        "Fila de conhecimento extraído antes da aprovação",
      reviewRequired: "Revisão necessária",
      runDueSyncs: "Execute as sincronizações devidas",
      scopedCredentialsReady: "Credenciais com escopo pronto",
      selectAll: "Selecionar tudo",
      sharedConnection: "Conexão compartilhada",
      sharedWorkspaceConnectionReady:
        "Conexão de espaço de trabalho compartilhado pronta",
      slackAccessRuleScopes:
        "O acesso Slack deve suportar auth.test, conversations.info/history e chat.getPermalink. Adicione acesso a canais privados ao testar canais privados.",
      slackAccessRules: "Slack regras de acesso",
      slackSetupAllowList:
        "Adicione IDs de canais aprovados à lista de permissões, como C0123456789, ou nomes de canais, como #product, quando a resolução de nomes for aceitável.",
      slackSetupGuide: "Slack guia de configuração",
      slackSetupPrivateChannels:
        "Convide o aplicativo Slack para canais privados antes de sincronizar. DMs e MPIMs permanecem excluídos.",
      slackSetupScopes:
        "Os escopos mínimos são channels:read e channels:history. Adicione groups:read e groups:history para canais privados.",
      syncNow: "Sincronize agora",
      tuneSource: "Fonte de sintonia",
      unselectAll: "Desmarcar tudo",
      valuesHidden: "Valores ocultos",
      waitingForWorker:
        "Aguardando que o trabalhador da destilação Brain escreva o conhecimento ou envie esta captura para revisão.",
      webhookSourceKeyDescription:
        "Novas fontes recebem um token de ingestão único. As fontes existentes mantêm seu token, a menos que sejam rotacionadas separadamente.",
      webhookSourceKey: "Webhook chave de origem",
      workspaceConnections: "Conexões do espaço de trabalho",
      workspaceConnection: "Conexão do espaço de trabalho",
    },
  },
  "zh-CN": {
    ask: {
      composerPlaceholder: "询问公司知识...",
      emptyState: "向 Brain 询问公司知识。",
      heroDescription: "Brain 答案来自引用的公司知识。",
      heroTitle: "你想知道什么？",
    },
    ops: {
      allQueueItems: "所有队列项目",
      allStatuses: "所有状态",
      description:
        "从一个紧凑的队列视图监控 Brain 蒸馏切换、过时的工作线程和可重试的故障。",
      noIssueRecorded: "没有记录任何问题",
      noItemsDetail: "更改状态或问题过滤器，或等待新的捕获进入蒸馏。",
      noItemsTitle: "没有队列项目与此视图匹配",
      noRetryableFound: "未找到可重试的蒸馏项目",
      queueIssue: "队列问题",
      queueUnavailableDetail: "Brain 无法加载可访问的蒸馏队列项目。",
      queueUnavailableTitle: "队列不可用",
      retryAllRetryable: "重试所有可重试的",
      retryControls: "重试控制",
      retryFailedDetail: "队列项目可能已完成、处于活动状态或不再可访问。",
      retryFailed: "重试失败",
      retrySelected: "重试所选",
      runAfter: "追赶",
      selectRetryable: "选择可重试",
      staleProcessing: "陈旧处理",
      title: "蒸馏操作",
      unselectRetryable: "取消选择可重试",
    },
    review: {
      actionFailedDetail: "Brain 无法加载或更新提案。",
      actionFailedTitle: "审核操作失败",
      approvalSavesEdits: "批准首先保存措辞编辑。",
      approveKnowledge: "认可知识",
      approveRedactedDraft: "批准修订草案",
      approveReplacement: "批准更换",
      approveUpdate: "批准更新",
      approvedProposals: "批准的提案",
      capturedSource: "捕获的源",
      companyContext: "公司背景",
      currentDraft: "当前草案",
      description: "仅批准具有持久价值、来源支持和正确隐私立场的提议记忆。",
      details: {
        knowledgeTarget: "知识目标",
        publishTier: "发布层",
        resultStatus: "结果状态",
      },
      draftChanges: "草案变更",
      editWording: "编辑措辞",
      emptyDetail:
        "当 Brain 在将其转化为公司知识之前需要审阅者时，新的源捕获会出现在此处。",
      evidenceQuoteUnavailable: "无法提供证据引用",
      hideEditor: "隐藏编辑器",
      knowledgeBody: "知识体",
      moreActions: "更多审查行动",
      noFlags: "无旗帜",
      noPrivacyDetail: "未附加任何编辑、导出或可见性警告。",
      noProposedKnowledge: "没有建议的知识。",
      noSnippets: "没有片段",
      noSourceSnippets: "该提案没有附加源代码片段。",
      notRecorded: "未记录",
      notScored: "未得分",
      pendingProposals: "待决提案",
      previewCompanyContext: "预览公司背景",
      privacy: {
        canonicalExport: "规范导出",
        companyTierKnowledge: "公司级知识",
        noPrivacyFlags: "没有隐私标志",
        redactedContent: "已编辑内容",
      },
      privacyFlags: "隐私标志",
      proposedKnowledge: "建议知识",
      publishCompanyContext: "作为公司上下文发布",
      queueReason: {
        companyTier: "公司级知识需要审阅者批准。",
        default: "在成为持久的公司知识之前排队等待审阅者批准。",
        privacySensitive: "隐私敏感或经过编辑的内容需要审阅者确认。",
      },
      queuedProposal: "排队的提案",
      rationalePlaceholder: "为什么这应该成为持久的知识",
      rejectedProposals: "拒绝的提案",
      reviewBeforeApproving: "批准前审查。",
      reviewSignals: "审查信号",
      reviewerNotesPlaceholder: "此决定的可选背景",
      reviewerNotes: "审稿人笔记",
      reviewerQueue: "审稿人队列",
      saveWording: "保存措辞",
      target: {
        archiveKnowledgeDetail: "批准将目标知识标记为已存档。",
        archiveKnowledge: "归档知识",
        createNewDetail: "批准添加了新的持久公司知识条目。",
        createNew: "创造新知识",
        mergeExisting: "融入现有知识",
        mergeUpdateSupersede: "合并更新并取代",
        supersedeExisting: "取代现有知识",
      },
      targetAndPayload: "目标和有效载荷",
      targetContext: "目标背景",
      unsavedEdits: "未保存的编辑",
      whyQueued: "为什么要排队",
    },
    searchPage: {
      allSources: "所有来源",
      allStatuses: "所有状态",
      allTypes: "所有类型",
      citationQuote: "引文报价",
      companyKnowledge: "公司知识",
      description:
        "搜索已审阅的知识、原始捕获和源记录，然后打开引用的 Brain 记录或原始源。",
      inTheseResults: "在这些结果中",
      matchedIndex: "该结果与当前搜索索引匹配。",
      noCitationQuote: "没有可用的引文。",
      noExcerpt: "没有可用的摘录。",
      noMatchesDetail: "扩大查询范围或清除过滤器。",
      noMatchesTitle: "没有知识与这些过滤器匹配",
      noSummary: "此结果没有可用的摘要。",
      notAvailable: "不可用",
      openBrainRecord: "打开Brain记录",
      openRelatedSource: "打开相关源码",
      openSourceUrl: "开源网址",
      openSource: "开源",
      searchPlaceholder: "搜索决策、客户事实、来源名称、文字记录或政策片段...",
      startDetail: "输入短语以搜索引用的公司知识。",
      startTitle: "从公司知识搜索开始",
      title: "搜索公司知识",
      unavailableDetail: "刷新页面并在 Brain 完成加载后重试。",
      unavailableTitle: "搜索不可用",
      untitledResult: "无标题结果",
      viewInBrain: "在 Brain 中查看",
      whyMatched: "为什么这个匹配",
    },
    settings: {
      actionsUnavailableDetail:
        "此页面连接到 get-brain-settings 和 update-brain-settings 并且目前使用默认值。",
      actionsUnavailableTitle: "设置操作尚不可用",
      assistantBehaviorDescription: "答案和提炼知识建议的默认语音和源姿势。",
      autoArchiveResolvedDescription:
        "从活动审核通道中删除批准或拒绝的队列项目。",
      autoArchiveResolved: "自动存档已解决的审阅项目",
      autoPublishGateDescription: "公司级知识的运行时策略。",
      autoPublishGateDetail:
        "高可信度的公司知识可以在新的、未经编辑的情况下自动发布，并且不需要明确的建议。",
      autoRedactEmailsDescription:
        "从蒸馏知识中删除电子邮件地址，除非它们是必要的证据。",
      autoRedactEmails: "自动编辑电子邮件",
      confidenceThreshold: "置信阈值",
      connectorPollInterval: "连接器轮询间隔",
      coreInstructionsDescription: "将原始捕获转化为持久的机构知识的指南。",
      coreInstructions: "核心指令",
      defaultPublishTierDescription: "设置新提取的知识的默认可见性。",
      defaultPublishTier: "默认发布层",
      identityDescription: "Brain 在描述自身及其所保护的工作空间时使用的名称。",
      notRequired: "不需要",
      notSet: "未设置",
      notifySourceErrorsDescription: "审查流程中表面退化或失效的连接器。",
      notifySourceErrors: "通知源错误",
      policy: {
        preSaveFilter: "预保存过滤器",
        publishTier: "发布层",
      },
      publishingReviewDescription: "可见性、批准和连接器节奏的默认值。",
      requireApprovalDescription:
        "在发布之前对全公司范围内的知识候选者进行排队以供人工审核。",
      requireApproval: "需要公司知识的批准",
      requireCitationsDescription:
        "询问 Brain 必须引用经批准的源行以获得事实答案。",
      requireCitations: "需要引用",
      safetyEvidenceDescription: "离开审核队列的答案的编辑和引用规则。",
      sanitizationInstructions: "消毒说明",
      sanitizationModelDescription: "预保存过滤过程的可选覆盖。",
      sanitizationModelPlaceholder: "默认代理模型或更便宜的闪存模型",
      sanitizationModel: "消毒模型",
      sanitizeCapturesDescription:
        "在保存之前，将 Granola、Clips、webhook 和手动成绩单导入过滤为与公司相关的内容。",
      sanitizeCaptures: "存储前清理转录捕获",
      sourcePolicy: {
        balanced: {
          description: "优先选择经过认可的知识，然后确定来源差距。",
        },
        exploratory: {
          description: "使用较弱的信号，但清楚地标记不确定性。",
        },
        strict: {
          description: "仅根据认可的知识和引文进行回答。",
        },
      },
      tone: {
        direct: {
          description: "简洁、具体、以决策为导向。",
        },
        formal: {
          description: "谨慎、政策准备好、面向行政人员。",
        },
        friendly: {
          description: "热情直率，又不失精准。",
        },
        technical: {
          description: "详细、来源丰富且具有实施意识。",
        },
      },
    },
    sources: {
      actionFailedDetail: "检查源凭据、通道允许列表和最新的同步错误。",
      actionFailedTitle: "源操作失败",
      advancedDescription:
        "过滤源，检查连接准备情况，并在正常源列表不够时运行维护同步。",
      advancedTitle: "高级源代码控制",
      allowedChannelsDescription:
        "Brain 验证允许列表，拒绝 DMs/MPIMs，并且从不在源配置中存储凭证值。",
      allowedChannels: "允许的频道",
      approvedRepositories: "批准的存储库",
      autoSyncDescription: "后台轮询在到期时使用此来源",
      autoSync: "自动同步",
      automaticCredentialSelection: "自动凭证选择",
      batchDistillationDescription:
        "选择可排队的捕获并将它们一起交给 Brain 蒸馏工人。",
      batchDistillation: "间歇蒸馏",
      brainAppGrant: "Brain 应用补助金",
      brainHealth: "Brain 健康",
      captureInventoryFailedDetail: "检查源访问并重试。",
      captureInventoryFailedTitle: "捕获库存失败",
      catalogKeys: "目录键",
      connectProvider: "连接提供商",
      connectTheProvider: "连接提供商",
      connectionMetadataOnlyDetail:
        "Brain 可以重用此连接元数据，但此提供程序的源设置尚未添加到此模板中。",
      connectionMetadataOnly: "仅连接元数据",
      connectionProvidersDescription:
        "重用工作区集成、授予 Brain 访问权限或添加 Brain 本地源，而无需公开凭据值。",
      connectionProviders: "连接提供商",
      connectionReadiness: "连接准备情况",
      credentialPath: "凭证路径",
      credentialProvenance: "凭证来源",
      credentialRefs: "凭证参考",
      defaultTitle: {
        clips: "Clips 出口",
        generic: "通用转录 Webhook",
        github: "GitHub 产品存储库",
        granola: "Granola 团队笔记",
        manual: "手动导入",
        slack: "Slack 知识渠道",
      },
      description:
        "连接 Brain 可以学习的认可地点，然后根据需要进行同步和审查。",
      emptyDetail:
        "添加已批准的 Slack 通道、Granola Team-space 源、GitHub 存储库、Clips 导出、手动导入或签名的 Webhook。",
      emptyTitle: "连接 Brain 的第一个源",
      githubRepositoriesDescription:
        "Brain 使用工作区 GitHub 凭证从这些存储库导入有界问题和拉取请求上下文。",
      grantBrainAccess: "授予 Brain 访问权限",
      grantConnectionBeforePinning:
        "在固定此源之前，授予与 Dispatch 中的 Brain 的工作区连接。",
      grantInDispatch: "授予 Dispatch",
      healthReady: "来源、审阅队列和检索检查已准备好正常使用。",
      hideDetails: "隐藏详细信息",
      includeIssues: "包括问题",
      includePullRequests: "包括拉取请求",
      initialUpdatedAfter: "初始更新后",
      itemsPerRepo: "每个存储库的项目",
      lastSync: "上次同步",
      loadingProviderCatalog: "正在加载提供商目录...",
      messagesPerPage: "每页消息数",
      nextCheck: "下一步检查",
      noBrainSourcesYet: "还没有 Brain 来源",
      noCapturesDetail: "尝试其他状态、运行源同步或导入转录本。",
      noCapturesTitle: "没有与此视图匹配的捕获",
      noConnectionProviders: "共享目录中没有可用的 Brain 连接提供程序。",
      noCredentialKeysRequired: "无需凭证密钥",
      noCredentialRefs: "此连接上没有凭据参考",
      noCredentialRequired: "无需任何凭证",
      noSharedWorkspaceConnection: "尚未为此提供程序注册共享工作区连接。",
      noSyncYet: "尚未同步",
      pageSize: "页面尺寸",
      pickGrantedConnection:
        "选择授予的连接来固定此源，或保留自动以使用现有的凭据后备。",
      pollMinutes: "投票分钟",
      previewsDescription: "显示简短片段以供有意审查",
      provenance: {
        brainLocalCredential: "Brain-本地凭证",
        credentialSource: "凭证来源",
        credentialVault: "凭证保险库",
        explicitBrainGrant: "显式 Brain 授予",
      },
      providerConnection: "提供商连接",
      queueSelected: "已选择队列",
      rawContentHidden:
        "隐藏原始内容。仅当审阅需要上下文时才启用预览或打开源代码。",
      readiness: {
        accessGrantedConnectionInactive: "已授予访问权限，但连接尚未激活。",
        addReusableConnection: "在 Dispatch 中添加可重用的提供程序连接。",
        addSharedOrScopedCredential: "添加共享提供程序连接或范围 Brain 凭据。",
        brainCanUseSharedConnection: "Brain 可以使用共享工作区连接。",
        brainLocal: "Brain-本地",
        credentialNotLoaded: "凭证可用性尚未加载。",
        grantAppearsAfterConnection: "存在工作区提供程序连接后会出现授权。",
        grantExistingConnection: "授予现有提供商与 Brain 应用程序的连接。",
        grantNeedsAttention: "Brain 有资助，但需要注意提供者连接。",
        grantedRepair: "已获批准，修复",
        noCredentialKeyRequired: "该提供商不需要凭证密钥。",
        noGrant: "无资助",
        notNeeded: "不需要",
        providerNeedsAppAccess: "提供商已连接，但 Brain 需要应用程序访问权限。",
        providerNoCredential: "该提供程序可以在没有凭证密钥的情况下进行配置。",
        providerUnknown: "无法确定提供商的准备情况。",
        readyForSourceSetup: "准备好源设置。",
        readyThroughScopedRefs: "通过作用域 Brain 凭证参考做好准备。",
        readyThroughSharedConnection: "通过共享工作区连接做好准备。",
        reauthorizeProviderConnection: "重新授权或修复共享提供商连接。",
        registeredCredentialRefAvailable: "保险库中提供了已注册的凭证参考。",
        requiredCredentialRefsAvailable: "所需的凭证引用无需公开值即可获得。",
        reuseProviderConnection: "Brain 可以重用提供者连接而不显示值。",
        scopedCredentialRefsConfigured: "配置范围 Brain 凭证引用。",
        scopedCredentialsAvailable: "范围内的 Brain 凭证已经可用。",
        scopedLocalCredentialRefs: "Brain 仍然可以使用作用域本地凭证引用。",
        sourceSetupNotImplemented: "该提供程序未实现 Brain 源设置。",
        workspaceConnectionGrantable: "工作区连接存在并且可以授予 Brain。",
        workspaceNotLoaded: "工作区连接状态尚未加载。",
      },
      reviewRawCapturesDescription: "蒸馏前审查进口原料。",
      reviewRawCaptures: "查看原始捕获",
      reviewRequiredDescription: "在批准之前对提取的知识进行排队",
      reviewRequired: "需要审核",
      runDueSyncs: "运行到期同步",
      scopedCredentialsReady: "范围凭证已准备就绪",
      selectAll: "选择全部",
      sharedConnection: "共享连接",
      sharedWorkspaceConnectionReady: "共享工作区连接就绪",
      slackAccessRuleScopes:
        "Slack 访问应支持 auth.test、conversations.info/history 和 chat.getPermalink。试点私人频道时添加私人频道访问。",
      slackAccessRules: "Slack 访问规则",
      slackSetupAllowList:
        "当名称解析可接受时，将批准的频道 ID（例如 C0123456789）或频道名称（例如 #product）列入白名单。",
      slackSetupGuide: "Slack 设置指南",
      slackSetupPrivateChannels:
        "同步前邀请 Slack 应用程序加入私人频道。 DMs 和 MPIMs 被排除在外。",
      slackSetupScopes:
        "最小范围为 channels:read 和 channels:history. 为私有频道添加 groups:read 和 groups:history。",
      syncNow: "立即同步",
      tuneSource: "调音源",
      unselectAll: "取消选择全部",
      valuesHidden: "隐藏的价值观",
      waitingForWorker: "等待 Brain 蒸馏工作人员编写知识或发送此捕获以供审核。",
      webhookSourceKeyDescription:
        "新来源会收到一次性摄取令牌。现有来源保留其令牌，除非单独轮换。",
      webhookSourceKey: "Webhook 源密钥",
      workspaceConnections: "工作区连接",
      workspaceConnection: "工作区连接",
    },
  },
} satisfies Partial<Record<LocaleCode, DeepPartial<Messages>>>;

function deepMergeMessages<T extends Record<string, unknown>>(
  base: T,
  overrides: DeepPartial<T> | undefined,
): T {
  if (!overrides) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = deepMergeMessages(
        merged[key] as Record<string, unknown>,
        value as DeepPartial<Record<string, unknown>>,
      );
    } else {
      merged[key] = value;
    }
  }
  return merged as T;
}

export const messagesByLocale = Object.fromEntries(
  Object.entries(baseMessagesByLocale).map(([locale, messages]) => [
    locale,
    locale === "en-US"
      ? messages
      : deepMergeMessages(
          messages,
          exactEnglishDebtOverrides[locale as LocaleCode],
        ),
  ]),
) as Record<LocaleCode, Messages>;
