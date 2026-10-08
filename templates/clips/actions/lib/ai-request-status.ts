import { fail } from "@agent-native/core/action";
import {
  compareAndSetManyAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";

import type { ClipsAiRequestKind } from "../../shared/ai-request-status.js";

const STATUS_KEY_PREFIX = "clips-ai-request-status-";

export function withAiRequestStatusInstructions({
  message,
  recordingId,
  kind,
  requestedAt,
}: {
  message: string;
  recordingId: string;
  kind: ClipsAiRequestKind;
  requestedAt: string;
}): string {
  const statusCommand =
    `update-ai-request-status --recordingId=${recordingId} --kind=${kind} ` +
    `--requestedAt="${requestedAt}"`;

  return (
    `${message} ` +
    `Before starting, call \`${statusCommand} --status=working\`. ` +
    `After every requested change finishes, call \`${statusCommand} --status=completed --message="<short result>"\`. ` +
    `If the work cannot finish, call \`${statusCommand} --status=failed --message="<what went wrong>"\`. ` +
    `Do not leave the request in working state after you finish.`
  );
}

export async function queueAiRequest({
  recordingId,
  kind,
  requestedAt,
  request,
}: {
  recordingId: string;
  kind: ClipsAiRequestKind;
  requestedAt: string;
  request: Record<string, unknown>;
}): Promise<void> {
  const statusKey = `${STATUS_KEY_PREFIX}${recordingId}`;
  await writeAppState(statusKey, {
    kind,
    status: "queued",
    message: null,
    requestedAt,
    updatedAt: requestedAt,
  });

  try {
    await writeAppState(`clips-ai-request-${recordingId}`, request as any);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The request could not be queued.";
    await writeAppState(statusKey, {
      kind,
      status: "failed",
      message,
      requestedAt,
      updatedAt: new Date().toISOString(),
    });
    throw error;
  }

  try {
    await writeAppState("refresh-signal", { ts: Date.now() });
  } catch (error) {
    console.warn("[clips] failed to publish AI request refresh signal", {
      recordingId,
      kind,
      error,
    });
  }
}

export async function queueBackgroundAiRequest({
  recordingId,
  kind,
  requestedAt,
  request,
}: {
  recordingId: string;
  kind: ClipsAiRequestKind;
  requestedAt: string;
  request: Record<string, unknown>;
}): Promise<void> {
  const statusKey = `${STATUS_KEY_PREFIX}${recordingId}`;
  const requestKey = `clips-ai-request-${recordingId}`;
  const nextStatus = {
    kind,
    status: "queued",
    message: null,
    requestedAt,
    updatedAt: requestedAt,
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [status, previousRequest] = await Promise.all([
      readAppState(statusKey),
      readAppState(requestKey),
    ]);
    if (status && ["queued", "working"].includes(String(status.status))) {
      fail(
        `A ${String(status.kind ?? "AI")} request is already running for this recording.`,
        { errorCode: "request_conflict", statusCode: 409 },
      );
    }

    if (
      await compareAndSetManyAppState([
        {
          key: statusKey,
          expectedValue: status,
          nextValue: nextStatus,
        },
        {
          key: requestKey,
          expectedValue: previousRequest,
          nextValue: request,
        },
      ])
    ) {
      try {
        await writeAppState("refresh-signal", { ts: Date.now() });
      } catch (error) {
        console.warn("[clips] failed to publish AI request refresh signal", {
          recordingId,
          kind,
          error,
        });
      }
      return;
    }
  }

  fail("The AI request changed before it could be queued. Try again.", {
    errorCode: "request_conflict",
    statusCode: 409,
  });
}
