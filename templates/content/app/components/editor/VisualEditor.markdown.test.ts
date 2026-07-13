// @vitest-environment happy-dom

import { docToNfm } from "@shared/nfm";
import {
  VISUAL_INDENT,
  parseNfmForEditor,
  serializeEditorToNfm,
} from "@shared/notion-markdown";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Editor, getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { Markdown } from "tiptap-markdown";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { TooltipProvider } from "@/components/ui/tooltip";

import { CodeBlock } from "./extensions/CodeBlockNode";
import { NotionToggle } from "./extensions/NotionExtensions";
import {
  createVisualEditorExtensions,
  EmptyLineParagraph,
  getRecentEditPresenceMarkerRect,
  parseNfmForCollabReconcile,
  uploadAndInsertAudioFiles,
  uploadAndInsertImageFiles,
  uploadAndInsertVideoFiles,
  shouldApplyExternalContentSync,
  shouldPersistLocalFileEditorUpdate,
  shouldSeedCollaborativeContent,
  VisualEditor,
} from "./VisualEditor";

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

function waitForDeferredCallback() {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
  it("renders recent edits as presence markers instead of range boxes", () => {
    const marker = getRecentEditPresenceMarkerRect(
      new DOMRect(120, 240, 680, 22),
    );

    expect(marker.left).toBe(120);
    expect(marker.top).toBe(240);
    expect(marker.width).toBe(2);
    expect(marker.height).toBe(22);
  });

  it("keeps recent edit markers visible for collapsed caret coordinates", () => {
    const marker = getRecentEditPresenceMarkerRect(new DOMRect(120, 240, 0, 0));

    expect(marker.width).toBe(2);
    expect(marker.height).toBe(18);
  });

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
      expect(rows[0].content?.map((cell: any) => cell.type)).toEqual([
        "tableHeader",
        "tableHeader",
      ]);
      expect(rows[1].content?.map((cell: any) => cell.type)).toEqual([
        "tableHeader",
        "tableCell",
      ]);
      expect(rows[2].content?.map((cell: any) => cell.type)).toEqual([
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchCtx: { resolve: any } = { resolve: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            fetchCtx.resolve = resolve;
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

      fetchCtx.resolve?.({
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchCtx: { resolve: any } = { resolve: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            fetchCtx.resolve = resolve;
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

      fetchCtx.resolve?.({
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchCtx: { resolve: any } = { resolve: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            fetchCtx.resolve = resolve;
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

      fetchCtx.resolve?.({
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

  it("keeps adjacent NFM blocks separate in collaborative external reconciles", () => {
    const editor = createFullEditor();
    const incoming = [
      "→ → slack questions",
      '\tmuch simpler "what"',
      "\twhat is it and how different from other app builders",
      "\twhen to engage prospects",
    ].join("\n");

    try {
      const parsed = parseNfmForCollabReconcile(editor, incoming);

      expect(parsed).not.toBeNull();
      expect(parsed?.childCount).toBe(4);
      expect(
        Array.from(
          { length: parsed?.childCount ?? 0 },
          (_, index) => parsed?.child(index).textContent,
        ),
      ).toEqual([
        "→ → slack questions",
        'much simpler "what"',
        "what is it and how different from other app builders",
        "when to engage prospects",
      ]);
    } finally {
      editor.destroy();
    }
  });

  it("uses the NFM parser when a newer SQL snapshot reconciles into a live Y.Doc", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root = createRoot(container);
    const ydoc = new Y.Doc();
    const incoming = [
      "→ → slack questions",
      '\tmuch simpler "what"',
      "\twhat is it and how different from other app builders",
      "\twhen to engage prospects",
    ].join("\n");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const emitted: string[] = [];
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const renderEditor = (content: string, contentUpdatedAt: string) =>
      createElement(
        MemoryRouter,
        null,
        createElement(TooltipProvider, {
          delayDuration: 0,
          children: createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(VisualEditor, {
              content,
              contentUpdatedAt,
              onChange: (markdown) => emitted.push(markdown),
              ydoc,
              collabSynced: true,
              editable: true,
            }),
          ),
        }),
      );

    try {
      // Match a real reload after an external version was previously live: seed
      // the persisted Y.Doc through the actual VisualEditor, unmount the page,
      // then mount a fresh editor whose SQL snapshot points somewhere else.
      act(() => {
        root.render(renderEditor(incoming, "2026-07-09T19:59:59.000Z"));
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
      act(() => root.unmount());
      root = createRoot(container);

      act(() => {
        root.render(
          renderEditor("Initial local block", "2026-07-09T20:00:00.000Z"),
        );
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(
        Array.from(
          container.querySelectorAll<HTMLElement>(".notion-editor > p"),
          (node) => node.textContent,
        ),
      ).toEqual(["Initial local block"]);

      act(() => {
        root.render(renderEditor(incoming, "2026-07-09T20:00:01.000Z"));
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

      expect(
        Array.from(
          container.querySelectorAll<HTMLElement>(".notion-editor > p"),
          (node) => node.textContent,
        ),
      ).toEqual([
        "→ → slack questions",
        'much simpler "what"',
        "what is it and how different from other app builders",
        "when to engage prospects",
      ]);
      expect(emitted).not.toContain("<empty-block/>");
    } finally {
      await act(async () => root.unmount());
      queryClient.clear();
      ydoc.destroy();
      container.remove();
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });

  it("does not clear awareness owned by the shared collab connection on unmount", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const queryClient = new QueryClient();
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const user = {
      name: "Awareness Owner",
      email: "awareness-owner@example.com",
      color: "#60a5fa",
    };

    try {
      act(() => {
        root.render(
          createElement(
            MemoryRouter,
            null,
            createElement(TooltipProvider, {
              children: createElement(
                QueryClientProvider,
                { client: queryClient },
                createElement(VisualEditor, {
                  content: "Shared awareness body",
                  contentUpdatedAt: "2026-07-09T20:00:00.000Z",
                  onChange: () => {},
                  ydoc,
                  collabSynced: true,
                  awareness,
                  user,
                  editable: true,
                }),
              ),
            }),
          ),
        );
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(awareness.getLocalState()?.user).toMatchObject({
        email: user.email,
      });

      act(() => root.unmount());

      expect(awareness.getLocalState()?.user).toMatchObject({
        email: user.email,
      });
    } finally {
      queryClient.clear();
      awareness.destroy();
      ydoc.destroy();
      container.remove();
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });

  it("does not apply stale SQL snapshots over live collaborative edits", () => {
    expect(
      shouldApplyExternalContentSync({
        docChanged: false,
        content: "Older collaborator snapshot",
        lastEmittedMarkdown: "Merged live content",
        currentMarkdown: "Merged live content",
        nextMarkdown: "Older collaborator snapshot",
        contentUpdatedAt: "2026-05-29T10:00:00.000Z",
        lastAppliedUpdatedAt: "2026-05-29T10:01:00.000Z",
        isLeadClient: true,
        editorFocused: false,
        lastTypedAt: 0,
        now: 10_000,
      }),
    ).toBe(false);
  });

  it("does not persist local-file mount-time normalization transactions", () => {
    expect(
      shouldPersistLocalFileEditorUpdate({
        docChanged: true,
        editorFocused: false,
        recentUserEditIntent: false,
        transactionUiEvent: undefined,
      }),
    ).toBe(false);
    expect(
      shouldPersistLocalFileEditorUpdate({
        docChanged: true,
        editorFocused: true,
        recentUserEditIntent: false,
        transactionUiEvent: undefined,
      }),
    ).toBe(true);
    expect(
      shouldPersistLocalFileEditorUpdate({
        docChanged: false,
        editorFocused: true,
        recentUserEditIntent: true,
        transactionUiEvent: "paste",
      }),
    ).toBe(false);
    expect(
      shouldPersistLocalFileEditorUpdate({
        docChanged: true,
        editorFocused: false,
        explicitLocalFileUserEdit: true,
        recentUserEditIntent: false,
        transactionUiEvent: undefined,
      }),
    ).toBe(true);
  });

  it("applies newer external sync through the lead client", () => {
    expect(
      shouldApplyExternalContentSync({
        docChanged: false,
        content: "Pulled from Notion",
        lastEmittedMarkdown: "Local editor state",
        currentMarkdown: "Local editor state",
        nextMarkdown: "Pulled from Notion",
        contentUpdatedAt: "2026-05-29T10:02:00.000Z",
        lastAppliedUpdatedAt: "2026-05-29T10:01:00.000Z",
        isLeadClient: true,
        editorFocused: false,
        lastTypedAt: 0,
        now: 10_000,
      }),
    ).toBe(true);
  });

  it("still applies external content before collaborative edits begin", () => {
    expect(
      shouldApplyExternalContentSync({
        docChanged: false,
        content: "Pulled from Notion",
        lastEmittedMarkdown: "",
        currentMarkdown: "Saved body",
        nextMarkdown: "Pulled from Notion",
        contentUpdatedAt: "2026-05-29T10:00:00.000Z",
        lastAppliedUpdatedAt: null,
        isLeadClient: true,
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
      const json = editor.getJSON();
      expect(json.content?.[0]).toMatchObject({
        type: "heading",
        attrs: { level: 4 },
        content: [{ type: "text", text: "A precise subheading" }],
      });
      expect(docToNfm(json as any)).toBe("#### A precise subheading");
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
      await waitForDeferredCallback();
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
      await waitForDeferredCallback();
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
      await waitForDeferredCallback();
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
