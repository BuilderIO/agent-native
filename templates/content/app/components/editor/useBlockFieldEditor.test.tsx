// @vitest-environment happy-dom

import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { __resetBlockFieldSaveRegistry } from "./blockFieldSaveRegistry";
import { useBlockFieldEditor } from "./DocumentBlockFields";
import type { VisualEditorExternalContent } from "./VisualEditor";

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
    keepaliveSave,
    onReady,
    onContent,
    onExternalContent,
    onTextMoved,
    onReleaseSettled,
  }: {
    documentId: string;
    propertyId: string;
    initialContent: string;
    initialRevision?: number;
    save: (req: SaveCall) => Promise<unknown>;
    keepaliveSave?: (req: SaveCall) => boolean;
    onReady: (onChange: (markdown: string) => void) => void;
    onContent?: (content: string) => void;
    onExternalContent?: (
      externalContent: VisualEditorExternalContent | null,
    ) => void;
    onTextMoved?: () => void;
    onReleaseSettled?: (evicted: boolean) => void;
  }) {
    const { content, externalContent, onChange } = useBlockFieldEditor({
      documentId,
      propertyId,
      initialContent,
      initialRevision,
      save,
      keepaliveSave,
      onTextMoved,
      onReleaseSettled,
    });
    onReady(onChange);
    onContent?.(content);
    onExternalContent?.(externalContent);
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

  function savedAt(revision: number) {
    return {
      properties: [{ definition: { id: "field" }, blocksField: { revision } }],
    };
  }

  const settle = () =>
    act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
    });

  type MountedField = {
    onChange: (markdown: string) => void;
    content: string;
    externalContent: VisualEditorExternalContent | null;
    textMoved: Mock<() => void>;
  };

  function mountField(options: {
    initialContent: string;
    initialRevision: number;
    save: (req: SaveCall) => Promise<unknown>;
    keepaliveSave?: (req: SaveCall) => boolean;
  }) {
    const field: MountedField = {
      onChange: () => {},
      content: "",
      externalContent: null,
      textMoved: vi.fn<() => void>(),
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const render = (initialContent: string, initialRevision: number) =>
      act(() => {
        root!.render(
          createElement(Harness, {
            key: "doc:field",
            documentId: "doc",
            propertyId: "field",
            initialContent,
            initialRevision,
            save: options.save,
            keepaliveSave: options.keepaliveSave,
            onReady: (onChange) => {
              field.onChange = onChange;
            },
            onContent: (content) => {
              field.content = content;
            },
            onExternalContent: (externalContent) => {
              field.externalContent = externalContent;
            },
            onTextMoved: field.textMoved,
          }),
        );
      });
    render(options.initialContent, options.initialRevision);
    return { field, render };
  }

  // Stands in for the editor applying a merge request to what it holds.
  function mergeLive(field: MountedField, live: string): string | null {
    let merged: string | null = null;
    act(() => {
      merged = field.externalContent!.merge(live);
    });
    return merged;
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

  it("merges the accepted winner with a draft the server refused as stale", async () => {
    vi.useFakeTimers();
    const calls: SaveCall[] = [];
    const save = (req: SaveCall) => {
      calls.push(req);
      return calls.length === 1
        ? Promise.reject({ status: 409 })
        : Promise.resolve(savedAt(12));
    };
    const { field, render } = mountField({
      initialContent: "server base",
      initialRevision: 10,
      save,
    });

    act(() => field.onChange("stale local draft"));
    await settle();
    expect(calls).toEqual([
      expect.objectContaining({
        value: "stale local draft",
        expectedBlocksFieldRevision: 10,
      }),
    ]);

    // More typing waits for the newer text instead of being refused again.
    act(() => field.onChange("stale local draft, longer"));
    await settle();
    expect(calls).toHaveLength(1);
    expect(field.externalContent).toBeNull();

    render("accepted server winner", 11);
    expect(mergeLive(field, "stale local draft, longer")).toBe(
      "accepted server winner\nstale local draft, longer",
    );
    expect(field.content).toBe(
      "accepted server winner\nstale local draft, longer",
    );
    expect(field.textMoved).toHaveBeenCalledTimes(1);

    await settle();
    expect(calls[1]).toMatchObject({
      value: "accepted server winner\nstale local draft, longer",
      expectedBlocksFieldRevision: 11,
    });
  });

  it("merges newer text saved elsewhere into unsaved typing", async () => {
    vi.useFakeTimers();
    const calls: SaveCall[] = [];
    const save = (req: SaveCall) => {
      calls.push(req);
      return Promise.resolve(savedAt(12));
    };
    const { field, render } = mountField({
      initialContent: "One\nTwo",
      initialRevision: 10,
      save,
    });

    act(() => field.onChange("One\nTwo and more"));
    render("One edited\nTwo", 11);
    // The editor holds typing it hasn't reported yet; the merge keeps it.
    expect(mergeLive(field, "One\nTwo and more, still typing")).toBe(
      "One edited\nTwo and more, still typing",
    );
    expect(field.textMoved).not.toHaveBeenCalled();

    await settle();
    expect(calls).toEqual([
      {
        documentId: "doc",
        propertyId: "field",
        value: "One edited\nTwo and more, still typing",
        expectedBlocksFieldRevision: 11,
      },
    ]);
  });

  it("shows newer text in a field whose own save was answered first", async () => {
    vi.useFakeTimers();
    const calls: SaveCall[] = [];
    const save = (req: SaveCall) => {
      calls.push(req);
      return Promise.resolve(savedAt(10 + calls.length));
    };
    const { field, render } = mountField({
      initialContent: "base",
      initialRevision: 10,
      save,
    });

    act(() => field.onChange("mine"));
    await settle();
    expect(calls[0]).toMatchObject({
      value: "mine",
      expectedBlocksFieldRevision: 10,
    });

    // The refetch skips the echo of "mine": an agent saved over it since.
    render("agent edit", 12);
    expect(mergeLive(field, "mine")).toBe("agent edit");
    expect(field.content).toBe("agent edit");
    await settle();
    expect(calls).toHaveLength(1);

    act(() => field.onChange("agent edit, then mine"));
    await settle();
    expect(calls[1]).toMatchObject({
      value: "agent edit, then mine",
      expectedBlocksFieldRevision: 12,
    });
  });

  it("ignores props older than the revision a save answered with", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (_req: SaveCall) => savedAt(11));
    const { field, render } = mountField({
      initialContent: "base",
      initialRevision: 10,
      save,
    });

    act(() => field.onChange("mine"));
    await settle();
    render("an older read", 10);
    await settle();

    expect(field.content).toBe("mine");
    expect(field.externalContent).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("sends unsaved typing as a page-close save", () => {
    vi.useFakeTimers();
    const save = vi.fn(async (_req: SaveCall) => savedAt(11));
    const keepaliveSave = vi.fn((_req: SaveCall) => true);
    const { field } = mountField({
      initialContent: "base",
      initialRevision: 10,
      save,
      keepaliveSave,
    });

    act(() => field.onChange("typed just before closing"));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(keepaliveSave).toHaveBeenCalledExactlyOnceWith({
      documentId: "doc",
      propertyId: "field",
      value: "typed just before closing",
      expectedBlocksFieldRevision: 10,
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("saves right away when the page-close save can't be sent", () => {
    vi.useFakeTimers();
    const save = vi.fn(async (_req: SaveCall) => savedAt(11));
    const { field } = mountField({
      initialContent: "base",
      initialRevision: 10,
      save,
      keepaliveSave: () => false,
    });

    act(() => field.onChange("typed just before closing"));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(save).toHaveBeenCalledExactlyOnceWith({
      documentId: "doc",
      propertyId: "field",
      value: "typed just before closing",
      expectedBlocksFieldRevision: 10,
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

  it("waits for a save in flight before merging newer text", async () => {
    vi.useFakeTimers();
    const calls: SaveCall[] = [];
    let rejectSave!: (error: unknown) => void;
    const save = (req: SaveCall) => {
      calls.push(req);
      if (calls.length > 1) return Promise.resolve(savedAt(12));
      return new Promise((_resolve, reject) => {
        rejectSave = reject;
      });
    };
    const { field, render } = mountField({
      initialContent: "base",
      initialRevision: 10,
      save,
    });

    act(() => field.onChange("base mine"));
    await settle();
    render("agent base", 11);
    expect(field.externalContent).toBeNull();

    await act(async () => {
      rejectSave({ status: 409 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mergeLive(field, "base mine")).toBe("agent base mine");

    await settle();
    expect(calls[1]).toMatchObject({
      value: "agent base mine",
      expectedBlocksFieldRevision: 11,
    });
  });
});
