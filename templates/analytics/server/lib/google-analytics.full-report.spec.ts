import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveCredential = vi.hoisted(() => vi.fn());

vi.mock("./credentials", () => ({ resolveCredential }));
vi.mock("./credentials-context", () => ({
  credentialCacheScope: () => "org:fixture",
  requireRequestCredentialContext: () => ({}),
  scopedCredentialCacheKey: (key: string) => key,
}));
vi.mock("./sign-jwt", () => ({ signRs256Jwt: async () => "fixture-jwt" }));

describe("full GA4 report property selection", () => {
  let runFullReport: typeof import("./google-analytics").runFullReport;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    resolveCredential.mockReset().mockImplementation(async (key: string) => {
      if (key === "GA4_PROPERTY_ID") return "222222222";
      if (key === "GOOGLE_APPLICATION_CREDENTIALS_JSON") {
        return JSON.stringify({
          client_email: "collector@example.test",
          private_key: "fixture-key",
        });
      }
      return null;
    });
    fetchMock = vi.fn(async (input: string, init: RequestInit) => {
      if (input === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "fixture-token" });
      }
      const { offset } = JSON.parse(String(init.body));
      return Response.json({
        rowCount: 1,
        rows: [
          {
            dimensionValues: [{ value: `2026100${offset + 1}` }],
            metricValues: [{ value: "1" }],
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    ({ runFullReport } = await import("./google-analytics"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const request = {
    dimensions: ["date"],
    metrics: ["screenPageViews"],
    dateRange: { startDate: "2026-10-01", endDate: "2026-10-02" },
    maxRows: 2,
  };

  it("uses the collection property without resolving the shared property", async () => {
    expect(
      await runFullReport({ ...request, propertyId: "111111111" }),
    ).toHaveLength(1);
    const reportCalls = fetchMock.mock.calls.filter(([url]) =>
      url.includes(":runReport"),
    );
    expect(reportCalls.map(([url]) => url)).toEqual([
      "https://analyticsdata.googleapis.com/v1beta/properties/111111111:runReport",
    ]);
    expect(resolveCredential.mock.calls.map(([key]) => key)).not.toContain(
      "GA4_PROPERTY_ID",
    );
  });

  it("keeps shared-property behavior for callers without an override", async () => {
    await runFullReport(request);
    expect(
      fetchMock.mock.calls
        .filter(([url]) => url.includes(":runReport"))
        .map(([url]) => url),
    ).toEqual([
      "https://analyticsdata.googleapis.com/v1beta/properties/222222222:runReport",
    ]);
    expect(resolveCredential.mock.calls.map(([key]) => key)).toContain(
      "GA4_PROPERTY_ID",
    );
  });
});
