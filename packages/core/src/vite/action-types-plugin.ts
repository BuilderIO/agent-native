/**
 * Vite plugin that generates end-to-end type-safe action types AND a runtime
 * registry of static imports so bundlers (Nitro on Netlify/Vercel/AWS-Lambda,
 * Rolldown, etc.) include every action file in the server bundle.
 *
 * Watches the `actions/` directory and emits:
 *   - `.generated/action-types.d.ts` — type-only module that augments the
 *     `ActionRegistry` interface in `@agent-native/core/client`, giving
 *     `useActionQuery`/`useActionMutation` full inference.
 *   - `.generated/actions-registry.ts` — runtime registry keyed by action
 *     name, with static `import` statements for every action. Templates
 *     import this file from their `server/plugins/agent-chat.ts` so Nitro
 *     bundles the actions into the server function; without it the runtime
 *     `fs.readdirSync` inside `autoDiscoverActions` finds nothing in a
 *     bundled serverless function and every action route 404s.
 */
import path from "path";
import fs from "fs";
import type { Plugin } from "vite";

/** Files to skip during discovery (matches action-discovery.ts). */
const SKIP_FILES = new Set([
  "helpers",
  "run",
  "db-connect",
  "db-status",
  "registry",
]);

/**
 * Framework-level sharing actions that must ALWAYS be in the generated
 * registry, even when the template's `actions/` directory doesn't contain
 * them. Each entry maps the action name to the bare-specifier import path so
 * bundlers see a static import and pull the module into the server bundle.
 *
 * Order matters: templates can override by defining a same-named file in
 * their own `actions/` directory — the merge below is skip-existing.
 */
const CORE_SHARING_ACTIONS: Array<{ name: string; specifier: string }> = [
  {
    name: "share-resource",
    specifier: "@agent-native/core/sharing/actions/share-resource",
  },
  {
    name: "unshare-resource",
    specifier: "@agent-native/core/sharing/actions/unshare-resource",
  },
  {
    name: "list-resource-shares",
    specifier: "@agent-native/core/sharing/actions/list-resource-shares",
  },
  {
    name: "set-resource-visibility",
    specifier: "@agent-native/core/sharing/actions/set-resource-visibility",
  },
];

function scanActionFiles(actionsDir: string): string[] {
  let files: string[];
  try {
    files = fs.readdirSync(actionsDir);
  } catch {
    return [];
  }
  return files.filter((f) => {
    if (!f.endsWith(".ts") && !f.endsWith(".js")) return false;
    const name = f.replace(/\.(ts|js)$/, "");
    if (name.startsWith("_")) return false;
    if (SKIP_FILES.has(name)) return false;
    // Only include files that actually call defineAction or explicitly
    // re-export a package action. CLI scripts or example templates that live
    // in actions/ but don't export an action would otherwise drag their own
    // (often app/, browser-only, or fs-only) imports into the serverless
    // bundle and fail to resolve.
    try {
      const content = fs.readFileSync(path.join(actionsDir, f), "utf-8");
      const reexportsDefaultAction =
        /export\s*\{\s*default\s*\}\s*from\s*["'][^"']+["']/.test(content);
      if (!content.includes("defineAction") && !reexportsDefaultAction) {
        return false;
      }
    } catch {
      return false;
    }
    return true;
  });
}

function toIdent(name: string): string {
  return "a_" + name.replace(/[^a-zA-Z0-9_]/g, "_");
}

function writeIfChanged(outFile: string, content: string): void {
  const existing = fs.existsSync(outFile)
    ? fs.readFileSync(outFile, "utf-8")
    : "";
  if (existing !== content) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, content);
  }
}

