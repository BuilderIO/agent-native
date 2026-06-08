import { afterEach, describe, expect, it, vi } from "vitest";

const extensionRow = {
  id: "ext-zoom",
  name: "Connect Zoom",
  description: "Broken Zoom connector",
  content: "<div>Zoom</div>",
  icon: null,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z",
  hiddenAt: null,
  hiddenBy: null,
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
      getExtensionHistoryVersion: vi.fn(),
      getHiddenExtensionIdsForCurrentUser,
      globalHideExtension: vi.fn(),
      globalUnhideExtension: vi.fn(),
      hideExtension: vi.fn(),
      listExtensionHistory: vi.fn(),
      listExtensions,
      restoreExtensionHistoryVersion: vi.fn(),
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
    expect(listExtensions).toHaveBeenCalledWith({
      includeHidden: false,
      includeGloballyHidden: false,
    });
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

  it("gets a known current extension by id with content", async () => {
    const getExtension = vi.fn(async () => extensionRow);
    const getHiddenExtensionIdsForCurrentUser = vi.fn(
      async () => new Set<string>(),
    );

    vi.doMock("./store.js", () => ({
      createExtension: vi.fn(),
      deleteExtension: vi.fn(),
      getExtension,
      getExtensionHistoryVersion: vi.fn(),
      getHiddenExtensionIdsForCurrentUser,
      globalHideExtension: vi.fn(),
      globalUnhideExtension: vi.fn(),
      hideExtension: vi.fn(),
      listExtensionHistory: vi.fn(),
      listExtensions: vi.fn(),
      restoreExtensionHistoryVersion: vi.fn(),
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
        role: "editor",
        resource: extensionRow,
      })),
    }));

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();
    const result = (await actions["get-extension"].run({
      id: "ext-zoom",
    })) as any;

    expect(actions["get-extension"].readOnly).toBe(true);
    expect(getExtension).toHaveBeenCalledWith("ext-zoom");
    expect(result).toMatchObject({
      ok: true,
      extension: {
        id: "ext-zoom",
        name: "Connect Zoom",
        content: "<div>Zoom</div>",
        role: "editor",
        canEdit: true,
      },
    });
  });

  it("lists extension history snapshots without content by default", async () => {
    const listExtensionHistory = vi.fn(async () => [
      {
        id: "hist-2",
        extensionId: "ext-zoom",
        version: 2,
        operation: "content-update",
        summary: "Updated content (+1 -0 lines)",
        name: "Connect Zoom",
        description: "Broken Zoom connector",
        icon: null,
        actorEmail: "thomas@example.com",
        ownerEmail: "thomas@example.com",
        orgId: "org-1",
        visibility: "org",
        createdAt: "2026-05-06T01:00:00.000Z",
        persisted: true,
        contentLength: 42,
      },
    ]);

    vi.doMock("./store.js", () => ({
      createExtension: vi.fn(),
      deleteExtension: vi.fn(),
      getExtension: vi.fn(),
      getExtensionHistoryVersion: vi.fn(),
      getHiddenExtensionIdsForCurrentUser: vi.fn(),
      globalHideExtension: vi.fn(),
      globalUnhideExtension: vi.fn(),
      hideExtension: vi.fn(),
      listExtensionHistory,
      listExtensions: vi.fn(),
      restoreExtensionHistoryVersion: vi.fn(),
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
    const result = (await actions["list-extension-history"].run({
      id: "ext-zoom",
    })) as any;

    expect(actions["list-extension-history"].readOnly).toBe(true);
    expect(listExtensionHistory).toHaveBeenCalledWith("ext-zoom", {
      limit: undefined,
      includeContent: false,
    });
    expect(result).toMatchObject({
      ok: true,
      count: 1,
      history: [{ version: 2, summary: "Updated content (+1 -0 lines)" }],
    });
    expect(result.history[0]).not.toHaveProperty("content");
  });

  it("restores an extension from a history version", async () => {
    const restoreExtensionHistoryVersion = vi.fn(async () => ({
      ...extensionRow,
      updatedAt: "2026-05-06T02:00:00.000Z",
    }));

    vi.doMock("./store.js", () => ({
      createExtension: vi.fn(),
      deleteExtension: vi.fn(),
      getExtension: vi.fn(),
      getExtensionHistoryVersion: vi.fn(),
      getHiddenExtensionIdsForCurrentUser: vi.fn(async () => new Set<string>()),
      globalHideExtension: vi.fn(),
      globalUnhideExtension: vi.fn(),
      hideExtension: vi.fn(),
      listExtensionHistory: vi.fn(),
      listExtensions: vi.fn(),
      restoreExtensionHistoryVersion,
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
        role: "editor",
        resource: extensionRow,
      })),
    }));

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();
    const result = (await actions["restore-extension-history-version"].run({
      id: "ext-zoom",
      version: 1,
    })) as any;

    expect(restoreExtensionHistoryVersion).toHaveBeenCalledWith("ext-zoom", 1);
    expect(result).toMatchObject({
      ok: true,
      restoredVersion: 1,
      extension: { id: "ext-zoom", canEdit: true },
    });
  });

  it("hides a shared extension from the current user's view", async () => {
    const hideExtension = vi.fn(async () => true);

    vi.doMock("./store.js", () => ({
      createExtension: vi.fn(),
      deleteExtension: vi.fn(),
      getExtension: vi.fn(async () => extensionRow),
      getExtensionHistoryVersion: vi.fn(),
      getHiddenExtensionIdsForCurrentUser: vi.fn(),
      globalHideExtension: vi.fn(),
      globalUnhideExtension: vi.fn(),
      hideExtension,
      listExtensionHistory: vi.fn(),
      listExtensions: vi.fn(),
      restoreExtensionHistoryVersion: vi.fn(),
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
      getExtensionHistoryVersion: vi.fn(),
      getHiddenExtensionIdsForCurrentUser: vi.fn(async () => new Set<string>()),
      globalHideExtension: vi.fn(),
      globalUnhideExtension: vi.fn(),
      hideExtension: vi.fn(),
      listExtensionHistory: vi.fn(),
      listExtensions: vi.fn(),
      restoreExtensionHistoryVersion: vi.fn(),
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
      edits: undefined,
      format: false,
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

  it("passes granular extension edits and formatting through to the store", async () => {
    const updateExtensionContent = vi.fn(async () => ({
      ...extensionRow,
      updatedAt: "2026-05-06T01:00:00.000Z",
    }));

    vi.doMock("./store.js", () => ({
      createExtension: vi.fn(),
      deleteExtension: vi.fn(),
      getExtension: vi.fn(),
      getExtensionHistoryVersion: vi.fn(),
      getHiddenExtensionIdsForCurrentUser: vi.fn(async () => new Set<string>()),
      globalHideExtension: vi.fn(),
      globalUnhideExtension: vi.fn(),
      hideExtension: vi.fn(),
      listExtensionHistory: vi.fn(),
      listExtensions: vi.fn(),
      restoreExtensionHistoryVersion: vi.fn(),
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
    const edits = [
      {
        op: "replace-section",
        section: "metrics",
        content: "<div>New metrics</div>",
      },
    ];
    await actions["update-extension"].run({
      id: "ext-zoom",
      edits: JSON.stringify(edits),
      format: true,
    });

    expect(updateExtensionContent).toHaveBeenCalledWith("ext-zoom", {
      content: undefined,
      patches: undefined,
      edits,
      format: true,
    });
  });

  it("points the agent to hide-extension when permanent delete is forbidden", async () => {
    vi.doMock("./store.js", () => ({
      createExtension: vi.fn(),
      deleteExtension: vi.fn(async () => {
        throw new Error("Requires admin role");
      }),
      getExtension: vi.fn(async () => extensionRow),
      getExtensionHistoryVersion: vi.fn(),
      getHiddenExtensionIdsForCurrentUser: vi.fn(),
      globalHideExtension: vi.fn(),
      globalUnhideExtension: vi.fn(),
      hideExtension: vi.fn(),
      listExtensionHistory: vi.fn(),
      listExtensions: vi.fn(),
      restoreExtensionHistoryVersion: vi.fn(),
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

  it("globally hides an extension from everyone through the store", async () => {
    const globalHideExtension = vi.fn(async () => true);

    vi.doMock("./store.js", () => ({
      createExtension: vi.fn(),
      deleteExtension: vi.fn(),
      getExtension: vi.fn(async () => extensionRow),
      getExtensionHistoryVersion: vi.fn(),
      getHiddenExtensionIdsForCurrentUser: vi.fn(),
      globalHideExtension,
      globalUnhideExtension: vi.fn(),
      hideExtension: vi.fn(),
      listExtensionHistory: vi.fn(),
      listExtensions: vi.fn(),
      restoreExtensionHistoryVersion: vi.fn(),
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
    const result = (await actions["global-hide-extension"].run({
      id: "ext-zoom",
    })) as any;

    expect(globalHideExtension).toHaveBeenCalledWith("ext-zoom");
    expect(result).toEqual({
      ok: true,
      globallyHidden: {
        id: "ext-zoom",
        name: "Connect Zoom",
        ownerEmail: "thomas@example.com",
        visibility: "org",
      },
    });
  });

  it("globally unhides an extension for everyone through the store", async () => {
    const globalUnhideExtension = vi.fn(async () => true);

    vi.doMock("./store.js", () => ({
      createExtension: vi.fn(),
      deleteExtension: vi.fn(),
      getExtension: vi.fn(),
      getExtensionHistoryVersion: vi.fn(),
      getHiddenExtensionIdsForCurrentUser: vi.fn(),
      globalHideExtension: vi.fn(),
      globalUnhideExtension,
      hideExtension: vi.fn(),
      listExtensionHistory: vi.fn(),
      listExtensions: vi.fn(),
      restoreExtensionHistoryVersion: vi.fn(),
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
    const result = await actions["global-unhide-extension"].run({
      id: "ext-zoom",
    });

    expect(globalUnhideExtension).toHaveBeenCalledWith("ext-zoom");
    expect(result).toEqual({ ok: true, id: "ext-zoom" });
  });
});
