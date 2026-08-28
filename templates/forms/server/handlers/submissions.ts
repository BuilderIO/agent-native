import {
  getSession,
  readBody,
  runWithRequestContext,
  verifyCaptcha,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import {
  defineEventHandler,
  getRouterParam,
  getQuery,
  getRequestHeader,
  setResponseStatus,
  getRequestIP,
  type H3Event,
} from "h3";
import { nanoid } from "nanoid";

import {
  isConditionalFieldVisible,
  sanitizeConditionalValues as sanitizeVisibleValues,
} from "../../shared/conditional.js";
import { scrubPageUrl } from "../../shared/page-url.js";
import {
  cleanSubmitterEmail,
  publicSubmitterEmail,
} from "../../shared/submitter-email.js";
import type {
  FormField,
  FormResponse,
  FormSettings,
} from "../../shared/types.js";
import { getDb, schema } from "../db/index.js";
import {
  buildIntegrationDeliverySnapshots,
  deliverIntegrationDelivery,
  fireIntegrations,
  type IntegrationDeliverySnapshot,
} from "../lib/integrations.js";
import {
  sendNewResponseEmail,
  type NewResponseEmailArgs,
} from "../lib/response-email.js";
import {
  isEmptySubmissionValue,
  validateSubmissionField,
} from "../lib/submission-validation.js";

const MAX_PAYLOAD_BYTES = 100 * 1024; // 100KB
const MIN_FILL_TIME_MS = 500; // reject submits faster than this
const MAX_META_TEXT_LENGTH = 500;
const MAX_CHAT_SESSION_IDS = 5;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const APPLICATION_STATE_DESTINATION = "application-state";
const RESPONSE_EMAIL_DESTINATION = "email";
const DELIVERY_CLAIM_LEASE_MS = 60_000;
const DELIVERY_CLAIM_HEARTBEAT_MS = Math.floor(DELIVERY_CLAIM_LEASE_MS / 3);

type ResponseDeliveryStatus = "pending" | "processing" | "succeeded" | "failed";

interface DeliverySnapshot {
  formId: string;
  formTitle: string;
  ownerEmail: string | null;
  orgId: string | null;
  fields: FormField[];
  data: Record<string, unknown>;
  submittedAt: string;
  submitterEmail: string | null;
  chatSessionIds: string[];
  activeRunId: string | null;
  pageUrl: string | null;
  clientSurface: string | null;
  emailOnNewResponses: boolean;
  integrations: IntegrationDeliverySnapshot[];
}

type StoredDeliveryPayload =
  | {
      kind: "application-state";
      ownerEmail: string;
      value: { formId: string; responseId: string; timestamp: string };
    }
  | { kind: "email"; args: NewResponseEmailArgs; orgId: string | null }
  | { kind: "integration"; snapshot: IntegrationDeliverySnapshot };

function configuredDeliveryStatuses(snapshot: DeliverySnapshot) {
  const statuses: Record<string, "pending"> = {};
  if (snapshot.ownerEmail) statuses[APPLICATION_STATE_DESTINATION] = "pending";
  if (snapshot.emailOnNewResponses && snapshot.ownerEmail) {
    statuses[RESPONSE_EMAIL_DESTINATION] = "pending";
  }
  for (const integration of snapshot.integrations) {
    statuses[`integration:${integration.id}`] = "pending";
  }
  return statuses;
}

function submissionMetadata(body: Record<string, unknown>, anonymous: boolean) {
  const meta =
    !anonymous && typeof body._meta === "object" && body._meta !== null
      ? (body._meta as {
          chatSessionId?: unknown;
          chatSessionIds?: unknown;
          activeRunId?: unknown;
          pageUrl?: unknown;
          clientSurface?: unknown;
          submitterEmail?: unknown;
        })
      : null;
  return {
    submitterEmail: cleanSubmitterEmail(meta?.submitterEmail),
    chatSessionIds: cleanChatSessionIds([
      meta?.chatSessionId,
      meta?.chatSessionIds,
    ]),
    activeRunId: cleanMetaText(meta?.activeRunId),
    pageUrl: scrubPageUrl(meta?.pageUrl),
    clientSurface: cleanClientSurface(meta?.clientSurface),
  };
}

function cleanMetaText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_META_TEXT_LENGTH);
}

// Allowlist the client-surface hint so only known values are stored. Anything
// else (including spoofed direct POSTs) is dropped to NULL.
const KNOWN_CLIENT_SURFACES = new Set(["web", "electron", "tauri"]);
function cleanClientSurface(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return KNOWN_CLIENT_SURFACES.has(normalized) ? normalized : null;
}

