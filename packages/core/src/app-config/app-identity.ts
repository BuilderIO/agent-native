/**
 * Fill this app's branding from the first-party template table.
 *
 * Runs after the schema parses, over already-resolved values — it is a pure
 * lookup, not a layer. Reading package.json from disk here is what the earlier
 * version did, and it put a synchronous `fs.readFileSync` inside `getAppConfig()`,
 * which every request path calls. The repo already treats a package.json read as
 * a development-only fallback (`server/cookie-namespace.ts` uses one solely in
 * its non-production branch), so the input here is the declared `packageName`
 * field and its `npm_package_name` alias.
 *
 * Only fills what is still unset, so an explicit `APP_NAME` or a
 * `defineAppConfig()` value always wins.
 *
 * `slug` selects the per-app transactional email sender on agent-native.com, so
 * it is only ever a name the template table already contains — an arbitrary
 * package name cannot mint a mailbox there.
 */

import { getTemplate, TEMPLATES } from "../cli/templates-meta.js";
import { normalizeWorkspaceAppHomePath } from "../shared/workspace-app-audience.js";
import type { AppConfig } from "./schema.js";

function titlecase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function deriveAppIdentity(app: AppConfig["app"]): AppConfig["app"] {
  if (app.name && app.slug && app.description) return app;
  const template = app.packageName
    ? TEMPLATES.find((t) => t.name === app.packageName)
    : undefined;
  if (!template) return app;
  return {
    ...app,
    name: app.name ?? (template.label || titlecase(template.name)),
    slug: app.slug ?? template.name,
    description: app.description ?? template.hint ?? undefined,
  };
}

/**
 * A custom app can be generated from a first-party template, so the package
 * name alone is not enough. When scaffolding records its source template,
 * that server-side provenance must agree with the derived first-party identity.
 */
export function isFirstPartyApp(app: AppConfig["app"]): boolean {
  const template = app.slug ? getTemplate(app.slug) : undefined;
  if (!template || app.packageName !== template.name) return false;
  if (!app.sourceTemplate?.trim()) return true;
  return (
    getTemplate(app.sourceTemplate.trim().toLowerCase())?.name === template.name
  );
}

/**
 * The home path the workspace deploy recorded for this app in its manifest.
 *
 * A workspace deploy infers `/` for an app that only has a root route (see
 * `inferWorkspaceAppRootHomePath`), and the launcher links there. The app's own
 * runtime cannot repeat that inference — its routes directory does not exist
 * inside a serverless bundle — so it reads the same manifest entry instead.
 * Without this, the launcher opens `/` while the app's root handoff bounces a
 * signed-in visitor to a `/home` route the app never defined.
 */
let cachedManifestHomePaths:
  | { appsJson: string; homePaths: Map<string, string> }
  | undefined;

function workspaceManifestHomePath(
  workspaceId: string | undefined,
  appsJson: string | undefined,
): string | undefined {
  if (!workspaceId || !appsJson?.trim()) return undefined;
  if (cachedManifestHomePaths?.appsJson !== appsJson) {
    const homePaths = new Map<string, string>();
    try {
      const parsed: unknown = JSON.parse(appsJson);
      const entries = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && "apps" in parsed
          ? (parsed as { apps?: unknown }).apps
          : null;
      if (Array.isArray(entries)) {
        // Match the launcher (`parseWorkspaceAppLinks`): trimmed ids, and the
        // first entry wins a duplicate id, so both always agree on one home.
        for (const entry of entries) {
          if (!entry || typeof entry !== "object") continue;
          const record = entry as Record<string, unknown>;
          const id = typeof record.id === "string" ? record.id.trim() : "";
          if (!id || homePaths.has(id)) continue;
          homePaths.set(id, normalizeWorkspaceAppHomePath(record.homePath));
        }
      }
    } catch {
      // coercion-ok: a malformed manifest leaves the framework default in place.
    }
    cachedManifestHomePaths = { appsJson, homePaths };
  }
  return cachedManifestHomePaths.homePaths.get(workspaceId.trim());
}

export function resolveAppHomePath(
  app: AppConfig["app"],
  workspace?: AppConfig["workspace"],
): string {
  const configured = app.homePath?.trim();
  if (configured) return configured;
  return (
    workspaceManifestHomePath(app.workspaceId, workspace?.appsJson) ?? "/home"
  );
}
