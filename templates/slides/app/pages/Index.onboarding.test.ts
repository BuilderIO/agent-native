import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "Index.tsx"),
  "utf8",
);

describe("Slides first-run prompt gate", () => {
  it("uses the shared server decision instead of a signup-cookie heuristic", () => {
    expect(source).toContain("fetchFirstRunOnboardingStatus");
    expect(source).toContain("FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT");
    expect(source).not.toContain("agent-native-first-run=");
    expect(source).not.toContain("fallbackTimer");
  });
});
