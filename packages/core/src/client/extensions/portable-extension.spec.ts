// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildAgentNativeExtensionHtml,
  createHttpAgentNativeExtensionStorage,
  createLocalStorageAgentNativeExtensionStorage,
  getAgentNativeExtensionManifest,
  isAgentNativeExtensionAllowedInSlot,
  normalizeAgentNativeExtensionSandbox,
} from "./portable-extension.js";

describe("portable extension runtime", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("builds sandbox iframe HTML with host bridge helpers", () => {
    const html = buildAgentNativeExtensionHtml({
      extensionId: "ext-1",
      slotId: "crm.sidebar",
      title: "Customer notes",
      content: '<div x-data="{ ready: true }">Hello</div>',
      slotContext: { customerId: "cus_123" },
    });

    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("@tailwindcss/browser@4.2.4");
    expect(html).toContain("alpinejs@3.15.11");
    expect(html).toContain("agentNative.host.ready");
    expect(html).toContain("window.appAction = hostAction");
    expect(html).toContain("window.extensionData = extensionData");
    expect(html).toContain('<div x-data="{ ready: true }">Hello</div>');
    expect(html).toContain("cus_123");
  });

  it("escapes JSON values embedded in runtime scripts", () => {
    const html = buildAgentNativeExtensionHtml({
      extensionId: "ext-1",
      content: "<div></div>",
      slotContext: { label: "</script><script>alert(1)</script>" },
    });

    expect(html).toContain("\\u003c/script>");
    expect(html).not.toContain("</script><script>alert");
  });

  it("removes allow-same-origin from extension sandbox values", () => {
    expect(
      normalizeAgentNativeExtensionSandbox(
        "allow-scripts allow-same-origin allow-popups",
      ),
    ).toBe("allow-scripts allow-popups allow-downloads");
    expect(normalizeAgentNativeExtensionSandbox(undefined)).toContain(
      "allow-scripts",
    );
    expect(normalizeAgentNativeExtensionSandbox("allow-forms")).toContain(
      "allow-downloads",
    );
  });

  it("normalizes manifest aliases and slot allowlists", () => {
    const extension = {
      id: "ext-1",
      name: "Customer panel",
      content: "<div></div>",
      slots: ["crm.customer.sidebar"],
      requestedActions: ["list-customers"],
      manifest: {
        requestedCommands: ["refreshData"],
        storageScopes: ["user"],
      },
    };

    expect(getAgentNativeExtensionManifest(extension)).toMatchObject({
      slots: ["crm.customer.sidebar"],
      requestedActions: ["list-customers"],
      requestedCommands: ["refreshData"],
      storageScopes: ["user"],
    });
    expect(
      isAgentNativeExtensionAllowedInSlot(extension, "crm.customer.sidebar"),
    ).toBe(true);
    expect(
      isAgentNativeExtensionAllowedInSlot(extension, "crm.account.sidebar"),
    ).toBe(false);
  });

  it("persists extension data in localStorage by extension and scope", async () => {
    const storage = createLocalStorageAgentNativeExtensionStorage("spec");
    const context = { extensionId: "ext-1" };

    const saved = await storage.set(
      "notes",
      "note-1",
      { text: "Call soon" },
      { scope: "user" },
      context,
    );

    expect(saved).toMatchObject({
      id: "note-1",
      extensionId: "ext-1",
      collection: "notes",
      data: { text: "Call soon" },
      scope: "user",
    });
    await storage.set(
      "notes",
      "note-2",
      { text: "Org note" },
      { scope: "org" },
      context,
    );

    expect(
      await storage.get("notes", "note-1", { scope: "user" }, context),
    ).toMatchObject({ id: "note-1" });
    expect(await storage.list("notes", { scope: "all" }, context)).toHaveLength(
      2,
    );
    expect(
      await storage.list("notes", { scope: "user" }, { extensionId: "ext-2" }),
    ).toHaveLength(0);

    expect(
      await storage.remove("notes", "note-1", { scope: "user" }, context),
    ).toEqual({ removed: true });
    expect(
      await storage.get("notes", "note-1", { scope: "user" }, context),
    ).toBeNull();
  });

  it("rejects writes to the read-only all scope", async () => {
    const storage = createLocalStorageAgentNativeExtensionStorage("spec");
    expect(() =>
      storage.set(
        "notes",
        "note-1",
        {},
        { scope: "all" },
        { extensionId: "ext-1" },
      ),
    ).toThrow(/scope "all"/);
  });

  it("sends production storage operations to an HTTP adapter", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      Response.json({
        result: [
          {
            id: "note-1",
            extensionId: "ext-1",
            collection: "notes",
            data: { text: "Saved" },
            scope: "org",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    const storage = createHttpAgentNativeExtensionStorage({
      endpoint: "/api/extensions/storage",
      fetch: fetchMock as unknown as typeof fetch,
      headers: () => ({ Authorization: "Bearer token" }),
    });

    await expect(
      storage.list(
        "notes",
        { scope: "org" },
        { extensionId: "ext-1", slotId: "crm.sidebar", userId: "user-1" },
      ),
    ).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/extensions/storage",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: expect.stringContaining('"operation":"list"'),
      }),
    );
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Headers).get("Authorization")).toBe(
      "Bearer token",
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      operation: "list",
      extensionId: "ext-1",
      slotId: "crm.sidebar",
      collection: "notes",
      options: { scope: "org" },
      context: {
        extensionId: "ext-1",
        slotId: "crm.sidebar",
        userId: "user-1",
      },
    });
  });
});
