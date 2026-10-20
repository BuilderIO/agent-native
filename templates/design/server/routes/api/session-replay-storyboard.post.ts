import { verifyA2AToken } from "@agent-native/core/a2a";
import {
  isActionContractError,
  type ActionRunContext,
} from "@agent-native/core/action";
import { getPrivateStorageReadinessForRequest } from "@agent-native/core/file-upload";
import { resolveActiveOrgIdForStorageCredential } from "@agent-native/core/org";
import {
  deleteAttachment,
  mintAttachmentRef,
} from "@agent-native/core/private-blob";
import { runWithRequestContext } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import {
  createError,
  defineEventHandler,
  getHeader,
  readMultipartFormData,
} from "h3";

import addSessionReplayScreenshotsToBoard from "../../../actions/add-session-replay-screenshots-to-board.js";
import createDesign from "../../../actions/create-design.js";
import deleteDesign from "../../../actions/delete-design.js";
import { getDb, schema } from "../../db/index.js";
import { pngDimensions } from "../../lib/png-dimensions.js";

const MAX_SCREENSHOTS = 9;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MAX_SCREENSHOT_DIMENSION = 8_192;
const MAX_SCREENSHOT_PIXELS = 16_000_000;
const MAX_BATCH_PIXELS = 32_000_000;
const MAX_BATCH_BYTES = 20 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 32_000;
const MAX_REQUEST_BYTES = MAX_BATCH_BYTES + MAX_MANIFEST_BYTES + 64_000;

type ReplayScreenshot = {
  replayId: string;
  app: string;
  capturedAt: string;
  route: string;
  offsetMs: number;
  viewportWidth: number;
  viewportHeight: number;
  eventCount: number;
};

type Manifest = {
  designId?: string;
  title?: string;
  cohortTotal: number;
  selectedReplayCount: number;
  screenshots: ReplayScreenshot[];
};

type CreatedDesignShell = {
  title: string;
  description: string | null;
  data: string;
  dataOperationRevisions: string;
  liveCollaborationEnabled: boolean;
  projectType: string;
  designSystemId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  ownerEmail: string;
  orgId: string | null;
  visibility: string;
};

function badRequest(message: string, statusCode = 400): never {
  throw createError({ statusCode, statusMessage: message });
}

function requestDeadlineError() {
  return createError({
    statusCode: 504,
    statusMessage: "Design screenshot upload request expired",
    data: { errorCode: "request_deadline_exceeded" },
  });
}

function throwIfRequestExpired(signal?: AbortSignal): void {
  if (signal?.aborted) throw requestDeadlineError();
}

function beforeRequestExpiry<T>(
  signal: AbortSignal | undefined,
  operation: () => T | Promise<T>,
): Promise<T> {
  if (!signal) return Promise.resolve().then(operation);
  throwIfRequestExpired(signal);

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(requestDeadlineError());
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }

    void Promise.resolve()
      .then(operation)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function hasUnknownSaveOutcome(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const failure = error as {
    data?: unknown;
    details?: unknown;
    saveOutcomeUnknown?: unknown;
  };
  const data =
    failure.data && typeof failure.data === "object"
      ? (failure.data as Record<string, unknown>)
      : undefined;
  const details =
    failure.details && typeof failure.details === "object"
      ? (failure.details as Record<string, unknown>)
      : undefined;
  const dataDetails =
    data?.details && typeof data.details === "object"
      ? (data.details as Record<string, unknown>)
      : undefined;
  return (
    failure.saveOutcomeUnknown === true ||
    details?.saveOutcomeUnknown === true ||
    data?.saveOutcomeUnknown === true ||
    dataDetails?.saveOutcomeUnknown === true
  );
}

