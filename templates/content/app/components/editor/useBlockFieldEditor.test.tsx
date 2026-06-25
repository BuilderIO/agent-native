// @vitest-environment happy-dom

import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { __resetBlockFieldSaveRegistry } from "./blockFieldSaveRegistry";
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
    onContent,
  }: {
    documentId: string;
    propertyId: string;
    initialContent: string;
    save: (req: SaveCall) => Promise<unknown>;
    onReady: (onChange: (markdown: string) => void) => void;
    onContent?: (content: string) => void;
  }) {
    const { content, onChange } = useBlockFieldEditor({
      documentId,
      propertyId,
      initialContent,
      save,
    });
    onReady(onChange);
    onContent?.(content);
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
    expect(calls.some((c) => c.documentId === "doc-new")).toBe(false);
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

  // Fix #3: after a save succeeds, a remount BEFORE the server query refetches
  // must show the SAVED content, not the stale `initialContent` (the older server
  // props). The controller's lastSaved is authoritative until the server echoes.
  it("remount before the server query updates shows the SAVED content, not stale initialContent", async () => {
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
    let seenContent = "";
    const onContent = (c: string) => {
      seenContent = c;
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    // Mount with empty server content, type + let the debounce fire and the save
    // RESOLVE so the controller's lastSaved advances to "saved value".
    act(() => {
      root!.render(
        createElement(Harness, {
          key: "doc:field",
          documentId: "doc",
          propertyId: "field",
          initialContent: "",
          save,
          onReady: ready,
          onContent,
        }),
      );
    });
    act(() => onChange("saved value"));
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(calls[calls.length - 1]).toEqual({
      documentId: "doc",
      propertyId: "field",
      value: "saved value",
    });

    // REMOUNT while the server query has NOT yet refetched — initialContent is
    // still the STALE empty string. The editor must seed from the controller's
    // lastSaved ("saved value"), and must NOT adopt the stale "".
    act(() => {
      root!.render(
        createElement(Harness, {
          key: "doc:field",
          documentId: "doc",
          propertyId: "field",
          initialContent: "",
          save,
          onReady: ready,
          onContent,
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(seenContent).toBe("saved value");
    // The stale "" was never adopted (no spurious save of "" either).
    expect(calls.every((c) => c.value === "saved value")).toBe(true);
  });

  // Fix #3 non-regression (a): a GENUINELY newer server value is still adopted
  // when the field is clean (e.g. an agent edited the field server-side).
  it("a genuinely newer server value is still adopted when the field is clean", async () => {
    const calls: SaveCall[] = [];
    const save = (req: SaveCall) => {
      calls.push(req);
      return Promise.resolve();
    };

    let onChange!: (markdown: string) => void;
    const ready = (fn: (markdown: string) => void) => {
      onChange = fn;
    };
    let seenContent = "";
    const onContent = (c: string) => {
      seenContent = c;
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    // Mount clean with server content "v1" (no local edits, no local save).
    act(() => {
      root!.render(
        createElement(Harness, {
          key: "doc:field",
          documentId: "doc",
          propertyId: "field",
          initialContent: "v1",
          save,
          onReady: ready,
          onContent,
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(seenContent).toBe("v1");

    // The server value changes externally to "v2 from agent" — the field is clean
    // and never saved locally, so this newer value is adopted into the editor.
    act(() => {
      root!.render(
        createElement(Harness, {
          key: "doc:field",
          documentId: "doc",
          propertyId: "field",
          initialContent: "v2 from agent",
          save,
          onReady: ready,
          onContent,
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(seenContent).toBe("v2 from agent");
    // Adopting a server value must not trigger a save.
    expect(calls).toHaveLength(0);
  });

  // Fix #3 regression guard: after a local save AND the server echoing it, the
  // just-saved latch must CLEAR — otherwise a later genuine external/agent edit
  // is suppressed forever. This is the hole the final review caught.
  it("adopts a later external edit after a local save has been echoed by the server", async () => {
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
    let seenContent = "";
    const onContent = (c: string) => {
      seenContent = c;
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    // Mount clean, type, let the debounce fire + the save RESOLVE → lastSaved
    // = "mine", hasSavedLocally = true.
    act(() => {
      root!.render(
        createElement(Harness, {
          key: "doc:field",
          documentId: "doc",
          propertyId: "field",
          initialContent: "",
          save,
          onReady: ready,
          onContent,
        }),
      );
    });
    act(() => onChange("mine"));
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Server now echoes our saved value: initialContent === lastSaved. This must
    // clear the latch (no adopt, no save), leaving content "mine".
    act(() => {
      root!.render(
        createElement(Harness, {
          key: "doc:field",
          documentId: "doc",
          propertyId: "field",
          initialContent: "mine",
          save,
          onReady: ready,
          onContent,
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(seenContent).toBe("mine");

    // A LATER genuine external edit must now be adopted (latch was cleared by
    // the echo). Without the fix the latch stays set and this is suppressed.
    act(() => {
      root!.render(
        createElement(Harness, {
          key: "doc:field",
          documentId: "doc",
          propertyId: "field",
          initialContent: "agent edit",
          save,
          onReady: ready,
          onContent,
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(seenContent).toBe("agent edit");
    // Only the original local save happened; adopting never saves.
    expect(calls).toEqual([
      { documentId: "doc", propertyId: "field", value: "mine" },
    ]);
  });

  // Fix #3 non-regression (b): dirty local edits survive a remount (never
  // clobbered by initialContent), and seed from the controller's pending.
  it("dirty local edits survive remount (seeded from pending, never clobbered)", async () => {
    vi.useFakeTimers();
    const save = (_req: SaveCall) => Promise.resolve();

    let onChange!: (markdown: string) => void;
    const ready = (fn: (markdown: string) => void) => {
      onChange = fn;
    };
    let seenContent = "";
    const onContent = (c: string) => {
      seenContent = c;
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    // Mount, type a dirty edit, but do NOT let the debounce fire (still dirty,
    // pending !== lastSaved).
    act(() => {
      root!.render(
        createElement(Harness, {
          key: "doc:field",
          documentId: "doc",
          propertyId: "field",
          initialContent: "server base",
          save,
          onReady: ready,
          onContent,
        }),
      );
    });
    act(() => onChange("dirty edit in progress"));

    // REMOUNT (collapse→reopen) while still dirty and with stale server props.
    act(() => {
      root!.render(
        createElement(Harness, {
          key: "doc:field",
          documentId: "doc",
          propertyId: "field",
          initialContent: "server base",
          save,
          onReady: ready,
          onContent,
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    // The dirty edit is preserved (seeded from the controller's pending), not
    // reset to the server base.
    expect(seenContent).toBe("dirty edit in progress");
  });
});
