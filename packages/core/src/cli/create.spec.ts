import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  createApp,
  _applyScaffoldIdentity,
  _assertCommunityTemplateRoot,
  _assertSafeCommunityArchiveListing,
  _communityTemplateTarballUrl,
  _communityTemplateTrustMessage,
  _fixPackageJsonName,
  _fixWebManifestName,
  _getCoreDependencyVersion,
  _parseCommunityTemplateSelection,
  _resolveCommunityTemplateSource,
  _discoverCommunityWorkspaceApps,
  _ensureGuardedScaffold,
  _normalizeCommunityWorkspaceAppDependencies,
  _standaloneTemplatePromptOptions,
  _startShapePromptOptions,
  _tarExtractArgs,
  _validateCommunityArchive,
  _workspaceAppNameForTemplateSelection,
} from "./create.js";

let tmpDir: string;

function allDeps(pkg: Record<string, any>): Record<string, string> {
  return {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-create-test-"));
  // createApp resolves relative to cwd
  process.chdir(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("createApp", { timeout: 30000 }, () => {
  it("adds the guard contract to a community-style build without overwriting its doctor", () => {
    const root = path.join(tmpDir, "community-app");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "community-app",
        scripts: {
          build: "vite build",
          doctor: "custom doctor",
          "agent-native:doctor": "custom doctor",
        },
      }),
    );
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Community app\n");

    _ensureGuardedScaffold(root);

    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf-8"),
    );
    expect(pkg.scripts.doctor).toBe("custom doctor");
    expect(pkg.scripts["agent-native:doctor"]).toBe(
      "custom doctor && agent-native doctor",
    );
    expect(pkg.scripts.prebuild).toBe("agent-native doctor --strict");
    expect(
      JSON.parse(
        fs.readFileSync(path.join(root, "agent-native.json"), "utf-8"),
      ),
    ).toMatchObject({ doctor: { failOnBuild: true } });
    expect(fs.readFileSync(path.join(root, "AGENTS.md"), "utf-8")).toContain(
      "Guarded verification",
    );
  });

  it("makes Chat the first and default create option", () => {
    const prompt = _startShapePromptOptions();

    expect(prompt.initialValue).toBe("chat");
    expect(prompt.options.map((option) => option.value)).toEqual([
      "chat",
      "template",
      "community",
      "headless",
    ]);
    expect(
      prompt.options.find((option) => option.value === "template")?.label,
    ).toBe("First-party template(s)");
  });

  it("offers community templates in the standalone picker", () => {
    expect(
      _standaloneTemplatePromptOptions().find(
        (option) => option.value === "community",
      ),
    ).toMatchObject({
      label: "Community template",
      hint: expect.stringContaining("third-party"),
    });
  });

  it("derives workspace app names from GitHub template repo names", () => {
    expect(
      _workspaceAppNameForTemplateSelection("github:acme/customer-portal"),
    ).toBe("customer-portal");
    expect(_workspaceAppNameForTemplateSelection("github:acme/123-crm")).toBe(
      "app-123-crm",
    );
    expect(
      _workspaceAppNameForTemplateSelection(
        "community:https://github.com/acme/customer-portal.git#v2",
      ),
    ).toBe("customer-portal");
    expect(
      _workspaceAppNameForTemplateSelection(
        "https://github.com/acme/platform?app=analytics#v2",
      ),
    ).toBe("analytics");
  });

  it("scaffolds a directory with the app name", async () => {
    await createApp("my-app", { template: "blank" });
    expect(fs.existsSync(path.join(tmpDir, "my-app"))).toBe(true);
  });

  it("replaces {{APP_NAME}} in package.json", async () => {
    await createApp("hello-world", { template: "blank" });
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, "hello-world", "package.json"),
        "utf-8",
      ),
    );
    expect(pkg.name).toBe("hello-world");
    expect(pkg.name).not.toContain("{{");
  });

  it("keeps the blank scaffold headless instead of generating UI files", async () => {
    await createApp("my-app", { template: "blank" });
    const root = path.join(tmpDir, "my-app");

    expect(fs.existsSync(path.join(root, "app"))).toBe(false);
    expect(fs.existsSync(path.join(root, "vite.config.ts"))).toBe(false);
    expect(fs.existsSync(path.join(root, "react-router.config.ts"))).toBe(
      false,
    );
  });

  it("replaces {{APP_NAME}} in AGENTS.md", async () => {
    await createApp("my-cool-app", { template: "blank" });
    const agentsPath = path.join(tmpDir, "my-cool-app", "AGENTS.md");
    if (fs.existsSync(agentsPath)) {
      const content = fs.readFileSync(agentsPath, "utf-8");
      expect(content).not.toContain("{{APP_NAME}}");
      expect(content).toContain("my-cool-app");
    }
  });

  it("does not create a circular symlink inside .agents/skills", async () => {
    await createApp("my-app", { template: "blank" });
    const skillsDir = path.join(tmpDir, "my-app", ".agents", "skills");
    if (fs.existsSync(skillsDir)) {
      // There must be no entry named 'skills' inside the skills directory
      // as that would create a circular reference that crashes Vite's watcher.
      const entries = fs.readdirSync(skillsDir);
      expect(entries).not.toContain("skills");
    }
  });

  it("creates .gitignore from _gitignore", async () => {
    await createApp("my-app", { template: "blank" });
    const gitignore = path.join(tmpDir, "my-app", ".gitignore");
    expect(fs.existsSync(gitignore)).toBe(true);
    expect(fs.readFileSync(gitignore, "utf-8")).toContain(
      "node-compile-cache/",
    );
  });

  it("normalizes @agent-native/core for blank standalone apps", async () => {
    await createApp("my-app", { template: "blank" });
    const pkg = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "my-app", "package.json"), "utf-8"),
    );

    expect(pkg.dependencies["@agent-native/core"]).toBe(
      _getCoreDependencyVersion(),
    );
  });

  it("scaffolds headless apps with one action primitive and no UI shell", async () => {
    await createApp("my-app", { template: "headless" });
    const root = path.join(tmpDir, "my-app");

    const hello = fs.readFileSync(
      path.join(root, "actions", "hello.ts"),
      "utf-8",
    );
    // Imports from the bare package root, which is server-safe so a headless
    // app loads it without React / @tanstack/react-query installed.
    expect(hello).toContain('from "@agent-native/core"');
    expect(hello).toContain("defineAction");
    expect(hello).toContain('http: { method: "GET" }');
    expect(hello).toContain("readOnly: true");

    const run = fs.readFileSync(path.join(root, "actions", "run.ts"), "utf-8");
    expect(run).toContain("CLI dispatcher");
    expect(run).toContain("not exposed as an agent tool");

    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf-8"),
    );
    const deps = allDeps(pkg);

    expect(pkg.scripts.doctor).toBe("agent-native doctor");
    expect(pkg.scripts["agent-native:doctor"]).toBe("agent-native doctor");
    expect(
      JSON.parse(
        fs.readFileSync(path.join(root, "agent-native.json"), "utf-8"),
      ),
    ).toMatchObject({ doctor: { failOnBuild: true } });
    expect(fs.readFileSync(path.join(root, "AGENTS.md"), "utf-8")).toContain(
      "Guarded verification",
    );

    expect(fs.existsSync(path.join(root, "app"))).toBe(false);
    expect(fs.existsSync(path.join(root, "vite.config.ts"))).toBe(false);
    expect(fs.existsSync(path.join(root, "react-router.config.ts"))).toBe(
      false,
    );
    expect(deps.react).toBeUndefined();
    expect(deps["react-router"]).toBeUndefined();
    expect(deps.vite).toBeUndefined();
    expect(deps["@react-router/dev"]).toBeUndefined();

    const tsconfig = JSON.parse(
      fs.readFileSync(path.join(root, "tsconfig.json"), "utf-8"),
    );
    expect(tsconfig.compilerOptions?.types).toEqual(["node"]);

    const agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf-8");
    expect(agents).toContain("This is a headless Agent Native app");
    expect(agents).toContain("This app is not stateless");
    expect(agents).toContain("Chat template");
    expect(agents).toContain("integration blueprints");

    expect(
      fs.existsSync(path.join(root, "server", "routes", "api", "hello.get.ts")),
    ).toBe(false);
  });

  it("keeps blank as a legacy alias for the headless scaffold", async () => {
    await createApp("legacy-blank", { template: "blank" });
    const root = path.join(tmpDir, "legacy-blank");

    expect(fs.existsSync(path.join(root, "actions", "hello.ts"))).toBe(true);
    expect(fs.existsSync(path.join(root, "app"))).toBe(false);
    expect(fs.existsSync(path.join(root, "vite.config.ts"))).toBe(false);
  });

  it("rejects mixing headless with workspace app templates", async () => {
    let exited = false;
    const origExit = process.exit.bind(process);
    // @ts-ignore
    process.exit = () => {
      exited = true;
      throw new Error("process.exit called");
    };
    try {
      await createApp("my-ws", { template: "headless,chat" });
    } catch {
      // expected
    }
    process.exit = origExit;
    expect(exited).toBe(true);
  });

  it("rejects adding headless inside an existing workspace", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ "agent-native": { workspaceCore: "@test/shared" } }),
    );
    fs.mkdirSync(path.join(tmpDir, "apps"));

    let exited = false;
    const origExit = process.exit.bind(process);
    // @ts-ignore
    process.exit = () => {
      exited = true;
      throw new Error("process.exit called");
    };
    try {
      await createApp("api", { template: "headless" });
    } catch {
      // expected
    }
    process.exit = origExit;
    expect(exited).toBe(true);
  });

  it("exits with error for invalid app name", async () => {
    let exited = false;
    const origExit = process.exit.bind(process);
    // @ts-ignore
    process.exit = () => {
      exited = true;
      throw new Error("process.exit called");
    };
    try {
      await createApp("My_Invalid App!");
    } catch {
      // expected
    }
    process.exit = origExit;
    expect(exited).toBe(true);
  });

  it("scaffolds into the current directory for `create .`", async () => {
    const dir = path.join(tmpDir, "my-inplace-app");
    fs.mkdirSync(dir);
    process.chdir(dir);
    await createApp(".", { template: "blank" });
    // No subfolder — files land directly in the current directory.
    expect(fs.existsSync(path.join(dir, "my-inplace-app"))).toBe(false);
    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, "package.json"), "utf-8"),
    );
    expect(pkg.name).toBe("my-inplace-app");
  });

  it("refuses `create .` when the current directory is not empty", async () => {
    const dir = path.join(tmpDir, "occupied-app");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "existing.txt"), "keep me");
    process.chdir(dir);
    let exited = false;
    const origExit = process.exit.bind(process);
    // @ts-ignore
    process.exit = () => {
      exited = true;
      throw new Error("process.exit called");
    };
    try {
      await createApp(".", { template: "blank" });
    } catch {
      // expected
    }
    process.exit = origExit;
    expect(exited).toBe(true);
    expect(fs.existsSync(path.join(dir, "package.json"))).toBe(false);
  });
});

