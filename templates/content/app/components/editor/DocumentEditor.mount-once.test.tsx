// @vitest-environment happy-dom

import { nfmToDoc } from "@shared/nfm";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { prosemirrorToYDoc } from "@tiptap/y-tiptap";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { TooltipProvider } from "@/components/ui/tooltip";

const report = vi.hoisted(() => vi.fn());
const marks = vi.hoisted(
  () =>
    [] as Array<{
      name: string;
      editor: Element | null;
      editable: boolean;
      hidden: boolean;
    }>,
);
const seed = vi.hoisted(() => ({
  held: null as null | (() => void),
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/hooks")>();
  return {
    ...actual,
    // The server keeps the first seed it is sent and returns it.
    callAction: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name !== "seed-document-collab") return {};
      await new Promise<void>((resolve) => {
        seed.held = resolve;
      });
      return { stateBase64: args.seedUpdateBase64 };
    }),
  };
});
const observer = vi.hoisted(() => ({
  current: null as null | ReturnType<
    typeof import("./editor-mount-telemetry").createEditorMountObserver
  >,
}));
vi.mock("./editor-mount-telemetry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./editor-mount-telemetry")>();
  const observeEditorMount = (
    ...args: Parameters<typeof actual.observeEditorMount>
  ) => observer.current!(...args);
  observeEditorMount.contextChanged = (
    ...args: Parameters<typeof actual.observeEditorMount.contextChanged>
  ) => observer.current!.contextChanged(...args);
  return { ...actual, observeEditorMount };
});
vi.mock("@/lib/startup-timing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/startup-timing")>();
  return {
    ...actual,
    markStartupMilestone: (name: string) => {
      const editor = document.querySelector(".ProseMirror");
      marks.push({
        name,
        editor,
        editable: editor?.getAttribute("contenteditable") === "true",
        hidden: Boolean(editor?.closest("[hidden]")),
      });
    },
  };
});

import {
  documentBodyAwaitsLiveCopy,
  useReplacesStoredBody,
  visualEditorInstanceKey,
} from "./DocumentEditor";
import { createEditorMountObserver } from "./editor-mount-telemetry";
import { StaticDocumentBody } from "./StaticDocumentBody";
import { suggestedEditorIsolation } from "./suggestions/editor-isolation";
import { getContentEditorSchema, VisualEditor } from "./VisualEditor";

const BODY = "## Plan\n\nFirst paragraph with **bold** text.\n\n- One\n- Two";
const UPDATED_AT = "2026-10-15T12:00:00.000Z";

describe("documentBodyAwaitsLiveCopy", () => {
  const editing = {
    canEdit: true,
    suggesting: false,
    liveCopyDocumentId: "page",
    liveCopyStatus: "loading" as const,
  };

  it("holds an editing visit's editor until the live copy loads", () => {
    expect(documentBodyAwaitsLiveCopy(editing)).toBe(true);
    expect(
      documentBodyAwaitsLiveCopy({ ...editing, liveCopyStatus: "ready" }),
    ).toBe(false);
  });

  it("mounts an editor at once when none will replace it", () => {
    // A viewer never binds the live copy, a new page is typed into before it
    // exists, a suggestion edits its draft, and a failed live copy stays
    // read-only until the page reloads.
    expect(documentBodyAwaitsLiveCopy({ ...editing, canEdit: false })).toBe(
      false,
    );
    expect(
      documentBodyAwaitsLiveCopy({ ...editing, liveCopyDocumentId: null }),
    ).toBe(false);
    expect(documentBodyAwaitsLiveCopy({ ...editing, suggesting: true })).toBe(
      false,
    );
    expect(
      documentBodyAwaitsLiveCopy({ ...editing, liveCopyStatus: "error" }),
    ).toBe(false);
  });
});

interface VisitProps {
  canEdit: boolean;
  liveCopyStatus: "loading" | "ready";
  ydoc: Y.Doc;
  content?: string;
  /** Appended to the editor's instance key, as a later remount changes it. */
  remount?: string;
}

