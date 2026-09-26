import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const REPO_ROOT = join(import.meta.dirname, "..", "..");
export const TEMPLATES_DIR = join(REPO_ROOT, "templates");
export const MODULE_DIR = import.meta.dirname;

export const CORE_ROUTES_FINDING = `core-routes truth (investigated, not enforced): server/plugins/core-routes.ts is optional. \
Templates without it (e.g. assets, chat, clips, tasks) get "defaultCoreRoutesPlugin" auto-mounted by \
packages/core/src/server/framework-request-handler.ts via getMissingDefaultPlugins() in \
packages/core/src/deploy/route-discovery.ts. Templates with the file (analytics, brain, calendar, content, \
crm, design, dispatch, forms, mail, plan, slides) use it to pass custom resolveOpenPath/envKeys/\
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

export function isRetiredCompatibilityTemplate(template: string): boolean {
  const packagePath = join(TEMPLATES_DIR, template, "package.json");
  if (!existsSync(packagePath)) return false;
  const packageJson = JSON.parse(readFileSync(packagePath, "utf-8")) as {
    agentNativeRetiredCompatibility?: unknown;
  };
  return packageJson.agentNativeRetiredCompatibility === true;
}

export function listTemplates(): string[] {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.isDirectory()) return false;
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        return false;
      }
      return (
        existsSync(join(TEMPLATES_DIR, entry.name, "package.json")) &&
        !isRetiredCompatibilityTemplate(entry.name)
      );
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


export const CANONICAL_LEARNINGS_DEFAULTS = join(
  MODULE_DIR,
  "assets",
  "learnings.defaults.md",
);
export const CANONICAL_GITIGNORE_SOURCE = join(
  MODULE_DIR,
  "assets",
  "_gitignore",
);

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

export const TEMPLATE_PLACEHOLDER_PATTERN = /\{\{[A-Z][A-Z0-9_]*\}\}/;

export const VITE_CONFIG_REL = "vite.config.ts";
export const VITE_PORT_PATTERN = /port:\s*(\d+)/;


export const AGENT_NATIVE_WORKSPACE_RANGE = "workspace:*";
export const VERSION_BAND_PACKAGES = [
  "react-router",
  "drizzle-orm",
  "zod",
] as const;

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