async function cleanupCreatedDesign(
  designId: string,
  userEmail: string,
  expectedCreatedShell: CreatedDesignShell,
): Promise<{ cleanupPending: true; cleanupUnknown?: true } | null> {
  let deleteOutcome: "confirmed" | "rejected" | "unknown" = "unknown";
  try {
    const result = await deleteDesign.run(
      { id: designId, expectedCreatedShell },
      {
        caller: "frontend",
        actionName: "delete-design",
        userEmail,
        orgId: null,
      } satisfies ActionRunContext,
    );
    deleteOutcome = result?.deleted === true ? "confirmed" : "rejected";
  } catch (error) {
    deleteOutcome =
      isActionContractError(error) && error.statusCode < 500
        ? "rejected"
        : "unknown";
  }

  try {
    const [remainingDesign] = await getDb()
      .select({ id: schema.designs.id })
      .from(schema.designs)
      .where(
        and(
          eq(schema.designs.id, designId),
          eq(schema.designs.ownerEmail, userEmail),
          isNull(schema.designs.orgId),
          eq(schema.designs.visibility, "private"),
        ),
      )
      .limit(1);
    if (remainingDesign) {
      return {
        cleanupPending: true,
        ...(deleteOutcome !== "rejected"
          ? { cleanupUnknown: true as const }
          : {}),
      };
    }
    return deleteOutcome === "confirmed"
      ? null
      : { cleanupPending: true, cleanupUnknown: true };
  } catch (error) {
    return { cleanupPending: true, cleanupUnknown: true };
  }
}

function includeCleanupState(
  error: unknown,
  cleanupState: { cleanupPending: true; cleanupUnknown?: true },
) {
  const failure =
    error && typeof error === "object"
      ? (error as {
          data?: unknown;
          message?: unknown;
          statusCode?: unknown;
          statusMessage?: unknown;
        })
      : {};
  const statusCode =
    typeof failure.statusCode === "number" ? failure.statusCode : 500;
  const existingData =
    failure.data && typeof failure.data === "object"
      ? (failure.data as Record<string, unknown>)
      : {};
  return createError({
    statusCode,
    statusMessage:
      typeof failure.statusMessage === "string"
        ? failure.statusMessage
        : statusCode < 500 && typeof failure.message === "string"
          ? failure.message
          : "Design screenshot upload failed",
    data: { ...existingData, ...cleanupState },
    cause: error,
  });
}

async function assertPersonalPrivateDesignBoard(
  designId: string,
  userEmail: string,
): Promise<void> {
  const access = await assertAccess("design", designId, "editor", undefined, {
    skipResourceBody: true,
  });
  const resource = access.resource as {
    ownerEmail?: unknown;
    orgId?: unknown;
    visibility?: unknown;
  };
  if (
    typeof resource.ownerEmail !== "string" ||
    resource.ownerEmail.trim().toLowerCase() !==
      userEmail.trim().toLowerCase() ||
    resource.orgId != null ||
    resource.visibility !== "private"
  ) {
    badRequest("A private personal Design board is required", 403);
  }

  const shares = await getDb()
    .select({ resourceId: schema.designShares.resourceId })
    .from(schema.designShares)
    .where(eq(schema.designShares.resourceId, designId))
    .limit(1);
  if (shares.length > 0) {
    badRequest("A private personal Design board is required", 403);
  }
}

async function readBoundedMultipartFormData(
  event: Parameters<typeof readMultipartFormData>[0],
) {
  const declaredLength = event.req.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      badRequest("Screenshot export request size is invalid");
    }
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      badRequest("Screenshot export request size is invalid");
    }
    if (length > MAX_REQUEST_BYTES) {
      badRequest("Screenshot export request is too large", 413);
    }
  }

  const reader = event.req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        const error = createError({
          statusCode: 413,
          statusMessage: "Screenshot export request is too large",
        });
        try {
          await reader.cancel(error);
        } catch (cancelError) {
          throw createError({
            statusCode: 413,
            statusMessage: "Screenshot export request is too large",
            cause: cancelError,
          });
        }
        throw error;
      }
      chunks.push(value);
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      error.statusCode === 413
    ) {
      throw error;
    }
    throw createError({
      statusCode: 400,
      statusMessage: "Screenshot export request body could not be read",
      cause: error,
    });
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(event.req.headers);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  const boundedEvent = Object.create(event) as typeof event;
  Object.defineProperty(boundedEvent, "req", {
    value: new Request(event.req.url, {
      method: event.req.method,
      headers,
      body: body.byteLength > 0 ? body : undefined,
    }),
  });
  return readMultipartFormData(boundedEvent);
}

