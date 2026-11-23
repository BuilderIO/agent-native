import { describe, expect, it } from "vitest";

import { applyOptimisticRead } from "./optimistic-notifications";

const data = {
  unreadCount: 150,
  items: [
    { id: "a", title: "A", createdAtLabel: "now", read: false },
    { id: "b", title: "B", createdAtLabel: "now", read: false },
    { id: "c", title: "C", createdAtLabel: "now", read: true },
  ],
};

describe("applyOptimisticRead", () => {
  it("leaves the data alone when nothing is pending", () => {
    expect(applyOptimisticRead(data, [])).toBe(data);
  });
  it("marks one row read and lowers the server count by one", () => {
    const next = applyOptimisticRead(data, ["a"]);
    expect(next.items.map((i) => i.read)).toEqual([true, false, true]);
    expect(next.unreadCount).toBe(149);
  });
  it("marks everything read and clears the count, including rows beyond the list", () => {
    expect(applyOptimisticRead(data, "all").unreadCount).toBe(0);
  });
});
