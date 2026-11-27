// @vitest-environment happy-dom

import { appPath } from "@agent-native/core/client/api-path";
import {
  BLOCK_IDENTITY_ATTR,
  blockContentHashesByPath,
  editorBlockIdsOf,
  identityBlockIds,
} from "@shared/block-identity-ids";
import {
  contentBlockLinkPath,
  readBlockLink,
  readFullScreenBlockLink,
  withoutBlockLink,
} from "@shared/block-link";
import {
  legacyBlocksFieldIdentity,
  blocksFieldPathsById,
} from "@shared/blocks-field-identity";
import { nfmToDoc, type PMNode } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  blockLinkId,
  blockLinkUrl,
  blockPlaces,
  editorDocBlockIds,
  heldBlockLinkId,
  stampBlockIdentityIds,
  useBlockIdentityStamps,
  useLinkedBlockReveal,
  usePublicBlockIds,
} from "./block-links";
import type { BlockAt } from "./block-menu-registry";
import { linkedBlockKey } from "./extensions/BlockIdentityIds";
import { createVisualEditorExtensions } from "./VisualEditor";

const hooks = vi.hoisted(() => ({ callAction: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction: hooks.callAction,
}));

const NESTED = [
  "# Heading",
  "Paragraph",
  "- List item",
  "\t- Nested item",
  '<callout icon="💡">',
  "\tInside",
  "</callout>",
  "<table>",
  "<tr>",
  "<td>a</td>",
  "</tr>",
  "</table>",
  "After",
].join("\n");

let editor: Editor | null = null;
let root: Root | null = null;

beforeEach(() => {
  hooks.callAction.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  editor?.destroy();
  editor = null;
  vi.useRealTimers();
});

function open(nfm: string) {
  editor = new Editor({
    extensions: createVisualEditorExtensions({}),
    content: nfmToDoc(nfm),
  });
  return editor;
}

function tableIds(nfm: string) {
  return identityBlockIds(
    legacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown: nfm,
    }).blocks,
  );
}

function withTrailingLine(target: Editor) {
  const { doc } = target.state;
  if (doc.lastChild?.type.name !== "paragraph" || doc.lastChild.childCount) {
    target.view.dispatch(
      target.state.tr.insert(
        doc.content.size,
        target.state.schema.node("paragraph"),
      ),
    );
  }
  return target;
}

function blockAt(target: Editor, index: number): BlockAt {
  const node = target.state.doc.child(index);
  let pos = 0;
  for (let i = 0; i < index; i++) pos += target.state.doc.child(i).nodeSize;
  return { node, pos };
}