function cleanChatSessionIds(value: unknown): string[] {
  const ids: string[] = [];
  const visit = (item: unknown) => {
    if (ids.length >= MAX_CHAT_SESSION_IDS) return;
    if (Array.isArray(item)) {
      for (const nested of item) visit(nested);
      return;
    }
    const cleaned = cleanMetaText(item);
    if (!cleaned || ids.includes(cleaned)) return;
    ids.push(cleaned);
  };
  visit(value);
  return ids;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseIntegrationSnapshot(value: unknown): IntegrationDeliverySnapshot {
  if (
    !isObjectRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    typeof value.name !== "string" ||
    typeof value.url !== "string" ||
    !("payload" in value)
  ) {
    throw new Error("Invalid response integration delivery snapshot");
  }
  return {
    id: value.id,
    type: value.type as IntegrationDeliverySnapshot["type"],
    name: value.name,
    url: value.url,
    payload: value.payload,
  };
}

function parseDeliverySnapshot(
  value: string | null | undefined,
): DeliverySnapshot | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Unreadable response delivery snapshot");
  }
  if (
    !isObjectRecord(parsed) ||
    typeof parsed.formId !== "string" ||
    typeof parsed.formTitle !== "string" ||
    (parsed.ownerEmail !== null && typeof parsed.ownerEmail !== "string") ||
    (parsed.orgId !== null && typeof parsed.orgId !== "string") ||
    !Array.isArray(parsed.fields) ||
    !isObjectRecord(parsed.data) ||
    typeof parsed.submittedAt !== "string" ||
    (parsed.submitterEmail !== null &&
      typeof parsed.submitterEmail !== "string") ||
    !Array.isArray(parsed.chatSessionIds) ||
    !parsed.chatSessionIds.every((id) => typeof id === "string") ||
    (parsed.activeRunId !== null && typeof parsed.activeRunId !== "string") ||
    (parsed.pageUrl !== null && typeof parsed.pageUrl !== "string") ||
    (parsed.clientSurface !== null &&
      typeof parsed.clientSurface !== "string") ||
    typeof parsed.emailOnNewResponses !== "boolean" ||
    !Array.isArray(parsed.integrations)
  ) {
    throw new Error("Invalid response delivery snapshot");
  }
  return {
    formId: parsed.formId,
    formTitle: parsed.formTitle,
    ownerEmail: parsed.ownerEmail,
    orgId: parsed.orgId,
    fields: parsed.fields as FormField[],
    data: parsed.data,
    submittedAt: parsed.submittedAt,
    submitterEmail: parsed.submitterEmail,
    chatSessionIds: parsed.chatSessionIds,
    activeRunId: parsed.activeRunId,
    pageUrl: parsed.pageUrl,
    clientSurface: parsed.clientSurface,
    emailOnNewResponses: parsed.emailOnNewResponses,
    integrations: parsed.integrations.map(parseIntegrationSnapshot),
  };
}

function buildDeliverySnapshot({
  form,
  settings,
  fields,
  data,
  responseId,
  submittedAt,
  submitterEmail,
  pageUrl,
  clientSurface,
  chatSessionIds,
  activeRunId,
}: {
  form: typeof schema.forms.$inferSelect;
  settings: FormSettings;
  fields: FormField[];
  data: Record<string, unknown>;
  responseId: string;
  submittedAt: string;
  submitterEmail: string | null;
  pageUrl: string | null;
  clientSurface: string | null;
  chatSessionIds: string[];
  activeRunId: string | null;
}): DeliverySnapshot {
  const submission = {
    formId: form.id,
    formTitle: form.title,
    responseId,
    fields,
    data,
    submittedAt,
    submitterEmail,
    chatSessionIds,
    activeRunId,
    pageUrl,
    clientSurface,
  };
  return {
    formId: form.id,
    formTitle: form.title,
    ownerEmail: form.ownerEmail ?? null,
    orgId: form.orgId ?? null,
    fields,
    data,
    submittedAt,
    submitterEmail,
    chatSessionIds,
    activeRunId,
    pageUrl,
    clientSurface,
    emailOnNewResponses: settings.emailOnNewResponses === true,
    integrations: buildIntegrationDeliverySnapshots(
      settings.integrations ?? [],
      submission,
    ),
  };
}

