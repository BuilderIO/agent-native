/**
 * Workspace-core discovery.
 *
 * An enterprise can sit many agent-native apps in one monorepo alongside a
 * private workspace shared package that can provide shared plugins, skills,
 * actions, and AGENTS.md. Apps inherit everything from
 * the shared package without writing any boilerplate — this is the
 * middle layer of the three-layer inheritance model:
 *
 *   1. app local           (highest priority — app's own server/plugins/, actions/, etc.)
 *   2. workspace core      (middle — packages/shared/ in the enterprise monorepo)
 *   3. @agent-native/core  (lowest — framework defaults)
 *
 * Discovery works by walking up from the build cwd looking for a package.json
 * that declares `"agent-native": { "workspaceCore": "@company/shared" }`.
 * The declared package is then resolved through the monorepo's node_modules,
 * and its directory structure is probed for the standard layout:
 *
 *   packages/shared/
 *     package.json
 *     src/server/index.ts  (exports <slot>Plugin for any slot it wants to provide)
 *     actions/             (shared agent-callable actions)
 *     .agents/skills/      (shared skills)
 *     AGENTS.md            (enterprise-wide agent instructions)
 *     src/client/         (optional shared React code)
 */
import path from "path";

let _fs: typeof import("fs") | undefined;
async function getFs(): Promise<typeof import("fs")> {
  if (!_fs) _fs = await import("node:fs");
  return _fs;
}

/** Mirrors DEFAULT_PLUGIN_REGISTRY's slot names. */
export type PluginSlot =
  | "agent-chat"
  | "auth"
  | "core-routes"
  | "integrations"
  | "org"
  | "resources"
  | "terminal";

export interface WorkspaceCoreExports {
  /** Absolute path of the monorepo root (the dir containing the root package.json). */
  workspaceRoot: string;
  /** Resolved package name — e.g. "@my-company/shared". */
  packageName: string;
  /** Absolute path to the workspace core package's root directory. */
  packageDir: string;
  /** Plugin slot → export name (if the workspace core declares an override for that slot). */
  plugins: Partial<Record<PluginSlot, string>>;
  /** Absolute path to the workspace core's actions/ directory, or null if it doesn't have one. */
  actionsDir: string | null;
  /** Absolute path to the workspace core's skills/ directory, or null. */
  skillsDir: string | null;
  /** Absolute path to the workspace core's AGENTS.md, or null. */
  agentsMdPath: string | null;
}

let cache: { cwd: string; result: WorkspaceCoreExports | null } | undefined;

/**
 * Walk up from startDir looking for a directory whose package.json has an
 * `agent-native.workspaceCore` field. Returns both the root dir and the
 * declared package name, or null if there's no workspace core in the tree.
 */
