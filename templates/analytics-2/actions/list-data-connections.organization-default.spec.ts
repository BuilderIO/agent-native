// oracle-change(templates/analytics-2/actions/list-data-sources.organization-default.spec.ts): migrate removed catalog API coverage to list-data-connections.organization-default.spec.ts, retaining reserved-ID spoof denial and distinguishing unavailable credentials from absent ones.
// oracle-change: migrate the removed catalog action to connection DTOs; an unreadable credential lookup must fail rather than masquerade as an absent default.
import { ActionContractError } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../shared/bigquery-source-contract.js";

const mocks = vi.hoisted(() => ({
  selected: null as Record<string, unknown> | null,
  orgDbt: null as Record<string, unknown> | null,
  listed: [] as Array<Record<string, unknown>>,
  credentialState: "configured",
  resolve: vi.fn(),
  listGate: null as Promise<void> | null,
  selectedGate: null as Promise<void> | null,
  details: vi.fn(),
}));
vi.mock(import("@agent-native/core/server"), async (importOriginal) => ({
  ...(await importOriginal()),
  getRequestContext: () => ({
    userEmail: "owner@example.test",
    orgId: "org-1",
  }),
  runWithRequestContext: (_context: unknown, run: () => unknown) => run(),
}));
vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: async (_org: string, key: string) => {
    if (key === "analytics-2.organization-bigquery-dbt") return mocks.orgDbt;
    if (key !== "analytics.data.default-connection") return null;
    await mocks.selectedGate;
    return mocks.selected;
  },
  getSettingEntry: async () => ({ found: false }),
}));
vi.mock("@agent-native/core/workspace-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/workspace-connections")
  >()),
  listWorkspaceConnectionsForApp: async () => {
    await mocks.listGate;
    return mocks.listed;
  },
}));
vi.mock("@agent-native/core/credentials", () => ({
  resolveCredentialDetailed: mocks.resolve,
}));
vi.mock("../server/lib/org-bigquery-connection-details.js", () => ({
  getOrganizationBigQueryDetails: mocks.details,
}));

import { requireOrganizationBigQueryCredentials } from "../server/lib/org-bigquery-credentials.js";
import action from "./list-data-connections.js";

