// @vitest-environment happy-dom
import { docToNfm, nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode, NodeType } from "@tiptap/pm/model";
import { prosemirrorToYDoc } from "@tiptap/y-tiptap";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

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

const editors: Editor[] = [];

/** Two tabs on one page. Lower client IDs come first among inserts at one place. */
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
  return [open(1), open(2)] as const;
}

type Tab = ReturnType<typeof twoTabs>[number];

/** Lets the tabs exchange changes and put right what they find, until they settle. */
async function settle(a: Tab, b: Tab) {
  for (let round = 0; round < 4; round += 1) {
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
    Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
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

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
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

    for (const tab of [a, b]) {
      const lines = outline(tab.editor);
      expect(lines[0]).toBe("notionToggleSummary: Plan");
      expect(lines).toContain("paragraph: Plan B");
      expect(lines).toContain("paragraph: Body");
    }
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

    // Each tab rewrites the line when it moves the title, so the line can
    // come out twice. That's the price of this rare race: nothing is lost.
    const lines = outline(a.editor);
    expect(outline(b.editor)).toEqual(lines);
    expect(lines[0]).toBe("notionToggleSummary: Plan");
    expect(lines).toContain("paragraph: Above");
    expect(lines).toContain("paragraph: Body");
    expect(
      lines.filter((line) => line.startsWith("notionToggleSummary")),
    ).toEqual(["notionToggleSummary: Plan"]);
  });

  it("leaves the page alone for someone who can only read it", async () => {
    const [a, b] = twoTabs(OLD_TOGGLE);
    b.editor.setEditable(false);
    giveTitle(a.editor, "Plan");
    giveTitle(b.editor, "Plan");
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
    const before = Y.encodeStateVector(b.ydoc);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(Y.encodeStateVector(b.ydoc)).toEqual(before);
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
