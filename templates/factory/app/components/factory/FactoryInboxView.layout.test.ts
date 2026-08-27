import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readViewSource() {
  return readFileSync(
    new URL("./FactoryInboxView.tsx", import.meta.url),
    "utf8",
  );
}

describe("FactoryInboxView", () => {
  it("opens a full-width list, then a full-width detail with thread evidence", () => {
    const source = readViewSource();
    expect(source).toContain("list-triage-items");
    expect(source).toContain("get-slack-feedback-context");
    expect(source).toContain("TriageRiskPill");
    expect(source).toContain("TriageStatusPill");
    expect(source).toContain('t("triage.evidence")');
    expect(source).toContain('t("triage.actionsTaken")');
    expect(source).toContain("nextCursor");
    expect(source).toContain("inboxListColumns");
    expect(source).toContain("factory-inbox-pane-detail");
    expect(source).toContain('t("factoryRoute.inboxBackToList")');
    expect(source).toContain("lg:grid-cols-2");
    expect(source).not.toContain("reviewListColumns");
    expect(source).not.toContain(
      "lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.4fr)]",
    );
    expect(source).not.toContain('t("factoryRoute.selectObservation")');
  });
});
