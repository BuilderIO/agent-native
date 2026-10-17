import { describe, expect, it } from "vitest";

import { exportPlanContentToMdxFolder } from "../server/plan-mdx.js";
import { storedPlanContentSchema } from "../shared/plan-content.js";
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

  it("does not trust a caller-supplied plan id to accept legacy defaults", async () => {
    const content = storedPlanContentSchema.parse({
      version: 2,
      title: "Exported plan",
      blocks: [
        { id: "questions", type: "question-form", data: {} },
        { id: "tabs", type: "tabs", data: {} },
        { id: "model", type: "data-model", data: {} },
      ],
    });
    const mdx = await exportPlanContentToMdxFolder({
      content,
      title: "Exported plan",
      planId: "plan-exported",
    });

    const result = await validateLocalPlanSource.run({ mdx });
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("keeps authored empty fields invalid without a stored plan id", async () => {
    const result = await validateLocalPlanSource.run({
      mdx: {
        "plan.mdx": [
          "---",
          'title: "New authored plan"',
          'kind: "plan"',
          "---",
          "",
          '<QuestionForm id="questions" questions={[]} />',
          "",
        ].join("\n"),
      },
    });
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("rejects omitted required MDX fields instead of accepting parser defaults", async () => {
    const result = await validateLocalPlanSource.run({
      mdx: {
        "plan.mdx": [
          "---",
          'title: "Missing required field"',
          'kind: "plan"',
          "---",
          "",
          '<Checklist id="checklist" />',
          "",
        ].join("\n"),
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      path: "blocks[0].data.items",
      message: "Authoring checklist blocks require data.items.",
    });
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
