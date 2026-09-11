import { describe, expect, it } from "vitest";

import { toCSV, toCSVTable } from "./export-utils.js";

describe("db admin export utils", () => {
  it("escapes spreadsheet formulas in CSV cells", () => {
    expect(
      toCSVTable(
        ["name", "value"],
        [
          ["formula", '=IMPORTXML("https://example.test")'],
          ["plus", "+1+1"],
          ["minus", "-10"],
          ["at", "@cmd"],
        ],
      ),
    ).toContain('formula,"\'=IMPORTXML(""https://example.test"")"');
    expect(toCSV(["value"], [{ value: "+1+1" }])).toBe("value\r\n'+1+1");
  });
});
