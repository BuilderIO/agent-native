import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { parseOfficeDocument } from "./office.js";
import {
  detectSpreadsheetDocumentType,
  parseSpreadsheetDocument,
} from "./spreadsheet.js";

function workbookBytes(): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Name", "Plan", "Active"],
      ["Acme", "Growth", true],
      ["Globex", "Starter", false],
    ]),
    "Accounts",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Month", "Revenue"],
      ["2026-01", 1200],
    ]),
    "Revenue",
  );
  return new Uint8Array(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
  );
}

describe("spreadsheet ingestion", () => {
  it("recognizes Excel extensions and MIME types", () => {
    expect(detectSpreadsheetDocumentType("accounts.xlsx")).toBe("xlsx");
    expect(detectSpreadsheetDocumentType("accounts.xls")).toBe("xls");
    expect(
      detectSpreadsheetDocumentType(
        "download",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe("xlsx");
  });

  it("returns worksheet metadata and a bounded preview", async () => {
    const parsed = await parseSpreadsheetDocument({
      data: workbookBytes(),
      fileName: "accounts.xlsx",
      maxRowsPerSheet: 1,
    });

    expect(parsed.parser).toBe("sheetjs-workbook");
    expect(parsed.metadata.sheetNames).toEqual(["Accounts", "Revenue"]);
    expect(parsed.parts[0]).toMatchObject({
      title: "Accounts",
      metadata: {
        rowCount: 3,
        columnCount: 3,
        sampledRowCount: 1,
        truncated: true,
      },
    });
    expect(parsed.text).toContain("Sheet: Accounts");
    expect(parsed.text).toContain("Name\tPlan\tActive");
    expect(parsed.text).not.toContain("Acme");
  });

  it("uses the same parser through the office ingestion boundary", async () => {
    const parsed = await parseOfficeDocument({
      data: workbookBytes(),
      fileName: "accounts.xlsx",
    });

    expect(parsed.fileType).toBe("xlsx");
    expect(parsed.parser).toBe("sheetjs-workbook");
    expect(parsed.parts[0]?.kind).toBe("sheet");
    expect(parsed.metadata).toMatchObject({
      sheetCount: 2,
      sheetNames: ["Accounts", "Revenue"],
    });
  });

  it("keeps the preview within the requested character bound", async () => {
    const parsed = await parseSpreadsheetDocument({
      data: workbookBytes(),
      fileName: "accounts.xlsx",
      maxChars: 12,
    });

    expect(parsed.text.length).toBeLessThanOrEqual(12);
    expect(parsed.metadata.truncated).toBe(true);
  });
});
