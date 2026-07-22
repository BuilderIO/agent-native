/**
 * TEMPLATE STANDARD manifest — Phase 1.
 *
 * Single source of truth for what "the same" is supposed to mean across the
 * 16 first-party templates under `templates/*`. This module only describes
 * the standard; `checks.ts` evaluates it (read-only) and `sync.ts` can write
 * the byte-synced surfaces when explicitly run in write mode. Nothing here
 * ever edits a template as a side effect of `--check`.
 *
 * Three surface classes (see checks.ts for the corresponding check code):
 *
 *   a. BYTE-SYNCED   — file content must match a canonical copy exactly.
 *      Skills sync is NOT reimplemented here: `scripts/sync-workspace-core-skills.ts`
 *      (wired as `guard:workspace-skills`, already in scripts/run-guards.ts)
 *      remains the sole authority for `.agents/skills/*`. Re-running it from
 *      inside this guard would double the cost of an already-parallel CI
 *      check for no benefit, so this manifest only documents the delegation.
 *
 *   b. STRUCTURALLY CHECKED — a file must exist and satisfy a shape (an
 *      import, a field, a script pattern) without needing byte-identical
 *      content.
 *
 *   c. CORE-ROUTES — investigated, not enforced. See CORE_ROUTES_FINDING:
 *      `server/plugins/core-routes.ts` is optional. Templates that omit it
 *      get `defaultCoreRoutesPlugin` auto-mounted by the framework
 *      (packages/core/src/server/framework-request-handler.ts calls
 *      `getMissingDefaultPlugins` from packages/core/src/deploy/route-discovery.ts,
 *      which maps the `core-routes` stem to `defaultCoreRoutesPlugin`). Every
 *      template that DOES provide the file does so to pass template-specific
 *      options to `createCoreRoutesPlugin` (`resolveOpenPath` deep-link
 *      overrides, `envKeys`, `anonymousOwner`, `mcpConnectServerName`,
 *      `sseRoute`, `allowUnauthenticatedOpen`) — its absence is a valid
 *      choice, not missing plumbing, so no rule is encoded for it.
 *
 * NEVER-STANDARDIZED (explicit excludes, no checks exist or should exist):
 *   actions/, schema, app UI (app/), app-specific skills content beyond the
 *   shared set `sync-workspace-core-skills.ts` already governs,
 *   agent-native.json / app-skill.json content, changelog/ entries.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const REPO_ROOT = join(import.meta.dirname, "..", "..");
export const TEMPLATES_DIR = join(REPO_ROOT, "templates");
export const MODULE_DIR = import.meta.dirname;

export const CORE_ROUTES_FINDING = `core-routes truth (investigated, not enforced): server/plugins/core-routes.ts is optional. \
Templates without it (e.g. assets, chat, clips, tasks) get "defaultCoreRoutesPlugin" auto-mounted by \
packages/core/src/server/framework-request-handler.ts via getMissingDefaultPlugins() in \
packages/core/src/deploy/route-discovery.ts. Templates with the file (analytics, brain, calendar, content, \
crm, design, dispatch, forms, macros, mail, plan, slides) use it to pass custom resolveOpenPath/envKeys/\
anonymousOwner/mcpConnectServerName/sseRoute/allowUnauthenticatedOpen options to createCoreRoutesPlugin. \
No structural rule is encoded for this surface.`;

export const NEVER_STANDARDIZED = [
  "actions/ (app-specific operations)",
  "drizzle schema (app-specific data model)",
  "app/ UI (app-specific screens/components)",
  "app-specific skills beyond the shared set sync-workspace-core-skills.ts governs",
  "agent-native.json / app-skill.json content",
  "changelog/ entries",
] as const;

/** Directory names under templates/ that ship a package.json (real, buildable templates). */
export function listTemplates(): string[] {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.isDirectory()) return false;
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        return false;
      }
      return existsSync(join(TEMPLATES_DIR, entry.name, "package.json"));
    })
    .map((entry) => entry.name)
    .sort();
}

