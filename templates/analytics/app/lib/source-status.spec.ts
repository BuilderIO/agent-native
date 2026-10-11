import { describe, expect, it } from "vitest";

import type { DataSourceStatusResponse } from "./data-source-status";
import { sourceHealthState } from "./source-status";

function statusData(
  overrides: Partial<DataSourceStatusResponse> = {},
): DataSourceStatusResponse {
  return {
    providers: [],
    workspaceConnections: {
      appId: "analytics",
      available: true,
      error: null,
      providers: [],
    },
    ...overrides,
  };
}

describe("sourceHealthState", () => {
  it("reports configured provider credentials as connected", () => {
    expect(
      sourceHealthState(
        "bigquery",
        statusData({
          providers: [
            {
              provider: "bigquery",
              label: "BigQuery",
              configured: true,
              configuredKeys: ["BIGQUERY_PROJECT_ID"],
              missingRequiredKeys: [],
              optionalKeys: [],
            },
          ],
        }),
      ),
    ).toBe("connected");
  });

  it("reads granted dbt and Sigma workspace connections", () => {
    const data = statusData({
      workspaceConnections: {
        appId: "analytics",
        available: true,
        error: null,
        providers: [
          {
            id: "dbt",
            provider: "dbt",
            grantState: "connected",
            connectionCount: 1,
            grantedConnectionCount: 1,
            activeConnectionCount: 1,
            hasWorkspaceConnection: true,
            hasGrantedWorkspaceConnection: true,
            hasActiveWorkspaceConnection: true,
            statuses: ["connected"],
          },
        ],
      },
    });

    expect(sourceHealthState("dbt", data)).toBe("connected");
    expect(sourceHealthState("sigma", data)).toBe("not_connected");
  });

  it("preserves reauthorization and connection errors", () => {
    const base = {
      id: "github",
      provider: "github",
      grantState: "granted" as const,
      connectionCount: 1,
      grantedConnectionCount: 1,
      activeConnectionCount: 1,
      hasWorkspaceConnection: true,
      hasGrantedWorkspaceConnection: true,
      hasActiveWorkspaceConnection: false,
    };
    const withStatus = (status: "needs_reauth" | "error") =>
      statusData({
        workspaceConnections: {
          appId: "analytics",
          available: true,
          error: null,
          providers: [{ ...base, statuses: [status] }],
        },
      });

    expect(sourceHealthState("github", withStatus("needs_reauth"))).toBe(
      "needs_reauth",
    );
    expect(sourceHealthState("github", withStatus("error"))).toBe("error");
  });

  it("distinguishes an unconfigured provider from an unavailable status", () => {
    expect(sourceHealthState("amplitude", statusData())).toBe("not_connected");
    expect(sourceHealthState("amplitude", undefined)).toBe("error");
    expect(sourceHealthState("amplitude", statusData(), true)).toBe("error");
    expect(
      sourceHealthState(
        "amplitude",
        statusData({
          providers: [
            {
              provider: "amplitude",
              label: "Amplitude",
              configured: false,
              configuredKeys: [],
              missingRequiredKeys: [],
              optionalKeys: [],
            },
          ],
          workspaceConnections: {
            appId: "analytics",
            available: false,
            error: "unavailable",
            providers: [],
          },
        }),
      ),
    ).toBe("error");
  });

  it("treats an unknown provider configuration as an error", () => {
    expect(
      sourceHealthState(
        "github",
        statusData({
          providers: [
            {
              provider: "github",
              label: "GitHub",
              configured: null,
              configuredKeys: [],
              missingRequiredKeys: [],
              optionalKeys: [],
            },
          ],
        }),
      ),
    ).toBe("error");
  });
});
