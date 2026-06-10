import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cloneDashboardConfig,
  dashboardCatalogEntries,
  getDashboardCatalogEntry,
} from "./dashboard-catalog";
import { loadDashboardSeed } from "./dashboard-seeds";
import { parsePanelDescriptor } from "./prometheus";

function interpolate(input: string, values: Record<string, string>): string {
  return input.replace(
    /{{\s*([A-Za-z0-9_]+)\s*}}/g,
    (_match, key: string) => values[key] ?? "",
  );
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
      expect((seed?.panels as unknown[]).length).toBe(140);
    } finally {
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("lists only the supported Node Exporter catalog templates", () => {
    const ids = dashboardCatalogEntries.map((entry) => entry.id);
    expect(ids).toContain("node-exporter-macos");
    expect(ids).toContain("node-exporter-full");
    expect(ids).not.toContain("node-exporter-essentials");
    expect(getDashboardCatalogEntry("node-exporter-essentials")).toBeNull();
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
    values.instance = "localhost:9100";

    const prometheusPanels = config.panels.filter(
      (panel) => panel.source === "prometheus",
    );
    expect(prometheusPanels).toHaveLength(124);

    for (const panel of prometheusPanels) {
      expect(() =>
        parsePanelDescriptor(interpolate(panel.sql, values)),
      ).not.toThrow();
    }
  });
});
