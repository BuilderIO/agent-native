import {
  fingerprintAgentSubmissionAttachment,
  submissionAttachmentsMatch,
} from "@agent-native/agentkit/protocol";
import { expect, it, vi } from "vitest";

import { createAgentKitProtocolAdapter } from "./agentkit-protocol.js";
import type {
  AgentChatRuntime,
  AgentChatRuntimeEvent,
  AgentChatRuntimeTurnInput,
} from "./runtime.js";

it("unstored-images keep their file identity", async () => {
  async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
    yield { type: "done", reason: "complete" };
  }
  const startTurn = vi.fn(async (_input: AgentChatRuntimeTurnInput) => ({
    id: "turn-unstored-images",
    runId: "run-unstored-images",
    sessionId: "thread-1",
    events: events(),
  }));
  const runtime: AgentChatRuntime = {
    id: "runtime-test",
    kind: "external-agent",
    label: "Test runtime",
    capabilities: {
      messages: { streaming: true, history: true, attachments: true },
    },
    async createSession() {
      return {
        id: "thread-1",
        runtimeId: "runtime-test",
        startTurn,
      };
    },
  };
  const transport = createAgentKitProtocolAdapter(runtime);
  const files = [0, 1, 2].map((index) => ({
    type: "file" as const,
    name: "image.jpg",
    mediaType: "image/jpeg",
    omitted: "inline-bytes" as const,
    index,
  }));
  const images = files.map((_, index) => ({
    type: "image" as const,
    name: "image.jpg",
    contentType: "image/jpeg",
    data: `data:image/jpeg;base64,${Buffer.from(`jpeg-${index}`).toString("base64")}`,
  }));

  await transport.startRun({
    threadId: "thread-1",
    messages: [
      {
        id: "user-1",
        role: "user",
        parts: [
          { type: "text", text: "Use these" },
          ...files.map(({ index: _index, ...file }) => file),
        ],
      },
    ],
    requestAttachments: images,
  });

  expect(
    submissionAttachmentsMatch(
      {
        attachments: files.map(({ index: _index, ...file }) => ({
          type: "file" as const,
          name: file.name,
          mediaType: file.mediaType,
          fingerprint: fingerprintAgentSubmissionAttachment(file, "file"),
        })),
        requestAttachments: images.map((image) => ({
          type: "image" as const,
          name: image.name,
          contentType: image.contentType,
          fingerprint: fingerprintAgentSubmissionAttachment(image, "image"),
        })),
      },
      startTurn.mock.calls[0]?.[0].attachments ?? [],
    ),
  ).toBe(true);
  await transport.dispose();
});
