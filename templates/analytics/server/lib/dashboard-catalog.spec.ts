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
import { parseDemoDescriptor } from "./demo-source";
import { validateFirstPartyAnalyticsSql } from "./first-party-analytics";
import { parsePanelDescriptor } from "./prometheus";

function interpolate(input: string, values: Record<string, string>): string {
  return input.replace(
    /{{\s*([A-Za-z0-9_]+)\s*}}/g,
    (_match, key: string) => values[key] ?? "",
  );
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
    expect(entry?.panelCount).toBe(36);

    const config = cloneDashboardConfig(entry!);
    expect(config.name).toBe("Agent Native Templates (First-party)");
    expect(config.panels).toHaveLength(39);
    expect(new Set(config.panels.map((panel) => panel.id)).size).toBe(39);
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
