// Mail owns Gmail and Calendar through first-party actions; exposing the
// overlapping Google Workspace MCP setup creates a second connection path.
export const MAIL_NATIVE_MCP_PRESET_EXCLUSIONS = ["google-workspace"] as const;