function buildResponseDeliveryRows(
  snapshot: DeliverySnapshot,
  responseId: string,
) {
  const createdAt = new Date().toISOString();
  const rows: Array<typeof schema.responseDeliveries.$inferInsert> = [];
  const add = (
    destination: string,
    kind: "application-state" | "email" | "integration",
    payload: StoredDeliveryPayload,
  ) => {
    rows.push({
      id: nanoid(),
      responseId,
      destination,
      kind,
      payload: JSON.stringify(payload),
      status: "pending",
      claimToken: null,
      claimedAt: null,
      errorMessage: null,
      createdAt,
      updatedAt: createdAt,
    });
  };

  if (snapshot.ownerEmail) {
    add(APPLICATION_STATE_DESTINATION, "application-state", {
      kind: "application-state",
      ownerEmail: snapshot.ownerEmail,
      value: {
        formId: snapshot.formId,
        responseId,
        timestamp: snapshot.submittedAt,
      },
    });
  }
  if (snapshot.emailOnNewResponses && snapshot.ownerEmail) {
    add(RESPONSE_EMAIL_DESTINATION, "email", {
      kind: "email",
      orgId: snapshot.orgId,
      args: {
        to: snapshot.ownerEmail,
        formTitle: snapshot.formTitle,
        fields: snapshot.fields,
        data: snapshot.data,
        submittedAt: snapshot.submittedAt,
      },
    });
  }
  for (const integration of snapshot.integrations) {
    add(`integration:${integration.id}`, "integration", {
      kind: "integration",
      snapshot: integration,
    });
  }
  return rows;
}

async function ensureResponseDeliveryRows(
  db: ReturnType<typeof getDb>,
  responseId: string,
  snapshot: DeliverySnapshot,
) {
  let rows = await db
    .select()
    .from(schema.responseDeliveries)
    .where(eq(schema.responseDeliveries.responseId, responseId));
  if (rows.length > 0) return rows;

  const values = buildResponseDeliveryRows(snapshot, responseId);
  if (values.length > 0) {
    await db
      .insert(schema.responseDeliveries)
      .values(values)
      .onConflictDoNothing();
    rows = await db
      .select()
      .from(schema.responseDeliveries)
      .where(eq(schema.responseDeliveries.responseId, responseId));
  }
  return rows;
}

async function claimResponseDelivery(
  db: ReturnType<typeof getDb>,
  deliveryId: string,
): Promise<string | null> {
  const claimToken = nanoid();
  const now = new Date();
  const nowIso = now.toISOString();
  const staleIso = new Date(
    now.getTime() - DELIVERY_CLAIM_LEASE_MS,
  ).toISOString();
  const [claimed] = await db
    .update(schema.responseDeliveries)
    .set({
      status: "processing",
      claimToken,
      claimedAt: nowIso,
      updatedAt: nowIso,
      errorMessage: null,
    })
    .where(
      and(
        eq(schema.responseDeliveries.id, deliveryId),
        or(
          eq(schema.responseDeliveries.status, "pending"),
          eq(schema.responseDeliveries.status, "failed"),
          and(
            eq(schema.responseDeliveries.status, "processing"),
            lt(schema.responseDeliveries.claimedAt, staleIso),
          ),
        ),
      ),
    )
    .returning({ id: schema.responseDeliveries.id });
  return claimed ? claimToken : null;
}

async function renewResponseDeliveryClaim(
  db: ReturnType<typeof getDb>,
  deliveryId: string,
  claimToken: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const [renewed] = await db
    .update(schema.responseDeliveries)
    .set({ claimedAt: nowIso, updatedAt: nowIso })
    .where(
      and(
        eq(schema.responseDeliveries.id, deliveryId),
        eq(schema.responseDeliveries.claimToken, claimToken),
        eq(schema.responseDeliveries.status, "processing"),
      ),
    )
    .returning({ id: schema.responseDeliveries.id });
  if (!renewed) throw new Error("Response delivery claim was lost");
}

function startResponseDeliveryLeaseHeartbeat(
  db: ReturnType<typeof getDb>,
  deliveryId: string,
  claimToken: string,
) {
  let stopped = false;
  let failure: unknown = null;
  let pendingRenewal: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (stopped || failure || pendingRenewal) return;
    pendingRenewal = renewResponseDeliveryClaim(db, deliveryId, claimToken)
      .catch((error) => {
        failure = error;
        clearInterval(timer);
      })
      .finally(() => {
        pendingRenewal = null;
      });
  }, DELIVERY_CLAIM_HEARTBEAT_MS);
  (timer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();

  return {
    assertHealthy() {
      if (failure) throw failure;
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await pendingRenewal;
    },
  };
}

