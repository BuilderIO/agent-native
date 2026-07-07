// Paths accessible without a session — used by the auth middleware guard.
export const PUBLIC_PLAN_ACTION_PATHS = [
  // Read / review — public plan links, export receipts
  "/_agent-native/actions/get-visual-plan",
  "/_agent-native/actions/get-local-plan-folder",
  "/_agent-native/actions/export-visual-plan",
  "/_agent-native/actions/get-plan-feedback",
  "/_agent-native/actions/get-plan-access-status",
  "/_agent-native/actions/get-plan-blocks",
  "/_agent-native/actions/validate-local-plan-source",
  "/_agent-native/actions/read-visual-plan-source",
  // Write — comments/patches from public reviewers, local-mode authoring
  "/_agent-native/actions/update-visual-plan",
  "/_agent-native/actions/patch-visual-plan-source",
  "/_agent-native/actions/publish-visual-plan",
  "/_agent-native/actions/report-visual-plan",
] as const;
