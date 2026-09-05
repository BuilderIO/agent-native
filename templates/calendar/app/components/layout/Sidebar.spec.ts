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

  it("keeps Google calendars actionable without provenance badges", () => {
    const source = sidebarSource();

    expect(source).toContain("function GoogleCalendarsSections");
    expect(source).toContain('calendar.accessRole !== "owner"');
    expect(source).toContain("updateGoogleCalendarVisibility");
    expect(source).toContain('setAddCalendarDefaultTab("google")');
    expect(source).toContain('section === "owned" && calendar.primary');
    expect(source).toContain("? calendar.accountEmail");
    expect(source).not.toContain("showProvenance");
    expect(source).not.toContain("sourceAccounts.length > 1");
  });
});