async function markResponseDelivery(
  db: ReturnType<typeof getDb>,
  deliveryId: string,
  claimToken: string,
  status: Exclude<ResponseDeliveryStatus, "processing">,
  errorMessage: string | null = null,
): Promise<void> {
  const nowIso = new Date().toISOString();
  try {
    const [updated] = await db
      .update(schema.responseDeliveries)
      .set({
        status,
        claimToken: null,
        claimedAt: null,
        errorMessage,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(schema.responseDeliveries.id, deliveryId),
          eq(schema.responseDeliveries.claimToken, claimToken),
        ),
      )
      .returning({ id: schema.responseDeliveries.id });
    if (updated) return;
    throw new Error("Response delivery claim was lost");
  } catch (error) {
    // The database client can report a transport error after applying the
    // update. Re-read before retrying an external effect so that accepted
    // delivery is reconciled instead of duplicated.
    const [current] = await db
      .select({
        status: schema.responseDeliveries.status,
        claimToken: schema.responseDeliveries.claimToken,
      })
      .from(schema.responseDeliveries)
      .where(eq(schema.responseDeliveries.id, deliveryId));
    if (current?.status === status && current.claimToken === null) return;
    throw error;
  }
}

function parseStoredDeliveryPayload(value: string): StoredDeliveryPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Unreadable response delivery payload");
  }
  if (!isObjectRecord(parsed) || typeof parsed.kind !== "string") {
    throw new Error("Invalid response delivery payload");
  }
  if (
    parsed.kind === "application-state" &&
    typeof parsed.ownerEmail === "string" &&
    isObjectRecord(parsed.value) &&
    typeof parsed.value.formId === "string" &&
    typeof parsed.value.responseId === "string" &&
    typeof parsed.value.timestamp === "string"
  ) {
    return {
      kind: "application-state",
      ownerEmail: parsed.ownerEmail,
      value: {
        formId: parsed.value.formId,
        responseId: parsed.value.responseId,
        timestamp: parsed.value.timestamp,
      },
    };
  }
  if (
    parsed.kind === "email" &&
    (parsed.orgId === null || typeof parsed.orgId === "string") &&
    isObjectRecord(parsed.args) &&
    typeof parsed.args.to === "string" &&
    typeof parsed.args.formTitle === "string" &&
    Array.isArray(parsed.args.fields) &&
    isObjectRecord(parsed.args.data) &&
    typeof parsed.args.submittedAt === "string"
  ) {
    return {
      kind: "email",
      orgId: parsed.orgId,
      args: {
        to: parsed.args.to,
        formTitle: parsed.args.formTitle,
        fields: parsed.args.fields as FormField[],
        data: parsed.args.data,
        submittedAt: parsed.args.submittedAt,
      },
    };
  }
  if (parsed.kind === "integration") {
    return {
      kind: "integration",
      snapshot: parseIntegrationSnapshot(parsed.snapshot),
    };
  }
  throw new Error("Invalid response delivery payload");
}

function deliveryErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

async function deliverStoredResponseDelivery(
  row: typeof schema.responseDeliveries.$inferSelect,
): Promise<void> {
  const payload = parseStoredDeliveryPayload(row.payload);
  switch (payload.kind) {
    case "application-state": {
      const { appStatePut } =
        await import("@agent-native/core/application-state");
      await appStatePut(payload.ownerEmail, "new-submission", payload.value);
      return;
    }
    case "email":
      await runWithRequestContext(
        {
          userEmail: payload.args.to,
          orgId: payload.orgId ?? undefined,
        },
        () => sendNewResponseEmail(payload.args),
      );
      return;
    case "integration":
      await deliverIntegrationDelivery(
        payload.snapshot,
        `forms:${row.responseId}:${row.destination}`,
      );
  }
}

async function deliverStoredResponseDeliveries(
  db: ReturnType<typeof getDb>,
  responseId: string,
  snapshot: DeliverySnapshot,
): Promise<boolean> {
  const rows = await ensureResponseDeliveryRows(db, responseId, snapshot);
  await Promise.all(
    rows.map(async (row) => {
      const claimToken = await claimResponseDelivery(db, row.id);
      if (!claimToken) return;
      const heartbeat = startResponseDeliveryLeaseHeartbeat(
        db,
        row.id,
        claimToken,
      );
      try {
        await deliverStoredResponseDelivery(row);
        await heartbeat.stop();
        heartbeat.assertHealthy();
        await markResponseDelivery(db, row.id, claimToken, "succeeded");
      } catch (error) {
        await heartbeat.stop();
        console.warn(`[forms] ${row.destination} delivery failed:`, error);
        await markResponseDelivery(
          db,
          row.id,
          claimToken,
          "failed",
          deliveryErrorMessage(error),
        );
      }
    }),
  );
  await refreshResponseDeliverySummary(db, responseId);
  const currentRows = await db
    .select()
    .from(schema.responseDeliveries)
    .where(eq(schema.responseDeliveries.responseId, responseId));
  return currentRows.some((row) => row.status !== "succeeded");
}

