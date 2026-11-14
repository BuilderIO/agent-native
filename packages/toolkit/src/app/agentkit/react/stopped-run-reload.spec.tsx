// @vitest-environment happy-dom

import { AgentKitClient } from "@agent-native/agentkit/client";
import { createAgentNativeAgentKitTransport } from "@agent-native/core/client/agentkit-chat/transport";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentKitChat } from "./components.js";
import { AgentKitProvider } from "./context.js";

const threadId = "thread-stopped-reload";
const runId = "run-stopped-reload";
const turnId = "turn-stopped-reload";
const startedAt = Date.parse("2026-10-24T10:00:01.000Z");
const partial =
  "13. Kelp forests shelter otters.\n\n14. Mangrove forests grow along tropical co";

// The thread as the server saves it once the user stopped the run mid-reply.
const prompt = {
  id: "user-stopped-reload",
  createdAt: "2026-10-24T10:00:00.000Z",
  role: "user",
  content: [{ type: "text", text: "Write 20 numbered sentences." }],
  metadata: {
    custom: { submittedRunId: runId, submittedTurnId: turnId },
  },
};
const stoppedReply = {
  id: `server-${runId}`,
  createdAt: "2026-10-24T10:00:05.000Z",
  role: "assistant",
  content: [{ type: "text", text: partial }],
  status: { type: "complete", reason: "stop" },
  metadata: {
    runId,
    custom: { turnId, foldedRunIds: [runId], userStopped: true },
  },
};

// A later turn that finished normally.
const laterRunId = "run-after-stop";
const laterStartedAt = Date.parse("2026-10-24T10:01:01.000Z");
const laterPrompt = {
  id: "user-after-stop",
  createdAt: "2026-10-24T10:01:00.000Z",
  role: "user",
  content: [{ type: "text", text: "Say hello." }],
  metadata: {
    custom: { submittedRunId: laterRunId, submittedTurnId: "turn-after-stop" },
  },
};
const laterReply = {
  id: `server-${laterRunId}`,
  createdAt: "2026-10-24T10:01:05.000Z",
  role: "assistant",
  content: [{ type: "text", text: "Hello there." }],
  status: { type: "complete", reason: "stop" },
  metadata: {
    runId: laterRunId,
    custom: { turnId: "turn-after-stop", foldedRunIds: [laterRunId] },
  },
};
const laterRun = {
  id: laterRunId,
  threadId,
  status: "completed",
  startedAt: new Date(laterStartedAt).toISOString(),
  lastSequence: 0,
};
const laterLifecycle = {
  id: laterRunId,
  status: "completed",
  startedAt: laterStartedAt,
  completedAt: laterStartedAt + 4_000,
  errorCode: null,
  abortReason: null,
  terminalReason: "done",
};

function storedThread(messages: unknown[]) {
  const later = messages.includes(laterReply);
  return {
    id: threadId,
    threadData: JSON.stringify({
      messages: messages.map((message, index) => ({
        message,
        parentId:
          index === 0 ? null : (messages[index - 1] as { id: string }).id,
      })),
      agentKit: {
        runs: [
          {
            id: runId,
            threadId,
            status: "cancelled",
            startedAt: new Date(startedAt).toISOString(),
            lastSequence: 0,
          },
          ...(later ? [laterRun] : []),
        ],
        activeRunIds: [],
        suggestions: [],
      },
    }),
    runLifecycles: {
      queriedRunIds: later ? [runId, laterRunId] : [runId],
      runs: [
        ...(later ? [laterLifecycle] : []),
        {
          id: runId,
          status: "aborted",
          startedAt,
          completedAt: startedAt + 4_000,
          errorCode: null,
          abortReason: "user",
          terminalReason: "aborted:user",
        },
      ],
    },
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

let client: AgentKitClient | undefined;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client?.dispose();
  client = undefined;
  container.remove();
  vi.unstubAllGlobals();
});

async function reload(messages: unknown[]) {
  const transport = createAgentNativeAgentKitTransport({
    fetch: vi.fn(async (input: string | URL | Request) =>
      String(input).includes("/runs/active")
        ? json({ active: false, status: "idle" })
        : json(storedThread(messages)),
    ) as typeof fetch,
  });
  client = new AgentKitClient({ transport });
  await client.loadThread(threadId);
  await act(async () =>
    root.render(
      <AgentKitProvider controller={client!} threadId={threadId}>
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    ),
  );
}

describe("reloading a thread whose run the user stopped", () => {
  it("renders the partial reply, then Stopped", async () => {
    await reload([prompt, stoppedReply]);

    const transcript = container.querySelector(".agentkit-transcript")!;
    const text = transcript.textContent ?? "";
    expect(text).toContain("Mangrove forests grow along tropical co");
    expect(text.split("tropical co")).toHaveLength(2);
    expect(
      transcript.querySelectorAll('[data-role="assistant"]').length,
    ).toBeGreaterThan(0);
    const stopped = transcript.querySelector(".agentkit-run-stopped");
    expect(stopped?.textContent).toBe("Stopped");
    expect(text.indexOf("tropical co")).toBeLessThan(
      text.lastIndexOf("Stopped"),
    );
  });

  it("renders Stopped under the prompt when the run wrote nothing", async () => {
    await reload([prompt]);

    const transcript = container.querySelector(".agentkit-transcript")!;
    expect(transcript.querySelector(".agentkit-run-stopped")?.textContent).toBe(
      "Stopped",
    );
    expect(transcript.querySelectorAll('[data-role="assistant"]')).toHaveLength(
      0,
    );
  });

  it("keeps Stopped under the stopped reply when a later turn finished", async () => {
    await reload([prompt, stoppedReply, laterPrompt, laterReply]);

    const text =
      container.querySelector(".agentkit-transcript")!.textContent ?? "";
    const stopped = text.indexOf("Stopped");
    expect(stopped).toBeGreaterThan(text.indexOf("tropical co"));
    expect(stopped).toBeLessThan(text.indexOf("Say hello."));
    expect(text.indexOf("Say hello.")).toBeLessThan(
      text.indexOf("Hello there."),
    );
    expect(text.split("Stopped")).toHaveLength(2);
  });

  it("keeps Stopped under the prompt of an empty stop when a later turn finished", async () => {
    await reload([prompt, laterPrompt, laterReply]);

    const text =
      container.querySelector(".agentkit-transcript")!.textContent ?? "";
    const stopped = text.indexOf("Stopped");
    expect(stopped).toBeGreaterThan(
      text.indexOf("Write 20 numbered sentences."),
    );
    expect(stopped).toBeLessThan(text.indexOf("Say hello."));
    expect(text.split("Stopped")).toHaveLength(2);
  });
});
