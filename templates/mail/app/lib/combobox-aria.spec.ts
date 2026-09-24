import { describe, expect, it } from "vitest";

import { getActiveDescendantId } from "./combobox-aria";

describe("getActiveDescendantId", () => {
  it("references a rendered option only while the list is expanded", () => {
    expect(getActiveDescendantId("suggestion-", true, 0, 2)).toBe(
      "suggestion-0",
    );
    expect(getActiveDescendantId("suggestion-", false, 0, 2)).toBeUndefined();
  });

  it("omits stale selection indices after suggestions shrink or disappear", () => {
    expect(getActiveDescendantId("suggestion-", true, 2, 2)).toBeUndefined();
    expect(getActiveDescendantId("suggestion-", true, 0, 0)).toBeUndefined();
  });

  it("omits negative and non-integer selection indices", () => {
    expect(getActiveDescendantId("suggestion-", true, -1, 3)).toBeUndefined();
    expect(
      getActiveDescendantId("suggestion-", true, Number.NaN, 3),
    ).toBeUndefined();
  });
});
