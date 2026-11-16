import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkRuleFilePairs } from "./guard-rule-one-file";

test("requires AGENTS.md to link to the real CLAUDE.md and catches a planted mismatch", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rule-one-file-"));
  try {
    writeFileSync(path.join(root, "CLAUDE.md"), "canonical rules\n");
    symlinkSync("CLAUDE.md", path.join(root, "AGENTS.md"));
    assert.deepEqual(checkRuleFilePairs(root, ["AGENTS.md", "CLAUDE.md"]), []);

    rmSync(path.join(root, "AGENTS.md"));
    writeFileSync(path.join(root, "AGENTS.md"), "mismatched rules\n");
    assert.deepEqual(checkRuleFilePairs(root, ["AGENTS.md", "CLAUDE.md"]), [
      ".: AGENTS.md must be a symlink to CLAUDE.md",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("keeps listed scaffold payload copies byte-identical", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rule-one-file-copy-"));
  try {
    const directory = path.join(root, "templates", "demo");
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "AGENTS.md"), "template rules\n");
    writeFileSync(path.join(directory, "CLAUDE.md"), "template rules\n");
    const copies = new Map([
      ["templates/demo", "scaffold consumers require real AGENTS.md"],
    ]);
    assert.deepEqual(
      checkRuleFilePairs(
        root,
        ["templates/demo/AGENTS.md", "templates/demo/CLAUDE.md"],
        copies,
      ),
      [],
    );
    writeFileSync(path.join(directory, "CLAUDE.md"), "changed rules\n");
    assert.deepEqual(
      checkRuleFilePairs(
        root,
        ["templates/demo/AGENTS.md", "templates/demo/CLAUDE.md"],
        copies,
      ),
      [
        "templates/demo: copy contents differ (scaffold consumers require real AGENTS.md)",
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