function findWorkspaceCoreActionsDir(projectRoot: string): string | null {
  let dir = path.resolve(projectRoot);
  let workspaceRoot: string | null = null;
  let packageName: string | null = null;

  for (let i = 0; i < 20; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const declared = pkg?.["agent-native"]?.workspaceCore;
        if (typeof declared === "string" && declared.length > 0) {
          workspaceRoot = dir;
          packageName = declared;
          break;
        }
      } catch {
        // Keep walking on malformed package.json.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (!workspaceRoot || !packageName) return null;

  const nm = path.join(workspaceRoot, "node_modules", packageName);
  if (fs.existsSync(path.join(nm, "package.json"))) {
    const actionsDir = path.join(fs.realpathSync(nm), "actions");
    return fs.existsSync(actionsDir) ? actionsDir : null;
  }

  const packagesDir = path.join(workspaceRoot, "packages");
  const candidates: string[] = [];
  if (fs.existsSync(packagesDir)) {
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      candidates.push(path.join(packagesDir, entry.name));
      if (entry.name.startsWith("@")) {
        const scopeDir = path.join(packagesDir, entry.name);
        for (const sub of fs.readdirSync(scopeDir, { withFileTypes: true })) {
          if (sub.isDirectory()) candidates.push(path.join(scopeDir, sub.name));
        }
      }
    }
  }

  for (const candidate of candidates) {
    const pkgPath = path.join(candidate, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg?.name === packageName) {
        const actionsDir = path.join(candidate, "actions");
        return fs.existsSync(actionsDir) ? actionsDir : null;
      }
    } catch {
      // Ignore malformed package.json.
    }
  }

  return null;
}

/**
 * Scan the actions directory and emit the types + runtime registry files.
 * Only writes files whose content has changed, to avoid triggering rebuilds.
 */
function generateActionArtifacts(
  actionsDir: string,
  projectRoot: string,
): void {
  const outDir = path.resolve(projectRoot, ".generated");
  const relActionsDir = path.relative(outDir, actionsDir).replace(/\\/g, "/");

  const actionFiles = scanActionFiles(actionsDir);
  const workspaceActionsDir = findWorkspaceCoreActionsDir(projectRoot);
  const workspaceActionFiles = workspaceActionsDir
    ? scanActionFiles(workspaceActionsDir)
    : [];

  // Pre-compute template action names — used for skip-existing logic in both
  // the type declarations and the runtime registry below.
  const templateActionNames = new Set<string>(
    actionFiles.map((f) => f.replace(/\.(ts|js)$/, "")),
  );
  const registeredActionNames = new Set(templateActionNames);

  const actionSources = actionFiles.map((f) => {
    const name = f.replace(/\.(ts|js)$/, "");
    return {
      name,
      relPath: `${relActionsDir}/${name}`,
    };
  });

  if (workspaceActionsDir) {
    for (const f of workspaceActionFiles) {
      const name = f.replace(/\.(ts|js)$/, "");
      if (registeredActionNames.has(name)) continue;
      const relPath = path
        .relative(outDir, path.join(workspaceActionsDir, name))
        .replace(/\\/g, "/");
      actionSources.push({ name, relPath });
      registeredActionNames.add(name);
    }
  }

  // --- types file ---------------------------------------------------------
  const typeEntries = actionSources.map(({ name, relPath }) => {
    return `    "${name}": ActionEntry<typeof import("${relPath}")>;`;
  });

  // Also declare types for framework-level sharing actions so callers don't
  // need `as any` casts (same skip-existing logic as the runtime registry).
  for (const entry of CORE_SHARING_ACTIONS) {
    if (registeredActionNames.has(entry.name)) continue;
    typeEntries.push(
      `    "${entry.name}": ActionEntry<typeof import("${entry.specifier}")>;`,
    );
    registeredActionNames.add(entry.name);
  }

  const typesContent = `// AUTO-GENERATED by @agent-native/core — do not edit manually.
// Regenerated when files in actions/ change.
// This file augments the ActionRegistry interface so that useActionQuery and
// useActionMutation infer the correct types from your action definitions.

/** Extract the return type and parameter type from a defineAction module. */
type ActionEntry<T> = T extends { default: { run: (...args: infer A) => infer R } }
  ? {
      result: Awaited<R>;
      params: A extends [infer P, ...any[]] ? P : Record<string, any>;
    }
  : { result: any; params: Record<string, any> };

declare module "@agent-native/core/client" {
  interface ActionRegistry {
${typeEntries.join("\n")}
  }
}

export {};
`;

  writeIfChanged(path.join(outDir, "action-types.d.ts"), typesContent);

  // --- runtime registry ---------------------------------------------------
  // Static imports of each action's default export so bundlers see every
  // action and include it in the server bundle. Normalization matches
  // `loadActionsIntoRegistry` in server/action-discovery.ts.
  const imports: string[] = [];
  const entries: string[] = [];
  const runtimeActionNames = new Set<string>();
  for (const { name, relPath } of actionSources) {
    const ident = toIdent(name);
    imports.push(`import * as ${ident} from "${relPath}";`);
    entries.push(`  ${JSON.stringify(name)}: ${ident},`);
    runtimeActionNames.add(name);
  }
  // Framework-level sharing actions — only added when the template hasn't
  // provided a same-named file (skip-existing merge). Static imports ensure
  // bundlers pull these modules into the server bundle so
  // `/_agent-native/actions/share-resource` (etc.) always resolve.
  for (const entry of CORE_SHARING_ACTIONS) {
    if (runtimeActionNames.has(entry.name)) continue;
    const ident = toIdent(entry.name);
    imports.push(`import * as ${ident} from "${entry.specifier}";`);
    entries.push(`  ${JSON.stringify(entry.name)}: ${ident},`);
    runtimeActionNames.add(entry.name);
  }

  const registryContent = `// AUTO-GENERATED by @agent-native/core — do not edit manually.
// Static-import registry of every action file. Bundlers (Nitro, Rolldown)
// see these imports and include the action modules in the server bundle.
// The agent-chat plugin normalizes each module into an ActionEntry shape.
${imports.join("\n")}

const modules: Record<string, unknown> = {
${entries.join("\n")}
};

export default modules;
`;

  // Always write the registry — even when the template has no actions/ files
  // we still emit imports for the framework-level sharing actions so they get
  // mounted on every template that consumes the registry.
  writeIfChanged(path.join(outDir, "actions-registry.ts"), registryContent);

  // Ensure .generated/ is in .gitignore
  const gitignorePath = path.join(projectRoot, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, "utf-8");
    if (!gitignore.includes(".generated")) {
      fs.appendFileSync(gitignorePath, "\n.generated/\n");
    }
  }
}