async function findWorkspaceRoot(
  startDir: string,
): Promise<{ workspaceRoot: string; packageName: string } | null> {
  const fs = await getFs();
  let dir = path.resolve(startDir);
  // Hard stop at filesystem root to avoid infinite loops.
  for (let i = 0; i < 20; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const declared = pkg?.["agent-native"]?.workspaceCore;
        if (typeof declared === "string" && declared.length > 0) {
          return { workspaceRoot: dir, packageName: declared };
        }
      } catch {
        // Malformed package.json — keep walking up.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve a workspace package name to its directory inside the monorepo.
 * Tries in order:
 *   1. <workspaceRoot>/node_modules/<packageName>/package.json (pnpm symlink)
 *   2. For each dir under <workspaceRoot>/packages/*, read its package.json
 *      and match on `name`.
 *   3. For each dir under <workspaceRoot>/packages/*\/*, same match.
 *
 * The pnpm symlink approach is fastest when deps are installed; the direct
 * scan is a fallback for pre-install scenarios (e.g. running tests before
 * the first `pnpm install` in a scaffolded workspace).
 */
async function resolvePackageDir(
  workspaceRoot: string,
  packageName: string,
): Promise<string | null> {
  const fs = await getFs();

  // 1) pnpm / npm install symlink
  const nmCandidate = path.join(workspaceRoot, "node_modules", packageName);
  if (fs.existsSync(path.join(nmCandidate, "package.json"))) {
    return nmCandidate;
  }

  // 2) scan packages/*
  const packagesDir = path.join(workspaceRoot, "packages");
  const candidates: string[] = [];
  if (fs.existsSync(packagesDir)) {
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      candidates.push(path.join(packagesDir, entry.name));
    }
  }

  // 3) scan packages/*/*  (for scoped layouts like packages/@company/shared)
  if (fs.existsSync(packagesDir)) {
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("@")) continue;
      const scopeDir = path.join(packagesDir, entry.name);
      for (const sub of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        if (!sub.isDirectory()) continue;
        candidates.push(path.join(scopeDir, sub.name));
      }
    }
  }

  for (const candidate of candidates) {
    const pkgPath = path.join(candidate, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg?.name === packageName) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Probe a workspace core package directory to discover which plugin slots it
 * exports. We read its package.json `exports` field + peek at
 * `src/server/index.ts` (or dist/server/index.js) looking for exports of the
 * form `<slot>Plugin` — the same convention the core server index uses.
 */
async function discoverPluginExports(
  packageDir: string,
): Promise<Partial<Record<PluginSlot, string>>> {
  const fs = await getFs();
  const out: Partial<Record<PluginSlot, string>> = {};

  const candidates = [
    path.join(packageDir, "src", "server", "index.ts"),
    path.join(packageDir, "dist", "server", "index.js"),
    path.join(packageDir, "src", "server.ts"),
    path.join(packageDir, "dist", "server.js"),
  ];

  let source = "";
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        source = fs.readFileSync(c, "utf-8");
        break;
      } catch {
        // keep trying
      }
    }
  }
  if (!source) return out;

  // Map slot name → export name we're looking for. "agent-chat" has a hyphen,
  // so we probe both the camelCase and dash-free variants.
  const slotExportNames: Record<PluginSlot, string[]> = {
    "agent-chat": ["agentChatPlugin"],
    auth: ["authPlugin"],
    "core-routes": ["coreRoutesPlugin"],
    integrations: ["integrationsPlugin"],
    org: ["orgPlugin"],
    resources: ["resourcesPlugin"],
    terminal: ["terminalPlugin"],
  };

  for (const [slot, names] of Object.entries(slotExportNames) as [
    PluginSlot,
    string[],
  ][]) {
    for (const name of names) {
      // Match any of:
      //   export const <name>
      //   export async function <name>
      //   export function <name>
      //   export { <name>
      //   export { foo as <name>
      const patterns = [
        new RegExp(`export\\s+const\\s+${name}\\b`, "m"),
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`, "m"),
        new RegExp(`export\\s*\\{[^}]*?\\b${name}\\b[^}]*?\\}`, "m"),
      ];
      if (patterns.some((re) => re.test(source))) {
        out[slot] = name;
        break;
      }
    }
  }
  return out;
}

/**
 * Main entry point. Discovers the workspace core for the given cwd (defaults
 * to process.cwd()) and returns its layout. Returns null if there's no
 * workspace core in the ancestor chain. Result is cached per-cwd so repeated
 * calls during a single build are cheap.
 */
export async function getWorkspaceCoreExports(
  cwd: string = process.cwd(),
): Promise<WorkspaceCoreExports | null> {
  if (cache && cache.cwd === cwd) return cache.result;

  const fs = await getFs();

  const rootInfo = await findWorkspaceRoot(cwd);
  if (!rootInfo) {
    cache = { cwd, result: null };
    return null;
  }

  const packageDir = await resolvePackageDir(
    rootInfo.workspaceRoot,
    rootInfo.packageName,
  );
  if (!packageDir) {
    cache = { cwd, result: null };
    return null;
  }

  const plugins = await discoverPluginExports(packageDir);

  const actionsDir = path.join(packageDir, "actions");
  const skillsDir =
    [
      path.join(packageDir, ".agents", "skills"),
      path.join(packageDir, "skills"),
    ].find((candidate) => fs.existsSync(candidate)) ?? null;
  const agentsMdPath = path.join(packageDir, "AGENTS.md");

  const result: WorkspaceCoreExports = {
    workspaceRoot: rootInfo.workspaceRoot,
    packageName: rootInfo.packageName,
    packageDir,
    plugins,
    actionsDir: fs.existsSync(actionsDir) ? actionsDir : null,
    skillsDir,
    agentsMdPath: fs.existsSync(agentsMdPath) ? agentsMdPath : null,
  };

  cache = { cwd, result };
  return result;
}

/** Reset the internal cache. Exposed only for tests. */
export function _resetWorkspaceCoreCache(): void {
  cache = undefined;
}
