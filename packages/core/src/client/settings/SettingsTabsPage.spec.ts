import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function settingsTabsPageSource(): string {
  return readFileSync(
    new URL("./SettingsTabsPage.tsx", import.meta.url),
    "utf8",
  );
}

describe("SettingsTabsPage group labels", () => {
  it("renders the Mail automation group as Title Case", () => {
    const source = settingsTabsPageSource();

    expect(source).toContain('automation: "Automation"');
  });

  it("keeps every mapped group label Title Case, matching Personal/Integrations/Workspace/Agent", () => {
    const source = settingsTabsPageSource();
    const match = source.match(
      /const tabGroupLabels: Record<string, string> = \{([\s\S]*?)\};/,
    );
    expect(match).not.toBeNull();

    const labels = [...match![1].matchAll(/:\s*"([^"]+)"/g)].map(
      ([, label]) => label,
    );
    expect(labels.length).toBeGreaterThan(0);

    for (const label of labels) {
      expect(label[0]).toBe(label[0].toUpperCase());
    }
  });
});