// Mounts the body the way DocumentEditor does: the static body while the live
// copy loads, then the editor under its instance key.
function Visit(args: VisitProps) {
  const content = args.content ?? BODY;
  const ready = args.liveCopyStatus === "ready";
  const collabEditorEnabled = args.canEdit && ready;
  const isolation = suggestedEditorIsolation({
    suggesting: false,
    canSuggest: false,
    canEdit: collabEditorEnabled,
    collaborationReady: collabEditorEnabled,
    canonicalUpdatedAt: UPDATED_AT,
    draftUpdatedAt: UPDATED_AT,
  });
  const awaitsLiveCopy = documentBodyAwaitsLiveCopy({
    canEdit: args.canEdit,
    suggesting: false,
    liveCopyDocumentId: "page",
    liveCopyStatus: args.liveCopyStatus,
  });
  const replacesStoredBody = useReplacesStoredBody("page", awaitsLiveCopy);
  if (awaitsLiveCopy)
    return createElement(
      "div",
      { className: "visual-editor-wrapper" },
      createElement(StaticDocumentBody, {
        schema: getContentEditorSchema(),
        content,
        documentId: "page",
      }),
    );
  return createElement(VisualEditor, {
    key: `${visualEditorInstanceKey({
      documentId: "page",
      documentUpdatedAt: UPDATED_AT,
      isLocalFileDocument: false,
      canEdit: args.canEdit,
      collabEditorEnabled,
      hasYDoc: ready,
    })}${args.remount ?? ""}`,
    visitKey: "route",
    editorMountMode: args.canEdit ? "editing" : "readonly",
    documentId: "page",
    content,
    contentUpdatedAt: UPDATED_AT,
    contentRevision: "body:1",
    ydoc: isolation.bindCanonicalYDoc ? args.ydoc : null,
    replacesStoredBody,
    collabSynced: true,
    editable: isolation.editable,
    onChange: () => {},
  });
}

