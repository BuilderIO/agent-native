// @vitest-environment happy-dom

import { nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { prosemirrorToYDoc } from "@tiptap/y-tiptap";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createVisualEditorExtensions } from "../VisualEditor";
import type { LinkCardPasteContext } from "./link-card-paste";
import { linkCardFromPaste } from "./link-card-paste";

const DESIGN = "https://design.example.test/design/launch_1";
const SLIDES = "https://slides.example.test/deck/deck-1-abc";
const CLIPS = "https://clips.example.test/share/rec_1";

let editor: Editor | null = null;
let context: LinkCardPasteContext;

function open(nfm: string, options: { live?: boolean } = {}) {
  if (!options.live) {
    editor = new Editor({
      extensions: createVisualEditorExtensions({
        documentId: "doc_1",
        linkCardPaste: () => context,
      }),
      content: nfmToDoc(nfm),
    });
    return editor;
  }
  const seed = new Editor({
    extensions: createVisualEditorExtensions({ documentId: "doc_1" }),
    content: nfmToDoc(nfm),
  });
  const ydoc = prosemirrorToYDoc(seed.state.doc, "default");
  seed.destroy();
  editor = new Editor({
    extensions: createVisualEditorExtensions({
      documentId: "doc_1",
      linkCardPaste: () => context,
      ydoc,
    }),
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  return editor;
}

function newLine(target: Editor) {
  target.commands.setTextSelection(target.state.doc.content.size - 1);
  target.commands.splitBlock();
}

function paste(target: Editor, text: string, html = "") {
  const event = {
    clipboardData: {
      getData: (type: string) =>
        type === "text/plain" ? text : type === "text/html" ? html : "",
      files: [],
      types: html ? ["text/plain", "text/html"] : ["text/plain"],
    },
    preventDefault: () => undefined,
  } as unknown as ClipboardEvent;
  target.view.pasteText(text, event);
}

function blocks(target: Editor) {
  const found: Array<{ type: string; text: string; raw?: string }> = [];
  target.state.doc.forEach((node) => {
    found.push({
      type:
        node.type.name === "registryBlock"
          ? `registryBlock:${node.attrs.blockType}`
          : node.type.name,
      text: node.textContent,
      ...(node.type.name === "registryBlock" ? { raw: node.attrs.__raw } : {}),
    });
  });
  return found;
}

function settle() {
  vi.runAllTimers();
}

function caretAtEnd(target: Editor) {
  target.commands.setTextSelection(target.state.doc.content.size - 1);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  context = {
    canEdit: true,
    appUrls: {
      design: ["https://design.example.test"],
      slides: ["https://slides.example.test"],
      clips: ["https://clips.example.test"],
    },
  };
});

afterEach(() => {
  editor?.destroy();
  editor = null;
  vi.useRealTimers();
});

describe("linkCardFromPaste", () => {
  it("names the app of exactly one item link", () => {
    expect(linkCardFromPaste(` ${DESIGN} `, context.appUrls)).toEqual({
      app: "design",
      url: DESIGN,
    });
    expect(linkCardFromPaste(SLIDES, context.appUrls)?.app).toBe("slides");
    expect(linkCardFromPaste(CLIPS, context.appUrls)?.app).toBe("clips");
  });

  it("leaves other links, app pages, and text with a link alone", () => {
    for (const text of [
      "https://example.test/design/launch_1",
      "https://design.example.test/templates",
      `See ${DESIGN}`,
      `${DESIGN} ${SLIDES}`,
    ]) {
      expect(linkCardFromPaste(text, context.appUrls)).toBeNull();
    }
  });

  it("leaves a link that carries a token or key as the plain link it is", () => {
    for (const link of [
      `${CLIPS}?agent_access=fake`,
      `${CLIPS}?t=90&agent_access=fake`,
      `${SLIDES}#token=fake`,
      `${CLIPS}?t=${"x".repeat(64)}`,
    ]) {
      expect(linkCardFromPaste(link, context.appUrls)).toBeNull();
    }
    expect(linkCardFromPaste(`${CLIPS}?t=90`, context.appUrls)?.url).toBe(
      `${CLIPS}?t=90`,
    );
  });

  it("leaves a link to one Design screen to the pinned screen paste", () => {
    expect(
      linkCardFromPaste(`${DESIGN}?screen=pay`, context.appUrls),
    ).toBeNull();
    expect(linkCardFromPaste(DESIGN, context.appUrls)?.app).toBe("design");
  });
});

describe("pasting a Design, Slides or Clips link", () => {
  it.each([
    ["design", DESIGN],
    ["slides", SLIDES],
    ["clips", CLIPS],
  ])(
    "turns a %s link alone on its line into a card that stores only the link",
    async (app, link) => {
      const target = open("Intro");
      newLine(target);
      paste(target, link);
      settle();
      const found = blocks(target);
      expect(found.slice(0, 2).map((block) => block.type)).toEqual([
        "paragraph",
        "registryBlock:link-card",
      ]);
      expect(found.some((block) => block.text.includes(link))).toBe(false);
      const raw = found[1]?.raw ?? "";
      expect(raw).toContain(`app="${app}"`);
      expect(raw).toContain(link);
      expect(raw).not.toMatch(/title=/);
    },
  );

  it("keeps a Clips agent link alone on its line as a plain link", async () => {
    const link = `${CLIPS}?agent_access=fake`;
    const target = open("Intro");
    newLine(target);
    paste(target, link);
    settle();
    expect(blocks(target)).toEqual([
      { type: "paragraph", text: "Intro" },
      { type: "paragraph", text: link },
    ]);
  });

  it("keeps a link pasted inside a sentence as a link", async () => {
    const target = open("See the design here: ");
    caretAtEnd(target);
    paste(target, DESIGN);
    settle();
    expect(blocks(target)).toEqual([
      { type: "paragraph", text: `See the design here: ${DESIGN}` },
    ]);
  });

  it("keeps a link pasted beside a line break as a link", async () => {
    const target = open("Intro");
    newLine(target);
    target.commands.setHardBreak();
    paste(target, DESIGN);
    settle();
    expect(blocks(target).map((block) => block.type)).toEqual([
      "paragraph",
      "paragraph",
    ]);
    let breaks = 0;
    target.state.doc.descendants((node) => {
      if (node.type.name === "hardBreak") breaks += 1;
    });
    expect(breaks).toBe(1);
    expect(target.state.doc.textContent).toContain(DESIGN);
  });

  it("turns the card back into the link on undo right after", async () => {
    const target = open("Intro");
    newLine(target);
    paste(target, DESIGN);
    settle();
    expect(blocks(target)[1]?.type).toBe("registryBlock:link-card");
    target.commands.undo();
    expect(blocks(target)).toEqual([
      { type: "paragraph", text: "Intro" },
      { type: "paragraph", text: DESIGN },
    ]);
  });

  it("turns the card back into the link on undo in a live page", async () => {
    const target = open("Intro", { live: true });
    newLine(target);
    paste(target, DESIGN);
    settle();
    expect(blocks(target).map((block) => block.type)).toContain(
      "registryBlock:link-card",
    );
    target.commands.undo();
    expect(blocks(target)).toEqual([
      { type: "paragraph", text: "Intro" },
      { type: "paragraph", text: DESIGN },
    ]);
  });

  it("keeps the plain link for readers and while suggesting", async () => {
    context = { ...context, canEdit: false };
    const target = open("Intro");
    newLine(target);
    paste(target, DESIGN);
    settle();
    expect(blocks(target)).toEqual([
      { type: "paragraph", text: "Intro" },
      { type: "paragraph", text: DESIGN },
    ]);
  });

  it("leaves a copied card's own paste to the card", async () => {
    const target = open("Intro");
    newLine(target);
    paste(target, DESIGN, '<div data-content-block="link-card"></div>');
    settle();
    expect(
      blocks(target).some((block) => block.type === "registryBlock:link-card"),
    ).toBe(false);
  });
});
