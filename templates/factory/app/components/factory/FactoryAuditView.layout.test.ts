import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readViewSource() {
  return readFileSync(
    new URL("./FactoryAuditView.tsx", import.meta.url),
    "utf8",
  );
}

describe("FactoryAuditView outcome-first audit", () => {
  it("renders run headlines from investigated outcomes instead of raw event checks", () => {
    const source = readViewSource();
    expect(source).toContain("factory-audit-split");
    expect(source).toContain("factory-audit-run-list");
    expect(source).toContain("factory-audit-run-fields");
    expect(source).toContain("formatRunHeadline(run.counts, t)");
    expect(source).toContain("[overflow-wrap:anywhere]");
    expect(source).toContain("run.items");
    expect(source).toContain('t("factoryRoute.auditTrace")');
    expect(source.indexOf("AuditDecisionFacts")).toBeLessThan(
      source.indexOf('t("factoryRoute.auditWhy")'),
    );
    expect(source).toContain("SlackMrkdwn");
    expect(source).toContain("inline");
    expect(source).toContain("safeHttpUrl");
    expect(source).not.toContain("formatAuditCountLabel");
    expect(source).not.toContain("Slack thread");
  });

  it("stacks recent-run fields with a list container query, not a viewport breakpoint", () => {
    const source = readViewSource();
    const css = readFileSync(
      new URL("../../global.css", import.meta.url),
      "utf8",
    );
    expect(css).toContain("container: audit-run / inline-size");
    expect(css).toContain("@container audit-run (min-width: 20rem)");
    expect(css).toContain("justify-self: end");
    expect(css).toContain("@container agent-native-main (min-width: 50rem)");
    expect(source).not.toContain(
      "lg:grid-cols-[minmax(240px,.4fr)_minmax(0,1fr)]",
    );
  });

  it("filters and paginates recent runs like Inbox", () => {
    const source = readViewSource();
    expect(source).toContain("setAuditFilter");
    expect(source).toContain('t("factoryRoute.auditAutomationLabel")');
    expect(source).toContain('t("triage.rangeLabel")');
    expect(source).toContain("goToNextPage");
    expect(source).toContain("goToPreviousPage");
    expect(source).toContain('behavior: "smooth"');
    expect(source).toContain("shouldScrollOnSelectRef");
    const runListIdx = source.indexOf('className="factory-audit-run-list"');
    const filtersIdx = source.indexOf("runListFilters");
    const rangeFilterIdx = source.indexOf('id="factory-audit-range-filter"');
    expect(runListIdx).toBeGreaterThan(-1);
    expect(filtersIdx).toBeGreaterThan(-1);
    expect(rangeFilterIdx).toBeGreaterThan(-1);
    expect(source.indexOf("{runListFilters}")).toBeGreaterThan(runListIdx);
  });
});