describe("block links", () => {
  it("names the editor's blocks by the paths the server's table uses", () => {
    const target = open(NESTED);
    const identity = legacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown: NESTED,
    });
    const paths = blocksFieldPathsById(identity.blocks);

    expect(blockPlaces(target.state.doc).map(({ path }) => path)).toEqual(
      identity.blocks.map((block) => paths.get(block.id)),
    );
    expect(editorDocBlockIds(target.state.doc)).toEqual(
      editorBlockIdsOf(target.getJSON() as PMNode),
    );
  });

  it("leaves out the empty line the editor keeps under a last list or heading, as the saved text does", () => {
    for (const nfm of ["Intro\n- one\n- two", "Intro\n# Last"]) {
      editor?.destroy();
      const ids = tableIds(nfm);
      const target = withTrailingLine(open(nfm));
      const json = target.getJSON() as PMNode;

      expect(target.state.doc.lastChild?.type.name).toBe("paragraph");
      expect(target.state.doc.lastChild?.childCount).toBe(0);
      expect(editorBlockIdsOf(json)).toEqual({
        shape: ids.shape,
        idsByPath: {},
      });
      expect(stampBlockIdentityIds(target, ids)).toBe("stamped");
      expect(editorDocBlockIds(target.state.doc)).toEqual(ids);
    }
  });

  it("stamps every addressable block the table names", () => {
    const ids = tableIds(NESTED);
    editor?.destroy();
    const target = open(NESTED);

    expect(stampBlockIdentityIds(target, ids)).toBe("stamped");
    expect(editorDocBlockIds(target.state.doc).idsByPath).toEqual(
      ids.idsByPath,
    );
  });

  it("fingerprints every kind of block the way the server does", () => {
    const nfm = [
      "#   Heading with spaces",
      "Paragraph with **bold**, _italic_ and `code`",
      "> Quote",
      "* Star bullet",
      "\t- Nested item",
      "1. Numbered",
      "[ ] Task",
      "---",
      "```ts",
      "const stable = true",
      "```",
      '<callout icon="💡">',
      "\tInside",
      "</callout>",
      "<details>",
      "<summary>A toggle</summary>",
      "\tHidden child",
      "</details>",
      "<columns>",
      "\t<column>",
      "\t\tLeft",
      "\t</column>",
      "\t<column>",
      "\t\tRight",
      "\t</column>",
      "</columns>",
      "<table>",
      "<tr>",
      "<td>a</td>",
      "<td>b</td>",
      "</tr>",
      "</table>",
      "![A caption](https://cdn.example.com/x.png)",
      "After",
    ].join("\n");
    const ids = tableIds(nfm);
    const target = open(nfm);

    expect(
      stampBlockIdentityIds(target, {
        ...ids,
        contentByPath: blockContentHashesByPath(nfm),
      }),
    ).toBe("stamped");
    expect(editorDocBlockIds(target.state.doc).idsByPath).toEqual(
      ids.idsByPath,
    );
  });

  it("copies the ID a block holds without asking the server", async () => {
    const target = open("Apples\nPears");
    stampBlockIdentityIds(target, {
      shape: editorDocBlockIds(target.state.doc).shape,
      idsByPath: { "1": "block_pears" },
    });

    expect(heldBlockLinkId(target.state.doc, blockAt(target, 1))).toBe(
      "block_pears",
    );
    await expect(
      blockLinkId({
        editor: target,
        block: blockAt(target, 1),
        documentId: "doc-1",
        stamp: true,
      }),
    ).resolves.toBe("block_pears");
    expect(hooks.callAction).not.toHaveBeenCalled();
  });

  it("reads a new block's ID after saving it, and stamps it", async () => {
    const target = open("Apples\nPears");
    const { shape } = editorDocBlockIds(target.state.doc);
    const save = vi.fn(async () => {});
    hooks.callAction
      .mockResolvedValueOnce({
        ids: { shape: "shape_before_save", idsByPath: {} },
      })
      .mockResolvedValueOnce({
        ids: { shape, idsByPath: { "0": "block_apples", "1": "block_pears" } },
      });

    await expect(
      blockLinkId({
        editor: target,
        block: blockAt(target, 1),
        documentId: "doc-1",
        save,
        stamp: true,
      }),
    ).resolves.toBe("block_pears");
    expect(save).toHaveBeenCalledTimes(1);
    expect(hooks.callAction).toHaveBeenCalledWith(
      "get-body-block-ids",
      { documentId: "doc-1" },
      { method: "GET" },
    );
    expect(editorDocBlockIds(target.state.doc).idsByPath).toEqual({
      "0": "block_apples",
      "1": "block_pears",
    });
  });

  it("reads an ID without stamping it in a suggested edit", async () => {
    const target = open("Apples\nPears");
    const { shape } = editorDocBlockIds(target.state.doc);
    hooks.callAction.mockResolvedValueOnce({
      ids: { shape, idsByPath: { "0": "block_apples" } },
    });

    await expect(
      blockLinkId({
        editor: target,
        block: blockAt(target, 0),
        documentId: "doc-1",
        stamp: false,
      }),
    ).resolves.toBe("block_apples");
    expect(editorDocBlockIds(target.state.doc).idsByPath).toEqual({});
  });

  it("stamps no ID onto a block whose text isn't the saved block's", () => {
    const target = open("Pears\nApples");
    const ids = {
      shape: editorDocBlockIds(target.state.doc).shape,
      idsByPath: { "0": "block_apples", "1": "block_pears" },
      contentByPath: blockContentHashesByPath("Apples\nPears"),
    };

    expect(stampBlockIdentityIds(target, ids)).toBe("stale");
    expect(editorDocBlockIds(target.state.doc).idsByPath).toEqual({});
  });

  it("tells two images with the same caption apart by what they show", () => {
    const one = "![Photo](https://cdn.example.com/one.png)";
    const two = "![Photo](https://cdn.example.com/two.png)";
    const target = open(`${two}\n${one}`);
    const ids = {
      shape: editorDocBlockIds(target.state.doc).shape,
      idsByPath: { "0": "block_one", "1": "block_two" },
      contentByPath: blockContentHashesByPath(`${one}\n${two}`),
    };

    expect(stampBlockIdentityIds(target, ids)).toBe("stale");
    expect(editorDocBlockIds(target.state.doc).idsByPath).toEqual({});
  });

  it("reads once when there's nothing to save", async () => {
    const target = open("Apples");
    hooks.callAction.mockResolvedValue({ ids: null });

    await expect(
      blockLinkId({
        editor: target,
        block: blockAt(target, 0),
        documentId: "doc-1",
        stamp: true,
      }),
    ).resolves.toBeNull();
    expect(hooks.callAction).toHaveBeenCalledTimes(1);
  });

  it("copies no link to an ID two blocks hold", () => {
    const target = open("Apples\nPears");
    target.view.dispatch(
      target.state.tr
        .setNodeAttribute(blockAt(target, 0).pos, BLOCK_IDENTITY_ATTR, "dup")
        .setNodeAttribute(blockAt(target, 1).pos, BLOCK_IDENTITY_ATTR, "dup")
        .setMeta(ySyncPluginKey, { isChangeOrigin: true }),
    );

    expect(target.state.doc.child(1).attrs[BLOCK_IDENTITY_ATTR]).toBe("dup");
    expect(heldBlockLinkId(target.state.doc, blockAt(target, 0))).toBeNull();
    expect(heldBlockLinkId(target.state.doc, blockAt(target, 1))).toBeNull();
  });

  it("copies no link the server names for a block when another block holds that ID", async () => {
    const target = open("Apples\nPears");
    target.view.dispatch(
      target.state.tr
        .setNodeAttribute(
          blockAt(target, 0).pos,
          BLOCK_IDENTITY_ATTR,
          "block_pears",
        )
        .setMeta(ySyncPluginKey, { isChangeOrigin: true }),
    );
    hooks.callAction.mockResolvedValue({
      ids: {
        shape: editorDocBlockIds(target.state.doc).shape,
        idsByPath: { "1": "block_pears" },
        contentByPath: blockContentHashesByPath("Apples\nPears"),
      },
    });

    await expect(
      blockLinkId({
        editor: target,
        block: blockAt(target, 1),
        documentId: "doc-1",
        stamp: true,
      }),
    ).resolves.toBeNull();
    expect(target.state.doc.child(1).attrs[BLOCK_IDENTITY_ATTR]).toBeNull();
  });

  it("reads no ID after a save that couldn't reach the server", async () => {
    const target = open("Apples\nPears");
    const { shape } = editorDocBlockIds(target.state.doc);
    const save = vi.fn(async () => false);
    hooks.callAction
      .mockResolvedValueOnce({ ids: null })
      .mockResolvedValueOnce({
        ids: { shape, idsByPath: { "0": "block_apples", "1": "block_pears" } },
      });

    await expect(
      blockLinkId({
        editor: target,
        block: blockAt(target, 1),
        documentId: "doc-1",
        save,
        stamp: true,
      }),
    ).resolves.toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
    expect(hooks.callAction).toHaveBeenCalledTimes(1);
    expect(editorDocBlockIds(target.state.doc).idsByPath).toEqual({});
  });

  it("gives no ID for a block deleted while the save runs", async () => {
    const target = open("Apples\nPears");
    const block = blockAt(target, 1);
    hooks.callAction.mockResolvedValue({ ids: null });
    const save = vi.fn(async () => {
      target.view.dispatch(
        target.state.tr.delete(block.pos, block.pos + block.node.nodeSize),
      );
    });

    await expect(
      blockLinkId({
        editor: target,
        block,
        documentId: "doc-1",
        save,
        stamp: true,
      }),
    ).resolves.toBeNull();
  });
});

