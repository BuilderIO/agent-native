import { afterEach, describe, expect, it, vi } from "vitest";

import { runWithRequestContext } from "../server/request-context.js";

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

function baseStoreMock(overrides: Record<string, unknown> = {}) {
  return {
    createExtension: vi.fn(),
    deleteExtension: vi.fn(),
    findRecentDuplicateExtension: vi.fn(async () => null),
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
    updateExtensionContent: vi.fn(),
    ...overrides,
  };
}

function mockExtensionModules(
  opts: { store?: Record<string, unknown>; resolveAccessRole?: string } = {},
) {
  vi.doMock("./store.js", () => baseStoreMock(opts.store));
  vi.doMock("./local.js", () => ({
    getLocalExtension: vi.fn(async () => null),
    isLocalExtensionRow: (row: any) => !!row?.source,
    listLocalExtensions: vi.fn(async () => []),
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
      role: opts.resolveAccessRole ?? "owner",
      resource: extensionRow,
    })),
  }));
}

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

  it("declares serialization-safe result caps for extension source reads", async () => {
    mockExtensionModules();

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();
    const jsonSensitiveSource = '"\\\n'
      .repeat(Math.ceil(200_000 / 3))
      .slice(0, 200_000);
    const serializedSourceChars = JSON.stringify(jsonSensitiveSource).length;

    expect(actions["get-extension"].maxResultChars).toBe(500_000);
    expect(actions["get-extension"].maxResultChars).toBeGreaterThanOrEqual(
      serializedSourceChars + 50_000,
    );
    expect(actions["get-extension-history-version"].maxResultChars).toBe(
      2_000_000,
    );
    expect(
      actions["get-extension-history-version"].maxResultChars,
    ).toBeGreaterThanOrEqual(serializedSourceChars * 4 + 100_000);
  });

  it("omits repeated unchanged extension content within one agent run", async () => {
    const getExtension = vi.fn(async () => ({
      ...extensionRow,
      content: `<div>${"Zoom ".repeat(200)}</div>`,
    }));

    mockExtensionModules({
      store: {
        getExtension,
        getHiddenExtensionIdsForCurrentUser: vi.fn(
          async () => new Set<string>(),
        ),
      },
      resolveAccessRole: "editor",
    });

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();

    await runWithRequestContext(
      { userEmail: "thomas@example.com", run: {} },
      async () => {
        const first = (await actions["get-extension"].run({
          id: "ext-zoom",
        })) as any;
        const second = (await actions["get-extension"].run({
          id: "ext-zoom",
        })) as any;
        const forced = (await actions["get-extension"].run({
          id: "ext-zoom",
          forceContent: true,
        })) as any;

        expect(first.extension.content).toContain("Zoom");
        expect(first.extension.contentHash).toEqual(
          second.extension.contentHash,
        );
        expect(second.extension).not.toHaveProperty("content");
        expect(second.extension.contentOmitted.reason).toBe(
          "unchanged-content-already-returned-this-run",
        );
        expect(forced.extension.content).toContain("Zoom");
      },
    );
  });

  it("omits extension history version bodies by default", async () => {
    const getExtensionHistoryVersion = vi.fn(async () => ({
      entry: {
        id: "hist-2",
        extensionId: "ext-zoom",
        version: 2,
        operation: "content-update",
        summary: "Updated content",
        name: "Connect Zoom",
        description: "Broken Zoom connector",
        content: "<div>new</div>",
        icon: null,
        actorEmail: "thomas@example.com",
        ownerEmail: "thomas@example.com",
        orgId: "org-1",
        visibility: "org",
        createdAt: "2026-05-06T01:00:00.000Z",
        persisted: true,
        contentLength: 14,
      },
      previous: {
        id: "hist-1",
        extensionId: "ext-zoom",
        version: 1,
        operation: "baseline",
        summary: "Baseline",
        name: "Connect Zoom",
        description: "Broken Zoom connector",
        content: "<div>old</div>",
        icon: null,
        actorEmail: "thomas@example.com",
        ownerEmail: "thomas@example.com",
        orgId: "org-1",
        visibility: "org",
        createdAt: "2026-05-06T00:00:00.000Z",
        persisted: true,
        contentLength: 14,
      },
      diff: [
        { type: "delete", text: "<div>old</div>" },
        { type: "insert", text: "<div>new</div>" },
      ],
      stats: { addedLines: 1, deletedLines: 1, changed: true },
    }));

    mockExtensionModules({
      store: { getExtensionHistoryVersion },
    });

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();
    const compact = (await actions["get-extension-history-version"].run({
      id: "ext-zoom",
      version: 2,
    })) as any;
    const full = (await actions["get-extension-history-version"].run({
      id: "ext-zoom",
      version: 2,
      includeContent: true,
    })) as any;

    expect(compact.entry).not.toHaveProperty("content");
    expect(compact.previous).not.toHaveProperty("content");
    expect(compact.entry.contentHash).toBeTruthy();
    expect(full.entry.content).toBe("<div>new</div>");
    expect(full.previous.content).toBe("<div>old</div>");
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

  // ---------------------------------------------------------------------------
  // Hosting a pasted file by reference (contentFromAttachment).
  //
  // When the user pastes a large file, the composer sends it as a
  // `pasted-text-*.txt` attachment that the agent loop hands to the action via
  // `ctx.attachments`. The model passes `contentFromAttachment` (the name, or
  // "latest") instead of re-emitting the whole file as the `content` argument —
  // which frequently gets cut off mid-stream and triggers a continuation loop.
  // ---------------------------------------------------------------------------

  it("create-extension hosts a pasted attachment by reference (named match)", async () => {
    const bigHtml = `<div x-data="dashboard()">${"<p>row</p>".repeat(5000)}</div>`;
    const createExtension = vi.fn(async (data: any) => ({
      ...extensionRow,
      id: "ext-new",
      name: data.name,
      content: data.content,
    }));
    const findRecentDuplicateExtension = vi.fn(async () => null);
    mockExtensionModules({
      store: { createExtension, findRecentDuplicateExtension },
    });

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();
    const result = (await actions["create-extension"].run(
      { name: "Pasted Dashboard", contentFromAttachment: "pasted-text-9.txt" },
      {
        caller: "tool",
        attachments: [
          {
            type: "file",
            name: "pasted-text-9.txt",
            contentType: "text/plain",
            text: bigHtml,
          },
        ],
      } as any,
    )) as any;

    expect(result.ok).toBe(true);
    // Idempotency + create both run against the resolved content, never a
    // re-typed copy the model had to emit.
    expect(findRecentDuplicateExtension).toHaveBeenCalledWith({
      name: "Pasted Dashboard",
      content: bigHtml,
      description: "",
      icon: undefined,
    });
    expect(createExtension).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Pasted Dashboard", content: bigHtml }),
    );
  });

  it('create-extension resolves contentFromAttachment="latest" to the most recent pasted block', async () => {
    const createExtension = vi.fn(async (data: any) => ({
      ...extensionRow,
      id: "ext-new",
      content: data.content,
    }));
    mockExtensionModules({ store: { createExtension } });

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();
    await actions["create-extension"].run(
      { name: "Latest", contentFromAttachment: "latest" },
      {
        caller: "tool",
        attachments: [
          {
            type: "file",
            name: "pasted-text-1.txt",
            contentType: "text/plain",
            text: "<div>first</div>",
          },
          {
            type: "file",
            name: "pasted-text-2.txt",
            contentType: "text/plain",
            text: "<div>second</div>",
          },
        ],
      } as any,
    );

    expect(createExtension).toHaveBeenCalledWith(
      expect.objectContaining({ content: "<div>second</div>" }),
    );
  });

  it("create-extension errors (and creates nothing) when contentFromAttachment cannot be resolved", async () => {
    const createExtension = vi.fn();
    mockExtensionModules({ store: { createExtension } });

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();
    const result = (await actions["create-extension"].run(
      { name: "Broken", contentFromAttachment: "latest" },
      { caller: "tool", attachments: [] } as any,
    )) as any;

    expect(typeof result).toBe("string");
    expect(result).toContain("no readable text attachment");
    expect(createExtension).not.toHaveBeenCalled();
  });

  it("create-extension rejects a truncated pasted attachment instead of hosting corrupted content", async () => {
    const createExtension = vi.fn();
    mockExtensionModules({ store: { createExtension } });

    const truncated =
      "<div x-data>" +
      "x".repeat(500) +
      "\n\n[Attachment truncated after 200,000 characters; 50,000 characters omitted from the submitted attachment.]";

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();
    const result = (await actions["create-extension"].run(
      { name: "TooBig", contentFromAttachment: "latest" },
      {
        caller: "tool",
        attachments: [
          {
            type: "file",
            name: "pasted-text-big.txt",
            contentType: "text/plain",
            text: truncated,
          },
        ],
      } as any,
    )) as any;

    expect(typeof result).toBe("string");
    expect(result).toContain("too large to host verbatim");
    expect(createExtension).not.toHaveBeenCalled();
  });

  it("create-extension still accepts inline content", async () => {
    const createExtension = vi.fn(async (data: any) => ({
      ...extensionRow,
      id: "ext-new",
      content: data.content,
    }));
    mockExtensionModules({ store: { createExtension } });

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();
    const result = (await actions["create-extension"].run(
      { name: "Inline", content: "<div>inline</div>" },
      { caller: "tool" } as any,
    )) as any;

    expect(result.ok).toBe(true);
    expect(actions["create-extension"].chatUI?.renderer).toBe(
      "core.inline-extension",
    );
    expect(createExtension).toHaveBeenCalledWith(
      expect.objectContaining({ content: "<div>inline</div>" }),
    );
  });

  // ---------------------------------------------------------------------------
  // Hosting a workspace/shared resource file by reference
  // (contentFromWorkspaceFile). This is the path for cloning a large extension
  // body that already exists as a workspace resource — the model must NOT
  // re-read it into context, paste it inline (it gets cut off mid-stream), or
  // route it through run-code (mutating actions are blocked there).
  // ---------------------------------------------------------------------------

  it("create-extension hosts a workspace resource file by reference", async () => {
    const bigHtml = `<div x-data="dashboard()">${"<p>row</p>".repeat(6000)}</div>`;
    const createExtension = vi.fn(async (data: any) => ({
      ...extensionRow,
      id: "ext-new",
      name: data.name,
      content: data.content,
    }));
    const findRecentDuplicateExtension = vi.fn(async () => null);
    mockExtensionModules({
      store: { createExtension, findRecentDuplicateExtension },
    });
    const readResource = vi.fn(async () => bigHtml);
    vi.doMock("../resources/script-helpers.js", () => ({ readResource }));

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();
    const result = (await actions["create-extension"].run(
      {
        name: "Intuit Usage",
        contentFromWorkspaceFile: "intuit-analytics-extension.html",
      },
      { caller: "tool" } as any,
    )) as any;

    expect(result.ok).toBe(true);
    // Full file body is hosted verbatim — never a re-typed copy.
    expect(createExtension).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Intuit Usage", content: bigHtml }),
    );
    // The result must NOT echo the full body back — only a compact summary.
    expect(result.extension).not.toHaveProperty("content");
    expect(result.extension.contentLength).toBe(bigHtml.length);
    expect(result.extension.contentHash).toBeTruthy();
    // Resolved across scopes (personal precedence first).
    expect(readResource).toHaveBeenCalledWith(
      "intuit-analytics-extension.html",
      expect.objectContaining({ scope: "personal" }),
    );
  });

  it("create-extension errors (creates nothing) when contentFromWorkspaceFile is not found", async () => {
    const createExtension = vi.fn();
    mockExtensionModules({ store: { createExtension } });
    vi.doMock("../resources/script-helpers.js", () => ({
      readResource: vi.fn(async () => null),
    }));

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();
    const result = (await actions["create-extension"].run(
      { name: "Missing", contentFromWorkspaceFile: "does-not-exist.html" },
      { caller: "tool" } as any,
    )) as any;

    expect(typeof result).toBe("string");
    expect(result).toContain("did not match any readable");
    expect(createExtension).not.toHaveBeenCalled();
  });

  it("update-extension replaces full content from a workspace resource file", async () => {
    const updateExtensionContent = vi.fn(async () => ({
      ...extensionRow,
      content: "<div>from workspace</div>",
      updatedAt: "2026-05-06T03:00:00.000Z",
    }));
    mockExtensionModules({
      store: { updateExtensionContent },
      resolveAccessRole: "editor",
    });
    vi.doMock("../resources/script-helpers.js", () => ({
      readResource: vi.fn(async () => "<div>from workspace</div>"),
    }));

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();
    await actions["update-extension"].run(
      { id: "ext-zoom", contentFromWorkspaceFile: "roku-analytics.html" },
      { caller: "tool" } as any,
    );

    expect(updateExtensionContent).toHaveBeenCalledWith(
      "ext-zoom",
      expect.objectContaining({ content: "<div>from workspace</div>" }),
    );
  });

  it("render-inline-extension returns a transient chat-only extension", async () => {
    const createExtension = vi.fn();
    mockExtensionModules({ store: { createExtension } });

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();
    const result = (await actions["render-inline-extension"].run(
      {
        name: "Threshold tuner",
        description: "Adjust a score",
        content: "<div x-data></div>",
        context: '{"score":42}',
        initialHeight: 360,
      },
      { caller: "tool" } as any,
    )) as any;

    expect(actions["render-inline-extension"].readOnly).toBe(true);
    expect(actions["render-inline-extension"].chatUI?.renderer).toBe(
      "core.inline-extension",
    );
    expect(result).toMatchObject({
      ok: true,
      inlineExtension: {
        mode: "transient",
        name: "Threshold tuner",
        description: "Adjust a score",
        content: "<div x-data></div>",
        context: { score: 42 },
        initialHeight: 360,
      },
    });
    expect(result.inlineExtension.id).toMatch(/^inline-/);
    expect(createExtension).not.toHaveBeenCalled();
  });

  it("show-extension-inline returns saved extension metadata for inline chat rendering", async () => {
    const getExtension = vi.fn(async () => extensionRow);
    mockExtensionModules({ store: { getExtension } });

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();
    const result = (await actions["show-extension-inline"].run({
      id: "ext-zoom",
      context: '{"source":"chat"}',
    })) as any;

    expect(actions["show-extension-inline"].readOnly).toBe(true);
    expect(actions["show-extension-inline"].chatUI?.renderer).toBe(
      "core.inline-extension",
    );
    expect(getExtension).toHaveBeenCalledWith("ext-zoom");
    expect(result).toMatchObject({
      ok: true,
      inlineExtension: {
        mode: "persisted",
        id: "ext-zoom",
        name: "Connect Zoom",
        path: "/extensions/ext-zoom/connect-zoom",
        context: { source: "chat" },
      },
    });
  });

  it("update-extension replaces full content from an attachment by reference", async () => {
    const updateExtensionContent = vi.fn(async () => ({
      ...extensionRow,
      content: "<div>from paste</div>",
      updatedAt: "2026-05-06T03:00:00.000Z",
    }));
    mockExtensionModules({
      store: { updateExtensionContent },
      resolveAccessRole: "editor",
    });

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();
    await actions["update-extension"].run(
      { id: "ext-zoom", contentFromAttachment: "latest" },
      {
        caller: "tool",
        attachments: [
          {
            type: "file",
            name: "pasted-text-7.txt",
            contentType: "text/plain",
            text: "<div>from paste</div>",
          },
        ],
      } as any,
    );

    expect(updateExtensionContent).toHaveBeenCalledWith("ext-zoom", {
      content: "<div>from paste</div>",
      patches: undefined,
      edits: undefined,
      format: false,
    });
  });
});
