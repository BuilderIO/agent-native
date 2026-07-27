// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  sendToAgentChat: vi.fn(() => "workflow-tab"),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: mocks.sendToAgentChat,
}));
vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => mocks.callAction(...args),
  useChangeVersions: () => 0,
}));
vi.mock("@shared/clips-ai-prefs", () => ({
  fullVideoAiModelSelection: () => null,
}));
vi.mock("./use-library", () => ({
  useRecordings: () => ({
    data: {
      recordings: [
        {
          id: "rec_123",
          title: "Demo recording",
          status: "ready",
          createdAt: "2026-07-14T12:00:00.000Z",
        },
      ],
    },
  }),
}));

import { useAutoTitleBridge } from "./use-auto-title";

const requestedAt = "2026-07-14T12:00:00.000Z";
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function TestBridge() {
  useAutoTitleBridge();
  return null;
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.callAction.mockImplementation(async (name: string) => {
    if (name === "list-ai-requests") {
      return {
        requests: [
          {
            kind: "generate-workflow",
            recordingId: "rec_123",
            requestedAt,
            message: "Generate an email summary",
          },
        ],
      };
    }
    return { reconciled: true };
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
  );

  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => {
    root.render(<TestBridge />);
  });
  await vi.waitFor(() => expect(mocks.sendToAgentChat).toHaveBeenCalledOnce());
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("workflow generation cancellation", () => {
  it("reconciles only when the exact workflow agent tab stops", async () => {
    window.dispatchEvent(
      new CustomEvent("agentNative.chatRunning", {
        detail: { isRunning: false, tabId: "another-tab" },
      }),
    );
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "reconcile-workflow-generation",
      expect.anything(),
    );

    window.dispatchEvent(
      new CustomEvent("agentNative.chatRunning", {
        detail: { isRunning: false, tabId: "workflow-tab" },
      }),
    );

    await vi.waitFor(() =>
      expect(mocks.callAction).toHaveBeenCalledWith(
        "reconcile-workflow-generation",
        { recordingId: "rec_123", requestedAt },
      ),
    );
  });
});
