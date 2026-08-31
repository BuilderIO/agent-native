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

export function resolveAppHomePath(app: AppConfig["app"]): string {
  const configured = app.homePath?.trim();
  if (configured) return configured;
  return isFirstPartyApp(app) ? "/home" : "/";
}
