import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

/**
 * E2E regression tests for `agent-native create`.
 *
 * These tests exercise the full scaffolding pipeline against real templates
 * (not just the bundled "blank" template) to catch the class of bugs where
 * the CLI produces output that fails `pnpm install` on a fresh machine:
 *
 *   - workspace:* deps left unresolved in standalone scaffolds
 *   - catalog: refs left unresolved (loadCatalog can't find pnpm-workspace.yaml)
 *   - required workspace packages not scaffolded alongside templates
 *   - postinstall scripts missing for required packages
 *   - dist/catalog.json not embedded in the built package
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { addAppToWorkspace, createApp } from "./create.js";
import {
  _scaffoldWorkspaceRoot,
  _scaffoldAppTemplate,
  _scaffoldRequiredPackages,
  _fixPackageJsonName,
  _renameGitignore,
  _loadCatalog,
  _rewriteNetlifyToml,
  _getCoreDependencyVersion,
  _getDispatchDependencyVersion,
  _getGitHubTemplateRef,
  _getGitHubTemplateRefCandidates,
  _shouldSkipScaffoldEntry,
  _tarExtractArgs,
} from "./create.js";
import { setupAgentSymlinks } from "./setup-agents.js";
import { workspacifyApp } from "./workspacify.js";

let tmpDir: string;
let origCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-e2e-test-"));
  origCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(origCwd);
  removeTmpDir(tmpDir);
});

function removeTmpDir(dir: string): void {
  const maxAttempts = 10;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableRmError(error) || attempt === maxAttempts - 1) {
        throw error;
      }
      sleepSync(100 * (attempt + 1));
    }
  }

  throw lastError;
}

function isRetryableRmError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return (
    code === "ENOTEMPTY" ||
    code === "EBUSY" ||
    code === "EPERM" ||
    code === "EMFILE" ||
    code === "ENFILE"
  );
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readPkg(dir: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
}

function allDeps(pkg: Record<string, any>): Record<string, string> {
  return {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  };
}

function readAllTextFiles(dir: string): string {
  const chunks: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      chunks.push(readAllTextFiles(p));
      continue;
    }
    chunks.push(fs.readFileSync(p, "utf-8"));
  }

  return chunks.join("\n");
}

/* ─────────────────────────────────────────────────────────────────────────
 * Standalone scaffold with a real template
 * ───────────────────────────────────────────────────────────────────────── */

describe("standalone scaffold — chat template", { timeout: 60000 }, () => {
  it("rewrites the copied chat tracking app id to the generated app id", async () => {
    await createApp("test-app", { template: "chat" });
    const root = fs.readFileSync(
      path.join(tmpDir, "test-app", "app", "root.tsx"),
      "utf-8",
    );

    expect(root).toContain('app: "test-app"');
    expect(root).toContain('template: "chat"');
    expect(root).not.toContain('app: "chat"');
  });

  it("keeps starter as a legacy input alias for chat", async () => {
    await createApp("legacy-app", { template: "starter" });
    const root = fs.readFileSync(
      path.join(tmpDir, "legacy-app", "app", "root.tsx"),
      "utf-8",
    );

    expect(root).toContain('app: "legacy-app"');
    expect(root).toContain('template: "chat"');
  });

  it("brands a generated chat app as the generated app, not the source template", async () => {
    await createApp("test-app", { template: "chat" });

    const appConfig = fs.readFileSync(
      path.join(tmpDir, "test-app", "app", "lib", "app-config.ts"),
      "utf-8",
    );
    const sidebar = fs.readFileSync(
      path.join(
        tmpDir,
        "test-app",
        "app",
        "components",
        "layout",
        "Sidebar.tsx",
      ),
      "utf-8",
    );
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, "test-app", "public", "manifest.json"),
        "utf-8",
      ),
    );
    const pkg = readPkg(path.join(tmpDir, "test-app"));

    expect(appConfig).toContain('rawAppName = "test-app"');
    expect(appConfig).toContain('rawAppTitle = "Test App"');
    expect(sidebar).not.toContain("New App");
    expect(
      fs.existsSync(
        path.join(tmpDir, "test-app", "app", "routes", "new-app.tsx"),
      ),
    ).toBe(false);
    expect(manifest.name).toBe("Test App");
    expect(manifest.short_name).toBe("Test App");
    expect(manifest.description).toBe("Workspace app for Test App.");
    expect(pkg.description).toBe("Workspace app for Test App.");
  });

  it("resolves all workspace:* deps for standalone install", async () => {
    await createApp("test-app", { template: "chat" });
    const pkg = readPkg(path.join(tmpDir, "test-app"));
    const deps = allDeps(pkg);
    for (const [key, val] of Object.entries(deps)) {
      expect(val, `${key} should not be workspace:*`).not.toMatch(
        /^workspace:/,
      );
    }
  });

  it("resolves all catalog: refs to actual versions", async () => {
    await createApp("test-app", { template: "chat" });
    const pkg = readPkg(path.join(tmpDir, "test-app"));
    const deps = allDeps(pkg);
    for (const [key, val] of Object.entries(deps)) {
      expect(val, `${key} should not be catalog:`).not.toBe("catalog:");
    }
  });

  it("pins React Router packages to tested exact versions for standalone installs", async () => {
    await createApp("test-app", { template: "chat" });
    const pkg = readPkg(path.join(tmpDir, "test-app"));
    const deps = allDeps(pkg);

    expect(deps["@react-router/dev"]).toBe("8.0.1");
    expect(deps["@react-router/fs-routes"]).toBe("8.0.1");
    expect(deps["react-router"]).toBe("8.0.1");
  });

  it("catalog: refs resolve to semver-like strings", async () => {
    await createApp("test-app", { template: "chat" });
    const pkg = readPkg(path.join(tmpDir, "test-app"));
    const deps = allDeps(pkg);
    const catalogKeys = ["tailwindcss", "@tailwindcss/vite", "vite"];
    for (const key of catalogKeys) {
      if (deps[key]) {
        expect(deps[key], `${key} should be a version`).toMatch(/^\^?\d/);
      }
    }
  });

  it("includes the Postgres runtime for hosted SQL databases", async () => {
    await createApp("test-app", { template: "chat" });
    const pkg = readPkg(path.join(tmpDir, "test-app"));
    expect(pkg.dependencies?.postgres).toBeDefined();
  });
});

