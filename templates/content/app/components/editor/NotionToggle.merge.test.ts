// @vitest-environment happy-dom
import { docToNfm, nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode, NodeType } from "@tiptap/pm/model";
import { prosemirrorToYDoc } from "@tiptap/y-tiptap";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  STRAY_TITLE_REPAIR_DELAY_MS,
  STRAY_TITLE_REPAIR_SPREAD_MS,
} from "./extensions/NotionExtensions";
import { createVisualEditorExtensions } from "./VisualEditor";

// Tabs editing at once merge into shapes neither of them made. y-tiptap
// deletes a node the schema refuses, in every tab, with everything in it, so
// each of these stories used to lose the whole Toggle.

const OLD_TOGGLE = [
  "<details>",
  "<summary>Plan</summary>",
  "\tBody",
  "</details>",
  "",
  "After",
].join("\n");

const LONGEST_REPAIR_WAIT =
  STRAY_TITLE_REPAIR_DELAY_MS + STRAY_TITLE_REPAIR_SPREAD_MS;

const editors: Editor[] = [];

/**
 * Two tabs on one page, waiting a second apart before they repair a title.
 * Lower client IDs come first among inserts at one place.
 */
function twoTabs(markdown: string) {
  const seed = new Editor({
    extensions: createVisualEditorExtensions(),
    content: nfmToDoc(markdown),
  });
  const update = Y.encodeStateAsUpdate(
    prosemirrorToYDoc(seed.state.doc, "default"),
  );
  seed.destroy();
  const open = (clientID: number) => {
    const ydoc = new Y.Doc();
    ydoc.clientID = clientID;
    Y.applyUpdate(ydoc, update);
    const editor = new Editor({
      extensions: createVisualEditorExtensions({ ydoc }),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    editors.push(editor);
    return { editor, ydoc };
  };
  return [open(1000), open(2000)] as const;
}

type Tab = ReturnType<typeof twoTabs>[number];

function exchange(a: Tab, b: Tab) {
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc));
}

/** Lets the tabs exchange changes and put right what they find, until they settle. */
async function settle(a: Tab, b: Tab) {
  const step = 100;
  for (let waited = 0; waited < 3 * LONGEST_REPAIR_WAIT; waited += step) {
    exchange(a, b);
    await vi.advanceTimersByTimeAsync(step);
  }
  exchange(a, b);
}

function giveTitle(editor: Editor, text: string) {
  const toggle = editor.state.doc.firstChild as ProseMirrorNode;
  const title = editor.schema.nodes.notionToggleSummary as NodeType;
  const tr = editor.state.tr.setNodeMarkup(0, undefined, {
    ...toggle.attrs,
    summary: "",
  });
  tr.insert(1, title.create(null, editor.schema.text(text)));
  editor.view.dispatch(tr);
}

function outline(editor: Editor) {
  const lines: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.isTextblock) lines.push(`${node.type.name}: ${node.textContent}`);
    return !node.isTextblock;
  });
  return lines;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.useRealTimers();
});

