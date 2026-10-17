import { describe, expect, it } from "vitest";

import { dbtConnectionReadiness } from "../../server/lib/dbt-connection";
import type {
  DataSourceStatusResponse,
  WorkspaceConnectionProviderSummary,
} from "./data-source-status";
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

  it("reports a granted connection that is still checking", () => {
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
                connections: [
                  {
                    id: "analytics-checking-connection",
                    status: "checking",
                    grantedToApp: true,
                  },
                ],
              },
            },
          ],
        }),
      ),
    ).toBe("checking");
  });

  it("preserves the provider-level checking state in the overview", () => {
    expect(
      sourceHealthState(
        "dbt",
        statusData({
          providers: [
            {
              provider: "dbt",
              label: "dbt Cloud",
              configured: true,
              connectionHealth: "checking",
              configuredKeys: [],
              missingRequiredKeys: [],
              optionalKeys: [],
            },
          ],
        }),
      ),
    ).toBe("checking");
  });

  function dbtData(
    dbtReadiness: WorkspaceConnectionProviderSummary["dbtReadiness"],
  ): DataSourceStatusResponse {
    return statusData({
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
            dbtReadiness,
          },
        ],
      },
    });
  }

  it("reads a granted dbt connection as connected when the Semantic Layer is ready", () => {
    expect(sourceHealthState("dbt", dbtData("ready"))).toBe("connected");
    expect(sourceHealthState("sigma", dbtData("ready"))).toBe("not_connected");
  });

  it("does not read a granted dbt row with no saved token as connected", () => {
    const readiness = dbtConnectionReadiness({
      status: "connected",
      tokenConfigured: false,
      environmentId: "123456",
    });

    expect(readiness).toBe("token_missing");
    expect(sourceHealthState("dbt", dbtData(readiness))).toBe("not_connected");
  });

  it("does not read a granted dbt row without an environment ID as connected", () => {
    expect(sourceHealthState("dbt", dbtData("environment_missing"))).toBe(
      "not_connected",
    );
  });

  it("reports a granted dbt row without a readiness value as an error, not as connected", () => {
    expect(sourceHealthState("dbt", dbtData(undefined))).toBe("error");
    expect(sourceHealthState("dbt", dbtData("needs_reauth"))).toBe(
      "needs_reauth",
    );
    expect(sourceHealthState("dbt", dbtData("error"))).toBe("error");
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
              credentialsConfigured: false,
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

  it("does not treat another app's checking connection as an Analytics grant", () => {
    const checkingWithoutGrant = {
      provider: "github",
      grantState: "needs_grant" as const,
      connectionCount: 1,
      grantedConnectionCount: 0,
      activeConnectionCount: 0,
      hasWorkspaceConnection: true,
      hasGrantedWorkspaceConnection: false,
      hasActiveWorkspaceConnection: false,
      statuses: ["checking" as const],
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
              missingRequiredKeys: ["GITHUB_ACCESS_TOKEN"],
              optionalKeys: [],
              workspaceConnection: checkingWithoutGrant,
            },
          ],
        }),
      ),
    ).toBe("not_connected");

    expect(
      sourceHealthState(
        "github",
        statusData({
          providers: [
            {
              provider: "github",
              label: "GitHub",
              configured: true,
              credentialsConfigured: false,
              configuredKeys: [],
              missingRequiredKeys: ["GITHUB_ACCESS_TOKEN"],
              optionalKeys: [],
              workspaceConnection: checkingWithoutGrant,
            },
          ],
        }),
      ),
    ).toBe("not_connected");

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
              missingRequiredKeys: ["GITHUB_ACCESS_TOKEN"],
              optionalKeys: [],
            },
          ],
          workspaceConnections: {
            appId: "analytics",
            available: true,
            error: null,
            providers: [checkingWithoutGrant],
          },
        }),
      ),
    ).toBe("not_connected");
  });

  it("scopes connection errors to Analytics grants and checks required-key evidence", () => {
    const connectedWithOtherAppError: WorkspaceConnectionProviderSummary = {
      provider: "github",
      grantState: "connected" as const,
      connectionCount: 2,
      grantedConnectionCount: 1,
      activeConnectionCount: 1,
      hasWorkspaceConnection: true,
      hasGrantedWorkspaceConnection: true,
      hasActiveWorkspaceConnection: true,
      statuses: ["connected", "error"],
      connections: [
        {
          id: "analytics-connected-connection",
          status: "connected",
          grantedToApp: true,
        },
      ],
    };
    expect(
      sourceHealthState(
        "github",
        statusData({
          workspaceConnections: {
            appId: "analytics",
            available: true,
            error: null,
            providers: [connectedWithOtherAppError],
          },
        }),
      ),
    ).toBe("connected");

    const needsGrantWithOtherAppError: WorkspaceConnectionProviderSummary = {
      provider: "github",
      grantState: "needs_grant" as const,
      connectionCount: 1,
      grantedConnectionCount: 0,
      activeConnectionCount: 0,
      hasWorkspaceConnection: true,
      hasGrantedWorkspaceConnection: false,
      hasActiveWorkspaceConnection: false,
      statuses: ["needs_reauth", "error"],
    };
    expect(
      sourceHealthState(
        "github",
        statusData({
          providers: [
            {
              provider: "github",
              label: "GitHub",
              configured: true,
              missingRequiredKeys: ["GITHUB_ACCESS_TOKEN"],
              configuredKeys: [],
              optionalKeys: [],
              workspaceConnection: needsGrantWithOtherAppError,
            },
          ],
        }),
      ),
    ).toBe("not_connected");

    expect(
      sourceHealthState(
        "github",
        statusData({
          providers: [
            {
              provider: "github",
              label: "GitHub",
              configured: true,
              missingRequiredKeys: [],
              configuredKeys: [],
              optionalKeys: [],
              workspaceConnection: needsGrantWithOtherAppError,
            },
          ],
        }),
      ),
    ).toBe("configured");
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
          providers: [
            {
              ...base,
              statuses: [status],
              connections: [
                {
                  id: "analytics-granted-connection",
                  status,
                  grantedToApp: true,
                },
              ],
            },
          ],
        },
      });

    expect(sourceHealthState("github", withStatus("needs_reauth"))).toBe(
      "needs_reauth",
    );
    expect(sourceHealthState("github", withStatus("error"))).toBe("error");
  });

  it("ignores errors from connections that are not granted to Analytics", () => {
    const connection: WorkspaceConnectionProviderSummary = {
      provider: "github",
      grantState: "granted",
      connectionCount: 2,
      grantedConnectionCount: 1,
      activeConnectionCount: 0,
      hasWorkspaceConnection: true,
      hasGrantedWorkspaceConnection: true,
      hasActiveWorkspaceConnection: false,
      statuses: ["disabled", "error"],
      connections: [
        {
          id: "analytics-disabled-connection",
          status: "disabled",
          grantedToApp: true,
        },
      ],
    };

    expect(
      sourceHealthState(
        "github",
        statusData({
          providers: [
            {
              provider: "github",
              label: "GitHub",
              configured: true,
              configuredKeys: [],
              missingRequiredKeys: [],
              optionalKeys: [],
              workspaceConnection: connection,
            },
          ],
        }),
      ),
    ).toBe("configured");
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
    ).toBe("unknown");
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
    ).toBe("unknown");
  });

  it("treats an unknown provider configuration as unknown", () => {
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
    ).toBe("unknown");
  });
});