describe("stamping a page's block IDs", () => {
  async function stamp(target: Editor) {
    function Harness() {
      useBlockIdentityStamps({
        editor: target,
        documentId: "doc-1",
        enabled: true,
      });
      return null;
    }
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(<Harness />));
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
  }

  async function typeAndPause(target: Editor) {
    await act(async () => {
      target.commands.insertContentAt(target.state.doc.content.size, {
        type: "paragraph",
        content: [{ type: "text", text: "More" }],
      });
    });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
  }

  it("stops reading IDs for a page with no Blocks field", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    const target = open("Apples");
    hooks.callAction.mockResolvedValue({ ids: null, noBlocksField: true });
    await stamp(target);
    expect(hooks.callAction).toHaveBeenCalledTimes(1);

    await typeAndPause(target);
    expect(hooks.callAction).toHaveBeenCalledTimes(1);
  });

  it("reads IDs again after an edit while the page's table has none", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    const target = open("Apples");
    hooks.callAction.mockResolvedValue({ ids: null });
    await stamp(target);
    expect(hooks.callAction).toHaveBeenCalledTimes(1);

    await typeAndPause(target);
    expect(hooks.callAction).toHaveBeenCalledTimes(2);
  });
});

describe("opening a block link", () => {
  async function reveal(
    target: Editor,
    blockId: string,
    moved?: { to: string | null },
  ) {
    const onDeleted = vi.fn();
    const onMissing = vi.fn();
    const onFailed = vi.fn();
    const onRevealed = vi.fn();
    function Harness({
      fullScreen = false,
      id = blockId,
    }: {
      fullScreen?: boolean;
      id?: string | null;
    }) {
      useLinkedBlockReveal({
        editor: target,
        documentId: "doc-1",
        blockId: id,
        fullScreen,
        ready: true,
        onRevealed,
        onDeleted,
        onMissing,
        onFailed,
      });
      return null;
    }
    const container = document.createElement("div");
    root = createRoot(container);
    const settle = async () => {
      for (let frame = 0; frame < 2; frame++) {
        await act(async () => {
          await new Promise((resolve) => requestAnimationFrame(resolve));
        });
      }
    };
    const render = async (fullScreen: boolean) => {
      await act(async () => root?.render(<Harness fullScreen={fullScreen} />));
      await settle();
    };
    if (moved) {
      await act(async () => {
        flushSync(() => root?.render(<Harness />));
        flushSync(() => root?.render(<Harness id={moved.to} />));
      });
      await settle();
    } else {
      await render(false);
    }
    return {
      onDeleted,
      onMissing,
      onFailed,
      onRevealed,
      openFullScreen: () => render(true),
    };
  }

  function highlighted(target: Editor) {
    return linkedBlockKey
      .getState(target.state)
      ?.set.find()
      .map(
        (decoration) => target.state.doc.nodeAt(decoration.from)?.textContent,
      );
  }

  it("highlights the block holding the link's ID", async () => {
    const target = open("Apples\nPears");
    stampBlockIdentityIds(target, {
      shape: editorDocBlockIds(target.state.doc).shape,
      idsByPath: { "1": "block_pears" },
    });
    const { onRevealed } = await reveal(target, "block_pears");

    expect(highlighted(target)).toEqual(["Pears"]);
    expect(onRevealed).toHaveBeenCalledTimes(1);
    expect(onRevealed.mock.calls[0]?.[0].node.textContent).toBe("Pears");
    expect(hooks.callAction).not.toHaveBeenCalled();
  });

  it.each([null, "block_apples"])(
    "opens no block the link moved away from, to %s, before it opened",
    async (to) => {
      const target = open("Apples\nPears");
      stampBlockIdentityIds(target, {
        shape: editorDocBlockIds(target.state.doc).shape,
        idsByPath: { "0": "block_apples", "1": "block_pears" },
      });
      const { onRevealed } = await reveal(target, "block_pears", { to });

      expect(
        onRevealed.mock.calls.map(([place]) => place.node.textContent),
      ).toEqual(to ? ["Apples"] : []);
    },
  );

  it("finds the same block again when the link now opens it full screen", async () => {
    const target = open("Apples\nPears");
    stampBlockIdentityIds(target, {
      shape: editorDocBlockIds(target.state.doc).shape,
      idsByPath: { "1": "block_pears" },
    });
    const { onRevealed, openFullScreen } = await reveal(target, "block_pears");

    await openFullScreen();

    expect(onRevealed).toHaveBeenCalledTimes(2);
  });

  it("keeps the highlight on the linked block when the server's newer copy replaces the page", async () => {
    const target = open("Apples\nPears");
    stampBlockIdentityIds(target, {
      shape: editorDocBlockIds(target.state.doc).shape,
      idsByPath: { "1": "block_pears" },
    });
    await reveal(target, "block_pears");
    const newer = nfmToDoc("Intro\nApples\nPears, rewritten");
    const blocks = newer.content.map((node, index) =>
      index === 2
        ? {
            ...node,
            attrs: { ...node.attrs, [BLOCK_IDENTITY_ATTR]: "block_pears" },
          }
        : node,
    );
    target.view.dispatch(
      target.state.tr
        .replaceWith(
          0,
          target.state.doc.content.size,
          target.schema.nodeFromJSON({ ...newer, content: blocks }).content,
        )
        .setMeta(ySyncPluginKey, { isChangeOrigin: true }),
    );

    expect(highlighted(target)).toEqual(["Pears, rewritten"]);
  });

  it("finds a block the editor holds no ID for where the server says it is", async () => {
    const target = open("Apples\nPears");
    hooks.callAction.mockResolvedValueOnce({
      state: "live",
      path: "1",
      content: blockContentHashesByPath("Apples\nPears")["1"],
    });
    await reveal(target, "block_pears");

    expect(highlighted(target)).toEqual(["Pears"]);
    expect(hooks.callAction).toHaveBeenCalledWith(
      "resolve-block-link",
      { documentId: "doc-1", blockId: "block_pears" },
      { method: "GET" },
    );
  });

  it("still finds the block when the server answers after the wait", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    try {
      const target = open("Apples\nPears");
      let answer: (found: unknown) => void = () => undefined;
      hooks.callAction.mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
      const { onMissing } = await reveal(target, "block_pears");
      await act(async () => {
        vi.advanceTimersByTime(9_000);
      });
      await act(async () => {
        answer({
          state: "live",
          path: "1",
          content: blockContentHashesByPath("Apples\nPears")["1"],
        });
      });
      for (let frame = 0; frame < 2; frame++) {
        await act(async () => {
          await new Promise((resolve) => requestAnimationFrame(resolve));
        });
      }

      expect(onMissing).not.toHaveBeenCalled();
      expect(highlighted(target)).toEqual(["Pears"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for the editor to catch up when the server answers after the wait", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    try {
      const target = open("Apples");
      let answer: (found: unknown) => void = () => undefined;
      hooks.callAction.mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
      const { onMissing } = await reveal(target, "block_pears");
      await act(async () => {
        vi.advanceTimersByTime(9_000);
      });
      await act(async () => {
        answer({
          state: "live",
          path: "1",
          content: blockContentHashesByPath("Apples\nPears")["1"],
        });
      });
      expect(onMissing).not.toHaveBeenCalled();

      await act(async () => {
        target.commands.insertContentAt(target.state.doc.content.size, {
          type: "paragraph",
          content: [{ type: "text", text: "Pears" }],
        });
      });
      for (let frame = 0; frame < 2; frame++) {
        await act(async () => {
          await new Promise((resolve) => requestAnimationFrame(resolve));
        });
      }

      expect(onMissing).not.toHaveBeenCalled();
      expect(highlighted(target)).toEqual(["Pears"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says the block is missing when the editor never catches up with a late answer", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    try {
      const target = open("Apples");
      let answer: (found: unknown) => void = () => undefined;
      hooks.callAction.mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
      const { onMissing } = await reveal(target, "block_pears");
      await act(async () => {
        vi.advanceTimersByTime(9_000);
      });
      await act(async () => {
        answer({
          state: "live",
          path: "1",
          content: blockContentHashesByPath("Apples\nPears")["1"],
        });
      });
      await act(async () => {
        vi.advanceTimersByTime(9_000);
      });

      expect(onMissing).toHaveBeenCalledTimes(1);
      expect(highlighted(target)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives the editor a full wait after an answer that comes just before the wait ends", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    try {
      const target = open("Apples");
      let answer: (found: unknown) => void = () => undefined;
      hooks.callAction.mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
      const { onMissing } = await reveal(target, "block_pears");
      await act(async () => {
        vi.advanceTimersByTime(7_900);
      });
      await act(async () => {
        answer({
          state: "live",
          path: "1",
          content: blockContentHashesByPath("Apples\nPears")["1"],
        });
      });
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      expect(onMissing).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(8_000);
      });
      expect(onMissing).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("highlights nothing where the server's block has other text", async () => {
    const target = open("Apples\nPlums");
    hooks.callAction.mockResolvedValueOnce({
      state: "live",
      path: "1",
      content: blockContentHashesByPath("Apples\nPears")["1"],
    });
    await reveal(target, "block_pears");

    expect(highlighted(target)).toEqual([]);
  });

  it("says when the linked block was deleted", async () => {
    const target = open("Apples");
    hooks.callAction.mockResolvedValueOnce({ state: "deleted" });
    const { onDeleted, onMissing } = await reveal(target, "block_gone");

    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(onMissing).not.toHaveBeenCalled();
    expect(highlighted(target)).toEqual([]);
  });

  it("says when the page has no such block", async () => {
    const target = open("Apples");
    hooks.callAction.mockResolvedValueOnce({ state: "missing" });
    const { onMissing } = await reveal(target, "block_other");

    expect(onMissing).toHaveBeenCalledTimes(1);
  });

  it("says the lookup failed, not that the block is missing, when the server can't answer", async () => {
    const target = open("Apples");
    hooks.callAction.mockRejectedValueOnce(new Error("offline"));

    const { onFailed, onMissing } = await reveal(target, "block_other");

    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onMissing).not.toHaveBeenCalled();
  });
});

describe("a public page's interactive blocks", () => {
  const block = "```html interactive\n<p>Hi</p>\n```";

  async function load(target: Editor, idsByPath: Record<string, string>) {
    function Harness() {
      usePublicBlockIds(target, idsByPath);
      return null;
    }
    root = createRoot(document.createElement("div"));
    await act(async () => root?.render(<Harness />));
  }
  const idsOf = (target: Editor) =>
    target.state.doc.content.content.map(
      (node) => node.attrs[BLOCK_IDENTITY_ATTR] ?? null,
    );

  it("hold the IDs the page loads with, and no other block does", async () => {
    const target = open(`Text\n${block}`);

    await load(target, { "0": "block_text", "1": "block_html" });

    expect(idsOf(target)).toEqual([null, "block_html", null]);
    expect(hooks.callAction).not.toHaveBeenCalled();
  });

  it("hold them once the page's body arrives after it", async () => {
    const target = open("");
    await load(target, { "1": "block_html" });

    await act(async () => {
      target.commands.setContent(nfmToDoc(`Text\n${block}`));
    });

    expect(idsOf(target)).toEqual([null, "block_html", null]);
  });
});

describe("a block link's URL", () => {
  it("keeps the app's base path", () => {
    expect(blockLinkUrl("doc-1", "block_a")).toBe(
      new URL(
        appPath(contentBlockLinkPath("doc-1", "block_a")),
        window.location.origin,
      ).href,
    );
  });

  it("opens the block full screen until the block is closed", () => {
    const { pathname, search } = new URL(
      blockLinkUrl("doc 1", "block_a", { fullScreen: true }),
    );

    expect(readBlockLink(search)).toEqual({
      blockId: "block_a",
      fullScreen: true,
    });
    expect(readBlockLink("?block=block_a").fullScreen).toBe(false);
    expect(withoutBlockLink(`${search}&view=board`)).toBe("?view=board");
    expect(withoutBlockLink(search)).toBe("");
    expect(pathname.endsWith("/page/doc%201")).toBe(true);
  });

  it.each([
    ["https://content.example.com/page/doc-1?block=b&full=1", "b"],
    ["https://content.example.com/page/doc-1?block=b&amp;full=1", "b"],
    ["https://example.com/content/page/doc-1?full=1", null],
  ])("is read from an address: %s", (href, blockId) => {
    expect(readFullScreenBlockLink(href)).toEqual({
      pagePath: "/page/doc-1",
      blockId,
    });
  });

  it.each([
    "https://content.example.com/page/doc-1?block=b",
    "https://content.example.com/p/doc-1?block=b&full=1",
    "/page/doc-1?full=1",
    null,
  ])("is told apart from other addresses: %s", (href) => {
    expect(readFullScreenBlockLink(href)).toBeNull();
  });
});
