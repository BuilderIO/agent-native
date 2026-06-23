// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useBlockFieldEditor } from "./DocumentBlockFields";
import { __resetBlockFieldSaveRegistry } from "./blockFieldSaveRegistry";

// A save record we can assert against: which (documentId, propertyId) each
// write targeted, and with what value. Resolves immediately so single-flight +
// trailing logic settles within an act().
type SaveCall = { documentId: string; propertyId: string; value: string };

describe("useBlockFieldEditor (identity-safe save wiring)", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container?.remove();
    container = null;
    vi.useRealTimers();
    __resetBlockFieldSaveRegistry();
  });

  // Drives the hook and exposes its onChange so the test can simulate typing.
  // The identity `key` is applied by the caller (mirroring DocumentBlockFields),
  // so changing documentId/propertyId remounts the hook with a fresh controller.
  function Harness({
    documentId,
    propertyId,
    initialContent,
    save,
    onReady,
  }: {
    documentId: string;
    propertyId: string;
    initialContent: string;
    save: (req: SaveCall) => Promise<unknown>;
    onReady: (onChange: (markdown: string) => void) => void;
  }) {
    const { onChange } = useBlockFieldEditor({
      documentId,
      propertyId,
      initialContent,
      save,
    });
    onReady(onChange);
    return null;
  }

  it("an edit after switching docs persists to the NEW doc's field", async () => {
    vi.useFakeTimers();
    const calls: SaveCall[] = [];
    const save = (req: SaveCall) => {
      calls.push(req);
      return Promise.resolve();
    };

    let onChange!: (markdown: string) => void;
    const ready = (fn: (markdown: string) => void) => {
      onChange = fn;
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    // Mount for the OLD doc/field.
    act(() => {
      root!.render(
        createElement(Harness, {
          key: "doc-old:outline",
          documentId: "doc-old",
          propertyId: "outline",
          initialContent: "",
          save,
          onReady: ready,
        }),
      );
    });

    // Switch to the NEW doc/field — the identity key forces a fresh mount.
    act(() => {
      root!.render(
        createElement(Harness, {
          key: "doc-new:summary",
          documentId: "doc-new",
          propertyId: "summary",
          initialContent: "",
          save,
          onReady: ready,
        }),
      );
    });

    // Type into the NEW field and let the debounce fire.
    act(() => {
      onChange("new doc text");
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    const last = calls[calls.length - 1];
    expect(last).toEqual({
      documentId: "doc-new",
      propertyId: "summary",
      value: "new doc text",
    });
    // The new field's write never leaked to the old field.
    expect(
      calls.some(
        (c) => c.documentId === "doc-old" && c.value === "new doc text",
      ),
    ).toBe(false);
  });

  it("a pending edit before switching flushes to the OLD doc's field on unmount", async () => {
    vi.useFakeTimers();
    const calls: SaveCall[] = [];
    const save = (req: SaveCall) => {
      calls.push(req);
      return Promise.resolve();
    };

    let onChange!: (markdown: string) => void;
    const ready = (fn: (markdown: string) => void) => {
      onChange = fn;
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    // Mount for the OLD doc/field and type, but do NOT let the debounce fire.
    act(() => {
      root!.render(
        createElement(Harness, {
          key: "doc-old:outline",
          documentId: "doc-old",
          propertyId: "outline",
          initialContent: "",
          save,
          onReady: ready,
        }),
      );
    });
    act(() => {
      onChange("unsaved old-field edit");
    });
    // The debounce has NOT fired yet — nothing saved so far.
    expect(calls).toHaveLength(0);

    // Switch to the NEW doc/field. The old instance unmounts (identity key
    // change) and its cleanup flushes the pending edit to the OLD field.
    await act(async () => {
      root!.render(
        createElement(Harness, {
          key: "doc-new:summary",
          documentId: "doc-new",
          propertyId: "summary",
          initialContent: "",
          save,
          onReady: ready,
        }),
      );
      await Promise.resolve();
    });

    // The flushed save targeted the OLD field, with the latest typed content.
    expect(calls).toContainEqual({
      documentId: "doc-old",
      propertyId: "outline",
      value: "unsaved old-field edit",
    });
    // It did NOT get misrouted to the new field.
    expect(
      calls.some((c) => c.documentId === "doc-new"),
    ).toBe(false);
  });

  it("same-field collapse→reopen→edit within the in-flight window: older save never wins (shared controller)", async () => {
    vi.useFakeTimers();

    // The SAME documentId:propertyId collapsing then re-expanding, which is the
    // cross-instance hole. With ONE shared controller per key, the reopened
    // instance reuses the live controller (the old save is still in flight, so
    // the controller wasn't evicted). Single-flight coalesces the new edit; the
    // trailing save fires after the old save settles. We drive resolve order by
    // hand so the OLD save is still in flight when the NEW edit arrives.
    const order: Array<{ value: string }> = [];
    const resolvers: Array<() => void> = [];
    const save = (req: SaveCall) => {
      order.push({ value: req.value });
      return new Promise<void>((resolve) => {
        resolvers.push(() => resolve());
      });
    };

    let onChange!: (markdown: string) => void;
    const ready = (fn: (markdown: string) => void) => {
      onChange = fn;
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    // Mount instance #1 for the field, type, and let the debounce fire so a save
    // for "old content" goes in flight (not yet resolved).
    act(() => {
      root!.render(
        createElement(Harness, {
          key: "doc:field",
          documentId: "doc",
          propertyId: "field",
          initialContent: "",
          save,
          onReady: ready,
        }),
      );
    });
    act(() => {
      onChange("old content");
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });
    expect(order).toEqual([{ value: "old content" }]);

    // COLLAPSE: unmount instance #1. Release flush-then-evicts; the "old content"
    // save is still in flight so the controller is NOT evicted yet.
    act(() => {
      root!.render(createElement("div", null));
    });

    // RE-EXPAND: a fresh instance mounts under the SAME key and RE-ACQUIRES the
    // same live controller. The user edits before the old save settled.
    act(() => {
      root!.render(
        createElement(Harness, {
          key: "doc:field",
          documentId: "doc",
          propertyId: "field",
          initialContent: "",
          save,
          onReady: ready,
        }),
      );
    });
    act(() => {
      onChange("new content");
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    // The new save must NOT have started yet: single-flight holds it behind the
    // still-in-flight old save (it coalesced into the one controller's pending).
    expect(order).toEqual([{ value: "old content" }]);

    // Settle the OLD save → the trailing save for the latest pending starts.
    await act(async () => {
      resolvers[0]!();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(order).toEqual([{ value: "old content" }, { value: "new content" }]);

    // Settle the NEW save. Write order was old-before-new: the older save could
    // never overwrite the newer one.
    await act(async () => {
      resolvers[1]!();
      await Promise.resolve();
    });
    expect(order.map((c) => c.value)).toEqual(["old content", "new content"]);
    expect(order[order.length - 1]!.value).toBe("new content");
  });

  // THE bug the per-key lane could NOT fix. Two controller instances for the same
  // key (old + new) each with their own pending; the OLD instance's STALE trailing
  // value gets enqueued AFTER the NEW instance's newer content, so lane order is
  // oldA → newC → oldB and stale B wins. With ONE shared controller there is a
  // single pending, so the newest content is always the final write regardless of
  // how the saves resolve.
  it("old in-flight + old trailing + new edit after remount: newest content is the final write, under any resolve order", async () => {
    // Run the scenario under multiple resolve orderings to prove no interleaving
    // lets a stale value land last.
    for (const resolveOrder of [
      [0, 1, 2],
      [2, 1, 0],
      [1, 0, 2],
      [0, 2, 1],
    ]) {
      vi.useFakeTimers();
      const order: string[] = [];
      const resolvers: Array<() => void> = [];
      const save = (req: SaveCall) => {
        order.push(req.value);
        return new Promise<void>((resolve) => {
          resolvers.push(() => resolve());
        });
      };

      let onChange!: (markdown: string) => void;
      const ready = (fn: (markdown: string) => void) => {
        onChange = fn;
      };

      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      // Instance #1: type "A", debounce → save("A") in flight (not resolved).
      act(() => {
        root!.render(
          createElement(Harness, {
            key: "doc:field",
            documentId: "doc",
            propertyId: "field",
            initialContent: "",
            save,
            onReady: ready,
          }),
        );
      });
      act(() => onChange("A"));
      await act(async () => {
        vi.advanceTimersByTime(600);
        await Promise.resolve();
      });

      // Instance #1 makes a newer edit "B" while "A" is in flight — coalesced as
      // the one controller's pending trailing value (the "old trailing value").
      act(() => onChange("B"));

      // COLLAPSE then REOPEN under the same key: a new instance re-acquires the
      // SAME controller (A still in flight → not evicted).
      act(() => {
        root!.render(createElement("div", null));
      });
      act(() => {
        root!.render(
          createElement(Harness, {
            key: "doc:field",
            documentId: "doc",
            propertyId: "field",
            initialContent: "",
            save,
            onReady: ready,
          }),
        );
      });

      // The reopened editor types the NEWEST content "C". Because there is ONE
      // pending, "C" supersedes the stale "B" — the lane bug (stale B landing
      // after C) is structurally impossible.
      act(() => onChange("C"));
      await act(async () => {
        vi.advanceTimersByTime(600);
        await Promise.resolve();
      });

      // Drain all saves under the chosen resolve order. Single-flight means at
      // most one save is in flight; settling it kicks the trailing save for the
      // latest pending until quiescent.
      await act(async () => {
        for (const i of resolveOrder) {
          resolvers[i]?.();
          await Promise.resolve();
          await Promise.resolve();
        }
        // Settle any trailing saves spawned after the initial drain.
        for (let i = 0; i < resolvers.length; i++) {
          resolvers[i]?.();
          await Promise.resolve();
        }
        await Promise.resolve();
      });

      // The final persisted value is the NEWEST content, never the stale "B".
      expect(order[order.length - 1]).toBe("C");
      // And a stale value never lands after the newest one was written.
      const lastC = order.lastIndexOf("C");
      expect(order.slice(lastC).every((v) => v === "C")).toBe(true);

      act(() => root?.unmount());
      root = null;
      container?.remove();
      container = null;
      vi.useRealTimers();
      __resetBlockFieldSaveRegistry();
    }
  });
});
