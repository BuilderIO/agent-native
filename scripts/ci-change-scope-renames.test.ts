import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  classifyChangedPaths,
  readChangedPaths,
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
      return {
        changedPaths,
        pureRenames,
        scope: classifyChangedPaths(changedPaths, pureRenames),
      };
    };

    const pureRenamePath = "templates/design/e2e/renamed.spec.ts";
    const pureRenameHead = commitFromBase("rename Design spec", () => {
      runGit("mv", sourcePath, pureRenamePath);
    });
    const pureRename = scopeFor(pureRenameHead);
    assert.deepEqual(pureRename.pureRenames, [pureRenamePath]);
    assert.deepEqual(pureRename.scope.designCanvasE2eSpecs, []);
    assert.deepEqual(pureRename.changedPaths, [pureRenamePath]);
    assert.equal(pureRename.scope.checks.design_canvas_core_regression, true);

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
      editedRename.scope.designCanvasE2eSpecs.includes(editedRenamePath),
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
      crossDirectoryRename.scope.designCanvasE2eSpecs.includes(
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
      modeChangeRename.scope.designCanvasE2eSpecs.includes(modeChangePath),
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
      introducedSpec.scope.designCanvasE2eSpecs.includes(introducedSpecPath),
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
  } finally {
    rmSync(repoPath, { recursive: true, force: true });
  }
});

test("classification retains the path but excludes supplied pure renames", () => {
  const pureRenamePath = "templates/design/e2e/renamed-interaction.spec.ts";
  const pureRenameScope = classifyChangedPaths(
    [pureRenamePath],
    [pureRenamePath],
  );
  assert.deepEqual(
    pureRenameScope.designCanvasE2eSpecs,
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
    true,
    "the required Design regression gate must still run for a renamed spec",
  );
});
