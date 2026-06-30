import { describe, expect, it } from "vitest";

import validateLocalPlanSource from "./validate-local-plan-source.js";

const VALID_PLAN = [
  "---",
  'title: "Valid plan"',
  'kind: "plan"',
  "---",
  "",
  "# Valid plan",
  "",
  "Some plan prose.",
  "",
].join("\n");

// The issue's repro: a checklist nested as JSON inside a TabsBlock, missing the
// required per-item `id`. The renderer rejects it; this action must too.
const NESTED_CHECKLIST_MISSING_ID = [
  "---",
  'title: "Nested checklist"',
  'kind: "plan"',
  "---",
  "",
  "# Nested checklist",
  "",
  "<TabsBlock",
  '  id="tabs-1"',
  "  tabs={[",
  '    { id: "tab-a", label: "Tasks", blocks: [',
  '      { id: "cl-1", type: "checklist", data: { items: [ { label: "No id here" } ] } }',
  "    ] }",
  "  ]}",
  "/>",
  "",
].join("\n");

describe("validate-local-plan-source", () => {
  it("returns valid for a plan the renderer accepts", async () => {
    const result = await validateLocalPlanSource.run({
      mdx: { "plan.mdx": VALID_PLAN },
    });
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it("returns the renderer's schema-path issue for a nested checklist missing an id", async () => {
    const result = await validateLocalPlanSource.run({
      mdx: { "plan.mdx": NESTED_CHECKLIST_MISSING_ID },
    });
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    const joined = result.issues
      .map((issue) => `${issue.path} ${issue.message}`)
      .join("\n");
    expect(joined).toMatch(/items\[0\]\.id/);
  });
});
