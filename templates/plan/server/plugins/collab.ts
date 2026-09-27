import { createCollabPlugin } from "@agent-native/core/server";

export default createCollabPlugin({
  autoSeed: false,
  access: {
    mode: "resource",
    resourceType: "plan",
    resolveResourceId: (docId) => resolvePlanIdFromCollabDocId(docId),
  },
});

export function resolvePlanIdFromCollabDocId(docId: string): string | null {
  if (!docId.startsWith("plan:")) return null;
  const rest = docId.slice("plan:".length);
  const sep = rest.indexOf(":");
  const planId = sep === -1 ? rest : rest.slice(0, sep);
  return planId.trim() ? planId : null;
}
