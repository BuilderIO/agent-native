import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addAgentNativeSkill,
  AGENT_NATIVE_SKILL_METADATA_FILE,
  parseSkillsArgs,
  runSkills,
} from "./skills.js";

const tmpRoots: string[] = [];
const PLANS_SKILL_NAMES = ["visual-plan", "visual-recap"];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function tmpDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-skills-"));
  tmpRoots.push(root);
  return root;
}

function writeContentAppSkillFixture(root: string): string {
  const skillRoot = path.join(root, ".agents", "skills", "content");
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(
    path.join(skillRoot, "SKILL.md"),
    [
      "---",
      "name: content",
      "description: Use Content for local docs.",
      "metadata:",
      "  visibility: exported",
      "---",
      "",
      "# Content",
      "",
      "Use Content for docs.",
      "",
    ].join("\n"),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(root, "agent-native.app-skill.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id: "content",
        displayName: "Content",
        description: "Edit docs, blogs, resources, and MDX content.",
        hosted: {
          url: "https://content.agent-native.com",
          mcpUrl: "https://content.agent-native.com/_agent-native/mcp",
        },
        mcp: {
          serverName: "agent-native-content",
        },
        local: {
          sourcePath: ".",
          defaultUrl: "http://127.0.0.1:8083",
          commands: {
            install: "pnpm install",
            dev: "pnpm dev",
          },
        },
        surfaces: [
          {
            id: "content-documents",
            action: "list-documents",
            path: "/",
          },
        ],
        skills: [
          {
            path: ".agents/skills/content",
            visibility: "both",
            exportAs: "content",
          },
        ],
        hostAdapters: ["plain-skill", "claude-skill", "generic-mcp"],
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  return root;
}

function workspaceRoot(): string {
  let current = process.cwd();
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    current = path.dirname(current);
  }
  throw new Error("Could not locate workspace root.");
}

describe("agent-native skills", () => {
  it("calls out hosted Plans as free and open source in CLI copy", () => {
    const source = fs.readFileSync(
      path.join(workspaceRoot(), "packages", "core", "src", "cli", "skills.ts"),
      "utf-8",
    );

    expect(source).toContain("Hosted plans, shareable links (recommended)");
    expect(source).toContain(
      "100% free and open source. Supports comments, browser editor, and sharing.",
    );
  });

  it("defaults to the one-command Assets install path", () => {
    expect(parseSkillsArgs(["add", "assets"])).toMatchObject({
      command: "add",
      target: "assets",
      client: "all",
      clientExplicit: false,
      instructions: true,
      mcp: true,
    });
  });

  it("tracks when --client is explicit", () => {
    expect(
      parseSkillsArgs(["add", "assets", "--client", "claude-code"]),
    ).toMatchObject({
      client: "claude-code",
      clientExplicit: true,
    });
  });

  it("authenticates by default and opts out with --no-connect", () => {
    expect(parseSkillsArgs(["add", "assets"]).connect).toBe(true);
    expect(parseSkillsArgs(["add", "assets", "--no-connect"]).connect).toBe(
      false,
    );
    expect(parseSkillsArgs(["add", "assets", "--skip-connect"]).connect).toBe(
      false,
    );
  });

  it("parses the PR Visual Recap GitHub Action flag and alias", () => {
    expect(
      parseSkillsArgs(["add", "visual-plan", "--with-github-action"]),
    ).toMatchObject({ withGithubAction: true });
    expect(
      parseSkillsArgs(["add", "visual-plan", "--with-github-actions"]),
    ).toMatchObject({ withGithubAction: true });
  });

  it("parses managed instruction update flags for plain skill repos", () => {
    expect(
      parseSkillsArgs([
        "add",
        "BuilderIO/skills",
        "--skill",
        "quick-recap",
        "--update-instructions",
      ]),
    ).toMatchObject({
      plainSkillNames: ["quick-recap"],
      updateInstructions: true,
    });
    expect(
      parseSkillsArgs(["add", "BuilderIO/skills", "--no-update-instructions"]),
    ).toMatchObject({ updateInstructions: false });
  });

  it("parses status/update without prompting for add defaults", () => {
    expect(parseSkillsArgs(["status", "visual-plan"])).toMatchObject({
      command: "status",
      target: "visual-plan",
      scopeExplicit: false,
    });
    expect(
      parseSkillsArgs(["update", "visual-plan", "--scope", "project"]),
    ).toMatchObject({
      command: "update",
      target: "visual-plan",
      scope: "project",
      scopeExplicit: true,
    });
  });

  it("skips the auth flow when --no-connect is passed", async () => {
    const root = tmpDir();
    const runConnect = vi.fn(async () => {});

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "assets",
        "--client",
        "claude-code",
        "--scope",
        "project",
        "--no-connect",
      ]),
      {
        baseDir: root,
        isInteractive: () => true,
        runConnect,
        runCommand: async () => 0,
      },
    );

    expect(runConnect).not.toHaveBeenCalled();
    expect(result.connected).toBe(false);
  });

  it("reports pending connect when --no-connect skips Codex MCP config", async () => {
    const root = tmpDir();
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;

    try {
      const result = await addAgentNativeSkill(
        parseSkillsArgs([
          "add",
          "visual-plan",
          "--client",
          "codex",
          "--scope",
          "user",
          "--no-connect",
        ]),
        {
          baseDir: root,
          isInteractive: () => true,
          promptPlanMode: async () => "hosted",
          runCommand: async () => 0,
        },
      );

      expect(result.mcpClients).toEqual([]);
      expect(result.connectCommand).toBe(
        "npx @agent-native/core@latest connect https://plan.agent-native.com --client codex --scope user",
      );
      expect(fs.existsSync(path.join(codexHome, "config.toml"))).toBe(false);
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("prints the connect command instead of auth in a non-interactive shell", async () => {
    const root = tmpDir();
    const runConnect = vi.fn(async () => {});

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "assets",
        "--client",
        "claude-code",
        "--scope",
        "project",
      ]),
      {
        baseDir: root,
        isInteractive: () => false,
        runConnect,
        runCommand: async () => 0,
      },
    );

    expect(runConnect).not.toHaveBeenCalled();
    expect(result.connected).toBe(false);
    expect(result.connectCommand).toBe(
      "npx @agent-native/core@latest connect https://assets.agent-native.com --client claude-code --scope project",
    );
  });

  it("authenticates every supported client by default when no client is specified", async () => {
    const root = tmpDir();
    const runConnect = vi.fn(async () => {});

    const result = await addAgentNativeSkill(
      parseSkillsArgs(["add", "assets", "--scope", "project"]),
      {
        baseDir: root,
        isInteractive: () => true,
        runConnect,
        runCommand: async () => 0,
      },
    );

    expect(result.connected).toBe(true);
    expect(runConnect).toHaveBeenCalledWith([
      "https://assets.agent-native.com",
      "--client",
      "claude-code,codex,cowork,cursor,opencode,github-copilot",
      "--scope",
      "project",
    ]);
  });

  it("routes embedded connect output through a transcript log with spinner feedback", async () => {
    const root = tmpDir();
    const runConnect = vi.fn(async () => {});
    const connectLog: string[] = [];
    const spinner = {
      start: vi.fn(),
      clear: vi.fn(),
    };

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "assets",
        "--client",
        "claude-code",
        "--scope",
        "project",
      ]),
      {
        baseDir: root,
        isInteractive: () => true,
        connectLog: (message) => connectLog.push(message),
        createConnectSpinner: () => spinner,
        runConnect,
        runCommand: async () => 0,
      },
    );

    expect(result.connected).toBe(true);
    expect(spinner.start).toHaveBeenCalledWith("Authenticating Assets…");
    expect(spinner.clear).toHaveBeenCalledTimes(1);
    expect(connectLog).toEqual(["Authenticating Assets…"]);
    expect(runConnect).toHaveBeenCalledWith([
      "https://assets.agent-native.com",
      "--client",
      "claude-code",
      "--scope",
      "project",
    ]);
  });

  it("accepts image-generation aliases for the built-in Assets skill", async () => {
    const root = tmpDir();

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "agent-native-images",
        "--client",
        "codex",
        "--scope",
        "project",
      ]),
      { baseDir: root, runCommand: async () => 0 },
    );

    expect(result.id).toBe("assets");
    expect(result.skillNames).toEqual(["assets"]);
    // Built-in skill instructions are written straight into the client's skills
    // directory (no npx @agent-native/skills@latest shell-out).
    const skillDir = path.join(root, ".agents", "skills", "assets");
    expect(result.written).toContain(skillDir);
    expect(fs.existsSync(path.join(skillDir, "SKILL.md"))).toBe(true);
  });

  it("installs Content local-files instructions and repo manifest", async () => {
    const root = tmpDir();

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "content",
        "--mode",
        "local-files",
        "--client",
        "codex",
        "--scope",
        "project",
      ]),
      { baseDir: root, runCommand: async () => 0 },
    );

    const skillDir = path.join(root, ".agents", "skills", "content");
    const manifestPath = path.join(root, "agent-native.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    expect(result.id).toBe("content");
    expect(result.skillNames).toEqual(["content"]);
    expect(result.planMode).toBe("local-files");
    expect(result.mcpUrl).toBe("");
    expect(result.mcpClients).toEqual([]);
    expect(result.localManifestPath).toBe(manifestPath);
    expect(result.commands).toContain(`write ${manifestPath}`);
    expect(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf-8")).toContain(
      "Default storage for this installation: Content Local File Mode.",
    );
    expect(manifest).toMatchObject({
      version: 1,
      apps: {
        content: {
          mode: "local-files",
          components: "components",
          extensions: "extensions",
        },
      },
    });
    expect(manifest.apps.content.roots.map((root: any) => root.path)).toEqual([
      "docs",
      "blog",
      "content",
      "resources",
    ]);
    expect(manifest.mode).toBeUndefined();
  });

  it("preserves existing Content local-files manifest customizations", async () => {
    const root = tmpDir();
    fs.writeFileSync(
      path.join(root, "agent-native.json"),
      `${JSON.stringify(
        {
          version: 1,
          mode: "workspace",
          apps: {
            plan: {
              mode: "hosted",
            },
            content: {
              roots: [
                {
                  name: "Knowledge",
                  path: "knowledge",
                  kind: "docs",
                  extensions: [".mdx"],
                },
              ],
              components: ["blocks"],
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "content",
        "--mode",
        "local-files",
        "--client",
        "codex",
        "--scope",
        "project",
      ]),
      { baseDir: root, runCommand: async () => 0 },
    );

    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "agent-native.json"), "utf-8"),
    );
    expect(manifest.apps.content.roots).toEqual([
      {
        name: "Knowledge",
        path: "knowledge",
        kind: "docs",
        extensions: [".mdx"],
      },
    ]);
    expect(manifest.apps.content.components).toEqual(["blocks"]);
    expect(manifest.apps.content.extensions).toBe("extensions");
    expect(manifest.mode).toBe("workspace");
    expect(manifest.apps.plan).toEqual({ mode: "hosted" });
  });

  it("accepts Content app-skill directories with local-files mode", async () => {
    const root = tmpDir();
    const appDir = writeContentAppSkillFixture(tmpDir());
    const commands: { cmd: string; args: string[] }[] = [];

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        appDir,
        "--mode",
        "local-files",
        "--client",
        "codex",
        "--scope",
        "project",
      ]),
      {
        baseDir: root,
        runCommand: async (cmd, args) => {
          commands.push({ cmd, args });
          return 0;
        },
      },
    );

    const manifestPath = path.join(root, "agent-native.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    expect(result.id).toBe("content");
    expect(result.planMode).toBe("local-files");
    expect(result.mcpUrl).toBe("");
    expect(result.mcpClients).toEqual([]);
    expect(result.localManifestPath).toBe(manifestPath);
    expect(commands).toHaveLength(1);
    expect(commands[0].args).toEqual(
      expect.arrayContaining(["--mode", "local-files"]),
    );
    expect(manifest.mode).toBeUndefined();
    expect(manifest.apps.content.mode).toBe("local-files");
  });

  it("accepts Content app-skill manifests with local-files mode", async () => {
    const root = tmpDir();
    const appDir = writeContentAppSkillFixture(tmpDir());
    const appManifest = path.join(appDir, "agent-native.app-skill.json");

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        appManifest,
        "--mode",
        "local-files",
        "--client",
        "codex",
        "--scope",
        "project",
      ]),
      { baseDir: root, runCommand: async () => 0 },
    );

    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "agent-native.json"), "utf-8"),
    );

    expect(result.id).toBe("content");
    expect(result.planMode).toBe("local-files");
    expect(result.mcpUrl).toBe("");
    expect(result.mcpClients).toEqual([]);
    expect(manifest.mode).toBeUndefined();
    expect(manifest.apps.content.mode).toBe("local-files");
  });

  it("accepts design-exploration aliases for the built-in Design skill", async () => {
    const root = tmpDir();

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "agent-native-design-exploration",
        "--client",
        "codex",
        "--scope",
        "project",
      ]),
      { baseDir: root, runCommand: async () => 0 },
    );

    expect(result.id).toBe("design");
    expect(result.skillNames).toEqual(["design-exploration"]);
    const skillDir = path.join(root, ".agents", "skills", "design-exploration");
    expect(result.written).toContain(skillDir);
    expect(fs.existsSync(path.join(skillDir, "SKILL.md"))).toBe(true);
    expect(result.mcpUrl).toBe(
      "https://design.agent-native.com/_agent-native/mcp",
    );
  });

  it("accepts shorthand aliases for the built-in Plans skill", async () => {
    const root = tmpDir();
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    const previousCodexHome = process.env.CODEX_HOME;

    process.env.CODEX_HOME = codexHome;
    try {
      const result = await addAgentNativeSkill(
        parseSkillsArgs([
          "add",
          "plannotate",
          "--client",
          "codex",
          "--scope",
          "project",
        ]),
        { baseDir: root, runCommand: async () => 0 },
      );

      // The `plannotate` alias targets the whole plan bundle, so both skills
      // install. Project-scope codex instructions land in .agents/skills.
      const planSkillDir = path.join(root, ".agents", "skills", "visual-plan");
      const materializedVisualPlan = fs.readFileSync(
        path.join(planSkillDir, "SKILL.md"),
        "utf-8",
      );
      const materializedMetadata = fs.readFileSync(
        path.join(planSkillDir, "agent-native-skill.json"),
        "utf-8",
      );

      expect(result.id).toBe("visual-plans");
      expect(result.skillNames).toEqual(PLANS_SKILL_NAMES);
      expect(result.written).toEqual(
        expect.arrayContaining([
          planSkillDir,
          path.join(root, ".agents", "skills", "visual-recap"),
        ]),
      );
      expect(result.mcpUrl).toBe(
        "https://plan.agent-native.com/_agent-native/mcp",
      );
      expect(fs.existsSync(path.join(codexHome, "config.toml"))).toBe(false);
      expect(result.commands).toContain(
        "npx @agent-native/core@latest connect https://plan.agent-native.com --client codex --scope project",
      );
      expect(materializedVisualPlan).toContain("pass it as `planText`");
      expect(materializedVisualPlan).toContain("contentPatches");
      expect(materializedVisualPlan).not.toContain("data-plan-tabs");
      expect(JSON.parse(materializedMetadata)).toMatchObject({
        source: "agent-native",
        appSkillId: "visual-plans",
        skillName: "visual-plan",
      });
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("reports and refreshes stale project skill folders", async () => {
    const root = tmpDir();
    const skillDir = path.join(root, ".agents", "skills", "visual-recap");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: visual-recap\n---\n\nstale body\n",
      "utf-8",
    );
    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });

    await runSkills(
      ["status", "visual-recap", "--scope", "project", "--json"],
      { baseDir: root },
    );
    const status = JSON.parse(stdout.splice(0).join(""));
    expect(status.found).toBe(1);
    expect(status.stale).toBe(1);
    expect(status.skills[0]).toMatchObject({
      skillName: "visual-recap",
      status: "stale",
      managed: false,
    });

    await runSkills(
      ["update", "visual-recap", "--scope", "project", "--json"],
      { baseDir: root },
    );
    const updated = JSON.parse(stdout.splice(0).join(""));
    expect(updated.updated).toBe(1);
    expect(updated.skills[0]).toMatchObject({
      skillName: "visual-recap",
      status: "current",
      managed: true,
    });
    expect(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf-8")).toContain(
      "create-visual-recap",
    );
    expect(
      fs.readFileSync(
        path.join(skillDir, "references", "wireframe.md"),
        "utf-8",
      ),
    ).toContain("HTML wireframe quality");
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(skillDir, "agent-native-skill.json"),
          "utf-8",
        ),
      ),
    ).toMatchObject({
      source: "agent-native",
      appSkillId: "visual-plans",
      skillName: "visual-recap",
    });

    fs.rmSync(path.join(skillDir, "agent-native-skill.json"));
    await runSkills(
      ["update", "visual-recap", "--scope", "project", "--json"],
      { baseDir: root },
    );
    const repaired = JSON.parse(stdout.splice(0).join(""));
    expect(repaired.updated).toBe(1);
    expect(repaired.skills[0]).toMatchObject({
      skillName: "visual-recap",
      status: "current",
      managed: true,
    });
  });

  it("keeps exported Plans skill copies aligned with template skills", () => {
    const root = workspaceRoot();
    const pairs = [
      ["visual-plan", "visual-plans"],
      ["visual-recap", "visual-recap"],
    ];

    for (const [templateName, exportedName] of pairs) {
      const templateSkill = fs.readFileSync(
        path.join(
          root,
          "templates",
          "plan",
          ".agents",
          "skills",
          templateName,
          "SKILL.md",
        ),
        "utf-8",
      );
      const exportedSkill = fs.readFileSync(
        path.join(root, "skills", exportedName, "SKILL.md"),
        "utf-8",
      );
      expect(exportedSkill).toBe(templateSkill);
    }
  });

  it("installs project-scoped local Context X-Ray artifacts without global agent instructions", async () => {
    const root = tmpDir();
    const home = path.join(root, "home");
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    const previousHome = process.env.HOME;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;

    try {
      const result = await addAgentNativeSkill(
        parseSkillsArgs([
          "add",
          "context-xray",
          "--client",
          "all",
          "--scope",
          "project",
          "--yes",
        ]),
        { baseDir: root },
      );

      expect(result).toMatchObject({
        id: "context-xray",
        local: true,
        mcpUrl: "",
        mcpClients: [],
        skillNames: ["context-xray"],
      });
      expect(
        fs.existsSync(
          path.join(home, ".agent-native", "context-xray", "context-xray"),
        ),
      ).toBe(true);
      expect(
        fs.readFileSync(
          path.join(root, ".agents", "skills", "context-xray", "SKILL.md"),
          "utf-8",
        ),
      ).toContain("name: context-xray");
      expect(
        fs.readFileSync(
          path.join(root, ".agents", "commands", "context-xray.md"),
          "utf-8",
        ),
      ).toContain("Context X-Ray");
      expect(
        fs.existsSync(
          path.join(codexHome, "skills", "context-xray", "SKILL.md"),
        ),
      ).toBe(false);
      expect(
        fs.existsSync(
          path.join(home, ".claude", "commands", "context-xray.md"),
        ),
      ).toBe(false);
      expect(fs.existsSync(path.join(root, ".mcp.json"))).toBe(false);
      expect(fs.existsSync(path.join(codexHome, "config.toml"))).toBe(false);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("keeps user-scoped local Context X-Ray instructions global", async () => {
    const root = tmpDir();
    const home = path.join(root, "home");
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    const previousHome = process.env.HOME;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;

    try {
      await addAgentNativeSkill(
        parseSkillsArgs([
          "add",
          "context-xray",
          "--client",
          "all",
          "--scope",
          "user",
          "--yes",
        ]),
        { baseDir: root },
      );

      expect(
        fs.readFileSync(
          path.join(codexHome, "skills", "context-xray", "SKILL.md"),
          "utf-8",
        ),
      ).toContain("name: context-xray");
      expect(
        fs.readFileSync(
          path.join(home, ".claude", "commands", "context-xray.md"),
          "utf-8",
        ),
      ).toContain("~/.agent-native/context-xray/context-xray --open");
      expect(
        fs.existsSync(
          path.join(root, ".agents", "skills", "context-xray", "SKILL.md"),
        ),
      ).toBe(false);
      expect(
        fs.existsSync(
          path.join(root, ".agents", "commands", "context-xray.md"),
        ),
      ).toBe(false);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("filters generated Context X-Ray Codex analysis to the requested project", async () => {
    const root = tmpDir();
    const home = path.join(root, "home");
    const codexHome = path.join(root, "codex-home");
    const project = path.join(root, "project");
    const otherProject = path.join(root, "other-project");
    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(otherProject, { recursive: true });
    fs.mkdirSync(path.join(codexHome, "sessions", "2026", "06", "02"), {
      recursive: true,
    });
    const previousHome = process.env.HOME;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;

    try {
      const result = await addAgentNativeSkill(
        parseSkillsArgs([
          "add",
          "context-xray",
          "--client",
          "codex",
          "--scope",
          "user",
          "--yes",
        ]),
        { baseDir: root },
      );
      const sessionsDir = path.join(codexHome, "sessions", "2026", "06", "02");
      const projectSessionFile = path.join(sessionsDir, "project.jsonl");
      fs.writeFileSync(
        projectSessionFile,
        `${JSON.stringify({
          type: "session_meta",
          payload: {
            id: "11111111-1111-4111-8111-111111111111",
            cwd: project,
            timestamp: "2026-06-02T12:00:00.000Z",
          },
        })}\n${JSON.stringify({
          type: "response_item",
          payload: { role: "assistant", content: "project session" },
          timestamp: "2026-06-02T12:01:00.000Z",
        })}\n`,
      );
      const baseTime = Date.now() / 1000;
      fs.utimesSync(projectSessionFile, baseTime - 1000, baseTime - 1000);
      for (let i = 0; i < 90; i += 1) {
        const otherSessionFile = path.join(sessionsDir, `other-${i}.jsonl`);
        fs.writeFileSync(
          otherSessionFile,
          `${JSON.stringify({
            type: "session_meta",
            payload: {
              id: `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`,
              cwd: otherProject,
              timestamp: "2026-06-02T13:00:00.000Z",
            },
          })}\n${JSON.stringify({
            type: "response_item",
            payload: { role: "assistant", content: `other session ${i}` },
            timestamp: "2026-06-02T13:01:00.000Z",
          })}\n`,
        );
        fs.utimesSync(otherSessionFile, baseTime + i, baseTime + i);
      }
      const outFile = path.join(root, "context-xray.json");
      const run = spawnSync(
        process.execPath,
        [
          result.scriptPath!,
          "--source",
          "codex",
          "--project",
          project,
          "--format",
          "json",
          "--out",
          outFile,
          "--since",
          "30d",
        ],
        {
          env: {
            ...process.env,
            HOME: home,
            CODEX_HOME: codexHome,
            CLAUDE_CODE_SESSION_ID: "",
          },
          encoding: "utf-8",
        },
      );

      expect(run.status).toBe(0);
      const report = JSON.parse(fs.readFileSync(outFile, "utf-8"));
      expect(report.sessions).toHaveLength(1);
      expect(report.sessions[0].cwd).toBe(project);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("dry-runs the Context X-Ray one-command install", async () => {
    const root = tmpDir();

    const result = await addAgentNativeSkill(
      parseSkillsArgs(["add", "xray", "--client", "codex", "--dry-run"]),
      { baseDir: root },
    );

    expect(result).toMatchObject({
      id: "context-xray",
      local: true,
      commands: [
        "npx @agent-native/core@latest skills add xray --client codex --scope user --yes",
      ],
    });
    expect(fs.existsSync(path.join(root, ".agents"))).toBe(false);
  });

  it("installs built-in Assets instructions and MCP config", async () => {
    const root = tmpDir();
    const commands: { cmd: string; args: string[] }[] = [];

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "assets",
        "--client",
        "claude-code",
        "--scope",
        "project",
      ]),
      {
        baseDir: root,
        runCommand: async (cmd, args) => {
          commands.push({ cmd, args });
          return 0;
        },
      },
    );

    expect(result.skillNames).toEqual(["assets"]);
    // Built-in instructions are written in-process, so nothing shells out to
    // the standalone @agent-native/skills installer.
    expect(commands).toHaveLength(0);
    const skillDir = path.join(root, ".claude", "skills", "assets");
    expect(result.written).toContain(skillDir);
    expect(fs.existsSync(path.join(skillDir, "SKILL.md"))).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"))
        .mcpServers["agent-native-assets"].url,
    ).toBe("https://assets.agent-native.com/_agent-native/mcp");
  });

  it("delegates plain GitHub skill repos to @agent-native/skills", async () => {
    const root = tmpDir();
    const commands: { cmd: string; args: string[]; stdio?: string }[] = [];

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "BuilderIO/skills",
        "--skill",
        "quick-recap",
        "--client",
        "codex",
        "--scope",
        "project",
        "--cwd",
        root,
        "--update-instructions",
        "--with-github-action",
        "--no-connect",
        "--yes",
      ]),
      {
        baseDir: root,
        runCommand: async (cmd, args, options) => {
          commands.push({ cmd, args, stdio: options?.stdio });
          return 0;
        },
      },
    );

    expect(result.id).toBe("BuilderIO/skills");
    expect(result.mcpUrl).toBe("");
    expect(result.local).toBe(true);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ cmd: "npx", stdio: "silent" });
    expect(commands[0].args).toEqual(
      expect.arrayContaining([
        "@agent-native/skills@latest",
        "add",
        "--copy",
        "BuilderIO/skills",
        "--skill",
        "quick-recap",
        "--client",
        "codex",
        "--scope",
        "project",
        "--update-instructions",
        "--with-github-action",
        "--no-connect",
        "--yes",
      ]),
    );
  });

  it("prompts for target clients in interactive installs when --client is omitted", async () => {
    const root = tmpDir();
    const home = path.join(root, "home");
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    const previousHome = process.env.HOME;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    const stdout: string[] = [];
    const commands: { cmd: string; args: string[]; stdio?: string }[] = [];
    const promptClients = vi.fn(async () => [
      "codex" as const,
      "claude-code" as const,
    ]);
    const runConnect = vi.fn(async () => {});
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });

    try {
      await runSkills(["add", "assets"], {
        baseDir: root,
        isInteractive: () => true,
        promptClients,
        promptScope: async () => "user",
        runConnect,
        runCommand: async (cmd, args, options) => {
          commands.push({ cmd, args, stdio: options?.stdio });
          return 0;
        },
      });

      expect(promptClients).toHaveBeenCalledTimes(1);
      expect(promptClients.mock.calls[0]?.[0].initialClients).toEqual([
        "claude-code",
        "codex",
        "cowork",
        "cursor",
        "opencode",
        "github-copilot",
      ]);
      expect(
        promptClients.mock.calls[0]?.[0].options.map((o) => o.value),
      ).toEqual([
        "claude-code",
        "codex",
        "cowork",
        "cursor",
        "opencode",
        "github-copilot",
      ]);
      expect(promptClients.mock.calls[0]?.[0].installsMcp).toBe(true);
      // Built-in instructions are written in-process for each selected client.
      expect(
        fs.existsSync(path.join(codexHome, "skills", "assets", "SKILL.md")),
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(home, ".claude", "skills", "assets", "SKILL.md"),
        ),
      ).toBe(true);
      expect(fs.existsSync(path.join(codexHome, "config.toml"))).toBe(false);
      expect(
        JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf-8"))
          .mcpServers["agent-native-assets"].url,
      ).toBe("https://assets.agent-native.com/_agent-native/mcp");
      // Install also authenticates the hosted connector in one step.
      expect(runConnect).toHaveBeenCalledTimes(1);
      expect(runConnect.mock.calls[0][0]).toEqual(
        expect.arrayContaining([
          "https://assets.agent-native.com",
          "--client",
          "codex,claude-code",
        ]),
      );
      expect(stdout.join("")).toContain("MCP config");
      expect(stdout.join("")).toContain("Codex, Claude Code");
      expect(stdout.join("")).toContain("Authentication");
      expect(stdout.join("")).toContain("completed");
      expect(stdout.join("")).toContain("Add another client later");
      // Final "all done" outro + slash-command guidance.
      expect(stdout.join("")).toContain("All set!");
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("skips the client prompt when --client is explicit", async () => {
    const root = tmpDir();
    const promptClients = vi.fn(async () => ["codex" as const]);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkills(
      ["add", "assets", "--client", "claude-code", "--scope", "project"],
      {
        baseDir: root,
        isInteractive: () => true,
        promptClients,
        runConnect: async () => {},
        runCommand: async () => 0,
      },
    );

    expect(promptClients).not.toHaveBeenCalled();
  });

  it("offers the PR Visual Recap workflow during interactive Plans installs", async () => {
    const root = tmpDir();
    const stdout: string[] = [];
    const promptGithubAction = vi.fn(async () => true);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });

    await runSkills(
      [
        "add",
        "visual-recap",
        "--client",
        "codex",
        "--scope",
        "project",
        "--no-connect",
      ],
      {
        baseDir: root,
        isInteractive: () => true,
        promptPlanMode: async () => "hosted",
        promptGithubAction,
        runCommand: async () => 0,
      },
    );

    expect(promptGithubAction).toHaveBeenCalledTimes(1);
    expect(promptGithubAction.mock.calls[0]?.[0]).toMatchObject({
      docsUrl: "https://www.agent-native.com/docs/pr-visual-recap",
    });
    const workflow = path.join(
      root,
      ".github",
      "workflows",
      "pr-visual-recap.yml",
    );
    expect(fs.existsSync(workflow)).toBe(true);
    expect(fs.readFileSync(workflow, "utf-8")).toContain("PR Visual Recap");
    expect(stdout.join("")).toContain("PR Visual Recap workflow: wrote");
    expect(stdout.join("")).toContain(
      "npx @agent-native/core@latest recap setup",
    );
  });

  it("prints a later command when the optional recap workflow prompt is declined", async () => {
    const root = tmpDir();
    const stdout: string[] = [];
    const promptGithubAction = vi.fn(async () => false);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });

    await runSkills(
      [
        "add",
        "visual-recap",
        "--client",
        "codex",
        "--scope",
        "project",
        "--no-connect",
      ],
      {
        baseDir: root,
        isInteractive: () => true,
        promptPlanMode: async () => "hosted",
        promptGithubAction,
        runCommand: async () => 0,
      },
    );

    expect(promptGithubAction).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(root, ".github"))).toBe(false);
    expect(stdout.join("")).toContain(
      "npx @agent-native/core@latest skills add visual-recap --with-github-action",
    );
  });

  it("skips the optional recap workflow prompt when the flag is explicit", async () => {
    const root = tmpDir();
    const promptGithubAction = vi.fn(async () => false);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkills(
      [
        "add",
        "visual-recap",
        "--client",
        "codex",
        "--scope",
        "project",
        "--no-connect",
        "--with-github-action",
      ],
      {
        baseDir: root,
        isInteractive: () => true,
        promptPlanMode: async () => "hosted",
        promptGithubAction,
        runCommand: async () => 0,
      },
    );

    expect(promptGithubAction).not.toHaveBeenCalled();
    expect(
      fs.existsSync(
        path.join(root, ".github", "workflows", "pr-visual-recap.yml"),
      ),
    ).toBe(true);
  });

  it("prompts for skills when interactive add has no target", async () => {
    const root = tmpDir();
    const home = path.join(root, "home");
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    const previousHome = process.env.HOME;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    const promptSkills = vi.fn(async () => ["assets", "design-exploration"]);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await runSkills(["add"], {
        baseDir: root,
        isInteractive: () => true,
        promptClients: async () => ["codex"],
        promptSkills,
        promptScope: async () => "user",
        runConnect: async () => {},
        runCommand: async () => 0,
      });

      expect(promptSkills).toHaveBeenCalledTimes(1);
      // Each selected built-in skill is written in-process into the user-scope
      // codex skills directory.
      expect(
        fs.existsSync(path.join(codexHome, "skills", "assets", "SKILL.md")),
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(codexHome, "skills", "design-exploration", "SKILL.md"),
        ),
      ).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("offers all Agent Native skills while defaulting the two plan skills", async () => {
    const root = tmpDir();
    let context:
      | { initialTargets: string[]; options: { value: string }[] }
      | undefined;
    const promptSkills = vi.fn(async (ctx: typeof context) => {
      context = ctx;
      return ctx!.initialTargets;
    });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkills(["add", "--client", "codex", "--scope", "project"], {
      baseDir: root,
      isInteractive: () => true,
      promptSkills,
      promptPlanMode: async () => "hosted",
      promptGithubAction: async () => false,
      runConnect: async () => {},
      runCommand: async () => 0,
    });

    expect(promptSkills).toHaveBeenCalledTimes(1);
    expect(context?.options.map((o) => o.value)).toEqual([
      "visual-plan",
      "visual-recap",
      "assets",
      "content",
      "design-exploration",
      "context-xray",
    ]);
    expect(context?.initialTargets).toEqual(["visual-plan", "visual-recap"]);
    // Both selected installs the whole plan bundle (one shared MCP connector).
    expect(
      fs.existsSync(
        path.join(root, ".agents", "skills", "visual-plan", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(root, ".agents", "commands", "visual-plan.md")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(root, ".agents", "skills", "visual-recap", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(root, ".agents", "commands", "visual-recap.md")),
    ).toBe(true);
  });

  it("appends public skills only when the shared flow runs in all-catalog mode", async () => {
    const root = tmpDir();
    let coreContext:
      | { initialTargets: string[]; options: { value: string }[] }
      | undefined;
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkills(["add", "--client", "codex", "--scope", "project"], {
      baseDir: root,
      isInteractive: () => true,
      promptSkills: async (ctx: typeof coreContext) => {
        coreContext = ctx;
        return ["visual-plan"];
      },
      promptPlanMode: async () => "local-files",
      promptGithubAction: async () => false,
      runConnect: async () => {},
      runCommand: async () => 0,
    });

    expect(coreContext?.options.map((option) => option.value)).not.toContain(
      "quick-recap",
    );

    let allContext:
      | { initialTargets: string[]; options: { value: string }[] }
      | undefined;
    await runSkills(["add", "--client", "codex", "--scope", "project"], {
      baseDir: root,
      catalogMode: "all",
      publicSkillSource: "BuilderIO/skills",
      publicSkillEntries: [
        {
          name: "quick-recap",
          description: "Use final response status blocks.",
        },
      ],
      isInteractive: () => true,
      promptSkills: async (ctx: typeof allContext) => {
        allContext = ctx;
        return ["quick-recap"];
      },
      promptUpdateInstructions: async () => false,
      runCommand: async () => 0,
    });

    expect(allContext?.options.map((option) => option.value)).toEqual([
      "visual-plan",
      "visual-recap",
      "assets",
      "content",
      "design-exploration",
      "context-xray",
      "quick-recap",
    ]);
    expect(allContext?.initialTargets).toEqual(["visual-plan", "visual-recap"]);
  });

  it("asks for plan mode before clients and skips MCP for local-files", async () => {
    const root = tmpDir();
    const calls: string[] = [];
    const runConnect = vi.fn(async () => {});
    const promptClients = vi.fn(
      async (context: {
        installsMcp: boolean;
        options: Array<{ value: string }>;
      }) => {
        calls.push(`clients:${context.installsMcp}`);
        return ["codex" as const];
      },
    );
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkills(["add"], {
      baseDir: root,
      isInteractive: () => true,
      promptSkills: async () => {
        calls.push("skills");
        return ["visual-plan", "visual-recap"];
      },
      promptPlanMode: async () => {
        calls.push("plan-mode");
        return "local-files";
      },
      promptClients,
      promptScope: async () => {
        calls.push("scope");
        return "project";
      },
      promptGithubAction: async () => {
        calls.push("github-action");
        return false;
      },
      runConnect,
      runCommand: async () => 0,
    });

    expect(calls).toEqual([
      "skills",
      "plan-mode",
      "clients:false",
      "scope",
      "github-action",
    ]);
    expect(runConnect).not.toHaveBeenCalled();
    expect(
      promptClients.mock.calls[0]?.[0].options.map((o) => o.value),
    ).toEqual(["codex", "claude-code"]);
    expect(fs.existsSync(path.join(root, ".codex", "config.toml"))).toBe(false);
    expect(
      fs.existsSync(
        path.join(root, ".agents", "skills", "visual-plan", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(root, ".agents", "skills", "visual-recap", "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("runs public skills through the same prompt flow before delegating the copy", async () => {
    const root = tmpDir();
    const calls: string[] = [];
    const commands: {
      cmd: string;
      args: string[];
      options?: { stdio?: string };
    }[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkills(["add"], {
      baseDir: root,
      catalogMode: "all",
      publicSkillSource: "BuilderIO/skills",
      publicSkillEntries: [
        {
          name: "quick-recap",
          description: "Use final response status blocks.",
        },
      ],
      isInteractive: () => true,
      promptSkills: async () => {
        calls.push("skills");
        return ["quick-recap"];
      },
      promptClients: async () => {
        calls.push("clients");
        return ["codex"];
      },
      promptScope: async () => {
        calls.push("scope");
        return "project";
      },
      promptUpdateInstructions: async () => {
        calls.push("instructions");
        return true;
      },
      runCommand: async (cmd, args, options) => {
        commands.push({ cmd, args, options });
        return 0;
      },
    });

    expect(calls).toEqual(["skills", "clients", "scope", "instructions"]);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ cmd: "npx" });
    expect(commands[0].args).toEqual(
      expect.arrayContaining([
        "@agent-native/skills@latest",
        "add",
        "--quiet",
        "--copy",
        "BuilderIO/skills",
        "--skill",
        "quick-recap",
        "--client",
        "codex",
        "--scope",
        "project",
        "--cwd",
        root,
        "--update-instructions",
      ]),
    );
    expect(commands[0].options).toMatchObject({ stdio: "silent" });
  });

  it("does not forward MCP-only Cowork to public skill copy installs", async () => {
    const root = tmpDir();
    const commands: { cmd: string; args: string[] }[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkills(["add", "--no-connect"], {
      baseDir: root,
      catalogMode: "all",
      publicSkillSource: "BuilderIO/skills",
      publicSkillEntries: [
        {
          name: "quick-recap",
          description: "Use final response status blocks.",
        },
      ],
      isInteractive: () => true,
      promptSkills: async () => ["visual-plan", "visual-recap", "quick-recap"],
      promptPlanMode: async () => "hosted",
      promptClients: async () => ["codex", "cowork"],
      promptScope: async () => "project",
      promptGithubAction: async () => false,
      promptUpdateInstructions: async () => false,
      runCommand: async (cmd, args) => {
        commands.push({ cmd, args });
        return 0;
      },
    });

    const publicCopy = commands.find((command) =>
      command.args.includes("@agent-native/skills@latest"),
    );
    expect(publicCopy?.args).toEqual(
      expect.arrayContaining([
        "@agent-native/skills@latest",
        "add",
        "--copy",
        "BuilderIO/skills",
        "--skill",
        "quick-recap",
        "--client",
        "codex",
      ]),
    );
    expect(publicCopy?.args).not.toContain("codex,cowork");
  });

  it("does not forward local plan mode to non-plan public skill copies", async () => {
    const root = tmpDir();
    const commands: { cmd: string; args: string[] }[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkills(["add"], {
      baseDir: root,
      catalogMode: "all",
      publicSkillSource: "BuilderIO/skills",
      publicSkillEntries: [
        {
          name: "efficient-frontier",
          description: "Use efficient frontier for coding-agent budgets.",
        },
      ],
      isInteractive: () => true,
      promptSkills: async () => [
        "visual-plan",
        "visual-recap",
        "efficient-frontier",
      ],
      promptPlanMode: async () => "local-files",
      promptClients: async () => ["codex"],
      promptScope: async () => "project",
      promptGithubAction: async () => false,
      promptUpdateInstructions: async () => false,
      runCommand: async (cmd, args) => {
        commands.push({ cmd, args });
        return 0;
      },
    });

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ cmd: "npx" });
    expect(commands[0].args).toEqual(
      expect.arrayContaining([
        "@agent-native/skills@latest",
        "add",
        "--copy",
        "BuilderIO/skills",
        "--skill",
        "efficient-frontier",
        "--client",
        "codex",
        "--scope",
        "project",
        "--cwd",
        root,
        "--no-update-instructions",
      ]),
    );
    expect(commands[0].args).not.toContain("--mode");
    expect(commands[0].args).not.toContain("local-files");
  });

  it("installs only visual-recap when only it is selected", async () => {
    const root = tmpDir();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkills(["add", "--client", "codex", "--scope", "project"], {
      baseDir: root,
      isInteractive: () => true,
      promptSkills: async () => ["visual-recap"],
      promptPlanMode: async () => "hosted",
      promptGithubAction: async () => false,
      runConnect: async () => {},
      runCommand: async () => 0,
    });

    expect(
      fs.existsSync(
        path.join(root, ".agents", "skills", "visual-recap", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(root, ".agents", "commands", "visual-recap.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(root, ".agents", "skills", "visual-plan")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(root, ".agents", "commands", "visual-plan.md")),
    ).toBe(false);
  });

  it("writes user-scope Codex slash commands for visual plan skills", async () => {
    const root = tmpDir();
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await runSkills(
        [
          "add",
          "visual-plan",
          "--client",
          "codex",
          "--scope",
          "user",
          "--mode",
          "local-files",
          "--yes",
        ],
        { baseDir: root },
      );

      expect(
        fs.existsSync(
          path.join(codexHome, "skills", "visual-plan", "SKILL.md"),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(codexHome, "commands", "visual-plan.md")),
      ).toBe(true);
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("writes Pi skills to .agents and Pi prompt templates for local plan skills", async () => {
    const root = tmpDir();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkills(
      [
        "add",
        "visual-plan",
        "--client",
        "pi",
        "--scope",
        "project",
        "--mode",
        "local-files",
        "--yes",
      ],
      { baseDir: root },
    );

    expect(
      fs.existsSync(
        path.join(root, ".agents", "skills", "visual-plan", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(root, ".pi", "prompts", "visual-plan.md")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(root, ".pi", "skills", "visual-plan", "SKILL.md"),
      ),
    ).toBe(false);
  });

  it("prompts for install scope when --scope is omitted", async () => {
    const root = tmpDir();
    const promptScope = vi.fn(async () => "project" as const);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkills(["add", "visual-recap", "--client", "codex"], {
      baseDir: root,
      isInteractive: () => true,
      promptPlanMode: async () => "hosted",
      promptScope,
      promptGithubAction: async () => false,
      runConnect: async () => {},
      runCommand: async () => 0,
    });

    expect(promptScope).toHaveBeenCalledTimes(1);
    expect(promptScope.mock.calls[0][0]).toMatchObject({
      initialScope: "project",
    });
    // The chosen project scope routes instructions into .agents/skills.
    expect(
      fs.existsSync(
        path.join(root, ".agents", "skills", "visual-recap", "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("does not prompt for scope when --scope is explicit", async () => {
    const root = tmpDir();
    const promptScope = vi.fn(async () => "user" as const);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkills(
      ["add", "visual-recap", "--client", "codex", "--scope", "project"],
      {
        baseDir: root,
        isInteractive: () => true,
        promptPlanMode: async () => "hosted",
        promptScope,
        promptGithubAction: async () => false,
        runConnect: async () => {},
        runCommand: async () => 0,
      },
    );

    expect(promptScope).not.toHaveBeenCalled();
  });

  it("supports dry-run without writing local agent config", async () => {
    const root = tmpDir();

    const result = await addAgentNativeSkill(
      parseSkillsArgs(["add", "assets", "--scope", "project", "--dry-run"]),
      { baseDir: root },
    );

    expect(result.commands).toEqual([
      "npx @agent-native/core@latest skills add assets --client claude-code,codex,cowork,cursor,opencode,github-copilot --scope project --yes",
    ]);
    expect(result.commands.join("\n")).not.toContain(os.tmpdir());
    expect(fs.existsSync(path.join(root, ".mcp.json"))).toBe(false);
  });

  it("dry-runs the visual recap workflow install honestly", async () => {
    const root = tmpDir();

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "visual-recap",
        "--scope",
        "project",
        "--dry-run",
        "--with-github-action",
      ]),
      { baseDir: root },
    );

    expect(result.commands).toEqual([
      "npx @agent-native/core@latest skills add visual-recap --client claude-code,codex,cowork,cursor,opencode,github-copilot --scope project --with-github-action --yes",
    ]);
    expect(result.githubActionPath).toBe(
      path.join(".github", "workflows", "pr-visual-recap.yml"),
    );
    expect(fs.existsSync(path.join(root, ".github"))).toBe(false);
  });

  it("reports installed skill status without running the add flow", async () => {
    const root = tmpDir();
    const skillDir = path.join(root, ".agents", "skills", "visual-plan");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "old visual plan\n");
    fs.writeFileSync(
      path.join(skillDir, AGENT_NATIVE_SKILL_METADATA_FILE),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          source: "agent-native",
          appSkillId: "visual-plans",
          displayName: "Agent-Native Plans",
          skillName: "visual-plan",
          contentHash: "old",
          mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
          installedAt: "2026-01-01T00:00:00.000Z",
          updateCommand:
            "npx @agent-native/core@latest skills update visual-plan",
        },
        null,
        2,
      )}\n`,
    );
    const stdout: string[] = [];
    const runCommand = vi.fn(async () => 0);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });

    await runSkills(
      [
        "status",
        "visual-plan",
        "--client",
        "codex",
        "--scope",
        "project",
        "--json",
      ],
      { baseDir: root, runCommand },
    );

    expect(runCommand).not.toHaveBeenCalled();
    const json = JSON.parse(stdout.join(""));
    expect(json).toMatchObject({ command: "status", found: 1, stale: 1 });
    expect(json.skills[0]).toMatchObject({
      skillName: "visual-plan",
      status: "stale",
      managed: true,
    });
  });

  it("updates managed copied skill folders in place", async () => {
    const root = tmpDir();
    const skillDir = path.join(root, ".agents", "skills", "visual-plan");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "old visual plan\n");
    fs.writeFileSync(
      path.join(skillDir, AGENT_NATIVE_SKILL_METADATA_FILE),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          source: "agent-native",
          appSkillId: "visual-plans",
          displayName: "Agent-Native Plans",
          skillName: "visual-plan",
          contentHash: "old",
          mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
          installedAt: "2026-01-01T00:00:00.000Z",
          updateCommand:
            "npx @agent-native/core@latest skills update visual-plan",
        },
        null,
        2,
      )}\n`,
    );
    const stdout: string[] = [];
    const runCommand = vi.fn(async () => 0);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });

    await runSkills(
      ["update", "visual-plan", "--client", "codex", "--scope", "project"],
      { baseDir: root, runCommand },
    );

    expect(runCommand).not.toHaveBeenCalled();
    expect(stdout.join("")).toContain("Updated 1 skill folder");
    expect(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf-8")).toContain(
      "# Agent-Native Plans",
    );
    expect(
      fs.existsSync(path.join(skillDir, "references", "wireframe.md")),
    ).toBe(true);
    const metadata = JSON.parse(
      fs.readFileSync(
        path.join(skillDir, AGENT_NATIVE_SKILL_METADATA_FILE),
        "utf-8",
      ),
    );
    expect(metadata.contentHash).not.toBe("old");
  });

  it("updates generated workspace scaffold skills and repairs agent symlinks", async () => {
    const root = tmpDir();
    const shared = path.join(root, "packages", "shared");
    fs.mkdirSync(path.join(shared, ".agents", "skills", "actions"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(root, "apps"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify(
        {
          name: "my-workspace",
          "agent-native": { workspaceCore: "@my/shared" },
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Workspace\n");
    fs.writeFileSync(
      path.join(shared, "package.json"),
      JSON.stringify({ name: "@my/shared" }, null, 2),
    );
    fs.writeFileSync(path.join(shared, "AGENTS.md"), "# Shared\n");
    fs.writeFileSync(
      path.join(shared, ".agents", "skills", "actions", "SKILL.md"),
      "old actions skill\n",
    );
    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });

    await runSkills(["update", "scaffold", "--scope", "project", "--json"], {
      baseDir: root,
      runCommand: async () => 0,
    });

    const json = JSON.parse(stdout.join(""));
    expect(json).toMatchObject({ command: "update", found: 1, updated: 1 });
    expect(json.scaffold[0]).toMatchObject({
      kind: "workspace-core",
      status: "current",
    });
    expect(
      fs.readFileSync(
        path.join(shared, ".agents", "skills", "actions", "SKILL.md"),
        "utf-8",
      ),
    ).toContain("# Agent Actions");
    expect(
      fs.existsSync(
        path.join(root, ".agents", "skills", "actions", "SKILL.md"),
      ),
    ).toBe(true);
    const claudePath = path.join(root, "CLAUDE.md");
    expect(fs.existsSync(claudePath)).toBe(true);
    if (fs.lstatSync(claudePath).isSymbolicLink()) {
      expect(fs.readlinkSync(claudePath)).toBe("AGENTS.md");
    }
    expect(fs.existsSync(path.join(root, ".claude", "skills"))).toBe(true);
  });

  it("updates generated standalone headless scaffold skills", async () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, "actions"), { recursive: true });
    fs.mkdirSync(path.join(root, ".agents", "skills", "agent-native-docs"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify(
        {
          name: "headless-app",
          dependencies: { "@agent-native/core": "latest" },
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Headless\n");
    fs.writeFileSync(path.join(root, "actions", "hello.ts"), "export {}\n");
    fs.writeFileSync(
      path.join(root, ".agents", "skills", "agent-native-docs", "SKILL.md"),
      "old docs skill\n",
    );

    await runSkills(["update", "scaffold", "--scope", "project"], {
      baseDir: root,
      runCommand: async () => 0,
    });

    expect(
      fs.readFileSync(
        path.join(root, ".agents", "skills", "agent-native-docs", "SKILL.md"),
        "utf-8",
      ),
    ).toContain("# Agent Native Docs");
    expect(fs.existsSync(path.join(root, "CLAUDE.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".claude", "skills"))).toBe(true);
  });

  it("registers the skill against a --mcp-url override (bare origin gets the mcp path)", async () => {
    const root = tmpDir();

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "assets",
        "--client",
        "claude-code",
        "--scope",
        "project",
        "--mcp-url",
        "https://archer.ngrok-free.dev",
      ]),
      { baseDir: root, runCommand: async () => 0 },
    );

    expect(result.mcpUrl).toBe(
      "https://archer.ngrok-free.dev/_agent-native/mcp",
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"))
        .mcpServers["agent-native-assets"].url,
    ).toBe("https://archer.ngrok-free.dev/_agent-native/mcp");
  });

  it("accepts a full --mcp-url and surfaces it in dry-run", async () => {
    const root = tmpDir();

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "design-exploration",
        "--scope",
        "project",
        "--mcp-url",
        "http://localhost:8092/_agent-native/mcp",
        "--dry-run",
      ]),
      { baseDir: root },
    );

    expect(result.mcpUrl).toBe("http://localhost:8092/_agent-native/mcp");
    expect(result.commands[0]).toContain(
      "--mcp-url http://localhost:8092/_agent-native/mcp",
    );
  });

  it("rejects an invalid --mcp-url", async () => {
    await expect(
      addAgentNativeSkill(
        parseSkillsArgs(["add", "assets", "--mcp-url", "not-a-url"]),
        { baseDir: tmpDir(), runCommand: async () => 0 },
      ),
    ).rejects.toThrow(/must be a valid URL/);
  });

  it("does not write hosted Codex MCP config without connect auth", async () => {
    const root = tmpDir();
    const home = path.join(root, "home");
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    const previousHome = process.env.HOME;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    try {
      const result = await addAgentNativeSkill(
        parseSkillsArgs([
          "add",
          "assets",
          "--client",
          "codex",
          "--scope",
          "user",
          "--mcp-only",
          "--yes",
        ]),
        { baseDir: root },
      );

      const codexConfig = path.join(codexHome, "config.toml");
      expect(fs.existsSync(codexConfig)).toBe(false);
      expect(result.commands).toContain(
        "npx @agent-native/core@latest connect https://assets.agent-native.com --client codex --scope user",
      );
      expect(fs.existsSync(path.join(home, ".codex", "config.toml"))).toBe(
        false,
      );
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("preserves app base paths in --mcp-url overrides", async () => {
    const root = tmpDir();

    const result = await addAgentNativeSkill(
      parseSkillsArgs([
        "add",
        "assets",
        "--client",
        "claude-code",
        "--scope",
        "project",
        "--mcp-url",
        "https://self-hosted.example.com/mail",
      ]),
      { baseDir: root, runCommand: async () => 0 },
    );

    expect(result.mcpUrl).toBe(
      "https://self-hosted.example.com/mail/_agent-native/mcp",
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"))
        .mcpServers["agent-native-assets"].url,
    ).toBe("https://self-hosted.example.com/mail/_agent-native/mcp");
  });

  it("keeps --json output machine-readable for MCP-only installs", async () => {
    const root = tmpDir();
    const home = path.join(root, "home");
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    const previousHome = process.env.HOME;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });

    try {
      await runSkills(
        [
          "add",
          "assets",
          "--client",
          "codex",
          "--scope",
          "user",
          "--mcp-only",
          "--yes",
          "--json",
        ],
        { baseDir: root },
      );

      const result = JSON.parse(stdout.join(""));
      expect(result.id).toBe("assets");
      expect(result.mcpUrl).toBe(
        "https://assets.agent-native.com/_agent-native/mcp",
      );
      expect(stderr.join("")).toBe("");
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });

  it("keeps full --json installs clean and aligns user scope for skills", async () => {
    const root = tmpDir();
    const home = path.join(root, "home");
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    const previousHome = process.env.HOME;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    const stdout: string[] = [];
    const stderr: string[] = [];
    const commands: { cmd: string; args: string[]; stdio?: string }[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });

    try {
      await runSkills(
        [
          "add",
          "images",
          "--client",
          "codex",
          "--scope",
          "user",
          "--yes",
          "--json",
        ],
        {
          baseDir: root,
          runCommand: async (cmd, args, options) => {
            commands.push({ cmd, args, stdio: options?.stdio });
            return 0;
          },
        },
      );

      const result = JSON.parse(stdout.join(""));
      expect(result.id).toBe("assets");
      // User scope writes the built-in instructions into the codex home skills
      // dir in-process (no npx -g shell-out).
      expect(
        fs.existsSync(path.join(codexHome, "skills", "assets", "SKILL.md")),
      ).toBe(true);
      expect(result.written).toContain(
        path.join(codexHome, "skills", "assets"),
      );
      expect(stderr.join("")).toBe("");
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });
});
