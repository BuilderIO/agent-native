import {
  getSession,
  readBody,
  runWithRequestContext,
  verifyCaptcha,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, desc, isNull, sql } from "drizzle-orm";
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
  fireIntegrations,
  integrationDeliveryKey,
  type DeliveryStatus,
  type DeliveryStatuses,
} from "../lib/integrations.js";
import { sendNewResponseEmail } from "../lib/response-email.js";
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

function parseDeliveryStatuses(
  value: string | null | undefined,
): DeliveryStatuses {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Unreadable response delivery status");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid response delivery status");
  }
  const statuses: DeliveryStatuses = {};
  for (const [destination, status] of Object.entries(parsed)) {
    if (status !== "pending" && status !== "succeeded" && status !== "failed") {
      throw new Error(`Invalid delivery status for ${destination}`);
    }
    statuses[destination] = status;
  }
  return statuses;
}

function configuredDeliveryStatuses(
  ownerEmail: string | null | undefined,
  settings: FormSettings,
): DeliveryStatuses {
  const statuses: DeliveryStatuses = {};
  if (ownerEmail) statuses[APPLICATION_STATE_DESTINATION] = "pending";
  if (settings.emailOnNewResponses === true && ownerEmail) {
    statuses[RESPONSE_EMAIL_DESTINATION] = "pending";
  }
  for (const integration of settings.integrations ?? []) {
    if (integration.enabled && integration.url) {
      statuses[integrationDeliveryKey(integration.id)] = "pending";
    }
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
  deliveryStatus,
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
  deliveryStatus: string | null | undefined;
}): Promise<boolean> {
  const tracked = trackDelivery;
  const configured = configuredDeliveryStatuses(form.ownerEmail, settings);
  const parsedStatuses = parseDeliveryStatuses(deliveryStatus);
  const statuses: DeliveryStatuses = { ...parsedStatuses };
  for (const destination of Object.keys(configured)) {
    statuses[destination] ??= "pending";
  }

  let statusWrite: Promise<void> = Promise.resolve();
  const persistStatuses = () => {
    if (!tracked) return statusWrite;
    const snapshot = JSON.stringify(statuses);
    statusWrite = statusWrite.then(async () => {
      await db
        .update(schema.responses)
        .set({ deliveryStatus: snapshot })
        .where(eq(schema.responses.id, responseId));
    });
    return statusWrite;
  };

  if (tracked && deliveryStatus !== JSON.stringify(statuses)) {
    await persistStatuses();
  }

  const mark = (destination: string, status: DeliveryStatus) => {
    statuses[destination] = status;
    return persistStatuses();
  };

  const run = async (
    destination: string,
    label: string,
    effect: () => Promise<void>,
  ) => {
    if (tracked && statuses[destination] === "succeeded") return;
    try {
      await effect();
      await mark(destination, "succeeded");
    } catch (error) {
      console.warn(`[forms] ${label} delivery failed:`, error);
      await mark(destination, "failed");
    }
  };

  if (form.ownerEmail) {
    await run(APPLICATION_STATE_DESTINATION, "application state", async () => {
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
    await run(RESPONSE_EMAIL_DESTINATION, "new response email", async () => {
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
    await fireIntegrations(
      integrations,
      {
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
      },
      tracked
        ? {
            deliveryStatus: statuses,
            onStatusChange: mark,
          }
        : undefined,
    );
  }

  await statusWrite;
  return (
    tracked &&
    Object.keys(configured).some(
      (destination) => statuses[destination] !== "succeeded",
    )
  );
}

export const submitForm = defineEventHandler(async (event: H3Event) => {
  const db = getDb();
  const id = getRouterParam(event, "id") as string;

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
    deliveryStatus,
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
    deliveryStatus: string | null | undefined;
  }) => {
    try {
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
        trackDelivery: idempotencyKey !== null,
        deliveryStatus,
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

  // A retry may arrive after the original response was persisted but before
  // the client received its success response. Replay the original result
  // before applying any one-time submission checks or side effects.
  if (idempotencyKey) {
    const [existing] = await db
      .select({
        id: schema.responses.id,
        data: schema.responses.data,
        submittedAt: schema.responses.submittedAt,
        submitterEmail: schema.responses.submitterEmail,
        pageUrl: schema.responses.pageUrl,
        clientSurface: schema.responses.clientSurface,
        deliveryStatus: schema.responses.deliveryStatus,
      })
      .from(schema.responses)
      .where(
        and(
          eq(schema.responses.formId, id),
          eq(schema.responses.idempotencyKey, idempotencyKey),
        ),
      );
    if (existing) {
      const metadata = submissionMetadata(
        body as Record<string, unknown>,
        settings.anonymous === true,
      );
      return finishResponse({
        responseId: existing.id,
        fields: JSON.parse(form.fields),
        data: JSON.parse(existing.data),
        submittedAt: existing.submittedAt,
        submitterEmail: existing.submitterEmail,
        pageUrl: existing.pageUrl,
        clientSurface: existing.clientSurface,
        chatSessionIds: metadata.chatSessionIds,
        activeRunId: metadata.activeRunId,
        deliveryStatus: existing.deliveryStatus,
      });
    }
  }

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
    deliveryStatus: idempotencyKey
      ? JSON.stringify(configuredDeliveryStatuses(form.ownerEmail, settings))
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
        deliveryStatus: existing.deliveryStatus,
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
    deliveryStatus: responseValues.deliveryStatus,
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
