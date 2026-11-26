import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyChangedPaths,
  readAddedPaths,
  readChangedPaths,
  readDeletedPaths,
  readSameDirectoryPureDesignSpecRenames,
} from "./ci-change-scope.ts";

test("filters only exact same-directory Design spec renames from diagnostics", () => {
  const repoPath = mkdtempSync(join(tmpdir(), "ci-change-scope-renames-"));
  const runGit = (...args: string[]) => {
    const result = spawnSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      0,
      `git ${args.join(" ")} failed: ${result.stderr}`,
    );
    return result.stdout.trim();
  };

  try {
    runGit("init", "--quiet");
    runGit("config", "user.name", "CI Change Scope Test");
    runGit("config", "user.email", "ci-change-scope@example.invalid");
    runGit("config", "core.filemode", "true");

    const sourcePath = "templates/design/e2e/original.spec.ts";
    const sourceFile = join(repoPath, sourcePath);
    const sourceContent = 'test("original title", () => {});\n';
    const helperPath = "templates/design/e2e/helper.ts";
    mkdirSync(join(repoPath, "templates/design/e2e"), { recursive: true });
    writeFileSync(sourceFile, sourceContent);
    writeFileSync(join(repoPath, helperPath), "export const fixture = true;\n");
    runGit("add", "--all");
    runGit("commit", "--quiet", "-m", "add Design spec");
    const baseSha = runGit("rev-parse", "HEAD");

    const commitFromBase = (message: string, change: () => void): string => {
      runGit("reset", "--hard", baseSha);
      change();
      runGit("add", "--all");
      runGit("commit", "--quiet", "-m", message);
      return runGit("rev-parse", "HEAD");
    };
    const scopeFor = (headSha: string) => {
      const changedPaths = readChangedPaths(baseSha, headSha, repoPath);
      const pureRenames = readSameDirectoryPureDesignSpecRenames(
        baseSha,
        headSha,
        repoPath,
      );
      const deletedPaths = readDeletedPaths(baseSha, headSha, repoPath);
      return {
        changedPaths,
        pureRenames,
        deletedPaths,
        scope: classifyChangedPaths(
          changedPaths,
          pureRenames,
          repoPath,
          deletedPaths,
        ),
      };
    };

    const pureRenamePath = "templates/design/e2e/renamed.spec.ts";
    const pureRenameHead = commitFromBase("rename Design spec", () => {
      runGit("mv", sourcePath, pureRenamePath);
    });
    const pureRename = scopeFor(pureRenameHead);
    assert.deepEqual(pureRename.pureRenames, [pureRenamePath]);
    assert.deepEqual(pureRename.scope.designCanvasE2eSpecs, [pureRenamePath]);
    assert.deepEqual(pureRename.scope.designCanvasE2eDiagnosticSpecs, []);
    assert.deepEqual(pureRename.changedPaths, [pureRenamePath]);
    assert.equal(pureRename.scope.checks.design_canvas_core_regression, false);

    const editedRenamePath = "templates/design/e2e/renamed-title.spec.ts";
    const editedRenameHead = commitFromBase(
      "rename and edit Design spec title",
      () => {
        runGit("mv", sourcePath, editedRenamePath);
        writeFileSync(
          join(repoPath, editedRenamePath),
          sourceContent.replace("original title", "updated title"),
        );
      },
    );
    const editedRename = scopeFor(editedRenameHead);
    assert.deepEqual(editedRename.pureRenames, []);
    assert.ok(
      editedRename.scope.designCanvasE2eDiagnosticSpecs.includes(
        editedRenamePath,
      ),
    );

    const crossDirectoryPath =
      "templates/design/e2e/renamed-folder/renamed.spec.ts";
    const crossDirectoryHead = commitFromBase(
      "move Design spec to another directory",
      () => {
        mkdirSync(join(repoPath, "templates/design/e2e/renamed-folder"), {
          recursive: true,
        });
        runGit("mv", sourcePath, crossDirectoryPath);
      },
    );
    const crossDirectoryRename = scopeFor(crossDirectoryHead);
    assert.deepEqual(crossDirectoryRename.pureRenames, []);
    assert.ok(
      crossDirectoryRename.scope.designCanvasE2eDiagnosticSpecs.includes(
        crossDirectoryPath,
      ),
    );

    const modeChangePath = "templates/design/e2e/mode-change.spec.ts";
    runGit("reset", "--hard", baseSha);
    runGit("mv", sourcePath, modeChangePath);
    runGit("update-index", "--chmod=+x", modeChangePath);
    runGit("commit", "--quiet", "-m", "rename and change Design spec mode");
    const modeChangeHead = runGit("rev-parse", "HEAD");
    const modeChangeRename = scopeFor(modeChangeHead);
    assert.deepEqual(modeChangeRename.pureRenames, []);
    assert.ok(
      modeChangeRename.scope.designCanvasE2eDiagnosticSpecs.includes(
        modeChangePath,
      ),
    );

    const introducedSpecPath = "templates/design/e2e/introduced-spec.spec.ts";
    const introducedSpecHead = commitFromBase(
      "rename helper into runnable Design spec",
      () => {
        runGit("mv", helperPath, introducedSpecPath);
      },
    );
    const introducedSpec = scopeFor(introducedSpecHead);
    assert.deepEqual(introducedSpec.pureRenames, []);
    assert.ok(
      introducedSpec.scope.designCanvasE2eDiagnosticSpecs.includes(
        introducedSpecPath,
      ),
    );

    const titleEditHead = commitFromBase("edit Design spec title", () => {
      writeFileSync(
        sourceFile,
        sourceContent.replace("original title", "updated title"),
      );
    });
    const titleEdit = scopeFor(titleEditHead);
    assert.deepEqual(titleEdit.pureRenames, []);
    assert.deepEqual(titleEdit.scope.designCanvasE2eSpecs, [sourcePath]);
    assert.deepEqual(titleEdit.scope.designCanvasE2eDiagnosticSpecs, [
      sourcePath,
    ]);

    const deletedSpecHead = commitFromBase("delete Design spec", () => {
      rmSync(sourceFile);
    });
    const deletedSpec = scopeFor(deletedSpecHead);
    assert.deepEqual(deletedSpec.deletedPaths, [sourcePath]);
    assert.deepEqual(deletedSpec.scope.designCanvasE2eSpecs, [sourcePath]);
    assert.deepEqual(deletedSpec.scope.designCanvasE2eDiagnosticSpecs, [
      sourcePath,
    ]);
    assert.equal(deletedSpec.scope.checks.design_canvas_broad_workflows, false);
    assert.deepEqual(deletedSpec.scope.designCanvasBroadWorkflowShards, []);
  } finally {
    rmSync(repoPath, { recursive: true, force: true });
  }
});

