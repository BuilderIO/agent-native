import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveCredentialDetailed = vi.fn();

vi.mock("./credentials", () => ({
  resolveCredentialDetailed,
  assertCredentialCanReachEndpoint: (
    endpoint: { scope: string; scopeId?: string },
    credential: { scope?: string; scopeId?: string } | undefined,
    key?: string,
  ) => {
    if (endpoint.scope !== "user" && endpoint.scope !== "unknown") return;
    if (
      endpoint.scope === "user" &&
      credential?.scope === "user" &&
      endpoint.scopeId &&
      credential.scopeId === endpoint.scopeId
    ) {
      return;
    }
    throw new Error(
      `Refusing to send ${key ?? "a credential"} to a user-scoped endpoint unless it is saved by the same user.`,
    );
  },
}));

vi.mock("./credentials-context", () => ({
  requireRequestCredentialContext: vi.fn(() => ({
    userEmail: "ada@example.com",
    orgId: "org-1",
  })),
  scopedCredentialCacheKey: (key: string) => key,
}));

const { listDashboards, queryDatasource } = await import("./grafana");

describe("Grafana credential endpoint ownership", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resolveCredentialDetailed.mockReset();
    resolveCredentialDetailed.mockImplementation(async (key: string) =>
      key === "GRAFANA_URL"
        ? {
            value: "https://member-grafana.example.test",
            scope: "user",
            scopeId: "ada@example.com",
          }
        : {
            value: "org-grafana-test-token",
            scope: "org",
            scopeId: "org-1",
          },
    );
  });

  it.each(["listDashboards", "queryDatasource"])(
    "does not send an org token to a personal Grafana endpoint through %s",
    async (helper) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(
        helper === "listDashboards"
          ? listDashboards()
          : queryDatasource("datasource-1", []),
      ).rejects.toThrow(/GRAFANA_API_TOKEN.*user-scoped endpoint/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );
});