describe("community template selections", () => {
  it("normalizes canonical, legacy, and clean GitHub URL inputs", () => {
    expect(
      _parseCommunityTemplateSelection("community:acme/customer-portal"),
    ).toEqual({
      repo: "acme/customer-portal",
      canonical: "community:acme/customer-portal",
    });
    expect(
      _parseCommunityTemplateSelection(
        "community:https://github.com/acme/customer-portal.git#release%2Fv2",
      ),
    ).toEqual({
      repo: "acme/customer-portal",
      ref: "release/v2",
      canonical: "community:acme/customer-portal#release/v2",
    });
    expect(
      _parseCommunityTemplateSelection("github:acme/customer-portal#v1.2.3"),
    ).toEqual({
      repo: "acme/customer-portal",
      ref: "v1.2.3",
      canonical: "community:acme/customer-portal#v1.2.3",
    });
    expect(
      _parseCommunityTemplateSelection(
        "https://github.com/acme/customer-portal",
      ),
    ).toEqual({
      repo: "acme/customer-portal",
      canonical: "community:acme/customer-portal",
    });
    expect(
      _parseCommunityTemplateSelection(
        "community:https://github.com/acme/platform?app=calendar#release%2Fv2",
      ),
    ).toEqual({
      repo: "acme/platform",
      app: "calendar",
      ref: "release/v2",
      canonical: "community:acme/platform?app=calendar#release/v2",
    });
    expect(
      _parseCommunityTemplateSelection(
        "community:acme/platform?app=calendar#v2",
      ),
    ).toEqual({
      repo: "acme/platform",
      app: "calendar",
      ref: "v2",
      canonical: "community:acme/platform?app=calendar#v2",
    });
  });

  it("rejects non-repository URLs and unsafe refs", () => {
    expect(() =>
      _parseCommunityTemplateSelection(
        "community:https://gitlab.com/acme/customer-portal",
      ),
    ).toThrow("Expected https://github.com/owner/repo");
    expect(() =>
      _parseCommunityTemplateSelection(
        "community:https://github.com/acme/customer-portal/tree/main",
      ),
    ).toThrow("Expected https://github.com/owner/repo");
    expect(() =>
      _parseCommunityTemplateSelection(
        "community:acme/customer-portal#feature..oops",
      ),
    ).toThrow("Invalid Git ref");
    for (const repo of ["../repo", "./repo", "owner/..", "owner/."]) {
      expect(() =>
        _parseCommunityTemplateSelection(`community:${repo}`),
      ).toThrow("Invalid repository name");
    }
    expect(() =>
      _parseCommunityTemplateSelection(
        "community:acme/platform?app=../calendar",
      ),
    ).toThrow("Invalid app name");
    expect(() =>
      _parseCommunityTemplateSelection("community:acme/platform?app=dispatch"),
    ).toThrow("Dispatch cannot be installed");
    expect(() =>
      _parseCommunityTemplateSelection(
        "community:acme/platform?app=mail&ref=v2",
      ),
    ).toThrow("Only ?app=<app-name> is supported");
  });

  it("builds a ref-agnostic GitHub archive URL", () => {
    expect(
      _communityTemplateTarballUrl(
        "acme/customer-portal",
        "release/summer-2026",
      ),
    ).toBe(
      "https://codeload.github.com/acme/customer-portal/tar.gz/release%2Fsummer-2026",
    );
  });

  it("extracts community archives without inherited owners or permissions", () => {
    expect(
      _tarExtractArgs("/tmp/archive.tar.gz", "/tmp/out", {
        untrustedCommunityArchive: true,
      }),
    ).toEqual([
      "xzf",
      "/tmp/archive.tar.gz",
      "--strip-components=1",
      "--no-same-owner",
      "--no-same-permissions",
      "-C",
      "/tmp/out",
    ]);
  });

  it("rejects links in untrusted community archives", () => {
    expect(() =>
      _assertSafeCommunityArchiveListing(
        [
          "drwxr-xr-x  0 user group 0 Jan  1 00:00 repo/",
          "-rw-r--r--  0 user group 2 Jan  1 00:00 repo/package.json",
        ].join("\n"),
      ),
    ).not.toThrow();
    expect(() =>
      _assertSafeCommunityArchiveListing(
        [
          "lrwxr-xr-x  0 user group 0 Jan  1 00:00 repo/CLAUDE.md -> AGENTS.md",
          "lrwxr-xr-x  0 user group 0 Jan  1 00:00 repo/.claude/skills -> ../.agents/skills",
          "lrwxr-xr-x  0 user group 0 Jan  1 00:00 repo/apps/mail/CLAUDE.md -> AGENTS.md",
          "lrwxr-xr-x  0 user group 0 Jan  1 00:00 repo/apps/mail/.claude/skills -> ../.agents/skills",
        ].join("\n"),
      ),
    ).not.toThrow();
    expect(() =>
      _assertSafeCommunityArchiveListing(
        "lrwxr-xr-x  0 user group 0 Jan  1 00:00 repo/secrets -> ../../secrets",
      ),
    ).toThrow("may only contain Agent Native's canonical internal symlinks");
    expect(() =>
      _assertSafeCommunityArchiveListing(
        "hrw-r--r--  0 user group 0 Jan  1 00:00 repo/copy link to repo/source",
      ),
    ).toThrow("may only contain Agent Native's canonical internal symlinks");
  });

  it.skipIf(process.platform === "win32")(
    "validates canonical and outward links in real tar archives",
    () => {
      const fixtureRoot = path.join(tmpDir, "archive-fixture");
      const repoRoot = path.join(fixtureRoot, "repo");
      const archivePath = path.join(fixtureRoot, "template.tar.gz");
      fs.mkdirSync(path.join(repoRoot, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(repoRoot, ".agents", "skills"), {
        recursive: true,
      });
      fs.writeFileSync(path.join(repoRoot, "AGENTS.md"), "# Instructions\n");
      fs.symlinkSync("AGENTS.md", path.join(repoRoot, "CLAUDE.md"));
      fs.symlinkSync(
        "../.agents/skills",
        path.join(repoRoot, ".claude", "skills"),
      );
      const nestedApp = path.join(repoRoot, "apps", "mail");
      fs.mkdirSync(path.join(nestedApp, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(nestedApp, ".agents", "skills"), {
        recursive: true,
      });
      fs.writeFileSync(path.join(nestedApp, "AGENTS.md"), "# App\n");
      fs.symlinkSync("AGENTS.md", path.join(nestedApp, "CLAUDE.md"));
      fs.symlinkSync(
        "../.agents/skills",
        path.join(nestedApp, ".claude", "skills"),
      );
      execFileSync("tar", ["czf", archivePath, "-C", fixtureRoot, "repo"], {
        stdio: "pipe",
      });
      expect(() => _validateCommunityArchive(archivePath)).not.toThrow();

      fs.symlinkSync("../../outside", path.join(repoRoot, "outside"));
      execFileSync("tar", ["czf", archivePath, "-C", fixtureRoot, "repo"], {
        stdio: "pipe",
      });
      expect(() => _validateCommunityArchive(archivePath)).toThrow(
        "may only contain Agent Native's canonical internal symlinks",
      );
    },
  );

  it("warns that community source is unreviewed and not executed", () => {
    expect(
      _communityTemplateTrustMessage(
        "community:acme/customer-portal#release/v2",
      ),
    ).toContain("not reviewed or maintained by Agent Native");
    expect(
      _communityTemplateTrustMessage(
        "community:acme/customer-portal#release/v2",
      ),
    ).toContain("does not install dependencies or run template scripts");
    expect(_communityTemplateTrustMessage("chat")).toBeUndefined();
  });

  it("requires an Agent Native package at the repository root", () => {
    const root = path.join(tmpDir, "community-template");
    fs.mkdirSync(root);

    expect(() =>
      _assertCommunityTemplateRoot(root, "acme/customer-portal"),
    ).toThrow("package.json was not found");

    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "not-agent-native", dependencies: {} }),
    );
    expect(() =>
      _assertCommunityTemplateRoot(root, "acme/customer-portal"),
    ).toThrow("must directly depend on @agent-native/core");

    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "customer-portal",
        dependencies: { "@agent-native/core": "^1.0.0" },
      }),
    );
    expect(() =>
      _assertCommunityTemplateRoot(root, "acme/customer-portal"),
    ).not.toThrow();

    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "metadata-template",
        "agent-native": { community: true },
      }),
    );
    expect(() =>
      _assertCommunityTemplateRoot(root, "acme/metadata-template"),
    ).toThrow("must directly depend on @agent-native/core");
  });

  it("records canonical community source provenance without enabling first-party sync", () => {
    const root = path.join(tmpDir, "community-provenance");
    fs.mkdirSync(root);
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "source-name",
        dependencies: { "@agent-native/core": "^1.0.0" },
        "agent-native": {
          scaffold: {
            template: "chat",
            frameworkSkills: "default",
            templateRef: "@agent-native/core@0.128.4",
          },
        },
      }),
    );

    _fixPackageJsonName(
      root,
      "customer-portal",
      "community:acme/customer-portal#release/v2",
      {
        templateSource: "github",
        templateRef: "release/v2",
        shape: "standalone",
        communityTemplate: {
          source: "https://github.com/acme/customer-portal",
          ref: "release/v2",
        },
      },
    );

    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf-8"),
    );
    expect(pkg["agent-native"].communityTemplate).toEqual({
      source: "https://github.com/acme/customer-portal",
      ref: "release/v2",
    });
    expect(pkg["agent-native"].scaffold).toBeUndefined();
  });

  it.each([
    ["standalone", "customer-portal"],
    ["workspace", "sales-portal"],
  ] as const)(
    "rebrands concrete community app identity for %s installs",
    (shape, appName) => {
      const root = path.join(tmpDir, `community-${shape}`);
      fs.mkdirSync(path.join(root, "app", "lib"), { recursive: true });
      fs.mkdirSync(path.join(root, "server", "plugins"), { recursive: true });
      fs.mkdirSync(path.join(root, "public"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
          name: "source-portal",
          displayName: "Source Portal",
          description: "Source Portal workspace for source-portal teams.",
          dependencies: { "@agent-native/core": "^1.0.0" },
        }),
      );
      fs.writeFileSync(
        path.join(root, "app", "root.tsx"),
        [
          "configureTracking({",
          "  getDefaultProps: (_name, properties) => ({",
          "    ...properties,",
          '    app: "source-portal",',
          "  }),",
          "});",
        ].join("\n"),
      );
      fs.writeFileSync(
        path.join(root, "server", "plugins", "agent-chat.ts"),
        [
          "export default createAgentChatPlugin({",
          '  appId: "source-portal",',
          "});",
        ].join("\n"),
      );
      fs.writeFileSync(
        path.join(root, "app", "lib", "app-config.ts"),
        [
          'const rawAppName = "source-portal";',
          'const rawAppTitle = "Source Portal";',
        ].join("\n"),
      );
      fs.writeFileSync(
        path.join(root, "public", "manifest.json"),
        JSON.stringify({
          name: "Source Portal",
          short_name: "Source Portal",
          description: "Source Portal workspace for source-portal teams.",
        }),
      );
      const sourceIdentity = {
        appName: "source-portal",
        appTitle: "Source Portal",
      };

      _applyScaffoldIdentity(
        root,
        appName,
        "community:acme/source-portal#v1",
        sourceIdentity,
      );
      _fixPackageJsonName(root, appName, "community:acme/source-portal#v1", {
        sourceIdentity,
        templateSource: "github",
        templateRef: "v1",
        shape,
        communityTemplate: {
          source: "https://github.com/acme/source-portal",
          ref: "v1",
          ...(shape === "workspace" ? { app: "source-portal" } : {}),
        },
      });
      _fixWebManifestName(
        root,
        appName,
        "community:acme/source-portal#v1",
        sourceIdentity,
      );

      const appTitle = appName
        .split("-")
        .map((part) => part[0]!.toUpperCase() + part.slice(1))
        .join(" ");
      expect(
        fs.readFileSync(path.join(root, "app", "root.tsx"), "utf-8"),
      ).toContain(`app: "${appName}"`);
      expect(
        fs.readFileSync(
          path.join(root, "server", "plugins", "agent-chat.ts"),
          "utf-8",
        ),
      ).toContain(`appId: "${appName}"`);
      const appConfig = fs.readFileSync(
        path.join(root, "app", "lib", "app-config.ts"),
        "utf-8",
      );
      expect(appConfig).toContain(`rawAppName = "${appName}"`);
      expect(appConfig).toContain(`rawAppTitle = "${appTitle}"`);

      const pkg = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf-8"),
      );
      expect(pkg.name).toBe(appName);
      expect(pkg.displayName).toBe(appTitle);
      expect(pkg.description).toBe(
        `${appTitle} workspace for ${appName} teams.`,
      );
      expect(pkg["agent-native"].scaffold).toBeUndefined();
      expect(pkg["agent-native"].communityTemplate.app).toBe(
        shape === "workspace" ? "source-portal" : undefined,
      );

      const manifest = JSON.parse(
        fs.readFileSync(path.join(root, "public", "manifest.json"), "utf-8"),
      );
      expect(manifest).toMatchObject({
        name: appTitle,
        short_name: appTitle,
        description: `${appTitle} workspace for ${appName} teams.`,
      });
    },
  );
});

