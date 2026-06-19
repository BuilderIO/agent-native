import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DATA_CHART_WIDGET,
  DATA_INSIGHTS_WIDGET,
  DATA_TABLE_WIDGET,
} from "@agent-native/core/data-widgets";

const dbMock = vi.hoisted(() => {
  let results: unknown[][] = [];

  function query() {
    const result = results.shift() ?? [];
    const builder = {
      from: vi.fn(() => builder),
      where: vi.fn(() => builder),
      orderBy: vi.fn(() => builder),
      limit: vi.fn(async () => result),
      groupBy: vi.fn(async () => result),
    };
    return builder;
  }

  return {
    setResults(next: unknown[][]) {
      results = [...next];
    },
    getDb: () => ({
      select: vi.fn(() => query()),
    }),
  };
});

const sharingMock = vi.hoisted(() => ({
  accessFilter: vi.fn(() => true),
  assertAccess: vi.fn(async () => ({ resource: form })),
}));

vi.mock("../server/db/index.js", async () => ({
  getDb: dbMock.getDb,
  schema: await vi.importActual("../server/db/schema.js"),
}));

vi.mock("@agent-native/core/sharing", () => sharingMock);

const { default: responseInsights } = await import("./response-insights.js");

const form = {
  id: "form_1",
  title: "Hackathon Submission",
  description: "",
  slug: "hackathon-submission",
  fields: JSON.stringify([
    { id: "name", type: "text", label: "Name", required: true },
    { id: "project", type: "text", label: "Project", required: true },
  ]),
  settings: "{}",
  status: "published",
  visibility: "private",
  ownerEmail: "owner@example.com",
  orgId: "org_1",
  deletedAt: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

const responses = [
  {
    id: "response_1",
    formId: "form_1",
    data: JSON.stringify({ name: "Ada", project: "Charts" }),
    submittedAt: new Date().toISOString(),
    ip: null,
    submitterEmail: null,
  },
  {
    id: "response_2",
    formId: "form_1",
    data: JSON.stringify({ name: "Grace", project: "Tables" }),
    submittedAt: new Date(Date.now() - 86_400_000).toISOString(),
    ip: null,
    submitterEmail: null,
  },
];

async function runInsights(displayMode?: "chart" | "table" | "insights") {
  dbMock.setResults([
    [form],
    responses,
    [{ formId: "form_1", count: responses.length }],
  ]);

  return responseInsights.run({
    formId: "form_1",
    ...(displayMode ? { displayMode } : {}),
  });
}

describe("response-insights action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharingMock.assertAccess.mockResolvedValue({ resource: form });
  });

  it("requires editor access before reading a specific form's responses", async () => {
    await runInsights("table");

    expect(sharingMock.assertAccess).toHaveBeenCalledWith(
      "form",
      "form_1",
      "editor",
    );
  });

  it("filters aggregate response insights to editor-level forms", async () => {
    dbMock.setResults([[], []]);

    await responseInsights.run({ displayMode: "chart" });

    expect(sharingMock.accessFilter).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      "editor",
    );
  });

  it("returns only a chart widget for chart requests", async () => {
    const result = await runInsights("chart");

    expect(result.widget).toBe(DATA_CHART_WIDGET);
    expect(result.chartSeries).toBeDefined();
    expect("table" in result).toBe(false);
  });

  it("returns only a table widget for table requests", async () => {
    const result = await runInsights("table");

    expect(result.widget).toBe(DATA_TABLE_WIDGET);
    expect(result.table).toBeDefined();
    expect("chartSeries" in result).toBe(false);
    expect(result.display?.primaryAction?.href).toBe("/forms/form_1/responses");
  });

  it("keeps the combined insights widget as the default", async () => {
    const result = await runInsights();

    expect(result.widget).toBe(DATA_INSIGHTS_WIDGET);
    expect(result.chartSeries).toBeDefined();
    expect(result.table).toBeDefined();
  });
});
