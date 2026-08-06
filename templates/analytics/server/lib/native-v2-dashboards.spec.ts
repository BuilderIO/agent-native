import { describe, expect, it } from "vitest";

import {
  compileNativeV2Dashboard,
  getNativeV2DashboardManifest,
  type NativeV2Binding,
  type NativeV2BindingKey,
} from "./native-v2-dashboards";

describe("on-demand billing native v2 dashboard", () => {
  it("declares the extension's two billing surfaces as nested native tabs", () => {
    const manifest = getNativeV2DashboardManifest("on-demand-billing-v2");
    const tabs = new Set(
      manifest.panels
        .map((panel) => panel.tab)
        .filter((tab): tab is string => Boolean(tab)),
    );

    expect(manifest.requiredBindings).toContain("billing.visual_views.overage");
    expect(manifest.requiredBindings).toContain(
      "billing.agent_credits.overage",
    );
    expect(tabs).toEqual(
      new Set([
        "Visual Views / Overview",
        "Visual Views / Overage",
        "Visual Views / Growth",
        "Agent Credits / Overview",
        "Agent Credits / Overage",
      ]),
    );
  });

  it("compiles to program, metric, chart, table, and callout panels only", () => {
    const manifest = getNativeV2DashboardManifest("on-demand-billing-v2");
    const bindings = Object.fromEntries(
      manifest.requiredBindings.map((key) => [
        key,
        { programId: `dp-${key.replaceAll(".", "-")}` },
      ]),
    ) as Partial<Record<NativeV2BindingKey, NativeV2Binding>>;

    const config = compileNativeV2Dashboard(
      manifest,
      bindings,
      "2026-08-06T00:00:00.000Z",
    );

    expect(config.catalog?.templateId).toBe("on-demand-billing-v2");
    expect(config.panels).toHaveLength(11);
    expect(
      config.panels.every((panel) => panel.chartType !== "extension"),
    ).toBe(true);
    expect(
      config.panels.filter((panel) => panel.source === "program"),
    ).toHaveLength(9);
    expect(config.panels.map((panel) => panel.chartType)).toEqual(
      expect.arrayContaining(["section", "metric", "area", "table", "callout"]),
    );

    const overagePanel = config.panels.find(
      (panel) => panel.id === "billing-visual-views-overage",
    );
    expect(overagePanel).toMatchObject({
      source: "program",
      chartType: "table",
      tab: "Visual Views / Overage",
    });
    expect(JSON.parse(overagePanel?.sql ?? "{}")).toEqual({
      programId: "dp-billing-visual_views-overage",
    });
  });
});
