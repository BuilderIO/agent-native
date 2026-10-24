// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import {
  initProseMirrorDoc,
  prosemirrorJSONToYXmlFragment,
  updateYFragment,
} from "@tiptap/y-tiptap";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { TooltipProvider } from "@/components/ui/tooltip";

import { insertMediaPlaceholder } from "../app/components/editor/SlashCommandMenu";
import { VisualEditor } from "../app/components/editor/VisualEditor";
import {
  materializeLegacyBlocksFieldIdentity,
  reconcileBlocksFieldIdentity,
} from "../shared/blocks-field-identity";
import { createContentEditorStructuralSchema } from "../shared/content-editor-structural-schema";
import { canonicalizeNfm, docToNfm, nfmToDoc } from "../shared/nfm";
import { knownLossTest } from "./known-loss";

// SF-02: an MCP edit that lands while the page is open is never lost. Here
// the open editor's last block is not a paragraph, so the editor holds the
// empty paragraph Tiptap keeps after it, and the saved body leaves that
// paragraph out.

const capturedEditor = vi.hoisted(() => ({ current: null as Editor | null }));
vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      capturedEditor.current = editor;
      return editor;
    },
  };
});
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/uploads", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/uploads")
  >()),
  useFileUploadStatus: () => ({ isSuccess: true, data: { configured: true } }),
}));
const UPLOADED_SRC = "https://cdn.example.test/uploads/probe.mp4";
vi.mock("../app/components/editor/image-upload", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../app/components/editor/image-upload")
  >()),
  uploadVideoFile: async () => UPLOADED_SRC,
}));

const LEGACY_LOSS = {
  lane: "unowned",
  outcome: "SF-02",
  reason:
    "The open tab merges a saved snapshot with prefer-live against a base parsed from the saved body, which lacks the editor's trailing empty paragraph, so an MCP edit that inserts at the end of the base is dropped and the tab saves the page without it.",
} as const;

// The open tab waits out recent typing (1.5 s, rechecking every 700 ms)
// before it merges a newer snapshot.
const MERGE_SETTLE_MS = 3_000;

interface Snapshot {
  content: string;
  revision: string;
  updatedAt: string;
  collabRevision: string | null;
}

interface MergeReport {
  status: string;
  content: string;
}

