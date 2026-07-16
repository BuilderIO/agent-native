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

function mockExtensionModules(store: Record<string, unknown>) {
  vi.doMock("./store.js", () => ({
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
    ...store,
  }));
  vi.doMock("./local.js", () => ({
    getLocalExtension: vi.fn(async () => null),
    isLocalExtensionRow: (row: any) => !!row?.source,
    listLocalExtensions: vi.fn(async () => []),
  }));
  vi.doMock("../application-state/script-helpers.js", () => ({
    writeAppState: vi.fn(),
  }));
  vi.doMock("../sharing/access.js", () => ({
    resolveAccess: vi.fn(async () => ({
      role: "owner",
      resource: extensionRow,
    })),
  }));
}

describe("extensions/actions contentFromWorkspaceFile bridge parity", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("create-extension fails closed (no Resources fallback) when the bridge read throws", async () => {
    // A transient store error / invalid path from the bridge scope must NOT
    // silently fall through to a same-path Resources body - that could host a
    // different file than workspaceRead inspected. Fail closed instead.
    const createExtension = vi.fn();
    mockExtensionModules({ createExtension });
    vi.doMock("../workspace-files/store.js", () => ({
      readWorkspaceFile: vi.fn(async () => {
        throw new Error("transient store error");
      }),
    }));
    const readResource = vi.fn(async () => "<div>DIFFERENT body</div>");
    vi.doMock("../resources/script-helpers.js", () => ({ readResource }));

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();

    const result = (await runWithRequestContext(
      { userEmail: "thomas@example.com", run: {} },
      async () =>
        actions["create-extension"].run(
          { name: "Cloned", contentFromWorkspaceFile: "big-extension.html" },
          { caller: "tool" } as any,
        ),
    )) as any;

    expect(typeof result).toBe("string");
    expect(result).toContain("did not match any readable");
    expect(createExtension).not.toHaveBeenCalled();
    expect(readResource).not.toHaveBeenCalled();
  });

  it("create-extension hosts the bridge file when the bridge scope resolves it", async () => {
    const bigHtml = `<div>${"<p>row</p>".repeat(5000)}</div>`;
    const createExtension = vi.fn(async (data: any) => ({
      ...extensionRow,
      id: "ext-new",
      name: data.name,
      content: data.content,
    }));
    mockExtensionModules({ createExtension });
    const readResource = vi.fn(async () => "<div>SHOULD NOT be used</div>");
    vi.doMock("../resources/script-helpers.js", () => ({ readResource }));
    vi.doMock("../workspace-files/store.js", () => ({
      readWorkspaceFile: vi.fn(async () => ({
        path: "big-extension.html",
        content: bigHtml,
        contentType: "text/html",
        sizeBytes: bigHtml.length,
        updatedAt: "2026-05-06T00:00:00.000Z",
      })),
    }));

    const { createExtensionActionEntries } = await import("./actions.js");
    const actions = createExtensionActionEntries();

    const result = (await runWithRequestContext(
      { userEmail: "thomas@example.com", run: {} },
      async () =>
        actions["create-extension"].run(
          { name: "Cloned", contentFromWorkspaceFile: "big-extension.html" },
          { caller: "tool" } as any,
        ),
    )) as any;

    expect(result.ok).toBe(true);
    expect(createExtension).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Cloned", content: bigHtml }),
    );
    // Bridge scope resolved the file, so the Resources fallback is never hit.
    expect(readResource).not.toHaveBeenCalled();
  });
});
