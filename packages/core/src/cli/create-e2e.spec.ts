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
import fs from "fs";
import path from "path";
import os from "os";
import { createApp } from "./create.js";
import {
  _scaffoldWorkspaceRoot,
  _scaffoldAppTemplate,
  _scaffoldRequiredPackages,
  _fixPackageJsonName,
  _renameGitignore,
  _loadCatalog,
  _rewriteNetlifyToml,
  _getCoreDependencyVersion,
  _getGitHubTemplateRef,
  _shouldSkipScaffoldEntry,
} from "./create.js";
import { workspacifyApp } from "./workspacify.js";
import { setupAgentSymlinks } from "./setup-agents.js";

let tmpDir: string;
let origCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-e2e-test-"));
  origCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(origCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

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

/* ─────────────────────────────────────────────────────────────────────────
 * Standalone scaffold with a real template
 * ───────────────────────────────────────────────────────────────────────── */

describe("standalone scaffold — starter template", { timeout: 60000 }, () => {
  it("resolves all workspace:* deps for standalone install", async () => {
    await createApp("test-app", { template: "starter" });
    const pkg = readPkg(path.join(tmpDir, "test-app"));
    const deps = allDeps(pkg);
    for (const [key, val] of Object.entries(deps)) {
      expect(val, `${key} should not be workspace:*`).not.toMatch(
        /^workspace:/,
      );
    }
  });

  it("resolves all catalog: refs to actual versions", async () => {
    await createApp("test-app", { template: "starter" });
    const pkg = readPkg(path.join(tmpDir, "test-app"));
    const deps = allDeps(pkg);
    for (const [key, val] of Object.entries(deps)) {
      expect(val, `${key} should not be catalog:`).not.toBe("catalog:");
    }
  });

  it("catalog: refs resolve to semver-like strings", async () => {
    await createApp("test-app", { template: "starter" });
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
    await createApp("test-app", { template: "starter" });
    const pkg = readPkg(path.join(tmpDir, "test-app"));
    expect(pkg.dependencies?.postgres).toBeDefined();
  });
});

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
      });
      _fixPackageJsonName(appDir, t);
      _renameGitignore(appDir);
      setupAgentSymlinks(appDir);
    }

    await _scaffoldRequiredPackages(templates, targetDir);
    return targetDir;
  }

  it("scaffolds the scheduling package when calendar is included", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["starter", "calendar"]);
    const schedDir = path.join(wsDir, "packages", "scheduling");
    expect(fs.existsSync(schedDir)).toBe(true);
    expect(fs.existsSync(path.join(schedDir, "package.json"))).toBe(true);
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

  it("adds postinstall script for required packages", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["calendar"]);
    const rootPkg = readPkg(wsDir);
    expect(rootPkg.scripts?.postinstall).toBeDefined();
    expect(rootPkg.scripts.postinstall).toContain(
      "pnpm --filter ./packages/scheduling build",
    );
  });

  it("appends to existing postinstall without duplicating", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["calendar", "scheduling"]);
    const rootPkg = readPkg(wsDir);
    const postinstall = rootPkg.scripts?.postinstall ?? "";
    const matches = postinstall.match(
      /pnpm --filter .\/packages\/scheduling build/g,
    );
    expect(matches?.length).toBe(1);
  });

  it("injects catalog into workspace pnpm-workspace.yaml", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["starter"]);
    const wsYaml = fs.readFileSync(
      path.join(wsDir, "pnpm-workspace.yaml"),
      "utf-8",
    );
    expect(wsYaml).toContain("catalog:");
    expect(wsYaml).toContain("tailwindcss");
  });

  it("resolves @agent-native/core in workspacified apps", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["starter"]);
    const appPkg = readPkg(path.join(wsDir, "apps", "starter"));
    expect(appPkg.dependencies["@agent-native/core"]).toBe(
      _getCoreDependencyVersion(),
    );
  });

  it("adds workspace shared dependency to apps", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["starter"]);
    const appPkg = readPkg(path.join(wsDir, "apps", "starter"));
    expect(appPkg.dependencies["@my-ws/shared"]).toBe("workspace:*");
  });

  it("includes the Postgres runtime at the workspace root and in apps", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["starter"]);
    const rootPkg = readPkg(wsDir);
    const appPkg = readPkg(path.join(wsDir, "apps", "starter"));
    expect(rootPkg.dependencies?.postgres).toBeDefined();
    expect(appPkg.dependencies?.postgres).toBeDefined();
  });

  it("writes inherited starter auth/chat wrappers so workspace-core plugins can override defaults", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["starter"]);
    const authPlugin = fs.readFileSync(
      path.join(wsDir, "apps", "starter", "server", "plugins", "auth.ts"),
      "utf-8",
    );
    const agentChatPlugin = fs.readFileSync(
      path.join(wsDir, "apps", "starter", "server", "plugins", "agent-chat.ts"),
      "utf-8",
    );

    expect(authPlugin).toContain("@my-ws/shared/server");
    expect(authPlugin).toContain("defaultAuthPlugin");
    expect(agentChatPlugin).toContain("@my-ws/shared/server");
    expect(agentChatPlugin).toContain("defaultAgentChatPlugin");
  });

  it("resolves @agent-native/core at the workspace root for the gateway", async () => {
    const wsDir = await scaffoldWorkspace("my-ws", ["starter"]);
    const rootPkg = readPkg(wsDir);
    expect(rootPkg.dependencies["@agent-native/core"]).toBe(
      _getCoreDependencyVersion(),
    );
  });
});

