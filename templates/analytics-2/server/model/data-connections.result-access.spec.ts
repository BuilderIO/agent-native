import { beforeEach, describe, expect, it, vi } from "vitest";

// Row 819: a COUNT query on the workspace BigQuery source runs, persists its
// exact SQL and connection, and then the readback refuses with "You do not have
// access to view results from this data connection" - because the result gate
// looked for the org on the personal-scope connection context, which blanks it.
// The query path resolves the workspace org, so the gate must use that one.
const mocks = vi.hoisted(() => ({
  requestContext: {
    userEmail: "member@example.test",
    orgId: "org-1",
    orgScope: "personal",
  } as Record<string, unknown>,
  readiness: "configured" as string,
  workspaceOrgId: "org-1",
}));

vi.mock("@agent-native/core/action", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fail: (message: string, options?: Record<string, unknown>) => {
      throw Object.assign(new Error(message), options);
    },
  };
});

vi.mock("@agent-native/core/server", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@agent-native/core/server",
  );
  return { ...actual, getRequestContext: () => mocks.requestContext };
});

vi.mock("../lib/workspace-access.js", () => ({
  requireCurrentWorkspace: async () => ({
    orgId: mocks.workspaceOrgId,
    ownerEmail: "owner@example.test",
    capabilities: [],
    allows: () => true,
    isManagerOrAbove: false,
  }),
}));

vi.mock("../lib/org-bigquery-credentials.js", () => ({
  getOrganizationBigQueryCredentialReadiness: async ({
    orgId,
  }: {
    orgId: string;
  }) => (orgId === mocks.workspaceOrgId ? mocks.readiness : "missing"),
  requireOrganizationBigQueryProjectId: async () => "agent-native-qa-bq",
}));

vi.mock("../lib/org-bigquery-connection-details.js", () => ({
  getOrganizationBigQueryDetails: async () => ({
    connectionName: "QA BigQuery sample",
    connectionDescription: "",
  }),
}));

const { canReadConnectionResults } = await import("./data-connections.js");
const { ORGANIZATION_BIGQUERY_SOURCE_ID } =
  await import("../../shared/bigquery-source-contract.js");

beforeEach(() => {
  mocks.readiness = "configured";
  mocks.requestContext = {
    userEmail: "member@example.test",
    orgId: "org-1",
    orgScope: "personal",
  };
});

describe("result access for the workspace BigQuery source", () => {
  it("allows the readback in a personal scope, where the workspace credential is configured", async () => {
    await expect(
      canReadConnectionResults(ORGANIZATION_BIGQUERY_SOURCE_ID),
    ).resolves.toBe(true);
  });

  it("still refuses when the workspace credential is not configured", async () => {
    mocks.readiness = "missing";
    await expect(
      canReadConnectionResults(ORGANIZATION_BIGQUERY_SOURCE_ID),
    ).resolves.toBe(false);
  });
});
