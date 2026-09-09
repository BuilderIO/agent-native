import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: async () => settings.value,
  mutateUserSetting: async (
    _email: string,
    _key: string,
    update: (value: unknown) => unknown,
  ) => {
    settings.value = update(settings.value);
    return settings.value;
  },
}));
import { defaultContentSidebarSections } from "../shared/content-personal-navigation";
import getSidebar from "./get-content-sidebar-state";
import updateSidebar from "./update-content-sidebar-state";

beforeEach(() => {
  settings.value = null;
});

import {
  CONTENT_SIDEBAR_STATE_VERSION,
  normalizeContentSidebarState,
} from "./_content-sidebar-state";

describe("normalizeContentSidebarState", () => {
  it("keeps expansion preferences absent through a first section-only save and read", async () => {
    const sections = defaultContentSidebarSections();
    sections.recent.visible = false;
    const state = { version: 1 as const, sections };
    const ctx = { userEmail: "sidebar@example.test" };
    expect(await updateSidebar.run(state, ctx)).toEqual({ state });
    expect(await getSidebar.run({}, ctx)).toEqual({ state });
    expect(settings.value).not.toHaveProperty("expandedWorkspaceIds");
    expect(settings.value).not.toHaveProperty("expandedDocumentIds");
  });

  it("preserves explicit empty expansion preferences when sections change", async () => {
    const ctx = { userEmail: "sidebar@example.test" };
    await updateSidebar.run(
      { version: 1, expandedWorkspaceIds: [], expandedDocumentIds: [] },
      ctx,
    );
    const sections = defaultContentSidebarSections();
    await updateSidebar.run({ version: 1, sections }, ctx);
    expect(await getSidebar.run({}, ctx)).toEqual({
      state: {
        version: 1,
        expandedWorkspaceIds: [],
        expandedDocumentIds: [],
        sections,
      },
    });
  });
  it("deduplicates persisted expansion ids", () => {
    expect(
      normalizeContentSidebarState({
        version: CONTENT_SIDEBAR_STATE_VERSION,
        expandedWorkspaceIds: ["personal", "personal"],
        expandedDocumentIds: ["parent", "parent", "child"],
      }),
    ).toEqual({
      version: CONTENT_SIDEBAR_STATE_VERSION,
      expandedWorkspaceIds: ["personal"],
      expandedDocumentIds: ["parent", "child"],
    });
  });

  it("distinguishes absent state from unreadable saved state", () => {
    expect(normalizeContentSidebarState(null)).toBeNull();
    expect(() => normalizeContentSidebarState({ version: 0 })).toThrow();
  });
});