export async function reconcileResponseDeliveries(responseId: string) {
  const db = getDb();
  const [response] = await db
    .select({
      id: schema.responses.id,
      deliverySnapshot: schema.responses.deliverySnapshot,
    })
    .from(schema.responses)
    .where(eq(schema.responses.id, responseId));
  if (!response) throw new Error(`Response ${responseId} not found`);

  const snapshot = parseDeliverySnapshot(response.deliverySnapshot);
  if (!snapshot) {
    throw new Error(`Response ${responseId} has no delivery snapshot`);
  }

  const pending = await deliverStoredResponseDeliveries(
    db,
    response.id,
    snapshot,
  );
  return {
    success: !pending,
    retryable: pending,
    id: response.id,
  };
}

function deliverySummary(
  rows: Array<typeof schema.responseDeliveries.$inferSelect>,
) {
  const summary: Record<string, "pending" | "succeeded" | "failed"> = {};
  for (const row of [...rows].sort((a, b) =>
    a.destination.localeCompare(b.destination),
  )) {
    summary[row.destination] =
      row.status === "processing" ? "pending" : row.status;
  }
  return summary;
}

async function refreshResponseDeliverySummary(
  db: ReturnType<typeof getDb>,
  responseId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [response] = await tx
      .select({ deliveryStatus: schema.responses.deliveryStatus })
      .from(schema.responses)
      .where(eq(schema.responses.id, responseId));
    if (!response) return;

    // Serialize all summary writers on the response row before reading the
    // delivery rows, so a retry cannot commit an older aggregate after a
    // newer destination status has been recorded.
    await tx
      .update(schema.responses)
      .set({ deliveryStatus: response.deliveryStatus })
      .where(eq(schema.responses.id, responseId));
    const rows = await tx
      .select()
      .from(schema.responseDeliveries)
      .where(eq(schema.responseDeliveries.responseId, responseId));
    await tx
      .update(schema.responses)
      .set({ deliveryStatus: JSON.stringify(deliverySummary(rows)) })
      .where(eq(schema.responses.id, responseId));
  });
}

async function deliverBestEffortResponseSideEffects({
  form,
  settings,
  fields,
  data,
  responseId,
  submittedAt,
  submitterEmail,
  pageUrl,
  clientSurface,
  chatSessionIds,
  activeRunId,
}: {
  form: typeof schema.forms.$inferSelect;
  settings: FormSettings;
  fields: FormField[];
  data: Record<string, unknown>;
  responseId: string;
  submittedAt: string;
  submitterEmail: string | null;
  pageUrl: string | null;
  clientSurface: string | null;
  chatSessionIds: string[];
  activeRunId: string | null;
}): Promise<void> {
  const run = async (label: string, effect: () => Promise<void>) => {
    try {
      await effect();
    } catch (error) {
      console.warn(`[forms] ${label} delivery failed:`, error);
    }
  };
  if (form.ownerEmail) {
    await run("application state", async () => {
      const { appStatePut } =
        await import("@agent-native/core/application-state");
      await appStatePut(form.ownerEmail!, "new-submission", {
        formId: form.id,
        responseId,
        timestamp: submittedAt,
      });
    });
  }
  if (settings.emailOnNewResponses === true && form.ownerEmail) {
    await run("new response email", async () => {
      await runWithRequestContext(
        { userEmail: form.ownerEmail!, orgId: form.orgId ?? undefined },
        () =>
          sendNewResponseEmail({
            to: form.ownerEmail!,
            formTitle: form.title,
            fields,
            data,
            submittedAt,
          }),
      );
    });
  }
  const integrations = settings.integrations ?? [];
  if (integrations.length > 0) {
    await fireIntegrations(integrations, {
      formId: form.id,
      formTitle: form.title,
      responseId,
      fields,
      data,
      submittedAt,
      submitterEmail,
      chatSessionIds,
      activeRunId,
      pageUrl,
      clientSurface,
    });
  }
}

