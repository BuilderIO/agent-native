// @vitest-environment happy-dom

import type { EditorMountMode } from "@shared/editor-mount-outcomes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const captured = vi.hoisted(() => ({ editor: null as Editor | null }));
const report = vi.hoisted(() => vi.fn());
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
vi.mock("./editor-mount-telemetry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./editor-mount-telemetry")>();
  return {
    ...actual,
    observeEditorMount: actual.createEditorMountObserver(report, () => "visit"),
  };
});

import { VisualEditor } from "./VisualEditor";

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("observes real editor creation once in StrictMode while slow telemetry cannot delay edits", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("{}", { headers: { "content-type": "application/json" } }),
    ),
  );
  let finish!: () => void;
  report.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const onChange = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  async function render(
    key: string,
    editable = true,
    mode: EditorMountMode = "editing",
  ) {
    await act(async () =>
      root!.render(
        createElement(
          StrictMode,
          null,
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
                  key,
                  documentId: "page",
                  visitKey: "route",
                  editorMountMode: mode,
                  content: "Alpha paragraph",
                  onChange,
                  ydoc: null,
                  editable,
                  suggesting: mode === "suggesting",
                }),
              ),
            ),
          ),
        ),
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
  }
  await render("first");
  expect(report).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenLastCalledWith({
    id: "page",
    visitId: "visit",
    outcome: "initial",
    mode: "editing",
  });
  await act(async () => {
    captured.editor!.view.dispatch(
      captured.editor!.state.tr.insertText("Inserted"),
    );
  });
  expect(captured.editor!.getText()).toContain("Inserted");
  await render("first", false);
  expect(report).toHaveBeenCalledTimes(1);
  await render("second", false);
  expect(report).toHaveBeenCalledTimes(2);
  expect(report).toHaveBeenLastCalledWith({
    id: "page",
    visitId: "visit",
    outcome: "remount",
    mode: "editing",
  });
  await render("third", true, "suggesting");
  expect(report).toHaveBeenCalledTimes(3);
  expect(report).toHaveBeenLastCalledWith({
    id: "page",
    visitId: "visit",
    outcome: "mode_switch",
    mode: "suggesting",
  });
  await render("fourth", false, "readonly");
  expect(report).toHaveBeenCalledTimes(4);
  expect(report).toHaveBeenLastCalledWith({
    id: "page",
    visitId: "visit",
    outcome: "mode_switch",
    mode: "readonly",
  });
  finish();
  queryClient.clear();
});
