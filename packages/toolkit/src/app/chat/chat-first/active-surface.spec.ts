import { describe, expect, it } from "vitest";

import {
  chatFirstActiveSurface,
  chatFirstAppIconState,
  chatFirstNavTabActive,
} from "./active-surface.js";

describe("chatFirstActiveSurface", () => {
  it("keeps an unresolved surface distinct from an active nav surface", () => {
    expect(chatFirstActiveSurface({})).toBeUndefined();
    expect(chatFirstActiveSurface({ activeTab: "new-chat" })).toEqual({
      kind: "nav",
      tab: "new-chat",
    });
  });

  it("reports the selected app when no nav surface is named", () => {
    expect(chatFirstActiveSurface({ activeAppId: "mail" })).toEqual({
      kind: "app",
      appId: "mail",
    });
  });

  it("lets the named nav surface win over a stale app selection", () => {
    expect(
      chatFirstActiveSurface({ activeAppId: "dispatch", activeTab: "search" }),
    ).toEqual({ kind: "nav", tab: "search" });
  });
});

describe("chatFirstAppIconState", () => {
  it("marks nothing active or inactive before a surface resolves", () => {
    expect(chatFirstAppIconState(undefined, "mail")).toEqual({
      isActive: false,
      isInactive: false,
    });
  });

  it("activates only the selected app", () => {
    const surface = chatFirstActiveSurface({ activeAppId: "mail" });

    expect(chatFirstAppIconState(surface, "mail")).toEqual({
      isActive: true,
      isInactive: false,
    });
    expect(chatFirstAppIconState(surface, "calendar")).toEqual({
      isActive: false,
      isInactive: true,
    });
  });

  it("deactivates every app while a nav surface owns the rail", () => {
    for (const tab of [
      "new-chat",
      "integrations",
      "scheduled",
      "search",
    ] as const) {
      const surface = chatFirstActiveSurface({ activeTab: tab });
      for (const appId of ["mail", "calendar", "design", "clips"]) {
        expect(chatFirstAppIconState(surface, appId)).toEqual({
          isActive: false,
          isInactive: true,
        });
      }
    }
  });
});

describe("chatFirstNavTabActive", () => {
  it("activates only the named nav tab", () => {
    const surface = chatFirstActiveSurface({ activeTab: "search" });

    expect(chatFirstNavTabActive(surface, "search")).toBe(true);
    for (const tab of ["new-chat", "integrations", "scheduled"] as const) {
      expect(chatFirstNavTabActive(surface, tab)).toBe(false);
    }
  });

  it("activates no nav tab while an app owns the rail", () => {
    const surface = chatFirstActiveSurface({ activeAppId: "mail" });

    for (const tab of [
      "new-chat",
      "integrations",
      "scheduled",
      "search",
    ] as const) {
      expect(chatFirstNavTabActive(surface, tab)).toBe(false);
    }
  });
});
