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
 *    filesystem scan of `apps/`).
 *    - `app.url` (absolute URL — externally hosted workspace app) wins if
 *      present.
 *    - Otherwise the `app.path` mounted under the workspace gateway is
 *      used. Path is normalized to a leading slash if missing
 *      (e.g. manifest entry `path: "my-forms"` → `/my-forms`), so an app
 *      whose mounted path differs from its id ends up at the right place
 *      instead of being silently rewritten to `/${appId}`.
 *    - Bare entry with no path / url falls back to `/${appId}`.
 * 2. First-party template registry. When no workspace manifest matches
 *    (framework dev with each template on its own port, hosted dispatch
 *    with no sibling apps), return the matching template's deploy URL —
 *    dev URL in development (e.g. http://localhost:8084 for forms), prod
 *    URL in production (e.g. https://forms.agent-native.com).
 *
 * Returns `null` if neither lookup matches, letting the route render its
 * "Page not found" pane.
 */
/**
 * Validate `app.url` is an absolute http(s) URL before we trust it as a
 * redirect target. A bare hostname (`"forms.example.com"`) or a
 * `javascript:` scheme would otherwise get returned verbatim from
 * `resolveCatchAllTarget` and produce a broken redirect (or a phishing
 * vector). Mirrors `normalizeWorkspaceAppUrl` in
 * `packages/core/src/deploy/workspace-deploy.ts` — but inlined to avoid
 * pulling the deploy CLI module into a runtime path.
 */
function validatedAbsoluteUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export function resolveCatchAllTarget(appId: string): string | null {
  const apps = loadWorkspaceAppsManifest();
  if (apps) {
    const app = apps.find((entry) => entry?.id === appId);
    if (app) {
      // Explicit externally-hosted URL wins. Workspaces that point at a
      // remote deploy (e.g. a sibling app on Netlify) set `url` and we
      // should bounce the user there rather than mounting a local path
      // that doesn't exist inside the gateway. Validate the URL first —
      // a bare hostname or non-http(s) scheme would produce a broken
      // redirect (and a `javascript:` value would be a phishing vector).
      const url = validatedAbsoluteUrl(app.url);
      if (url) {
        return url;
      }
      // Fall back to the mounted path. Normalize to leading slash so an
      // entry whose path differs from its id (e.g. `id: "forms"`,
      // `path: "my-forms"`) still lands on the correct gateway mount —
      // not on `/${appId}`, which would silently route to the wrong app.
      //
      // Reject scheme-relative paths. Three variants reach this point —
      // all of them get collapsed to a single leading slash so the
      // redirect stays on the gateway:
      //
      //   `//evil.example`   — network-path reference, browser treats as
      //                        absolute (https://evil.example).
      //   `/\evil.example`   — browsers normalize backslashes to forward
      //                        slashes during URL parsing, same result.
      //   `\/evil.example`   — same idea, leading-backslash variant.
      //
      // The manifest parser only checks `startsWith("/")` for the first
      // case, and even that allows `//evil…`. Defend in depth here by
      // collapsing any run of leading slashes-or-backslashes to one
      // forward slash. Same phishing vector that `validatedAbsoluteUrl`
      // closes for `app.url`.
      if (typeof app.path === "string" && app.path.trim()) {
        const normalized = app.path.trim().replace(/^[/\\]+/, "/");
        return normalized.startsWith("/") ? normalized : `/${normalized}`;
      }
      return `/${appId}`;
    }
  }
  const builtin = getBuiltinAgents("dispatch").find(
    (agent) => agent.id === appId,
  );
  return builtin?.url ?? null;
}
