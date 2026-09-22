import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ values: new Map<string, unknown>() }));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: async (_email: string, key: string) =>
    settings.values.get(key) ?? null,
  mutateUserSetting: async (
    _email: string,
    key: string,
    update: (value: unknown) => unknown,
  ) => {
    const value = update(settings.values.get(key) ?? null);
    settings.values.set(key, value);
    return value;
  },
}));
import { defaultContentSidebarSections } from "../shared/content-personal-navigation";
import getSidebar from "./get-content-sidebar-state";
import updateSidebar from "./update-content-sidebar-state";

beforeEach(() => {
  settings.values.clear();
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
    const saved = settings.values.get("content-sidebar-state");
    expect(saved).not.toHaveProperty("expandedWorkspaceIds");
    expect(saved).not.toHaveProperty("expandedDocumentIds");
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
    settings.values.set("content-sidebar-state", {
      version: 1,
      expandedWorkspaceIds: ["space-a"],
      sections: {
        order: ["pinned", "recent", "workspaces"],
        pinned: { visible: true, expanded: true, limit: 25 },
        recent: { visible: true, expanded: true, limit: 15 },
      },
    });
    await updateSidebar.run(
      {
        version: 2,
        spaceId: "space-b",
        expandedDocumentIds: ["child"],
      },
      { userEmail: "sidebar@example.test" },
    );
    const saved = settings.values.get("content-sidebar-state:space-b");
    expect(saved).toMatchObject({
      version: 2,
      expandedWorkspaceIds: ["space-a"],
      expandedDocumentIds: ["child"],
      sections: { files: { visible: true, expanded: false } },
    });
    expect(saved).not.toHaveProperty("spaceId");
    expect(saved).toMatchObject({ sections: { pinned: { visible: true } } });
  });

  it("keeps section preferences isolated between Content spaces", async () => {
    const ctx = { userEmail: "sidebar@example.test" };
    const first = defaultContentSidebarSections();
    first.pinned.visible = false;
    const second = defaultContentSidebarSections();
    second.recent.visible = false;

    await updateSidebar.run(
      { version: 2, spaceId: "space-a", sections: first },
      ctx,
    );
    await updateSidebar.run(
      { version: 2, spaceId: "space-b", sections: second },
      ctx,
    );

    expect(await getSidebar.run({ spaceId: "space-a" }, ctx)).toEqual({
      state: { version: 2, sections: first },
    });
    expect(await getSidebar.run({ spaceId: "space-b" }, ctx)).toEqual({
      state: { version: 2, sections: second },
    });
  });

  it("merges an automatic section patch into the latest workspace state", async () => {
    const ctx = { userEmail: "sidebar@example.test" };
    const sections = defaultContentSidebarSections();
    sections.order = ["recent", "files", "pinned"];
    sections.pinned.visible = false;
    await updateSidebar.run({ version: 2, spaceId: "space-a", sections }, ctx);

    await updateSidebar.run(
      {
        version: 2,
        spaceId: "space-a",
        sectionsPatch: { pinned: { visible: true, expanded: true } },
      },
      ctx,
    );

    expect(await getSidebar.run({ spaceId: "space-a" }, ctx)).toEqual({
      state: {
        version: 2,
        sections: {
          ...sections,
          pinned: { visible: true, expanded: true },
        },
      },
    });
  });
});
