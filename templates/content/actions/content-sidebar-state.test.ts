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
    const state = { version: 2 as const, sections };
    const ctx = { userEmail: "sidebar@example.test" };
    expect(await updateSidebar.run(state, ctx)).toEqual({ state });
    expect(await getSidebar.run({}, ctx)).toEqual({ state });
    expect(settings.value).not.toHaveProperty("expandedWorkspaceIds");
    expect(settings.value).not.toHaveProperty("expandedDocumentIds");
  });

  it("preserves explicit empty expansion preferences when sections change", async () => {
    const ctx = { userEmail: "sidebar@example.test" };
    await updateSidebar.run(
      { version: 2, expandedWorkspaceIds: [], expandedDocumentIds: [] },
      ctx,
    );
    const sections = defaultContentSidebarSections();
    await updateSidebar.run({ version: 2, sections }, ctx);
    expect(await getSidebar.run({}, ctx)).toEqual({
      state: {
        version: 2,
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

  it("migrates workspaces to recoverable Files and discards saved limits", () => {
    expect(
      normalizeContentSidebarState(
        {
          version: 1,
          expandedWorkspaceIds: [],
          sections: {
            order: ["recent", "workspaces", "pinned"],
            pinned: { visible: false, expanded: false, limit: 45 },
            recent: { visible: true, expanded: false, limit: 30 },
          },
        },
        "other-space",
      ),
    ).toEqual({
      version: 2,
      expandedWorkspaceIds: [],
      sections: {
        order: ["recent", "files", "pinned"],
        pinned: { visible: false, expanded: false },
        recent: { visible: true, expanded: false },
        files: { visible: true, expanded: false },
      },
    });
  });

  it("inherits Files expansion from the selected v1 workspace", () => {
    const legacy = {
      version: 1,
      expandedWorkspaceIds: ["space-a"],
      sections: {
        order: ["pinned", "recent", "workspaces"],
        pinned: { visible: true, expanded: true, limit: 5 },
        recent: { visible: true, expanded: true, limit: 5 },
      },
    };
    expect(
      normalizeContentSidebarState(legacy, "space-a")?.sections?.files,
    ).toEqual({ visible: true, expanded: true });
    expect(
      normalizeContentSidebarState(legacy, "space-b")?.sections?.files,
    ).toEqual({ visible: true, expanded: false });
  });

  it("uses the selected space when the first v2 partial write migrates v1", async () => {
    settings.value = {
      version: 1,
      expandedWorkspaceIds: ["space-a"],
      sections: {
        order: ["pinned", "recent", "workspaces"],
        pinned: { visible: true, expanded: true, limit: 25 },
        recent: { visible: true, expanded: true, limit: 15 },
      },
    };
    await updateSidebar.run(
      {
        version: 2,
        spaceId: "space-b",
        expandedDocumentIds: ["child"],
      },
      { userEmail: "sidebar@example.test" },
    );
    expect(settings.value).toMatchObject({
      version: 2,
      expandedWorkspaceIds: ["space-a"],
      expandedDocumentIds: ["child"],
      sections: { files: { visible: true, expanded: false } },
    });
    expect(settings.value).not.toHaveProperty("spaceId");
    expect(settings.value.sections.pinned).not.toHaveProperty("limit");
  });
});
