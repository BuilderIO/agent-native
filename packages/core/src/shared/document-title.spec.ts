import { describe, expect, it } from "vitest";

import {
  isHumanReadableDocumentTitle,
  normalizeDocumentTitle,
} from "./document-title.js";

describe("document title normalization", () => {
  it("rejects structured JSON that would leak payloads into a browser tab", () => {
    expect(
      isHumanReadableDocumentTitle(
        '[{"id":"automation-1","status":"success"}]',
      ),
    ).toBe(false);
    expect(isHumanReadableDocumentTitle('{"id":"automation-1"}')).toBe(false);
  });

  it("keeps ordinary titles and falls back for invalid values", () => {
    expect(isHumanReadableDocumentTitle("Automations")).toBe(true);
    expect(isHumanReadableDocumentTitle("[draft]")).toBe(true);
    expect(normalizeDocumentTitle("  Automations  ", "Plan")).toBe(
      "Automations",
    );
    expect(normalizeDocumentTitle('[{"id":"automation-1"}]', "Plan")).toBe(
      "Plan",
    );
    expect(normalizeDocumentTitle(null, "Plan")).toBe("Plan");
  });
});
