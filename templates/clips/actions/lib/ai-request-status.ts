import { fail } from "@agent-native/core/action";
import {
  compareAndSetManyAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { resolveChatModelAvailability } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";

import { assertRecordingNotExpired } from "../../server/lib/recording-read-access.js";
import type { ClipsAiRequestKind } from "../../shared/ai-request-status.js";

const STATUS_KEY_PREFIX = "clips-ai-request-status-";
const TITLE_TERMINAL_KEY_PREFIX = "clips-ai-title-terminal-";

export const titleTerminalKey = (recordingId: string) =>
  `${TITLE_TERMINAL_KEY_PREFIX}${recordingId}`;

export function isUnsuccessfulTitleStatus(
  status: Record<string, unknown> | null,
) {
  return (
    (status?.kind === "regenerate-title" ||
      status?.kind === "generate-metadata") &&
    ["failed", "truncated", "cancelled"].includes(String(status.status))
  );
}

function isSupersededTitleStatus(
  marker: Record<string, unknown> | null,
  status: Record<string, unknown> | null,
) {
  return (
    marker?.suppressed === false &&
    marker.supersededStatus !== undefined &&
    JSON.stringify(marker.supersededStatus) === JSON.stringify(status)
  );
}

export function isCurrentTitleFailure(
  marker: Record<string, unknown> | null,
  status: Record<string, unknown> | null,
  transcriptRevision: string | null,
) {
  const current = (value: Record<string, unknown>) =>
    typeof value.transcriptRevision !== "string" ||
    value.transcriptRevision === transcriptRevision;
  return (
    (marker?.suppressed === true && current(marker)) ||
    (!!status &&
      !isSupersededTitleStatus(marker, status) &&
      isUnsuccessfulTitleStatus(status) &&
      current(status))
  );
}

export async function hasUnsuccessfulTitleRequest(
  recordingId: string,
  transcriptRevision: string | null,
) {
  const [marker, status] = await Promise.all([
    readAppState(titleTerminalKey(recordingId)),
    readAppState(`${STATUS_KEY_PREFIX}${recordingId}`),
  ]);
  return isCurrentTitleFailure(marker, status, transcriptRevision);
}

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
  automaticTitle = false,
}: {
  recordingId: string;
  kind: ClipsAiRequestKind;
  requestedAt: string;
  request: Record<string, unknown>;
  automaticTitle?: boolean;
}): Promise<void> {
  await queueBackgroundAiRequest({
    recordingId,
    kind,
    requestedAt,
    request,
    automaticTitle,
  });
}

/** Queued AI work needs a model; without one it would sit in "queued" forever. */
export async function assertAiModelAvailable(): Promise<void> {
  const availability = await resolveChatModelAvailability();
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
  automaticTitle = false,
}: {
  recordingId: string;
  kind: ClipsAiRequestKind;
  requestedAt: string;
  request: Record<string, unknown>;
  automaticTitle?: boolean;
}): Promise<void> {
  const statusKey = `${STATUS_KEY_PREFIX}${recordingId}`;
  const requestKey = `clips-ai-request-${recordingId}`;
  const nextStatus = {
    kind,
    status: "queued",
    message: null,
    requestedAt,
    updatedAt: requestedAt,
    ...(typeof request.transcriptRevision === "string"
      ? { transcriptRevision: request.transcriptRevision }
      : {}),
  };

  assertRecordingNotExpired(
    await assertAccess("recording", recordingId, "editor"),
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [status, previousRequest, marker] = await Promise.all([
      readAppState(statusKey),
      readAppState(requestKey),
      readAppState(titleTerminalKey(recordingId)),
    ]);
    const legacyFailure =
      isUnsuccessfulTitleStatus(status) &&
      !isSupersededTitleStatus(marker, status);
    if (
      automaticTitle &&
      isCurrentTitleFailure(
        marker,
        status,
        typeof request.transcriptRevision === "string"
          ? request.transcriptRevision
          : null,
      )
    ) {
      fail(
        "Automatic title generation stopped after an unsuccessful request.",
        {
          errorCode: "title_request_unsuccessful",
          statusCode: 409,
        },
      );
    }
    if (status && ["queued", "working"].includes(String(status.status))) {
      fail(
        `A ${String(status.kind ?? "AI")} request is already running for this recording.`,
        { errorCode: "request_conflict", statusCode: 409 },
      );
    }

    assertRecordingNotExpired(
      await assertAccess("recording", recordingId, "editor"),
    );
    await assertAiModelAvailable();
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
        ...(legacyFailure &&
        (marker?.suppressed !== true ||
          marker.requestedAt !== status?.requestedAt)
          ? [
              {
                key: titleTerminalKey(recordingId),
                expectedValue: marker,
                nextValue: { ...status, suppressed: true },
              },
            ]
          : automaticTitle
            ? [
                {
                  key: titleTerminalKey(recordingId),
                  expectedValue: marker,
                  nextValue: marker ?? { suppressed: false },
                },
              ]
            : []),
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