function parseManifest(value: unknown): Manifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return badRequest("Screenshot export manifest is invalid");
  }
  const raw = value as Record<string, unknown>;
  if (
    !Array.isArray(raw.screenshots) ||
    raw.screenshots.length < 1 ||
    raw.screenshots.length > MAX_SCREENSHOTS
  ) {
    return badRequest(`Export must contain 1–${MAX_SCREENSHOTS} screenshots`);
  }
  const screenshots = raw.screenshots.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return badRequest("Screenshot metadata is invalid");
    }
    const item = entry as Record<string, unknown>;
    const replayId =
      typeof item.replayId === "string" ? item.replayId.trim() : "";
    const app = typeof item.app === "string" ? item.app.trim() : "";
    const route = typeof item.route === "string" ? item.route.trim() : "";
    const capturedAt =
      typeof item.capturedAt === "string" ? item.capturedAt.trim() : "";
    const date = new Date(capturedAt);
    if (
      !replayId ||
      replayId.length > 256 ||
      !app ||
      app.length > 128 ||
      !route.startsWith("/") ||
      route.startsWith("//") ||
      route.length > 2_048 ||
      /[\u0000-\u001f\u007f]/.test(route) ||
      !Number.isFinite(date.getTime()) ||
      !Number.isSafeInteger(item.offsetMs) ||
      Number(item.offsetMs) < 0 ||
      !Number.isSafeInteger(item.viewportWidth) ||
      !Number.isSafeInteger(item.viewportHeight) ||
      Number(item.viewportWidth) <= 0 ||
      Number(item.viewportHeight) <= 0 ||
      Number(item.viewportWidth) > MAX_SCREENSHOT_DIMENSION ||
      Number(item.viewportHeight) > MAX_SCREENSHOT_DIMENSION ||
      Number(item.viewportWidth) * Number(item.viewportHeight) >
        MAX_SCREENSHOT_PIXELS ||
      !Number.isSafeInteger(item.eventCount) ||
      Number(item.eventCount) < 1
    ) {
      return badRequest("Screenshot metadata is invalid");
    }
    return {
      replayId,
      app,
      route,
      capturedAt: date.toISOString(),
      offsetMs: Number(item.offsetMs),
      viewportWidth: Number(item.viewportWidth),
      viewportHeight: Number(item.viewportHeight),
      eventCount: Number(item.eventCount),
    };
  });
  if (
    screenshots.reduce(
      (total, screenshot) =>
        total + screenshot.viewportWidth * screenshot.viewportHeight,
      0,
    ) > MAX_BATCH_PIXELS
  ) {
    return badRequest("Screenshot batch exceeds the decoded pixel limit", 413);
  }
  const designId =
    typeof raw.designId === "string" && raw.designId.trim()
      ? raw.designId.trim()
      : undefined;
  const title =
    typeof raw.title === "string" && raw.title.trim()
      ? raw.title.trim()
      : undefined;
  const cohortTotal = Number(raw.cohortTotal);
  const selectedReplayCount = Number(raw.selectedReplayCount);
  if (
    !Number.isSafeInteger(cohortTotal) ||
    cohortTotal < 0 ||
    !Number.isSafeInteger(selectedReplayCount) ||
    selectedReplayCount < 1 ||
    cohortTotal < selectedReplayCount ||
    selectedReplayCount >
      new Set(screenshots.map(({ replayId }) => replayId)).size ||
    (designId && designId.length > 128) ||
    (title && title.length > 200)
  ) {
    return badRequest("Screenshot export cohort metadata is invalid");
  }
  return {
    ...(designId ? { designId } : {}),
    ...(title ? { title } : {}),
    cohortTotal,
    selectedReplayCount,
    screenshots,
  };
}

