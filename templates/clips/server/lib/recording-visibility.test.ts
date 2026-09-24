import { describe, expect, it } from "vitest";

import { resolveRecordingVisibility } from "./recordings";

describe("resolveRecordingVisibility", () => {
  it("uses the configured organization visibility when no explicit value is passed", () => {
    expect(resolveRecordingVisibility(undefined, "private")).toBe("private");
    expect(resolveRecordingVisibility(undefined, "org")).toBe("org");
  });

  it("keeps explicit visibility ahead of the organization default", () => {
    expect(resolveRecordingVisibility("org", "private")).toBe("org");
  });

  it("falls back to public when the configured value is missing or invalid", () => {
    expect(resolveRecordingVisibility(undefined, undefined)).toBe("public");
    expect(resolveRecordingVisibility(undefined, "unknown")).toBe("public");
  });
});
