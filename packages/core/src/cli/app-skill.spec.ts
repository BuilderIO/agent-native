import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildAppSkillPack,
  ensureAppSkill,
  exportedSkills,
  launchAppSkill,
  loadAppSkillManifest,
  normalizeAppSkillManifest,
  parseAppSkillArgs,
  resolvePluginVersion,
  resolveLaunchPlan,
} from "./app-skill.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tmpDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-app-skill-"));
  tmpRoots.push(root);
  return root;
}

// Windows makes a file or relative link only with Developer Mode or admin
// rights, so a test that needs one runs only where this machine can make it.
function canMakeLinks(): boolean {
  if (process.platform !== "win32") return true;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "an-app-skill-probe-"));
  try {
    fs.symlinkSync("missing", path.join(dir, "probe"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") return false;
    throw error;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeFixture(root: string): string {
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "assets", scripts: { dev: "agent-native dev" } }),
    "utf-8",
  );
  const skillRoot = path.join(root, ".agents", "skills", "asset-generation");
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(
    path.join(skillRoot, "SKILL.md"),
    [
      "---",
      "name: asset-generation",
      "description: Use Assets for image and video generation.",
      "metadata:",
      "  visibility: both",
      "---",
      "",
      "# Asset Generation",
      "",
      "Use the picker when a human should select an asset.",
      "",
    ].join("\n"),
    "utf-8",
  );
  fs.mkdirSync(path.join(skillRoot, "references"), { recursive: true });
  fs.writeFileSync(
    path.join(skillRoot, "references", "project-context.md"),
    "Keep project context bounded and preserve its provenance.\n",
    "utf-8",
  );

  const manifestFile = path.join(root, "agent-native.app-skill.json");
  fs.writeFileSync(
    manifestFile,
    JSON.stringify(
      {
        schemaVersion: 1,
        id: "assets",
        displayName: "Assets",
        description: "Create, search, and export brand assets.",
        hosted: {
          url: "https://assets.agent-native.com",
        },
        mcp: {
          serverName: "agent-native-assets",
        },
        local: {
          sourcePath: ".",
          defaultUrl: "http://127.0.0.1:8100",
          commands: {
            install: "pnpm install",
            dev: "pnpm dev",
          },
        },
        surfaces: [
          {
            id: "asset-picker",
            action: "open-asset-picker",
            path: "/picker",
            mediaTypes: ["image", "video"],
            defaultMediaType: "image",
          },
        ],
        skills: [
          {
            path: ".agents/skills/asset-generation",
            visibility: "both",
            exportAs: "assets",
          },
          {
            path: ".agents/skills/internal-only",
            visibility: "internal",
          },
        ],
        hostAdapters: [
          "codex-plugin",
          "claude-marketplace",
          "vercel-skills",
          "plain-skill",
          "claude-skill",
          "chatgpt-mcp",
          "generic-mcp",
        ],
      },
      null,
      2,
    ),
    "utf-8",
  );
  return manifestFile;
}

describe("app skill manifests", () => {
  it("normalizes defaults and selects exported skills", () => {
    const manifest = normalizeAppSkillManifest({
      id: "assets",
      hosted: { url: "https://assets.agent-native.com/" },
      skills: [
        { path: "a", visibility: "internal" },
        { path: "b", visibility: "exported" },
        { path: "c", visibility: "both" },
      ],
    });

    expect(manifest.hosted.mcpUrl).toBe(
      "https://assets.agent-native.com/_agent-native/mcp",
    );
    expect(manifest.mcp.serverName).toBe("agent-native-assets");
    expect(manifest.hostAdapters).toContain("claude-marketplace");
    expect(exportedSkills(manifest).map((skill) => skill.path)).toEqual([
      "b",
      "c",
    ]);
  });

  it("rejects malformed ChatGPT plugin metadata instead of casting it", () => {
    expect(() =>
      normalizeAppSkillManifest({
        id: "assets",
        hosted: { url: "https://assets.agent-native.com" },
        chatgpt: { version: "1.0.0" },
      }),
    ).toThrow("chatgpt.interface must be an object.");
  });

  it("parses commands and flags", () => {
    expect(
      parseAppSkillArgs([
        "launch",
        "--local",
        "--manifest",
        "agent-native.app-skill.json",
        "--into=./editable-assets",
        "--dry-run",
      ]),
    ).toMatchObject({
      command: "launch",
      mode: "local",
      manifest: "agent-native.app-skill.json",
      into: "./editable-assets",
      dryRun: true,
    });
  });

  it("rejects unknown commands and invalid flag values", () => {
    expect(() => parseAppSkillArgs(["packk"])).toThrow(
      /Unknown app-skill command/,
    );
    expect(() => parseAppSkillArgs(["--manifest", "--scope", "user"])).toThrow(
      /Missing value for --manifest/,
    );
    expect(() => parseAppSkillArgs(["--scope", "usre"])).toThrow(
      /--scope must be either user or project/,
    );
  });
});

