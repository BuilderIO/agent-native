import { describe, expect, it } from "vitest";

import { sortBookingsNewestFirst } from "./booking-sorting";

describe("sortBookingsNewestFirst", () => {
  it("puts the latest booking first", () => {
    const bookings = [
      { id: "march", start: "2026-03-31T09:00:00.000Z" },
      { id: "sept-22", start: "2026-09-22T09:00:00.000Z" },
      { id: "sept-25", start: "2026-09-25T09:00:00.000Z" },
    ];

    expect(sortBookingsNewestFirst(bookings).map(({ id }) => id)).toEqual([
      "sept-25",
      "sept-22",
      "march",
    ]);
  });
});
