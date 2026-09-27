import { describe, expect, it } from "vitest";

import {
  getEffectiveSlidesSidebarCollapsed,
  isSlidesEditorRoute,
  isSlidesFullWidthSettingsRoute,
  shouldShowSlidesAppSidebar,
} from "./layout-route-policy";

describe("Slides settings route policy", () => {
  it("gives Settings the full width only with the redesign on or loading", () => {
    expect(
      isSlidesFullWidthSettingsRoute("/settings", {
        status: "ready",
        enabled: true,
      }),
    ).toBe(true);
    expect(
      isSlidesFullWidthSettingsRoute("/settings/app/general", {
        status: "loading",
        enabled: false,
      }),
    ).toBe(true);
    expect(
      isSlidesFullWidthSettingsRoute("/settings", {
        status: "ready",
        enabled: false,
      }),
    ).toBe(false);
    expect(
      isSlidesFullWidthSettingsRoute("/settings", {
        status: "unavailable",
        enabled: false,
      }),
    ).toBe(false);
    expect(
      isSlidesFullWidthSettingsRoute("/settingsx", {
        status: "ready",
        enabled: true,
      }),
    ).toBe(false);
    expect(
      isSlidesFullWidthSettingsRoute("/home", {
        status: "ready",
        enabled: true,
      }),
    ).toBe(false);
  });
});

describe("Slides layout sidebar route policy", () => {
  it("recognizes only deck editor routes", () => {
    expect(isSlidesEditorRoute("/deck/deck-1")).toBe(true);
    expect(isSlidesEditorRoute("/deck/deck-1/")).toBe(true);
    expect(isSlidesEditorRoute("/")).toBe(false);
    expect(isSlidesEditorRoute("/deck/deck-1/present")).toBe(false);
  });

  it("hides the app sidebar on deck editor routes", () => {
    expect(shouldShowSlidesAppSidebar("/deck/deck-1")).toBe(false);
    expect(shouldShowSlidesAppSidebar("/")).toBe(true);
  });

  it("collapses app navigation by default in the deck editor", () => {
    expect(
      getEffectiveSlidesSidebarCollapsed({
        pathname: "/deck/deck-1",
        persistedCollapsed: false,
      }),
    ).toBe(true);
  });

  it("respects a user override while editing", () => {
    expect(
      getEffectiveSlidesSidebarCollapsed({
        pathname: "/deck/deck-1",
        persistedCollapsed: false,
        editorOverride: false,
      }),
    ).toBe(false);
  });

  it("uses the persisted preference outside the editor", () => {
    expect(
      getEffectiveSlidesSidebarCollapsed({
        pathname: "/design-systems",
        persistedCollapsed: false,
      }),
    ).toBe(false);
    expect(
      getEffectiveSlidesSidebarCollapsed({
        pathname: "/design-systems",
        persistedCollapsed: true,
      }),
    ).toBe(true);
  });
});
