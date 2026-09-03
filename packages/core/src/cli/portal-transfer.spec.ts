import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  appendCodeAgentTranscriptEvent,
  createCodeAgentRunRecord,
  listCodeAgentTranscriptEvents,
} from "./code-agent-runs.js";
import {
  appendPortalTransferTranscript,
  createPortalTransferContext,
  portalTransferContinuationPrompt,
} from "./portal-transfer.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true })),
  );
});

describe("Portal transfer context", () => {
  it("keeps every text event while removing binary attachment bodies", () => {
    const context = createPortalTransferContext({
      sourceRunId: "task-1",
      sourceStatus: "paused",
      sourcePhase: "stopped",
      events: [
        {
          id: "event-1",
          type: "user",
          text: "Please continue the refactor.",
          createdAt: "2026-08-17T10:00:00.000Z",
          metadata: {
            source: "desktop",
            attachments: [
              {
                name: "screenshot.png",
                type: "image/png",
                dataUrl: "data:image/png;base64,not-relayed",
              },
            ],
          },
        },
        {
          id: "event-2",
          kind: "system",
          message: "The runner stopped after the last edit.",
          createdAt: "2026-08-17T10:01:00.000Z",
        },
      ],
    });

    expect(context.events.map((event) => event.message)).toEqual([
      "Please continue the refactor.",
      "The runner stopped after the last edit.",
    ]);
    expect(context.events[0]?.metadata).toEqual({
      source: "desktop",
      attachments: [
        {
          name: "screenshot.png",
          type: "image/png",
          binaryContentOmitted: true,
        },
      ],
    });
  });

  it("does not silently truncate an oversized transcript", () => {
    expect(() =>
      createPortalTransferContext({
        sourceRunId: "task-1",
        events: [
          {
            id: "event-1",
            kind: "system",
            message: "context ".repeat(130_000),
            createdAt: "2026-08-17T10:00:00.000Z",
          },
        ],
      }),
    ).toThrow("Portal transcript context exceeds");
  });

  it("imports the context into the target run with stable event ids", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "portal-transfer-"));
    temporaryRoots.push(root);
    vi.stubEnv("AGENT_NATIVE_CODE_AGENTS_HOME", root);
    createCodeAgentRunRecord({
      id: "task-target",
      goalId: "task",
      title: "Transferred task",
      cwd: root,
    });
    appendCodeAgentTranscriptEvent({
      runId: "task-target",
      kind: "status",
      message: "Remote Agent-Native Code run queued.",
    });

    const context = createPortalTransferContext({
      sourceRunId: "task-source",
      events: [
        {
          id: "source-event-1",
          kind: "user",
          message: "Continue from the last test failure.",
          createdAt: "2026-08-17T10:00:00.000Z",
        },
      ],
    });
    expect(appendPortalTransferTranscript(context, "task-target")).toBe(1);

    expect(listCodeAgentTranscriptEvents("task-target")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "source-event-1",
          runId: "task-target",
          message: "Continue from the last test failure.",
          metadata: {
            portalTransfer: {
              sourceRunId: "task-source",
              sourceEventId: "source-event-1",
            },
          },
        }),
      ]),
    );
  });

  it("gives the resumed runner an explicit continuation instruction", () => {
    expect(
      portalTransferContinuationPrompt({
        hostLabel: "Always On Mac",
        handoffId: "handoff-1",
        eventCount: 4,
      }),
    ).toContain("Continue the unfinished task from the latest state");
  });
});