describe("community workspace template sources", () => {
  function writeApp(
    workspaceRoot: string,
    appId: string,
    options: {
      packageName?: string;
      displayName?: string;
      dependencies?: Record<string, string>;
    } = {},
  ): string {
    const appDir = path.join(workspaceRoot, "apps", appId);
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "package.json"),
      JSON.stringify({
        name: options.packageName ?? appId,
        displayName: options.displayName ?? appId,
        dependencies: {
          "@agent-native/core": "workspace:*",
          ...options.dependencies,
        },
      }),
    );
    return appDir;
  }

  function writeWorkspaceRoot(
    workspaceRoot: string,
    options: { rootApp?: boolean; workspaceCore?: unknown } = {},
  ): void {
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({
        name: "source-platform",
        ...(options.rootApp
          ? { dependencies: { "@agent-native/core": "^1.0.0" } }
          : {}),
        ...(options.workspaceCore !== undefined
          ? {
              "agent-native": {
                workspaceCore: options.workspaceCore,
              },
            }
          : {}),
      }),
    );
  }

  it("gives workspace metadata precedence over the root core dependency", async () => {
    const root = path.join(tmpDir, "source-workspace");
    writeWorkspaceRoot(root, {
      rootApp: true,
      workspaceCore: "@source/shared",
    });
    writeApp(root, "mail", { displayName: "Mail" });
    writeApp(root, "calendar", { displayName: "Calendar" });
    writeApp(root, "dispatch", { displayName: "Dispatch" });
    writeApp(root, "control", {
      packageName: "@source/dispatch",
      displayName: "Control",
    });

    const seen: string[][] = [];
    const resolved = await _resolveCommunityTemplateSource(
      root,
      _parseCommunityTemplateSelection("community:acme/platform"),
      {
        selectCommunityWorkspaceApp: async (apps) => {
          seen.push(apps.map((app) => app.name));
          return "mail";
        },
      },
    );

    expect(seen).toEqual([["calendar", "mail"]]);
    expect(resolved.app).toBe("mail");
    expect(resolved.sourceDir).toBe(path.join(root, "apps", "mail"));
    expect(resolved.workspaceRoot).toBe(root);
  });

  it("keeps a valid root app as the source even with incidental nested apps", async () => {
    const root = path.join(tmpDir, "root-app");
    writeWorkspaceRoot(root, { rootApp: true });
    const incidental = writeApp(root, "example", {
      displayName: "Example",
    });
    fs.writeFileSync(path.join(incidental, "package.json"), "{malformed");

    const resolved = await _resolveCommunityTemplateSource(
      root,
      _parseCommunityTemplateSelection("community:acme/root-app"),
      {
        selectCommunityWorkspaceApp: async () => {
          throw new Error("root apps must not prompt");
        },
      },
    );
    expect(resolved.sourceDir).toBe(root);
    expect(resolved.app).toBeUndefined();

    await expect(
      _resolveCommunityTemplateSource(
        root,
        _parseCommunityTemplateSelection("community:acme/root-app?app=example"),
      ),
    ).rejects.toThrow("app selectors are only for workspace repositories");
  });

  it("uses explicit app selectors without prompting and errors without a terminal selector", async () => {
    const root = path.join(tmpDir, "scriptable-workspace");
    writeWorkspaceRoot(root, { workspaceCore: "@source/shared" });
    writeApp(root, "mail");
    writeApp(root, "calendar");

    const selected = await _resolveCommunityTemplateSource(
      root,
      _parseCommunityTemplateSelection(
        "community:acme/platform?app=calendar#v2",
      ),
      {
        selectCommunityWorkspaceApp: async () => {
          throw new Error("explicit selectors must not prompt");
        },
      },
    );
    expect(selected.app).toBe("calendar");

    await expect(
      _resolveCommunityTemplateSource(
        root,
        _parseCommunityTemplateSelection("community:acme/platform"),
      ),
    ).rejects.toThrow("?app=<app-name>");
    await expect(
      _resolveCommunityTemplateSource(
        root,
        _parseCommunityTemplateSelection("community:acme/platform?app=tasks"),
      ),
    ).rejects.toThrow("Available apps: calendar, mail");
  });

  it("fails loudly for malformed workspace metadata and app manifests", async () => {
    const malformedRoot = path.join(tmpDir, "malformed-workspace");
    writeWorkspaceRoot(malformedRoot, { workspaceCore: 42 });
    writeApp(malformedRoot, "mail");
    await expect(
      _resolveCommunityTemplateSource(
        malformedRoot,
        _parseCommunityTemplateSelection("community:acme/platform"),
      ),
    ).rejects.toThrow("invalid agent-native.workspaceCore metadata");

    const malformedAppRoot = path.join(tmpDir, "malformed-app");
    writeWorkspaceRoot(malformedAppRoot, {
      workspaceCore: "@source/shared",
    });
    const appDir = path.join(malformedAppRoot, "apps", "broken");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, "package.json"), "{nope");
    expect(() => _discoverCommunityWorkspaceApps(malformedAppRoot)).toThrow(
      'app "broken" has an unreadable package.json',
    );
  });

  it("resolves source catalogs and canonical shared plugins for standalone leaves", () => {
    const root = path.join(tmpDir, "dependency-workspace");
    writeWorkspaceRoot(root, { workspaceCore: "@source/shared" });
    fs.writeFileSync(
      path.join(root, "pnpm-workspace.yaml"),
      ["catalog:", '  "zod": "^4.4.3"'].join("\n"),
    );
    const sourceApp = writeApp(root, "mail", {
      displayName: "Mail",
      dependencies: {
        "@source/shared": "workspace:*",
        zod: "catalog:",
      },
    });
    fs.mkdirSync(path.join(sourceApp, "server", "plugins"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(sourceApp, ".generated"), { recursive: true });
    fs.writeFileSync(
      path.join(sourceApp, "server", "plugins", "auth.ts"),
      [
        'import { defaultAuthPlugin as frameworkDefault } from "@agent-native/core/server";',
        'import * as workspaceServer from "@source/shared/server";',
        "const workspacePlugin = workspaceServer.defaultAuthPlugin;",
        "export default workspacePlugin || frameworkDefault;",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(sourceApp, "server", "plugins", "agent-chat.ts"),
      [
        'import { createAgentChatPlugin, loadActionsFromStaticRegistry } from "@agent-native/core/server";',
        'import * as workspaceServer from "@source/shared/server";',
        'import actionsRegistry from "../../.generated/actions-registry.js";',
        "const createWorkspaceAgentChatPlugin = workspaceServer.createWorkspaceAgentChatPlugin;",
        'const options = { appId: "mail", actions: loadActionsFromStaticRegistry(actionsRegistry) };',
        "export default createWorkspaceAgentChatPlugin(options);",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(sourceApp, "README.md"),
      "This app originally used @source/shared/server.",
    );

    _normalizeCommunityWorkspaceAppDependencies(sourceApp, root, {
      shape: "standalone",
      destinationAppName: "inbox",
      sourceIdentity: { appName: "mail", appTitle: "Mail" },
    });

    const pkg = JSON.parse(
      fs.readFileSync(path.join(sourceApp, "package.json"), "utf-8"),
    );
    expect(pkg.dependencies["@source/shared"]).toBeUndefined();
    expect(pkg.dependencies.zod).toBe("^4.4.3");
    expect(pkg.dependencies["@agent-native/core"]).toBe(
      _getCoreDependencyVersion(),
    );
    expect(
      fs.readFileSync(
        path.join(sourceApp, "server", "plugins", "auth.ts"),
        "utf-8",
      ),
    ).toContain("defaultAuthPlugin as default");
    const agentChat = fs.readFileSync(
      path.join(sourceApp, "server", "plugins", "agent-chat.ts"),
      "utf-8",
    );
    expect(agentChat).toContain('appId: "inbox"');
    expect(agentChat).not.toContain("@source/shared");
  });

  it("rewrites canonical shared plugins for destination workspaces and rejects unsupported deps/imports", () => {
    const root = path.join(tmpDir, "target-workspace-source");
    writeWorkspaceRoot(root, { workspaceCore: "@source/shared" });
    const appDir = writeApp(root, "mail", {
      dependencies: { "@source/shared": "workspace:*" },
    });
    fs.mkdirSync(path.join(appDir, "server", "plugins"), { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "server", "plugins", "auth.ts"),
      'import * as workspaceServer from "@source/shared/server";\nexport default workspaceServer.defaultAuthPlugin;\n',
    );

    _normalizeCommunityWorkspaceAppDependencies(appDir, root, {
      shape: "workspace",
      destinationAppName: "inbox",
      targetWorkspaceCoreName: "@target/shared",
      sourceIdentity: { appName: "mail", appTitle: "Mail" },
    });
    expect(
      fs.readFileSync(
        path.join(appDir, "server", "plugins", "auth.ts"),
        "utf-8",
      ),
    ).toContain("@target/shared/server");

    const unsupportedRoot = path.join(tmpDir, "unsupported-workspace");
    writeWorkspaceRoot(unsupportedRoot, {
      workspaceCore: "@source/shared",
    });
    const unsupportedApp = writeApp(unsupportedRoot, "mail", {
      dependencies: { "@source/helpers": "workspace:*" },
    });
    expect(() =>
      _normalizeCommunityWorkspaceAppDependencies(
        unsupportedApp,
        unsupportedRoot,
        {
          shape: "standalone",
          destinationAppName: "mail",
          sourceIdentity: { appName: "mail", appTitle: "Mail" },
        },
      ),
    ).toThrow("source workspace package is not included");

    const importRoot = path.join(tmpDir, "import-workspace");
    writeWorkspaceRoot(importRoot, { workspaceCore: "@source/shared" });
    const importApp = writeApp(importRoot, "mail", {
      dependencies: { "@source/shared": "workspace:*" },
    });
    fs.mkdirSync(path.join(importApp, "actions"), { recursive: true });
    fs.writeFileSync(
      path.join(importApp, "actions", "custom.ts"),
      'import { helper } from "@source/shared/server";\n',
    );
    expect(() =>
      _normalizeCommunityWorkspaceAppDependencies(importApp, importRoot, {
        shape: "standalone",
        destinationAppName: "mail",
        sourceIdentity: { appName: "mail", appTitle: "Mail" },
      }),
    ).toThrow("imports its source shared package");
  });
});
