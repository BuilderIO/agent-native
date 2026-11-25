// @vitest-environment happy-dom

import type { Document } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LinkedLocalDocumentAgentBridge } from "./LinkedLocalDocumentAgentBridge";

const bridge = vi.hoisted(() => ({
  actions: [] as {
    run: (args: Record<string, unknown>) => Promise<unknown>;
  }[],
  file: {
    content: "",
    icon: null as string | null,
    isFavorite: undefined as boolean | undefined,
  },
  write: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "tab",
}));
vi.mock("@agent-native/core/client/host", () => ({
  startAgentNativeBrowserSessionBridge: (options: {
    actions: typeof bridge.actions;
  }) => {
    bridge.actions = options.actions;
    return { stop: () => undefined };
  },
}));
vi.mock("@/lib/local-content-source-files", () => ({
  readDocumentFromLinkedLocalSource: async (base: Document) => ({
    ok: true,
    path: "notes.md",
    runtime: "desktop",
    revision: "r1",
    content: bridge.file.content,
    document: {
      ...base,
      ...bridge.file,
      isFavorite: bridge.file.isFavorite ?? base.isFavorite,
    },
  }),
  writeDocumentToLinkedLocalSource: async (next: Document) => {
    bridge.write(next.content);
    bridge.file.content = next.content;
    return { ok: true, path: "notes.md", runtime: "desktop", revision: "r1" };
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const page: Document = {
  id: "doc_1234",
  parentId: null,
  title: "Notes",
  content: "Alpha\nBeta",
  description: "",
  icon: "🌿",
  position: 4,
  isFavorite: true,
  hideFromSearch: false,
  visibility: "private",
  createdAt: "2026-06-12T00:00:00.000Z",
  updatedAt: "2026-06-12T01:00:00.000Z",
  source: { mode: "local-files", kind: "file", path: "notes.md" },
};
const expectedMetadata = JSON.stringify({
  parentId: null,
  icon: page.icon,
  position: 7,
  isFavorite: false,
  hideFromSearch: false,
  visibility: "private",
});

describe("LinkedLocalDocumentAgentBridge", () => {
  let root: Root;
  const onPersisted = vi.fn();

  beforeEach(async () => {
    bridge.file = {
      content: "Alpha\n\nBeta\n",
      icon: null,
      isFavorite: undefined,
    };
    bridge.write.mockClear();
    onPersisted.mockClear();
    root = createRoot(globalThis.document.createElement("div"));
    await act(async () => {
      root.render(
        <LinkedLocalDocumentAgentBridge
          document={page}
          getEditorSnapshot={() => ({
            title: page.title,
            content: page.content,
          })}
          onPersisted={onPersisted}
        />,
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  const run = (edits: { find: string; replace: string }[]) =>
    Promise.all(
      bridge.actions.map((action) =>
        action.run({
          documentId: page.id,
          expectedContent: page.content,
          expectedTitle: page.title,
          expectedDescription: "",
          expectedMetadata,
          edits,
        }),
      ),
    );

  it("edits the file of a page whose place and favorite aren't the file's to say", async () => {
    await expect(run([{ find: "Beta", replace: "Gamma" }])).resolves.toEqual([
      expect.objectContaining({ status: "persisted" }),
    ]);
    expect(bridge.write).toHaveBeenCalledWith("Alpha\nGamma");
    expect(onPersisted).toHaveBeenCalledWith(
      expect.objectContaining({ icon: "🌿", content: "Alpha\nGamma" }),
      "r1",
    );
  });

  it("keeps the page's favorite when the file records an older one", async () => {
    bridge.file.isFavorite = false;
    await expect(run([{ find: "Beta", replace: "Gamma" }])).resolves.toEqual([
      expect.objectContaining({ status: "persisted" }),
    ]);
    expect(onPersisted).toHaveBeenCalledWith(
      expect.objectContaining({ isFavorite: true, position: 4 }),
      "r1",
    );
  });

  it("refuses when the file's icon changed outside", async () => {
    bridge.file.icon = "🍂";
    await expect(run([{ find: "Beta", replace: "Gamma" }])).resolves.toEqual([
      expect.objectContaining({ status: "conflict" }),
    ]);
    expect(bridge.write).not.toHaveBeenCalled();
  });

  it("reports an edit that changes nothing Content keeps", async () => {
    await expect(
      run([{ find: "Alpha\nBeta", replace: "Alpha\n\nBeta" }]),
    ).resolves.toEqual([expect.objectContaining({ status: "failed" })]);
    expect(bridge.write).not.toHaveBeenCalled();
  });
});