describe("SF-02 MCP edit beside the editor's trailing empty paragraph", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let ydoc: Y.Doc;
  let merges: MergeReport[];
  let remoteSnapshots: string[];
  let immediateSaves: string[];

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    ydoc = new Y.Doc();
    merges = [];
    remoteSnapshots = [];
    immediateSaves = [];
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    ydoc.destroy();
    container.remove();
    capturedEditor.current = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function settle(ms: number) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  /** Render the editor the way DocumentEditor does for a page it can edit. */
  async function show(snapshot: Snapshot) {
    await act(async () =>
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(
            TooltipProvider,
            null,
            createElement(
              QueryClientProvider,
              { client: queryClient },
              createElement(VisualEditor, {
                documentId: "page",
                content: snapshot.content,
                contentUpdatedAt: snapshot.updatedAt,
                contentRevision: snapshot.revision,
                collabContentRevision: snapshot.collabRevision,
                onChange: () => {},
                onSaveContent: (markdown) => {
                  immediateSaves.push(markdown);
                  return true;
                },
                onBaseAwareReconcile: (result) =>
                  merges.push({
                    status: result.status,
                    content: result.content,
                  }),
                onRemoteSnapshotChange: (markdown) =>
                  remoteSnapshots.push(markdown),
                ydoc,
                collabSynced: true,
                editable: true,
              }),
            ),
          ),
        ),
      ),
    );
    await settle(100);
  }

  function editor(): Editor {
    const current = capturedEditor.current;
    if (!current) throw new Error("The editor did not mount.");
    return current;
  }

  function shownBody(): string {
    return docToNfm(editor().getJSON() as never);
  }

  /** `/video`, then Upload file through the block's own picker. */
  async function uploadVideoThroughSlashCommand() {
    act(() => {
      editor().commands.focus("end");
      insertMediaPlaceholder(editor(), "video");
    });
    await settle(50);
    const picker = container.querySelector<HTMLInputElement>(
      'input[type="file"][accept="video/*"]',
    );
    if (!picker) throw new Error("The video block rendered no file picker.");
    Object.defineProperty(picker, "files", {
      configurable: true,
      value: [new File(["video"], "probe.mp4", { type: "video/mp4" })],
    });
    await act(async () => {
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle(50);
  }

  /** Commit `content` to the live copy as a switched page's server writer does. */
  function writeThroughLiveCopy(content: string) {
    const server = new Y.Doc();
    try {
      Y.applyUpdate(server, Y.encodeStateAsUpdate(ydoc));
      const schema = createContentEditorStructuralSchema();
      const fragment = server.getXmlFragment("default");
      const { meta } = initProseMirrorDoc(fragment, schema);
      updateYFragment(
        server,
        fragment,
        schema.nodeFromJSON(nfmToDoc(content)),
        meta,
      );
      act(() => {
        Y.applyUpdate(
          ydoc,
          Y.encodeStateAsUpdate(server, Y.encodeStateVector(ydoc)),
        );
      });
    } finally {
      server.destroy();
    }
  }

  /**
   * Everything the open tab would save next holds every block of `expected`:
   * its own body, and each body it reported for DocumentEditor to save.
   */
  function expectNothingDropped(expected: string) {
    const canonical = canonicalizeNfm(expected);
    expect(canonicalizeNfm(shownBody()), "the open editor's body").toBe(
      canonical,
    );
    for (const merge of merges)
      expect(
        canonicalizeNfm(merge.content),
        `a ${merge.status} merge the tab saves`,
      ).toBe(canonical);
    for (const snapshot of remoteSnapshots)
      expect(canonicalizeNfm(snapshot), "a merged body the tab reports").toBe(
        canonical,
      );
  }

  /** Blocks the next save would record as deleted, as the page's block history does. */
  function blocksDeletedBySave(bodies: string[]): string[] {
    let stored = materializeLegacyBlocksFieldIdentity({
      documentId: "page",
      propertyId: "content",
      markdown: bodies[0]!,
    });
    let next = 0;
    for (const markdown of bodies.slice(1)) {
      stored = reconcileBlocksFieldIdentity({
        documentId: "page",
        propertyId: "content",
        previous: stored,
        markdown,
        createId: () => `block_${next++}`,
      });
    }
    return stored.blocks
      .filter((block) => block.deletedAtRevision === stored.revision)
      .map((block) => `${block.kind}: ${block.markdown}`);
  }

  async function openPageWithJustUploadedVideo(): Promise<string> {
    await show({
      content: "",
      revision: "rev-1",
      updatedAt: new Date(1_000).toISOString(),
      collabRevision: null,
    });
    await uploadVideoThroughSlashCommand();

    const { doc, selection } = editor().state;
    expect(doc.firstChild?.type.name, "the uploaded video").toBe("video");
    expect(doc.firstChild?.attrs.src).toBe(UPLOADED_SRC);
    expect(
      selection instanceof NodeSelection && selection.from === 0,
      "the video stays selected after the upload",
    ).toBe(true);
    expect(
      doc.childCount === 2 && doc.lastChild?.type.name === "paragraph",
      "the editor keeps an empty paragraph after the video",
    ).toBe(true);

    const blockId = doc.firstChild?.attrs.blockId;
    expect(blockId, "the id comments use for the video").toMatch(/^video-/);
    const saved = immediateSaves.at(-1);
    expect(saved, "the upload's save leaves that paragraph out").toBe(
      `<video src="${UPLOADED_SRC}" id="${blockId}"></video>`,
    );
    await show({
      content: saved!,
      revision: "rev-2",
      updatedAt: new Date(2_000).toISOString(),
      collabRevision: null,
    });
    return saved!;
  }

  async function openPageWithClosingHeading(): Promise<string> {
    const body = "Opening paragraph.\n\n## Closing heading";
    prosemirrorJSONToYXmlFragment(
      createContentEditorStructuralSchema(),
      nfmToDoc(body),
      ydoc.getXmlFragment("default"),
    );
    await show({
      content: body,
      revision: "rev-1",
      updatedAt: new Date(1_000).toISOString(),
      collabRevision: null,
    });
    expect(
      editor().state.doc.lastChild?.type.name,
      "the editor keeps an empty paragraph after the heading",
    ).toBe("paragraph");
    return body;
  }

  /** Place a copy of the saved video between two headings over MCP. */
  function placeOverMcp(saved: string): string {
    return [
      "## Placed over MCP",
      saved,
      "## Uploaded in the editor",
      saved,
    ].join("\n\n");
  }

  it("a closing heading keeps its saved body while the editor adds an empty paragraph", async () => {
    const body = await openPageWithClosingHeading();
    expect(canonicalizeNfm(shownBody())).toBe(canonicalizeNfm(body));
  });

  it(
    "legacy page: the open tab keeps an MCP edit made beside a video it just uploaded",
    knownLossTest(LEGACY_LOSS),
    async () => {
      const saved = await openPageWithJustUploadedVideo();
      const edited = placeOverMcp(saved);
      await show({
        content: edited,
        revision: "rev-3",
        updatedAt: new Date(3_000).toISOString(),
        collabRevision: null,
      });
      await settle(MERGE_SETTLE_MS);

      const nextSave = merges.at(-1)?.content ?? shownBody();
      expect(
        blocksDeletedBySave([saved, edited, nextSave]),
        "blocks the tab's next save deletes",
      ).toEqual([]);
      expectNothingDropped(edited);
    },
  );

  it(
    "legacy page: the open tab keeps an MCP append after a closing heading",
    knownLossTest(LEGACY_LOSS),
    async () => {
      const body = await openPageWithClosingHeading();

      const appended = `${body}\n\nParagraph the agent appended over MCP.`;
      await show({
        content: appended,
        revision: "rev-2",
        updatedAt: new Date(3_000).toISOString(),
        collabRevision: null,
      });
      await settle(MERGE_SETTLE_MS);

      expectNothingDropped(appended);
    },
  );

  it("switched page: an MCP edit through the live copy keeps every block beside a just-uploaded video", async () => {
    const saved = await openPageWithJustUploadedVideo();
    const edited = placeOverMcp(saved);
    writeThroughLiveCopy(edited);
    await show({
      content: edited,
      revision: "rev-3",
      updatedAt: new Date(3_000).toISOString(),
      collabRevision: "rev-3",
    });
    await settle(MERGE_SETTLE_MS);

    expectNothingDropped(edited);
  });
});
