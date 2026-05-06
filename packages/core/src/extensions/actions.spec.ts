import { afterEach, describe, expect, it, vi } from "vitest";

const extensionRow = {
  id: "ext-zoom",
  name: "Connect Zoom",
  description: "Broken Zoom connector",
  content: "<div>Zoom</div>",
  icon: null,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z",
  ownerEmail: "thomas@example.com",
  orgId: "org-1",
  visibility: "org" as const,
};

describe("extensions/actions", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("lists visible extensions through the extension store instead of raw SQL", async () => {
    const listExtensions = vi.fn(async () => [extensionRow]);
    const getHiddenExtensionIdsForCurrentUser = vi.fn(
      async () => new Set<string>(),
    );

    vi.doMock("./store.js", () => ({
      createExtension: vi.fn(),
      deleteExtension: vi.fn(),
      getExtension: vi.fn(),
      getHiddenExtensionIdsForCurrentUser,
      hideExtension: vi.fn(),
      listExtensions,
      unhideExtension: vi.fn(),
      updateExtension: vi.fn(),
      updateExtensionContent: vi.fn(),
    }));
    vi.doMock("./slots/store.js", () => ({
      addExtensionSlotTarget: vi.fn(),
      installExtensionSlot: vi.fn(),
      uninstallExtensionSlot: vi.fn(),
      listExtensionsForSlot: vi.fn(),
      listSlotsForExtension: vi.fn(),
    }));
    vi.doMock("../application-state/script-helpers.js", () => ({
      writeAppState: vi.fn(),
    }));
    vi.doMock("../sharing/access.js", () => ({
      resolveAccess: vi.fn(async () => ({
        role: "viewer",
        resource: extensionRow,
      })),
    }));

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();
    const result = (await actions["list-extensions"].run({
      search: "zoom",
    })) as any;

    expect(actions["list-extensions"].readOnly).toBe(true);
    expect(listExtensions).toHaveBeenCalledWith({ includeHidden: false });
    expect(result).toMatchObject({
      ok: true,
      count: 1,
      extensions: [
        {
          id: "ext-zoom",
          name: "Connect Zoom",
          ownerEmail: "thomas@example.com",
          role: "viewer",
          canDelete: false,
          hidden: false,
        },
      ],
    });
    expect(result.extensions[0]).not.toHaveProperty("content");
  });

  it("hides a shared extension from the current user's view", async () => {
    const hideExtension = vi.fn(async () => true);

    vi.doMock("./store.js", () => ({
      createExtension: vi.fn(),
      deleteExtension: vi.fn(),
      getExtension: vi.fn(async () => extensionRow),
      getHiddenExtensionIdsForCurrentUser: vi.fn(),
      hideExtension,
      listExtensions: vi.fn(),
      unhideExtension: vi.fn(),
      updateExtension: vi.fn(),
      updateExtensionContent: vi.fn(),
    }));
    vi.doMock("./slots/store.js", () => ({
      addExtensionSlotTarget: vi.fn(),
      installExtensionSlot: vi.fn(),
      uninstallExtensionSlot: vi.fn(),
      listExtensionsForSlot: vi.fn(),
      listSlotsForExtension: vi.fn(),
    }));
    vi.doMock("../application-state/script-helpers.js", () => ({
      writeAppState: vi.fn(),
    }));
    vi.doMock("../sharing/access.js", () => ({
      resolveAccess: vi.fn(),
    }));

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();
    const result = await actions["hide-extension"].run({ id: "ext-zoom" });

    expect(hideExtension).toHaveBeenCalledWith("ext-zoom");
    expect(result).toEqual({
      ok: true,
      hidden: {
        id: "ext-zoom",
        name: "Connect Zoom",
        ownerEmail: "thomas@example.com",
        visibility: "org",
      },
    });
  });

  it("returns a compact summary after updating extension content", async () => {
    const updateExtensionContent = vi.fn(async () => ({
      ...extensionRow,
      content: "<div>Lots of HTML</div>",
      updatedAt: "2026-05-06T01:00:00.000Z",
    }));

    vi.doMock("./store.js", () => ({
      createExtension: vi.fn(),
      deleteExtension: vi.fn(),
      getExtension: vi.fn(),
      getHiddenExtensionIdsForCurrentUser: vi.fn(async () => new Set<string>()),
      hideExtension: vi.fn(),
      listExtensions: vi.fn(),
      unhideExtension: vi.fn(),
      updateExtension: vi.fn(),
      updateExtensionContent,
    }));
    vi.doMock("./slots/store.js", () => ({
      addExtensionSlotTarget: vi.fn(),
      installExtensionSlot: vi.fn(),
      uninstallExtensionSlot: vi.fn(),
      listExtensionsForSlot: vi.fn(),
      listSlotsForExtension: vi.fn(),
    }));
    vi.doMock("../application-state/script-helpers.js", () => ({
      writeAppState: vi.fn(),
    }));
    vi.doMock("../sharing/access.js", () => ({
      resolveAccess: vi.fn(async () => ({
        role: "editor",
        resource: extensionRow,
      })),
    }));

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();
    const result = (await actions["update-extension"].run({
      id: "ext-zoom",
      content: "<div>Lots of HTML</div>",
    })) as any;

    expect(updateExtensionContent).toHaveBeenCalledWith("ext-zoom", {
      content: "<div>Lots of HTML</div>",
      patches: undefined,
    });
    expect(result).toMatchObject({
      ok: true,
      extension: {
        id: "ext-zoom",
        name: "Connect Zoom",
        role: "editor",
        canEdit: true,
      },
    });
    expect(result.extension).not.toHaveProperty("content");
  });

  it("points the agent to hide-extension when permanent delete is forbidden", async () => {
    vi.doMock("./store.js", () => ({
      createExtension: vi.fn(),
      deleteExtension: vi.fn(async () => {
        throw new Error("Requires admin role");
      }),
      getExtension: vi.fn(async () => extensionRow),
      getHiddenExtensionIdsForCurrentUser: vi.fn(),
      hideExtension: vi.fn(),
      listExtensions: vi.fn(),
      unhideExtension: vi.fn(),
      updateExtension: vi.fn(),
      updateExtensionContent: vi.fn(),
    }));
    vi.doMock("./slots/store.js", () => ({
      addExtensionSlotTarget: vi.fn(),
      installExtensionSlot: vi.fn(),
      uninstallExtensionSlot: vi.fn(),
      listExtensionsForSlot: vi.fn(),
      listSlotsForExtension: vi.fn(),
    }));
    vi.doMock("../application-state/script-helpers.js", () => ({
      writeAppState: vi.fn(),
    }));
    vi.doMock("../sharing/access.js", () => ({
      resolveAccess: vi.fn(),
    }));

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();
    const result = (await actions["delete-extension"].run({
      id: "ext-zoom",
    })) as any;

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Requires admin role");
    expect(result.next).toContain("hide-extension");
  });
});
