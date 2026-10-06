// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const captured = vi.hoisted(() => ({ editor: null as Editor | null }));
vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      captured.editor = editor;
      return editor;
    },
  };
});
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

import {
  restoreCapturedEditorSelection,
  shouldResumeSelectedSuggestionFromPageActions,
  suggestionModeCapability,
} from "./DocumentEditor";
import {
  VisualEditor,
  type VisualEditorSelectionController,
  type VisualEditorSelectionSnapshot,
} from "./VisualEditor";

describe("suggestion mode capability", () => {
  it("blocks entry during a field query gap but keeps an active draft isolated", () => {
    expect(
      suggestionModeCapability({
        permission: true,
        bodyReady: true,
        primaryFieldAvailable: false,
      }),
    ).toEqual({ canStart: false, canContinue: true });
    expect(
      suggestionModeCapability({
        permission: true,
        bodyReady: false,
        primaryFieldAvailable: true,
      }),
    ).toEqual({ canStart: false, canContinue: true });
    expect(
      suggestionModeCapability({
        permission: false,
        bodyReady: true,
        primaryFieldAvailable: true,
      }),
    ).toEqual({ canStart: false, canContinue: false });
  });
});

describe("DocumentEditor selection handoff", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

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
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    captured.editor = null;
  });

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  }

  async function render(
    mode: "canonical" | "suggesting",
    onSelectionControllerChange: (
      controller: VisualEditorSelectionController | null,
    ) => void,
    initialSelection: VisualEditorSelectionSnapshot | null = null,
    documentId = "document-a",
  ) {
    await act(async () => {
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
                key: mode,
                content: "Alpha beta gamma.\nSecond paragraph.",
                contentUpdatedAt: "2026-09-21T00:00:00.000Z",
                documentId,
                onChange: vi.fn(),
                editable: true,
                suggesting: mode === "suggesting",
                initialSelection,
                onSelectionControllerChange,
              }),
            ),
          ),
        ),
      );
    });
    await settle();
  }

  it("restores the exact backward range after the suggesting editor remounts", async () => {
    let controller: VisualEditorSelectionController | null = null;
    const onSelectionControllerChange = (
      next: VisualEditorSelectionController | null,
    ) => {
      controller = next;
    };
    await render("canonical", onSelectionControllerChange);
    const canonical = captured.editor!;
    act(() => {
      canonical.view.dispatch(
        canonical.state.tr.setSelection(
          TextSelection.create(canonical.state.doc, 11, 7),
        ),
      );
      canonical.view.focus();
    });
    const snapshot = controller!.captureSelection();
    expect(snapshot).not.toBeNull();

    const toolbar = document.createElement("div");
    toolbar.setAttribute("data-editor-selection-continuation", "");
    const toolbarButton = document.createElement("button");
    toolbar.append(toolbarButton);
    document.body.append(toolbar);
    toolbarButton.focus();
    expect(controller!.captureSelection()).toBeNull();
    expect(controller!.captureSelection({ includeRemembered: true })).toEqual(
      snapshot,
    );

    const menuItem = document.createElement("button");
    document.body.append(menuItem);
    menuItem.focus();
    expect(controller!.captureSelection()).toBeNull();
    expect(
      controller!.captureSelection({ includeRemembered: true }),
    ).toBeNull();
    expect(controller!.preserveSelection(snapshot!)).toBe(true);
    expect(canonical.view.dom.getAttribute("contenteditable")).toBe("false");
    expect(document.activeElement).toBe(menuItem);
    controller!.releaseSelectionPreservation();
    expect(canonical.view.dom.getAttribute("contenteditable")).toBe("true");
    toolbar.remove();
    menuItem.remove();

    act(() => {
      canonical.view.dispatch(
        canonical.state.tr.setSelection(
          TextSelection.create(canonical.state.doc, 1, 18),
        ),
      );
    });
    expect(controller!.restoreSelection(snapshot!)).toBe(true);
    expect(canonical.state.selection.anchor).toBe(11);
    expect(canonical.state.selection.head).toBe(7);

    await render("suggesting", onSelectionControllerChange, snapshot);
    const suggesting = captured.editor!;

    expect(suggesting).not.toBe(canonical);
    expect(suggesting.state.selection.anchor).toBe(11);
    expect(suggesting.state.selection.head).toBe(7);
    expect(suggesting.state.selection.from).toBe(7);
    expect(suggesting.state.selection.to).toBe(11);
    expect(suggesting.isFocused).toBe(true);
  });

  it("starts a canonical draft instead of reopening a selected suggestion when page actions captured a range", () => {
    const capturedSelection: VisualEditorSelectionSnapshot = {
      anchor: 11,
      head: 7,
      docJson: '{"type":"doc"}',
    };

    expect(
      shouldResumeSelectedSuggestionFromPageActions(capturedSelection),
    ).toBe(false);
    expect(shouldResumeSelectedSuggestionFromPageActions(null)).toBe(true);
  });

  it("clears a remembered selection when the reused editor changes documents", async () => {
    let controller: VisualEditorSelectionController | null = null;
    const onSelectionControllerChange = (
      next: VisualEditorSelectionController | null,
    ) => {
      controller = next;
    };
    await render("canonical", onSelectionControllerChange);
    const editor = captured.editor!;
    act(() => {
      editor.commands.setTextSelection({ from: 7, to: 11 });
      editor.view.focus();
    });

    const toolbar = document.createElement("div");
    toolbar.setAttribute("data-editor-selection-continuation", "");
    const toolbarButton = document.createElement("button");
    toolbar.append(toolbarButton);
    document.body.append(toolbar);
    toolbarButton.focus();
    expect(
      controller!.captureSelection({ includeRemembered: true }),
    ).not.toBeNull();

    await render("canonical", onSelectionControllerChange, null, "document-b");

    expect(
      controller!.captureSelection({ includeRemembered: true }),
    ).toBeNull();
    toolbar.remove();
  });

  it("releases preservation and restores the captured range after startup fails", () => {
    const snapshot: VisualEditorSelectionSnapshot = {
      anchor: 11,
      head: 7,
      docJson: '{"type":"doc"}',
    };
    const releaseSelectionPreservation = vi.fn();
    const restoreSelection = vi.fn(() => true);
    const controller: VisualEditorSelectionController = {
      captureSelection: vi.fn(),
      preserveSelection: vi.fn(),
      releaseSelectionPreservation,
      restoreSelection,
    };

    expect(restoreCapturedEditorSelection(controller, snapshot)).toBe(true);
    expect(releaseSelectionPreservation).toHaveBeenCalledTimes(1);
    expect(restoreSelection).toHaveBeenCalledWith(snapshot);
  });
});