/**
 * Vite plugin that watches `actions/` and generates type-safe action types.
 *
 * Add to your Vite config (auto-included by `defineConfig` from `@agent-native/core`):
 *
 * ```ts
 * import { actionTypesPlugin } from "@agent-native/core/vite/action-types-plugin";
 * plugins: [actionTypesPlugin()]
 * ```
 */
export function actionTypesPlugin(): Plugin {
  let projectRoot = "";
  let actionsDir = "";
  let workspaceActionsDir: string | null = null;

  return {
    name: "agent-native-action-types",
    configResolved(config) {
      projectRoot = config.root;
      actionsDir = path.resolve(projectRoot, "actions");
      workspaceActionsDir = findWorkspaceCoreActionsDir(projectRoot);
    },
    buildStart() {
      generateActionArtifacts(actionsDir, projectRoot);
    },
    configureServer(server) {
      // Generate on startup
      generateActionArtifacts(actionsDir, projectRoot);

      // Watch for changes in actions/
      const watcher = server.watcher;
      const handleChange = (file: string) => {
        const inAppActions = file.startsWith(actionsDir);
        const inWorkspaceActions = workspaceActionsDir
          ? file.startsWith(workspaceActionsDir)
          : false;
        if ((inAppActions || inWorkspaceActions) && /\.(ts|js)$/.test(file)) {
          generateActionArtifacts(actionsDir, projectRoot);
        }
      };
      watcher.add(actionsDir);
      if (workspaceActionsDir) watcher.add(workspaceActionsDir);
      watcher.on("add", handleChange);
      watcher.on("unlink", handleChange);
      // Don't regenerate on content changes — only file additions/removals
      // affect the registry. Return type changes are picked up by TypeScript
      // from the source files via typeof import().
    },
  };
}

/**
 * Public helper to regenerate the types + registry from a non-Vite context
 * (e.g. the Nitro deploy build, where Vite plugins don't run).
 */
export function generateActionRegistryForProject(projectRoot: string): void {
  const actionsDir = path.resolve(projectRoot, "actions");
  generateActionArtifacts(actionsDir, projectRoot);
}
