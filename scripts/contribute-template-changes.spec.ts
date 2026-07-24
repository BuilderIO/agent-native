import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  baselineRefName,
  resolveBaselineStore,
  writeBaseline,
} from "../packages/core/src/cli/template-baseline.ts";
import {
  classifyRelPath,
  diffTrees,
  globToRegExp,
  inversePlaceholders,
  matchesAnyGlob,
  placeholderAllowances,
  titleCaseAppName,
  toTemplateRelPath,
  type Replacement,
} from "./contribute-template-changes";

const repoRoot = path.resolve(import.meta.dirname, "..");
const scriptPath = path.join(
  repoRoot,
  "scripts",
  "contribute-template-changes.ts",
);
const tmpDirs: string[] = [];

function tmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function write(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const tokens: Replacement[] = [
  { placeholder: "{{APP_TITLE}}", value: "My Notes" },
  { placeholder: "{{APP_NAME}}", value: "my-notes" },
  { placeholder: "{{WORKSPACE_NAME}}", value: "acme" },
];
const allTokens = new Set([
  "{{APP_NAME}}",
  "{{APP_TITLE}}",
  "{{WORKSPACE_NAME}}",
]);

describe("inverse placeholder substitution", () => {
  it("reverses exactly what replacePlaceholders wrote", () => {
    const template =
      'export const appId = "{{APP_NAME}}";\n' +
      "// {{APP_TITLE}} in the {{WORKSPACE_NAME}} workspace\n";
    const generated = template
      .replace(/\{\{WORKSPACE_NAME\}\}/g, "acme")
      .replace(/\{\{APP_NAME\}\}/g, "my-notes")
      .replace(/\{\{APP_TITLE\}\}/g, "My Notes");

    const result = inversePlaceholders(generated, tokens, allTokens);
    assert.equal(result.content, template);
    assert.equal(result.counts["{{APP_NAME}}"], 1);
    assert.equal(result.counts["{{APP_TITLE}}"], 1);
    assert.equal(result.counts["{{WORKSPACE_NAME}}"], 1);
  });

  it("replaces the longest token value first", () => {
    const overlapping: Replacement[] = [
      { placeholder: "{{APP_TITLE}}", value: "Notes" },
      { placeholder: "{{APP_NAME}}", value: "notes" },
      { placeholder: "{{WORKSPACE_NAME}}", value: "notes-workspace" },
    ];
    const result = inversePlaceholders(
      "notes-workspace hosts notes",
      overlapping,
      allTokens,
    );
    assert.equal(result.content, "{{WORKSPACE_NAME}} hosts {{APP_NAME}}");
  });

  it("flags ambiguous token values instead of pretending the inverse is exact", () => {
    const result = inversePlaceholders(
      "acme",
      [
        { placeholder: "{{APP_NAME}}", value: "acme" },
        { placeholder: "{{WORKSPACE_NAME}}", value: "acme" },
      ],
      allTokens,
    );
    assert.deepEqual(result.ambiguous, ["{{APP_NAME}} / {{WORKSPACE_NAME}}"]);
  });

  it("only applies the placeholders the template file actually uses", () => {
    const templateContent = 'const appId = "{{APP_NAME}}";\n// slides deck\n';
    const allow = placeholderAllowances(templateContent);
    assert.deepEqual([...allow], ["{{APP_NAME}}"]);

    const result = inversePlaceholders(
      'const appId = "slides";\n// slides deck\n',
      [
        { placeholder: "{{APP_TITLE}}", value: "Slides" },
        { placeholder: "{{APP_NAME}}", value: "slides" },
      ],
      allow,
    );
    assert.equal(
      result.content,
      'const appId = "{{APP_NAME}}";\n// {{APP_NAME}} deck\n',
    );
  });

  it("allows every placeholder for files the template does not have yet", () => {
    assert.deepEqual([...placeholderAllowances(undefined)].sort(), [
      "{{APP_NAME}}",
      "{{APP_TITLE}}",
      "{{WORKSPACE_NAME}}",
    ]);
  });

  it("title-cases app names the way create.ts does", () => {
    assert.equal(titleCaseAppName("my-notes"), "My Notes");
    assert.equal(titleCaseAppName("mail"), "Mail");
  });
});

describe("file classification", () => {
  const rootSkills = new Set(["actions", "security"]);
  const opts = { rootSkills };

  it("routes create-rewritten files to manual review", () => {
    for (const rel of [
      "package.json",
      "pnpm-lock.yaml",
      "netlify.toml",
      "public/manifest.json",
      "app/root.tsx",
      "server/plugins/agent-chat.ts",
      "server/plugins/auth.ts",
      ".env",
      ".env.local",
      "learnings.md",
      ".agent-native/state.json",
    ]) {
      assert.equal(classifyRelPath(rel, opts).kind, "manual", rel);
    }
  });

  it("ignores generated and vendored trees outright", () => {
    for (const rel of [
      "node_modules/react/index.js",
      "dist/server.js",
      "build/index.html",
      ".output/server/chunk.mjs",
      ".generated/actions-registry.js",
      ".react-router/types.d.ts",
      "app/app.tsbuildinfo",
      "local.db",
    ]) {
      assert.equal(classifyRelPath(rel, opts).kind, "ignored", rel);
    }
  });

  it("writes ordinary app source into the template", () => {
    for (const rel of [
      "actions/list-notes.ts",
      "app/pages/notes.tsx",
      "server/db/schema.ts",
      ".gitignore",
      "AGENTS.md",
    ]) {
      assert.equal(classifyRelPath(rel, opts).kind, "write", rel);
    }
  });

  it("maps the app .gitignore back onto the template _gitignore", () => {
    assert.equal(toTemplateRelPath(".gitignore"), "_gitignore");
    assert.equal(toTemplateRelPath("app/pages/x.tsx"), "app/pages/x.tsx");
  });
});

describe(".agents/skills rerouting", () => {
  const rootSkills = new Set(["actions", "security"]);

  it("reroutes skills owned by sync-workspace-core-skills to the repo root", () => {
    const result = classifyRelPath(".agents/skills/actions/SKILL.md", {
      rootSkills,
    });
    assert.equal(result.kind, "skill");
    assert.match(String(result.reason), /sync:workspace-skills/);
  });

  it("leaves template-owned skills in the template", () => {
    assert.equal(
      classifyRelPath(".agents/skills/notes-import/SKILL.md", { rootSkills })
        .kind,
      "write",
    );
  });
});

describe("glob filtering", () => {
  it("matches path segments and recursive wildcards", () => {
    assert.equal(globToRegExp("actions/*.ts").test("actions/a.ts"), true);
    assert.equal(globToRegExp("actions/*.ts").test("actions/sub/a.ts"), false);
    assert.equal(globToRegExp("app/**/*.tsx").test("app/pages/x.tsx"), true);
    assert.equal(globToRegExp("app/**/*.tsx").test("app/x.tsx"), true);
    assert.equal(globToRegExp("actions/**").test("actions/a/b.ts"), true);
  });

  it("treats a bare directory name as a prefix and no globs as match-all", () => {
    assert.equal(matchesAnyGlob("actions/a.ts", ["actions"]), true);
    assert.equal(matchesAnyGlob("app/a.tsx", ["actions"]), false);
    assert.equal(matchesAnyGlob("anything", []), true);
  });
});

describe("tree diffing", () => {
  it("reports added, modified, and deleted files", () => {
    const root = tmpDir("contribute-diff-");
    const baseline = path.join(root, "baseline");
    const app = path.join(root, "app");
    write(baseline, "keep.ts", "same\n");
    write(baseline, "edit.ts", "before\n");
    write(baseline, "gone.ts", "bye\n");
    write(app, "keep.ts", "same\n");
    write(app, "edit.ts", "after\n");
    write(app, "new.ts", "hi\n");
    write(app, "node_modules/pkg/index.js", "ignored\n");

    assert.deepEqual(diffTrees(baseline, app), [
      { rel: "edit.ts", status: "modified" },
      { rel: "gone.ts", status: "deleted" },
      { rel: "new.ts", status: "added" },
    ]);
  });
});

describe("end to end", () => {
  it("lands app edits in the template, reroutes skills, and skips rewritten files", () => {
    const root = tmpDir("contribute-e2e-");
    const framework = path.join(root, "framework");
    const templateDir = path.join(framework, "templates", "notes");
    const baseline = path.join(root, "baseline");
    const app = path.join(root, "app");

    write(
      framework,
      ".agents/skills/actions/SKILL.md",
      "# Actions\nroot copy\n",
    );
    write(templateDir, "package.json", '{\n  "name": "notes"\n}\n');
    write(templateDir, "_gitignore", "node_modules\n");
    write(
      templateDir,
      "actions/list-notes.ts",
      'export const appId = "{{APP_NAME}}";\nexport const rows = 10;\n',
    );
    write(
      templateDir,
      ".agents/skills/actions/SKILL.md",
      "# Actions\nroot copy\n",
    );

    // Pristine generated app (what `agent-native create` produced).
    write(
      baseline,
      "package.json",
      '{\n  "name": "my-notes",\n  "agent-native": { "scaffold": { "template": "notes" } }\n}\n',
    );
    write(baseline, ".gitignore", "node_modules\n");
    write(
      baseline,
      "actions/list-notes.ts",
      'export const appId = "my-notes";\nexport const rows = 10;\n',
    );
    write(
      baseline,
      ".agents/skills/actions/SKILL.md",
      "# Actions\nroot copy\n",
    );
    write(
      baseline,
      "app/root.tsx",
      'configureTracking({ app: "my-notes" });\n',
    );

    // The user's app, with real edits on top of the baseline.
    fs.cpSync(baseline, app, { recursive: true });
    write(
      app,
      "actions/list-notes.ts",
      'export const appId = "my-notes";\nexport const rows = 50;\n',
    );
    write(app, "actions/archive-note.ts", 'export const owner = "My Notes";\n');
    write(
      app,
      ".agents/skills/actions/SKILL.md",
      "# Actions\nroot copy\nedited\n",
    );
    write(
      app,
      "app/root.tsx",
      'configureTracking({ app: "my-notes", debug: true });\n',
    );
    write(app, "node_modules/junk/index.js", "nope\n");

    const stdout = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        scriptPath,
        "--app",
        app,
        "--framework",
        framework,
        "--baseline",
        baseline,
      ],
      { cwd: repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );

    assert.equal(
      fs.readFileSync(path.join(templateDir, "actions/list-notes.ts"), "utf-8"),
      'export const appId = "{{APP_NAME}}";\nexport const rows = 50;\n',
    );
    assert.equal(
      fs.readFileSync(
        path.join(templateDir, "actions/archive-note.ts"),
        "utf-8",
      ),
      'export const owner = "{{APP_TITLE}}";\n',
    );
    assert.equal(
      fs.readFileSync(
        path.join(framework, ".agents/skills/actions/SKILL.md"),
        "utf-8",
      ),
      "# Actions\nroot copy\nedited\n",
    );
    assert.equal(
      fs.readFileSync(
        path.join(templateDir, ".agents/skills/actions/SKILL.md"),
        "utf-8",
      ),
      "# Actions\nroot copy\n",
      "the template skill copy is owned by sync:workspace-skills",
    );
    assert.equal(
      fs.readFileSync(path.join(templateDir, "package.json"), "utf-8"),
      '{\n  "name": "notes"\n}\n',
    );
    assert.match(stdout, /Manual porting required/);
    assert.match(stdout, /app\/root\.tsx/);
    assert.match(stdout, /pnpm sync:workspace-skills/);
    assert.doesNotMatch(stdout, /node_modules\/junk/);
  });

  it("fails clearly when the template cannot be determined", () => {
    const root = tmpDir("contribute-notemplate-");
    const app = path.join(root, "app");
    write(app, "package.json", '{\n  "name": "my-notes"\n}\n');
    let stderr = "";
    try {
      execFileSync(
        process.execPath,
        ["--import", "tsx", scriptPath, "--app", app],
        { cwd: repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
      );
      assert.fail("expected a non-zero exit");
    } catch (error) {
      stderr = String((error as { stderr?: string }).stderr ?? "");
    }
    assert.match(stderr, /agent-native"\.scaffold\.template/);
  });

  // `os.tmpdir()` is a symlink on macOS (/var → /private/var), the same shape
  // as a symlinked home or work dir. Computing the ref name from a non-realpath
  // app dir yields a ref that never resolves, and the script then degrades to
  // overwrite mode instead of merging — silently reverting upstream work.
  it("finds a baseline ref written by template-baseline on a symlinked path", () => {
    const root = tmpDir("contribute-ref-");
    const framework = path.join(root, "framework");
    const templateDir = path.join(framework, "templates", "notes");
    const repo = path.join(root, "workspace");
    const app = path.join(repo, "apps", "notes");

    write(
      templateDir,
      "actions/list.ts",
      'export const v = "{{APP_TITLE}}";\n',
    );
    execFileSync("git", ["init", "-q"], { cwd: framework });

    write(
      app,
      "package.json",
      JSON.stringify(
        { name: "notes", "agent-native": { scaffold: { template: "notes" } } },
        null,
        2,
      ) + "\n",
    );
    write(app, "actions/list.ts", 'export const v = "Notes";\n');
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    for (const cfg of [
      ["user.email", "t@t.t"],
      ["user.name", "t"],
    ]) {
      execFileSync("git", ["config", ...cfg], { cwd: repo });
    }
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "initial"], { cwd: repo });

    const store = resolveBaselineStore(app);
    writeBaseline(store, app, "baseline", {
      template: "notes",
      ref: "@agent-native/core@0.0.0",
      coreVersion: "0.0.0",
    });
    assert.equal(
      baselineRefName(store, "baseline"),
      "refs/agent-native/template-baseline/apps/notes",
    );

    fs.writeFileSync(
      path.join(app, "actions/list.ts"),
      'export const v = "Notes";\nexport const added = true;\n',
    );

    const stdout = execFileSync(
      process.execPath,
      ["--import", "tsx", scriptPath, "--app", app, "--framework", framework],
      { cwd: repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );

    assert.match(stdout, /refs\/agent-native\/template-baseline\/apps\/notes/);
    assert.doesNotMatch(stdout, /APPROXIMATE BASE/);
    assert.match(
      fs.readFileSync(path.join(templateDir, "actions/list.ts"), "utf-8"),
      /added = true/,
    );
  });
});
