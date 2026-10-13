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
  it("reports stored provider credentials as configured but unverified", () => {
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
    ).toBe("configured");
  });

  it("reports a verified workspace grant as connected", () => {
    expect(
      sourceHealthState(
        "bigquery",
        statusData({
          providers: [
            {
              provider: "bigquery",
              label: "BigQuery",
              configured: false,
              configuredKeys: [],
              missingRequiredKeys: [],
              optionalKeys: [],
            },
          ],
          workspaceConnections: {
            appId: "analytics",
            available: true,
            error: null,
            providers: [
              {
                provider: "bigquery",
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
        }),
      ),
    ).toBe("connected");
  });

  it("preserves configured credentials when the workspace grant is not yet active", () => {
    expect(
      sourceHealthState(
        "amplitude",
        statusData({
          providers: [
            {
              provider: "amplitude",
              label: "Amplitude",
              configured: true,
              configuredKeys: ["AMPLITUDE_API_KEY"],
              missingRequiredKeys: [],
              optionalKeys: [],
              workspaceConnection: {
                provider: "amplitude",
                grantState: "granted",
                connectionCount: 1,
                grantedConnectionCount: 1,
                activeConnectionCount: 0,
                hasWorkspaceConnection: true,
                hasGrantedWorkspaceConnection: true,
                hasActiveWorkspaceConnection: false,
                statuses: ["checking"],
              },
            },
          ],
        }),
      ),
    ).toBe("configured");
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

  it("does not report connected from status labels when the Analytics grant is needed", () => {
    const needsGrant = {
      provider: "github",
      grantState: "needs_grant" as const,
      connectionCount: 1,
      grantedConnectionCount: 0,
      activeConnectionCount: 0,
      hasWorkspaceConnection: true,
      hasGrantedWorkspaceConnection: false,
      hasActiveWorkspaceConnection: false,
      statuses: ["connected" as const],
    };

    expect(
      sourceHealthState(
        "github",
        statusData({
          providers: [
            {
              provider: "github",
              label: "GitHub",
              configured: false,
              configuredKeys: [],
              missingRequiredKeys: [],
              optionalKeys: [],
              workspaceConnection: needsGrant,
            },
          ],
        }),
      ),
    ).toBe("not_connected");

    expect(
      sourceHealthState(
        "github",
        statusData({
          workspaceConnections: {
            appId: "analytics",
            available: true,
            error: null,
            providers: [needsGrant],
          },
        }),
      ),
    ).toBe("not_connected");
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
    expect(
      sourceHealthState(
        "amplitude",
        statusData({
          providers: [
            {
              provider: "amplitude",
              label: "Amplitude",
              configured: true,
              configuredKeys: ["AMPLITUDE_API_KEY"],
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
