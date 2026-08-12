import { describe, expect, it } from "vitest";

import {
  DESKTOP_DEFAULT_APPS,
  getDesktopVisibleApps,
  isDesktopAppVisible,
} from "./app-registry.js";

describe("desktop app visibility", () => {
  it("keeps Dispatch in the internal registry but out of visible app lists", () => {
    expect(DESKTOP_DEFAULT_APPS.some((app) => app.id === "dispatch")).toBe(
      true,
    );
    expect(isDesktopAppVisible({ id: "dispatch" })).toBe(false);
    expect(
      getDesktopVisibleApps(DESKTOP_DEFAULT_APPS).some(
        (app) => app.id === "dispatch",
      ),
    ).toBe(false);
  });

  it("keeps ordinary apps visible", () => {
    expect(isDesktopAppVisible({ id: "calendar" })).toBe(true);
    expect(
      getDesktopVisibleApps([{ id: "calendar" }, { id: "dispatch" }]).map(
        (app) => app.id,
      ),
    ).toEqual(["calendar"]);
  });
});
