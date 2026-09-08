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
    expect(source).toContain('t("triage.evidenceDescription")');
    expect(source).toContain('t("triage.actionsTaken")');
    expect(source).toContain('t("triage.actionsTakenDescription")');
    expect(source).toContain("nextCursor");
    expect(source).toContain("inboxListColumns");
    expect(source).toContain("factory-inbox-pane-detail");
    expect(source).toContain('t("factoryRoute.inboxBackToList")');
    expect(source).toContain('t("factoryRoute.inboxTab")');
    expect(source).toContain("InboxFilterSelect");
    expect(source).toContain("writeInboxFilterParam");
    expect(source).toContain("updatedAfterForRange");
    expect(source).toContain('t("triage.rangeLabel")');
    expect(source).toContain('t("triage.sourcePlaceholder")');
    expect(source).toContain("InboxMetricCards");
    expect(source).toContain('t("factoryRoute.metricSignals")');
    expect(source).toContain('t("factoryRoute.metricRecommendations")');
    expect(source).toContain('t("factoryRoute.metricRuns")');
    expect(source).toContain('t("factoryRoute.metricSignalsHint")');
    expect(source).toContain('t("factoryRoute.metricRecommendationsHint")');
    expect(source).toContain('t("factoryRoute.metricRunsHint")');
    expect(source).toContain("IconBroadcast");
    expect(source).toContain("IconScale");
    expect(source).toContain("IconPlayerPlay");
    expect(source).toContain("{!selectedId ?");
    expect(source).toContain("SlackThreadPane");
    expect(source).toContain("InboxFeedbackSection");
    expect(source).toContain("ms-6 border-s border-border ps-3");
    const reasonAt = source.indexOf("{reason ? (");
    const feedbackAt = source.indexOf("<InboxFeedbackSection");
    expect(reasonAt).toBeGreaterThan(-1);
    expect(feedbackAt).toBeGreaterThan(reasonAt);
    expect(source).not.toContain("pairActionsToMessages");
    expect(source).not.toContain("SlackPairedDetail");
    expect(source).not.toContain("InboxActionControls");
    expect(source).toContain("lg:grid-cols-2");
    expect(source).not.toContain("max-h-[32rem]");
    expect(source).not.toContain("overflow-y-auto");
    expect(source).not.toContain("reviewListColumns");
    expect(source).not.toContain(
      "lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.4fr)]",
    );
    expect(source).toContain('t("triage.author")');
    expect(source).toContain("item.author");
    expect(source).toContain("resolveInboxSourceUrl");
    expect(source).toContain('t("triage.feedbackError")');
    expect(source).toContain("triage.statusValues.");
    expect(source).toContain('t("triage.untitled")');
    expect(source).not.toContain('t("factoryRoute.selectObservation")');
  });
});
