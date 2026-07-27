export interface ParityEvalScenario {
  id: string;
  title: string;
  capabilityIds: string[];
  gateEnv: string;
  defaultState: "skipped";
  requiresPrivateCredentials: false;
  prompt: string;
  successSignals: string[];
  expectedTools?: string[];
}

export const parityEvalScenarios: ParityEvalScenario[] = [
  {
    id: "database-bulk-row-reliability",
    title: "Bulk database row reliability",
    capabilityIds: ["database.rows"],
    gateEnv: "CONTENT_PARITY_EVALS",
    defaultState: "skipped",
    requiresPrivateCredentials: false,
    prompt:
      "Using fixture Content database rows only, duplicate multiple selected rows and delete multiple selected rows through the action surface. Report the ordered duplicated item/document IDs, deleted IDs, and the verified remaining row count. Do not loop single-row duplicate or document delete actions for the multi-row operations.",
    successSignals: [
      "Uses duplicate-database-items once for the multi-row duplicate.",
      "Uses delete-database-items once for the multi-row delete.",
      "Reports ordered duplicated item and document IDs.",
      "Reports deleted IDs and verified remaining row count.",
      "Does not use private provider credentials.",
    ],
    expectedTools: ["duplicate-database-items", "delete-database-items"],
  },
  {
    id: "database-source-scope",
    title: "Source-backed database scope",
    capabilityIds: [
      "database.lifecycle-and-trash",
      "source-sync.database-source-bindings",
    ],
    gateEnv: "CONTENT_PARITY_EVALS",
    defaultState: "skipped",
    requiresPrivateCredentials: false,
    prompt:
      "Using only fake or fixture source data, inspect or create a source-backed Content database, attach a safe source, map at least one unmapped field, change a view/filter/grouping, and report visible source scope plus whether any live external write occurred.",
    successSignals: [
      "Uses action-backed database/source operations instead of raw SQL.",
      "Reports source scope and provenance explicitly.",
      "Does not require private Builder credentials.",
      "States that no live external write occurred unless a gated write action was explicitly run.",
    ],
    expectedTools: [
      "create-content-database",
      "attach-content-database-source",
      "bind-content-database-source-field",
      "get-content-database-source",
    ],
  },
  {
    id: "document-search-edit",
    title: "Document search and edit through actions",
    capabilityIds: [
      "sidebar.document-tree-crud",
      "editor.document-body-and-title",
    ],
    gateEnv: "CONTENT_PARITY_EVALS",
    defaultState: "skipped",
    requiresPrivateCredentials: false,
    prompt:
      "Using fixture Content documents only, search for a document by a unique title or body phrase, inspect it, make one small title or body edit through an action-backed document operation, and report the changed title/body plus the action path used.",
    successSignals: [
      "Uses search/open/edit document actions instead of direct SQL.",
      "Reports which fixture document was changed.",
      "Shows the edited title or body text.",
      "Does not require private provider credentials.",
    ],
    expectedTools: ["search-documents", "get-document", "edit-document"],
  },
  {
    id: "local-file-source-truth",
    title: "Local file source-truth edit",
    capabilityIds: [
      "local-files.import-export-mounted-folder",
      "sharing.document-discoverability-and-export",
    ],
    gateEnv: "CONTENT_PARITY_EVALS",
    defaultState: "skipped",
    requiresPrivateCredentials: false,
    prompt:
      "Using only a temporary local-file Content fixture, find a local MDX document, edit a small phrase through the Content action surface, pull or export the document, and report that the mounted local file remains the source of truth. Do not invoke OS reveal.",
    successSignals: [
      "Uses local-file-aware document actions rather than raw filesystem writes.",
      "Reports the local file source-truth relationship.",
      "Does not call OS reveal as an agent tool.",
      "Does not require private provider credentials.",
    ],
    expectedTools: ["search-documents", "edit-document", "pull-document"],
  },
  {
    id: "builder-source-review-readonly",
    title: "Builder source review without live write",
    capabilityIds: ["source-sync.builder-cms-review-and-write-gates"],
    gateEnv: "CONTENT_PARITY_EVALS",
    defaultState: "skipped",
    requiresPrivateCredentials: false,
    prompt:
      "Using mocked Builder CMS fixture data only, prepare or review a Builder source change set, summarize the staged changes and write gates, and explicitly state that no live Builder write was executed.",
    successSignals: [
      "Uses Builder source review or validation actions.",
      "Reports staged changes or gate state.",
      "States that no live Builder write occurred.",
      "Does not require private Builder credentials.",
    ],
    expectedTools: [
      "prepare-builder-source-review",
      "review-content-database-source-change-set",
      "validate-builder-source-execution",
    ],
  },
];
