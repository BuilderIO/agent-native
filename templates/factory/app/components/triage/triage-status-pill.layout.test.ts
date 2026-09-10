import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource() {
  return readFileSync(
    new URL("./triage-status-pill.tsx", import.meta.url),
    "utf8",
  );
}

describe("TriageStatusPill tones", () => {
  it("paints automation_started violet, not the gray primary info chip", () => {
    const source = readSource();
    expect(source).toContain('case "automation_started":');
    expect(source).toContain('return "progress"');
    expect(source).toContain(
      'progress: "bg-violet-500/15 text-violet-600 dark:text-violet-400"',
    );
    expect(source).toMatch(/case "automation_started":\s*return "progress";/);
  });
});