test("classification retains the path but excludes supplied pure renames", () => {
  const pureRenamePath =
    "templates/design/e2e/interaction-responsive-music-app.spec.ts";
  const pureRenameScope = classifyChangedPaths(
    [pureRenamePath],
    [pureRenamePath],
  );
  assert.deepEqual(
    pureRenameScope.designCanvasE2eSpecs,
    [pureRenamePath],
    "workflow gates must still see the renamed Design spec",
  );
  assert.deepEqual(
    pureRenameScope.designCanvasE2eDiagnosticSpecs,
    [],
    "a pure same-directory rename should not launch changed-spec diagnostics",
  );
  assert.deepEqual(
    pureRenameScope.changedPaths,
    [pureRenamePath],
    "rename suppression must not erase the changed path from normal CI scope",
  );
  assert.equal(
    pureRenameScope.checks.design_canvas_core_regression,
    false,
    "a pure spec rename should not launch the broad Design regression suite",
  );
  assert.equal(
    pureRenameScope.checks.design_canvas_broad_workflows,
    true,
    "the corresponding dedicated Design workflow shard must remain selected",
  );
});

test("only diagnostics use the filtered Design spec list", () => {
  const workflow = readFileSync(
    join(process.cwd(), ".github/workflows/ci.yml"),
    "utf8",
  );
  const broadStart = workflow.indexOf("  design-canvas-broad-workflows:\n");
  const diagnosticsStart = workflow.indexOf(
    "  design-canvas-changed-spec-diagnostics:\n",
  );
  const diagnosticsEnd = workflow.indexOf(
    "\n  pre-auth-session-replay-smoke:",
    diagnosticsStart,
  );
  assert.notEqual(broadStart, -1);
  assert.notEqual(diagnosticsStart, -1);

  const broadJob = workflow.slice(broadStart, diagnosticsStart);
  const diagnosticsJob = workflow.slice(
    diagnosticsStart,
    diagnosticsEnd === -1 ? undefined : diagnosticsEnd,
  );
  assert.ok(
    broadJob.includes("needs.change-scope.outputs.design_canvas_e2e_specs"),
  );
  assert.doesNotMatch(broadJob, /design_canvas_e2e_diagnostic_specs/u);
  assert.ok(
    diagnosticsJob.includes(
      "needs.change-scope.outputs.design_canvas_e2e_diagnostic_specs",
    ),
  );
});

