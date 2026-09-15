import { describe, expect, it } from "vitest";

import { getMeetingsSidebarHref } from "./sidebar-nav-hrefs";

describe("getMeetingsSidebarHref", () => {
  it("links straight to the meetings view once the lab is enabled", () => {
    expect(getMeetingsSidebarHref(true, "clips.meetings")).toBe("/meetings");
  });

  it("keeps the dotted lab key out of the URL path so the page stays refreshable", () => {
    const href = getMeetingsSidebarHref(false, "clips.meetings");
    const [pathname] = href.split("#");

    expect(pathname).toBe("/settings/labs");
    expect(href).toBe("/settings/labs#lab-clips.meetings");
  });
});
