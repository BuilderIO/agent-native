// @vitest-environment happy-dom

import type { DocumentFlushRequest } from "@shared/document-flush-protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { createDocumentFlushParticipant } from "./document-flush-participant";
import {
  VisualEditor,
  type VisualEditorPersistenceController,
} from "./VisualEditor";

const fixture = vi.hoisted(() => ({ editor: null as Editor | null }));
vi.mock("@tiptap/react", async (original) => {
  const actual = await original<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      fixture.editor = editor;
      return editor;
    },
  };
});
vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;
let controller: VisualEditorPersistenceController | null;
const onChange = vi.fn();
const onSaveContent = vi.fn(async () => "persisted" as const);

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("{}", { headers: { "content-type": "application/json" } }),
    ),
  );
  fixture.editor = null;
  controller = null;
  onChange.mockClear();
  onSaveContent.mockClear();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
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
              content: "Saved body",
              contentUpdatedAt: "2026-10-19T12:00:00Z",
              editable: true,
              onChange,
              onSaveContent,
              onPersistenceControllerChange: (next) => {
                controller = next;
              },
            }),
          ),
        ),
      ),
    ),
  );
  await act(async () => {
    await vi.waitFor(() => expect(controller).not.toBeNull());
  });
  onChange.mockClear();
  onSaveContent.mockClear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function input(text: string) {
  act(() => {
    const editor = fixture.editor!;
    editor.view.dom.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }),
    );
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.view.dispatch(editor.state.tr.insertText(text));
  });
}
function barrier() {
  const identity = { clientId: 123, editorSessionId: "visual-editor" };
  let request: DocumentFlushRequest = {
    protocol: 2,
    id: "doc",
    requestId: "fresh-request",
    phase: "prepare",
    phaseToken: "prepare",
    prepareToken: "prepare",
    expiresAt: Date.now() + 4000,
    targets: [identity],
  };
  const compare = vi.fn(async () => true);
  const respond = createDocumentFlushParticipant({
    documentId: () => "doc",
    identity: () => identity,
    snapshot: () => ({
      identity: identity.editorSessionId,
      generation: 0,
      observation: 0,
      valueEpoch: 0,
      visualVersion: controller?.version ?? null,
      title: "Title",
      content: "Saved body",
      clean: true,
      claim: {
        kind: "document",
        save: { revision: "r1", title: "Title", titleUpdatedAt: null },
      },
    }),
    drain: async () => {},
    read: (async () => request) as any,
    compare,
  });
  return {
    prepare: () => respond(request),
    verify: () => {
      request = { ...request, phase: "verify", phaseToken: "after-S" };
      return respond(request);
    },
    acks: () =>
      compare.mock.calls.map(
        (call) => (call as unknown[])[2] as { status: string },
      ),
  };
}

it("rejects verification for actual visual input before its parent onChange is emitted", async () => {
  const flow = barrier();
  await flow.prepare();
  expect(flow.acks()[0].status).toBe("prepared");
  input(" new input");
  expect(onChange).not.toHaveBeenCalled();
  await flow.verify();
  expect(flow.acks()[1].status).toBe("changed");
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(onChange).toHaveBeenCalledWith("Saved body new input");
});

it("invalidates actual visual change-back even before either queued parent callback runs", async () => {
  const flow = barrier();
  await flow.prepare();
  input("x");
  act(() => {
    const editor = fixture.editor!;
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(editor.state.tr.delete(end - 1, end));
  });
  expect(fixture.editor!.getText()).toBe("Saved body");
  expect(onChange).not.toHaveBeenCalled();
  await flow.verify();
  expect(flow.acks()[1].status).toBe("changed");
});

it("flushes actual un-emitted visual input through the immediate callback", async () => {
  input(" un-emitted");
  expect(onChange).not.toHaveBeenCalled();
  await expect(controller!.flushLatest()).resolves.toBe(true);
  expect(onSaveContent).toHaveBeenCalledExactlyOnceWith(
    "Saved body un-emitted",
  );
});

it("keeps verification stable for selection-only transactions", async () => {
  const flow = barrier();
  await flow.prepare();
  act(() => {
    fixture.editor!.commands.setTextSelection(2);
  });
  await flow.verify();
  expect(flow.acks()[1].status).toBe("verified");
});
