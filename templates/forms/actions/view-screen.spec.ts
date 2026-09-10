import { describe, expect, it } from "vitest";

import { buildFormSelectionSummary, summarizeFields } from "./view-screen.js";

/**
 * `patch-form-fields` upsert replaces a field wholesale. The screen preview
 * caps a field's options, so without `optionsTruncated` a capped preview is
 * indistinguishable from the real list and a caller that rebuilds the field
 * from it silently deletes every option past the cap.
 */
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

/**
 * The form builder writes `forms-selection` for whichever form is open in
 * that browser tab. It must only be surfaced for the form it names — a
 * selection left over from a form the user has since navigated away from
 * must never be attributed to a different form the agent is now looking at.
 */
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