async function deliverResponseSideEffects({
  db,
  form,
  settings,
  fields,
  data,
  responseId,
  submittedAt,
  submitterEmail,
  pageUrl,
  clientSurface,
  chatSessionIds,
  activeRunId,
  trackDelivery,
  deliverySnapshot,
}: {
  db: ReturnType<typeof getDb>;
  form: typeof schema.forms.$inferSelect;
  settings: FormSettings;
  fields: FormField[];
  data: Record<string, unknown>;
  responseId: string;
  submittedAt: string;
  submitterEmail: string | null;
  pageUrl: string | null;
  clientSurface: string | null;
  chatSessionIds: string[];
  activeRunId: string | null;
  trackDelivery: boolean;
  deliverySnapshot: DeliverySnapshot | null;
}): Promise<boolean> {
  if (!trackDelivery) {
    await deliverBestEffortResponseSideEffects({
      form,
      settings,
      fields,
      data,
      responseId,
      submittedAt,
      submitterEmail,
      pageUrl,
      clientSurface,
      chatSessionIds,
      activeRunId,
    });
    return false;
  }
  const snapshot =
    deliverySnapshot ??
    buildDeliverySnapshot({
      form,
      settings,
      fields,
      data,
      responseId,
      submittedAt,
      submitterEmail,
      pageUrl,
      clientSurface,
      chatSessionIds,
      activeRunId,
    });
  return deliverStoredResponseDeliveries(db, responseId, snapshot);
}

