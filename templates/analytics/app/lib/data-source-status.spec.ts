import { describe, expect, it } from "vitest";

import {
  canConnectWorkspaceOAuth,
  dataSourceOAuthReturnPath,
  focusedDataSourceFromSearchParams,
  getGoogleSheetsConnection,
  getSharedConnectionStatus,
  getConfiguredDataSources,
  hasExistingWorkspaceConnection,
  isSourceConfigured,
  isSourceLocallyConfigured,
  isSourceReady,
  shouldOfferWorkspaceOAuthReconnect,
  shouldShowWorkspaceOAuthAdminNotice,
  shouldShowWorkspaceOAuthSetup,
  type DataSourceStatusResponse,
  type EnvKeyStatus,
} from "./data-source-status";
import { dataSources } from "./data-sources";

describe("data source status", () => {
  it("only offers personal BigQuery OAuth inside an organization", () => {
    const bigquery = dataSources.find((source) => source.id === "bigquery")!;
    const notion = dataSources.find((source) => source.id === "notion")!;

    expect(canConnectWorkspaceOAuth(bigquery, false, false)).toBe(false);
    expect(canConnectWorkspaceOAuth(bigquery, false, true)).toBe(true);
    expect(canConnectWorkspaceOAuth(notion, false, true)).toBe(false);
    expect(canConnectWorkspaceOAuth(notion, true, true)).toBe(true);
  });

  it("uses the Google Sheets connection for Sheets exports", () => {
    const status: DataSourceStatusResponse = {
      workspaceConnections: {
        appId: "analytics",
        available: true,
        error: null,
        providers: [
          {
            provider: "google_sheets",
            id: "google_sheets",
            label: "Google Sheets",
            grantState: "connected",
            connectionCount: 1,
            grantedConnectionCount: 1,
            activeConnectionCount: 1,
            hasWorkspaceConnection: true,
            hasGrantedWorkspaceConnection: true,
            hasActiveWorkspaceConnection: true,
          },
          {
            provider: "google_drive",
            id: "google_drive",
            label: "Google Drive",
            grantState: "connected",
            connectionCount: 1,
            grantedConnectionCount: 1,
            activeConnectionCount: 1,
            hasWorkspaceConnection: true,
            hasGrantedWorkspaceConnection: true,
            hasActiveWorkspaceConnection: true,
          },
        ],
      },
    };

    expect(getGoogleSheetsConnection(status)?.grantState).toBe("connected");
    expect(
      getGoogleSheetsConnection({
        workspaceConnections: {
          ...status.workspaceConnections!,
          providers: status.workspaceConnections!.providers.filter(
            (provider) => provider.id === "google_drive",
          ),
        },
      }),
    ).toBeUndefined();
  });

  it("does not require the optional BigQuery app events alias", () => {
    const bigquery = dataSources.find((source) => source.id === "bigquery");

    expect(bigquery).toBeTruthy();
    expect(
      isSourceConfigured(bigquery!, [
        {
          key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
          label: "Google Cloud",
          required: false,
          configured: true,
        },
        {
          key: "BIGQUERY_PROJECT_ID",
          label: "BigQuery Project ID",
          required: false,
          configured: true,
        },
        {
          key: "ANALYTICS_BIGQUERY_EVENTS_TABLE",
          label: "BigQuery Events Table",
          required: false,
          configured: false,
        },
      ]),
    ).toBe(true);
  });

  it("requires a project and either personal OAuth or a service account for BigQuery", () => {
    const bigquery = dataSources.find((source) => source.id === "bigquery")!;
    const projectOnly: EnvKeyStatus[] = [
      {
        key: "BIGQUERY_PROJECT_ID",
        label: "BigQuery Project ID",
        required: true,
        configured: true,
      },
    ];
    const oauthStatus: DataSourceStatusResponse = {
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
          },
        ],
      },
    };

    expect(isSourceReady(bigquery, undefined, projectOnly)).toBe(false);
    expect(isSourceConfigured(bigquery, projectOnly)).toBe(false);
    expect(isSourceReady(bigquery, oauthStatus, projectOnly)).toBe(true);
    expect(isSourceLocallyConfigured(bigquery, oauthStatus, projectOnly)).toBe(
      false,
    );
    expect(
      shouldOfferWorkspaceOAuthReconnect(
        bigquery,
        {
          kind: "ready",
          label: "Ready",
          providerId: "bigquery",
          providerLabel: "BigQuery",
        },
        false,
        true,
      ),
    ).toBe(true);
    expect(
      isSourceReady(bigquery, undefined, [
        ...projectOnly,
        {
          key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
          label: "Google Cloud",
          required: false,
          configured: true,
        },
      ]),
    ).toBe(true);
  });

  it("accepts either HubSpot token key for local source configuration", () => {
    const hubspot = dataSources.find((source) => source.id === "hubspot");
    const envStatus: EnvKeyStatus[] = [
      {
        key: "HUBSPOT_PRIVATE_APP_TOKEN",
        label: "HubSpot private app token",
        required: false,
        configured: false,
      },
      {
        key: "HUBSPOT_ACCESS_TOKEN",
        label: "HubSpot access token (legacy)",
        required: false,
        configured: true,
      },
    ];

    expect(hubspot).toBeTruthy();
    expect(isSourceConfigured(hubspot!, envStatus)).toBe(true);
  });

  it("matches credential status keys case-insensitively after trimming", () => {
    const hubspot = dataSources.find((source) => source.id === "hubspot");
    const envStatus: EnvKeyStatus[] = [
      {
        key: " hubspot_private_app_token ",
        label: "HubSpot private app token",
        required: false,
        configured: true,
      },
    ];

    expect(hubspot).toBeTruthy();
    expect(isSourceConfigured(hubspot!, envStatus)).toBe(true);
  });

  it("treats provider-level HubSpot credentials as ready for analysis prompts", () => {
    const hubspot = dataSources.find((source) => source.id === "hubspot");
    const envStatus: EnvKeyStatus[] = [
      {
        key: "HUBSPOT_PRIVATE_APP_TOKEN",
        label: "HubSpot private app token",
        required: false,
        configured: false,
      },
      {
        key: "HUBSPOT_ACCESS_TOKEN",
        label: "HubSpot access token (legacy)",
        required: false,
        configured: false,
      },
    ];
    const status: DataSourceStatusResponse = {
      credentials: envStatus,
      providers: [
        {
          provider: "hubspot",
          label: "HubSpot",
          configured: true,
          configuredKeys: ["HUBSPOT_PRIVATE_APP_TOKEN"],
          missingRequiredKeys: [],
          optionalKeys: [],
        },
      ],
    };

    expect(hubspot).toBeTruthy();
    expect(isSourceReady(hubspot!, status, envStatus)).toBe(true);
    expect(isSourceLocallyConfigured(hubspot!, status, envStatus)).toBe(true);
    expect(getConfiguredDataSources(envStatus, status)).toContain(hubspot);
  });

  it("treats a connected HubSpot workspace grant as ready but not locally configured", () => {
    const hubspot = dataSources.find((source) => source.id === "hubspot");
    const envStatus: EnvKeyStatus[] = [
      {
        key: "HUBSPOT_PRIVATE_APP_TOKEN",
        label: "HubSpot private app token",
        required: false,
        configured: false,
      },
      {
        key: "HUBSPOT_ACCESS_TOKEN",
        label: "HubSpot access token (legacy)",
        required: false,
        configured: false,
      },
    ];
    const status: DataSourceStatusResponse = {
      credentials: envStatus,
      providers: [
        {
          provider: "hubspot",
          label: "HubSpot",
          configured: true,
          configuredKeys: [],
          missingRequiredKeys: [],
          optionalKeys: [],
          workspaceConnection: {
            provider: "hubspot",
            label: "HubSpot",
            grantState: "connected",
            connectionCount: 1,
            grantedConnectionCount: 1,
            activeConnectionCount: 1,
            hasWorkspaceConnection: true,
            hasGrantedWorkspaceConnection: true,
            hasActiveWorkspaceConnection: true,
          },
        },
      ],
    };

    expect(hubspot).toBeTruthy();
    expect(isSourceReady(hubspot!, status, envStatus)).toBe(true);
    expect(isSourceLocallyConfigured(hubspot!, status, envStatus)).toBe(false);
    expect(getConfiguredDataSources(envStatus, status)).toContain(hubspot);
  });

  it("keeps a granted but unhealthy connection configured and out of ready sources", () => {
    const hubspot = dataSources.find((source) => source.id === "hubspot")!;
    const envStatus: EnvKeyStatus[] = [
      {
        key: "HUBSPOT_PRIVATE_APP_TOKEN",
        label: "HubSpot private app token",
        required: false,
        configured: false,
      },
      {
        key: "HUBSPOT_ACCESS_TOKEN",
        label: "HubSpot access token (legacy)",
        required: false,
        configured: false,
      },
    ];
    const status: DataSourceStatusResponse = {
      credentials: envStatus,
      providers: [
        {
          provider: "hubspot",
          label: "HubSpot",
          configured: true,
          ready: false,
          configuredKeys: [],
          missingRequiredKeys: [],
          optionalKeys: [],
          workspaceConnection: {
            provider: "hubspot",
            grantState: "granted",
            connectionCount: 1,
            grantedConnectionCount: 1,
            activeConnectionCount: 0,
            hasWorkspaceConnection: true,
            hasGrantedWorkspaceConnection: true,
            hasActiveWorkspaceConnection: false,
            statuses: ["error"],
            connections: [
              {
                id: "analytics-granted-connection",
                status: "error",
                grantedToApp: true,
              },
            ],
          },
        },
      ],
    };

    expect(isSourceReady(hubspot, status, envStatus)).toBe(false);
    expect(isSourceLocallyConfigured(hubspot, status, envStatus)).toBe(false);
    expect(getConfiguredDataSources(envStatus, status)).not.toContain(hubspot);
    expect(getSharedConnectionStatus(hubspot, status, envStatus)?.kind).toBe(
      "error",
    );
  });

  it("ignores ungranted connection errors when mapping Analytics health", () => {
    const hubspot = dataSources.find((source) => source.id === "hubspot")!;
    const status: DataSourceStatusResponse = {
      workspaceConnections: {
        appId: "analytics",
        available: true,
        error: null,
        providers: [
          {
            provider: "hubspot",
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
          },
        ],
      },
    };

    expect(getSharedConnectionStatus(hubspot, status, [])?.kind).toBe(
      "needs_credentials",
    );
  });

  it("does not treat optional-only BigQuery settings as local credentials", () => {
    const bigquery = dataSources.find((source) => source.id === "bigquery")!;
    const envStatus: EnvKeyStatus[] = [
      {
        key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
        label: "Google Cloud",
        required: true,
        configured: false,
      },
      {
        key: "BIGQUERY_PROJECT_ID",
        label: "BigQuery Project ID",
        required: true,
        configured: false,
      },
      {
        key: "ANALYTICS_BIGQUERY_EVENTS_TABLE",
        label: "BigQuery events table",
        required: false,
        configured: true,
      },
    ];
    const status: DataSourceStatusResponse = {
      credentials: envStatus,
      providers: [
        {
          provider: "bigquery",
          label: "BigQuery",
          configured: true,
          ready: false,
          credentialsConfigured: false,
          configuredKeys: ["ANALYTICS_BIGQUERY_EVENTS_TABLE"],
          missingRequiredKeys: [
            "GOOGLE_APPLICATION_CREDENTIALS_JSON",
            "BIGQUERY_PROJECT_ID",
          ],
          optionalKeys: ["ANALYTICS_BIGQUERY_EVENTS_TABLE"],
          workspaceConnection: {
            provider: "bigquery",
            grantState: "granted",
            connectionCount: 1,
            grantedConnectionCount: 1,
            activeConnectionCount: 0,
            hasWorkspaceConnection: true,
            hasGrantedWorkspaceConnection: true,
            hasActiveWorkspaceConnection: false,
            statuses: ["error"],
            connections: [
              {
                id: "analytics-granted-connection",
                status: "error",
                grantedToApp: true,
              },
            ],
          },
        },
      ],
    };

    expect(isSourceReady(bigquery, status, envStatus)).toBe(false);
    expect(isSourceLocallyConfigured(bigquery, status, envStatus)).toBe(false);
    expect(getConfiguredDataSources(envStatus, status)).not.toContain(bigquery);
  });

  it("does not infer readiness from a legacy configured needs-grant response", () => {
    const hubspot = dataSources.find((source) => source.id === "hubspot")!;
    const envStatus: EnvKeyStatus[] = [
      {
        key: "HUBSPOT_PRIVATE_APP_TOKEN",
        label: "HubSpot private app token",
        required: false,
        configured: false,
      },
      {
        key: "HUBSPOT_ACCESS_TOKEN",
        label: "HubSpot access token (legacy)",
        required: false,
        configured: false,
      },
    ];
    const status: DataSourceStatusResponse = {
      credentials: envStatus,
      providers: [
        {
          provider: "hubspot",
          label: "HubSpot",
          configured: true,
          credentialsConfigured: false,
          configuredKeys: [],
          missingRequiredKeys: ["HUBSPOT_PRIVATE_APP_TOKEN"],
          optionalKeys: [],
          workspaceConnection: {
            provider: "hubspot",
            grantState: "needs_grant",
            connectionCount: 1,
            grantedConnectionCount: 0,
            activeConnectionCount: 0,
            hasWorkspaceConnection: true,
            hasGrantedWorkspaceConnection: false,
            hasActiveWorkspaceConnection: false,
          },
        },
      ],
    };

    expect(isSourceReady(hubspot, status, envStatus)).toBe(false);
    expect(getConfiguredDataSources(envStatus, status)).not.toContain(hubspot);
  });

  it("does not use another app's provider errors for a missing Analytics grant", () => {
    const hubspot = dataSources.find((source) => source.id === "hubspot")!;
    const envStatus: EnvKeyStatus[] = [
      {
        key: "HUBSPOT_PRIVATE_APP_TOKEN",
        label: "HubSpot private app token",
        required: true,
        configured: false,
      },
    ];
    for (const status of ["needs_reauth", "error"] as const) {
      const connection = {
        provider: "hubspot",
        grantState: "needs_grant" as const,
        connectionCount: 1,
        grantedConnectionCount: 0,
        activeConnectionCount: 0,
        hasWorkspaceConnection: true,
        hasGrantedWorkspaceConnection: false,
        hasActiveWorkspaceConnection: false,
        statuses: [status],
      };
      const result = getSharedConnectionStatus(
        hubspot,
        {
          workspaceConnections: {
            appId: "analytics",
            available: true,
            error: null,
            providers: [connection],
          },
        },
        envStatus,
      );

      expect(result?.kind).toBe("needs_grant");
      expect(hasExistingWorkspaceConnection(result ?? null)).toBe(false);
    }
  });

  it("handles an older provider payload without optional-key metadata", () => {
    const hubspot = dataSources.find((source) => source.id === "hubspot")!;
    const partialStatus = {
      providers: [
        {
          provider: "hubspot",
          configured: true,
          configuredKeys: ["HUBSPOT_PRIVATE_APP_TOKEN"],
        },
      ],
    } as unknown as DataSourceStatusResponse;

    expect(isSourceLocallyConfigured(hubspot, partialStatus, [])).toBe(true);
  });

  it("surfaces unhealthy shared Sentry connection states separately", () => {
    const sentry = dataSources.find((source) => source.id === "sentry")!;
    const envStatus: EnvKeyStatus[] = [
      {
        key: "SENTRY_AUTH_TOKEN",
        label: "Sentry token",
        required: true,
        configured: false,
      },
    ];
    const connection = {
      provider: "sentry",
      grantState: "granted" as const,
      connectionCount: 1,
      grantedConnectionCount: 1,
      activeConnectionCount: 0,
      hasWorkspaceConnection: true,
      hasGrantedWorkspaceConnection: true,
      hasActiveWorkspaceConnection: false,
    };

    expect(
      getSharedConnectionStatus(
        sentry,
        {
          workspaceConnections: {
            appId: "analytics",
            available: true,
            error: null,
            providers: [
              {
                ...connection,
                statuses: ["needs_reauth"],
                connections: [
                  {
                    id: "sentry-reauth",
                    status: "needs_reauth",
                    grantedToApp: true,
                  },
                ],
              },
            ],
          },
        },
        envStatus,
      )?.kind,
    ).toBe("needs_reauth");
    const unhealthyStatus = getSharedConnectionStatus(
      sentry,
      {
        workspaceConnections: {
          appId: "analytics",
          available: true,
          error: null,
          providers: [
            {
              ...connection,
              statuses: ["error"],
              connections: [
                { id: "sentry-error", status: "error", grantedToApp: true },
              ],
            },
          ],
        },
      },
      envStatus,
    );
    expect(unhealthyStatus?.kind).toBe("error");
    expect(unhealthyStatus?.connection?.hasWorkspaceConnection).toBe(true);
    expect(hasExistingWorkspaceConnection(unhealthyStatus)).toBe(true);
    expect(
      hasExistingWorkspaceConnection({
        kind: "needs_grant",
        label: "Available in workspace",
        providerId: "sentry",
        providerLabel: "Sentry",
        connection: {
          ...connection,
          grantState: "needs_grant",
          grantedConnectionCount: 0,
          hasGrantedWorkspaceConnection: false,
        },
      }),
    ).toBe(false);
    expect(hasExistingWorkspaceConnection(null)).toBe(false);
  });

  it("offers shared HubSpot OAuth for setup and grants, but not when ready or local", () => {
    const hubspot = dataSources.find((source) => source.id === "hubspot")!;

    expect(
      shouldShowWorkspaceOAuthSetup(
        hubspot,
        {
          kind: "ready",
          label: "Ready via workspace",
          providerId: "hubspot",
          providerLabel: "HubSpot",
        },
        true,
      ),
    ).toBe(false);
    expect(
      shouldShowWorkspaceOAuthSetup(
        hubspot,
        {
          kind: "needs_credentials",
          label: "Not connected",
          providerId: "hubspot",
          providerLabel: "HubSpot",
        },
        false,
      ),
    ).toBe(false);
    expect(
      shouldShowWorkspaceOAuthSetup(
        hubspot,
        {
          kind: "needs_credentials",
          label: "Not connected",
          providerId: "hubspot",
          providerLabel: "HubSpot",
        },
        true,
      ),
    ).toBe(true);
    expect(
      shouldShowWorkspaceOAuthSetup(
        hubspot,
        {
          kind: "needs_grant",
          label: "Available in workspace",
          providerId: "hubspot",
          providerLabel: "HubSpot",
        },
        true,
      ),
    ).toBe(true);
    expect(
      shouldShowWorkspaceOAuthSetup(
        hubspot,
        {
          kind: "local_credentials",
          label: "Configured in this app",
          providerId: "hubspot",
          providerLabel: "HubSpot",
        },
        true,
      ),
    ).toBe(false);
  });

  it("explains org-managed HubSpot setup to members instead of silently hiding it", () => {
    const hubspot = dataSources.find((source) => source.id === "hubspot")!;

    expect(shouldShowWorkspaceOAuthAdminNotice(hubspot, false, false)).toBe(
      true,
    );
    expect(shouldShowWorkspaceOAuthAdminNotice(hubspot, true, false)).toBe(
      false,
    );
    expect(shouldShowWorkspaceOAuthAdminNotice(hubspot, false, true)).toBe(
      false,
    );
    expect(
      shouldShowWorkspaceOAuthAdminNotice(hubspot, false, false, false, true),
    ).toBe(false);
    expect(
      shouldShowWorkspaceOAuthAdminNotice(hubspot, false, false, true, false),
    ).toBe(false);
  });

  it("offers OAuth recovery to admins only after a ready connection fails testing", () => {
    const hubspot = dataSources.find((source) => source.id === "hubspot")!;
    const readyStatus = {
      kind: "ready" as const,
      label: "Ready via workspace",
      providerId: "hubspot",
      providerLabel: "HubSpot",
    };

    expect(
      shouldOfferWorkspaceOAuthReconnect(hubspot, readyStatus, true, true),
    ).toBe(true);
    expect(
      shouldOfferWorkspaceOAuthReconnect(hubspot, readyStatus, true, false),
    ).toBe(false);
    expect(
      shouldOfferWorkspaceOAuthReconnect(hubspot, readyStatus, false, true),
    ).toBe(false);
  });

  it("focuses a provider-specific setup link and preserves the Ask return", () => {
    const resolution = focusedDataSourceFromSearchParams(
      new URLSearchParams("source=HubSpot&returnTo=ask"),
    );
    expect(resolution.status).toBe("found");
    const focused =
      resolution.status === "found" ? resolution.source : undefined;

    expect(focused?.id).toBe("hubspot");
    expect(dataSourceOAuthReturnPath(focused, true)).toBe(
      "/data-sources?source=hubspot&returnTo=ask",
    );
    expect(dataSourceOAuthReturnPath(undefined, false)).toBe("/data-sources");
  });

  it("focuses legacy PostgreSQL links and preserves unknown source ids without throwing", () => {
    expect(
      focusedDataSourceFromSearchParams(new URLSearchParams("source=postgres")),
    ).toMatchObject({
      status: "found",
      source: { id: "postgresql" },
    });
    expect(
      focusedDataSourceFromSearchParams(
        new URLSearchParams("source=not-a-real-source"),
      ),
    ).toEqual({
      status: "unknown",
      requestedId: "not-a-real-source",
    });
    expect(focusedDataSourceFromSearchParams(new URLSearchParams())).toEqual({
      status: "none",
    });
  });
});