describe("app skill packaging", () => {
  it("generates Codex, skill, MCP, and host adapter files", () => {
    const root = tmpDir();
    const manifestFile = writeFixture(root);
    const loaded = loadAppSkillManifest(manifestFile);
    const outDir = path.join(tmpDir(), "packed-assets");

    const result = buildAppSkillPack(loaded, outDir);

    expect(result.exportedSkillNames).toEqual(["assets"]);
    expect(
      fs.existsSync(path.join(outDir, "skills", "assets", "SKILL.md")),
    ).toBe(true);
    expect(
      fs
        .readFileSync(
          path.join(outDir, "skills", "assets", "SKILL.md"),
          "utf-8",
        )
        .startsWith("---\nname: assets\n"),
    ).toBe(true);
    for (const skillPath of [
      path.join(outDir, "skills", "assets"),
      path.join(
        outDir,
        "adapters",
        "claude-marketplace",
        "plugins",
        "agent-native-assets",
        "skills",
        "assets",
      ),
      path.join(outDir, "adapters", "vercel-skills", "skills", "assets"),
      path.join(outDir, "adapters", "plain-skill", "skills", "assets"),
      path.join(outDir, "adapters", "claude-skill", "skills", "assets"),
    ]) {
      expect(
        fs.existsSync(path.join(skillPath, "references", "project-context.md")),
      ).toBe(true);
    }
    expect(fs.existsSync(path.join(outDir, "app", "package.json"))).toBe(true);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(outDir, "agent-native.app-skill.json"),
          "utf-8",
        ),
      ).local.sourcePath,
    ).toBe("./app");
    expect(
      fs.existsSync(path.join(outDir, ".codex-plugin", "plugin.json")),
    ).toBe(true);
    const codexPlugin = JSON.parse(
      fs.readFileSync(
        path.join(outDir, ".codex-plugin", "plugin.json"),
        "utf-8",
      ),
    );
    expect(codexPlugin.version).toMatch(/^1\.0\.0\+codex\.[0-9a-f]{12}$/);
    expect(fs.existsSync(path.join(outDir, ".mcp.json"))).toBe(true);
    const standardPlugin = JSON.parse(
      fs.readFileSync(path.join(outDir, "plugin.json"), "utf-8"),
    );
    expect(standardPlugin).toMatchObject({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "agent-native-assets",
      version: codexPlugin.version,
    });
    expect(standardPlugin.skills).toBeUndefined();
    const standardMcp = JSON.parse(
      fs.readFileSync(path.join(outDir, "mcp.json"), "utf-8"),
    );
    expect(standardMcp).toEqual({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        "agent-native-assets": {
          type: "streamable-http",
          url: "https://assets.agent-native.com/_agent-native/mcp",
        },
      },
    });
    const claudeMarketplaceRoot = path.join(
      outDir,
      "adapters",
      "claude-marketplace",
    );
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(
            claudeMarketplaceRoot,
            ".claude-plugin",
            "marketplace.json",
          ),
          "utf-8",
        ),
      ),
    ).toMatchObject({
      name: "agent-native-apps",
      plugins: [
        {
          name: "agent-native-assets",
          source: "./plugins/agent-native-assets",
        },
      ],
    });
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(
            claudeMarketplaceRoot,
            "plugins",
            "agent-native-assets",
            ".claude-plugin",
            "plugin.json",
          ),
          "utf-8",
        ),
      ),
    ).toMatchObject({
      name: "agent-native-assets",
      skills: "./skills/",
      mcpServers: "./.mcp.json",
    });
    const claudeMcpConfig = JSON.parse(
      fs.readFileSync(
        path.join(
          claudeMarketplaceRoot,
          "plugins",
          "agent-native-assets",
          ".mcp.json",
        ),
        "utf-8",
      ),
    );
    expect(claudeMcpConfig.mcpServers["agent-native-assets"].url).toBe(
      "https://assets.agent-native.com/_agent-native/mcp",
    );
    expect(
      fs.existsSync(
        path.join(
          claudeMarketplaceRoot,
          "plugins",
          "agent-native-assets",
          "skills",
          "assets",
          "SKILL.md",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(outDir, "adapters", "vercel-skills", "skills", "assets"),
      ),
    ).toBe(true);
    expect(
      fs
        .readFileSync(
          path.join(outDir, "adapters", "vercel-skills", "README.md"),
          "utf-8",
        )
        .includes("npx skills@latest add . --skill assets -a codex"),
    ).toBe(true);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(
            outDir,
            "adapters",
            "vercel-skills",
            "agent-native.app-skill.json",
          ),
          "utf-8",
        ),
      ).id,
    ).toBe("assets");
    expect(
      fs.existsSync(
        path.join(outDir, "adapters", "plain-skill", "skills", "assets"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(outDir, "adapters", "claude-skill", "skills", "assets"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(outDir, "adapters", "generic-mcp", "mcp.json")),
    ).toBe(true);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(outDir, "adapters", "chatgpt-mcp", "connector.json"),
          "utf-8",
        ),
      ),
    ).toMatchObject({
      name: "agent-native-assets",
      url: "https://assets.agent-native.com/_agent-native/mcp",
    });
  });

  it("includes the MCP server name in the Codex plugin version hash", () => {
    const root = tmpDir();
    const manifestFile = writeFixture(root);
    const loaded = loadAppSkillManifest(manifestFile);
    const skills = exportedSkills(loaded.manifest);

    const first = resolvePluginVersion(loaded.manifest, loaded.dir, skills);
    const renamed = {
      ...loaded.manifest,
      mcp: { ...loaded.manifest.mcp, serverName: "assets" },
    };
    const second = resolvePluginVersion(renamed, loaded.dir, skills);

    expect(first).not.toBe(second);
  });

  it("pack still includes alias names in the output .mcp.json for backward compat", async () => {
    const root = tmpDir();
    const manifestFile = writeFixture(root);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
    manifest.mcp.aliases = ["assets"];
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf-8");

    const loaded = loadAppSkillManifest(manifestFile);
    const outDir = path.join(tmpDir(), "packed-assets");
    buildAppSkillPack(loaded, outDir);

    const packedMcp = JSON.parse(
      fs.readFileSync(path.join(outDir, ".mcp.json"), "utf-8"),
    );
    expect(Object.keys(packedMcp.mcpServers).sort()).toEqual([
      "agent-native-assets",
      "assets",
    ]);
  });

  it("ensure writes ONLY the canonical serverName (no alias duplicates)", async () => {
    const root = tmpDir();
    const manifestFile = writeFixture(root);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
    manifest.mcp.aliases = ["assets"];
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf-8");

    const loaded = loadAppSkillManifest(manifestFile);

    await ensureAppSkill(loaded, {
      clients: ["claude-code"],
      scope: "project",
      baseDir: root,
    });
    const config = JSON.parse(
      fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"),
    );
    expect(Object.keys(config.mcpServers)).toEqual(["agent-native-assets"]);
    expect(config.mcpServers["agent-native-assets"]).toEqual({
      type: "http",
      url: "https://assets.agent-native.com/_agent-native/mcp",
    });
  });

  it("ensure removes pre-existing alias entries that point at the same URL", async () => {
    const root = tmpDir();
    const manifestFile = writeFixture(root);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
    manifest.mcp.aliases = ["assets"];
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf-8");

    fs.writeFileSync(
      path.join(root, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            "agent-native-assets": {
              type: "http",
              url: "https://assets.agent-native.com/_agent-native/mcp",
            },
            assets: {
              type: "http",
              url: "https://assets.agent-native.com/_agent-native/mcp",
            },
            "other-server": {
              type: "http",
              url: "https://other.example.com/_agent-native/mcp",
            },
          },
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    const logged: string[] = [];
    const loaded = loadAppSkillManifest(manifestFile);
    await ensureAppSkill(loaded, {
      clients: ["claude-code"],
      scope: "project",
      baseDir: root,
      log: (msg) => logged.push(msg),
    });

    const config = JSON.parse(
      fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"),
    );
    expect(Object.keys(config.mcpServers).sort()).toEqual([
      "agent-native-assets",
      "other-server",
    ]);
    expect(logged.join(" ")).toContain("assets");
  });

  it("rejects pack paths that escape the manifest or output root", () => {
    const root = tmpDir();
    const manifestFile = writeFixture(root);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
    manifest.skills[0].exportAs = "../outside";
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf-8");

    expect(() =>
      buildAppSkillPack(
        loadAppSkillManifest(manifestFile),
        path.join(tmpDir(), "out"),
      ),
    ).toThrow(/Invalid skill export name/);

    manifest.skills[0].exportAs = "assets";
    manifest.local.sourcePath = "../../..";
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf-8");

    expect(() =>
      buildAppSkillPack(
        loadAppSkillManifest(manifestFile),
        path.join(tmpDir(), "out"),
      ),
    ).toThrow(/local\.sourcePath must resolve inside/);
  });

  it("rejects a configured local source path that is missing", () => {
    const root = tmpDir();
    const manifestFile = writeFixture(root);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
    manifest.local.sourcePath = "missing-app";
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf-8");

    expect(() =>
      buildAppSkillPack(
        loadAppSkillManifest(manifestFile),
        path.join(tmpDir(), "out"),
      ),
    ).toThrow(/local\.sourcePath "missing-app" does not exist/);
  });

  it("omits common secret files from packed local app source", () => {
    const root = tmpDir();
    const manifestFile = writeFixture(root);
    fs.writeFileSync(path.join(root, ".env.production"), "SECRET=1", "utf-8");
    fs.writeFileSync(
      path.join(root, ".npmrc"),
      "//example/:_authToken=x",
      "utf-8",
    );
    fs.writeFileSync(path.join(root, "cert.pem"), "secret", "utf-8");

    const outDir = path.join(tmpDir(), "packed-assets");
    buildAppSkillPack(loadAppSkillManifest(manifestFile), outDir);

    expect(fs.existsSync(path.join(outDir, "app", ".env.production"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(outDir, "app", ".npmrc"))).toBe(false);
    expect(fs.existsSync(path.join(outDir, "app", "cert.pem"))).toBe(false);
  });

  // oracle-change: a new test, skipped on Windows, where making a file link needs extra rights.
  it.skipIf(process.platform === "win32")(
    "keeps links in packed app source as links instead of following them",
    () => {
      const root = tmpDir();
      const manifestFile = writeFixture(root);
      fs.mkdirSync(path.join(root, "private"));
      fs.writeFileSync(path.join(root, "private", "notes.txt"), "private");
      fs.symlinkSync(
        path.join("private", "notes.txt"),
        path.join(root, "reference.txt"),
      );

      const outDir = path.join(tmpDir(), "packed-assets");
      buildAppSkillPack(loadAppSkillManifest(manifestFile), outDir);

      const reference = path.join(outDir, "app", "reference.txt");
      expect(fs.lstatSync(reference).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(reference)).toBe(
        path.join("private", "notes.txt"),
      );
      expect(fs.existsSync(path.join(outDir, "app", "private"))).toBe(false);
    },
  );

  it("exports a linked skill folder as files", () => {
    const root = tmpDir();
    const manifestFile = writeFixture(root);
    const skillLink = path.join(root, ".agents", "skills", "asset-generation");
    const sharedSkill = path.join(root, "shared", "asset-generation");
    fs.mkdirSync(path.dirname(sharedSkill), { recursive: true });
    fs.renameSync(skillLink, sharedSkill);
    fs.symlinkSync(
      sharedSkill,
      skillLink,
      process.platform === "win32" ? "junction" : "dir",
    );

    const outDir = path.join(tmpDir(), "packed-assets");
    buildAppSkillPack(loadAppSkillManifest(manifestFile), outDir);

    const exported = path.join(outDir, "skills", "assets");
    expect(fs.lstatSync(exported).isSymbolicLink()).toBe(false);
    expect(
      fs.readFileSync(
        path.join(exported, "references", "project-context.md"),
        "utf-8",
      ),
    ).toBe("Keep project context bounded and preserve its provenance.\n");
  });

  it("exports a skill folder linked into the workspace around the app", () => {
    const workspace = tmpDir();
    fs.writeFileSync(
      path.join(workspace, "package.json"),
      JSON.stringify({ "agent-native": { workspaceCore: "packages/core" } }),
      "utf-8",
    );
    const root = path.join(workspace, "apps", "assets");
    fs.mkdirSync(root, { recursive: true });
    const manifestFile = writeFixture(root);
    const skillLink = path.join(root, ".agents", "skills", "asset-generation");
    const workspaceSkill = path.join(workspace, "skills", "asset-generation");
    fs.mkdirSync(path.dirname(workspaceSkill), { recursive: true });
    fs.renameSync(skillLink, workspaceSkill);
    fs.symlinkSync(
      workspaceSkill,
      skillLink,
      process.platform === "win32" ? "junction" : "dir",
    );

    const outDir = path.join(tmpDir(), "packed-assets");
    buildAppSkillPack(loadAppSkillManifest(manifestFile), outDir);

    expect(
      fs.existsSync(path.join(outDir, "skills", "assets", "SKILL.md")),
    ).toBe(true);
  });

  it("exports links inside a skill as files, leaving out what a pack does", () => {
    const workspace = tmpDir();
    fs.writeFileSync(
      path.join(workspace, "package.json"),
      JSON.stringify({ "agent-native": { workspaceCore: "packages/core" } }),
      "utf-8",
    );
    const root = path.join(workspace, "apps", "assets");
    fs.mkdirSync(root, { recursive: true });
    const manifestFile = writeFixture(root);
    const skill = path.join(root, ".agents", "skills", "asset-generation");
    const brand = path.join(workspace, "shared", "brand");
    const keys = path.join(root, "private", "keys");
    fs.mkdirSync(brand, { recursive: true });
    fs.writeFileSync(path.join(brand, "palette.md"), "Palette\n", "utf-8");
    fs.mkdirSync(keys, { recursive: true });
    fs.writeFileSync(path.join(keys, "token.txt"), "secret\n", "utf-8");
    // Junctions, which Windows makes without extra rights, are absolute.
    const link = (target: string, linkPath: string) =>
      process.platform === "win32"
        ? fs.symlinkSync(target, linkPath, "junction")
        : fs.symlinkSync(
            path.relative(path.dirname(linkPath), target),
            linkPath,
            "dir",
          );
    link(brand, path.join(skill, "brand"));
    link(keys, path.join(skill, "keys"));

    const outDir = path.join(tmpDir(), "packed-assets");
    buildAppSkillPack(loadAppSkillManifest(manifestFile), outDir);

    const exported = path.join(outDir, "skills", "assets");
    expect(fs.lstatSync(path.join(exported, "brand")).isSymbolicLink()).toBe(
      false,
    );
    expect(
      fs.readFileSync(path.join(exported, "brand", "palette.md"), "utf-8"),
    ).toBe("Palette\n");
    expect(fs.existsSync(path.join(exported, "keys"))).toBe(false);
  });

  it("leaves out secret names in any case, and links into them", () => {
    const root = tmpDir();
    const manifestFile = writeFixture(root);
    const secrets = path.join(root, "Secrets");
    fs.mkdirSync(secrets);
    fs.writeFileSync(path.join(secrets, "token.txt"), "secret\n", "utf-8");
    fs.writeFileSync(path.join(root, ".ENV"), "TOKEN=secret\n", "utf-8");
    const skill = path.join(root, ".agents", "skills", "asset-generation");
    fs.symlinkSync(
      secrets,
      path.join(skill, "vault"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const outDir = path.join(tmpDir(), "packed-assets");
    buildAppSkillPack(loadAppSkillManifest(manifestFile), outDir);

    expect(fs.existsSync(path.join(outDir, "app", "Secrets"))).toBe(false);
    expect(fs.existsSync(path.join(outDir, "app", ".ENV"))).toBe(false);
    expect(fs.existsSync(path.join(outDir, "skills", "assets", "vault"))).toBe(
      false,
    );
  });

  it("refuses a skill folder linked outside the app and its workspace", () => {
    const root = tmpDir();
    const manifestFile = writeFixture(root);
    const skillLink = path.join(root, ".agents", "skills", "asset-generation");
    const outsideSkill = path.join(tmpDir(), "asset-generation");
    fs.renameSync(skillLink, outsideSkill);
    fs.symlinkSync(
      outsideSkill,
      skillLink,
      process.platform === "win32" ? "junction" : "dir",
    );

    const outDir = path.join(tmpDir(), "packed-assets");
    expect(() =>
      buildAppSkillPack(loadAppSkillManifest(manifestFile), outDir),
    ).toThrow(/links outside the app and its workspace/);
  });

  it("refuses a skill folder linked into a folder a pack leaves out", () => {
    const root = tmpDir();
    const manifestFile = writeFixture(root);
    const skillLink = path.join(root, ".agents", "skills", "asset-generation");
    const privateSkill = path.join(root, "private", "asset-generation");
    fs.mkdirSync(path.dirname(privateSkill), { recursive: true });
    fs.renameSync(skillLink, privateSkill);
    fs.symlinkSync(
      privateSkill,
      skillLink,
      process.platform === "win32" ? "junction" : "dir",
    );

    const outDir = path.join(tmpDir(), "packed-assets");
    expect(() =>
      buildAppSkillPack(loadAppSkillManifest(manifestFile), outDir),
    ).toThrow(/in a folder a pack leaves out/);
  });

  it("exports a skill folder linked into a folder named with two leading dots", () => {
    const root = tmpDir();
    const manifestFile = writeFixture(root);
    const skillLink = path.join(root, ".agents", "skills", "asset-generation");
    const sharedSkill = path.join(root, "..shared", "asset-generation");
    fs.mkdirSync(path.dirname(sharedSkill), { recursive: true });
    fs.renameSync(skillLink, sharedSkill);
    fs.symlinkSync(
      sharedSkill,
      skillLink,
      process.platform === "win32" ? "junction" : "dir",
    );

    const outDir = path.join(tmpDir(), "packed-assets");
    buildAppSkillPack(loadAppSkillManifest(manifestFile), outDir);

    expect(
      fs.existsSync(path.join(outDir, "skills", "assets", "SKILL.md")),
    ).toBe(true);
  });

  it("drops a linked file from a rebuilt pack once the link no longer resolves", () => {
    const root = tmpDir();
    const manifestFile = writeFixture(root);
    // Only the skill copy is under test, so the pack leaves the app out.
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
    delete manifest.local;
    fs.writeFileSync(manifestFile, JSON.stringify(manifest), "utf-8");
    const notes = path.join(root, "notes");
    fs.mkdirSync(notes);
    fs.writeFileSync(path.join(notes, "plan.md"), "Plan\n");
    fs.symlinkSync(
      notes,
      path.join(root, ".agents", "skills", "asset-generation", "notes"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const outDir = path.join(tmpDir(), "packed-assets");
    const packedNotes = path.join(outDir, "skills", "assets", "notes");
    buildAppSkillPack(loadAppSkillManifest(manifestFile), outDir);
    expect(fs.existsSync(path.join(packedNotes, "plan.md"))).toBe(true);

    fs.rmSync(notes, { recursive: true });
    buildAppSkillPack(loadAppSkillManifest(manifestFile), outDir);

    expect(fs.existsSync(packedNotes)).toBe(false);
    expect(
      fs.existsSync(path.join(outDir, "skills", "assets", "SKILL.md")),
    ).toBe(true);
    expect(fs.readdirSync(path.join(outDir, "skills"))).toEqual(["assets"]);
  });
});

describe("app skill launch and ensure", () => {
  // oracle-change: a new test, skipped where Windows won't make a relative link without extra rights.
  it.skipIf(!canMakeLinks())(
    "points a launched app's links out of the app at their targets",
    async () => {
      const workspace = tmpDir();
      const root = path.join(workspace, "app");
      fs.mkdirSync(root);
      const manifestFile = writeFixture(root);
      const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
      // A missing dev command falls back to `pnpm dev`, so give one that
      // exits at once.
      manifest.local.commands = { dev: "pnpm --version" };
      fs.writeFileSync(manifestFile, JSON.stringify(manifest), "utf-8");
      fs.writeFileSync(path.join(workspace, "shared.md"), "Shared\n");
      fs.writeFileSync(path.join(root, "notes.md"), "Notes\n");
      fs.symlinkSync(
        path.join("..", "shared.md"),
        path.join(root, "shared.md"),
      );
      fs.symlinkSync("notes.md", path.join(root, "notes-link.md"));
      // A folder link whose target isn't there yet.
      fs.symlinkSync(path.join("..", "later"), path.join(root, "later"), "dir");

      const into = path.join(tmpDir(), "editable");
      await launchAppSkill(loadAppSkillManifest(manifestFile), {
        mode: "local",
        into,
        noRegister: true,
        skipInstall: true,
        log: () => {},
      });

      expect(fs.readlinkSync(path.join(into, "shared.md"))).toBe(
        path.join(workspace, "shared.md"),
      );
      expect(fs.readFileSync(path.join(into, "shared.md"), "utf-8")).toBe(
        "Shared\n",
      );
      expect(fs.readlinkSync(path.join(into, "notes-link.md"))).toBe(
        "notes.md",
      );
      // It stays a folder link, so it lists once the folder exists.
      fs.mkdirSync(path.join(workspace, "later"));
      fs.writeFileSync(path.join(workspace, "later", "plan.md"), "Plan\n");
      expect(fs.readdirSync(path.join(into, "later"))).toEqual(["plan.md"]);
    },
  );

  it("resolves hosted and local launcher plans", () => {
    const root = tmpDir();
    const loaded = loadAppSkillManifest(writeFixture(root));

    expect(resolveLaunchPlan(loaded, { mode: "hosted" })).toMatchObject({
      mode: "hosted",
      url: "https://assets.agent-native.com",
      mcpUrl: "https://assets.agent-native.com/_agent-native/mcp",
    });

    const local = resolveLaunchPlan(loaded, {
      mode: "local",
      into: path.join(root, "editable"),
    });
    expect(local).toMatchObject({
      mode: "local",
      appDir: path.join(root, "editable"),
      sourceDir: root,
      url: "http://127.0.0.1:8100",
      mcpUrl: "http://127.0.0.1:8100/_agent-native/mcp",
    });
  });

  it("writes MCP config idempotently through ensure", async () => {
    const root = tmpDir();
    const loaded = loadAppSkillManifest(writeFixture(root));

    await ensureAppSkill(loaded, {
      clients: ["claude-code"],
      scope: "project",
      baseDir: root,
    });
    await ensureAppSkill(loaded, {
      clients: ["claude-code"],
      scope: "project",
      baseDir: root,
    });

    const config = JSON.parse(
      fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"),
    );
    expect(Object.keys(config.mcpServers)).toEqual(["agent-native-assets"]);
    expect(config.mcpServers["agent-native-assets"]).toEqual({
      type: "http",
      url: "https://assets.agent-native.com/_agent-native/mcp",
    });
  });

  it("does not write URL-only hosted auth config for Codex through ensure", async () => {
    const root = tmpDir();
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    const logged: string[] = [];
    const loaded = loadAppSkillManifest(writeFixture(root));

    try {
      const result = await ensureAppSkill(loaded, {
        clients: ["codex", "claude-code"],
        scope: "project",
        baseDir: root,
        log: (message) => logged.push(message),
      });

      expect(result.written.map((entry) => entry.client)).toEqual([
        "claude-code",
      ]);
      expect(fs.existsSync(path.join(codexHome, "config.toml"))).toBe(false);

      const config = JSON.parse(
        fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"),
      );
      expect(config.mcpServers["agent-native-assets"]).toEqual({
        type: "http",
        url: "https://assets.agent-native.com/_agent-native/mcp",
      });
      expect(logged.join("\n")).toContain(
        "Skipped URL-only hosted MCP config for codex",
      );
      expect(logged.join("\n")).toContain(
        "agent-native connect https://assets.agent-native.com --client codex --scope project",
      );
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });
});
