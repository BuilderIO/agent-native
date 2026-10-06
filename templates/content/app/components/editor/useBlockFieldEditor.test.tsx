// @vitest-environment happy-dom

import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { __resetBlockFieldSaveRegistry } from "./blockFieldSaveRegistry";
import { useBlockFieldEditor } from "./DocumentBlockFields";

type SaveCall = {
  documentId: string;
  propertyId: string;
  value: string;
  expectedBlocksFieldRevision: number;
};

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

  function Harness({
    documentId,
    propertyId,
    initialContent,
    initialRevision = 0,
    save,
    onReady,
    onContent,
    onRevisionConflict,
    onReleaseSettled,
  }: {
    documentId: string;
    propertyId: string;
    initialContent: string;
    initialRevision?: number;
    save: (req: SaveCall) => Promise<unknown>;
    onReady: (onChange: (markdown: string) => void) => void;
    onContent?: (content: string, editorResetVersion: number) => void;
    onRevisionConflict?: () => void;
    onReleaseSettled?: (evicted: boolean) => void;
  }) {
    const { content, editorResetVersion, onChange } = useBlockFieldEditor({
      documentId,
      propertyId,
      initialContent,
      initialRevision,
      save,
      onRevisionConflict,
      onReleaseSettled,
    });
    onReady(onChange);
    onContent?.(content, editorResetVersion);
    return null;
  }

  function ImmediateSaveHarness({
    save,
    onReady,
  }: {
    save: (req: SaveCall) => Promise<unknown>;
    onReady: (onSaveContent: (markdown: string) => Promise<boolean>) => void;
  }) {
    const { onSaveContent } = useBlockFieldEditor({
      documentId: "doc",
      propertyId: "field",
      initialContent: "",
      initialRevision: 0,
      save,
    });
    onReady(onSaveContent);
    return null;
  }

  it("awaits an immediate Blocks-field save before reporting persistence", async () => {
    const save = vi.fn(async (_request: SaveCall) => {});
    let onSaveContent!: (markdown: string) => Promise<boolean>;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        createElement(ImmediateSaveHarness, {
          save,
          onReady: (callback) => {
            onSaveContent = callback;
          },
        }),
      );
    });

    await expect(onSaveContent("persisted now")).resolves.toBe(true);
    expect(save).toHaveBeenCalledWith({
      documentId: "doc",
      propertyId: "field",
      value: "persisted now",
      expectedBlocksFieldRevision: 0,
    });
  });

  it("reports release only after the final persistence settles", async () => {
    vi.useFakeTimers();
    let resolveSave!: () => void;
    const save = vi.fn(
      async (_request: SaveCall) =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const releaseSettled = vi.fn();
    let onChange!: (markdown: string) => void;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        createElement(Harness, {
          documentId: "doc",
          propertyId: "field",
          initialContent: "persisted",
          save,
          onReady: (callback) => {
            onChange = callback;
          },
          onReleaseSettled: releaseSettled,
        }),
      );
    });
    act(() => onChange("latest live value"));
    act(() => root!.unmount());
    root = null;

    expect(save).toHaveBeenCalledTimes(1);
    expect(releaseSettled).not.toHaveBeenCalled();

    await act(async () => resolveSave());
    expect(releaseSettled).toHaveBeenCalledWith(true);
  });

  it("retains the live projection when the final persistence fails", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (_request: SaveCall) => {
      throw new Error("network unavailable");
    });
    const releaseSettled = vi.fn();
    let onChange!: (markdown: string) => void;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        createElement(Harness, {
          documentId: "doc",
          propertyId: "field",
          initialContent: "persisted",
          save,
          onReady: (callback) => {
            onChange = callback;
          },
          onReleaseSettled: releaseSettled,
        }),
      );
    });
    act(() => onChange("unsaved live value"));
    act(() => root!.unmount());
    root = null;

    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(releaseSettled).toHaveBeenCalledWith(false);
  });

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
      expectedBlocksFieldRevision: 0,
    });
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
    expect(calls).toHaveLength(0);

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

    expect(calls).toContainEqual({
      documentId: "doc-old",
      propertyId: "outline",
      value: "unsaved old-field edit",
      expectedBlocksFieldRevision: 0,
    });
    expect(calls.some((c) => c.documentId === "doc-new")).toBe(false);
  });

  it("same-field collapse→reopen→edit within the in-flight window: older save never wins (shared controller)", async () => {
    vi.useFakeTimers();

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
    act(() => {
      onChange("new content");
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    expect(order).toEqual([{ value: "old content" }]);

    await act(async () => {
      resolvers[0]!();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(order).toEqual([{ value: "old content" }, { value: "new content" }]);

    await act(async () => {
      resolvers[1]!();
      await Promise.resolve();
    });
    expect(order.map((c) => c.value)).toEqual(["old content", "new content"]);
    expect(order[order.length - 1]!.value).toBe("new content");
  });

  it("old in-flight + old trailing + new edit after remount: newest content is the final write, under any resolve order", async () => {
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

      act(() => onChange("B"));

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

      act(() => onChange("C"));
      await act(async () => {
        vi.advanceTimersByTime(600);
        await Promise.resolve();
      });

      await act(async () => {
        for (const i of resolveOrder) {
          resolvers[i]?.();
          await Promise.resolve();
          await Promise.resolve();
        }
        for (let i = 0; i < resolvers.length; i++) {
          resolvers[i]?.();
          await Promise.resolve();
        }
        await Promise.resolve();
      });

      expect(order[order.length - 1]).toBe("C");
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
      expectedBlocksFieldRevision: 0,
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
          onContent,
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(seenContent).toBe("saved value");
    expect(calls.every((c) => c.value === "saved value")).toBe(true);
  });

  it("a genuinely newer server value is still adopted when the field is clean", async () => {
    const calls: SaveCall[] = [];
    const save = (req: SaveCall) => {
      calls.push(req);
      return Promise.resolve();
    };

    const ready = () => {};
    let seenContent = "";
    const onContent = (c: string) => {
      seenContent = c;
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

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
    expect(calls).toHaveLength(0);
  });

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
    expect(calls).toEqual([
      {
        documentId: "doc",
        propertyId: "field",
        value: "mine",
        expectedBlocksFieldRevision: 0,
      },
    ]);
  });

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

    expect(seenContent).toBe("dirty edit in progress");
  });

  it("adopts the accepted server winner after a stale revision is rejected", async () => {
    vi.useFakeTimers();
    const calls: SaveCall[] = [];
    const onRevisionConflict = vi.fn();
    const save = (req: SaveCall) => {
      calls.push(req);
      if (calls.length === 1) {
        return Promise.reject({ status: 409 });
      }
      return Promise.resolve({
        properties: [
          {
            definition: { id: "field" },
            blocksField: { revision: 12 },
          },
        ],
      });
    };

    let onChange!: (markdown: string) => void;
    const ready = (fn: (markdown: string) => void) => {
      onChange = fn;
    };
    let seenContent = "";
    let seenEditorResetVersion = -1;
    const onContent = (content: string, editorResetVersion: number) => {
      seenContent = content;
      seenEditorResetVersion = editorResetVersion;
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        createElement(Harness, {
          key: "doc:field",
          documentId: "doc",
          propertyId: "field",
          initialContent: "server base",
          initialRevision: 10,
          save,
          onReady: ready,
          onContent,
          onRevisionConflict,
        }),
      );
    });
    act(() => onChange("stale local draft"));
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onRevisionConflict).toHaveBeenCalledTimes(1);
    expect(calls[0]?.expectedBlocksFieldRevision).toBe(10);
    expect(seenEditorResetVersion).toBe(0);

    act(() => {
      root!.render(
        createElement(Harness, {
          key: "doc:field",
          documentId: "doc",
          propertyId: "field",
          initialContent: "accepted server winner",
          initialRevision: 11,
          save,
          onReady: ready,
          onContent,
          onRevisionConflict,
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(seenContent).toBe("accepted server winner");
    expect(seenEditorResetVersion).toBe(1);

    act(() => onChange("edit after conflict"));
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(calls[1]).toMatchObject({
      value: "edit after conflict",
      expectedBlocksFieldRevision: 11,
    });
  });

  it("does not retry a rejected stale draft when unmounted before refetch", async () => {
    vi.useFakeTimers();
    const calls: SaveCall[] = [];
    let rejectSave!: (error: unknown) => void;
    const save = (req: SaveCall) => {
      calls.push(req);
      return new Promise((_resolve, reject) => {
        rejectSave = reject;
      });
    };
    let onChange!: (markdown: string) => void;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        createElement(Harness, {
          key: "doc:field",
          documentId: "doc",
          propertyId: "field",
          initialContent: "server base",
          initialRevision: 10,
          save,
          onReady: (fn) => {
            onChange = fn;
          },
        }),
      );
    });
    act(() => onChange("stale local draft"));
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    await act(async () => {
      root!.render(createElement("div", null));
      rejectSave({ status: 409 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(calls).toHaveLength(1);
  });

  it("preserves a newer draft typed while the conflict winner refetches", async () => {
    vi.useFakeTimers();
    const calls: SaveCall[] = [];
    const save = (req: SaveCall) => {
      calls.push(req);
      if (calls.length === 1) return Promise.reject({ status: 409 });
      return Promise.resolve({
        properties: [
          {
            definition: { id: "field" },
            blocksField: { revision: 12 },
          },
        ],
      });
    };
    let onChange!: (markdown: string) => void;
    let seenContent = "";
    let seenEditorResetVersion = -1;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const render = (initialContent: string, initialRevision: number) =>
      root!.render(
        createElement(Harness, {
          key: "doc:field",
          documentId: "doc",
          propertyId: "field",
          initialContent,
          initialRevision,
          save,
          onReady: (fn) => {
            onChange = fn;
          },
          onContent: (content, editorResetVersion) => {
            seenContent = content;
            seenEditorResetVersion = editorResetVersion;
          },
        }),
      );

    act(() => render("server base", 10));
    act(() => onChange("rejected draft"));
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => onChange("newer local draft"));
    act(() => render("accepted server winner", 11));
    await act(async () => {
      await Promise.resolve();
    });

    expect(seenContent).toBe("newer local draft");
    expect(seenEditorResetVersion).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(calls[1]).toMatchObject({
      value: "newer local draft",
      expectedBlocksFieldRevision: 11,
    });
  });
});
