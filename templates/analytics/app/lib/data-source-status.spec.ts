import { describe, expect, it } from "vitest";

import {
  dataSourceOAuthReturnPath,
  focusedDataSourceFromSearchParams,
  getConfiguredDataSources,
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