export default defineEventHandler(async (event) => {
  const requestSignal = event.req?.signal;
  const authorization = getHeader(event, "authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
  if (!token) badRequest("A signed Analytics user is required", 401);

  const caller = await verifyA2AToken(token, event);
  if (!caller.email) badRequest("A signed Analytics user is required", 401);
  if (caller.orgId?.trim() || caller.orgDomain?.trim()) {
    badRequest("Storyboard uploads require a personal Design identity", 403);
  }

  const parts = await readBoundedMultipartFormData(event);
  if (!parts) badRequest("Screenshot export payload is missing");
  const manifests = parts.filter((part) => part.name === "manifest");
  if (manifests.length !== 1 || !manifests[0]?.data) {
    badRequest("Screenshot export manifest is missing");
  }
  if (manifests[0].data.byteLength > MAX_MANIFEST_BYTES) {
    badRequest("Screenshot export manifest is too large", 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(manifests[0].data).toString("utf8"));
  } catch {
    badRequest("Screenshot export manifest is invalid");
  }
  const manifest = parseManifest(parsed);
  const expectedParts = new Set([
    "manifest",
    ...manifest.screenshots.map((_, index) => `screenshot-${index}`),
  ]);
  if (
    parts.length !== expectedParts.size ||
    parts.some((part) => !part.name || !expectedParts.has(part.name))
  ) {
    badRequest("Screenshot export parts do not match the manifest");
  }

  let totalBytes = 0;
  const screenshotBytes = manifest.screenshots.map((screenshot, index) => {
    const matches = parts.filter((part) => part.name === `screenshot-${index}`);
    if (matches.length !== 1 || !matches[0]?.data) {
      return badRequest(`Screenshot file ${index} is missing`);
    }
    const data = matches[0].data;
    totalBytes += data.byteLength;
    if (data.byteLength === 0 || data.byteLength > MAX_SCREENSHOT_BYTES) {
      return badRequest("Each screenshot must be 5 MB or smaller", 413);
    }
    if (totalBytes > MAX_BATCH_BYTES) {
      return badRequest("Screenshot batch must be 20 MB or smaller", 413);
    }
    const dimensions = pngDimensions(data, {
      maxDimension: MAX_SCREENSHOT_DIMENSION,
      maxPixels: MAX_SCREENSHOT_PIXELS,
    });
    if (
      !dimensions ||
      dimensions.width !== screenshot.viewportWidth ||
      dimensions.height !== screenshot.viewportHeight
    ) {
      return badRequest("Screenshot pixels do not match the replay viewport");
    }
    return data;
  });

  let createdDesignId: string | undefined;
  let createdDesignShell: CreatedDesignShell | undefined;
  const request = runWithRequestContext(
    {
      userEmail: caller.email,
      orgId: undefined,
      orgScope: "personal",
    },
    async () => {
      let storageCredentialOrgId: string | null;
      try {
        storageCredentialOrgId = await beforeRequestExpiry(requestSignal, () =>
          resolveActiveOrgIdForStorageCredential(caller.email!),
        );
      } catch {
        if (requestSignal?.aborted) throw requestDeadlineError();
        badRequest("Design private screenshot storage is unavailable", 503);
      }
      throwIfRequestExpired(requestSignal);
      const withStorageCredentialOrg = <T>(operation: () => T | Promise<T>) =>
        runWithRequestContext(
          {
            userEmail: caller.email!,
            orgId: undefined,
            orgScope: "personal",
            builderStorageCredentialOrgId: storageCredentialOrgId,
          },
          operation,
        );

      const storageReadiness = await beforeRequestExpiry(requestSignal, () =>
        withStorageCredentialOrg(getPrivateStorageReadinessForRequest),
      );
      throwIfRequestExpired(requestSignal);
      if (storageReadiness.readiness !== "ready") {
        throw createError({
          statusCode: 503,
          statusMessage: "Design private screenshot storage is unavailable",
          data: { errorCode: "private_storage_unavailable" },
        });
      }

      let designId = manifest.designId;
      if (!designId) {
        throwIfRequestExpired(requestSignal);
        const created = await createDesign.run(
          {
            title: manifest.title ?? "Session replay storyboard",
            description: "Private session replay storyboard from Analytics.",
            projectType: "prototype",
            designSystemId: null,
            creationMethod: "import_analytics",
          },
          {
            caller: "frontend",
            actionName: "create-design",
            userEmail: caller.email!,
            orgId: null,
          } satisfies ActionRunContext,
        );
        createdDesignId =
          typeof created.id === "string" && created.id.length > 0
            ? created.id
            : undefined;
        designId = createdDesignId?.trim();
        if (
          !designId ||
          designId.length > 128 ||
          designId !== createdDesignId
        ) {
          badRequest("Design did not confirm a private storyboard", 502);
        }
        const [createdShell] = await getDb()
          .select({
            title: schema.designs.title,
            description: schema.designs.description,
            data: schema.designs.data,
            dataOperationRevisions: schema.designs.dataOperationRevisions,
            liveCollaborationEnabled: schema.designs.liveCollaborationEnabled,
            projectType: schema.designs.projectType,
            designSystemId: schema.designs.designSystemId,
            createdAt: schema.designs.createdAt,
            updatedAt: schema.designs.updatedAt,
            ownerEmail: schema.designs.ownerEmail,
            orgId: schema.designs.orgId,
            visibility: schema.designs.visibility,
          })
          .from(schema.designs)
          .where(
            and(
              eq(schema.designs.id, designId),
              eq(schema.designs.ownerEmail, caller.email!),
              isNull(schema.designs.orgId),
              eq(schema.designs.visibility, "private"),
            ),
          )
          .limit(1);
        if (
          !createdShell ||
          createdShell.title !==
            (manifest.title ?? "Session replay storyboard") ||
          createdShell.description !==
            "Private session replay storyboard from Analytics." ||
          createdShell.data !== "{}" ||
          createdShell.dataOperationRevisions !== "{}" ||
          createdShell.liveCollaborationEnabled !== false ||
          createdShell.projectType !== "prototype" ||
          createdShell.designSystemId !== null ||
          !createdShell.createdAt ||
          createdShell.updatedAt !== createdShell.createdAt ||
          createdShell.ownerEmail.trim().toLowerCase() !==
            caller.email!.trim().toLowerCase() ||
          createdShell.orgId !== null ||
          createdShell.visibility !== "private"
        ) {
          badRequest(
            "Design did not confirm an unchanged private storyboard",
            502,
          );
        }
        createdDesignShell = createdShell;
      }
      throwIfRequestExpired(requestSignal);
      await assertPersonalPrivateDesignBoard(designId, caller.email!);
      throwIfRequestExpired(requestSignal);

      const refs: string[] = [];
      let cleanupPending = false;
      let response:
        | {
            response: string;
            boardUrl: string;
            designId: string;
            screenshotCount: number;
            selectedReplayCount: number;
            cohortTotal: number;
          }
        | undefined;
      let actionFailed = false;
      let actionFailure: unknown;
      try {
        const screenshots: Array<ReplayScreenshot & { attachmentRef: string }> =
          [];
        await withStorageCredentialOrg(async () => {
          for (let index = 0; index < manifest.screenshots.length; index += 1) {
            throwIfRequestExpired(requestSignal);
            const screenshot = manifest.screenshots[index]!;
            const minted = await mintAttachmentRef({
              data: screenshotBytes[index]!,
              filename: `${screenshot.replayId}-${String(screenshot.offsetMs).padStart(8, "0")}.png`,
              mimeType: "image/png",
              ownerEmail: caller.email!,
              orgId: null,
              metadata: {
                appId: "analytics",
                resourceType: "session-replay-screenshot-handoff",
                resourceId: screenshot.replayId,
                replayId: screenshot.replayId,
                offsetMs: screenshot.offsetMs,
              },
            });
            if (minted.status === "ok") {
              refs.push(minted.ref);
              screenshots.push({ ...screenshot, attachmentRef: minted.ref });
            }
            throwIfRequestExpired(requestSignal);
            if (minted.status !== "ok") {
              badRequest(
                "Design private screenshot storage is unavailable",
                503,
              );
            }
          }
        });

        throwIfRequestExpired(requestSignal);
        const result = await withStorageCredentialOrg(() =>
          addSessionReplayScreenshotsToBoard.run(
            {
              designId,
              ...(manifest.title ? { title: manifest.title } : {}),
              cohortTotal: manifest.cohortTotal,
              selectedReplayCount: manifest.selectedReplayCount,
              screenshots,
            },
            {
              caller: "frontend",
              actionName: "add-session-replay-screenshots-to-board",
              userEmail: caller.email!,
              orgId: null,
            } satisfies ActionRunContext,
          ),
        );
        if (!result.boardUrl || !result.designId) {
          throw createError({
            statusCode: 502,
            statusMessage: "Design did not confirm a storyboard",
            data: { saveOutcomeUnknown: true },
          });
        }
        response = {
          response: `Added ${screenshots.length} session replay screenshots to Design.`,
          boardUrl: result.boardUrl,
          designId: result.designId,
          screenshotCount: screenshots.length,
          selectedReplayCount: manifest.selectedReplayCount,
          cohortTotal: manifest.cohortTotal,
        };
      } catch (error) {
        actionFailed = true;
        actionFailure = error;
      } finally {
        for (const ref of refs) {
          try {
            const deleted = await withStorageCredentialOrg(() =>
              deleteAttachment(ref, {
                ownerEmail: caller.email!,
                orgId: null,
              }),
            );
            if (deleted.status === "ok" && deleted.deleted) continue;
            cleanupPending = true;
          } catch {
            cleanupPending = true;
          }
        }
      }
      if (actionFailed) {
        if (isActionContractError(actionFailure)) {
          const actionDetails = actionFailure.details ?? {};
          const actionState =
            typeof actionDetails === "object" && actionDetails !== null
              ? (actionDetails as Record<string, unknown>)
              : {};
          throw createError({
            statusCode: actionFailure.statusCode,
            statusMessage: actionFailure.message,
            data: {
              error: actionFailure.message,
              errorCode: actionFailure.errorCode,
              ...(actionFailure.details === undefined
                ? {}
                : { details: actionFailure.details }),
              ...(cleanupPending || actionState.cleanupPending === true
                ? { cleanupPending: true }
                : {}),
              ...(actionState.cleanupFailed === true
                ? { cleanupFailed: true }
                : {}),
              ...(actionState.cleanupUnknown === true
                ? { cleanupUnknown: true }
                : {}),
              ...(actionState.saveOutcomeUnknown === true
                ? { saveOutcomeUnknown: true }
                : {}),
            },
            cause: actionFailure,
          });
        }
        const failure =
          actionFailure && typeof actionFailure === "object"
            ? (actionFailure as {
                data?: unknown;
                message?: unknown;
                statusCode?: unknown;
                statusMessage?: unknown;
              })
            : {};
        const existingData =
          failure.data && typeof failure.data === "object" ? failure.data : {};
        const failureData = existingData as Record<string, unknown>;
        if (
          !cleanupPending &&
          failureData.cleanupPending !== true &&
          failureData.saveOutcomeUnknown !== true
        ) {
          throw actionFailure;
        }
        throw createError({
          statusCode:
            typeof failure.statusCode === "number" ? failure.statusCode : 500,
          statusMessage:
            typeof failure.statusMessage === "string"
              ? failure.statusMessage
              : typeof failure.message === "string"
                ? failure.message
                : "Design screenshot action failed",
          data: {
            ...failureData,
            ...(cleanupPending || failureData.cleanupPending === true
              ? { cleanupPending: true }
              : {}),
            ...(failureData.saveOutcomeUnknown === true
              ? { saveOutcomeUnknown: true }
              : {}),
          },
          cause: actionFailure,
        });
      }
      if (!response) {
        throw createError({
          statusCode: 502,
          statusMessage: "Design did not confirm a storyboard",
          data: { saveOutcomeUnknown: true },
        });
      }
      return { ...response, cleanupPending };
    },
  );
  return Promise.resolve(request).catch(async (error: unknown) => {
    if (createdDesignId && !hasUnknownSaveOutcome(error)) {
      if (!createdDesignShell) {
        throw includeCleanupState(error, {
          cleanupPending: true,
          cleanupUnknown: true,
        });
      }
      const cleanupState = await runWithRequestContext(
        {
          userEmail: caller.email!,
          orgId: undefined,
          orgScope: "personal",
        },
        () =>
          cleanupCreatedDesign(
            createdDesignId!,
            caller.email!,
            createdDesignShell!,
          ),
      );
      if (cleanupState) throw includeCleanupState(error, cleanupState);
    }
    throw error;
  });
});
