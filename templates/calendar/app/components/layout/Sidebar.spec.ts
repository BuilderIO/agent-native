import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function sidebarSource(): string {
  return readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
}

describe("Calendar mini-calendar navigation", () => {
  it("does not reset an explicitly navigated month", () => {
    const source = sidebarSource();

    expect(source).toContain("}, [selectedDate]);");
    expect(source).not.toContain("}, [selectedDate, viewMonth]);");
  });
});
