// The embedding protocol now lives in @agent-native/core so that standalone
// scaffolds — which depend on the published core but not on this workspace-only
// package — can import the embed surface. This package stays as a thin
// re-export for any consumer that still imports @agent-native/embedding.
export * from "@agent-native/core/embedding/protocol";
