import path from "path";

let _fs: typeof import("fs") | undefined;
async function getFs(): Promise<typeof import("fs")> {
  if (!_fs) _fs = await import("node:fs");
  return _fs;
}

export type PluginSlot =
  | "agent-chat"
  | "auth"
  | "context-xray"
  | "core-routes"
  | "integrations"
  | "org"
  | "resources"
  | "sentry"
  | "terminal";

export interface WorkspaceCoreExports {
  workspaceRoot: string;
  packageName: string;
  packageDir: string;
  plugins: Partial<Record<PluginSlot, string>>;
  actionsDir: string | null;
  skillsDir: string | null;
  agentsMdPath: string | null;
}

let cache: { cwd: string; result: WorkspaceCoreExports | null } | undefined;

async function findWorkspaceRoot(
  startDir: string,
): Promise<{ workspaceRoot: string; packageName: string } | null> {
  const fs = await getFs();
  let dir = path.resolve(startDir);
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

async function resolvePackageDir(
  workspaceRoot: string,
  packageName: string,
): Promise<string | null> {
  const fs = await getFs();

  const nmCandidate = path.join(workspaceRoot, "node_modules", packageName);
  if (fs.existsSync(path.join(nmCandidate, "package.json"))) {
    return nmCandidate;
  }

  const packagesDir = path.join(workspaceRoot, "packages");
  const candidates: string[] = [];
  if (fs.existsSync(packagesDir)) {
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      candidates.push(path.join(packagesDir, entry.name));
    }
  }

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

  const slotExportNames: Record<PluginSlot, string[]> = {
    "agent-chat": ["agentChatPlugin"],
    auth: ["authPlugin"],
    "context-xray": ["contextXrayPlugin"],
    "core-routes": ["coreRoutesPlugin"],
    integrations: ["integrationsPlugin"],
    org: ["orgPlugin"],
    resources: ["resourcesPlugin"],
    sentry: ["sentryPlugin"],
    terminal: ["terminalPlugin"],
  };

  for (const [slot, names] of Object.entries(slotExportNames) as [
    PluginSlot,
    string[],
  ][]) {
    for (const name of names) {
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

export function _resetWorkspaceCoreCache(): void {
  cache = undefined;
}
