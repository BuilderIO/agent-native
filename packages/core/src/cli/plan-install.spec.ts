/**
 * Adversarial INSTALL / CLI / FIRST-RUN coverage focused on the Plans
 * (`templates/plan`) app and its shipped skills.
 *
 * Goals:
 *   1. A fresh standalone Plans scaffold produces a bootable app: it is in the
 *      public template allow-list, scaffolds the expected files, and every dep
 *      resolves to a real version (no `workspace:*` / no bare `catalog:` leak),
 *      with the Postgres runtime injected.
 *   2. `agent-native skills add visual-plan` (and its aliases) materializes the
 *      correct user-facing SKILL.md files for the hosted Plans MCP app.
 *   3. The three shipped copies of each Plans skill stay byte-identical (deep
 *      sync guard beyond the existing one) and the materialized output matches
 *      the canonical template copy exactly.
 *   4. Adversarial first-run inputs: non-empty target dir, unknown template
 *      name, path-traversal repo names, alias normalization, etc.
 *
 * These exercise packages/core/src/cli/create.ts + skills.ts +
 * templates-meta.ts as the user hits them on a fresh machine.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  createApp,
  addAppToWorkspace,
  _scaffoldWorkspaceRoot,
  _scaffoldAppTemplate,
  _postProcessStandalone,
  _getCoreDependencyVersion,
} from "./create.js";
import {
  addAgentNativeSkill,
  CANVAS_REFERENCE_MD,
  DOCUMENT_QUALITY_REFERENCE_MD,
  EXEMPLAR_REFERENCE_MD,
  parseSkillsArgs,
  VISUAL_PLANS_SKILL_MD,
  VISUAL_RECAP_SKILL_MD,
  WIREFRAME_REFERENCE_MD,
} from "./skills.js";
import { getTemplate, allTemplateNames, TEMPLATES } from "./templates-meta.js";

let tmpDir: string;
let origCwd: string;

const PLANS_INSTALL_SKILLS: Array<[string, string]> = [
  ["visual-plan", VISUAL_PLANS_SKILL_MD],
  ["visual-recap", VISUAL_RECAP_SKILL_MD],
];

const PLANS_INSTALL_SKILL_NAMES = PLANS_INSTALL_SKILLS.map(([name]) => name);

const PLANS_INSTALL_REFERENCES: Record<string, Record<string, string>> = {
  "visual-plan": {
    "references/wireframe.md": WIREFRAME_REFERENCE_MD,
    "references/canvas.md": CANVAS_REFERENCE_MD,
    "references/document-quality.md": DOCUMENT_QUALITY_REFERENCE_MD,
    "references/exemplar.md": EXEMPLAR_REFERENCE_MD,
  },
  "visual-recap": {
    "references/wireframe.md": WIREFRAME_REFERENCE_MD,
  },
};

const PLANS_INSTALL_ALIASES = [
  "visual-plans",
  "visual-recap",
  "visual-recaps",
  "code-review-recap",
  "code-review-recaps",
  "plannotate",
  "html-plan",
];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-plan-install-"));
  origCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(origCwd);
  fs.rmSync(tmpDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
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

function workspaceRoot(): string {
  let current = origCwd;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    current = path.dirname(current);
  }
  throw new Error("Could not locate workspace root.");
}

/* ─────────────────────────────────────────────────────────────────────────
 * 1. Plan template is a real, allow-listed, bootable target
 * ───────────────────────────────────────────────────────────────────────── */

