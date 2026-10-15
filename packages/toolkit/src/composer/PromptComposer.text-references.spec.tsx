// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromptComposer, type PromptComposerProps } from "./PromptComposer.js";
import type {
  ComposerTextReference,
  TiptapComposerHandle,
} from "./TiptapComposer.js";
import type { Reference } from "./types.js";

let container: HTMLDivElement;
let root: Root;
let composerRef: React.RefObject<TiptapComposerHandle | null>;
let reported: Reference[];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  composerRef = React.createRef<TiptapComposerHandle>();
  reported = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function person(start: number, end: number, email: string, label: string) {
  return {
    start,
    end,
    reference: { label, source: "test", refType: "person", refId: email },
  } satisfies ComposerTextReference;
}

async function render(props: Partial<PromptComposerProps> = {}) {
  await act(async () => {
    root.render(
      <PromptComposer
        composerRef={composerRef}
        onSubmit={vi.fn()}
        onReferencesChange={(references) => (reported = references)}
        showModelSelector={false}
        modelStatusChecksEnabled={false}
        includeDefaultMentionSearch={false}
        includeDefaultSlashSkills={false}
        voiceEnabled={false}
        {...props}
      />,
    );
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

/** Each line, with every chip written as [refId]. */
function lines() {
  return [...container.querySelectorAll(".ProseMirror > p")].map((line) =>
    [...line.childNodes]
      .map((node) => {
        const chip =
          node instanceof Element
            ? (node.closest("[data-mention-ref-id]") ??
              node.querySelector("[data-mention-ref-id]"))
            : null;
        return chip
          ? `[${chip.getAttribute("data-mention-ref-id")}]`
          : node.textContent;
      })
      .join(""),
  );
}

describe("composer text with chips", () => {
  it("seeds the initial text with each chip in place of its range", async () => {
    await render({
      initialText: "@Sam Lee and @Sam Lee, thanks",
      initialTextKey: "seeded",
      initialReferences: [
        person(0, 8, "b@example.test", "Sam Lee"),
        person(13, 21, "a@example.test", "Sam Lee"),
      ],
    });

    expect(lines()).toEqual(["[b@example.test] and [a@example.test], thanks"]);
    expect(reported.map((reference) => reference.refId)).toEqual([
      "b@example.test",
      "a@example.test",
    ]);
  });

  it("replaces the draft with chips across lines, leaving an overlapping range as text and a space after a final chip", async () => {
    await render({ initialText: "Old draft", initialTextKey: "old" });

    await act(async () =>
      composerRef.current!.setText("Hi @Ana\n@Bo and @Cy", [
        person(3, 7, "ana@example.test", "Ana"),
        person(16, 19, "cy@example.test", "Cy"),
        person(8, 11, "bo@example.test", "Bo"),
        person(9, 12, "overlap@example.test", "o a"),
      ]),
    );

    expect(lines()).toEqual([
      "Hi [ana@example.test]",
      "[bo@example.test] and [cy@example.test] ",
    ]);
    expect(reported.map((reference) => reference.refId)).toEqual([
      "ana@example.test",
      "bo@example.test",
      "cy@example.test",
    ]);
  });

  it("reports each chip as its own @name, apart from the words beside it", async () => {
    let text = "";
    await render({ onTextChange: (next) => (text = next) });

    await act(async () =>
      composerRef.current!.setText("word@Sam@Bo and @Cyx", [
        person(4, 8, "sam@example.test", "Sam"),
        person(8, 11, "bo@example.test", "Bo"),
        person(16, 19, "cy@example.test", "Cy"),
      ]),
    );

    expect(lines()).toEqual([
      "word[sam@example.test][bo@example.test] and [cy@example.test]x",
    ]);
    expect(text).toBe("word @Sam @Bo and @Cy x");
  });

  it("spaces a chip from a combining mark and a letter past U+FFFF", async () => {
    let text = "";
    await render({ onTextChange: (next) => (text = next) });

    await act(async () =>
      composerRef.current!.setText("José@Sam\u{10400}", [
        person(5, 9, "sam@example.test", "Sam"),
      ]),
    );

    expect(text).toBe("José @Sam \u{10400}");
  });
});

describe("inserting @ at the cursor", () => {
  afterEach(() => {
    delete (document as { execCommand?: unknown }).execCommand;
  });

  it("filters and picks a mention without touching the text before the @", async () => {
    await render({
      initialText: "Ping",
      initialTextKey: "ping",
      mentionItems: [
        {
          id: "person:sam",
          label: "Sam Lee",
          source: "test",
          refType: "person",
          refId: "sam@example.test",
        },
      ],
    });
    const editor = () =>
      (
        container.querySelector(".ProseMirror") as HTMLElement & {
          editor: { commands: { insertContent(text: string): boolean } };
        }
      ).editor;
    // A browser applies execCommand's edit to the DOM, and ProseMirror only
    // reads it back after the call returns.
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: (_command: string, _showUi: boolean, text: string) => {
        queueMicrotask(() => editor().commands.insertContent(text));
        return true;
      },
    });

    await act(async () => composerRef.current!.insertTextAtCursor!(" "));
    await act(async () => composerRef.current!.insertTextAtCursor!("@"));
    await act(async () => void editor().commands.insertContent("Sa"));
    const option = [
      ...document.querySelectorAll<HTMLElement>("[data-mention-index]"),
    ].find((item) => item.textContent?.includes("Sam Lee"));
    expect(option).toBeDefined();
    await act(async () => option!.click());

    expect(lines()).toEqual(["Ping [sam@example.test] "]);
  });
});
