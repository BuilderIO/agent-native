import { describe, expect, it } from "vitest";

import {
  getConfiguredDataSources,
  isSourceConfigured,
  isSourceLocallyConfigured,
  isSourceReady,
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
});
