// @vitest-environment happy-dom

import type { PlanBlock, PlanContent } from "@shared/plan-content";
import type { Editor } from "@tiptap/react";
import { act, createElement, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/uploads", () => ({
  uploadEditorImage: vi.fn(),
  useFileUploadStatus: () => ({
    data: { configured: true },
    isSuccess: true,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@agent-native/toolkit/app/chat/FileStorageSetupPopover", () => ({
  FileStorageSetupPopover: () => null,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { BlockRegistryProvider } from "@agent-native/toolkit/app/blocks";
import {
  createPlanBlockRenderContext,
  planBlockRegistry,
} from "../plan/planBlocks";
import {
  NestedPlanBlocksEditor,
  PlanDocumentEditor,
} from "./PlanDocumentEditor";

const CALLOUT = {
  id: "divider",
  type: "callout",
  data: { tone: "info", body: "Separator callout." },
} as PlanBlock;

const ALPHA = {
  id: "alpha",
  type: "rich-text",
  data: { markdown: "Alpha block seed." },
} as PlanBlock;

const BRAVO = {
  id: "bravo",
  type: "rich-text",
  data: { markdown: "Bravo block seed." },
} as PlanBlock;

const content: PlanContent = {
  version: 2,
  blocks: [ALPHA, CALLOUT, BRAVO],
};

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function flushEditorEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("PlanDocumentEditor save reader", () => {
  it("keeps a callout's data when the pending blocks it is given are empty", async () => {
    const reader: MutableRefObject<
      ((pending: PlanBlock[]) => PlanBlock[] | null) | null
    > = { current: null };
    act(() => {
      root.render(
        createElement(PlanDocumentEditor, {
          content,
          editable: true,
          onBlocksChange: vi.fn(),
          blocksReaderRef: reader,
        }),
      );
    });
    await flushEditorEffects();
    await flushEditorEffects();

    const saved = reader.current?.([]);

    expect(saved?.map((block) => block.id)).toEqual([
      "alpha",
      "divider",
      "bravo",
    ]);
    expect(saved?.find((block) => block.id === "divider")).toEqual(CALLOUT);
  });

  it("uses adopted structured data ahead of an older pending snapshot", async () => {
    const reader: MutableRefObject<
      ((pending: PlanBlock[]) => PlanBlock[] | null) | null
    > = { current: null };
    act(() => {
      root.render(
        createElement(PlanDocumentEditor, {
          content,
          editable: true,
          onBlocksChange: vi.fn(),
          blocksReaderRef: reader,
        }),
      );
    });
    await flushEditorEffects();
    await flushEditorEffects();

    const staleCallout = {
      id: CALLOUT.id,
      type: "callout",
      data: { tone: "info", body: "Stale pending body." },
    } as PlanBlock;
    const saved = reader.current?.([staleCallout]);

    expect(saved?.find((block) => block.id === "divider")).toEqual(CALLOUT);
  });
});

describe("PlanDocumentEditor content revisions", () => {
  const reader: MutableRefObject<
    ((pending: PlanBlock[]) => PlanBlock[] | null) | null
  > = { current: null };

  async function renderAt(
    contentUpdatedAt: string,
    blocks: PlanBlock[],
    onBlocksChange: (blocks: PlanBlock[]) => void = vi.fn(),
  ) {
    // The registry the app renders with, which gives a new block of a type it
    // knows empty data of that type.
    act(() => {
      root.render(
        createElement(BlockRegistryProvider, {
          registry: planBlockRegistry,
          ctx: createPlanBlockRenderContext({}),
          children: createElement(PlanDocumentEditor, {
            content: { ...content, blocks },
            contentUpdatedAt,
            editable: true,
            onBlocksChange,
            blocksReaderRef: reader,
          }),
        }),
      );
    });
    await flushEditorEffects();
    await flushEditorEffects();
  }

  function documentEditor() {
    const dom = container.querySelector(".ProseMirror") as
      | (Element & { editor?: Editor })
      | null;
    const editor = dom?.editor;
    if (!editor) throw new Error("The editor did not mount.");
    return editor;
  }

  function calloutPosition() {
    let position = -1;
    documentEditor().state.doc.descendants((node, at) => {
      if (node.attrs.blockId === CALLOUT.id) position = at;
    });
    expect(position).toBeGreaterThanOrEqual(0);
    return position;
  }

  async function deleteCallout() {
    const position = calloutPosition();
    await act(async () => {
      documentEditor()
        .chain()
        .setNodeSelection(position)
        .deleteSelection()
        .run();
    });
  }

  const blockIds = () => reader.current?.([])?.map((block) => block.id);

  it("keeps a deletion when the saved copy comes back over the optimistic one", async () => {
    let edited: PlanBlock[] | null = null;
    const onBlocksChange = (blocks: PlanBlock[]) => {
      edited = blocks;
    };
    await renderAt("r1", content.blocks, onBlocksChange);
    await deleteCallout();
    expect(edited).not.toBeNull();

    await renderAt("r1", edited!, onBlocksChange);
    await renderAt("r1", content.blocks, onBlocksChange);

    expect(blockIds()).not.toContain(CALLOUT.id);
  });

  it("gives a removed block its data back when Undo returns it after the removal saved", async () => {
    let edited: PlanBlock[] | null = null;
    const onBlocksChange = (blocks: PlanBlock[]) => {
      edited = blocks;
    };
    await renderAt("r1", content.blocks, onBlocksChange);
    const position = calloutPosition();
    const node = documentEditor().state.doc.nodeAt(position)?.toJSON();
    expect(node).toBeDefined();
    await deleteCallout();
    expect(edited).not.toBeNull();
    await renderAt("r2", edited!, onBlocksChange);

    // What Undo puts back: the block's node, which has its id and type but not its data.
    await act(async () => {
      documentEditor().chain().insertContentAt(position, node).run();
    });

    expect(
      reader.current?.([])?.find((block) => block.id === CALLOUT.id),
    ).toEqual(CALLOUT);
  });

  it("takes in what a new revision brings", async () => {
    await renderAt("r1", content.blocks);
    const theirs = {
      ...CALLOUT,
      data: { tone: "info", body: "Their callout." },
    } as PlanBlock;

    await renderAt("r2", [ALPHA, theirs, BRAVO]);

    expect(
      reader.current?.([])?.find((block) => block.id === CALLOUT.id),
    ).toEqual(theirs);
  });
});

describe("NestedPlanBlocksEditor", () => {
  it("gives a removed block its data back when Undo returns it", async () => {
    const changes: PlanBlock[][] = [];
    const latest = (): PlanBlock[] | undefined => changes[changes.length - 1];
    const renderRegion = async (blocks: PlanBlock[]) => {
      act(() => {
        root.render(
          createElement(BlockRegistryProvider, {
            registry: planBlockRegistry,
            ctx: createPlanBlockRenderContext({}),
            children: createElement(NestedPlanBlocksEditor, {
              blocks,
              editable: true,
              onBlocksChange: (next: PlanBlock[]) => {
                changes.push(next);
              },
              containerBlockId: "columns",
              regionId: "left",
            }),
          }),
        );
      });
      await flushEditorEffects();
      await flushEditorEffects();
    };
    await renderRegion(content.blocks);
    const dom = container.querySelector(".ProseMirror") as
      | (Element & { editor?: Editor })
      | null;
    const editor = dom?.editor;
    if (!editor) throw new Error("The editor did not mount.");
    let position = -1;
    editor.state.doc.descendants((node, at) => {
      if (node.attrs.blockId === CALLOUT.id) position = at;
    });
    expect(position).toBeGreaterThanOrEqual(0);

    await act(async () => {
      editor.chain().setNodeSelection(position).deleteSelection().run();
    });
    const removed = latest();
    expect(removed?.map((block) => block.id)).not.toContain(CALLOUT.id);
    await renderRegion(removed ?? []);
    await act(async () => {
      editor.commands.undo();
    });

    expect(latest()?.find((block) => block.id === CALLOUT.id)).toEqual(CALLOUT);
  });
});
