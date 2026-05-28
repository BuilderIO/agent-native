// @vitest-environment happy-dom

import { Editor, getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import {
  VISUAL_INDENT,
  parseNfmForEditor,
  serializeEditorToNfm,
} from "@shared/notion-markdown";
import {
  createVisualEditorExtensions,
  EmptyLineParagraph,
  uploadAndInsertAudioFiles,
  uploadAndInsertImageFiles,
  uploadAndInsertVideoFiles,
  shouldApplyExternalContentSync,
  shouldSeedCollaborativeContent,
} from "./VisualEditor";
import { CodeBlock } from "./extensions/CodeBlockNode";
import { NotionToggle } from "./extensions/NotionExtensions";

function createMarkdownEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        paragraph: false,
      }),
      CodeBlock,
      EmptyLineParagraph,
      NotionToggle,
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: parseNfmForEditor(content),
  });
}

function createFullEditor(content = "") {
  return new Editor({
    extensions: createVisualEditorExtensions(),
    content: content
      ? parseNfmForEditor(content)
      : { type: "doc", content: [{ type: "paragraph" }] },
  });
}

function triggerTextInput(editor: Editor, text: string) {
  const { from, to } = editor.state.selection;
  let handled = false;

  editor.view.someProp("handleTextInput", (handler: any) => {
    if (handled) return true;
    handled = handler(editor.view, from, to, text) === true;
    return handled;
  });

  if (!handled) {
    insertPlainText(editor, text);
  }

  return handled;
}

function triggerKeyDown(editor: Editor, key: string) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  let handled = false;

  editor.view.someProp("handleKeyDown", (handler: any) => {
    if (handled) return true;
    handled = handler(editor.view, event) === true;
    return handled;
  });

  return handled;
}