describe("Plans template — allow-list & metadata", () => {
  it("is a known, non-hidden core template scaffoldable via --template plan", () => {
    expect(allTemplateNames()).toContain("plan");
    const meta = getTemplate("plan");
    expect(meta).toBeDefined();
    expect(meta?.core).toBe(true);
    // Plans is a public, featured app — it must not be hidden from the picker.
    expect(meta?.hidden).toBeFalsy();
    expect(meta?.prodUrl).toBe("https://plan.agent-native.com");
  });

  it("resolves legacy aliases (visual-plans, contracts) to the plan template", () => {
    expect(getTemplate("visual-plans")?.name).toBe("plan");
    expect(getTemplate("contracts")?.name).toBe("plan");
  });

  it("declares no first-party workspace package deps that need scaffolding", () => {
    // The plan template only depends on @agent-native/core (an npm package),
    // so it must NOT declare requiredPackages — otherwise the CLI would try to
    // download a nonexistent packages/<x> on a fresh install.
    const meta = getTemplate("plan");
    expect(meta?.requiredPackages ?? []).toEqual([]);
  });
});

describe(
  "Plans standalone scaffold — bootable output",
  { timeout: 60000 },
  () => {
    it("scaffolds the plan app with its package name and key files", async () => {
      await createApp("plan", { template: "plan" });
      const root = path.join(tmpDir, "plan");
      expect(fs.existsSync(root)).toBe(true);
      expect(fs.existsSync(path.join(root, "package.json"))).toBe(true);
      expect(fs.existsSync(path.join(root, "app", "root.tsx"))).toBe(true);
      // _gitignore must be renamed to .gitignore so the scaffold is git-clean.
      expect(fs.existsSync(path.join(root, ".gitignore"))).toBe(true);
      expect(fs.existsSync(path.join(root, "_gitignore"))).toBe(false);
    });

    it("resolves every dependency to a real version (no workspace:* or bare catalog: left)", async () => {
      await createApp("plan", { template: "plan" });
      const pkg = readPkg(path.join(tmpDir, "plan"));
      const deps = allDeps(pkg);
      for (const [key, val] of Object.entries(deps)) {
        expect(val, `${key} must not be workspace:*`).not.toMatch(
          /^workspace:/,
        );
        expect(val, `${key} must not be bare catalog:`).not.toBe("catalog:");
      }
      // @agent-native/core must resolve to the CLI's published range.
      expect(deps["@agent-native/core"]).toBe(_getCoreDependencyVersion());
    });

    it("injects the Postgres runtime so a hosted DB install works", async () => {
      await createApp("plan", { template: "plan" });
      const pkg = readPkg(path.join(tmpDir, "plan"));
      expect(pkg.dependencies?.postgres).toBeDefined();
    });

    it("resolves the catalog: tailwind/vite refs to semver strings", async () => {
      await createApp("plan", { template: "plan" });
      const pkg = readPkg(path.join(tmpDir, "plan"));
      const deps = allDeps(pkg);
      for (const key of ["tailwindcss", "@tailwindcss/vite", "vite"]) {
        if (deps[key]) {
          expect(deps[key], `${key} should be a version`).toMatch(/^\^?\d/);
        }
      }
    });

    it("ships the Plans skills inside the scaffold (.agents/skills)", async () => {
      await createApp("plan", { template: "plan" });
      const skillsDir = path.join(tmpDir, "plan", ".agents", "skills");
      for (const name of ["visual-plan", "visual-recap"]) {
        expect(
          fs.existsSync(path.join(skillsDir, name, "SKILL.md")),
          `expected scaffolded skill ${name}/SKILL.md`,
        ).toBe(true);
      }
      // Guard against the circular `.agents/skills/skills` symlink that crashes
      // Vite's watcher.
      expect(fs.readdirSync(skillsDir)).not.toContain("skills");
    });

    it("sets pnpm.onlyBuiltDependencies so native deps build without a prompt", async () => {
      await createApp("plan", { template: "plan" });
      const pkg = readPkg(path.join(tmpDir, "plan"));
      const built: string[] = pkg.pnpm?.onlyBuiltDependencies ?? [];
      expect(built).toEqual(
        expect.arrayContaining(["better-sqlite3", "esbuild", "node-pty"]),
      );
    });
  },
);

