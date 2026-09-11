// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import type { RefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

import { runEditorPaste, type EditorPasteArgs } from "./editor-paste";

const FIGMA_HTML =
  '<meta charset="utf-8"><!--(figmeta)ZXhhbXBsZQ==(/figmeta)--><!--(figma)ZXhhbXBsZQ==(/figma)-->';

function ref<T>(current: T): RefObject<T> {
  return { current } as RefObject<T>;
}

interface Harness {
  args: EditorPasteArgs;
  imported: string[];
  pasted: number;
}

function harness(): Harness {
  const imported: string[] = [];
  const state = { pasted: 0 };
  return {
    imported,
    get pasted() {
      return state.pasted;
    },
    args: {
      adoptDesignClipboardPayload: () => {},
      canEditDesign: true,
      handlePasteSelection: async () => {
        state.pasted += 1;
      },
      handlePastedImageFiles: () => false,
      hasCanvasClipboard: false,
      importFigmaClipboardIntoDesign: async (content) => {
        imported.push(content);
      },
      lastWrittenClipboardMarkerRef: ref<string | null>(null),
      lastWrittenClipboardPlainTextRef: ref<string | null>(null),
      t: (key) => key,
    },
  };
}

function pasteEvent(
  values: Record<string, string>,
  target: EventTarget | null = document.body,
  items: DataTransferItem[] = [],
) {
  let defaultPrevented = false;
  return {
    get defaultPrevented() {
      return defaultPrevented;
    },
    preventDefault() {
      defaultPrevented = true;
    },
    target,
    clipboardData: {
      items,
      getData: (type: string) => values[type] ?? "",
    },
  } as unknown as ClipboardEvent;
}

beforeEach(() => {
  toastError.mockClear();
  document.body.innerHTML = "";
});

describe("runEditorPaste", () => {
  it("imports a Figma paste made while the agent composer holds focus", () => {
    const composer = document.createElement("div");
    composer.setAttribute("contenteditable", "true");
    document.body.append(composer);

    const h = harness();
    const event = pasteEvent({ "text/html": FIGMA_HTML }, composer);
    runEditorPaste(h.args, event);

    expect(h.imported).toEqual([FIGMA_HTML]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("imports a Figma paste made while a panel textarea holds focus", () => {
    const textarea = document.createElement("textarea");
    document.body.append(textarea);

    const h = harness();
    runEditorPaste(h.args, pasteEvent({ "text/plain": FIGMA_HTML }, textarea));

    expect(h.imported).toEqual([FIGMA_HTML]);
  });

  it("still leaves ordinary text pastes to the focused field", () => {
    const input = document.createElement("input");
    document.body.append(input);

    const h = harness();
    const event = pasteEvent({ "text/plain": "hello" }, input);
    runEditorPaste(h.args, event);

    expect(h.imported).toEqual([]);
    expect(h.pasted).toBe(0);
    expect(toastError).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("routes image files to the immediate image insertion path", () => {
    const file = new File(["image"], "pasted.png", { type: "image/png" });
    const handlePastedImageFiles = vi.fn(() => true);
    const h = harness();
    h.args.handlePastedImageFiles = handlePastedImageFiles;
    const event = pasteEvent({}, document.body, [
      {
        kind: "file",
        type: "image/png",
        getAsFile: () => file,
      } as unknown as DataTransferItem,
    ]);

    runEditorPaste(h.args, event);

    expect(handlePastedImageFiles).toHaveBeenCalledWith([file]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("says why a Figma link paste produced no screen", () => {
    const h = harness();
    runEditorPaste(
      h.args,
      pasteEvent({
        "text/plain":
          "https://www.figma.com/design/AbCdEf123456/Marketing?node-id=12-34",
      }),
    );

    expect(h.imported).toEqual([]);
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.import.errors.figmaPasteFailed",
      { description: "designEditor.import.figmaPasteUnreadable" },
    );
  });

  it("keeps a plain non-Figma canvas paste silent", () => {
    const h = harness();
    runEditorPaste(h.args, pasteEvent({ "text/plain": "just some text" }));

    expect(toastError).not.toHaveBeenCalled();
  });
});

describe("the editor paste listener gate", () => {
  const editorSource = readFileSync("app/pages/DesignEditor.tsx", "utf8");

  it("stays attached when embedded and during the question flow", () => {
    const effect = editorSource.slice(
      editorSource.indexOf('document.addEventListener("paste"') - 400,
      editorSource.indexOf('document.removeEventListener("paste"'),
    );
    expect(effect).toContain("if (hostOwnsChrome) return;");
    expect(effect).not.toContain("embedded ||");
    expect(effect).not.toContain("pendingQuestions");
  });
});
