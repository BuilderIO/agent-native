import { fail } from "@agent-native/core/action";
import {
  compareAndSetManyAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { resolveChatModelAvailability } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";

import { assertRecordingNotExpired } from "../../server/lib/recording-read-access.js";
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
  await queueBackgroundAiRequest({
    recordingId,
    kind,
    requestedAt,
    request,
  });
}

/** Queued AI work needs a model; without one it would sit in "queued" forever. */
export async function assertAiModelAvailable(
  ownerEmail?: string | null,
): Promise<void> {
  const availability = await resolveChatModelAvailability({
    ownerEmail: getRequestUserEmail() ?? ownerEmail,
  });
  if (availability === "unavailable") {
    fail("No AI model is connected. Connect Builder.io or add a model key.", {
      errorCode: "ai_model_unavailable",
      statusCode: 409,
    });
  }
  if (availability === "unknown") {
    fail("Couldn't check the AI model connection. Try again in a moment.", {
      errorCode: "ai_model_lookup_unavailable",
      statusCode: 503,
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
  const access = assertRecordingNotExpired(
    await assertAccess("recording", recordingId, "editor"),
  );
  await assertAiModelAvailable(access.resource.ownerEmail);
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
