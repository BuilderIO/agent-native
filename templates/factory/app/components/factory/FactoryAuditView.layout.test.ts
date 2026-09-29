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
    expect(source).toContain("run.inbox");
    expect(source).toContain("run.work");
    expect(source).toContain("run.actions");
    expect(source).toContain('t("factoryRoute.auditSectionItems")');
    expect(source).toContain(
      "dedupeAuditItems([...inbox, ...work, ...actions, ...items])",
    );
    expect(source).toContain('t("factoryRoute.auditTrace")');
    expect(source.indexOf("AuditDecisionFacts")).toBeLessThan(
      source.indexOf('t("factoryRoute.auditWhy")'),
    );
    expect(source).toContain("SlackMrkdwn");
    expect(source).toContain("inline");
    expect(source).toContain("auditPullRequestLabel");
    expect(source).toContain("AuditSummaryBody");
    expect(source).toContain('variant="outline"');
    expect(source).toContain('t("factoryRoute.auditViewMore")');
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

  it("reports fetching state so the tab bar refresh trigger can show a spinner", () => {
    const source = readViewSource();
    expect(source).toContain(
      "onFetchingChange?: (isFetching: boolean) => void",
    );
    expect(source).toContain("if (refreshToken === 0) return");
    expect(source).toContain("void refetchAudit()");
    expect(source).toContain("onFetchingChange?.(auditQuery.isFetching)");
    expect(source.indexOf("[refreshToken, refetchAudit]")).toBeLessThan(
      source.indexOf("[auditQuery.isFetching, onFetchingChange]"),
    );
  });

  it("shows how long a completed run took, not just how long ago it started", () => {
    const source = readViewSource();
    expect(source).toContain(
      "const duration = formatAuditDuration(run.startedAt, run.finishedAt);",
    );
    expect(source).toContain(
      't("factoryRoute.auditRunDuration", { duration })',
    );
    expect(source).toContain("if (finishedAt == null) return null;");
  });

  it("separates the run detail into a plain status/timing line, an Open thread action, and a stats row", () => {
    const source = readViewSource();
    expect(
      source.match(/formatAuditAge\(\s*selectedRun\.startedAt/g),
    ).toBeNull();
    expect(
      source.match(/formatRunHeadline\(selectedRun\.counts, t\)/g),
    ).toBeNull();
    expect(source).toContain("<AuditStatus status={runHeadlineStatus(run)} />");
    expect(source).toContain('t("factoryRoute.auditRunBegan"');
    expect(source).toContain('t("factoryRoute.auditRunPromptVersion"');
    expect(source).toContain(
      't("factoryRoute.auditRunDuration", { duration })',
    );
    expect(
      source.indexOf("<AuditStatus status={runHeadlineStatus(run)} />"),
    ).toBeLessThan(source.indexOf('t("factoryRoute.auditOpenThread")'));
    expect(source).toContain("<IconMessageCircle");
    expect(source.indexOf('t("factoryRoute.auditOpenThread")')).toBeLessThan(
      source.indexOf('t("factoryRoute.auditAdded", { count: added }'),
    );
    expect(source).toContain('t("factoryRoute.auditAdded", { count: added }');
    expect(source).toContain(
      't("factoryRoute.auditExamined", { count: listed }',
    );
    expect(source).toContain(
      't("factoryRoute.auditFailed", { count: run.counts.failed }',
    );
    expect(source).toContain('t("factoryRoute.auditStartedCount"');
    expect(source).toContain("count: run.counts.dispatched");
    expect(source).toContain(
      't("factoryRoute.auditSkipped", { count: run.counts.held }',
    );
  });

  it("flags each item's outcome with a colored pill instead of only the plain-text hint", () => {
    const source = readViewSource();
    expect(source).toContain(
      'import { Pill, type PillTone } from "@/components/triage/triage-status-pill";',
    );
    expect(source).toContain(
      '<Pill value={t("factoryRoute.auditNewThisRun")} tone="progress" />',
    );
    expect(source).toContain("tone={outcomeTone(item.outcome)}");
    expect(source).toContain("function outcomeTone(");
    expect(source).not.toContain(
      "const parts = [formatItemOutcome(item.outcome, t)];",
    );
    expect(source).toContain(
      "const hint = formatItemRowHint(item, t, listedItemIds);",
    );
    expect(source).toContain("{hint ? (");
    expect(source).toContain(
      "listedItemIds.has(item.itemId) || item.builderAlreadyStarted",
    );
    expect(source).toContain("listedItemIds: Set<string>");
  });

  it("lets the Added/Examined/Failed/Started/Skipped chips filter the item list, with no filter active by default", () => {
    const source = readViewSource();
    expect(source).toContain(
      'type AuditItemFilterKey =\n  | "added"\n  | "examined"\n  | "failed"\n  | "started"\n  | "skipped";',
    );
    expect(source).toContain(
      "const [filterKey, setFilterKey] = useState<AuditItemFilterKey | null>(null);",
    );
    expect(source).toContain(
      "const filteredItems = filterAuditItems(allItems, filterKey, listedItemIds);",
    );
    expect(source).toContain("if (!filterKey) return items;");
    expect(source).toContain(
      "return items.filter((item) => matchesFilter(item, listedItemIds));",
    );
    expect(source).toContain(
      "setFilterKey((current) => (current === key ? null : key));",
    );
    expect(source).toContain("function AuditFilterChip(");
    expect(source).toContain("aria-pressed={active}");
    expect(source).toContain(
      "examined: (item, listedItemIds) => listedItemIds.has(item.itemId)",
    );
    expect(source).toContain(
      "const listedItemIds = new Set(work.map((item) => item.itemId));",
    );
    expect(source).toContain(
      '<AuditFilterChip\n          active={filterKey === "examined"}',
    );
    expect(source).toContain(
      '<AuditFilterChip\n          active={filterKey === "added"}',
    );
    expect(source).toContain(
      '<AuditFilterChip\n          active={filterKey === "failed"}',
    );
    expect(source).toContain(
      '<AuditFilterChip\n          active={filterKey === "started"}',
    );
    expect(source).toContain(
      '<AuditFilterChip\n          active={filterKey === "skipped"}',
    );
    expect(source).toContain('t("factoryRoute.auditNoItemsMatchFilter")');
    expect(source).toContain("key={selectedRun.id}");
    expect(source).toContain("{filteredItems.map((item) => (");
  });
});
