import { describe, expect, it } from "vitest";

import { summarizeFields } from "./view-screen.js";

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
