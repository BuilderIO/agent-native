// @vitest-environment happy-dom

import { useEditor, type Editor } from "@tiptap/react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRichMarkdownExtensions } from "./RichMarkdownEditor.js";
import { useCollabReconcile, getEditorMarkdown } from "./useCollabReconcile.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

interface HarnessProps {
  value: string;
  contentUpdatedAt: string;
}

interface Captured {
  editor: Editor | null;
  emitted: string[];
  setContentCalls: number;
}

function makeHarness() {
  const captured: Captured = {
    editor: null,
    emitted: [],
    setContentCalls: 0,
  };

  function Harness({ value, contentUpdatedAt }: HarnessProps) {
    const guardsRef = React.useRef<ReturnType<
      typeof useCollabReconcile
    > | null>(null);

    const editor = useEditor({
      extensions: createRichMarkdownExtensions({ dialect: "gfm" }),
      content: value,
      onUpdate: ({ editor, transaction }) => {
        const guards = guardsRef.current;
        if (!guards || guards.shouldIgnoreUpdate(transaction)) return;
        const markdown = getEditorMarkdown(editor);
        if (!guards.registerEmitted(markdown)) return;
        captured.emitted.push(markdown);
      },
    });
    captured.editor = editor;

    const guards = useCollabReconcile({
      editor,
      value,
      contentUpdatedAt,
      editable: true,
      getMarkdown: getEditorMarkdown,
      parseValue: false,
      setContent: (ed, v, options) => {
        captured.setContentCalls += 1;
        if (options.addToHistory === false) {
          ed.chain()
            .command(({ tr }) => {
              tr.setMeta("addToHistory", false);
              return true;
            })
            .setContent(v, { emitUpdate: options.emitUpdate })
            .run();
          return;
        }
        ed.commands.setContent(v);
      },
    });
    guardsRef.current = guards;

    return React.createElement("div", null);
  }

  return { captured, Harness };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

const NON_IDEMPOTENT =
  '<h1>Title</h1><ul class="contains-task-list"><li>One</li></ul>';

describe("useCollabReconcile idempotent-safe reconcile", () => {
  it("applies a NON-idempotent value at most once across many polls and stabilizes", async () => {
    const { captured, Harness } = makeHarness();

    act(() => {
      root.render(
        React.createElement(Harness, {
          value: "",
          contentUpdatedAt: "2024-01-01T00:00:00.000Z",
        }),
      );
    });
    await flush();

    act(() => {
      root.render(
        React.createElement(Harness, {
          value: NON_IDEMPOTENT,
          contentUpdatedAt: "2024-01-01T00:00:01.000Z",
        }),
      );
    });
    await flush();

    const serializedAfterApply = getEditorMarkdown(captured.editor!);
    expect(serializedAfterApply).not.toBe(NON_IDEMPOTENT);
    const applyCountAfterFirst = captured.setContentCalls;
    expect(applyCountAfterFirst).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < 6; i++) {
      act(() => {
        root.render(
          React.createElement(Harness, {
            value: NON_IDEMPOTENT,
            contentUpdatedAt: "2024-01-01T00:00:01.000Z",
          }),
        );
      });
      await flush();
    }

    expect(captured.setContentCalls).toBe(applyCountAfterFirst);
    expect(getEditorMarkdown(captured.editor!)).toBe(serializedAfterApply);
  });

  it("recognizes its own serialized echo (bumped timestamp) and does not re-apply", async () => {
    const { captured, Harness } = makeHarness();

    act(() => {
      root.render(
        React.createElement(Harness, {
          value: "",
          contentUpdatedAt: "2024-01-01T00:00:00.000Z",
        }),
      );
    });
    await flush();

    act(() => {
      root.render(
        React.createElement(Harness, {
          value: NON_IDEMPOTENT,
          contentUpdatedAt: "2024-01-01T00:00:01.000Z",
        }),
      );
    });
    await flush();

    const serialized = getEditorMarkdown(captured.editor!);
    const applyCount = captured.setContentCalls;

    for (let i = 0; i < 5; i++) {
      act(() => {
        root.render(
          React.createElement(Harness, {
            value: serialized,
            contentUpdatedAt: `2024-01-01T00:00:0${2 + i}.000Z`,
          }),
        );
      });
      await flush();
    }

    expect(captured.setContentCalls).toBe(applyCount);
    expect(getEditorMarkdown(captured.editor!)).toBe(serialized);
  });

  it("still applies a genuinely-new external edit after a non-idempotent apply", async () => {
    const { captured, Harness } = makeHarness();

    act(() => {
      root.render(
        React.createElement(Harness, {
          value: "",
          contentUpdatedAt: "2024-01-01T00:00:00.000Z",
        }),
      );
    });
    await flush();

    act(() => {
      root.render(
        React.createElement(Harness, {
          value: NON_IDEMPOTENT,
          contentUpdatedAt: "2024-01-01T00:00:01.000Z",
        }),
      );
    });
    await flush();
    const applyCount = captured.setContentCalls;

    act(() => {
      root.render(
        React.createElement(Harness, {
          value: "# Brand New Heading\n\nFresh body.",
          contentUpdatedAt: "2024-01-01T00:00:05.000Z",
        }),
      );
    });
    await flush();

    expect(captured.setContentCalls).toBeGreaterThan(applyCount);
    expect(getEditorMarkdown(captured.editor!)).toBe(
      "# Brand New Heading\n\nFresh body.",
    );
  });

  it("does not re-apply an idempotent value that is re-polled unchanged", async () => {
    const { captured, Harness } = makeHarness();
    const CLEAN = "# Heading\n\nA paragraph with **bold** text.";

    act(() => {
      root.render(
        React.createElement(Harness, {
          value: "",
          contentUpdatedAt: "2024-01-01T00:00:00.000Z",
        }),
      );
    });
    await flush();

    act(() => {
      root.render(
        React.createElement(Harness, {
          value: CLEAN,
          contentUpdatedAt: "2024-01-01T00:00:01.000Z",
        }),
      );
    });
    await flush();
    const applyCount = captured.setContentCalls;
    expect(getEditorMarkdown(captured.editor!)).toBe(CLEAN);

    for (let i = 0; i < 4; i++) {
      act(() => {
        root.render(
          React.createElement(Harness, {
            value: CLEAN,
            contentUpdatedAt: "2024-01-01T00:00:01.000Z",
          }),
        );
      });
      await flush();
    }
    expect(captured.setContentCalls).toBe(applyCount);
    expect(getEditorMarkdown(captured.editor!)).toBe(CLEAN);
  });
});