export const submitForm = defineEventHandler(async (event: H3Event) => {
  const db = getDb();
  const id = getRouterParam(event, "id") as string;

  // coercion-ok: malformed request bodies are rejected as invalid submissions.
  const body = await readBody(event).catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    setResponseStatus(event, 400);
    return { error: "Invalid submission payload" };
  }

  // Check overall payload size
  const bodyStr = JSON.stringify(body);
  if (Buffer.byteLength(bodyStr, "utf8") > MAX_PAYLOAD_BYTES) {
    setResponseStatus(event, 413);
    return { error: "Payload too large" };
  }

  const rawIdempotencyKey = getRequestHeader(event, "idempotency-key");
  if (
    rawIdempotencyKey &&
    rawIdempotencyKey.trim().length > MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    setResponseStatus(event, 400);
    return { error: "Idempotency-Key is too long" };
  }
  const idempotencyKey = rawIdempotencyKey?.trim() || null;

  // A retry must be able to reconcile a persisted response even after its
  // form is unpublished or soft-deleted. The immutable snapshot is the only
  // input needed for delivery, so do this lookup before loading the active
  // form or applying one-time submission checks.
  if (idempotencyKey) {
    const [existing] = await db
      .select({
        id: schema.responses.id,
        deliverySnapshot: schema.responses.deliverySnapshot,
      })
      .from(schema.responses)
      .where(
        and(
          eq(schema.responses.formId, id),
          eq(schema.responses.idempotencyKey, idempotencyKey),
        ),
      );
    if (existing) {
      try {
        const snapshot = parseDeliverySnapshot(existing.deliverySnapshot);
        if (!snapshot) {
          throw new Error(`Response ${existing.id} has no delivery snapshot`);
        }
        const deliveryPending = await deliverStoredResponseDeliveries(
          db,
          existing.id,
          snapshot,
        );
        if (deliveryPending) {
          setResponseStatus(event, 503);
          return {
            error: "Response delivery is still pending",
            retryable: true,
            id: existing.id,
          };
        }
      } catch (error) {
        console.warn("[forms] response delivery retry failed:", error);
        setResponseStatus(event, 503);
        return {
          error: "Response delivery is still pending",
          retryable: true,
          id: existing.id,
        };
      }
      return { success: true, id: existing.id };
    }
  }

  // guard:allow-unscoped — public submission endpoint intentionally accepts anonymous responses for published forms by id; it returns no owner data and rejects non-published forms.
  // Public submission endpoint: published forms are intentionally readable
  // without an authenticated viewer, but only by exact id and published status.
  // guard:allow-unscoped — anonymous respondents must be able to submit published forms; unpublished/private forms still return 404
  const form = await db
    .select()
    .from(schema.forms)
    .where(
      and(
        eq(schema.forms.id, id),
        eq(schema.forms.status, "published"),
        isNull(schema.forms.deletedAt),
      ),
    )

    .then((rows) => rows[0]);
  if (!form) {
    setResponseStatus(event, 404);
    return { error: "Form not found or not accepting responses" };
  }

  const settings: FormSettings = form.settings ? JSON.parse(form.settings) : {};

  // Origin allowlist (per-form). Empty/unset = allow any (back-compat).
  // Skip for same-origin requests (no Origin header set by browser on
  // same-origin POSTs from some setups).
  const allowedOrigins = settings.allowedOrigins ?? [];
  if (allowedOrigins.length > 0) {
    const origin = getRequestHeader(event, "origin");
    if (!origin || !allowedOrigins.includes(origin)) {
      setResponseStatus(event, 403);
      return { error: "Origin not allowed" };
    }
  }

  const finishResponse = async ({
    responseId,
    fields,
    data,
    submittedAt,
    submitterEmail,
    pageUrl,
    clientSurface,
    chatSessionIds,
    activeRunId,
    deliverySnapshot,
  }: {
    responseId: string;
    fields: FormField[];
    data: Record<string, unknown>;
    submittedAt: string;
    submitterEmail: string | null;
    pageUrl: string | null;
    clientSurface: string | null;
    chatSessionIds: string[];
    activeRunId: string | null;
    deliverySnapshot: string | null | undefined;
  }) => {
    try {
      const tracked = idempotencyKey !== null;
      let parsedDeliverySnapshot = tracked
        ? parseDeliverySnapshot(deliverySnapshot)
        : null;
      if (tracked && !parsedDeliverySnapshot) {
        parsedDeliverySnapshot = buildDeliverySnapshot({
          form,
          settings,
          fields,
          data,
          responseId,
          submittedAt,
          submitterEmail,
          pageUrl,
          clientSurface,
          chatSessionIds,
          activeRunId,
        });
        await db
          .update(schema.responses)
          .set({ deliverySnapshot: JSON.stringify(parsedDeliverySnapshot) })
          .where(
            and(
              eq(schema.responses.id, responseId),
              isNull(schema.responses.deliverySnapshot),
            ),
          );
      }
      const deliveryPending = await deliverResponseSideEffects({
        db,
        form,
        settings,
        fields,
        data,
        responseId,
        submittedAt,
        submitterEmail,
        pageUrl,
        clientSurface,
        chatSessionIds,
        activeRunId,
        trackDelivery: tracked,
        deliverySnapshot: parsedDeliverySnapshot,
      });
      if (deliveryPending) {
        setResponseStatus(event, 503);
        return {
          error: "Response delivery is still pending",
          retryable: true,
          id: responseId,
        };
      }
    } catch (error) {
      console.warn("[forms] response delivery status update failed:", error);
      if (idempotencyKey) {
        setResponseStatus(event, 503);
        return {
          error: "Response delivery is still pending",
          retryable: true,
          id: responseId,
        };
      }
    }
    return { success: true, id: responseId };
  };

  // Honeypot: silently accept-and-drop if filled. Bots that fire-and-forget
  // get a 200 and never know they were caught.
  if (typeof body._hp === "string" && body._hp.length > 0) {
    return { success: true, id: "" };
  }

  // Min time-to-submit: client-controlled timestamp from when the form was
  // shown. Trivially spoofable, but blocks naive scripted submitters.
  // Negative elapsed means _t is in the future — treat as a bypass attempt.
  if (typeof body._t === "number" && body._t > 0) {
    const elapsed = Date.now() - body._t;
    if (elapsed < MIN_FILL_TIME_MS) {
      setResponseStatus(event, 429);
      return { error: "Submitted too quickly" };
    }
  }

  // Verify captcha — but only when the public site key is configured. The
  // client (SSR renderer and React page) only renders the Turnstile widget and
  // produces a token when VITE_TURNSTILE_SITE_KEY is set, so enforcing the
  // secret without the site key would reject every submission with no widget
  // ever shown. Keep the requirement symmetric: skip verification when the
  // client could not have rendered a widget.
  if (process.env.VITE_TURNSTILE_SITE_KEY) {
    const captchaResult = await verifyCaptcha(body.captchaToken ?? "");
    if (!captchaResult.success) {
      setResponseStatus(event, 403);
      return { error: "Captcha verification failed" };
    }
  }

  // Parse form fields and build whitelist of valid field IDs
  const fields: FormField[] = JSON.parse(form.fields);
  const fieldMap = new Map(fields.map((f) => [f.id, f]));
  const submittedData =
    body.data && typeof body.data === "object" && !Array.isArray(body.data)
      ? (body.data as Record<string, unknown>)
      : {};

  // Whitelist: only accept keys matching form field IDs
  const whitelistedData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(submittedData)) {
    const field = fieldMap.get(key);
    if (!field) continue; // Strip unknown fields
    whitelistedData[key] = value;
  }

  const data = sanitizeVisibleValues(fields, whitelistedData);

  // Validate required fields and field-specific constraints. Recompute
  // conditional visibility on the server so direct POSTs cannot submit hidden
  // field values or bypass client-side validation.
  for (const field of fields) {
    if (field.conditional && !isConditionalFieldVisible(field, data)) continue;

    const val = data[field.id];
    if (field.required && isEmptySubmissionValue(val)) {
      setResponseStatus(event, 400);
      return { error: `${field.label} is required` };
    }

    const validationError = validateSubmissionField(field, val);
    if (validationError) {
      setResponseStatus(event, 400);
      return { error: validationError };
    }
  }

  const now = new Date().toISOString();
  const responseId = nanoid();
  const anonymous = settings.anonymous === true;
  const ip = anonymous ? null : (getRequestIP(event) ?? null);

  // Optional metadata sent by trusted clients (e.g. the framework's
  // FeedbackButton, which forwards the logged-in user's email so we can see
  // who sent feedback in Slack). Never required. Prefer the Forms-host session
  // when present; cross-app feedback submissions fall back to the client hint,
  // which is useful context but not verified identity.
  const metadata = submissionMetadata(
    body as Record<string, unknown>,
    anonymous,
  );
  const session = anonymous ? null : await getSession(event).catch(() => null);
  const submitterEmail =
    cleanSubmitterEmail(session?.email) ?? metadata.submitterEmail;
  const { chatSessionIds, activeRunId, pageUrl, clientSurface } = metadata;
  const deliverySnapshot = idempotencyKey
    ? buildDeliverySnapshot({
        form,
        settings,
        fields,
        data,
        responseId,
        submittedAt: now,
        submitterEmail,
        pageUrl,
        clientSurface,
        chatSessionIds,
        activeRunId,
      })
    : null;

  const responseValues = {
    id: responseId,
    formId: id,
    data: JSON.stringify(data),
    submittedAt: now,
    ip,
    submitterEmail,
    pageUrl,
    clientSurface,
    idempotencyKey,
    deliveryStatus: deliverySnapshot
      ? JSON.stringify(configuredDeliveryStatuses(deliverySnapshot))
      : null,
    deliverySnapshot: deliverySnapshot
      ? JSON.stringify(deliverySnapshot)
      : null,
  };

  if (idempotencyKey) {
    const [inserted] = await db
      .insert(schema.responses)
      .values(responseValues)
      .onConflictDoNothing()
      .returning({ id: schema.responses.id });
    if (!inserted) {
      const [existing] = await db
        .select({
          id: schema.responses.id,
          data: schema.responses.data,
          submittedAt: schema.responses.submittedAt,
          submitterEmail: schema.responses.submitterEmail,
          pageUrl: schema.responses.pageUrl,
          clientSurface: schema.responses.clientSurface,
          deliveryStatus: schema.responses.deliveryStatus,
          deliverySnapshot: schema.responses.deliverySnapshot,
        })
        .from(schema.responses)
        .where(
          and(
            eq(schema.responses.formId, id),
            eq(schema.responses.idempotencyKey, idempotencyKey),
          ),
        );
      if (!existing) {
        throw new Error(
          "Submission idempotency conflict could not be resolved",
        );
      }
      const existingMetadata = submissionMetadata(
        body as Record<string, unknown>,
        anonymous,
      );
      return finishResponse({
        responseId: existing.id,
        fields,
        data: JSON.parse(existing.data),
        submittedAt: existing.submittedAt,
        submitterEmail: existing.submitterEmail,
        pageUrl: existing.pageUrl,
        clientSurface: existing.clientSurface,
        chatSessionIds: existingMetadata.chatSessionIds,
        activeRunId: existingMetadata.activeRunId,
        deliverySnapshot: existing.deliverySnapshot,
      });
    }
  } else {
    await db.insert(schema.responses).values(responseValues);
  }

  return finishResponse({
    responseId,
    fields,
    data,
    submittedAt: now,
    submitterEmail,
    pageUrl,
    clientSurface,
    chatSessionIds,
    activeRunId,
    deliverySnapshot: responseValues.deliverySnapshot,
  });
});

