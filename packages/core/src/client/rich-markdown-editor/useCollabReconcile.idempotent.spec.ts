// @vitest-environment happy-dom

import { useEditor, type Editor } from "@tiptap/react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRichMarkdownExtensions } from "./RichMarkdownEditor.js";
import { useCollabReconcile, getEditorMarkdown } from "./useCollabReconcile.js";

/**
 * Regression for the collab-reconcile escalation loop.
 *
 * When a block's stored markdown is NOT idempotent through the editor's
 * parse/serialize (e.g. raw HTML in a GFM block: `<h1>...</h1>` serializes to
 * the escaped `&lt;h1&gt;...`), the reconcile used to re-`setContent` the value
 * every poll because the raw `value` never equalled the editor's serialized
 * output. Each re-apply re-parsed already-applied content, the autosave echo
 * came back as a "new" value, and the doc kept mutating (`<p>` → `&lt;p&gt;` →
 * `&amp;lt;p&amp;gt;` …) while also fighting active typing.
 *
 * The fix makes the reconcile compare by DOC EQUIVALENCE: it tracks the raw
 * value it last applied AND the editor's serialized output after that apply, so
 * a re-supplied raw value or its own serialized echo is recognized and skipped.
 * These tests drive the REAL hook + a REAL editor across simulated polls and
 * assert the reconcile applies a non-idempotent value AT MOST ONCE and the
 * editor stabilizes (no repeated emit / mutation).
 */

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
  /** Every markdown string the editor emitted via onUpdate (autosave echoes). */
  emitted: string[];
  /** How many times the reconcile/seed called setContent. */
  setContentCalls: number;
}

/**
 * Mirrors the real SharedRichEditor wiring: an `onUpdate` that defers to the
 * hook's guards (so programmatic setContent is ignored and only genuine edits
 * "autosave"), and a `setContent` override that counts applies. Non-collab path
 * (no ydoc) — the escalation reproduces there and keeps the harness simple.
 */
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
      // Mirror the hook's (fixed) defaultSetContent: hand the markdown string to
      // tiptap-markdown's setContent override WITHOUT
      // `parseOptions.preserveWhitespace`, which would otherwise route through
      // insertContentAt's double-parse and escape the markdown. Counts applies.
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

/** Flush the reconcile's queueMicrotask + any chained promises. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const NON_IDEMPOTENT =
  '<h1>Title</h1><ul class="contains-task-list"><li>One</li></ul>';

describe("useCollabReconcile idempotent-safe reconcile", () => {
  it("applies a NON-idempotent value at most once across many polls and stabilizes", async () => {
    const { captured, Harness } = makeHarness();

    // Initial mount: editor seeded empty, first poll delivers the raw HTML.
    act(() => {
      root.render(
        React.createElement(Harness, {
          value: "",
          contentUpdatedAt: "2024-01-01T00:00:00.000Z",
        }),
      );
    });
    await flush();

    // First real value arrives.
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
    // The non-idempotent value escapes on apply, so the serialized form differs
    // from the raw input — that divergence is exactly what used to loop.
    expect(serializedAfterApply).not.toBe(NON_IDEMPOTENT);
    const applyCountAfterFirst = captured.setContentCalls;
    expect(applyCountAfterFirst).toBeGreaterThanOrEqual(1);

    // Simulate the poll loop RE-SUPPLYING the SAME raw value many times (a
    // source-sync / lagging poll that keeps handing back the stored HTML).
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

    // It must NOT keep re-applying — the doc-equivalence guard recognizes the
    // re-supplied raw value as already-applied.
    expect(captured.setContentCalls).toBe(applyCountAfterFirst);
    // And the editor's serialized output is stable (did not escalate).
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

    // Autosave persists the editor's SERIALIZED output, bumping updatedAt; the
    // next poll hands that serialized echo back as the new authoritative value.
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

    // The echo is doc-equivalent to what the editor already shows -> no re-apply
    // and no escalation.
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

    // A real, different agent edit (clean idempotent markdown) with a newer
    // timestamp must still reconcile in.
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
    // Idempotent + unchanged -> the existing equality guard already skips.
    expect(captured.setContentCalls).toBe(applyCount);
    expect(getEditorMarkdown(captured.editor!)).toBe(CLEAN);
  });
});