describe("standalone scaffold — headless template", { timeout: 60000 }, () => {
  it("creates an action-first app without UI template files or UI dependencies", async () => {
    await createApp("test-app", { template: "headless" });
    const root = path.join(tmpDir, "test-app");
    const pkg = readPkg(root);
    const deps = allDeps(pkg);

    expect(fs.existsSync(path.join(root, "actions", "hello.ts"))).toBe(true);
    expect(fs.existsSync(path.join(root, "actions", "run.ts"))).toBe(true);
    expect(fs.existsSync(path.join(root, "app"))).toBe(false);
    expect(fs.existsSync(path.join(root, "vite.config.ts"))).toBe(false);
    expect(fs.existsSync(path.join(root, "react-router.config.ts"))).toBe(
      false,
    );

    expect(pkg.name).toBe("test-app");
    expect(pkg.dependencies?.["@agent-native/core"]).toBe(
      _getCoreDependencyVersion(),
    );
    expect(pkg.dependencies?.postgres).toBeDefined();
    expect(deps.react).toBeUndefined();
    expect(deps["react-dom"]).toBeUndefined();
    expect(deps["react-router"]).toBeUndefined();
    expect(deps.vite).toBeUndefined();
    expect(deps["@react-router/dev"]).toBeUndefined();

    for (const [key, val] of Object.entries(deps)) {
      expect(val, `${key} should not be workspace:*`).not.toMatch(
        /^workspace:/,
      );
      expect(val, `${key} should not be catalog:`).not.toBe("catalog:");
    }

    const agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf-8");
    expect(agents).toContain("This is a headless Agent Native app");
    expect(agents).toContain("This app is not stateless");
    expect(agents).toContain("Chat template");
    expect(agents).toContain("integration blueprints");

    const workspaceYaml = fs.readFileSync(
      path.join(root, "pnpm-workspace.yaml"),
      "utf-8",
    );
    expect(workspaceYaml).toContain("allowBuilds:");
    expect(workspaceYaml).toContain("minimumReleaseAgeExclude:");
    expect(workspaceYaml).toContain('"@sentry/browser-utils"');
    expect(workspaceYaml).toContain('"@sentry/node"');
    expect(workspaceYaml).toContain('"@sentry/replay"');
    expect(workspaceYaml).not.toContain("@assistant-ui");
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * Headless onboarding guards
 *
 * The two documented post-install commands for a headless scaffold —
 * `pnpm typecheck` and `pnpm action hello` — both used to fail out of the box:
 *
 *   1. tsconfig inherited `types: ["vite/client"]` from the UI base config, but
 *      a headless app has no Vite dep, so TypeScript died with TS2688.
 *   2. `import { defineAction } from "@agent-native/core"` resolved to the Node
 *      `default` entry, which re-exported the React client barrel and pulled
 *      `@tanstack/react-query` (uninstalled in a headless app) into the load
 *      graph, crashing at module load.
 *
 * The fast checks below pin both regressions without an install; the gated
 * end-to-end check actually runs the documented commands.
 * ───────────────────────────────────────────────────────────────────────── */

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = path.resolve(SPEC_DIR, "../..");
const ROOT_ENTRY_SRC = path.join(CORE_ROOT, "src", "index.ts");
const CORE_DIST_INDEX = path.join(CORE_ROOT, "dist", "index.js");

describe("headless onboarding guards", { timeout: 60000 }, () => {
  it("scaffolds a tsconfig that does not pull vite/client types", async () => {
    await createApp("test-app", { template: "headless" });
    const tsconfig = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "test-app", "tsconfig.json"), "utf-8"),
    );
    const types: string[] | undefined = tsconfig.compilerOptions?.types;
    // Must override the UI base's `types: ["vite/client"]` — a headless app
    // has no `vite` dependency, so that ambient type lib can't resolve.
    expect(
      types,
      "headless tsconfig must override compilerOptions.types",
    ).toBeDefined();
    expect(types).not.toContain("vite/client");
    expect(types).toContain("node");
  });

  it("keeps the package root (Node default) entry free of the React client barrel", () => {
    // Importing `defineAction` (or anything else) from the bare
    // "@agent-native/core" specifier must stay server-safe: the Node `default`
    // entry must not statically re-export "./client/index.js", which would drag
    // react / react-router / @tanstack/react-query into a headless load graph.
    const rootEntry = fs.readFileSync(ROOT_ENTRY_SRC, "utf-8");
    expect(rootEntry).not.toMatch(/from\s+["']\.\/client\/index(\.js)?["']/);
    // Sanity: the server/action primitives headless apps need are still here.
    expect(rootEntry).toMatch(/\bdefineAction\b/);
    expect(rootEntry).toMatch(/from\s+["']\.\/action\.js["']/);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * Headless onboarding — real `pnpm install` + `tsgo` + `pnpm action`
 *
 * Heavyweight: scaffolds a headless app linked to the LOCAL built core, then
 * runs the exact documented commands. Gated on AGENT_NATIVE_CREATE_USE_LOCAL_CORE
 * (the flag the CI "Scaffold E2E" job already sets) plus a built dist/, so the
 * fast `pnpm test` job skips it but CI and local `pnpm build && ...` runs it.
 * ───────────────────────────────────────────────────────────────────────── */

const RUN_HEADLESS_INSTALL_E2E =
  process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE === "1" &&
  fs.existsSync(CORE_DIST_INDEX);

function runPnpm(
  args: string[],
  cwd: string,
  timeout = 300000,
): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync("pnpm", args, {
    cwd,
    encoding: "utf-8",
    timeout,
    env: { ...process.env },
  });
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

function runNode(
  args: string[],
  cwd: string,
  timeout = 300000,
): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf-8",
    timeout,
    env: { ...process.env },
  });
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

describe.skipIf(!RUN_HEADLESS_INSTALL_E2E)(
  "headless onboarding — install + typecheck + action",
  { timeout: 600000 },
  () => {
    it("pnpm install, pnpm typecheck, and pnpm action hello all succeed", async () => {
      await createApp("headless-e2e", { template: "headless" });
      const appDir = path.join(tmpDir, "headless-e2e");

      // The scaffold must be linked to the local core build (file: URL), not
      // the published "latest", so the test exercises THIS branch's code.
      const pkg = readPkg(appDir);
      expect(pkg.dependencies["@agent-native/core"]).toMatch(/^file:/);

      const install = runPnpm(["install", "--prefer-offline"], appDir);
      expect(
        install.status,
        `pnpm install failed:\n${install.stdout}\n${install.stderr}`,
      ).toBe(0);
      const installOutput = `${install.stdout}\n${install.stderr}`;
      expect(installOutput).not.toContain("missing peer tailwindcss");
      expect(installOutput).not.toContain("Conflicting peer dependencies");

      const typecheck = runPnpm(["typecheck"], appDir);
      expect(
        typecheck.status,
        `pnpm typecheck failed:\n${typecheck.stdout}\n${typecheck.stderr}`,
      ).toBe(0);

      const action = runPnpm(["action", "hello", "--name", "Builder"], appDir);
      expect(
        action.status,
        `pnpm action hello failed:\n${action.stdout}\n${action.stderr}`,
      ).toBe(0);
      expect(`${action.stdout}\n${action.stderr}`).toContain("Hello, Builder!");

      const discovery = runNode(
        [
          "--input-type=module",
          "-e",
          [
            'const { autoDiscoverActions } = await import("@agent-native/core/server");',
            'const actions = await autoDiscoverActions("auto");',
            'if (!actions.hello) throw new Error("hello action was not discovered");',
            'console.log(Object.keys(actions).sort().join(","));',
          ].join("\n"),
        ],
        appDir,
      );
      expect(
        discovery.status,
        `plain node action discovery failed:\n${discovery.stdout}\n${discovery.stderr}`,
      ).toBe(0);
      expect(discovery.stdout).toContain("hello");
      expect(discovery.stderr).not.toContain("ERR_UNKNOWN_FILE_EXTENSION");
      expect(discovery.stderr).not.toContain(
        '[action-discovery] Skipped "hello.ts"',
      );
    });
  },
);

/* ─────────────────────────────────────────────────────────────────────────
 * Workspace scaffold with required packages
 * ───────────────────────────────────────────────────────────────────────── */

describe("workspace scaffold — required packages", { timeout: 60000 }, () => {
  async function scaffoldWorkspace(
    name: string,
    templates: string[],
  ): Promise<string> {
    const targetDir = path.join(tmpDir, name);
    await _scaffoldWorkspaceRoot(targetDir, name);
    const workspaceCoreName = `@${name}/shared`;

    for (const t of templates) {
      const appDir = path.join(targetDir, "apps", t);
      await _scaffoldAppTemplate(appDir, t);
      workspacifyApp({
        appDir,
        appName: t,
        templateName: t,
        workspaceRoot: targetDir,
        workspaceCoreName,
        coreDependencyVersion: _getCoreDependencyVersion(),
        dispatchDependencyVersion: _getDispatchDependencyVersion(),
      });
      _fixPackageJsonName(appDir, t);
      _renameGitignore(appDir);
      setupAgentSymlinks(appDir);
    }

    await _scaffoldRequiredPackages(templates, targetDir);
    return targetDir;
  }

  it("scaffolds the scheduling package when calendar is included", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["chat", "calendar"]);
    const schedDir = path.join(wsDir, "packages", "scheduling");
    expect(fs.existsSync(schedDir)).toBe(true);
    expect(fs.existsSync(path.join(schedDir, "package.json"))).toBe(true);
  });

  it("scaffolds the pinpoint package when design is included", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["chat", "design"]);
    const pinpointDir = path.join(wsDir, "packages", "pinpoint");
    expect(fs.existsSync(pinpointDir)).toBe(true);
    expect(fs.existsSync(path.join(pinpointDir, "package.json"))).toBe(true);
  });

  it("backs first-party workspace deps with scaffolded packages", async () => {
    // Includes every template that declares an @agent-native/* workspace:*
    // dep so a missing `requiredPackages` entry surfaces here instead of as
    // ERR_PNPM_WORKSPACE_PKG_NOT_FOUND on the user's machine.
    const apps = ["assets", "calendar", "design", "slides", "videos"];
    const wsDir = await scaffoldWorkspace("my-ws", apps);

    for (const appName of apps) {
      const pkg = readPkg(path.join(wsDir, "apps", appName));
      for (const [depName, version] of Object.entries(allDeps(pkg))) {
        if (
          typeof version !== "string" ||
          !version.startsWith("workspace:") ||
          !depName.startsWith("@agent-native/")
        ) {
          continue;
        }

        const packageDir = depName.split("/")[1];
        expect(
          fs.existsSync(
            path.join(wsDir, "packages", packageDir, "package.json"),
          ),
          `${appName} dependency ${depName} must be scaffolded under packages/${packageDir}`,
        ).toBe(true);
      }
    }
  });

  it("converts @agent-native/core workspace:* in scaffolded packages", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["calendar"]);
    const schedPkg = readPkg(path.join(wsDir, "packages", "scheduling"));
    for (const depType of ["dependencies", "devDependencies"] as const) {
      const val = schedPkg[depType]?.["@agent-native/core"];
      if (val) {
        expect(
          val,
          `${depType}["@agent-native/core"] must not be workspace:*`,
        ).not.toMatch(/^workspace:/);
        expect(val).toBe(_getCoreDependencyVersion());
      }
    }
  });

  it("preserves non-core workspace:* deps in app package.json", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["calendar"]);
    const calPkg = readPkg(path.join(wsDir, "apps", "calendar"));
    expect(calPkg.dependencies["@agent-native/scheduling"]).toBe("workspace:*");
  });

  it("resolves @agent-native/dispatch to latest in workspacified apps", async () => {
    // Pin the default (non-local-linking) behaviour regardless of an ambient
    // AGENT_NATIVE_CREATE_USE_LOCAL_CORE set by the headless install e2e.
    const previous = process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE;
    delete process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE;
    try {
      const wsDir = await scaffoldWorkspace("my-ws", ["dispatch"]);
      const dispatchPkg = readPkg(path.join(wsDir, "apps", "dispatch"));
      expect(dispatchPkg.dependencies["@agent-native/dispatch"]).toBe("latest");
    } finally {
      if (previous === undefined) {
        delete process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE;
      } else {
        process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE = previous;
      }
    }
  });

  it("can opt into local dispatch linking for framework development", async () => {
    const previous = process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE;
    process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE = "1";
    try {
      const wsDir = await scaffoldWorkspace("my-ws", ["dispatch"]);
      const dispatchPkg = readPkg(path.join(wsDir, "apps", "dispatch"));
      expect(dispatchPkg.dependencies["@agent-native/dispatch"]).toMatch(
        /^file:\/\//,
      );
    } finally {
      if (previous === undefined) {
        delete process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE;
      } else {
        process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE = previous;
      }
    }
  });

  it("adds postinstall script for required packages", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["calendar"]);
    const rootPkg = readPkg(wsDir);
    expect(rootPkg.scripts?.postinstall).toBeDefined();
    expect(rootPkg.scripts.postinstall).toContain(
      "pnpm --filter ./packages/scheduling build",
    );
  });

  it("appends to existing postinstall without duplicating", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["calendar"]);
    await _scaffoldRequiredPackages(["calendar"], wsDir);
    const rootPkg = readPkg(wsDir);
    const postinstall = rootPkg.scripts?.postinstall ?? "";
    const matches = postinstall.match(
      /pnpm --filter .\/packages\/scheduling build/g,
    );
    expect(matches?.length).toBe(1);
  });

  it("injects catalog into workspace pnpm-workspace.yaml", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["chat"]);
    const wsYaml = fs.readFileSync(
      path.join(wsDir, "pnpm-workspace.yaml"),
      "utf-8",
    );
    expect(wsYaml).toContain("catalog:");
    expect(wsYaml).toContain("tailwindcss");
  });

  it("pins Better Auth in workspace roots until the latest Kysely adapter build is compatible", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["calendar"]);
    const wsYaml = fs.readFileSync(
      path.join(wsDir, "pnpm-workspace.yaml"),
      "utf-8",
    );
    expect(wsYaml).toContain("better-auth");
    expect(wsYaml).toContain("1.6.0");
  });

  it("keeps the default workspace chat app branded as Chat", async () => {
    await createApp("my-ws", { template: "chat,dispatch" });
    const wsDir = path.join(tmpDir, "my-ws");
    const appConfig = fs.readFileSync(
      path.join(wsDir, "apps", "chat", "app", "lib", "app-config.ts"),
      "utf-8",
    );
    const appPkg = readPkg(path.join(wsDir, "apps", "chat"));

    expect(appConfig).toContain('rawAppTitle = "Chat"');
    expect(appPkg.displayName).toBe("Chat");
    expect(appPkg.description).toBe(
      "Minimal chat-first agent-native app template.",
    );
  });

  it("resolves @agent-native/core in workspacified apps", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["chat"]);
    const appPkg = readPkg(path.join(wsDir, "apps", "chat"));
    expect(appPkg.dependencies["@agent-native/core"]).toBe(
      _getCoreDependencyVersion(),
    );
  });

  it("adds workspace shared dependency to apps", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["chat"]);
    const appPkg = readPkg(path.join(wsDir, "apps", "chat"));
    expect(appPkg.dependencies["@my-ws/shared"]).toBe("workspace:*");
  });

  it("includes the Postgres runtime at the workspace root and in apps", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["chat"]);
    const rootPkg = readPkg(wsDir);
    const appPkg = readPkg(path.join(wsDir, "apps", "chat"));
    expect(rootPkg.dependencies?.postgres).toBeDefined();
    expect(appPkg.dependencies?.postgres).toBeDefined();
  });

  it("writes inherited chat auth/chat wrappers while preserving app identity", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["chat"]);
    const authPlugin = fs.readFileSync(
      path.join(wsDir, "apps", "chat", "server", "plugins", "auth.ts"),
      "utf-8",
    );
    const agentChatPlugin = fs.readFileSync(
      path.join(wsDir, "apps", "chat", "server", "plugins", "agent-chat.ts"),
      "utf-8",
    );

    expect(authPlugin).toContain("@my-ws/shared/server");
    expect(authPlugin).toContain("defaultAuthPlugin");
    expect(agentChatPlugin).toContain("@my-ws/shared/server");
    expect(agentChatPlugin).toContain("createWorkspaceAgentChatPlugin");
    expect(agentChatPlugin).toContain('appId: "chat"');
    expect(agentChatPlugin).toContain("loadActionsFromStaticRegistry");
  });

  it("resolves @agent-native/core at the workspace root for the gateway", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["chat"]);
    const rootPkg = readPkg(wsDir);
    expect(rootPkg.dependencies["@agent-native/core"]).toBe(
      _getCoreDependencyVersion(),
    );
  });

  it("always scaffolds dispatch when creating a workspace, even if not in --template", async () => {
    // Dispatch is the workspace control plane (shared secrets, messaging,
    // approvals, A2A routing). A workspace without it has nowhere to live
    // those responsibilities, so the CLI forces it in even when the caller
    // only asked for other apps.
    await createApp("test-ws", { template: "chat,forms" });

    expect(
      fs.existsSync(path.join(tmpDir, "test-ws", "apps", "dispatch")),
    ).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "test-ws", "apps", "chat"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(tmpDir, "test-ws", "apps", "forms"))).toBe(
      true,
    );
  });
});