describe("an editor visit", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    // The observer follows one visit per tab; each test is a fresh tab.
    observer.current = createEditorMountObserver(report, () => "visit");
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
    report.mockReset();
    marks.length = 0;
    seed.held = null;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  async function settle(ms = 50) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  function liveCopyOf(content: string) {
    return prosemirrorToYDoc(
      getContentEditorSchema().nodeFromJSON(nfmToDoc(content)),
      "default",
    );
  }

  async function renderVisit(args: VisitProps) {
    const body = createElement(Visit, args);
    await act(async () =>
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(
            TooltipProvider,
            null,
            createElement(QueryClientProvider, { client: queryClient }, body),
          ),
        ),
      ),
    );
    await settle();
  }

  const editableMarks = () =>
    marks.filter((mark) => mark.name === "content-editable");

  it("shows the stored body, then mounts one editor bound to the live copy", async () => {
    const ydoc = liveCopyOf(BODY);
    await renderVisit({ canEdit: true, liveCopyStatus: "loading", ydoc });

    const staticBody = container.querySelector("[data-static-document-body]");
    expect(staticBody?.textContent).toContain("First paragraph with bold");
    expect(container.querySelector(".ProseMirror")).toBeNull();
    expect(report).not.toHaveBeenCalled();
    expect(editableMarks()).toEqual([]);

    await renderVisit({ canEdit: true, liveCopyStatus: "ready", ydoc });
    const editor = container.querySelector(".ProseMirror");
    expect(editor?.textContent).toContain("First paragraph with bold");
    expect(container.querySelector("[data-static-document-body]")).toBeNull();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenLastCalledWith({
      id: "page",
      visitId: "visit",
      outcome: "initial",
      mode: "editing",
    });
    expect(editableMarks()).toEqual([
      { name: "content-editable", editor, editable: true, hidden: false },
    ]);

    await renderVisit({ canEdit: true, liveCopyStatus: "ready", ydoc });
    expect(container.querySelector(".ProseMirror")).toBe(editor);
    expect(report).toHaveBeenCalledTimes(1);
    ydoc.destroy();
  });

  it("keeps the stored body up until the editor's node views have drawn", async () => {
    const content = [
      "Intro paragraph.",
      "",
      '<callout icon="💡">',
      "\tCallout text",
      "</callout>",
      "",
      "<details open>",
      "<summary>Toggle</summary>",
      "\tToggle text",
      "</details>",
    ].join("\n");
    const ydoc = liveCopyOf(content);
    await renderVisit({
      canEdit: true,
      liveCopyStatus: "loading",
      ydoc,
      content,
    });
    const drawnNode = container.querySelector(
      "[data-static-document-body] > *",
    );
    expect(drawnNode).not.toBeNull();

    // A view whose component has not rendered holds at most its content hole.
    const undrawnShown: string[] = [];
    let handedOver: boolean | null = null;
    const observer = new MutationObserver(() => {
      const standIn = container.querySelector("[data-static-document-body]");
      const editor = container.querySelector(".ProseMirror");
      if (standIn && editor && handedOver === null)
        handedOver = standIn.firstElementChild === drawnNode;
      if (!editor || editor.closest("[hidden]")) return;
      for (const renderer of editor.querySelectorAll(".react-renderer")) {
        const first = renderer.firstElementChild;
        if (!first || first.hasAttribute("data-node-view-content-react"))
          undrawnShown.push(renderer.className);
      }
    });
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });
    await renderVisit({
      canEdit: true,
      liveCopyStatus: "ready",
      ydoc,
      content,
    });
    observer.disconnect();

    expect(undrawnShown).toEqual([]);
    expect(handedOver).toBe(true);
    const editor = container.querySelector(".ProseMirror");
    expect(editor?.closest("[hidden]")).toBeNull();
    expect(
      editor?.querySelector("[data-notion-callout-content]")?.textContent,
    ).toContain("Callout text");
    expect(container.querySelector("[data-static-document-body]")).toBeNull();
    expect(report).toHaveBeenCalledTimes(1);
    expect(editableMarks()).toEqual([
      { name: "content-editable", editor, editable: true, hidden: false },
    ]);
    ydoc.destroy();
  });

  it("shows a later remount's editor at once, with no stored body over it", async () => {
    const content = [
      "Intro paragraph.",
      "",
      '<callout icon="💡">',
      "\tCallout text",
      "</callout>",
    ].join("\n");
    const ydoc = liveCopyOf(content);
    await renderVisit({
      canEdit: true,
      liveCopyStatus: "loading",
      ydoc,
      content,
    });
    await renderVisit({
      canEdit: true,
      liveCopyStatus: "ready",
      ydoc,
      content,
    });
    const handedOver = container.querySelector(".ProseMirror");

    const editorWithheld: boolean[] = [];
    const observer = new MutationObserver(() => {
      const editor = container.querySelector(".ProseMirror");
      editorWithheld.push(
        Boolean(container.querySelector("[data-static-document-body]")) ||
          Boolean(editor?.closest("[hidden]")),
      );
    });
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });
    await renderVisit({
      canEdit: true,
      liveCopyStatus: "ready",
      ydoc,
      content,
      remount: ":again",
    });
    observer.disconnect();

    const editor = container.querySelector(".ProseMirror");
    expect(editor).not.toBe(handedOver);
    expect(editorWithheld.length).toBeGreaterThan(0);
    expect(editorWithheld).not.toContain(true);
    ydoc.destroy();
  });

  it("starts an image the stored body could not load as broken in the editor", async () => {
    const content = "![Alt text](https://example.com/missing.png)";
    const ydoc = liveCopyOf(content);
    await renderVisit({
      canEdit: true,
      liveCopyStatus: "loading",
      ydoc,
      content,
    });
    await act(async () => {
      container
        .querySelector("[data-static-document-body] img")!
        .dispatchEvent(new Event("error"));
    });
    expect(
      container.querySelector(
        "[data-static-document-body] .media-block__broken",
      ),
    ).not.toBeNull();

    const imageShown: boolean[] = [];
    const observer = new MutationObserver(() => {
      const editor = container.querySelector(".ProseMirror");
      if (!editor || editor.closest("[hidden]")) return;
      imageShown.push(
        Boolean(editor.querySelector("img.media-block__content")),
      );
    });
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });
    await renderVisit({
      canEdit: true,
      liveCopyStatus: "ready",
      ydoc,
      content,
    });
    observer.disconnect();

    const editor = container.querySelector(".ProseMirror");
    expect(editor?.closest("[hidden]")).toBeNull();
    expect(editor?.querySelector(".media-block__broken")).not.toBeNull();
    expect(imageShown.length).toBeGreaterThan(0);
    expect(imageShown).not.toContain(true);
    ydoc.destroy();
  });

  it("keeps the stored body in place of a never-seeded live copy until the server seeds it", async () => {
    const ydoc = new Y.Doc();
    await renderVisit({ canEdit: true, liveCopyStatus: "loading", ydoc });
    await renderVisit({ canEdit: true, liveCopyStatus: "ready", ydoc });

    const editor = container.querySelector(".ProseMirror");
    expect(editor).not.toBeNull();
    expect(editor?.closest("[hidden]")).not.toBeNull();
    expect(
      container.querySelector("[data-static-document-body]")?.textContent,
    ).toContain("First paragraph with bold");
    expect(seed.held).not.toBeNull();
    expect(editableMarks()).toEqual([]);

    await act(async () => seed.held!());
    await settle();

    expect(container.querySelector(".ProseMirror")).toBe(editor);
    expect(editor?.closest("[hidden]")).toBeNull();
    expect(editor?.textContent).toContain("First paragraph with bold");
    expect(container.querySelector("[data-static-document-body]")).toBeNull();
    expect(report).toHaveBeenCalledTimes(1);
    expect(editableMarks()).toEqual([
      { name: "content-editable", editor, editable: true, hidden: false },
    ]);
    ydoc.destroy();
  });

  it("mounts a viewer's one editor from the stored body at once", async () => {
    const ydoc = liveCopyOf(BODY);
    await renderVisit({ canEdit: false, liveCopyStatus: "loading", ydoc });
    const editor = container.querySelector(".ProseMirror");
    expect(editor?.textContent).toContain("First paragraph with bold");
    expect(editor?.getAttribute("contenteditable")).toBe("false");

    await renderVisit({ canEdit: false, liveCopyStatus: "ready", ydoc });
    expect(container.querySelector(".ProseMirror")).toBe(editor);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ outcome: "initial", mode: "readonly" }),
    );
    expect(editableMarks()).toEqual([]);
    ydoc.destroy();
  });
});
