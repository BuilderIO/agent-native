import {
  getBuiltinAgents,
  loadWorkspaceAppsManifest,
} from "@agent-native/core/server/agent-discovery";

/**
 * Resolve where `/dispatch/<appId>` should bounce to when it doesn't match
 * an explicit dispatch route. Used by the `$appId` catch-all route loader.
 *
 * Resolution order:
 *
 * 1. Workspace apps manifest (env, .agent-native/workspace-apps.json, or a
 *    filesystem scan of `apps/`). When `<appId>` is a sibling workspace
 *    app, return its mounted path so the user lands on the real app
 *    inside the workspace gateway instead of a 404 inside dispatch.
 * 2. First-party template registry. When no workspace manifest matches
 *    (framework dev with each template on its own port, hosted dispatch
 *    with no sibling apps), return the matching template's deploy URL —
 *    dev URL in development (e.g. http://localhost:8084 for forms), prod
 *    URL in production (e.g. https://forms.agent-native.com).
 *
 * Returns `null` if neither lookup matches, letting the route render its
 * "Page not found" pane.
 */
export function resolveCatchAllTarget(appId: string): string | null {
  const apps = loadWorkspaceAppsManifest();
  if (apps) {
    const app = apps.find((entry) => entry?.id === appId);
    if (app) {
      return app.path && app.path.startsWith("/") ? app.path : `/${appId}`;
    }
  }
  const builtin = getBuiltinAgents("dispatch").find(
    (agent) => agent.id === appId,
  );
  return builtin?.url ?? null;
}