export function templateDir(template: string): string {
  return join(TEMPLATES_DIR, template);
}

export function templatePath(template: string, ...segments: string[]): string {
  return join(templateDir(template), ...segments);
}

// --- (a) BYTE-SYNCED surfaces ---------------------------------------------

export const CANONICAL_LEARNINGS_DEFAULTS = join(
  MODULE_DIR,
  "assets",
  "learnings.defaults.md",
);
export const CANONICAL_GITIGNORE_SOURCE = join(MODULE_DIR, "assets", "_gitignore");

export const BYTE_SYNCED_FILES = [
  {
    rule: "learnings-defaults",
    relPath: "learnings.defaults.md",
    canonicalPath: CANONICAL_LEARNINGS_DEFAULTS,
    description:
      "Starter learnings.defaults.md scaffold (canonical source: templates/mail, " +
      "byte-identical in 10 of 12 templates that ship it today).",
  },
  {
    rule: "gitignore-source",
    relPath: "_gitignore",
    canonicalPath: CANONICAL_GITIGNORE_SOURCE,
    description:
      "_gitignore is the checked-in source packages/core/src/cli/create.ts renames to " +
      ".gitignore when scaffolding a new app (canonical source: templates/clips).",
  },
] as const;

// --- (b) STRUCTURALLY CHECKED surfaces ------------------------------------

export const REQUIRED_PACKAGE_SCRIPTS: Record<string, RegExp> = {
  dev: /(?:^|\s)agent-native dev(?:\s|$)/,
  build: /(?:^|\s)agent-native build(?:\s|$)/,
  typecheck: /(?:^|\s)agent-native typecheck(?:\s|$)/,
  test: /(?:^|\s)vitest(?:\s|$)/,
};

export const TSCONFIG_EXTENDS = "@agent-native/core/tsconfig.base.json";

export const AUTH_MIDDLEWARE_REL = join("server", "middleware", "auth.ts");
export const AUTH_MIDDLEWARE_REQUIRED_IMPORT = "runAuthGuard";

export const SSR_ROUTE_REL = join("server", "routes", "[...page].get.ts");
export const SSR_ROUTE_REQUIRED_IMPORT = "createH3SSRHandler";

/** Real unrendered scaffold placeholders, e.g. {{APP_NAME}}. Deliberately excludes
 * JSX inline-style double braces like `style={{ ... }}`. */
export const TEMPLATE_PLACEHOLDER_PATTERN = /\{\{[A-Z][A-Z0-9_]*\}\}/;

export const VITE_CONFIG_REL = "vite.config.ts";
export const VITE_PORT_PATTERN = /port:\s*(\d+)/;

// --- Dependency version bands (WARN-level only; never fails the guard) ---

export const AGENT_NATIVE_WORKSPACE_RANGE = "workspace:*";
export const VERSION_BAND_PACKAGES = [
  "react-router",
  "drizzle-orm",
  "zod",
] as const;

/**
 * Reads `name` -> `devPort` out of packages/shared-app-config/templates.ts by
 * text-scanning the source (same convention as scripts/dev-lazy.ts and
 * scripts/guard-template-list.mjs) instead of importing the package, since
 * that requires a build step this guard shouldn't depend on.
 */
export function readDevPorts(): Record<string, number> {
  const configPath = join(
    REPO_ROOT,
    "packages",
    "shared-app-config",
    "templates.ts",
  );
  const src = readFileSync(configPath, "utf-8");
  const ports: Record<string, number> = {};
  const blocks = src.split(/^\s*\{\s*$/m).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/^\s*\},?\s*$/m)[0] ?? "";
    const name = block.match(/\bname:\s*"([^"]+)"/)?.[1];
    const port = block.match(/\bdevPort:\s*(\d+)/)?.[1];
    if (name && port) ports[name] = Number(port);
  }
  return ports;
}
