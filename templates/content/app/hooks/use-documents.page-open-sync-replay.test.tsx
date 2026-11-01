// @vitest-environment happy-dom

import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The document head sends the page read before the app has a query for the
// page, or any sync watching for changes. Sync can invalidate the page's key
// in that window, which reaches nothing, or while the app's fetch of the
// head's answer is out, which the fetch's success then clears. The answer
// names the change feed's cursor its server read at, so the changes sync
// made after it are played back when it lands: a page or draft older than
// them lands invalidated, and the editor reads the page itself rather than
// taking it as this open's read.

const server = vi.hoisted(() => ({ calls: [] as string[] }));
const syncLog = vi.hoisted(() => ({
  entries: [] as Array<{ version: number; queryKey?: readonly unknown[] }>,
}));

vi.mock("@agent-native/core/client/use-session", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/use-session")
  >()),
  // The session these reads were sent as is the one the tab accepts.
  sessionReadIdentity: () => ({ generation: 0, transport: server }),
  sessionReadIdentityStatus: () => "current",
}));
vi.mock("@agent-native/core/client/use-db-sync", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/use-db-sync")
  >()),
  syncInvalidationsAfter: (_queryClient: unknown, cursor?: string) => {
    const readAt = cursor === undefined ? -1 : Number(cursor.split(".")[0]);
    return syncLog.entries
      .filter((entry) => entry.version > readAt)
      .map(({ queryKey }) => (queryKey ? { queryKey } : {}));
  },
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  isOpenAiMcpAppHost: () => false,
}));
vi.mock("@agent-native/core/client/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/host")>()),
  isEmbedMcpChatBridgeActive: () => false,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (name: string) => {
    server.calls.push(name);
    if (name === "get-preview-document-draft") {
      return Promise.resolve({ editable: true, draft: "the newer draft" });
    }
    return Promise.resolve({
      id: "doc-1",
      title: "Plan, edited elsewhere",
      canEdit: true,
    });
  },
  getBrowserTabId: () => "tab-1",
  useDbSync: vi.fn(),
  useActionQuery: vi.fn(),
  useActionMutation: vi.fn(),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { adoptPageOpenRead } from "../lib/page-open-reads";
import { startPageOpenDocumentReads } from "./use-documents";

const pageKey = ["action", "get-document", { id: "doc-1" }];
const draftKey = [
  "action",
  "get-preview-document-draft",
  { documentId: "doc-1" },
];

describe("a page the head read before sync's changes to it", () => {
  let queryClient: QueryClient;
  let answerHeadRead: (syncCursor: string) => void;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    server.calls = [];
    syncLog.entries = [];
    let resolve: (answer: { ok: true; value: unknown }) => void = () => {};
    const answer = new Promise<{ ok: true; value: unknown }>((done) => {
      resolve = done;
    });
    answerHeadRead = (syncCursor) =>
      resolve({
        ok: true,
        value: {
          document: {
            id: "doc-1",
            title: "Plan",
            canEdit: true,
            previewDraft: { editable: true, draft: "the older draft" },
          },
          syncCursor,
        },
      });
    window.__contentStartupPageRead = {
      id: "doc-1",
      databaseId: null,
      databaseDocumentId: null,
      startedAt: Date.now() - 500,
      fetch: globalThis.fetch,
      answer,
    };
  });

  afterEach(() => {
    delete window.__contentStartupPageRead;
    queryClient.clear();
  });

  async function landed() {
    await vi.waitFor(() => {
      expect(queryClient.getQueryState(pageKey)?.status).toBe("success");
      expect(queryClient.getQueryState(draftKey)?.status).toBe("success");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // The editor takes this open's read as its page only if nothing spoiled it;
  // otherwise it reads the page itself.
  const editorTakes = (queryKey: readonly unknown[]) =>
    adoptPageOpenRead(queryClient, queryKey);

  it("lands invalidated, page and draft, when sync changed them before the app had a query for them", async () => {
    syncLog.entries = [
      { version: 5, queryKey: ["action", "get-document"] },
      { version: 5, queryKey: ["action", "get-preview-document-draft"] },
    ];
    startPageOpenDocumentReads(queryClient, "doc-1", {}, { fromLoad: true });
    answerHeadRead("4.e4");
    await landed();

    expect(queryClient.getQueryState(pageKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(draftKey)?.isInvalidated).toBe(true);
    expect(editorTakes(pageKey)).toBe("none");
  });

  it("lands invalidated when sync changed it while the app's fetch of the head's answer was out", async () => {
    startPageOpenDocumentReads(queryClient, "doc-1", {}, { fromLoad: true });
    await queryClient.invalidateQueries({
      queryKey: ["action", "get-document"],
    });
    answerHeadRead("4.e4");
    await landed();

    expect(queryClient.getQueryState(pageKey)?.isInvalidated).toBe(true);
    expect(editorTakes(pageKey)).toBe("none");
  });

  it("stands when sync changed nothing after the cursor it was read at", async () => {
    syncLog.entries = [{ version: 3, queryKey: ["action", "get-document"] }];
    startPageOpenDocumentReads(queryClient, "doc-1", {}, { fromLoad: true });
    answerHeadRead("4.e4");
    await landed();

    expect(queryClient.getQueryState(pageKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(draftKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryData(pageKey)).toMatchObject({ title: "Plan" });
    expect(editorTakes(pageKey)).toBe("fresh");
  });
});
