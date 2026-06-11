import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildAppSkillPack,
  ensureAppSkill,
  exportedSkills,
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
        .includes("npx skills add . --skill assets -a codex"),
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
    // Pack output still includes both names for backward compat with older
    // plugin consumers that may have installed only the alias name.
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
    // Only the canonical name; no alias duplicate.
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

    // Pre-seed with both the canonical and alias entry (simulates old install).
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
    // Canonical entry updated, alias removed, unrelated entry untouched.
    expect(Object.keys(config.mcpServers).sort()).toEqual([
      "agent-native-assets",
      "other-server",
    ]);
    // Log message mentions the removed entry.
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
});

describe("app skill launch and ensure", () => {
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
});
