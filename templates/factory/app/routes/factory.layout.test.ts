import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource() {
  return readFileSync(new URL("./factory.tsx", import.meta.url), "utf8");
}

describe("Factory route factory switching", () => {
  it("remounts Settings and Automations when factoryId changes", () => {
    const source = readSource();
    expect(source).toContain(
      "<FactorySettingsView key={factoryId} factoryId={factoryId} />",
    );
    expect(source).toContain(
      "<AutomationsView key={factoryId} factoryId={factoryId} t={t} />",
    );
  });

  it("clears queued automation polling when factoryId changes", () => {
    const source = readSource();
    expect(source).toContain("setQueuedRuns({})");
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*setQueuedRuns\(\{\}\);\s*\}, \[factoryId\]\);/,
    );
  });
});
