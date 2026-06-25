import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteOrHideExtension,
  hideExtensionForCurrentUser,
} from "./delete-extension.js";

function jsonResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("extension delete helper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("permanently deletes extensions when allowed", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetch);

    await expect(
      deleteOrHideExtension({ id: "ext-1", canDelete: true }),
    ).resolves.toEqual({ mode: "deleted" });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/_agent-native/extensions/ext-1", {
      method: "DELETE",
    });
  });

  it("hides immediately when access metadata says delete is unavailable", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetch);

    await expect(
      deleteOrHideExtension({ id: "ext-2", canDelete: false }),
    ).resolves.toEqual({ mode: "hidden" });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/_agent-native/extensions/ext-2/hide", {
      method: "POST",
    });
  });

  it("falls back to hiding when permanent delete is forbidden", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(403, { error: "Requires admin" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetch);

    await expect(deleteOrHideExtension({ id: "ext-3" })).resolves.toEqual({
      mode: "hidden",
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/_agent-native/extensions/ext-3",
      { method: "DELETE" },
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/_agent-native/extensions/ext-3/hide",
      { method: "POST" },
    );
  });

  it("surfaces hide failures", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(403, { error: "No access to extension ext-4" }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(hideExtensionForCurrentUser("ext-4")).rejects.toThrow(
      "No access to extension ext-4",
    );
  });
});