describe("organization default discovery", () => {
  beforeEach(() => {
    mocks.selected = { id: ORGANIZATION_BIGQUERY_SOURCE_ID };
    mocks.orgDbt = null;
    mocks.listed = [];
    mocks.credentialState = "configured";
    mocks.listGate = null;
    mocks.selectedGate = null;
    mocks.details.mockReset().mockResolvedValue(null);
    mocks.resolve
      .mockReset()
      .mockImplementation(async (key: string) =>
        mocks.credentialState === "missing" ||
        (mocks.credentialState === "partial" && key !== "BIGQUERY_PROJECT_ID")
          ? null
          : { scope: "org", scopeId: "org-1", value: "fixture-credential" },
      );
  });

  it("report A2-CONNECTION-READ-LATENCY: starts organization readiness without waiting for the workspace catalog", async () => {
    let release = () => {};
    mocks.listGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const result = action.run({}, { caller: "frontend" } as never);
    try {
      await vi.waitFor(() => expect(mocks.resolve).toHaveBeenCalled());
    } finally {
      release();
    }
    expect((await result).connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: ORGANIZATION_BIGQUERY_SOURCE_ID }),
      ]),
    );
  });

  it("report A2-CONNECTION-READ-LATENCY: starts credential and label reads before the default setting resolves", async () => {
    let release = () => {};
    mocks.selectedGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const result = action.run({}, { caller: "frontend" } as never);
    try {
      await vi.waitFor(() => {
        expect(mocks.resolve).toHaveBeenCalled();
        expect(mocks.details).toHaveBeenCalled();
      });
    } finally {
      release();
      await result;
    }
  });

  it("reports unreadable details for a configured organization source", async () => {
    const error = new Error("details unavailable");
    mocks.details.mockRejectedValue(error);
    await expect(action.run({}, { caller: "frontend" } as never)).rejects.toBe(
      error,
    );
  });

  it("does not require details for an unconfigured organization source", async () => {
    mocks.credentialState = "missing";
    mocks.details.mockRejectedValue(new Error("details unavailable"));
    const result = await action.run({}, { caller: "frontend" } as never);
    expect(result.connections.map((row) => row.id)).not.toContain(
      ORGANIZATION_BIGQUERY_SOURCE_ID,
    );
  });

  it("keeps a configured organization default outside the workspace catalog", async () => {
    const result = await action.run({}, { caller: "frontend" } as never);
    const organization = result.connections.filter(
      (row) => row.id === ORGANIZATION_BIGQUERY_SOURCE_ID,
    );
    expect(organization).toEqual([
      expect.objectContaining({
        type: "bigquery",
        isDefault: true,
        shared: true,
      }),
    ]);
    expect(action.outputSchema.parse(result)).toEqual(result);
    expect(mocks.resolve).toHaveBeenCalledWith("BIGQUERY_PROJECT_ID", {
      orgId: "org-1",
      userEmail: "owner@example.test",
      credentialScope: "org",
    });
    expect(JSON.stringify(result)).not.toContain("fixture-credential");
    expect(JSON.stringify(result)).not.toContain("credentialRefs");
  });

  it.each(["missing", "partial"])(
    "hides a %s organization default even if a catalog record reuses its reserved ID",
    async (state) => {
      mocks.credentialState = state;
      mocks.listed = [
        {
          id: ORGANIZATION_BIGQUERY_SOURCE_ID,
          provider: "bigquery",
          label: "Spoofed reserved connection",
          orgId: "org-1",
          ownerEmail: "owner@example.test",
          status: "connected",
          allowedUsers: [],
          allowedUserGroups: [],
          credentialRefs: [],
          config: { includeInAgentDiscovery: true },
        },
      ];
      const result = await action.run({}, { caller: "frontend" } as never);
      expect(result.connections.filter((row) => row.isDefault)).toEqual([]);
      expect(result.connections.map((row) => row.id)).not.toContain(
        ORGANIZATION_BIGQUERY_SOURCE_ID,
      );
    },
  );

  it("fails an unavailable organization credential lookup instead of hiding the default", async () => {
    mocks.resolve.mockRejectedValue(
      new Error("Private credential store detail"),
    );
    await expect(
      action.run({}, { caller: "frontend" } as never),
    ).rejects.toMatchObject({
      statusCode: 503,
      errorCode: "bigquery_credentials_unavailable",
      message: expect.not.stringContaining("Private credential store detail"),
    });
  });

  it("preserves a credential resolver's typed authorization denial", async () => {
    const denied = new ActionContractError("Credential access denied", {
      statusCode: 403,
      errorCode: "credential_access_denied",
    });
    mocks.resolve.mockRejectedValue(denied);
    await expect(action.run({}, { caller: "frontend" } as never)).rejects.toBe(
      denied,
    );
  });

  it("preserves the typed denial when requiring configured organization credentials", async () => {
    const denied = new ActionContractError("Credential access denied", {
      statusCode: 403,
      errorCode: "credential_access_denied",
    });
    mocks.resolve.mockRejectedValue(denied);
    await expect(
      requireOrganizationBigQueryCredentials({
        orgId: "org-1",
        userEmail: "owner@example.test",
      }),
    ).rejects.toBe(denied);
  });

  it("refuses an unreadable legacy default paired with another provider", async () => {
    mocks.selected = {
      provider: "other",
      connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
    };
    await expect(
      action.run({}, { caller: "frontend" } as never),
    ).rejects.toMatchObject({
      statusCode: 503,
      errorCode: "data_connection_default_unreadable",
    });
  });

  it("reports hasDbtMetadata on the organization BigQuery connection when org dbt is enabled", async () => {
    mocks.orgDbt = {
      revision: 1,
      config: {
        hasDbtMetadata: true,
        dbtVersion: "current",
        dbtCloudHostname: "cloud.getdbt.com",
        dbtEnvironmentId: "42",
      },
    };
    const result = await action.run({}, { caller: "frontend" } as never);
    const organization = result.connections.find(
      (row) => row.id === ORGANIZATION_BIGQUERY_SOURCE_ID,
    );
    expect(organization?.hasDbtMetadata).toBe(true);
  });
});
