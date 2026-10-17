import { describe, expect, it, vi } from "vitest";

const callAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction,
}));

import { fetchDashboard } from "../../app/pages/adhoc/sql-dashboard/fetch-dashboard";
import { buildDashboardAgentContext } from "./agent-readable-resource-context";
import {
  FIRST_PARTY_BIGQUERY_DASHBOARD_ID,
  repairKnownFirstPartyDashboardQueries,
} from "./canonical-first-party-dashboard-repair";

const record = (config: Record<string, unknown>) =>
  ({
    id: FIRST_PARTY_BIGQUERY_DASHBOARD_ID,
    kind: "sql",
    title: "Saved",
    config,
  }) as unknown as Parameters<typeof buildDashboardAgentContext>[0];

describe("introducedPanels through the dashboard load and whole-config save", () => {
  it("keeps a removed A/B panel removed after load, save, remove, repair", async () => {
    const delivered = repairKnownFirstPartyDashboardQueries(
      FIRST_PARTY_BIGQUERY_DASHBOARD_ID,
      {
        name: "Saved",
        panels: [{ id: "dau-over-time", source: "bigquery", sql: "SELECT 1" }],
      },
    ).config;
    expect(delivered.introducedPanels).toBeTruthy();

    callAction.mockResolvedValue(buildDashboardAgentContext(record(delivered)));
    const loaded = (await fetchDashboard("dash"))!.config;
    expect(loaded.introducedPanels).toEqual(delivered.introducedPanels);

    // The page saves the whole loaded config back after the owner removes a panel.
    const saved = { ...loaded, panels: loaded.panels.slice(0, 1) };
    const repaired = repairKnownFirstPartyDashboardQueries(
      FIRST_PARTY_BIGQUERY_DASHBOARD_ID,
      saved as unknown as Record<string, unknown>,
    );

    expect(repaired.changed).toBe(false);
    expect((repaired.config.panels as unknown[]).length).toBe(1);
  });
});
