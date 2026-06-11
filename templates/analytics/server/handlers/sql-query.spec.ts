import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  body: undefined as unknown,
  setResponseStatus: vi.fn(),
  requireCredential: vi.fn(async () => null),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  setResponseStatus: mocks.setResponseStatus,
}));

vi.mock("@agent-native/core/server", () => ({
  readBody: vi.fn(async () => mocks.body),
}));

vi.mock("../lib/credentials", () => ({
  requireCredential: mocks.requireCredential,
  runApiHandlerWithContext: (_event: unknown, fn: (ctx: any) => unknown) =>
    fn({ userEmail: "alice@example.com", orgId: null }),
}));

vi.mock("../lib/bigquery", () => ({
  runQuery: vi.fn(),
}));

vi.mock("../lib/google-analytics", () => ({
  runReport: vi.fn(),
}));

vi.mock("../lib/amplitude", () => ({
  getUserSegmentation: vi.fn(),
  queryEvents: vi.fn(),
}));

vi.mock("../lib/first-party-analytics", () => ({
  queryFirstPartyAnalytics: vi.fn(),
}));

vi.mock("../lib/prometheus", () => ({
  runPrometheusPanel: vi.fn(),
  serializePanelDescriptorInput: vi.fn((raw: unknown) =>
    typeof raw === "string" ? raw : JSON.stringify(raw),
  ),
}));

const { handleSqlQuery } = await import("./sql-query");

describe("/api/sql-query demo source", () => {
  beforeEach(() => {
    mocks.body = undefined;
    mocks.setResponseStatus.mockClear();
    mocks.requireCredential.mockClear();
  });

  it("runs valid demo descriptors without credential checks", async () => {
    mocks.body = {
      source: "demo",
      query: {
        adapter: "prometheus",
        dataset: "node-exporter",
        query: "node-up",
        mode: "instant",
      },
    };

    const result = (await handleSqlQuery({} as any)) as {
      rows: Record<string, unknown>[];
      schema: { name: string; type: string }[];
    };

    expect(mocks.requireCredential).not.toHaveBeenCalled();
    expect(result.rows).toEqual([
      expect.objectContaining({
        timestamp: expect.any(String),
        series: expect.stringContaining('up{instance="demo-host-01"'),
        value: 1,
      }),
    ]);
    expect(result.schema).toEqual([
      { name: "timestamp", type: "string" },
      { name: "series", type: "string" },
      { name: "value", type: "number" },
    ]);
  });

  it("rejects malformed demo descriptors", async () => {
    mocks.body = {
      source: "demo",
      query: "not json",
    };

    const result = await handleSqlQuery({} as any);

    expect(mocks.setResponseStatus).toHaveBeenCalledWith({}, 400);
    expect(result).toEqual({
      error: expect.stringContaining("demo panel sql must be a JSON object"),
    });
  });

  it("lists demo in invalid source errors", async () => {
    mocks.body = {
      source: "unknown",
      query: "SELECT 1",
    };

    const result = await handleSqlQuery({} as any);

    expect(mocks.setResponseStatus).toHaveBeenCalledWith({}, 400);
    expect(result).toEqual({
      error: expect.stringContaining("'demo'"),
    });
  });
});
