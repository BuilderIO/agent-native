/**
 * DesignExtensionsPanel bug-hunt regression tests.
 *
 * Bug: `installExtension`'s `finally` block cleared `installingId` (which
 * re-enables the Install button and re-shows the extension in "Available")
 * immediately after the install POST resolved, without waiting for the
 * `invalidateQueries` calls that refresh the "installed"/"available" slot
 * lists to actually settle. That left a window where a fast double-click (or
 * any click during that gap) fired a second install POST for the same
 * extension before the UI caught up — a duplicate-install race. The fix
 * extracts the network + invalidation sequence into `installExtensionRequest`
 * and awaits both `invalidateQueries` calls before resolving, so callers
 * can't regain control (and re-enable the button) until the lists are
 * provably current.
 *
 * This file also locks in the postMessage origin/source hygiene requirement
 * called out for this panel: DesignExtensionsPanel.tsx must not add a raw
 * `window.addEventListener("message", ...)` listener of its own. All
 * cross-iframe messaging here goes through the shared `EmbeddedApp` (asset
 * picker) and `EmbeddedExtension` (installed extensions) components, which
 * already validate both `event.origin` and `event.source` against the
 * specific iframe — see packages/core/src/embedding/react.tsx (line ~110,
 * ~240) and packages/core/src/client/extensions/EmbeddedExtension.tsx (line
 * ~255), matching the `isMessageFromOwnPreviewIframe` pattern used elsewhere
 * in this app (e.g. edit-panel/component-section.tsx).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { installExtensionRequest } from "./DesignExtensionsPanel";

describe("installExtensionRequest — duplicate-install race", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = originalFetch;
  });

  it("does not resolve until both slot queries finish refetching", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    // invalidateQueries is called once per queryKey (two calls total), each
    // returning its own pending promise — collect every resolver so the test
    // can release all of them together instead of only the last one.
    const pendingResolvers: Array<() => void> = [];
    const invalidateQueries = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          pendingResolvers.push(resolve);
        }),
    );
    const resolveInvalidate = () => {
      pendingResolvers.forEach((resolve) => resolve());
    };

    let requestSettled = false;
    const requestPromise = installExtensionRequest(
      "design.editor.inspector",
      "ext_1",
      { invalidateQueries },
    ).then(() => {
      requestSettled = true;
    });

    // Flush the microtasks tied to the fetch/json resolution, but leave the
    // invalidateQueries promise pending.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["design-editor-extension-slot"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["design-editor-extension-slot-available"],
    });
    // Regression guard: before the fix, the function resolved here — before
    // the lists had refetched — which is exactly the race that let a second
    // install fire while the just-installed extension still showed as
    // "Available".
    expect(requestSettled).toBe(false);

    resolveInvalidate();
    await requestPromise;

    expect(requestSettled).toBe(true);
  });

  it("rejects on a failed install POST without invalidating either query", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await expect(
      installExtensionRequest("design.editor.inspector", "ext_1", {
        invalidateQueries,
      }),
    ).rejects.toThrow(/Install failed/);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});

describe("DesignExtensionsPanel source — postMessage origin/source hygiene", () => {
  it("adds no raw window message listener outside the shared EmbeddedApp/EmbeddedExtension origin+source checks", () => {
    const source = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "DesignExtensionsPanel.tsx",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/addEventListener\(\s*["']message["']/);
  });
});