describe("workspace add-app scaffold", { timeout: 60000 }, () => {
  it("allows Dispatch to be added later as the canonical workspace app", async () => {
    const wsDir = path.join(tmpDir, "my-ws");
    await _scaffoldWorkspaceRoot(wsDir, "my-ws");

    process.chdir(wsDir);
    await addAppToWorkspace("dispatch", { template: "dispatch" });

    const dispatchPkg = readPkg(path.join(wsDir, "apps", "dispatch"));
    expect(dispatchPkg.name).toBe("dispatch");
    expect(
      fs.existsSync(path.join(wsDir, "apps", "dispatch", "package.json")),
    ).toBe(true);
  });

  it("rewrites chat tracking identity for a renamed workspace app", async () => {
    await createApp("my-ws", { template: "chat,dispatch" });

    const chatRoot = fs.readFileSync(
      path.join(tmpDir, "my-ws", "apps", "chat", "app", "root.tsx"),
      "utf-8",
    );
    expect(chatRoot).toContain('app: "chat"');

    process.chdir(path.join(tmpDir, "my-ws"));
    await createApp("crm", { template: "chat" });

    const root = fs.readFileSync(
      path.join(tmpDir, "my-ws", "apps", "crm", "app", "root.tsx"),
      "utf-8",
    );

    expect(root).toContain('app: "crm"');
    expect(root).toContain('template: "chat"');
    expect(root).not.toContain('app: "chat"');

    const agentChatPlugin = fs.readFileSync(
      path.join(
        tmpDir,
        "my-ws",
        "apps",
        "crm",
        "server",
        "plugins",
        "agent-chat.ts",
      ),
      "utf-8",
    );
    expect(agentChatPlugin).toContain('appId: "crm"');
  });
});