export const listResponses = defineEventHandler(async (event: H3Event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Sign in to view responses" };
  }

  const id = getRouterParam(event, "id") as string;
  const query = getQuery(event);
  const requestedLimit = parseInt((query.limit as string) || "100", 10);
  const limit = Math.min(Math.max(requestedLimit || 100, 1), 500);

  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId ?? undefined },
    async () => {
      let access;
      try {
        access = await assertAccess("form", id, "editor");
      } catch {
        setResponseStatus(event, 404);
        return { error: "Form not found" };
      }

      const db = getDb();
      const rows = await db
        .select()
        .from(schema.responses)
        .where(eq(schema.responses.formId, id))
        .orderBy(desc(schema.responses.submittedAt))
        .limit(limit);
      const total = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.responses)
        .where(eq(schema.responses.formId, id))

        .then((rows) => rows[0]);

      return {
        responses: rows.map((r) => ({
          id: r.id,
          formId: r.formId,
          data: JSON.parse(r.data),
          submittedAt: r.submittedAt,
          submitterEmail: publicSubmitterEmail(r.submitterEmail),
          pageUrl: r.pageUrl ?? null,
          clientSurface: r.clientSurface ?? null,
        })) as FormResponse[],
        total: total?.count ?? 0,
        fields: JSON.parse(access.resource.fields),
      };
    },
  );
});
