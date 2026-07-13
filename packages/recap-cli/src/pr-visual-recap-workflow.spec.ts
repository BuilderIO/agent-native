import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PR_VISUAL_RECAP_WORKFLOW_YML } from "./pr-visual-recap-workflow.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("the recap installer workflow", () => {
  it("keeps Bash semantics on configurable runners", () => {
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain(
      "    defaults:\n      run:\n        shell: bash",
    );
  });

  it("bundles the canonical workflow byte for byte", () => {
    const source = readFileSync(
      path.join(repoRoot, ".github/workflows/pr-visual-recap.yml"),
      "utf8",
    );

    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toBe(source);
  });
});
