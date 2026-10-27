import { describe, expect, it } from "vitest";

import { isNumericColumnFormat, numberTableColumns } from "./table-columns";

describe("numberTableColumns", () => {
  it("right-aligns number formats and text that is a number, maybe with a unit", () => {
    const columns = numberTableColumns(
      [
        { key: "name" },
        { key: "count" },
        { key: "share", format: "percent" },
        { key: "wait" },
        { key: "price" },
        { key: "code", format: "text" },
        { key: "day" },
        { key: "signedUp", format: "date" },
        { key: "url", format: "link" },
        { key: "empty" },
      ],
      [
        {
          name: "Mail",
          count: "1,200",
          share: 0.4,
          wait: "4.8 days",
          price: "$12.50",
          code: "123",
          day: "2026-10-01",
          signedUp: "2026-10-01T09:30:00Z",
          url: "42",
          empty: null,
        },
        {
          name: "Slides",
          count: 7,
          share: 0.6,
          wait: "3 min",
          price: "€8",
          code: "456",
          day: "2026-10-02",
          signedUp: "2026-10-02T09:30:00Z",
          url: "43",
          empty: "",
        },
      ],
    );
    expect([...columns]).toEqual(["count", "share", "wait", "price", "code"]);
  });

  it("keeps a column left when one value is not a number", () => {
    expect([
      ...numberTableColumns(
        [{ key: "wait" }],
        [{ wait: "4.8 days" }, { wait: "pending" }],
      ),
    ]).toEqual([]);
  });

  it("names the number formats", () => {
    expect(
      ["number", "currency", "percent", "delta", "duration"].every((format) =>
        isNumericColumnFormat(format as never),
      ),
    ).toBe(true);
    expect(isNumericColumnFormat("text")).toBe(false);
    expect(isNumericColumnFormat(undefined)).toBe(false);
  });
});
