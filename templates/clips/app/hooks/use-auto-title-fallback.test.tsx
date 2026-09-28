// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  sendToAgentChatAndConfirm: vi.fn(async (options: { tabId?: string }) => ({
    tabId: options.tabId,
    delivered: true,
  })),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  generateTabId: () => "chat-123",
  sendToAgentChatAndConfirm: mocks.sendToAgentChatAndConfirm,
}));
vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
}));
vi.mock("@agent-native/core/client/hooks", async () => {
  const React = await import("react");
  return {
    bumpChangeVersion: vi.fn(),
    callAction: (...args: unknown[]) => mocks.callAction(...args),
    getChangeVersion: () => 0,
    useChangeVersion: () => 0,
    // Stands in for React Query: the action is served by the same `callAction`
    // mock the tests configure, and `refetch` resolves with the new data.
    useActionQuery: (name: string, args: unknown) => {
      const [data, setData] = React.useState<unknown>();
      const refetch = React.useCallback(async () => {
        const next = await mocks.callAction(name, args, { method: "GET" });
        setData(next);
        return { data: next };
      }, []);
      React.useEffect(() => {
        void refetch();
      }, [refetch]);
      return { data, refetch };
    },
  };
});
vi.mock("@shared/clips-ai-prefs", () => ({
  fullVideoAiModelSelection: () => null,
}));

import { useAutoTitleBridge } from "./use-auto-title";

const NOW = Date.parse("2026-09-28T12:00:00.000Z");

function candidate(id: string, ageMs: number) {
  return { id, createdAt: new Date(NOW - ageMs).toISOString() };
}

function TestBridge() {
  useAutoTitleBridge();
  return null;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function renderWith(result: Record<string, unknown>) {
  mocks.callAction.mockImplementation(async (name: string) =>
    name === "list-ai-requests" ? result : {},
  );
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => {
    root.render(<TestBridge />);
  });
}

function regenerateTitleCalls() {
  return mocks.callAction.mock.calls.filter(
    ([name]) => name === "regenerate-title",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("auto-title fallback", () => {
  it("regenerates the title of an overdue candidate once", async () => {
    await renderWith({
      requests: [],
      titleCandidates: [candidate("rec_old", 5 * 60_000)],
    });

    await vi.waitFor(() => expect(regenerateTitleCalls()).toHaveLength(1));
    expect(regenerateTitleCalls()[0]).toEqual([
      "regenerate-title",
      { recordingId: "rec_old" },
    ]);
  });

  it("waits for a candidate younger than two minutes", async () => {
    await renderWith({
      requests: [],
      titleCandidates: [candidate("rec_new", 30_000)],
    });

    await vi.waitFor(() =>
      expect(mocks.callAction).toHaveBeenCalledWith(
        "list-ai-requests",
        {},
        { method: "GET" },
      ),
    );
    expect(regenerateTitleCalls()).toHaveLength(0);
  });

  it("delivers a queued request instead of falling back", async () => {
    await renderWith({
      requests: [
        {
          kind: "regenerate-title",
          recordingId: "rec_old",
          requestedAt: "2026-09-28T11:55:00.000Z",
          message: "Title this clip",
        },
      ],
      titleCandidates: [candidate("rec_old", 5 * 60_000)],
    });

    await vi.waitFor(() =>
      expect(mocks.sendToAgentChatAndConfirm).toHaveBeenCalledOnce(),
    );
    expect(regenerateTitleCalls()).toHaveLength(0);
  });

  it("delivers queued requests for recordings that are not title candidates", async () => {
    await renderWith({
      requests: [
        {
          kind: "regenerate-chapters",
          recordingId: "rec_titled",
          requestedAt: "2026-09-28T11:55:00.000Z",
          currentTitle: "Quarterly planning",
          message: "Generate chapters",
        },
      ],
      titleCandidates: [],
    });

    await vi.waitFor(() =>
      expect(mocks.sendToAgentChatAndConfirm).toHaveBeenCalledOnce(),
    );
    const [options] = mocks.sendToAgentChatAndConfirm.mock.calls[0] as [
      { context: string },
    ];
    expect(JSON.parse(options.context).currentTitle).toBe("Quarterly planning");
  });
});