test("runs the guards when docs add or rename a page browsers load", () => {
  const repoPath = mkdtempSync(join(tmpdir(), "ci-change-scope-added-"));
  const runGit = (...args: string[]) => {
    const result = spawnSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      0,
      `git ${args.join(" ")} failed: ${result.stderr}`,
    );
    return result.stdout.trim();
  };

  try {
    runGit("init", "--quiet");
    runGit("config", "user.name", "CI Change Scope Test");
    runGit("config", "user.email", "ci-change-scope@example.invalid");
    const pagePath = "packages/core/docs/content/actions.md";
    mkdirSync(join(repoPath, "packages/core/docs/content"), {
      recursive: true,
    });
    writeFileSync(join(repoPath, pagePath), "# Actions\n");
    runGit("add", "--all");
    runGit("commit", "--quiet", "-m", "add docs page");
    const baseSha = runGit("rev-parse", "HEAD");

    const scopeFor = (message: string, change: () => void) => {
      runGit("reset", "--hard", baseSha);
      change();
      runGit("add", "--all");
      runGit("commit", "--quiet", "-m", message);
      const headSha = runGit("rev-parse", "HEAD");
      const addedPaths = readAddedPaths(baseSha, headSha, repoPath);
      const scope = classifyChangedPaths(
        readChangedPaths(baseSha, headSha, repoPath),
        [],
        repoPath,
        readDeletedPaths(baseSha, headSha, repoPath),
        addedPaths,
      );
      return {
        addedPaths,
        docsOnly: scope.docsOnly,
        guards: scope.checks.guards,
      };
    };

    // An edit keeps the page's name.
    assert.deepEqual(
      scopeFor("edit docs page", () => {
        writeFileSync(join(repoPath, pagePath), "# Actions\n\nMore.\n");
      }),
      { addedPaths: [], docsOnly: true, guards: false },
    );
    const renamedPath = "packages/core/docs/content/cookie-notice.md";
    assert.deepEqual(
      scopeFor("rename docs page", () => {
        runGit("mv", pagePath, renamedPath);
      }),
      { addedPaths: [renamedPath], docsOnly: true, guards: true },
    );
    // Plans and other repo docs never reach a browser.
    const planPath = "docs/plans/cookie-notice.md";
    assert.deepEqual(
      scopeFor("add plan", () => {
        mkdirSync(join(repoPath, "docs/plans"), { recursive: true });
        writeFileSync(join(repoPath, planPath), "# Plan\n");
      }),
      { addedPaths: [planPath], docsOnly: true, guards: false },
    );
  } finally {
    rmSync(repoPath, { recursive: true, force: true });
  }
});