describe("template/core version compatibility", () => {
  it("uses the npm latest dist-tag for generated projects", () => {
    // Pin the default behaviour even when the headless install e2e has set
    // AGENT_NATIVE_CREATE_USE_LOCAL_CORE in the ambient environment.
    const previous = process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE;
    delete process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE;
    try {
      expect(_getCoreDependencyVersion()).toBe("latest");
    } finally {
      if (previous === undefined) {
        delete process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE;
      } else {
        process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE = previous;
      }
    }
  });

  it("can opt into local core linking for framework development", () => {
    const previous = process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE;
    process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE = "1";
    try {
      expect(_getCoreDependencyVersion()).toMatch(/^file:\/\//);
    } finally {
      if (previous === undefined) {
        delete process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE;
      } else {
        process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE = previous;
      }
    }
  });

  it("downloads first-party templates from the CLI package version tag", () => {
    const candidates = _getGitHubTemplateRefCandidates();
    // Changesets per-package tag MUST be tried first — without it, fresh
    // 0.8.0+ publishes 404 because the legacy `v<version>` tag no longer
    // exists. See PR for context (Sami's `pnpm i` failure was a downstream
    // symptom of this same release-tooling shift).
    expect(candidates[0]).toMatch(
      /^@agent-native\/core@\d+\.\d+\.\d+(?:-.+)?$/,
    );
    // Legacy `v<version>` tag stays as a fallback so any older release that
    // only has the repo-wide tag (≤ 0.7.83) keeps working when re-run.
    expect(candidates).toContain(`v${candidates[0].split("@").slice(-1)[0]}`);
    // `main` is the last-resort fallback for unreleased dev builds.
    expect(candidates[candidates.length - 1]).toBe("main");
  });
});

describe("workspace scaffold defaults", () => {
  it("keeps the workspace dev gateway in the framework package", async () => {
    const wsDir = path.join(tmpDir, "my-ws");
    await _scaffoldWorkspaceRoot(wsDir, "my-ws");
    const rootPkg = readPkg(wsDir);
    expect(rootPkg.scripts?.dev).toBe("agent-native dev");
    expect(rootPkg.dependencies?.["@agent-native/core"]).toBe(
      _getCoreDependencyVersion(),
    );
    expect(fs.existsSync(path.join(wsDir, "scripts", "workspace-dev.ts"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(wsDir, "packages", "shared"))).toBe(true);
    expect(fs.existsSync(path.join(wsDir, "packages", "core-module"))).toBe(
      false,
    );
    expect(
      fs.existsSync(path.join(wsDir, ".github", "workflows", "ci.yml")),
    ).toBe(false);
  });

  it("creates root AGENTS.md and CLAUDE.md for workspace-level agents", async () => {
    const wsDir = path.join(tmpDir, "my-ws");
    await _scaffoldWorkspaceRoot(wsDir, "my-ws");

    const agentsPath = path.join(wsDir, "AGENTS.md");
    const claudePath = path.join(wsDir, "CLAUDE.md");
    const agents = fs.readFileSync(agentsPath, "utf-8");

    expect(agents).toContain("My Ws Workspace Instructions");
    expect(agents).toContain("WORKSPACE_ORG_NAME");
    expect(fs.existsSync(claudePath)).toBe(true);

    const claudeStat = fs.lstatSync(claudePath);
    if (claudeStat.isSymbolicLink()) {
      expect(fs.readlinkSync(claudePath)).toBe("AGENTS.md");
    } else {
      expect(fs.readFileSync(claudePath, "utf-8")).toBe(agents);
    }
  });

  it("seeds shared workspace skills and exposes them at the workspace root", async () => {
    const wsDir = path.join(tmpDir, "my-ws");
    await _scaffoldWorkspaceRoot(wsDir, "my-ws");

    const sharedSkillsDir = path.join(
      wsDir,
      "packages",
      "shared",
      ".agents",
      "skills",
    );
    const rootSkillsDir = path.join(wsDir, ".agents", "skills");

    expect(
      fs.existsSync(
        path.join(sharedSkillsDir, "context-awareness", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(sharedSkillsDir, "portability", "SKILL.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(sharedSkillsDir, "sharing", "SKILL.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(sharedSkillsDir, "shadcn-ui", "SKILL.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(rootSkillsDir, "context-awareness", "SKILL.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(rootSkillsDir, "shadcn-ui", "SKILL.md")),
    ).toBe(true);
    expect(fs.existsSync(path.join(wsDir, ".claude", "skills"))).toBe(true);
    expect(
      fs.existsSync(
        path.join(wsDir, "packages", "shared", ".claude", "skills"),
      ),
    ).toBe(true);
  });

  it("keeps the generic workspace scaffold free of company-specific example identities", async () => {
    const wsDir = path.join(tmpDir, "my-ws");
    await _scaffoldWorkspaceRoot(wsDir, "my-ws");

    const generated = readAllTextFiles(wsDir);
    expect(generated).not.toMatch(/builder\.io/i);
    expect(generated).not.toMatch(/steve@builder\.io/i);
  });

  it("keeps the generic workspace scaffold free of provider-specific deploy config", async () => {
    const wsDir = path.join(tmpDir, "my-ws");
    await _scaffoldWorkspaceRoot(wsDir, "my-ws");

    expect(fs.existsSync(path.join(wsDir, "netlify.toml"))).toBe(false);

    const gitignore = fs.readFileSync(path.join(wsDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("dist/");
  });

  it("does not copy generated Vercel output or legacy Claude settings", async () => {
    const wsDir = await (async () => {
      const targetDir = path.join(tmpDir, "my-ws");
      await _scaffoldWorkspaceRoot(targetDir, "my-ws");
      const appDir = path.join(targetDir, "apps", "chat");
      await _scaffoldAppTemplate(appDir, "chat");
      return targetDir;
    })();
    expect(
      fs.existsSync(path.join(wsDir, "apps", "chat", ".vercel", "output")),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(wsDir, "apps", "chat", ".claude", "settings.json"),
      ),
    ).toBe(false);
  }, 60000);

  it("does not copy local Claude settings files from framework-dev templates", () => {
    expect(
      _shouldSkipScaffoldEntry("settings.json", ".claude/settings.json"),
    ).toBe(true);
    expect(
      _shouldSkipScaffoldEntry(
        "settings.local.json",
        ".claude/settings.local.json",
      ),
    ).toBe(true);
  });

  it("does not copy local agent-native runtime state", () => {
    expect(_shouldSkipScaffoldEntry(".agent-native")).toBe(true);
  });

  it("can skip first-party agent symlinks while extracting GitHub tarballs", () => {
    expect(
      _tarExtractArgs("/tmp/archive.tar.gz", "/tmp/out", {
        skipAgentSymlinks: true,
      }),
    ).toEqual([
      "xzf",
      "/tmp/archive.tar.gz",
      "--strip-components=1",
      "--exclude",
      "*/CLAUDE.md",
      "--exclude",
      "*/.claude/skills",
      "-C",
      "/tmp/out",
    ]);
  });
});

describe("Netlify scaffold rewrite", () => {
  it("preserves database env setup while removing template install commands", () => {
    const appDir = path.join(tmpDir, "app");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "netlify.toml"),
      [
        "[build]",
        '  command = "export DATABASE_URL=${NETLIFY_DATABASE_URL:-$DATABASE_URL} && pnpm install && NITRO_PRESET=netlify pnpm --filter chat build"',
        '  publish = "templates/chat/dist"',
        '  functions = "templates/chat/.netlify/functions-internal"',
        "",
      ].join("\n"),
    );

    _rewriteNetlifyToml(appDir, "dispatch", "workspace");

    const netlify = fs.readFileSync(path.join(appDir, "netlify.toml"), "utf-8");
    const expectRedirect = (from: string, to: string, status: number) => {
      expect(netlify).toContain(
        [
          "[[redirects]]",
          `  from = "${from}"`,
          `  to = "${to}"`,
          `  status = ${status}`,
        ].join("\n"),
      );
    };

    expect(netlify).toContain(
      'command = "export DATABASE_URL=\\"${NETLIFY_DATABASE_URL:-$DATABASE_URL}\\" && APP_BASE_PATH=/dispatch VITE_APP_BASE_PATH=/dispatch NITRO_PRESET=netlify pnpm --filter dispatch build"',
    );
    expect(netlify).not.toContain("pnpm install");
    expect(netlify).toContain('publish = "apps/dispatch/dist"');
    expect(netlify).toContain(
      'functions = "apps/dispatch/.netlify/functions-internal"',
    );
    expect(netlify).toContain('  APP_BASE_PATH = "/dispatch"');
    expect(netlify).toContain('  VITE_APP_BASE_PATH = "/dispatch"');
    expectRedirect("/", "/dispatch/overview", 302);
    expectRedirect("/dispatch", "/dispatch/overview", 302);
    expectRedirect("/apps", "/dispatch/apps", 302);
    expectRedirect("/apps/new-app", "/dispatch/new-app", 302);
    expectRedirect("/new-app", "/dispatch/new-app", 302);
    expectRedirect("/approval", "/dispatch/approval", 302);
    expectRedirect("/extensions", "/dispatch/extensions", 302);
    expectRedirect("/thread-debug", "/dispatch/thread-debug", 302);
    expect(netlify).not.toContain('from = "/dispatch/*"');
    expect(netlify).not.toContain('to = "/.netlify/functions/server"');
    expect(netlify).not.toContain("force = true");
  });

  it("keeps unpooled database build overrides for templates that need them", () => {
    const appDir = path.join(tmpDir, "unpooled-app");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "netlify.toml"),
      [
        "[build]",
        '  command = "export DATABASE_URL=${NETLIFY_DATABASE_URL:-$DATABASE_URL} && pnpm install && DATABASE_URL=${NETLIFY_DATABASE_URL_UNPOOLED:-$DATABASE_URL} NITRO_PRESET=netlify pnpm --filter mail build"',
        '  publish = "templates/mail/dist"',
        '  functions = "templates/mail/.netlify/functions-internal"',
        "",
      ].join("\n"),
    );

    _rewriteNetlifyToml(appDir, "mail", "standalone");

    const netlify = fs.readFileSync(path.join(appDir, "netlify.toml"), "utf-8");
    expect(netlify).toContain(
      'command = "export DATABASE_URL=\\"${NETLIFY_DATABASE_URL:-$DATABASE_URL}\\" && DATABASE_URL=\\"${NETLIFY_DATABASE_URL_UNPOOLED:-$DATABASE_URL}\\" NITRO_PRESET=netlify pnpm build"',
    );
    expect(netlify).not.toContain("pnpm install");
    expect(netlify).toContain('publish = "dist"');
    expect(netlify).toContain('functions = ".netlify/functions-internal"');
  });

  it("does not add Dispatch root redirects to other workspace apps", () => {
    const appDir = path.join(tmpDir, "chat-app");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "netlify.toml"),
      [
        "[build]",
        '  command = "export DATABASE_URL=${NETLIFY_DATABASE_URL:-$DATABASE_URL} && pnpm install && NITRO_PRESET=netlify pnpm --filter chat build"',
        '  publish = "templates/chat/dist"',
        '  functions = "templates/chat/.netlify/functions-internal"',
        "",
      ].join("\n"),
    );

    _rewriteNetlifyToml(appDir, "chat", "workspace");

    const netlify = fs.readFileSync(path.join(appDir, "netlify.toml"), "utf-8");
    expect(netlify).toContain(
      'command = "export DATABASE_URL=\\"${NETLIFY_DATABASE_URL:-$DATABASE_URL}\\" && APP_BASE_PATH=/chat VITE_APP_BASE_PATH=/chat NITRO_PRESET=netlify pnpm --filter chat build"',
    );
    expect(netlify).toContain('  APP_BASE_PATH = "/chat"');
    expect(netlify).toContain('  VITE_APP_BASE_PATH = "/chat"');
    expect(netlify).not.toContain('  to = "/dispatch/apps"');
    expect(netlify).not.toContain('  to = "/dispatch/new-app"');
    expect(netlify).not.toContain('  to = "/dispatch/approval"');
    expect(netlify).not.toContain('  to = "/dispatch/extensions"');
    expect(netlify).not.toContain('  from = "/dispatch/*"');
  });

  it("repairs stale Dispatch redirects in generated Netlify configs", () => {
    const appDir = path.join(tmpDir, "dispatch-app");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "netlify.toml"),
      [
        "[build]",
        '  command = "export DATABASE_URL=${NETLIFY_DATABASE_URL:-$DATABASE_URL} && pnpm install && NITRO_PRESET=netlify pnpm --filter dispatch build"',
        '  publish = "templates/dispatch/dist"',
        '  functions = "templates/dispatch/.netlify/functions-internal"',
        "",
        "[[redirects]]",
        '  from = "/"',
        '  to = "/dispatch/"',
        "  status = 302",
        "",
        "[[redirects]]",
        '  from = "/dispatch/*"',
        '  to = "/.netlify/functions/server"',
        "  status = 200",
        "  force = true",
        "",
      ].join("\n"),
    );

    _rewriteNetlifyToml(appDir, "dispatch", "workspace");

    const netlify = fs.readFileSync(path.join(appDir, "netlify.toml"), "utf-8");
    expect(netlify).toContain('  from = "/"');
    expect(netlify).toContain('  to = "/dispatch/overview"');
    expect(netlify).not.toContain('  to = "/dispatch/"');
    expect(netlify).not.toContain('  from = "/dispatch/*"');
    expect(netlify).not.toContain('  to = "/.netlify/functions/server"');
    expect(netlify).not.toContain("force = true");
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * loadCatalog
 * ───────────────────────────────────────────────────────────────────────── */

describe("loadCatalog", () => {
  it("returns a non-empty catalog from the monorepo", () => {
    const catalog = _loadCatalog();
    expect(Object.keys(catalog).length).toBeGreaterThan(0);
    expect(catalog["tailwindcss"]).toBeDefined();
    expect(catalog["tailwindcss"]).toMatch(/^\^?\d/);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * Build artifacts — catalog.json and publishable package.json
 * ───────────────────────────────────────────────────────────────────────── */

describe("build artifacts", () => {
  const coreRoot = path.resolve(__dirname, "../..");

  it("dist/catalog.json exists after build", () => {
    const catalogPath = path.join(coreRoot, "dist", "catalog.json");
    if (!fs.existsSync(path.join(coreRoot, "dist"))) {
      // dist/ may not exist if tests run before build — skip gracefully
      return;
    }
    expect(
      fs.existsSync(catalogPath),
      "dist/catalog.json must be generated by finalize-build.mjs",
    ).toBe(true);
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
    expect(Object.keys(catalog).length).toBeGreaterThan(0);
  });

  it("core package.json has no workspace:* in dependencies", () => {
    const corePkg = readPkg(coreRoot);
    const deps = corePkg.dependencies ?? {};
    for (const [key, val] of Object.entries(deps)) {
      expect(
        val,
        `dependencies.${key} must not be workspace:* — this breaks npx installs`,
      ).not.toMatch(/^workspace:/);
    }
  });
});