describe("template/core version compatibility", () => {
  it("uses the npm latest dist-tag for generated projects", () => {
    expect(_getCoreDependencyVersion()).toBe("latest");
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
    expect(_getGitHubTemplateRef()).toMatch(/^v\d+\.\d+\.\d+(?:-.+)?$/);
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

  it("scaffolds root Netlify config for unified workspace deploys", async () => {
    const wsDir = path.join(tmpDir, "my-ws");
    await _scaffoldWorkspaceRoot(wsDir, "my-ws");

    const netlify = fs.readFileSync(path.join(wsDir, "netlify.toml"), "utf-8");
    expect(netlify).toContain(
      'export DATABASE_URL=\\"${NETLIFY_DATABASE_URL:-$DATABASE_URL}\\" && pnpm install && pnpm exec agent-native deploy --preset netlify --build-only',
    );
    expect(netlify).toContain('publish = "dist"');
    expect(netlify).toContain('functions = ".netlify/functions-internal"');
    expect(netlify).toContain('NITRO_PRESET = "netlify"');
    expect(netlify).toContain('[functions."*"]');
    expect(netlify).toContain("  timeout = 60");

    const gitignore = fs.readFileSync(path.join(wsDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".netlify/");
  });

  it("does not copy generated Vercel output or legacy Claude settings", async () => {
    const wsDir = await (async () => {
      const targetDir = path.join(tmpDir, "my-ws");
      await _scaffoldWorkspaceRoot(targetDir, "my-ws");
      const appDir = path.join(targetDir, "apps", "starter");
      await _scaffoldAppTemplate(appDir, "starter");
      return targetDir;
    })();
    expect(
      fs.existsSync(path.join(wsDir, "apps", "starter", ".vercel", "output")),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(wsDir, "apps", "starter", ".claude", "settings.json"),
      ),
    ).toBe(false);
  });

  it("does not copy local agent-native runtime state", () => {
    expect(_shouldSkipScaffoldEntry(".agent-native")).toBe(true);
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
        '  command = "export DATABASE_URL=${NETLIFY_DATABASE_URL:-$DATABASE_URL} && pnpm install && NITRO_PRESET=netlify pnpm --filter starter build"',
        '  publish = "templates/starter/dist"',
        '  functions = "templates/starter/.netlify/functions-internal"',
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
    expectRedirect("/new-app", "/dispatch/new-app", 302);
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
    const appDir = path.join(tmpDir, "starter-app");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "netlify.toml"),
      [
        "[build]",
        '  command = "export DATABASE_URL=${NETLIFY_DATABASE_URL:-$DATABASE_URL} && pnpm install && NITRO_PRESET=netlify pnpm --filter starter build"',
        '  publish = "templates/starter/dist"',
        '  functions = "templates/starter/.netlify/functions-internal"',
        "",
      ].join("\n"),
    );

    _rewriteNetlifyToml(appDir, "starter", "workspace");

    const netlify = fs.readFileSync(path.join(appDir, "netlify.toml"), "utf-8");
    expect(netlify).toContain(
      'command = "export DATABASE_URL=\\"${NETLIFY_DATABASE_URL:-$DATABASE_URL}\\" && APP_BASE_PATH=/starter VITE_APP_BASE_PATH=/starter NITRO_PRESET=netlify pnpm --filter starter build"',
    );
    expect(netlify).toContain('  APP_BASE_PATH = "/starter"');
    expect(netlify).toContain('  VITE_APP_BASE_PATH = "/starter"');
    expect(netlify).not.toContain('  to = "/dispatch/apps"');
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