describe("tabs that merge into a Toggle with a title out of place", () => {
  it("keeps one title and the body when two tabs title an old Toggle at once", async () => {
    const [a, b] = twoTabs(OLD_TOGGLE);
    giveTitle(a.editor, "Plan");
    giveTitle(b.editor, "Plan");
    await settle(a, b);

    const expected = [
      "notionToggleSummary: Plan",
      "paragraph: Body",
      "paragraph: After",
    ];
    expect(outline(a.editor)).toEqual(expected);
    expect(outline(b.editor)).toEqual(expected);
  });

  it("keeps what a tab typed in a title the other tab's replaced", async () => {
    const [a, b] = twoTabs(OLD_TOGGLE);
    giveTitle(a.editor, "Plan");
    giveTitle(b.editor, "Plan B");
    await settle(a, b);

    const expected = [
      "notionToggleSummary: Plan",
      "paragraph: Plan B",
      "paragraph: Body",
      "paragraph: After",
    ];
    expect(outline(a.editor)).toEqual(expected);
    expect(outline(b.editor)).toEqual(expected);
  });

  it("keeps what both tabs typed when they repair the same title at once", async () => {
    const [a, b] = twoTabs(OLD_TOGGLE);
    giveTitle(a.editor, "Plan");
    giveTitle(b.editor, "Plan B");
    exchange(a, b);
    // Neither tab hears from the other until both have repaired.
    await vi.advanceTimersByTimeAsync(LONGEST_REPAIR_WAIT);
    await settle(a, b);

    // The line comes out twice, which nobody can prevent from separate tabs.
    // Nothing is lost, and both tabs show the same page.
    const lines = outline(a.editor);
    expect(outline(b.editor)).toEqual(lines);
    expect(lines[0]).toBe("notionToggleSummary: Plan");
    expect(lines).toContain("paragraph: Plan B");
    expect(lines).toContain("paragraph: Body");
  });

  it("moves a title up when another tab added a line above it", async () => {
    const [a, b] = twoTabs(OLD_TOGGLE);
    const paragraph = a.editor.schema.nodes.paragraph as NodeType;
    a.editor.view.dispatch(
      a.editor.state.tr.insert(
        1,
        paragraph.create(null, a.editor.schema.text("Above")),
      ),
    );
    giveTitle(b.editor, "Plan");
    await settle(a, b);

    const expected = [
      "notionToggleSummary: Plan",
      "paragraph: Above",
      "paragraph: Body",
      "paragraph: After",
    ];
    expect(outline(a.editor)).toEqual(expected);
    expect(outline(b.editor)).toEqual(expected);
  });

  it("keeps what's typed in a title while another tab waits to move it", async () => {
    const [a, b] = twoTabs(OLD_TOGGLE);
    const paragraph = a.editor.schema.nodes.paragraph as NodeType;
    a.editor.view.dispatch(
      a.editor.state.tr.insert(
        1,
        paragraph.create(null, a.editor.schema.text("Above")),
      ),
    );
    giveTitle(b.editor, "Plan");
    Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc));
    await vi.advanceTimersByTimeAsync(10);
    b.editor.view.dispatch(b.editor.state.tr.insertText("!", 6));
    await settle(a, b);

    const lines = outline(a.editor);
    expect(outline(b.editor)).toEqual(lines);
    expect(lines[0]).toBe("notionToggleSummary: Plan!");
    expect(lines).toContain("paragraph: Above");
    expect(lines).toContain("paragraph: Body");
  });

  it("leaves the page alone for someone who can only read it", async () => {
    const [a, b] = twoTabs(OLD_TOGGLE);
    b.editor.setEditable(false);
    giveTitle(a.editor, "Plan");
    giveTitle(b.editor, "Plan");
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
    const before = Y.encodeStateVector(b.ydoc);
    await vi.advanceTimersByTimeAsync(LONGEST_REPAIR_WAIT);

    expect(Y.encodeStateVector(b.ydoc)).toEqual(before);
  });

  it("keeps a second title that holds only an inline atom", async () => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "notionToggle",
            content: [
              {
                type: "notionToggleSummary",
                content: [{ type: "text", text: "Plan" }],
              },
              {
                type: "notionToggleSummary",
                content: [
                  { type: "notionInlineAtom", attrs: { label: "x^2" } },
                ],
              },
            ],
          },
        ],
      },
    });
    editors.push(editor);
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: "paragraph",
      content: [{ type: "text", text: "After" }],
    });
    await vi.advanceTimersByTimeAsync(LONGEST_REPAIR_WAIT);

    const toggle = editor.state.doc.firstChild as ProseMirrorNode;
    expect(toggle.childCount).toBe(2);
    expect(toggle.child(1).type.name).toBe("paragraph");
    expect(toggle.child(1).firstChild?.type.name).toBe("notionInlineAtom");
  });

  it("saves a title out of place as a line of text", () => {
    const markdown = docToNfm({
      type: "doc",
      content: [
        {
          type: "notionToggle",
          content: [
            {
              type: "notionToggleSummary",
              content: [{ type: "text", text: "Plan" }],
            },
            {
              type: "notionToggleSummary",
              content: [{ type: "text", text: "Second" }],
            },
          ],
        },
      ],
    });

    expect(markdown).toContain("<summary>Plan</summary>");
    expect(markdown).toContain("Second");
  });
});
