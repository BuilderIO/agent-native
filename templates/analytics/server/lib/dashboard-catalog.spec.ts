import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  cloneDashboardConfig,
  dashboardCatalogEntries,
  getDashboardCatalogEntry,
} from "./dashboard-catalog";
import { loadDashboardSeed } from "./dashboard-seeds";
import { validateFirstPartyDashboardTimeScope } from "./dashboard-time-scope";
import { parseDemoDescriptor } from "./demo-source";
import { validateFirstPartyAnalyticsSql } from "./first-party-analytics";
import {
  buildPanel,
  DEPLOYED_RECURRING_USERS_BY_TEMPLATE_SQL,
  INTERMEDIATE_RECURRING_USERS_BY_TEMPLATE_SQL,
  INTERMEDIATE_RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL,
  LEGACY_RECURRING_USERS_BY_TEMPLATE_SQL,
  LEGACY_RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL,
  LEGACY_V0_RETENTION_OVER_TIME_SQL,
  LEGACY_V0_SEVEN_DAY_RETENTION_BY_TEMPLATE_SQL,
  LEGACY_V0_ONE_DAY_RETENTION_BY_TEMPLATE_SQL,
  repairFirstPartyObservedRetentionPanels,
} from "./first-party-metric-catalog";
import { parsePanelDescriptor } from "./prometheus";

function interpolate(input: string, values: Record<string, string>): string {
  return input.replace(
    /{{\s*([A-Za-z0-9_]+)\s*}}/g,
    (_match, key: string) => values[key] ?? "",
  );
}

function requiredFirstPartyPanel(
  id: string,
): NonNullable<ReturnType<typeof buildPanel>> {
  const panel = buildPanel(id);
  if (!panel) throw new Error(`Expected first-party metric "${id}" to exist`);
  return panel;
}

function collectCssVariables(value: unknown, variables = new Set<string>()) {
  if (typeof value === "string") {
    const matches = value.matchAll(/var\(--([A-Za-z0-9-]+)\)/g);
    for (const match of matches) variables.add(match[1]);
    return variables;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectCssVariables(item, variables);
    return variables;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectCssVariables(item, variables);
    }
  }

  return variables;
}