test("reads changed, deleted and added paths in a blobless clone without fetching blobs", () => {
  const root = mkdtempSync(join(tmpdir(), "ci-change-scope-blobless-"));
  const sourcePath = join(root, "source");
  const clonePath = join(root, "clone");
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    assert.equal(
      result.status,
      0,
      `git ${args.join(" ")} failed: ${result.stderr}`,
    );
    return result.stdout.trim();
  };

  try {
    mkdirSync(sourcePath);
    git(sourcePath, "init", "--quiet");
    git(sourcePath, "config", "user.name", "CI Change Scope Test");
    git(sourcePath, "config", "user.email", "ci-change-scope@example.invalid");
    const body = Array.from({ length: 40 }, (_, line) => `line ${line}\n`);
    writeFileSync(join(sourcePath, "old.ts"), body.join(""));
    writeFileSync(join(sourcePath, "gone.ts"), "export const gone = 1;\n");
    git(sourcePath, "add", "--all");
    git(sourcePath, "commit", "--quiet", "-m", "base");
    const baseSha = git(sourcePath, "rev-parse", "HEAD");
    rmSync(join(sourcePath, "old.ts"));
    rmSync(join(sourcePath, "gone.ts"));
    writeFileSync(join(sourcePath, "new.ts"), [...body, "edited\n"].join(""));
    git(sourcePath, "add", "--all");
    git(sourcePath, "commit", "--quiet", "-m", "head");
    const headSha = git(sourcePath, "rev-parse", "HEAD");

    git(
      root,
      "-c",
      "uploadpack.allowFilter=true",
      "clone",
      "--quiet",
      "--no-checkout",
      "--filter=blob:none",
      "--upload-pack",
      "git -c uploadpack.allowFilter=true upload-pack",
      `file://${sourcePath}`,
      clonePath,
    );
    git(
      clonePath,
      "remote",
      "set-url",
      "origin",
      "https://invalid.example/none.git",
    );

    assert.deepEqual(readChangedPaths(baseSha, headSha, clonePath).sort(), [
      "gone.ts",
      "new.ts",
      "old.ts",
    ]);
    assert.deepEqual(readDeletedPaths(baseSha, headSha, clonePath).sort(), [
      "gone.ts",
      "old.ts",
    ]);
    assert.deepEqual(readAddedPaths(baseSha, headSha, clonePath), ["new.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reads diffs that name more than a megabyte of paths", () => {
  const repoPath = mkdtempSync(join(tmpdir(), "ci-change-scope-large-"));
  const runGit = (...args: string[]) => {
    const result = spawnSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      0,
      `git ${args.join(" ")} failed: ${result.stderr}`,
    );
    return result.stdout.trim();
  };

  try {
    runGit("init", "--quiet");
    runGit("config", "user.name", "CI Change Scope Test");
    runGit("config", "user.email", "ci-change-scope@example.invalid");
    writeFileSync(join(repoPath, "README.md"), "base\n");
    runGit("add", "--all");
    runGit("commit", "--quiet", "-m", "base");
    const baseSha = runGit("rev-parse", "HEAD");

    const dir = `packages/${"nested-directory-name/".repeat(10)}`;
    mkdirSync(join(repoPath, dir), { recursive: true });
    const paths: string[] = [];
    for (let index = 0; index < 4500; index++) {
      const path = `${dir}${String(index).padStart(5, "0")}-${"x".repeat(20)}.ts`;
      writeFileSync(join(repoPath, path), "");
      paths.push(path);
    }
    runGit("add", "--all");
    runGit("commit", "--quiet", "-m", "many paths");
    const headSha = runGit("rev-parse", "HEAD");

    assert.ok(paths.join("\0").length > 1024 * 1024);
    assert.equal(readChangedPaths(baseSha, headSha, repoPath).length, 4500);
    assert.equal(readAddedPaths(baseSha, headSha, repoPath).length, 4500);
  } finally {
    rmSync(repoPath, { recursive: true, force: true });
  }
});

test("proves changelog-only Typecheck scope using both sides of the complete Git diff", () => {
  const repoPath = mkdtempSync(join(tmpdir(), "ci-changelog-typecheck-"));
  const classifier = fileURLToPath(
    new URL("./ci-change-scope.ts", import.meta.url),
  );
  const changelog = "templates/brain/changelog/2026-11-26-eval-history.md";
  const oldNote = "templates/brain/changelog/2026-11-25-eval-history.md";
  const code = "templates/brain/app/eval.ts";
  const workflow = ".github/workflows/ci.yml";
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: repoPath, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (path: string, body: string) => {
    mkdirSync(dirname(join(repoPath, path)), { recursive: true });
    writeFileSync(join(repoPath, path), body);
  };
  const commit = () => {
    git("add", "-A");
    git("commit", "-qm", "Fixture");
    return git("rev-parse", "HEAD");
  };

  try {
    git("init", "-q");
    git("config", "user.name", "Steve Sewell");
    git("config", "user.email", "steve@builder.io");
    write(oldNote, "# Previous entry\n");
    write(code, "export const old = true;\n");
    write(workflow, "name: Existing CI\n");
    const base = commit();
    const output = join(repoPath, "outputs");
    const inspect = (head: string) => {
      writeFileSync(output, "");
      const result = spawnSync(
        process.execPath,
        ["--experimental-strip-types", classifier],
        {
          cwd: repoPath,
          encoding: "utf8",
          env: {
            ...process.env,
            CI_BASE_SHA: base,
            CI_HEAD_SHA: head,
            GITHUB_OUTPUT: output,
          },
        },
      );
      const fields = readFileSync(output, "utf8");
      rmSync(output);
      return { status: result.status, stderr: result.stderr, fields };
    };
    const verify = (change: () => void, expected: boolean) => {
      git("switch", "-q", "--detach", base);
      change();
      const result = inspect(commit());
      assert.equal(result.status, 0, result.stderr);
      assert.match(
        result.fields,
        new RegExp(`^changelog_only=${expected}$`, "m"),
      );
      if (expected) assert.match(result.fields, /^typecheck=false$/m);
    };

    verify(() => write(changelog, "# New entry\n"), true);
    verify(() => git("mv", oldNote, changelog), true);
    verify(() => git("mv", code, changelog), false);
    verify(() => git("mv", workflow, changelog), false);
    verify(() => {
      write(changelog, "# New entry\n");
      write(code, "export const old = false;\n");
    }, false);
    verify(() => {
      write(changelog, "# New entry\n");
      write(workflow, "name: Changed CI\n");
    }, false);
    verify(
      () => symlinkSync("../../app/eval.ts", join(repoPath, changelog)),
      false,
    );
    assert.match(inspect(base).fields, /^changelog_only=false$/m);
    const malformed = inspect("not-a-commit");
    assert.notEqual(malformed.status, 0);
    assert.doesNotMatch(malformed.fields, /^changelog_only=true$/m);
  } finally {
    rmSync(repoPath, { recursive: true, force: true });
  }
});
