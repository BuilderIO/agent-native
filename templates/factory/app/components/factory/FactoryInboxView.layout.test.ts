import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readViewSource() {
  return readFileSync(
    new URL("./FactoryInboxView.tsx", import.meta.url),
    "utf8",
  );
}

describe("FactoryInboxView", () => {
  it("keeps a paginated two-pane workbench with source evidence and item actions", () => {
    const source = readViewSource();
    expect(source).toContain("list-triage-items");
    expect(source).toContain("get-slack-feedback-context");
    expect(source).toContain("TriageRiskPill");
    expect(source).toContain("TriageStatusPill");
    expect(source).toContain('t("triage.evidence")');
    expect(source).toContain('t("triage.actionsTaken")');
    expect(source).toContain("nextCursor");
    expect(source).toContain("inboxListColumns");
    expect(source).not.toContain("reviewListColumns");
  });
});