describe("dashboard catalog", () => {
  it("loads shipped dashboard seeds independently of process cwd", () => {
    const originalCwd = process.cwd();
    const tempDir = mkdtempSync(path.join(tmpdir(), "analytics-seeds-"));

    try {
      process.chdir(tempDir);
      const seed = loadDashboardSeed("node-exporter-full");
      expect(seed?.name).toBe("Node Exporter Full");
      expect(Array.isArray(seed?.panels)).toBe(true);
      expect((seed?.panels as unknown[]).length).toBe(155);
    } finally {
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("lists only the supported Node Exporter catalog templates", () => {
    const ids = dashboardCatalogEntries.map((entry) => entry.id);
    expect(ids).toContain("demo-node-exporter");
    expect(ids).not.toContain("demo-postgres-saas");
    expect(ids).not.toContain("demo-product-analytics");
    expect(ids).toContain("node-exporter-macos");
    expect(ids).toContain("node-exporter-full");
    expect(ids).not.toContain("node-exporter-essentials");
    expect(getDashboardCatalogEntry("node-exporter-essentials")).toBeNull();
  });

  it("ships parseable demo dashboard descriptors", () => {
    const demoEntry = getDashboardCatalogEntry("demo-node-exporter");
    const realEntry = getDashboardCatalogEntry("node-exporter-full");
    expect(demoEntry).not.toBeNull();
    expect(realEntry).not.toBeNull();

    const demoConfig = cloneDashboardConfig(demoEntry!);
    const realConfig = cloneDashboardConfig(realEntry!);
    expect(demoConfig.panels).toHaveLength(realConfig.panels.length);

    const values: Record<string, string> = { ...(demoConfig.variables ?? {}) };
    for (const filter of demoConfig.filters ?? []) {
      values[filter.id] = filter.default ?? "";
    }
    values.job = "node";
    values.instance = "127.0.0.1:9100";

    const demoPanels = demoConfig.panels.filter(
      (panel) => panel.source === "demo",
    );
    const realPrometheusPanels = realConfig.panels.filter(
      (panel) => panel.source === "prometheus",
    );
    expect(demoPanels).toHaveLength(realPrometheusPanels.length);
    expect(
      demoConfig.panels.filter((panel) => panel.source === "prometheus"),
    ).toHaveLength(0);

    for (const panel of demoPanels) {
      expect(() =>
        parseDemoDescriptor(interpolate(panel.sql, values)),
      ).not.toThrow();
    }
  });

  it("ships a parseable Node Exporter Full Prometheus dashboard", () => {
    const entry = getDashboardCatalogEntry("node-exporter-full");
    expect(entry).not.toBeNull();

    const config = cloneDashboardConfig(entry!);
    const values: Record<string, string> = { ...(config.variables ?? {}) };
    for (const filter of config.filters ?? []) {
      values[filter.id] = filter.default ?? "";
    }
    values.job = "node";
    values.instance = "127.0.0.1:9100";

    const prometheusPanels = config.panels.filter(
      (panel) => panel.source === "prometheus",
    );
    expect(prometheusPanels).toHaveLength(135);

    for (const panel of prometheusPanels) {
      expect(() =>
        parsePanelDescriptor(interpolate(panel.sql, values)),
      ).not.toThrow();
    }
  });

  it("keeps only the requested sentiment panels in the first-party dashboard", () => {
    expect(getDashboardCatalogEntry("agent-observability-llm")).toBeNull();
    expect(loadDashboardSeed("agent-observability-llm")).toBeNull();

    const entry = getDashboardCatalogEntry("first-party-template-traffic");
    expect(entry).not.toBeNull();
    expect(entry?.defaultDashboardId).toBe(
      "agent-native-templates-first-party",
    );
    expect(entry?.dataSources).toEqual(["first-party"]);
    expect(entry?.panelCount).toBe(38);

    const config = cloneDashboardConfig(entry!);
    expect(config.name).toBe("Agent Native Templates (First-party)");
    expect(config.panels).toHaveLength(41);
    expect(new Set(config.panels.map((panel) => panel.id)).size).toBe(41);
    expect(
      config.filters?.find((filter) => filter.id === "emailFilter"),
    ).toMatchObject({ default: "exclude_builder" });
    const recurringIndex = config.panels.findIndex(
      (panel) => panel.id === "recurring-users-by-template",
    );
    expect(recurringIndex).toBeGreaterThanOrEqual(0);
    expect(config.panels[recurringIndex + 1]?.id).toBe(
      "recurring-users-by-template-bar",
    );
    for (const id of [
      "recurring-users-by-template",
      "recurring-users-by-template-bar",
    ]) {
      const panel = config.panels.find((candidate) => candidate.id === id);
      expect(panel).toEqual(buildPanel(id));
      const sql = panel?.sql ?? "";
      const lookbackFilter =
        "event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')";
      expect(sql).toContain("WITH first_seen AS");
      expect(sql).toContain("), activity AS");
      expect(sql.split(lookbackFilter)).toHaveLength(4);
      expect(sql.indexOf(lookbackFilter)).toBeLessThan(
        sql.indexOf("), activity AS"),
      );
      expect(sql.lastIndexOf(lookbackFilter)).toBeGreaterThan(
        sql.indexOf("), activity AS"),
      );
      expect(panel?.config?.description).toContain("previous 365 days");
      expect(panel?.config?.description).not.toContain("all-time first");
    }
    const recurringDaily = config.panels[recurringIndex];
    const recurringWeekly = config.panels[recurringIndex + 1];
    expect(recurringDaily?.sql).not.toContain("date_trunc('week'");
    expect(recurringWeekly?.sql).toContain("date_trunc('week'");
    expect(recurringWeekly?.config?.description).toContain(
      "Weekly distinct signed-in visitors",
    );
    const sentimentPanels = config.panels.filter((panel) =>
      panel.id.startsWith("llm-"),
    );
    expect(sentimentPanels.map((panel) => panel.id)).toEqual([
      "llm-feedback-by-model",
      "llm-inferred-sentiment-30d",
    ]);
    expect(sentimentPanels[0]?.sql).toContain("event_name = '$ai_feedback'");
    expect(sentimentPanels[0]?.sql).toContain("'positive', 'negative'");
    expect(sentimentPanels[1]?.sql).toContain("event_name = '$ai_sentiment'");
    expect(sentimentPanels[1]?.sql).toContain(
      "'positive', 'neutral', 'negative'",
    );
    expect(sentimentPanels[1]?.sql).toContain("->> 'method'");
    for (const panel of sentimentPanels) {
      expect(panel.source).toBe("first-party");
      expect(() => validateFirstPartyAnalyticsSql(panel.sql)).not.toThrow();
    }
  });

  it("keeps observed first-seen retention scans bounded in the seed and catalog", () => {
    const seed = loadDashboardSeed("agent-native-templates-first-party");
    const seedPanels = seed?.panels as Array<{
      id?: string;
      sql?: string;
      config?: { description?: string };
    }>;

    for (const id of [
      "retention-over-time",
      "one-day-retention-by-template",
      "seven-day-retention-by-template",
    ]) {
      const catalogPanel = requiredFirstPartyPanel(id);
      const seedPanel = seedPanels.find((panel) => panel.id === id);
      expect(seedPanel?.sql).toContain(
        "event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')",
      );
      expect(seedPanel?.config?.description).toContain("previous 365 days");
      const sql = catalogPanel.sql;
      const baseEnd = sql.indexOf(
        id === "retention-over-time" ? "), first_seen" : "), ranked_first_seen",
      );
      const lookback = sql.indexOf(
        "event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')",
      );
      expect(lookback).toBeGreaterThan(sql.indexOf("WITH base AS"));
      expect(lookback).toBeLessThan(baseEnd);
      expect(catalogPanel.config?.description).toContain("previous 365 days");
    }
  });

  it("repairs only exact legacy observed-retention panels and preserves custom panel intent", () => {
    const legacyDaily = requiredFirstPartyPanel("recurring-users-by-template");
    const legacyWeekly = requiredFirstPartyPanel(
      "recurring-users-by-template-bar",
    );
    const legacyRetention = requiredFirstPartyPanel("retention-over-time");
    const legacyOneDay = requiredFirstPartyPanel(
      "one-day-retention-by-template",
    );
    const legacySevenDay = requiredFirstPartyPanel(
      "seven-day-retention-by-template",
    );
    const legacyConfig = {
      name: "Legacy dashboard",
      panels: [
        {
          ...legacyDaily,
          sql: LEGACY_RECURRING_USERS_BY_TEMPLATE_SQL,
          config: {
            ...(legacyDaily.config ?? {}),
            description:
              "Daily signed-in visitors who are NOT on their all-time first active day (Recurring only), stacked by inferred template/app used that day. Docs traffic and unknown template are excluded.",
          },
        },
        {
          ...legacyWeekly,
          sql: LEGACY_RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL,
          config: {
            ...(legacyWeekly.config ?? {}),
            description: "Custom weekly note",
          },
        },
        {
          ...legacyRetention,
          sql: LEGACY_V0_RETENTION_OVER_TIME_SQL,
          config: {
            ...(legacyRetention.config ?? {}),
            description:
              "Trailing 7-day first-seen signed-in app session cohorts, keyed by browser identity. Counts returns within 1-7d and 7-14d windows. Docs traffic is excluded; windows under 5 identities are hidden.",
          },
        },
        {
          ...legacyOneDay,
          sql: LEGACY_V0_ONE_DAY_RETENTION_BY_TEMPLATE_SQL,
          config: {
            ...(legacyOneDay.config ?? {}),
            description:
              "Selected-range signed-in cohorts by the browser identity's first non-docs app/template. Counts returns to any non-docs app within 1-7 days. Templates with fewer than 20 mature cohort identities are hidden.",
          },
        },
        {
          ...legacySevenDay,
          sql: LEGACY_V0_SEVEN_DAY_RETENTION_BY_TEMPLATE_SQL,
          config: {
            ...(legacySevenDay.config ?? {}),
            description:
              "Selected-range signed-in cohorts by the browser identity's first non-docs app/template. Counts returns to any non-docs app within 7-14 days. Templates with fewer than 20 mature cohort identities are hidden.",
          },
        },
        {
          id: "recurring-users-by-template-copy",
          sql: "SELECT * FROM custom_analytics_events",
          config: { description: "Custom copy" },
        },
      ],
    };

    expect(LEGACY_V0_RETENTION_OVER_TIME_SQL).toHaveLength(2_931);
    expect(
      createHash("sha256")
        .update(LEGACY_V0_RETENTION_OVER_TIME_SQL)
        .digest("hex"),
    ).toBe("4d431113d856052297b25e09f26a03c028a460e0e33ca39bda4efa20d4605370");
    expect(LEGACY_V0_SEVEN_DAY_RETENTION_BY_TEMPLATE_SQL).toHaveLength(3_149);
    expect(
      createHash("sha256")
        .update(LEGACY_V0_SEVEN_DAY_RETENTION_BY_TEMPLATE_SQL)
        .digest("hex"),
    ).toBe("fe8ad195a4d989c3c1b9e31e087b8a70e67d0107cc8572c384ab1052d1e0d74d");
    expect(LEGACY_V0_ONE_DAY_RETENTION_BY_TEMPLATE_SQL).toHaveLength(3_097);
    expect(
      createHash("sha256")
        .update(LEGACY_V0_ONE_DAY_RETENTION_BY_TEMPLATE_SQL)
        .digest("hex"),
    ).toBe("cf904fd6e1c395315bd01d1f12465afe107a4523d698db313707d09d08ff744a");

    const repaired = repairFirstPartyObservedRetentionPanels(legacyConfig);

    expect(repaired.changed).toBe(true);
    if (!repaired.config) throw new Error("Expected repaired dashboard config");
    const panels = repaired.config.panels as Array<{
      id: string;
      sql: string;
      config?: { description?: string };
    }>;
    expect(panels.find((panel) => panel.id === legacyDaily.id)).toMatchObject({
      sql: requiredFirstPartyPanel("recurring-users-by-template").sql,
      config: {
        description: requiredFirstPartyPanel("recurring-users-by-template")
          .config?.description,
      },
    });
    expect(panels.find((panel) => panel.id === legacyWeekly.id)).toMatchObject({
      sql: requiredFirstPartyPanel("recurring-users-by-template-bar").sql,
      config: { description: "Custom weekly note" },
    });
    for (const panel of [legacyRetention, legacyOneDay, legacySevenDay]) {
      expect(
        panels.find((candidate) => candidate.id === panel.id),
      ).toMatchObject({
        sql: panel.sql,
        config: { description: panel.config?.description },
      });
    }
    expect(
      panels.find((panel) => panel.id === "recurring-users-by-template-copy"),
    ).toEqual(legacyConfig.panels[5]);

    const customSql = repairFirstPartyObservedRetentionPanels({
      panels: [
        {
          id: "recurring-users-by-template",
          sql: "SELECT custom_recurring_users()",
          config: { description: "Custom SQL" },
        },
      ],
    });
    expect(customSql.changed).toBe(false);
    expect(customSql.config.panels).toEqual([
      {
        id: "recurring-users-by-template",
        sql: "SELECT custom_recurring_users()",
        config: { description: "Custom SQL" },
      },
    ]);
  });

  it("repairs the deployed bounded monolithic recurring SQL exactly", () => {
    const daily = requiredFirstPartyPanel("recurring-users-by-template");
    const weekly = requiredFirstPartyPanel("recurring-users-by-template-bar");
    const observedDescription =
      "Daily signed-in visitors who are not on their first active day observed in the previous 365 days, stacked by inferred template/app used that day. Docs traffic and unknown template are excluded.";
    const repaired = repairFirstPartyObservedRetentionPanels({
      panels: [
        {
          ...daily,
          sql: INTERMEDIATE_RECURRING_USERS_BY_TEMPLATE_SQL,
          config: { ...(daily.config ?? {}), description: observedDescription },
        },
        {
          ...weekly,
          sql: INTERMEDIATE_RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL,
          config: {
            ...(weekly.config ?? {}),
            description: "Custom weekly note",
          },
        },
      ],
    });

    expect(repaired.changed).toBe(true);
    const panels = repaired.config.panels as Array<{
      sql: string;
      config?: { description?: string };
    }>;
    expect(panels[0]).toMatchObject({
      sql: daily.sql,
      config: { description: daily.config?.description },
    });
    expect(panels[1]).toMatchObject({
      sql: weekly.sql,
      config: { description: "Custom weekly note" },
    });
  });

  it("repairs the exact live recurring panel without the later date ceiling", () => {
    const daily = requiredFirstPartyPanel("recurring-users-by-template");
    expect(DEPLOYED_RECURRING_USERS_BY_TEMPLATE_SQL).toHaveLength(2_040);
    expect(
      createHash("sha256")
        .update(DEPLOYED_RECURRING_USERS_BY_TEMPLATE_SQL)
        .digest("hex"),
    ).toBe("4ed7fd55e2857fe21530f4d0e01591877306ab84ffd18cebbcb9cc159c588138");
    const repaired = repairFirstPartyObservedRetentionPanels({
      panels: [
        {
          ...daily,
          sql: DEPLOYED_RECURRING_USERS_BY_TEMPLATE_SQL,
          config: {
            ...(daily.config ?? {}),
            description:
              "Daily signed-in visitors who are NOT on their all-time first active day (Recurring only), stacked by inferred template/app used that day. Docs traffic and unknown template are excluded.",
          },
        },
      ],
    });

    expect(repaired.changed).toBe(true);
    expect((repaired.config.panels as Array<{ sql: string }>)[0]?.sql).toBe(
      daily.sql,
    );
  });

  it("repairs the exact shipped weekly recurring panel", () => {
    const weekly = requiredFirstPartyPanel("recurring-users-by-template-bar");
    const legacyDescription =
      "Weekly distinct signed-in visitors who are NOT on their all-time first active day (Recurring only), stacked by inferred template/app used that week. Weeks start Monday; docs traffic and unknown template are excluded.";
    expect(LEGACY_RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL).toHaveLength(2_147);
    expect(
      createHash("sha256")
        .update(LEGACY_RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL)
        .digest("hex"),
    ).toBe("f7f8f503aaf8a66e1c158e5df3f0b5b7c2df685b998a208c5cf6823a66cda7ed");
    expect(legacyDescription).toHaveLength(216);
    expect(createHash("sha256").update(legacyDescription).digest("hex")).toBe(
      "c5a7833f1c903f5e60b607158c90f0d3d8729912f714bbb490cb66f217f34c83",
    );
    const repaired = repairFirstPartyObservedRetentionPanels({
      panels: [
        {
          ...weekly,
          sql: LEGACY_RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL,
          config: {
            ...(weekly.config ?? {}),
            description: legacyDescription,
          },
        },
      ],
    });

    expect(repaired.changed).toBe(true);
    expect((repaired.config.panels as Array<{ sql: string }>)[0]?.sql).toBe(
      weekly.sql,
    );
  });

  it("scopes session panels to the first-party dashboard filters", () => {
    const sessionPanelIds = [
      "sessions-by-app",
      "sessions-over-time",
      "signed-in-vs-anon",
    ];

    for (const id of sessionPanelIds) {
      const catalogPanel = buildPanel(id);
      expect(catalogPanel?.sql).toContain("{{timeRange}}");
      expect(catalogPanel?.sql).toContain("{{emailFilter}}");
    }

    const seed = loadDashboardSeed("agent-native-templates-first-party");
    const seedPanels = seed?.panels as Array<{
      id?: string;
      sql?: string;
    }>;
    for (const id of sessionPanelIds) {
      const seedPanel = seedPanels.find((panel) => panel.id === id);
      expect(seedPanel?.sql).toContain("{{timeRange}}");
      expect(seedPanel?.sql).toContain("{{emailFilter}}");
    }
  });

  it("keeps every shipped first-party panel time-scoped or explicitly exceptional", () => {
    const seed = loadDashboardSeed("agent-native-templates-first-party");
    expect(seed).not.toBeNull();

    const panels = Array.isArray(seed?.panels)
      ? (seed.panels as Array<{ source?: string }>)
      : [];
    for (const [index, panel] of panels.entries()) {
      if (panel.source !== "first-party") continue;
      expect(
        validateFirstPartyDashboardTimeScope(panel, seed!, index),
      ).toBeNull();
    }
  });

  it("keeps demo app overview light and splits app details across tabs", () => {
    const entry = getDashboardCatalogEntry("node-exporter-full");
    expect(entry).not.toBeNull();

    const config = cloneDashboardConfig(entry!);
    const appPanels = config.panels.filter((panel) =>
      panel.tab?.startsWith("App"),
    );

    expect([...new Set(appPanels.map((panel) => panel.tab))]).toEqual([
      "App / Overview",
      "App / Latency",
      "App / Traffic",
      "App / Workload",
    ]);
    expect(
      appPanels
        .filter((panel) => panel.tab === "App / Overview")
        .map((panel) => panel.title),
    ).toEqual([
      "App Overview",
      "Request Latency",
      "Chaos Mode",
      "Active Workload Phase",
    ]);
    expect(
      appPanels
        .filter((panel) => panel.chartType === "section")
        .map((panel) => panel.title),
    ).toEqual(["App Overview", "App Latency", "App Traffic", "App Workload"]);
  });

  it("uses defined theme variables in Node Exporter Full chart colors", () => {
    const entry = getDashboardCatalogEntry("node-exporter-full");
    expect(entry).not.toBeNull();

    const config = cloneDashboardConfig(entry!);
    const usedVariables = collectCssVariables(config);
    const globalCss = readFileSync(
      new URL("../../app/global.css", import.meta.url),
      "utf8",
    );
    const definedVariables = new Set(
      Array.from(globalCss.matchAll(/--([A-Za-z0-9-]+)\s*:/g)).map(
        (match) => match[1],
      ),
    );

    const missingVariables = Array.from(usedVariables).filter(
      (variable) => !definedVariables.has(variable),
    );
    expect(missingVariables).toEqual([]);
  });
});
