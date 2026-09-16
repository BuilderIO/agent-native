import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PR_VISUAL_RECAP_WORKFLOW_YML } from "./pr-visual-recap-workflow.js";
import { buildReusableCallerWorkflow } from "./recap.js";

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

  it("wakes label-gated recaps when a PR label is applied", () => {
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain(
      "types: [opened, synchronize, reopened, ready_for_review, labeled, closed]",
    );
  });

  it("forwards label gates from reusable callers", () => {
    expect(buildReusableCallerWorkflow()).toContain(
      "required-labels: ${{ vars.VISUAL_RECAP_REQUIRED_LABELS || '' }}",
    );
  });

  it("wakes labeled events when reusable callers configure labels directly", () => {
    const workflow = buildReusableCallerWorkflow({
      requiredLabels: "visual recap",
    });

    expect(workflow).toContain("if: github.event.action != 'labeled' || true");
    expect(workflow).toContain('required-labels: "visual recap"');
  });

  it("bundles the canonical workflow byte for byte", () => {
    const source = readFileSync(
      path.join(repoRoot, ".github/workflows/pr-visual-recap.yml"),
      "utf8",
    );

    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toBe(source);
  });
});
