import { describe, expect, it } from "vitest";

import { buildFormSelectionSummary, summarizeFields } from "./view-screen.js";

function selectField(optionCount: number) {
  return {
    id: "f1",
    type: "select",
    label: "Pick one",
    required: false,
    options: Array.from({ length: optionCount }, (_, i) => `opt-${i + 1}`),
  } as never;
}

describe("summarizeFields option preview", () => {
  it("flags a capped option list and reports the true count", () => {
    const [field] = summarizeFields([selectField(20)]) as [
      { options: string[]; optionCount: number; optionsTruncated: boolean },
    ];
    expect(field.options).toHaveLength(8);
    expect(field.optionCount).toBe(20);
    expect(field.optionsTruncated).toBe(true);
  });

  it("does not flag a complete option list", () => {
    const [field] = summarizeFields([selectField(8)]) as [
      { options: string[]; optionsTruncated: boolean },
    ];
    expect(field.options).toHaveLength(8);
    expect(field.optionsTruncated).toBe(false);
  });
});

describe("buildFormSelectionSummary", () => {
  it("returns null when there is no selection", () => {
    expect(buildFormSelectionSummary(null, "form-1")).toBeNull();
  });

  it("returns null when the selection names a different form", () => {
    expect(
      buildFormSelectionSummary(
        {
          formId: "form-2",
          selectedFieldId: "f1",
          selectedFieldLabel: "Name",
          selectedFieldType: "text",
        },
        "form-1",
      ),
    ).toBeNull();
  });

  it("returns null when the selection has no selected field", () => {
    expect(
      buildFormSelectionSummary({ formId: "form-1" }, "form-1"),
    ).toBeNull();
  });

  it("surfaces the selected field with an actionable hint naming the form and field ids", () => {
    const summary = buildFormSelectionSummary(
      {
        formId: "form-1",
        selectedFieldId: "f1",
        selectedFieldLabel: "Name",
        selectedFieldType: "text",
      },
      "form-1",
    );
    expect(summary).toEqual({
      fieldId: "f1",
      label: "Name",
      type: "text",
      hint: expect.stringContaining("patch-form-fields"),
    });
    expect(summary?.hint).toContain('id="form-1"');
    expect(summary?.hint).toContain('"f1"');
  });
});