function insertPlainText(editor: Editor, text: string) {
  const { from, to } = editor.state.selection;
  editor.view.dispatch(editor.state.tr.insertText(text, from, to));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VisualEditor markdown round-tripping", () => {
  it("preserves intentional empty paragraphs through the real TipTap serializer", () => {
    const editor = createMarkdownEditor("A\n<empty-block/>\n<empty-block/>\nB");

    try {
      const markdown = (editor.storage as any).markdown.getMarkdown();
      const stored = serializeEditorToNfm(markdown);
      expect(stored).toBe("A\n<empty-block/>\n<empty-block/>\nB");
    } finally {
      editor.destroy();
    }
  });

  it("does not parse Notion-pulled indented bullets as a code block", () => {
    const editor = createMarkdownEditor(
      [
        "michael onboarding",
        "\t- notion doc",
        "\t- access: amplitude, fullstory, sigma, jira",
      ].join("\n"),
    );

    try {
      const json = editor.getJSON();
      expect(JSON.stringify(json)).not.toContain('"codeBlock"');
      expect(JSON.stringify(json)).toContain('"bulletList"');
    } finally {
      editor.destroy();
    }
  });

  it("renders markdown table header cells as plain table cells", () => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "A" }],
                      },
                    ],
                  },
                  {
                    type: "tableHeader",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "B" }],
                      },
                    ],
                  },
                ],
              },
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "1" }],
                      },
                    ],
                  },
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "2" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    try {
      expect(editor.view.dom.querySelectorAll("th")).toHaveLength(0);
      expect(editor.view.dom.querySelectorAll("td")).toHaveLength(4);
    } finally {
      editor.destroy();
    }
  });

  it("normalizes table header cells to the first row and first column only", async () => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    content: [{ type: "paragraph" }],
                  },
                  {
                    type: "tableHeader",
                    content: [{ type: "paragraph" }],
                  },
                ],
              },
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    content: [{ type: "paragraph" }],
                  },
                  {
                    type: "tableHeader",
                    content: [{ type: "paragraph" }],
                  },
                ],
              },
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    content: [{ type: "paragraph" }],
                  },
                  {
                    type: "tableCell",
                    content: [{ type: "paragraph" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 0));

      const table = editor.getJSON().content?.[0] as any;
      const rows = table?.content ?? [];
      expect(rows[0].content?.map((cell) => cell.type)).toEqual([
        "tableHeader",
        "tableHeader",
      ]);
      expect(rows[1].content?.map((cell) => cell.type)).toEqual([
        "tableHeader",
        "tableCell",
      ]);
      expect(rows[2].content?.map((cell) => cell.type)).toEqual([
        "tableHeader",
        "tableCell",
      ]);
      expect(
        editor.view.dom.querySelectorAll(".notion-table-header-cell"),
      ).toHaveLength(4);
    } finally {
      editor.destroy();
    }
  });

  it("renders Notion-pulled plain indents as visual indentation, not blockquotes", () => {
    const editor = createMarkdownEditor(
      ["Deck", "\tpublish vs Fusion discussion topic"].join("\n"),
    );

    try {
      const json = editor.getJSON();
      expect(JSON.stringify(json)).not.toContain('"blockquote"');
      expect(JSON.stringify(json)).toContain(
        `${VISUAL_INDENT}publish vs Fusion discussion topic`,
      );
    } finally {
      editor.destroy();
    }
  });

  it("preserves toggles, bullets, dividers, and following paragraphs", () => {
    const editor = createMarkdownEditor(
      [
        "NOW",
        "",
        "→ brent/josh needs",
        "",
        "→ → work for Milos and Nicholas - make clip",
        "",
        "<details>",
        "<summary>→ → team mtg guidance on hackathon</summary>",
        "</details>",
        "",
        "Let people test creating apps, creating agents, editing apps",
        "",
        "- Make sure works",
        "- Give some docs and guidance",
        '- Get some people testing tmrw (post in general "for brave souls")',
        "- Make sure the agent is good at telling you what makes sense and doesn't",
        "",
        "---",
        "",
        "make sure everyone has access to dispatch",
      ].join("\n"),
    );

    try {
      const json = editor.getJSON();
      const markdown = (editor.storage as any).markdown.getMarkdown();
      const stored = serializeEditorToNfm(markdown);

      expect(JSON.stringify(json)).toContain('"notionToggle"');
      expect(JSON.stringify(json)).toContain('"bulletList"');
      expect(JSON.stringify(json)).toContain('"horizontalRule"');
      expect(stored).toContain("<details>");
      expect(stored).toContain(
        "<summary>→ → team mtg guidance on hackathon</summary>",
      );
      expect(stored).toContain("</details>");
      expect(stored).toContain("- Make sure works");
      expect(stored).toContain("---\n\nmake sure everyone has access");
    } finally {
      editor.destroy();
    }
  });

  it("renders indented Notion toggle blocks as toggles instead of code", () => {
    const editor = createMarkdownEditor(
      [
        "Skill functionality",
        "\t<details>",
        "\t<summary>agents doing</summary>",
        "\t</details>",
        "Framework share skills across apps",
      ].join("\n"),
    );

    try {
      const json = editor.getJSON();
      const serializedJson = JSON.stringify(json);
      const markdown = (editor.storage as any).markdown.getMarkdown();
      const stored = serializeEditorToNfm(markdown);

      expect(serializedJson).toContain('"notionToggle"');
      expect(serializedJson).not.toContain('"codeBlock"');
      expect(json.content?.[1]?.attrs?.summary).toBe("agents doing");
      expect(json.content?.[1]?.attrs?.indent).toBe(1);
      expect(stored).toContain("\t<details>");
      expect(stored).toContain("\t<summary>agents doing</summary>");
      expect(stored).not.toContain("```");
    } finally {
      editor.destroy();
    }
  });

  it("serializes resized images with a persisted width attribute", () => {
    const editor = createFullEditor();

    try {
      editor
        .chain()
        .setContent({
          type: "doc",
          content: [
            {
              type: "image",
              attrs: {
                src: "https://example.com/diagram.png",
                alt: "Architecture diagram",
                width: 420,
              },
            },
          ],
        })
        .run();

      const markdown = (editor.storage as any).markdown.getMarkdown();
      expect(markdown).toContain(
        '<img src="https://example.com/diagram.png" alt="Architecture diagram" width="420" />',
      );
    } finally {
      editor.destroy();
    }
  });

  it("serializes resized videos with a persisted width attribute", () => {
    const editor = createFullEditor();

    try {
      editor
        .chain()
        .setContent({
          type: "doc",
          content: [
            {
              type: "video",
              attrs: {
                src: "https://example.com/demo.mp4",
                width: 640,
              },
            },
          ],
        })
        .run();

      const markdown = (editor.storage as any).markdown.getMarkdown();
      expect(markdown).toContain(
        '<video src="https://example.com/demo.mp4" controls width="640"></video>',
      );
    } finally {
      editor.destroy();
    }
  });

  it("serializes resized audio with a persisted width attribute", () => {
    const editor = createFullEditor();

    try {
      editor
        .chain()
        .setContent({
          type: "doc",
          content: [
            {
              type: "audio",
              attrs: {
                src: "https://example.com/demo.mp3",
                width: 420,
              },
            },
          ],
        })
        .run();

      const markdown = (editor.storage as any).markdown.getMarkdown();
      expect(markdown).toContain(
        '<audio src="https://example.com/demo.mp3" controls width="420"></audio>',
      );
    } finally {
      editor.destroy();
    }
  });

  it("optimistically inserts a pending image block before upload resolves", async () => {
    const editor = createFullEditor();
    let resolveFetch:
      | ((response: {
          ok: boolean;
          status: number;
          json: () => Promise<{ url: string }>;
        }) => void)
      | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve as typeof resolveFetch;
          }),
      ),
    );

    try {
      document.body.append(editor.view.dom);
      const file = new File(["image-bytes"], "diagram.png", {
        type: "image/png",
      });
      const uploadPromise = uploadAndInsertImageFiles(editor.view, [file], 1);

      let json = editor.getJSON();
      let imageNode = json.content?.find((node) => node.type === "image");
      expect(imageNode?.attrs?.src).toBeNull();
      expect(imageNode?.attrs?.uploadId).toMatch(/^image-upload-/);

      resolveFetch?.({
        ok: true,
        status: 201,
        json: async () => ({ url: "https://cdn.example.com/diagram.png" }),
      });
      await uploadPromise;

      json = editor.getJSON();
      imageNode = json.content?.find((node) => node.type === "image");
      expect(imageNode?.attrs?.src).toBe("https://cdn.example.com/diagram.png");
      expect(imageNode?.attrs?.uploadId).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("optimistically inserts a pending video block before upload resolves", async () => {
    const editor = createFullEditor();
    let resolveFetch:
      | ((response: {
          ok: boolean;
          status: number;
          json: () => Promise<{ url: string }>;
        }) => void)
      | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve as typeof resolveFetch;
          }),
      ),
    );

    try {
      document.body.append(editor.view.dom);
      const file = new File(["video-bytes"], "demo.mp4", {
        type: "video/mp4",
      });
      const uploadPromise = uploadAndInsertVideoFiles(editor.view, [file], 1);

      let json = editor.getJSON();
      let videoNode = json.content?.find((node) => node.type === "video");
      expect(videoNode?.attrs?.src).toBeNull();
      expect(videoNode?.attrs?.uploadId).toMatch(/^video-upload-/);

      resolveFetch?.({
        ok: true,
        status: 201,
        json: async () => ({ url: "https://cdn.example.com/demo.mp4" }),
      });
      await uploadPromise;

      json = editor.getJSON();
      videoNode = json.content?.find((node) => node.type === "video");
      expect(videoNode?.attrs?.src).toBe("https://cdn.example.com/demo.mp4");
      expect(videoNode?.attrs?.uploadId).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("optimistically inserts a pending audio block before upload resolves", async () => {
    const editor = createFullEditor();
    let resolveFetch:
      | ((response: {
          ok: boolean;
          status: number;
          json: () => Promise<{ url: string }>;
        }) => void)
      | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve as typeof resolveFetch;
          }),
      ),
    );

    try {
      document.body.append(editor.view.dom);
      const file = new File(["audio-bytes"], "demo.mp3", {
        type: "audio/mpeg",
      });
      const uploadPromise = uploadAndInsertAudioFiles(editor.view, [file], 1);

      let json = editor.getJSON();
      let audioNode = json.content?.find((node) => node.type === "audio");
      expect(audioNode?.attrs?.src).toBeNull();
      expect(audioNode?.attrs?.uploadId).toMatch(/^audio-upload-/);

      resolveFetch?.({
        ok: true,
        status: 201,
        json: async () => ({ url: "https://cdn.example.com/demo.mp3" }),
      });
      await uploadPromise;

      json = editor.getJSON();
      audioNode = json.content?.find((node) => node.type === "audio");
      expect(audioNode?.attrs?.src).toBe("https://cdn.example.com/demo.mp3");
      expect(audioNode?.attrs?.uploadId).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("creates a collaborative empty doc without recursive block filling", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const schema = getSchema(
      createVisualEditorExtensions({
        ydoc,
        localAwareness: awareness,
        user: { name: "Test User", color: "#60a5fa" },
      }),
    );

    try {
      const blockTypes = Object.values(schema.nodes)
        .filter((nodeType) => nodeType.spec.group === "block")
        .map((nodeType) => nodeType.name);

      expect(blockTypes[0]).toBe("paragraph");
      expect(schema.topNodeType.createAndFill()?.type.name).toBe("doc");
    } finally {
      awareness.destroy();
      ydoc.destroy();
    }
  });

  it("seeds saved SQL content over a semantically empty collab fragment", () => {
    expect(
      shouldSeedCollaborativeContent({
        content: "Saved body",
        currentMarkdown: "<empty-block/>",
        fragmentLength: 1,
      }),
    ).toBe(true);
    expect(
      shouldSeedCollaborativeContent({
        content: "Saved body",
        currentMarkdown: "Live body",
        fragmentLength: 1,
      }),
    ).toBe(false);
    expect(
      shouldSeedCollaborativeContent({
        content: "",
        currentMarkdown: "",
        fragmentLength: 1,
      }),
    ).toBe(false);
  });

  it("does not apply stale SQL snapshots over live collaborative edits", () => {
    expect(
      shouldApplyExternalContentSync({
        collaborationActive: true,
        hasLiveCollaborativeEdits: true,
        docChanged: false,
        content: "Older collaborator snapshot",
        lastEmittedMarkdown: "Merged live content",
        currentMarkdown: "Merged live content",
        nextMarkdown: "Older collaborator snapshot",
        editorFocused: false,
        lastTypedAt: 0,
        now: 10_000,
      }),
    ).toBe(false);
  });

  it("applies explicit external sync over live collaborative edits", () => {
    expect(
      shouldApplyExternalContentSync({
        collaborationActive: true,
        hasLiveCollaborativeEdits: true,
        docChanged: false,
        content: "Pulled from Notion",
        lastEmittedMarkdown: "Local editor state",
        currentMarkdown: "Local editor state",
        nextMarkdown: "Pulled from Notion",
        editorFocused: true,
        lastTypedAt: 9_500,
        now: 10_000,
        forceExternalContentSync: true,
      }),
    ).toBe(true);
  });

  it("still applies external content before collaborative edits begin", () => {
    expect(
      shouldApplyExternalContentSync({
        collaborationActive: true,
        hasLiveCollaborativeEdits: false,
        docChanged: false,
        content: "Pulled from Notion",
        lastEmittedMarkdown: "",
        currentMarkdown: "Saved body",
        nextMarkdown: "Pulled from Notion",
        editorFocused: false,
        lastTypedAt: 0,
        now: 10_000,
      }),
    ).toBe(true);
  });

  it("labels empty quote blocks with the quote placeholder", () => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "blockquote",
            content: [{ type: "paragraph" }],
          },
        ],
      },
    });

    try {
      editor.commands.setTextSelection(2);
      expect(
        editor.view.dom
          .querySelector("blockquote p")
          ?.getAttribute("data-placeholder"),
      ).toBe("Empty quote");
    } finally {
      editor.destroy();
    }
  });

  it("uses the Notion empty-line placeholder for focused paragraphs", () => {
    const editor = createFullEditor();

    try {
      editor.commands.setTextSelection(1);

      expect(
        editor.view.dom.querySelector("p")?.getAttribute("data-placeholder"),
      ).toBe("Press ‘space’ for AI or ‘/’ for commands");
    } finally {
      editor.destroy();
    }
  });

  it("round-trips heading 4 blocks", () => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 4 },
            content: [{ type: "text", text: "A precise subheading" }],
          },
        ],
      },
    });

    try {
      expect(editor.getJSON()).toMatchObject({
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 4 },
            content: [{ type: "text", text: "A precise subheading" }],
          },
        ],
      });
      expect(
        serializeEditorToNfm((editor.storage as any).markdown.getMarkdown()),
      ).toBe("#### A precise subheading");
    } finally {
      editor.destroy();
    }
  });

  it.each(['"', "|"])(
    "turns %s plus space into a block quote shortcut",
    (marker) => {
      const editor = createFullEditor();

      try {
        expect(triggerTextInput(editor, marker)).toBe(false);
        expect(triggerTextInput(editor, " ")).toBe(true);
        expect(editor.getJSON().content?.[0]).toMatchObject({
          type: "blockquote",
          content: [{ type: "paragraph" }],
        });
      } finally {
        editor.destroy();
      }
    },
  );

  it("moves focus to the title from an empty first body line", async () => {
    let joinedText: string | null = null;
    const editor = new Editor({
      extensions: createVisualEditorExtensions({
        onJoinTitle: (text) => {
          joinedText = text;
        },
      }),
      content: {
        type: "doc",
        content: [
          { type: "paragraph" },
          {
            type: "paragraph",
            content: [{ type: "text", text: "But lately" }],
          },
        ],
      },
    });

    try {
      editor.commands.setTextSelection(1);

      expect(triggerKeyDown(editor, "Backspace")).toBe(true);
      await Promise.resolve();
      expect(joinedText).toBe("");
      expect(editor.getJSON()).toMatchObject({
        type: "doc",
        content: [
          { type: "paragraph" },
          {
            type: "paragraph",
            content: [{ type: "text", text: "But lately" }],
          },
        ],
      });
    } finally {
      editor.destroy();
    }
  });

  it("moves focus to the title when deleting the only empty body line", async () => {
    let joinedText: string | null = null;
    const editor = new Editor({
      extensions: createVisualEditorExtensions({
        onJoinTitle: (text) => {
          joinedText = text;
        },
      }),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });

    try {
      editor.commands.setTextSelection(1);

      expect(triggerKeyDown(editor, "Delete")).toBe(true);
      await Promise.resolve();
      expect(joinedText).toBe("");
      expect(editor.getJSON()).toMatchObject({
        type: "doc",
        content: [{ type: "paragraph" }],
      });
    } finally {
      editor.destroy();
    }
  });

  it("removes a non-empty first body line and passes its text to the title", async () => {
    let joinedText: string | null = null;
    const editor = new Editor({
      extensions: createVisualEditorExtensions({
        onJoinTitle: (text) => {
          joinedText = text;
        },
      }),
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Move me up" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Keep me here" }],
          },
        ],
      },
    });

    try {
      editor.commands.setTextSelection(1);

      expect(triggerKeyDown(editor, "Backspace")).toBe(true);
      await Promise.resolve();
      expect(joinedText).toBe("Move me up");
      expect(editor.getJSON()).toMatchObject({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Keep me here" }],
          },
        ],
      });
    } finally {
      editor.destroy();
    }
  });

  it("uses the editable empty paragraph as the toggle body placeholder", () => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "notionToggle",
            attrs: { summary: "Toggle", open: true },
            content: [{ type: "paragraph" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Outside" }],
          },
        ],
      },
    });

    try {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);

      expect(
        editor.view.dom.querySelector(".notion-toggle__empty-placeholder"),
      ).toBeNull();
      expect(
        editor.view.dom
          .querySelector(
            "[data-notion-toggle-content] p, .notion-toggle__content p",
          )
          ?.getAttribute("data-placeholder"),
      ).toBe("Empty toggle. Click or drop blocks inside.");
    } finally {
      editor.destroy();
    }
  });

  it("uses the normal empty-block placeholder when the toggle body is focused", () => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "notionToggle",
            attrs: { summary: "Toggle", open: true },
            content: [{ type: "paragraph" }],
          },
        ],
      },
    });

    try {
      editor.commands.setTextSelection(2);

      expect(
        editor.view.dom
          .querySelector(
            "[data-notion-toggle-content] p, .notion-toggle__content p",
          )
          ?.getAttribute("data-placeholder"),
      ).toBe("Press ‘space’ for AI or ‘/’ for commands");
    } finally {
      editor.destroy();
    }
  });

  it("removes the toggle body placeholder after typing into the body", () => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "notionToggle",
            attrs: { summary: "Toggle", open: true },
            content: [{ type: "paragraph" }],
          },
        ],
      },
    });

    try {
      editor.commands.setTextSelection(2);
      insertPlainText(editor, "Body text");

      expect(
        editor.view.dom.querySelector(
          "[data-placeholder='Empty toggle. Click or drop blocks inside.']",
        ),
      ).toBeNull();
      expect(editor.view.dom.textContent).toContain("Body text");
    } finally {
      editor.destroy();
    }
  });

  it("replaces the empty toggle placeholder after dropped content fills the body", () => {
    const editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "notionToggle",
            attrs: { summary: "Toggle", open: true },
            content: [],
          },
        ],
      },
    });

    try {
      expect(editor.view.dom.querySelector(".notion-toggle__content p")).toBe(
        null,
      );

      editor.commands.insertContentAt(1, {
        type: "paragraph",
        content: [{ type: "text", text: "Dropped block" }],
      });

      expect(
        editor.view.dom.querySelector(
          "[data-placeholder='Empty toggle. Click or drop blocks inside.']",
        ),
      ).toBeNull();
      expect(editor.getText()).toContain("Dropped block");
    } finally {
      editor.destroy();
    }
  });

  it("turns > space into an empty open toggle without storing placeholder text", () => {
    const editor = createFullEditor();

    try {
      insertPlainText(editor, ">");
      expect(triggerTextInput(editor, " ")).toBe(true);

      const json = editor.getJSON();
      expect(json.content?.[0]?.type).toBe("notionToggle");
      expect(json.content?.[0]?.attrs?.summary).toBe("");
      expect(json.content?.[0]?.attrs?.open).toBe(true);

      const markdown = (editor.storage as any).markdown.getMarkdown();
      expect(markdown).toContain("<summary></summary>");
      expect(markdown).not.toContain("<summary>Toggle</summary>");
    } finally {
      editor.destroy();
    }
  });

  it("handles batched > space text input as an empty open toggle", () => {
    const editor = createFullEditor();

    try {
      expect(triggerTextInput(editor, "> ")).toBe(true);

      const json = editor.getJSON();
      expect(json.content?.[0]?.type).toBe("notionToggle");
      expect(json.content?.[0]?.attrs?.summary).toBe("");
      expect(json.content?.[0]?.attrs?.open).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  it("turns pipe space into a blockquote shortcut", () => {
    const editor = createFullEditor();

    try {
      insertPlainText(editor, "|");
      expect(triggerTextInput(editor, " ")).toBe(true);

      const json = editor.getJSON();
      expect(json.content?.[0]?.type).toBe("blockquote");
    } finally {
      editor.destroy();
    }
  });
});
