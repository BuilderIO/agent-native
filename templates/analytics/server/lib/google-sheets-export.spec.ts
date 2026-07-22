import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeProviderApiRequest: vi.fn(),
}));

vi.mock("./provider-api", () => ({
  executeProviderApiRequest: mocks.executeProviderApiRequest,
}));

import { exportDashboardPanelToGoogleSheet } from "./google-sheets-export";

describe("google-sheets-export", () => {
  beforeEach(() => {
    mocks.executeProviderApiRequest.mockReset();
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce({
        response: {
          ok: true,
          status: 200,
          json: {
            spreadsheetId: "sheet-1",
            spreadsheetUrl:
              "https://docs.google.com/spreadsheets/d/sheet-1/edit",
            sheets: [{ properties: { title: "Revenue - Recent orders" } }],
          },
        },
      })
      .mockResolvedValueOnce({
        response: {
          ok: true,
          status: 200,
          json: { updatedRows: 2, updatedColumns: 2, updatedCells: 4 },
        },
      });
  });

  it("creates a sheet through google_drive OAuth and writes schema plus rows", async () => {
    const result = await exportDashboardPanelToGoogleSheet({
      dashboardId: "dashboard-1",
      dashboardTitle: "Revenue",
      panelId: "table-1",
      panelTitle: "Recent orders",
      source: "bigquery",
      rows: [
        {
          order_id: "order-1",
          total: 42,
          tags: ["new", "paid"],
          details: { region: "US" },
        },
        { order_id: "order-2", total: null, tags: [], details: null },
      ],
      schema: [
        { name: "order_id", type: "string" },
        { name: "total", type: "number" },
        { name: "tags", type: "string" },
        { name: "details", type: "string" },
      ],
      truncated: true,
      bytesProcessed: 2048,
    });

    expect(mocks.executeProviderApiRequest).toHaveBeenNthCalledWith(1, {
      provider: "google_drive",
      method: "POST",
      path: "https://sheets.googleapis.com/v4/spreadsheets",
      query: {
        fields:
          "spreadsheetId,spreadsheetUrl,properties.title,sheets.properties",
      },
      body: { properties: { title: "Revenue - Recent orders" } },
    });
    expect(mocks.executeProviderApiRequest).toHaveBeenNthCalledWith(2, {
      provider: "google_drive",
      method: "PUT",
      path: "https://sheets.googleapis.com/v4/spreadsheets/sheet-1/values/'Revenue%20-%20Recent%20orders'!A1",
      query: { valueInputOption: "RAW" },
      body: {
        range: "'Revenue - Recent orders'!A1",
        majorDimension: "ROWS",
        values: [
          ["order_id", "total", "tags", "details"],
          ["order-1", 42, '["new","paid"]', '{"region":"US"}'],
          ["order-2", "", "[]", ""],
        ],
      },
    });
    expect(result).toEqual({
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
      spreadsheetId: "sheet-1",
      rowCount: 2,
      metadata: {
        dashboardId: "dashboard-1",
        dashboardTitle: "Revenue",
        panelId: "table-1",
        panelTitle: "Recent orders",
        source: "bigquery",
        chartType: "table",
        sheetTitle: "Revenue - Recent orders",
        columns: ["order_id", "total", "tags", "details"],
        columnCount: 4,
        truncated: true,
        bytesProcessed: 2048,
        provider: "google_drive",
        updatedCells: 4,
      },
    });
  });

  it("does not send an invalid values request for an empty result with no columns", async () => {
    mocks.executeProviderApiRequest.mockReset();
    mocks.executeProviderApiRequest.mockResolvedValue({
      response: {
        ok: true,
        status: 200,
        json: { spreadsheetId: "empty-sheet", sheets: [] },
      },
    });

    await expect(
      exportDashboardPanelToGoogleSheet({
        dashboardId: "dashboard-1",
        dashboardTitle: "Revenue",
        panelId: "table-1",
        panelTitle: "Empty",
        source: "first-party",
        rows: [],
        schema: [],
      }),
    ).resolves.toMatchObject({
      spreadsheetId: "empty-sheet",
      rowCount: 0,
      metadata: { columns: [], updatedCells: null },
    });
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(1);
  });

  it("fails without masking provider HTTP errors", async () => {
    mocks.executeProviderApiRequest.mockReset();
    mocks.executeProviderApiRequest.mockResolvedValue({
      response: { ok: false, status: 403, statusText: "Forbidden" },
    });

    await expect(
      exportDashboardPanelToGoogleSheet({
        dashboardId: "dashboard-1",
        dashboardTitle: "Revenue",
        panelId: "table-1",
        panelTitle: "Recent orders",
        source: "bigquery",
        rows: [],
        schema: [],
      }),
    ).rejects.toThrow("Google Sheet creation failed HTTP 403 Forbidden");
  });
});
