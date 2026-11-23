import { readFileSync } from "node:fs";

import { parseSpreadsheetDocument } from "@agent-native/core/ingestion";
import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";

describe("XLSX attachment runtime", () => {
  it("declares xlsx as an app dependency so the served build bundles it", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies?.xlsx).toBeTruthy();
  });

  it("parses an uploaded workbook through the ingestion parser", async () => {
    const workbook = utils.book_new();
    utils.book_append_sheet(
      workbook,
      utils.aoa_to_sheet([
        ["region", "revenue"],
        ["emea", 12],
      ]),
      "Sales",
    );
    const data = write(workbook, { type: "buffer", bookType: "xlsx" });
    const parsed = await parseSpreadsheetDocument({
      data: new Uint8Array(data),
      fileName: "sales.xlsx",
    });
    expect(parsed.text).toContain("emea");
    expect(parsed.metadata.sheetNames).toEqual(["Sales"]);
  });
});
