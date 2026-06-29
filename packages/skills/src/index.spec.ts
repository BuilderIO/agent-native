import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runSkills as runCoreSkills } from "@agent-native/core/cli/skills";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installSkills,
  parseSkillsCliArgs,
  runSkillsCli,
  type SkillsPromptContext,
} from "./index.js";

vi.mock("@agent-native/core/cli/skills", () => ({
  runSkills: vi.fn(async () => {}),
}));

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function tmpDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-skills-pkg-"));
  tmpRoots.push(root);
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

function writeSkill(repo: string, name: string, body = "Body"): void {
  const dir = path.join(repo, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Use when testing ${name}.\n---\n\n# ${name}\n\n${body}\n`,
    "utf-8",
  );
}

function enableDirectSkillsMode(): () => void {
  const previousDirect = process.env.AGENT_NATIVE_SKILLS_DIRECT;
  process.env.AGENT_NATIVE_SKILLS_DIRECT = "1";
  return () => {
    if (previousDirect === undefined)
      delete process.env.AGENT_NATIVE_SKILLS_DIRECT;
    else process.env.AGENT_NATIVE_SKILLS_DIRECT = previousDirect;
  };
}

describe("@agent-native/skills", () => {
  it("declares core as a runtime dependency for npx installs", () => {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(workspaceRoot(), "packages", "skills", "package.json"),
        "utf-8",
      ),
    );

    expect(pkg.dependencies["@agent-native/core"]).toBe("workspace:*");
    expect(pkg.peerDependencies?.["@agent-native/core"]).toBeUndefined();
  });

  it("parses the no-source BuilderIO skills install command", () => {
    const parsed = parseSkillsCliArgs([
      "add",
      "--skill",
      "quick-recap",
      "--client",
      "codex,cowork",
      "--scope",
      "project",
      "--update-instructions",
    ]);

    expect(parsed.source).toBeUndefined();
    expect(parsed).toMatchObject({
      command: "add",
      skillNames: ["quick-recap"],
      clients: ["codex", "cowork"],
      scope: "project",
      updateInstructions: true,
    });
  });

  it("parses scaffold update commands for generated workspaces", () => {
    expect(
      parseSkillsCliArgs(["update", "scaffold", "--project"]),
    ).toMatchObject({
      command: "update",
      source: "scaffold",
      scope: "project",
      scopeExplicit: true,
    });
  });

  it("rejects public source arguments outside the BuilderIO skills collection", () => {
    expect(() => parseSkillsCliArgs(["add", "someone/else"])).toThrow(
      "installs the BuilderIO skills collection",
    );
  });

  it("parses compatibility flags used by agent-native core", () => {
    expect(
      parseSkillsCliArgs([
        "add",
        "--copy",
        "./repo",
        "--skill",
        "quick-recap",
        "-a",
        "codex",
        "-g",
        "-y",
        "--no-connect",
      ]),
    ).toMatchObject({
      command: "add",
      copySource: true,
      source: "./repo",
      skillNames: ["quick-recap"],
      clients: ["codex"],
      scope: "user",
      yes: true,
      connect: false,
    });
  });

  it("parses Plan mode flags", () => {
    expect(
      parseSkillsCliArgs([
        "add",
        "--skill",
        "visual-plan",
        "--mode",
        "self-hosted",
        "--mcp-url",
        "https://plans.example.com",
      ]),
    ).toMatchObject({
      skillNames: ["visual-plan"],
      planMode: "self-hosted",
      mcpUrl: "https://plans.example.com",
    });

    expect(() =>
      parseSkillsCliArgs([
        "add",
        "--skill",
        "visual-plan",
        "--mode",
        "local-files",
        "--mcp-url",
        "https://plans.example.com",
      ]),
    ).toThrow("--mcp-url can only be used with --mode self-hosted");
  });

  it("copies selected local skills into project client folders", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "quick-recap");
    writeSkill(repo, "efficient-frontier");

    const result = await installSkills({
      source: repo,
      skillNames: ["quick-recap"],
      clients: ["codex", "claude-code"],
      scope: "project",
      baseDir: project,
      updateInstructions: false,
      yes: true,
    });

    expect(result.skills).toEqual(["quick-recap"]);
    expect(
      fs.existsSync(
        path.join(project, ".agents", "skills", "quick-recap", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(project, ".claude", "skills", "quick-recap", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(project, ".agents", "skills", "efficient-frontier"),
      ),
    ).toBe(false);
  });

  it("forwards scaffold update commands through the shared core flow", async () => {
    await runSkillsCli(["update", "scaffold", "--project"], {
      isInteractive: () => false,
    });

    expect(runCoreSkills).toHaveBeenCalledWith(
      ["update", "scaffold", "--scope", "project"],
      expect.objectContaining({ catalogMode: "all" }),
    );
  });

  it("installs every plain source skill directly when no skill is explicit", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "quick-recap");
    writeSkill(repo, "efficient-fable");
    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    const restoreDirect = enableDirectSkillsMode();

    try {
      await runSkillsCli(
        [
          "add",
          "--copy",
          repo,
          "--client",
          "codex",
          "--scope",
          "project",
          "--yes",
          "--json",
        ],
        { baseDir: project, isInteractive: () => false },
      );
    } finally {
      restoreDirect();
    }

    expect(runCoreSkills).not.toHaveBeenCalled();
    const result = JSON.parse(stdout.join(""));
    expect(result.skills).toEqual(["efficient-fable", "quick-recap"]);
    expect(
      fs.existsSync(
        path.join(project, ".agents", "skills", "efficient-fable", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(project, ".agents", "skills", "quick-recap", "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("lists plain source skills directly instead of delegating to core", async () => {
    const repo = tmpDir();
    writeSkill(repo, "quick-recap");
    writeSkill(repo, "efficient-fable");
    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    const restoreDirect = enableDirectSkillsMode();

    try {
      await runSkillsCli(["list", "--copy", repo, "--json"], {
        isInteractive: () => false,
      });
    } finally {
      restoreDirect();
    }

    expect(runCoreSkills).not.toHaveBeenCalled();
    const skills = JSON.parse(stdout.join(""));
    expect(skills.map((skill: { name: string }) => skill.name)).toEqual([
      "efficient-fable",
      "quick-recap",
    ]);
  });

  it("delegates normal copied-source installs to core with the public catalog", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "quick-recap");
    writeSkill(repo, "efficient-fable");
    let skillContext: SkillsPromptContext | undefined;
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await runSkillsCli(["add", "--copy", repo], {
      baseDir: project,
      isInteractive: () => true,
      promptSkills: async (context) => {
        skillContext = context;
        return ["quick-recap"];
      },
      promptClients: async () => ["codex"],
      promptScope: async () => "project",
      promptUpdateInstructions: async () => false,
    });

    expect(runCoreSkills).toHaveBeenCalledTimes(1);
    const [argv, options] = vi.mocked(runCoreSkills).mock.calls[0];
    expect(argv).toEqual(["add"]);
    expect(options).toMatchObject({
      baseDir: project,
      catalogMode: "all",
      hiddenBuiltInSkillTargets: [
        "assets",
        "content",
        "design-exploration",
        "visual-edit",
        "context-xray",
      ],
      publicSkillSource: repo,
      publicSkillEntries: [
        {
          name: "efficient-fable",
          description: "Use when testing efficient-fable.",
        },
        {
          name: "quick-recap",
          description: "Use when testing quick-recap.",
        },
      ],
    });

    const selected = await (options as any).promptSkills({
      initialTargets: ["visual-plan", "visual-recap"],
      options: [{ value: "quick-recap", label: "quick-recap", hint: "Recap" }],
    });
    expect(selected).toEqual(["quick-recap"]);
    expect(skillContext).toMatchObject({
      initialSkills: ["visual-plan", "visual-recap"],
      options: [{ value: "quick-recap" }],
    });
  });

  it("prints startup progress before interactive delegated installs", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "quick-recap");
    const stderr: string[] = [];
    const previousDirect = process.env.AGENT_NATIVE_SKILLS_DIRECT;
    delete process.env.AGENT_NATIVE_SKILLS_DIRECT;
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });

    try {
      await runSkillsCli(["add", "--copy", repo], {
        baseDir: project,
        isInteractive: () => true,
      });
    } finally {
      if (previousDirect === undefined)
        delete process.env.AGENT_NATIVE_SKILLS_DIRECT;
      else process.env.AGENT_NATIVE_SKILLS_DIRECT = previousDirect;
    }

    expect(stderr.join("")).toContain("Preparing Agent Native skills");
  });

  it("keeps delegated startup progress out of machine-readable and non-interactive output", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "quick-recap");
    const stderr: string[] = [];
    const previousDirect = process.env.AGENT_NATIVE_SKILLS_DIRECT;
    delete process.env.AGENT_NATIVE_SKILLS_DIRECT;
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });

    try {
      await runSkillsCli(["add", "--copy", repo, "--json"], {
        baseDir: project,
        isInteractive: () => true,
      });
      await runSkillsCli(["add", "--copy", repo, "--quiet"], {
        baseDir: project,
        isInteractive: () => true,
      });
      await runSkillsCli(["add", "--copy", repo], {
        baseDir: project,
        isInteractive: () => false,
      });
    } finally {
      if (previousDirect === undefined)
        delete process.env.AGENT_NATIVE_SKILLS_DIRECT;
      else process.env.AGENT_NATIVE_SKILLS_DIRECT = previousDirect;
    }

    expect(stderr.join("")).toBe("");
  });

  it("installs copied source skills headlessly in direct mode", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "quick-recap");
    writeSkill(repo, "efficient-fable");
    const promptSkills = vi.fn(async () => ["efficient-fable"]);
    const promptClients = vi.fn(async () => ["codex" as const]);
    const promptScope = vi.fn(async () => "project" as const);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const restoreDirect = enableDirectSkillsMode();

    try {
      await runSkillsCli(
        [
          "add",
          "--copy",
          repo,
          "--skill",
          "quick-recap",
          "--client",
          "codex",
          "--scope",
          "project",
          "--no-update-instructions",
        ],
        {
          baseDir: project,
          isInteractive: () => true,
          promptSkills,
          promptClients,
          promptScope,
          promptUpdateInstructions: async () => false,
        },
      );
    } finally {
      restoreDirect();
    }

    expect(runCoreSkills).not.toHaveBeenCalled();
    expect(promptSkills).not.toHaveBeenCalled();
    expect(promptClients).not.toHaveBeenCalled();
    expect(promptScope).not.toHaveBeenCalled();
    expect(
      fs.existsSync(
        path.join(project, ".agents", "skills", "quick-recap", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(project, ".agents", "skills", "efficient-fable")),
    ).toBe(false);
  });

  it("accepts Cowork in direct mode without writing Claude skill files for it", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    const home = tmpDir();
    const codexHome = path.join(home, ".codex");
    const previousHome = process.env.HOME;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    writeSkill(repo, "quick-recap");
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const restoreDirect = enableDirectSkillsMode();

    try {
      await runSkillsCli(
        [
          "add",
          "--copy",
          repo,
          "--skill",
          "quick-recap",
          "--client",
          "codex,cowork",
          "--scope",
          "user",
          "--no-update-instructions",
        ],
        {
          baseDir: project,
          isInteractive: () => false,
        },
      );
    } finally {
      restoreDirect();
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }

    expect(
      fs.existsSync(path.join(codexHome, "skills", "quick-recap", "SKILL.md")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(home, ".claude", "skills", "quick-recap", "SKILL.md"),
      ),
    ).toBe(false);
  });

  it("offers managed instruction updates for instruction-style skills", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "efficient-fable");
    writeSkill(repo, "efficient-frontier");
    writeSkill(repo, "quick-recap");
    fs.writeFileSync(path.join(project, "AGENTS.md"), "# Existing\n", "utf-8");
    const promptUpdateInstructions = vi.fn(async () => true);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const restoreDirect = enableDirectSkillsMode();

    try {
      await runSkillsCli(
        [
          "add",
          "--copy",
          repo,
          "--client",
          "codex",
          "--scope",
          "project",
          "--update-instructions",
          "--skill",
          "efficient-fable",
          "--skill",
          "efficient-frontier",
          "--skill",
          "quick-recap",
        ],
        {
          baseDir: project,
          isInteractive: () => true,
          promptUpdateInstructions,
        },
      );
    } finally {
      restoreDirect();
    }

    expect(promptUpdateInstructions).not.toHaveBeenCalled();
    const agents = fs.readFileSync(path.join(project, "AGENTS.md"), "utf-8");
    expect(agents).toContain(
      "When operating as Claude Fable, use the /efficient-fable skill always.",
    );
    expect(agents).toContain(
      "When using a high-cost frontier model for codebase-heavy work, use the /efficient-frontier skill always.",
    );
    expect(agents).toContain(
      "When writing final response status indicators, use the /quick-recap skill always.",
    );
  });

  it("offers the PR Visual Recap GitHub Action when visual-recap is selected", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "visual-recap");
    const promptGithubAction = vi.fn(async () => true);
    const promptPlanMode = vi.fn(async () => "hosted" as const);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const restoreDirect = enableDirectSkillsMode();

    try {
      await runSkillsCli(
        [
          "add",
          "--copy",
          repo,
          "--skill",
          "visual-recap",
          "--client",
          "codex",
          "--scope",
          "project",
          "--with-github-action",
          "--no-mcp",
        ],
        {
          baseDir: project,
          isInteractive: () => true,
          promptPlanMode,
          promptGithubAction,
        },
      );
    } finally {
      restoreDirect();
    }

    expect(promptGithubAction).not.toHaveBeenCalled();
    expect(promptPlanMode).not.toHaveBeenCalled();
    expect(
      fs.existsSync(
        path.join(project, ".github", "workflows", "pr-visual-recap.yml"),
      ),
    ).toBe(true);
  });

  it("prompts for the PR Visual Recap GitHub Action in direct local-files mode", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "visual-recap");
    const promptGithubAction = vi.fn(async () => true);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const restoreDirect = enableDirectSkillsMode();

    try {
      await runSkillsCli(
        [
          "add",
          "--copy",
          repo,
          "--skill",
          "visual-recap",
          "--client",
          "codex",
          "--scope",
          "project",
          "--mode",
          "local-files",
          "--no-mcp",
        ],
        {
          baseDir: project,
          isInteractive: () => true,
          promptGithubAction,
        },
      );
    } finally {
      restoreDirect();
    }

    expect(promptGithubAction).toHaveBeenCalledTimes(1);
    expect(promptGithubAction.mock.calls[0]?.[0]).toMatchObject({
      workflowPath: path.join(".github", "workflows", "pr-visual-recap.yml"),
      setupCommand: "npx @agent-native/core@latest recap setup",
      docsUrl: "https://www.agent-native.com/docs/pr-visual-recap",
    });
    expect(
      fs.existsSync(
        path.join(project, ".github", "workflows", "pr-visual-recap.yml"),
      ),
    ).toBe(true);
  });

  it("installs copied public-repo-backed app skills directly when explicitly selected", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "visual-plan", "Live visual plan body");
    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    const restoreDirect = enableDirectSkillsMode();

    try {
      await runSkillsCli(
        [
          "add",
          "--copy",
          repo,
          "--skill",
          "visual-plan",
          "--client",
          "codex",
          "--scope",
          "project",
          "--yes",
          "--json",
          "--no-mcp",
        ],
        { baseDir: project, isInteractive: () => false },
      );
    } finally {
      restoreDirect();
    }

    expect(runCoreSkills).not.toHaveBeenCalled();
    const result = JSON.parse(stdout.join(""));
    expect(result.skills).toEqual(["visual-plan"]);
    expect(
      fs.readFileSync(
        path.join(project, ".agents", "skills", "visual-plan", "SKILL.md"),
        "utf-8",
      ),
    ).toContain("Live visual plan body");
  });

  it("delegates default visual-plan installs to agent-native core", async () => {
    const project = tmpDir();
    const previousDirect = process.env.AGENT_NATIVE_SKILLS_DIRECT;
    delete process.env.AGENT_NATIVE_SKILLS_DIRECT;

    try {
      await runSkillsCli(
        [
          "add",
          "--skill",
          "visual-plan",
          "--client",
          "codex",
          "--scope",
          "project",
          "--mode",
          "local-files",
          "--yes",
          "--json",
        ],
        { baseDir: project, isInteractive: () => false },
      );
    } finally {
      if (previousDirect === undefined)
        delete process.env.AGENT_NATIVE_SKILLS_DIRECT;
      else process.env.AGENT_NATIVE_SKILLS_DIRECT = previousDirect;
    }

    expect(runCoreSkills).toHaveBeenCalledWith(
      [
        "add",
        "visual-plan",
        "--client",
        "codex",
        "--scope",
        "project",
        "--yes",
        "--json",
        "--mode",
        "local-files",
      ],
      expect.objectContaining({
        baseDir: project,
        catalogMode: "all",
        isInteractive: expect.any(Function),
        publicSkillEntries: [],
        publicSkillSource: "BuilderIO/skills",
      }),
    );
  });

  it("delegates content local-files installs to agent-native core", async () => {
    const project = tmpDir();
    const previousDirect = process.env.AGENT_NATIVE_SKILLS_DIRECT;
    delete process.env.AGENT_NATIVE_SKILLS_DIRECT;

    try {
      await runSkillsCli(
        [
          "add",
          "--skill",
          "content",
          "--client",
          "codex",
          "--scope",
          "project",
          "--mode",
          "local-files",
          "--yes",
          "--json",
        ],
        { baseDir: project, isInteractive: () => false },
      );
    } finally {
      if (previousDirect === undefined)
        delete process.env.AGENT_NATIVE_SKILLS_DIRECT;
      else process.env.AGENT_NATIVE_SKILLS_DIRECT = previousDirect;
    }

    expect(runCoreSkills).toHaveBeenCalledWith(
      [
        "add",
        "content",
        "--client",
        "codex",
        "--scope",
        "project",
        "--yes",
        "--json",
        "--mode",
        "local-files",
      ],
      expect.objectContaining({
        baseDir: project,
        catalogMode: "all",
        hiddenBuiltInSkillTargets: expect.arrayContaining(["content"]),
        isInteractive: expect.any(Function),
        publicSkillEntries: [],
        publicSkillSource: "BuilderIO/skills",
      }),
    );
  });

  it("skips MCP registration for direct visual-plan local-files mode", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "visual-plan");

    const result = await installSkills({
      source: repo,
      skillNames: ["visual-plan"],
      clients: ["codex"],
      scope: "project",
      baseDir: project,
      planMode: "local-files",
      updateInstructions: false,
      yes: true,
    });

    expect(result.planMode).toBe("local-files");
    expect(result.mcpServers).toEqual([]);
    expect(
      fs.existsSync(
        path.join(project, ".agents", "skills", "visual-plan", "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("registers direct visual-plan installs against a self-hosted MCP URL", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "visual-plan");

    const result = await installSkills({
      source: repo,
      skillNames: ["visual-plan"],
      clients: ["claude-code"],
      scope: "project",
      baseDir: project,
      planMode: "self-hosted",
      mcpUrl: "https://plans.example.com/team",
      updateInstructions: false,
      connect: false,
      yes: true,
    });

    expect(result.planMode).toBe("self-hosted");
    expect(result.mcpServers).toHaveLength(1);
    expect(result.mcpServers[0]).toMatchObject({
      serverName: "plan",
      mcpUrl: "https://plans.example.com/team/_agent-native/mcp",
    });
  });

  it("describes skipped codex MCP auth as pending in the final output", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "visual-plan");
    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    const restoreDirect = enableDirectSkillsMode();

    try {
      await runSkillsCli(
        [
          "add",
          "--copy",
          repo,
          "--skill",
          "visual-plan",
          "--client",
          "codex",
          "--scope",
          "project",
          "--yes",
          "--no-connect",
          "--no-update-instructions",
        ],
        { baseDir: project, isInteractive: () => false },
      );
    } finally {
      restoreDirect();
    }

    const output = stdout.join("");
    expect(output).toContain("authentication pending");
    expect(output).not.toContain("plan: registered for codex");
    expect(output).toContain("All set");
    expect(output).toContain("✅");
  });

  it("delegates core-only app skills to agent-native core", async () => {
    const project = tmpDir();
    const previousDirect = process.env.AGENT_NATIVE_SKILLS_DIRECT;
    delete process.env.AGENT_NATIVE_SKILLS_DIRECT;

    try {
      await runSkillsCli(
        [
          "add",
          "--skill",
          "assets",
          "--client",
          "codex",
          "--scope",
          "project",
          "--yes",
          "--json",
        ],
        { baseDir: project, isInteractive: () => false },
      );
    } finally {
      if (previousDirect === undefined)
        delete process.env.AGENT_NATIVE_SKILLS_DIRECT;
      else process.env.AGENT_NATIVE_SKILLS_DIRECT = previousDirect;
    }

    expect(runCoreSkills).toHaveBeenCalledWith(
      [
        "add",
        "assets",
        "--client",
        "codex",
        "--scope",
        "project",
        "--yes",
        "--json",
      ],
      expect.objectContaining({
        baseDir: project,
        catalogMode: "all",
        isInteractive: expect.any(Function),
        publicSkillEntries: [],
        publicSkillSource: "BuilderIO/skills",
      }),
    );
  });

  it("defaults to all supported clients when clients are omitted", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "quick-recap");

    const result = await installSkills({
      source: repo,
      skillNames: ["quick-recap"],
      scope: "project",
      baseDir: project,
      updateInstructions: false,
      yes: true,
    });

    expect(result.clients).toEqual([
      "codex",
      "claude-code",
      "cowork",
      "pi",
      "cursor",
      "opencode",
      "github-copilot",
    ]);
    expect(
      fs.existsSync(
        path.join(project, ".agents", "skills", "quick-recap", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(project, ".claude", "skills", "quick-recap", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(project, ".pi", "skills", "quick-recap")),
    ).toBe(false);
  });

  it("adds an idempotent managed instruction block for quick-recap", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "quick-recap");
    fs.writeFileSync(path.join(project, "AGENTS.md"), "# Existing\n", "utf-8");

    await installSkills({
      source: repo,
      skillNames: ["quick-recap"],
      clients: ["codex"],
      scope: "project",
      baseDir: project,
      updateInstructions: true,
      yes: true,
    });
    await installSkills({
      source: repo,
      skillNames: ["quick-recap"],
      clients: ["codex"],
      scope: "project",
      baseDir: project,
      updateInstructions: true,
      yes: true,
    });

    const agents = fs.readFileSync(path.join(project, "AGENTS.md"), "utf-8");
    expect(agents.match(/BEGIN @agent-native\/skills/g)).toHaveLength(1);
    expect(agents).toContain(
      "When writing final response status indicators, use the /quick-recap skill always.",
    );
    expect(agents).not.toContain("🟢 Actual concise status sentence");
  });

  it("adds managed limit instructions for stay-within-limits", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "stay-within-limits");

    await installSkills({
      source: repo,
      skillNames: ["stay-within-limits"],
      clients: ["codex"],
      scope: "project",
      baseDir: project,
      updateInstructions: true,
      yes: true,
    });

    const agents = fs.readFileSync(path.join(project, "AGENTS.md"), "utf-8");
    expect(agents).toContain(
      "When long-running or parallel work needs usage-limit checks, use the /stay-within-limits skill always.",
    );
    expect(agents).not.toContain("ccusage@latest blocks --active --json");
    expect(agents).not.toContain("95%");
  });

  it("writes managed instructions to user files for user-scoped installs", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    const home = path.join(project, "home");
    const codexHome = path.join(project, "codex-home");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    const prevHome = process.env.HOME;
    const prevCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    writeSkill(repo, "efficient-fable");

    try {
      const result = await installSkills({
        source: repo,
        skillNames: ["efficient-fable"],
        clients: ["codex", "claude-code"],
        scope: "user",
        baseDir: project,
        updateInstructions: true,
        yes: true,
      });

      expect(result.instructionFiles).toEqual([
        path.join(codexHome, "AGENTS.md"),
        path.join(home, ".claude", "CLAUDE.md"),
      ]);
      expect(fs.existsSync(path.join(project, "AGENTS.md"))).toBe(false);
      expect(fs.existsSync(path.join(project, "CLAUDE.md"))).toBe(false);
      expect(
        fs.readFileSync(path.join(codexHome, "AGENTS.md"), "utf-8"),
      ).toContain(
        "When operating as Claude Fable, use the /efficient-fable skill always.",
      );
      expect(
        fs.readFileSync(path.join(home, ".claude", "CLAUDE.md"), "utf-8"),
      ).toContain(
        "When operating as Claude Fable, use the /efficient-fable skill always.",
      );
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prevCodexHome;
    }
  });

  it("uses folded frontmatter descriptions in the delegated public catalog", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    const dir = path.join(repo, "skills", "visual-plan");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      [
        "---",
        "name: visual-plan",
        "description: >-",
        "  Turn risky coding work into interactive visual plans with diagrams,",
        "  file maps, annotated code, questions, and optional UI review.",
        "---",
        "",
        "# visual-plan",
      ].join("\n"),
      "utf-8",
    );
    await runSkillsCli(["add", "--copy", repo, "--dry-run"], {
      baseDir: project,
      isInteractive: () => false,
    });

    expect(runCoreSkills).toHaveBeenCalledTimes(1);
    const [, options] = vi.mocked(runCoreSkills).mock.calls[0];
    expect(options).toMatchObject({
      publicSkillEntries: [
        {
          name: "visual-plan",
          description:
            "Turn risky coding work into interactive visual plans with diagrams, file maps, annotated code, questions, and optional UI review.",
        },
      ],
    });
  });

  it("defaults to user scope when scope is omitted non-interactively", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "quick-recap");
    const home = path.join(project, "home");
    fs.mkdirSync(home, { recursive: true });
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const result = await installSkills({
        source: repo,
        skillNames: ["quick-recap"],
        clients: ["claude-code"],
        // scope intentionally omitted so resolveSelectedScope picks a default
        baseDir: project,
        updateInstructions: false,
        yes: true,
      });

      expect(result.scope).toBe("user");
      expect(
        fs.existsSync(
          path.join(home, ".claude", "skills", "quick-recap", "SKILL.md"),
        ),
      ).toBe(true);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
    }
  });

  it("writes the optional PR Visual Recap workflow when visual-recap is selected", async () => {
    const repo = tmpDir();
    const project = tmpDir();
    writeSkill(repo, "visual-recap");

    const result = await installSkills({
      source: repo,
      skillNames: ["visual-recap"],
      clients: ["codex"],
      scope: "project",
      baseDir: project,
      withGithubAction: true,
      yes: true,
    });

    expect(result.githubActionPath).toBe(
      path.join(project, ".github", "workflows", "pr-visual-recap.yml"),
    );
    expect(fs.readFileSync(result.githubActionPath!, "utf-8")).toContain(
      "pr-visual-recap-reusable.yml@main",
    );
  });
});
