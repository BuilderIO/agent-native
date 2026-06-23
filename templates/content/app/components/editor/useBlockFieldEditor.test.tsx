// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useBlockFieldEditor } from "./DocumentBlockFields";

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

  it("same-field collapse→reopen→edit within the in-flight window: older flush never wins", async () => {
    vi.useFakeTimers();

    // The save target this whole test churns on — the SAME documentId:propertyId
    // remounting (collapse then re-expand), which is the cross-instance hole the
    // per-key lane closes. We control resolve order by hand so the OLD instance's
    // flush is still in flight when the NEW instance issues its newer save.
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

    // COLLAPSE: unmount instance #1. Its cleanup fires `void controller.flush()`.
    // The "old content" save is still in flight, so the flush has nothing newer
    // to send here — but its lane position is registered ahead of anything the
    // remount issues.
    act(() => {
      root!.render(createElement("div", null));
    });

    // RE-EXPAND: a FRESH instance #1' mounts under the SAME key with a fresh
    // controller. The user edits before the old save settled.
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

    // The new save must NOT have started yet: the lane serializes it behind the
    // still-in-flight old save for the same key.
    expect(order).toEqual([{ value: "old content" }]);

    // Settle the OLD save → only now may the NEW save start (issue order).
    await act(async () => {
      resolvers[0]!();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(order).toEqual([{ value: "old content" }, { value: "new content" }]);

    // Settle the NEW save. The DB write order was old-before-new: the older
    // in-flight save could never overwrite the newer one.
    await act(async () => {
      resolvers[1]!();
      await Promise.resolve();
    });
    expect(order.map((c) => c.value)).toEqual(["old content", "new content"]);
    // Newest content is the final write.
    expect(order[order.length - 1]!.value).toBe("new content");
  });
});
