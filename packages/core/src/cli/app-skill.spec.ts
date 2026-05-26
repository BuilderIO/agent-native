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
    expect(fs.existsSync(path.join(outDir, ".mcp.json"))).toBe(true);
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