/* ─────────────────────────────────────────────────────────────────────────
 * 2. Tracking app-id rewrite for a renamed Plans app
 *
 * Every other template hardcodes `app: "agent-native-<name>"` in root.tsx,
 * which the scaffolder rewrites to the chosen app name + a `template:` tag.
 * If the plan template hardcodes `app: "plan"` instead, a renamed plan app
 * silently reports analytics under the wrong app id and loses the template
 * tag. These tests pin the EXPECTED behaviour (rename => correct id).
 * ───────────────────────────────────────────────────────────────────────── */

describe(
  "Plans tracking id — renamed standalone/app",
  { timeout: 60000 },
  () => {
    it("rewrites the tracking app id when scaffolded under a custom name", async () => {
      // BUG REPRO: createApp("my-roadmap", {template:"plan"}) should brand the
      // tracking call as the new app, not leave it as the source template.
      await createApp("my-roadmap", { template: "plan" });
      const root = fs.readFileSync(
        path.join(tmpDir, "my-roadmap", "app", "root.tsx"),
        "utf-8",
      );
      expect(root).toContain('app: "my-roadmap"');
      expect(root).not.toContain('app: "plan"');
    });

    it("rewrites the tracking app id when added to a workspace under a custom name", async () => {
      const wsDir = path.join(tmpDir, "my-ws");
      await _scaffoldWorkspaceRoot(wsDir, "my-ws");
      process.chdir(wsDir);
      await addAppToWorkspace("roadmap", { template: "plan" });

      const root = fs.readFileSync(
        path.join(wsDir, "apps", "roadmap", "app", "root.tsx"),
        "utf-8",
      );
      expect(root).toContain('app: "roadmap"');
      // And it should carry the source template tag for analytics segmentation.
      expect(root).toContain('template: "plan"');
    });
  },
);

/* ─────────────────────────────────────────────────────────────────────────
 * 3. Skills install materializes the right SKILL.md for end users
 * ───────────────────────────────────────────────────────────────────────── */

