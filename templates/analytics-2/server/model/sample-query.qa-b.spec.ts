import { describe, expect, it } from "vitest";

import { executeSampleQuery } from "./sample-query.js";

describe("running an empty sample query", () => {
  it("answers blank source with an empty table instead of an unsupported failure", async () => {
    for (const source of ["", "   ", "\n\t\n"]) {
      const result = await executeSampleQuery(source, [], true);
      expect(result, JSON.stringify(source)).toEqual({
        output: {
          type: "table",
          columns: [],
          rows: [],
          rowCount: 0,
          truncated: false,
        },
      });
    }
  });
});