describe("Plans skills install — materialized output", () => {
  /**
   * Run a Plans install via `alias`, capturing each materialized SKILL.md's
   * contents from inside the runCommand callback. The CLI writes the skills to
   * a temp dir that is rmSync'd as soon as `addAgentNativeSkill` returns, so we
   * must read them while the npx invocation is still pending — mirroring the
   * existing skills.spec.ts pattern.
   */
  async function materializeViaAlias(alias: string): Promise<{
    result: Awaited<ReturnType<typeof addAgentNativeSkill>>;
    captured: Record<string, string>;
    capturedReferences: Record<string, string>;
    codexConfig: string;
    npxCalls: number;
  }> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-plan-skill-"));
    const codexHome = path.join(root, "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    const prevCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    const captured: Record<string, string> = {};
    const capturedReferences: Record<string, string> = {};
    let npxCalls = 0;
    try {
      const result = await addAgentNativeSkill(
        parseSkillsArgs([
          "add",
          alias,
          "--client",
          "codex",
          "--scope",
          "project",
        ]),
        {
          baseDir: root,
          runCommand: async (cmd, args) => {
            if (cmd === "npx" && args.includes("@agent-native/skills@latest")) {
              npxCalls += 1;
              const source = args[3];
              if (source) {
                const skillsDir = path.join(source, "skills");
                if (fs.existsSync(skillsDir)) {
                  for (const name of fs.readdirSync(skillsDir)) {
                    const file = path.join(skillsDir, name, "SKILL.md");
                    if (fs.existsSync(file)) {
                      captured[name] = fs.readFileSync(file, "utf-8");
                    }
                    const referencesDir = path.join(
                      skillsDir,
                      name,
                      "references",
                    );
                    if (fs.existsSync(referencesDir)) {
                      for (const entry of fs.readdirSync(referencesDir, {
                        withFileTypes: true,
                      })) {
                        if (!entry.isFile()) continue;
                        const rel = `references/${entry.name}`;
                        capturedReferences[`${name}/${rel}`] = fs.readFileSync(
                          path.join(referencesDir, entry.name),
                          "utf-8",
                        );
                      }
                    }
                  }
                }
              }
            }
            return 0;
          },
        },
      );
      const codexConfig = fs.readFileSync(
        path.join(codexHome, "config.toml"),
        "utf-8",
      );
      return { result, captured, capturedReferences, codexConfig, npxCalls };
    } finally {
      if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prevCodexHome;
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  it("materializes exactly the Plans SKILL.md files and points at the hosted MCP", async () => {
    const { result, captured, capturedReferences, codexConfig, npxCalls } =
      await materializeViaAlias("visual-plan");
    expect(result.id).toBe("visual-plans");
    expect(result.skillNames).toEqual(PLANS_INSTALL_SKILL_NAMES);
    expect(result.mcpUrl).toBe(
      "https://plan.agent-native.com/_agent-native/mcp",
    );
    expect(codexConfig).toContain('[mcp_servers."plan"]');
    expect(codexConfig).toContain(
      'url = "https://plan.agent-native.com/_agent-native/mcp"',
    );
    expect(codexConfig).toContain('[mcp_servers."agent-native-plans"]');
    expect(npxCalls).toBeGreaterThan(0);

    for (const [name, constant] of PLANS_INSTALL_SKILLS) {
      // The materialized file the user receives must be byte-identical to the
      // shipped constant.
      expect(captured[name], `materialized ${name}/SKILL.md`).toBe(constant);
    }
    // No extra surprise skills materialized.
    expect(Object.keys(captured).sort()).toEqual(
      [...PLANS_INSTALL_SKILL_NAMES].sort(),
    );

    const expectedReferenceKeys = Object.entries(PLANS_INSTALL_REFERENCES)
      .flatMap(([name, refs]) =>
        Object.keys(refs).map((rel) => `${name}/${rel}`),
      )
      .sort();
    expect(Object.keys(capturedReferences).sort()).toEqual(
      expectedReferenceKeys,
    );
    for (const [name, refs] of Object.entries(PLANS_INSTALL_REFERENCES)) {
      for (const [rel, constant] of Object.entries(refs)) {
        expect(
          capturedReferences[`${name}/${rel}`],
          `materialized ${name}/${rel}`,
        ).toBe(constant);
      }
    }
  });

  it("normalizes every Plans alias to the same hosted Plans skill", async () => {
    for (const alias of PLANS_INSTALL_ALIASES) {
      const { result } = await materializeViaAlias(alias);
      expect(result.id, `alias ${alias}`).toBe("visual-plans");
      expect(result.skillNames, `alias ${alias} skills`).toEqual(
        PLANS_INSTALL_SKILL_NAMES,
      );
    }
  });

  it("materialized visual-plan handles existing plan text and avoids legacy HTML", async () => {
    const { captured } = await materializeViaAlias("visual-plan");
    const md = captured["visual-plan"];
    expect(md).toBeDefined();
    expect(md).toContain("pass it as `planText`");
    expect(md).not.toContain("data-plan-tabs");
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * 4. Deep three-copy byte-identity sync guard
 * ───────────────────────────────────────────────────────────────────────── */

describe("Plans skill three-copy sync (deep)", () => {
  const SKILLS = [
    {
      constant: VISUAL_PLANS_SKILL_MD,
      templateDir: "visual-plan",
      exportedDir: "visual-plans",
    },
    {
      constant: VISUAL_RECAP_SKILL_MD,
      templateDir: "visual-recap",
      exportedDir: "visual-recap",
    },
  ];

  it("constant === template copy === exported mirror, byte for byte", () => {
    const root = workspaceRoot();
    for (const s of SKILLS) {
      const tmpl = fs.readFileSync(
        path.join(
          root,
          "templates",
          "plan",
          ".agents",
          "skills",
          s.templateDir,
          "SKILL.md",
        ),
        "utf-8",
      );
      const exp = fs.readFileSync(
        path.join(root, "skills", s.exportedDir, "SKILL.md"),
        "utf-8",
      );
      expect(tmpl, `${s.templateDir}: template vs constant`).toBe(s.constant);
      expect(exp, `${s.exportedDir}: exported vs constant`).toBe(s.constant);
    }
  });

  it("each skill constant has valid frontmatter with a name and visibility", () => {
    for (const s of SKILLS) {
      expect(
        s.constant.startsWith("---\n"),
        `${s.templateDir} frontmatter`,
      ).toBe(true);
      expect(s.constant).toMatch(/\nname:\s*\S+/);
      // Plans skills may be exported or both. Either way each skill must
      // declare a visibility.
      expect(s.constant, `${s.templateDir} visibility`).toMatch(
        /visibility:\s*(exported|both)/,
      );
    }
  });

  it("the canonical headline skill declares name: visual-plan and the slash command", () => {
    expect(VISUAL_PLANS_SKILL_MD).toMatch(/^---\nname: visual-plan\n/);
    expect(VISUAL_PLANS_SKILL_MD).toContain("`/visual-plan`");
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * 5. Adversarial first-run inputs
 * ───────────────────────────────────────────────────────────────────────── */

describe("Plans first-run — adversarial inputs", { timeout: 60000 }, () => {
  it("refuses to scaffold into a non-empty existing directory", async () => {
    fs.mkdirSync(path.join(tmpDir, "plan"));
    fs.writeFileSync(path.join(tmpDir, "plan", "keep.txt"), "do not clobber");

    const origExit = process.exit.bind(process);
    let exited = false;
    // @ts-ignore
    process.exit = (() => {
      exited = true;
      throw new Error("process.exit called");
    }) as never;
    try {
      await createApp("plan", { template: "plan" });
    } catch {
      // expected — clack.cancel + process.exit(1)
    } finally {
      process.exit = origExit;
    }
    expect(exited).toBe(true);
    // The user's existing file must survive.
    expect(
      fs.readFileSync(path.join(tmpDir, "plan", "keep.txt"), "utf-8"),
    ).toBe("do not clobber");
  });

  it("rejects an invalid app name before touching the filesystem", async () => {
    const origExit = process.exit.bind(process);
    let code: number | undefined;
    // @ts-ignore
    process.exit = ((c?: number) => {
      code = c;
      throw new Error("process.exit called");
    }) as never;
    try {
      await createApp("Plan With Spaces!", { template: "plan" });
    } catch {
      // expected
    } finally {
      process.exit = origExit;
    }
    expect(code).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, "Plan With Spaces!"))).toBe(false);
  });

  it("throws a helpful error for an unknown template name", async () => {
    await expect(
      _scaffoldAppTemplate(path.join(tmpDir, "x"), "definitely-not-a-template"),
    ).rejects.toThrow(/Unknown template/);
  });

  it("rejects path-traversal / malformed github: repo specs", async () => {
    for (const bad of [
      "github:../../etc/passwd",
      "github:owner",
      "github:owner/repo/extra",
      "github:owner repo",
    ]) {
      await expect(
        _scaffoldAppTemplate(path.join(tmpDir, "trav"), bad),
        `expected rejection for ${bad}`,
      ).rejects.toThrow();
      // Nothing should have been written outside the target.
      expect(fs.existsSync(path.join(tmpDir, "trav", "package.json"))).toBe(
        false,
      );
    }
  });

  it("does not silently accept a stray 'contracts' skill dir as a real skill", () => {
    // templates/plan/.agents/skills/contracts is an empty leftover dir; it must
    // not masquerade as a shipped skill (no SKILL.md).
    const root = workspaceRoot();
    const contractsSkill = path.join(
      root,
      "templates",
      "plan",
      ".agents",
      "skills",
      "contracts",
      "SKILL.md",
    );
    // If a real contracts skill is ever added this assertion can flip; today an
    // empty dir with no SKILL.md should not exist as a half-shipped skill.
    if (fs.existsSync(path.dirname(contractsSkill))) {
      const entries = fs.readdirSync(path.dirname(contractsSkill));
      expect(
        entries.length === 0 || entries.includes("SKILL.md"),
        "contracts skill dir is non-empty but has no SKILL.md (half-shipped skill)",
      ).toBe(true);
    }
  });
});
