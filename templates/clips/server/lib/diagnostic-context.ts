import { createHash, randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import { isOrgMember } from "@agent-native/core/org";
import {
  deletePrivateBlob,
  putPrivateBlob,
  readPrivateBlob,
  isPrivateBlobError,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import {
  getRequestOrgId,
  getRequestUserEmail,
  signScopedAgentAccessToken,
  verifyScopedAgentAccessToken,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import {
  filterAppActivityEvents,
  sanitizeAppActivity,
  summarizeAppActivity,
  type AppActivity,
} from "../../shared/app-activity.js";
import {
  MAX_BROWSER_DIAGNOSTIC_CONSOLE_LOGS,
  MAX_BROWSER_DIAGNOSTIC_NETWORK_REQUESTS,
  MAX_BROWSER_DIAGNOSTIC_INTERACTION_EVENTS,
  isSecretDiagnosticKey,
  redactBrowserDiagnosticString,
} from "../../shared/browser-diagnostics.js";
import {
  DIAGNOSTIC_RESOURCE_KIND,
  DIAGNOSTIC_RETENTION_MS,
  DIAGNOSTIC_SCOPES,
  diagnosticContextInputSchema,
  diagnosticScopeSchema,
  type DiagnosticScope,
} from "../../shared/diagnostic-context.js";
import { getDb, schema } from "../db/index.js";
import { claimLease, releaseLease, renewLease } from "./recording-leases.js";

const browserEntrySchema = z
  .object({ elapsedMs: z.number().finite() })
  .catchall(z.unknown());
const privateBrowserSchema = z
  .object({
    consoleLogs: z
      .array(browserEntrySchema)
      .max(MAX_BROWSER_DIAGNOSTIC_CONSOLE_LOGS)
      .optional(),
    networkRequests: z
      .array(browserEntrySchema)
      .max(MAX_BROWSER_DIAGNOSTIC_NETWORK_REQUESTS)
      .optional(),
    interactionEvents: z
      .array(browserEntrySchema)
      .max(MAX_BROWSER_DIAGNOSTIC_INTERACTION_EVENTS)
      .optional(),
  })
  .catchall(z.unknown());

const contexts = schema.recordingDiagnosticContexts;
const grants = schema.recordingDiagnosticGrants;
const shares = schema.recordingDiagnosticContextShares;
type Context = typeof contexts.$inferSelect;
type Grant = typeof grants.$inferSelect;
export type DiagnosticAccess = {
  context: Context;
  scopes: DiagnosticScope[];
  fromMs?: number | undefined;
  toMs?: number | undefined;
  canManage: boolean;
  kind: "owner" | "named" | "grant";
  authorization: {
    contextId?: string | undefined;
    recordingId?: string | undefined;
    diagnosticAccess?: string | undefined;
    userEmail?: string | undefined;
    orgId?: string | undefined;
  };
};

export function diagnosticFailure(code: string, statusCode = 403): never {
  fail(`Diagnostic context ${code}.`, {
    errorCode: `diagnostic_${code}`,
    statusCode,
  });
}

function diagnosticExpired(value: string | null | undefined) {
  if (value == null) return false;
  const timestamp = Date.parse(value);
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}

export function diagnosticPrincipal() {
  const ownerEmail = getRequestUserEmail();
  const orgId = getRequestOrgId();
  if (!ownerEmail || !orgId) diagnosticFailure("authentication_required", 401);
  return { ownerEmail, orgId };
}

export async function authorizeDiagnosticCapture(
  recordingId: string,
  consent: boolean,
  captureId: string,
) {
  const principal = diagnosticPrincipal();
  if (
    !consent ||
    !(await isFeatureFlagEnabled("clips-private-diagnostic-capture", {
      userEmail: principal.ownerEmail,
      orgId: principal.orgId,
    }))
  ) {
    diagnosticFailure("capture_disabled");
  }
  const access = await assertAccess("recording", recordingId, "editor");
  const recording = access.resource as {
    orgId?: string | null;
    expiresAt?: string | null;
    trashedAt?: string | null;
    archivedAt?: string | null;
  };
  if (
    recording.orgId !== principal.orgId ||
    recording.trashedAt ||
    recording.archivedAt ||
    (recording.expiresAt && diagnosticExpired(recording.expiresAt))
  )
    diagnosticFailure("recording_unavailable", 410);
  if (!(await isOrgMember(principal.orgId, principal.ownerEmail)))
    diagnosticFailure("membership_required");
  const captureAuthorization = signScopedAgentAccessToken({
    resourceKind: "clips-diagnostic-capture",
    resourceId: `${principal.orgId}:${principal.ownerEmail}:${recordingId}:${captureId}`,
    ttlSeconds: 604800,
  });
  return { authorized: true as const, ...principal, captureAuthorization };
}

export async function checkDiagnosticCaptureAuthorization(
  recordingId: string,
  captureId: string,
  captureAuthorization: string,
) {
  const principal = diagnosticPrincipal();
  const receipt = verifyScopedAgentAccessToken(captureAuthorization, {
    resourceKind: "clips-diagnostic-capture",
    resourceId: `${principal.orgId}:${principal.ownerEmail}:${recordingId}:${captureId}`,
  });
  if (
    !receipt.ok ||
    !(await isOrgMember(principal.orgId, principal.ownerEmail))
  )
    diagnosticFailure("capture_authorization_invalid");
  const access = await assertAccess("recording", recordingId, "editor");
  const recording = access.resource as {
    orgId?: string | undefined;
    expiresAt?: string | null;
    trashedAt?: string | null;
    archivedAt?: string | null;
  };
  if (
    recording.orgId !== principal.orgId ||
    recording.trashedAt ||
    recording.archivedAt ||
    (recording.expiresAt && diagnosticExpired(recording.expiresAt))
  )
    diagnosticFailure("recording_unavailable", 410);
  return principal;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function redactPayload(value: unknown, depth = 0): unknown {
  if (depth > 12) diagnosticFailure("payload_too_deep", 400);
  if (typeof value === "string")
    return redactBrowserDiagnosticString(value, {
      redactQueryValues: true,
    }).slice(0, 20_000);
  if (Array.isArray(value))
    return value.map((item) => redactPayload(item, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isSecretDiagnosticKey(key)
          ? "<redacted>"
          : redactPayload(item, depth + 1),
      ]),
    );
  return value;
}

function clampActivitySpans(
  spans: unknown,
  fromMs: number,
  toMs: number,
): unknown {
  if (!Array.isArray(spans)) return spans;
  return spans.flatMap((span) => {
    if (!span || typeof span !== "object" || Array.isArray(span)) return [span];
    const value = span as Record<string, unknown>;
    if (
      typeof value.fromMs !== "number" ||
      !Number.isFinite(value.fromMs) ||
      typeof value.toMs !== "number" ||
      !Number.isFinite(value.toMs) ||
      value.fromMs > value.toMs
    )
      return [span];
    const clippedFrom = Math.max(fromMs, value.fromMs);
    const clippedTo = Math.min(toMs, value.toMs);
    return clippedFrom <= clippedTo
      ? [{ ...value, fromMs: clippedFrom, toMs: clippedTo }]
      : [];
  });
}

export async function saveDiagnosticContext(
  raw: z.input<typeof diagnosticContextInputSchema>,
) {
  const input = diagnosticContextInputSchema.parse(raw);
  const principal = await checkDiagnosticCaptureAuthorization(
    input.recordingId,
    input.captureId,
    input.captureAuthorization,
  );
  const rawDigest = createHash("sha256")
    .update(canonicalJson({ ...input, captureAuthorization: undefined }))
    .digest("hex");
  const db = getDb();
  const existing = (
    await db
      .select()
      .from(contexts)
      .where(
        and(
          eq(contexts.orgId, principal.orgId),
          eq(contexts.ownerEmail, principal.ownerEmail),
          eq(contexts.captureId, input.captureId),
          eq(contexts.contextVersion, input.contextVersion),
        ),
      )
      .limit(1)
  )
    .values()
    .next().value;
  if (existing) {
    if (
      existing.digest !== rawDigest ||
      existing.recordingId !== input.recordingId
    )
      diagnosticFailure("capture_conflict", 409);
    if (existing.removedAt || diagnosticExpired(existing.expiresAt))
      diagnosticFailure("expired", 410);
    return savedResult(existing);
  }
  const start = Date.parse(input.recordingStartedAt);
  const from = Date.parse(input.requestedWindow.from);
  const to = Date.parse(input.requestedWindow.to);
  if (
    from < start - 300_000 ||
    to < from ||
    to > Date.now() + 60_000 ||
    start > to
  )
    diagnosticFailure("window_invalid", 400);
  let activity: AppActivity | undefined;
  let browserDiagnostics: z.infer<typeof privateBrowserSchema> | undefined;
  try {
    browserDiagnostics = input.browserDiagnostics
      ? privateBrowserSchema.parse(input.browserDiagnostics)
      : undefined;
    activity = input.activity
      ? sanitizeAppActivity({
          ...input.activity,
          requestedWindow: { fromMs: from, toMs: to },
          recordingStartedAtMs: start,
          sourceCoverage: clampActivitySpans(
            input.activity.sourceCoverage,
            from,
            to,
          ),
          gaps: clampActivitySpans(input.activity.gaps, from, to),
        } as unknown as AppActivity)
      : undefined;
  } catch (error) {
    if (
      error instanceof TypeError ||
      error instanceof RangeError ||
      error instanceof z.ZodError
    )
      diagnosticFailure("input_invalid", 400);
    throw error;
  }
  const payload = redactPayload({
    activity,
    browserDiagnostics,
    hostMetadata: input.hostMetadata,
  });
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (bytes.byteLength > 2_000_000) diagnosticFailure("payload_too_large", 413);
  const handle = await putPrivateBlob({
    data: bytes,
    filename: "private-context.json",
    mimeType: "application/json",
    ownerEmail: principal.ownerEmail,
    metadata: {
      purpose: "clips-diagnostic-context",
      recordingId: input.recordingId,
      captureId: input.captureId,
      orgId: principal.orgId,
    },
  });
  if (!handle) diagnosticFailure("storage_not_configured", 409);
  const recording = (
    await db
      .select({ expiresAt: schema.recordings.expiresAt })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, input.recordingId))
      .limit(1)
  )
    .values()
    .next().value;
  const retention = Date.now() + DIAGNOSTIC_RETENTION_MS;
  const deadline = recording?.expiresAt
    ? Math.min(retention, Date.parse(recording.expiresAt))
    : retention;
  const context: Context = {
    id: randomUUID(),
    recordingId: input.recordingId,
    captureId: input.captureId,
    contextVersion: input.contextVersion,
    digest: rawDigest,
    ownerEmail: principal.ownerEmail,
    orgId: principal.orgId,
    visibility: "private",
    recordingStartedAt: input.recordingStartedAt,
    requestedFrom: input.requestedWindow.from,
    requestedTo: input.requestedWindow.to,
    coverageJson: JSON.stringify(input.coverage),
    gapsJson: JSON.stringify(input.gaps),
    pausesJson: JSON.stringify(input.pauses),
    droppedEvents: Math.max(input.droppedEvents, activity?.dropped ?? 0),
    captured: input.captured,
    failureCode: input.failureCode ?? null,
    blobJson: JSON.stringify(handle),
    expiresAt: new Date(deadline).toISOString(),
    removedAt: null,
    createdAt: new Date().toISOString(),
  };
  try {
    return await db.transaction(async (tx) => {
      await tx
        .select({ id: schema.recordings.id })
        .from(schema.recordings)
        .where(eq(schema.recordings.id, input.recordingId))
        .for("update");
      const retry = (
        await tx
          .select()
          .from(contexts)
          .where(
            and(
              eq(contexts.orgId, principal.orgId),
              eq(contexts.ownerEmail, principal.ownerEmail),
              eq(contexts.captureId, input.captureId),
              eq(contexts.contextVersion, input.contextVersion),
            ),
          )
          .limit(1)
      )
        .values()
        .next().value;
      if (retry) {
        await tx
          .insert(schema.recordingDiagnosticCleanup)
          .values({ contextId: context.id, blobJson: context.blobJson })
          .onConflictDoNothing();
        if (
          retry.digest !== rawDigest ||
          retry.recordingId !== input.recordingId
        )
          diagnosticFailure("capture_conflict", 409);
        return savedResult(retry);
      }
      const replaced = await tx
        .select()
        .from(contexts)
        .where(
          and(
            eq(contexts.recordingId, input.recordingId),
            eq(contexts.orgId, principal.orgId),
            eq(contexts.ownerEmail, principal.ownerEmail),
            isNull(contexts.removedAt),
          ),
        )
        .limit(100);
      if (
        replaced.some(
          (prior) =>
            prior.captureId === input.captureId &&
            prior.contextVersion >= input.contextVersion,
        )
      )
        diagnosticFailure("version_conflict", 409);
      for (const prior of replaced) {
        await tx
          .update(contexts)
          .set({ removedAt: new Date().toISOString() })
          .where(eq(contexts.id, prior.id));
        await tx
          .update(grants)
          .set({ revokedAt: new Date().toISOString() })
          .where(eq(grants.contextId, prior.id));
        await tx
          .insert(schema.recordingDiagnosticCleanup)
          .values({ contextId: prior.id, blobJson: prior.blobJson })
          .onConflictDoNothing();
      }
      await tx.insert(contexts).values(context);
      return savedResult(context);
    });
  } catch (error) {
    await queueDiagnosticCleanup(context.id, context.blobJson);
    throw error;
  }
}

function savedResult(context: Context) {
  return {
    contextId: context.id,
    contextVersion: context.contextVersion,
    status: "saved" as const,
    expiresAt: context.expiresAt,
  };
}

async function currentContext(context: Context) {
  if (!context.orgId || !(await isOrgMember(context.orgId, context.ownerEmail)))
    diagnosticFailure("membership_required");
  if (context.removedAt) diagnosticFailure("removed", 410);
  if (diagnosticExpired(context.expiresAt)) diagnosticFailure("expired", 410);
  const recording = (
    await getDb()
      .select({
        expiresAt: schema.recordings.expiresAt,
        trashedAt: schema.recordings.trashedAt,
        archivedAt: schema.recordings.archivedAt,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, context.recordingId))
      .limit(1)
  )
    .values()
    .next().value;
  if (
    !recording ||
    recording.trashedAt ||
    recording.archivedAt ||
    (recording.expiresAt && diagnosticExpired(recording.expiresAt))
  )
    diagnosticFailure("recording_unavailable", 410);
}

export async function resolveRecordingDiagnosticAccess(input: {
  contextId?: string | undefined;
  recordingId?: string | undefined;
  diagnosticAccess?: string | undefined;
  userEmail?: string | undefined;
  orgId?: string | undefined;
}): Promise<DiagnosticAccess> {
  const db = getDb();
  if (input.diagnosticAccess) {
    const separator = input.diagnosticAccess.indexOf(".");
    if (separator < 1) diagnosticFailure("grant_invalid");
    const grantId = input.diagnosticAccess.slice(0, separator);
    const grant = (
      await db.select().from(grants).where(eq(grants.id, grantId)).limit(1)
    )
      .values()
      .next().value;
    if (
      !grant ||
      !verifyScopedAgentAccessToken(
        input.diagnosticAccess.slice(separator + 1),
        {
          resourceKind: DIAGNOSTIC_RESOURCE_KIND,
          resourceId: `${grant.id}:${grant.contextId}:${grant.contextVersion}`,
        },
      ).ok
    )
      diagnosticFailure("grant_invalid");
    if (grant.revokedAt) diagnosticFailure("revoked", 410);
    if (diagnosticExpired(grant.expiresAt)) diagnosticFailure("expired", 410);
    const context = (
      await db
        .select()
        .from(contexts)
        .where(eq(contexts.id, grant.contextId))
        .limit(1)
    )
      .values()
      .next().value;
    if (
      !context ||
      (input.contextId && input.contextId !== context.id) ||
      (input.recordingId && input.recordingId !== context.recordingId) ||
      context.contextVersion !== grant.contextVersion ||
      context.orgId !== grant.orgId ||
      context.ownerEmail !== grant.issuerEmail
    )
      diagnosticFailure("grant_invalid");
    await currentContext(context);
    if (!(await isOrgMember(grant.orgId, grant.issuerEmail)))
      diagnosticFailure("membership_required");
    return {
      context,
      scopes: z
        .array(diagnosticScopeSchema)
        .parse(JSON.parse(grant.scopesJson)),
      fromMs: grant.fromMs ?? undefined,
      toMs: grant.toMs ?? undefined,
      canManage: false,
      kind: "grant",
      authorization: input,
    };
  }
  const userEmail = input.userEmail ?? getRequestUserEmail();
  const orgId = input.orgId ?? getRequestOrgId();
  if (!userEmail || !orgId || !(await isOrgMember(orgId, userEmail)))
    diagnosticFailure("denied");
  const candidates = await db
    .select()
    .from(contexts)
    .where(
      and(
        eq(contexts.orgId, orgId),
        input.contextId
          ? eq(contexts.id, input.contextId)
          : eq(contexts.recordingId, input.recordingId ?? ""),
      ),
    )
    .orderBy(desc(contexts.createdAt), desc(contexts.contextVersion))
    .limit(100);
  for (const context of candidates) {
    const owner = context.ownerEmail === userEmail;
    if (!owner) {
      const share = (
        await db
          .select({ id: shares.id })
          .from(shares)
          .where(
            and(
              eq(shares.resourceId, context.id),
              eq(shares.principalType, "user"),
              eq(shares.principalId, userEmail),
            ),
          )
          .limit(1)
      )
        .values()
        .next().value;
      if (!share) continue;
    }
    await currentContext(context);
    return {
      context,
      scopes: [...DIAGNOSTIC_SCOPES],
      canManage: owner,
      kind: owner ? "owner" : "named",
      authorization: input,
    };
  }
  diagnosticFailure("denied");
}

function metadata(context: Context, canManage: boolean) {
  try {
    const fields = diagnosticContextInputSchema.shape;
    return {
      id: context.id,
      recordingId: context.recordingId,
      captureId: context.captureId,
      contextVersion: context.contextVersion,
      ownerEmail: context.ownerEmail,
      recordingStartedAt: fields.recordingStartedAt.parse(
        context.recordingStartedAt,
      ),
      requestedWindow: fields.requestedWindow.parse({
        from: context.requestedFrom,
        to: context.requestedTo,
      }),
      coverage: fields.coverage.parse(JSON.parse(context.coverageJson)),
      gaps: fields.gaps.parse(JSON.parse(context.gapsJson)),
      pauses: fields.pauses.parse(JSON.parse(context.pausesJson)),
      droppedEvents: fields.droppedEvents.parse(context.droppedEvents),
      captured: fields.captured.parse(context.captured),
      saved: "saved" as const,
      failureCode: fields.failureCode.nullable().parse(context.failureCode),
      expiresAt: z.iso.datetime().parse(context.expiresAt),
      canManage,
    };
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError)
      diagnosticFailure("metadata_corrupt", 503);
    throw error;
  }
}

export async function readDiagnosticContext(
  access: DiagnosticAccess,
  filters: {
    scopes?: DiagnosticScope[] | undefined;
    fromMs?: number | undefined;
    toMs?: number | undefined;
    start?: number | undefined;
    maxEvents?: number | undefined;
  },
) {
  access = await resolveRecordingDiagnosticAccess({
    ...access.authorization,
    contextId: access.context.id,
  });
  const info = metadata(access.context, access.canManage);
  let payload: {
    activity?: AppActivity | undefined;
    browserDiagnostics?: z.infer<typeof privateBrowserSchema> | undefined;
    hostMetadata?: Record<string, unknown> | undefined;
  };
  try {
    const { data } = await readPrivateBlob(
      JSON.parse(access.context.blobJson) as PrivateBlobHandle,
    );
    const parsed = z
      .object({
        activity: z.record(z.string(), z.unknown()).optional(),
        browserDiagnostics: privateBrowserSchema.optional(),
        hostMetadata: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(JSON.parse(new TextDecoder().decode(data)));
    const { activity: rawActivity, ...rest } = parsed;
    payload = {
      ...rest,
      ...(rawActivity
        ? {
            activity: sanitizeAppActivity(
              rawActivity as unknown as AppActivity,
            ),
          }
        : {}),
    };
  } catch (error) {
    if (isPrivateBlobError(error))
      diagnosticFailure(
        `storage_${error.kind}`,
        error.kind === "not_found" || error.kind === "gone" ? 410 : 503,
      );
    if (
      error instanceof SyntaxError ||
      error instanceof z.ZodError ||
      error instanceof TypeError ||
      error instanceof RangeError
    )
      diagnosticFailure("storage_corrupt", 503);
    throw error;
  }
  access = await resolveRecordingDiagnosticAccess({
    ...access.authorization,
    contextId: access.context.id,
  });
  const scopes = (filters.scopes ?? access.scopes).filter((scope) =>
    access.scopes.includes(scope),
  );
  if (!scopes.length) diagnosticFailure("scope_denied");
  const base = Date.parse(access.context.recordingStartedAt);
  const pauses = info.pauses;
  const elapsedAt = (at: number) => {
    const removed = pauses.reduce(
      (total, pause) =>
        total +
        Math.max(
          0,
          Math.min(at, Date.parse(pause.to)) - Date.parse(pause.from),
        ),
      0,
    );
    return at - base - removed;
  };
  const fromMs = Math.max(
    elapsedAt(Date.parse(info.requestedWindow.from)),
    access.fromMs ?? -Infinity,
    filters.fromMs ?? -Infinity,
  );
  const toMs = Math.min(
    elapsedAt(Date.parse(info.requestedWindow.to)),
    access.toMs ?? Infinity,
    filters.toMs ?? Infinity,
  );
  if (fromMs > toMs) diagnosticFailure("window_denied", 400);
  const activity = payload.activity;
  const scopedEvents =
    activity?.events.filter(
      (event) => event.elapsedMs >= fromMs && event.elapsedMs <= toMs,
    ) ?? [];
  const sampleInside = (at: unknown) =>
    typeof at === "number" && elapsedAt(at) >= fromMs && elapsedAt(at) <= toMs;
  const extra = activity as
    | (AppActivity & { watchedAtMs?: number | undefined; pendingAtMs?: number })
    | undefined;
  const summary = activity
    ? summarizeAppActivity({
        ...activity,
        events: scopedEvents,
        coverage: activity.coverage
          .map((window) => ({
            fromElapsedMs: Math.max(fromMs, window.fromElapsedMs),
            toElapsedMs: Math.min(toMs, window.toElapsedMs),
          }))
          .filter((window) => window.fromElapsedMs <= window.toElapsedMs),
        watched: {},
        pending: [],
      })
    : undefined;
  const windowed = [
    access.fromMs,
    access.toMs,
    filters.fromMs,
    filters.toMs,
  ].some((value) => value !== undefined);
  const context =
    windowed || access.kind === "grant"
      ? {
          id: info.id,
          recordingId: info.recordingId,
          contextVersion: info.contextVersion,
          recordingStartedAt: info.recordingStartedAt,
          expiresAt: info.expiresAt,
          canManage: info.canManage,
        }
      : info;
  const browser = payload.browserDiagnostics
    ? (() => {
        const filter = (
          entries: readonly z.infer<typeof browserEntrySchema>[] | undefined,
        ) =>
          (entries ?? []).filter(
            (entry) => entry.elapsedMs >= fromMs && entry.elapsedMs <= toMs,
          );
        const streams = {
          consoleLogs: filter(payload.browserDiagnostics.consoleLogs),
          networkRequests: filter(payload.browserDiagnostics.networkRequests),
          interactionEvents: filter(
            payload.browserDiagnostics.interactionEvents,
          ),
        };
        const start = filters.start ?? 0,
          max = filters.maxEvents ?? 100;
        const pages = Object.fromEntries(
          Object.entries(streams).map(([name, entries]) => {
            const nextStart = start + entries.slice(start, start + max).length;
            return [
              name,
              {
                matchedCount: entries.length,
                truncated: nextStart < entries.length,
                ...(nextStart < entries.length ? { nextStart } : {}),
              },
            ];
          }),
        );
        return {
          ...Object.fromEntries(
            Object.entries(streams).map(([name, entries]) => [
              name,
              entries.slice(start, start + max),
            ]),
          ),
          pages,
          summary: {
            consoleCount: streams.consoleLogs.length,
            consoleErrorCount: streams.consoleLogs.filter(
              (entry) => entry.level === "error",
            ).length,
            consoleWarnCount: streams.consoleLogs.filter(
              (entry) => entry.level === "warn",
            ).length,
            networkCount: streams.networkRequests.length,
            networkFailureCount: streams.networkRequests.filter(
              (entry) =>
                entry.ok === false ||
                Boolean(entry.error) ||
                (typeof entry.status === "number" && entry.status >= 400),
            ).length,
          },
        };
      })()
    : undefined;
  const browserHost = payload.browserDiagnostics
    ? Object.fromEntries(
        Object.entries(payload.browserDiagnostics).filter(([key]) =>
          ["pageUrl", "userAgent"].includes(key),
        ),
      )
    : {};
  const hostMetadata = {
    ...payload.hostMetadata,
    ...(Object.keys(browserHost).length ? { browser: browserHost } : {}),
  };
  const sourceIds = new Set(scopedEvents.map((event) => event.documentId));
  for (const span of activity?.sourceCoverage ?? [])
    if (elapsedAt(span.toMs) >= fromMs && elapsedAt(span.fromMs) <= toMs)
      sourceIds.add(span.documentId);
  return {
    context,
    canManage: access.canManage,
    ...(scopes.includes("host-metadata") && activity?.sources
      ? {
          sources: activity.sources.filter((source) =>
            sourceIds.has(source.documentId),
          ),
        }
      : {}),
    ...(scopes.includes("summary") && activity?.collectionOutcomes
      ? {
          collectionOutcomes: activity.collectionOutcomes.filter((outcome) =>
            sampleInside(outcome.atMs),
          ),
        }
      : {}),
    ...(scopes.includes("summary") && summary
      ? {
          summary: {
            eventCount: summary.eventCount,
            failureCount: summary.failureCount,
            failures: summary.failures,
            ...(scopes.includes("host-metadata")
              ? { app: summary.app, build: summary.build }
              : {}),
          },
        }
      : {}),
    ...(scopes.includes("events") && activity
      ? filterAppActivityEvents(scopedEvents, {
          ...(filters.start === undefined ? {} : { start: filters.start }),
          maxEvents: filters.maxEvents ?? 100,
        })
      : {}),
    ...(scopes.includes("state") && activity
      ? {
          ...(sampleInside(extra?.watchedAtMs)
            ? { watched: activity.watched, watchedAtMs: extra?.watchedAtMs }
            : {}),
          ...(sampleInside(extra?.pendingAtMs)
            ? { pending: activity.pending, pendingAtMs: extra?.pendingAtMs }
            : {}),
        }
      : {}),
    ...(scopes.includes("browser-diagnostics") && browser
      ? { browserDiagnostics: browser }
      : {}),
    ...(scopes.includes("host-metadata") &&
    !windowed &&
    Object.keys(hostMetadata).length
      ? { hostMetadata }
      : {}),
  };
}

export async function requireDiagnosticOwner(contextId: string) {
  const access = await resolveRecordingDiagnosticAccess({ contextId });
  if (!access.canManage) diagnosticFailure("owner_required");
  return access;
}

export async function createDiagnosticGrant(input: {
  contextId: string;
  label: string;
  scopes: DiagnosticScope[];
  fromMs?: number | undefined;
  toMs?: number | undefined;
  ttlSeconds?: number | undefined;
}) {
  const { context } = await requireDiagnosticOwner(input.contextId);
  const principal = diagnosticPrincipal();
  if (
    !(await isFeatureFlagEnabled("clips-diagnostic-agent-grants", {
      userEmail: principal.ownerEmail,
      orgId: principal.orgId,
    }))
  )
    diagnosticFailure("grants_disabled");
  if ((input.fromMs ?? -Infinity) > (input.toMs ?? Infinity))
    diagnosticFailure("window_invalid", 400);
  const ttl = Math.min(
    input.ttlSeconds ?? 7200,
    Math.floor((Date.parse(context.expiresAt) - Date.now()) / 1000),
  );
  if (ttl < 1) diagnosticFailure("expired", 410);
  const grant: Grant = {
    id: randomUUID(),
    contextId: context.id,
    contextVersion: context.contextVersion,
    label: input.label,
    scopesJson: JSON.stringify(input.scopes),
    fromMs: input.fromMs ?? null,
    toMs: input.toMs ?? null,
    issuerEmail: principal.ownerEmail,
    orgId: principal.orgId,
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    revokedAt: null,
    createdAt: new Date().toISOString(),
  };
  await getDb().insert(grants).values(grant);
  const token = signScopedAgentAccessToken({
    resourceKind: DIAGNOSTIC_RESOURCE_KIND,
    resourceId: `${grant.id}:${context.id}:${context.contextVersion}`,
    ttlSeconds: ttl,
  });
  return {
    grantId: grant.id,
    diagnosticAccess: `${grant.id}.${token}`,
    expiresAt: grant.expiresAt,
  };
}

export async function queueDiagnosticCleanup(
  contextId: string,
  blobJson: string,
) {
  await getDb()
    .insert(schema.recordingDiagnosticCleanup)
    .values({ contextId, blobJson })
    .onConflictDoNothing();
}

export async function removeDiagnosticContext(contextId: string) {
  const { context } = await requireDiagnosticOwner(contextId);
  await getDb().transaction(async (tx) => {
    await tx
      .update(contexts)
      .set({ removedAt: new Date().toISOString() })
      .where(eq(contexts.id, contextId));
    await tx
      .update(grants)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(grants.contextId, contextId));
    await tx
      .insert(schema.recordingDiagnosticCleanup)
      .values({ contextId, blobJson: context.blobJson })
      .onConflictDoNothing();
  });
  return { removed: true as const };
}

type DiagnosticTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

export async function sealRecordingDiagnostics(
  tx: DiagnosticTransaction,
  recordingId: string,
) {
  const now = new Date().toISOString();
  await tx
    .insert(schema.recordingDiagnosticCleanup)
    .select(
      tx
        .select({
          contextId: contexts.id,
          blobJson: contexts.blobJson,
          attempts: sql<number>`0`.as("attempts"),
          lastError: sql<string | null>`NULL`.as("last_error"),
          nextAttemptAt: sql<string>`${now}`.as("next_attempt_at"),
          createdAt: sql<string>`${now}`.as("created_at"),
        })
        .from(contexts)
        .where(eq(contexts.recordingId, recordingId)),
    )
    .onConflictDoNothing();
  await tx
    .update(grants)
    .set({ revokedAt: now })
    .where(
      inArray(
        grants.contextId,
        tx
          .select({ id: contexts.id })
          .from(contexts)
          .where(eq(contexts.recordingId, recordingId)),
      ),
    );
  await tx
    .update(contexts)
    .set({ removedAt: now })
    .where(eq(contexts.recordingId, recordingId));
}

export async function cleanupDiagnosticContexts() {
  const lease = await claimLease("diagnostic-context-cleanup", 55_000);
  const db = getDb();
  const countPending = async () => {
    const rows = await db
      // guard:allow-unbounded-read — deferred blob deletions still need reporting.
      .select({ pending: sql<number>`COUNT(*)` })
      .from(schema.recordingDiagnosticCleanup);
    const row = rows[0] as (typeof rows)[number] | undefined;
    if (row === undefined)
      throw new Error("Could not count pending diagnostic deletions.");
    return Number(row.pending);
  };
  if (!lease) {
    return { expired: 0, deleted: 0, pending: await countPending() };
  }
  try {
    const expired = await db
      .select()
      .from(contexts)
      .where(
        and(
          isNull(contexts.removedAt),
          or(
            lte(contexts.expiresAt, new Date().toISOString()),
            notExists(
              db
                .select({ id: schema.recordings.id })
                .from(schema.recordings)
                .where(
                  and(
                    eq(schema.recordings.id, contexts.recordingId),
                    eq(schema.recordings.orgId, contexts.orgId),
                  ),
                ),
            ),
            exists(
              db
                .select({ id: schema.recordings.id })
                .from(schema.recordings)
                .where(
                  and(
                    eq(schema.recordings.id, contexts.recordingId),
                    eq(schema.recordings.orgId, contexts.orgId),
                    lte(schema.recordings.expiresAt, new Date().toISOString()),
                  ),
                ),
            ),
          ),
        ),
      )
      .limit(50);
    for (const context of expired)
      await db.transaction(async (tx) => {
        await tx
          .update(contexts)
          .set({ removedAt: new Date().toISOString() })
          .where(eq(contexts.id, context.id));
        await tx
          .update(grants)
          .set({ revokedAt: new Date().toISOString() })
          .where(eq(grants.contextId, context.id));
        await tx
          .insert(schema.recordingDiagnosticCleanup)
          .values({ contextId: context.id, blobJson: context.blobJson })
          .onConflictDoNothing();
      });
    const legacyDiagnostics = await db
      .select({
        recordingId: schema.recordingBrowserDiagnostics.recordingId,
        blobJson: schema.recordingBrowserDiagnostics.appActivityBlobJson,
      })
      .from(schema.recordingBrowserDiagnostics)
      .where(
        or(
          notExists(
            db
              .select({ id: schema.recordings.id })
              .from(schema.recordings)
              .where(
                eq(
                  schema.recordings.id,
                  schema.recordingBrowserDiagnostics.recordingId,
                ),
              ),
          ),
          exists(
            db
              .select({ id: schema.recordings.id })
              .from(schema.recordings)
              .where(
                and(
                  eq(
                    schema.recordings.id,
                    schema.recordingBrowserDiagnostics.recordingId,
                  ),
                  lte(schema.recordings.expiresAt, new Date().toISOString()),
                ),
              ),
          ),
        ),
      )
      .limit(50);
    const legacyReports = await db
      .select({ recordingId: schema.recordingBugReports.recordingId })
      .from(schema.recordingBugReports)
      .where(
        or(
          notExists(
            db
              .select({ id: schema.recordings.id })
              .from(schema.recordings)
              .where(
                eq(
                  schema.recordings.id,
                  schema.recordingBugReports.recordingId,
                ),
              ),
          ),
          exists(
            db
              .select({ id: schema.recordings.id })
              .from(schema.recordings)
              .where(
                and(
                  eq(
                    schema.recordings.id,
                    schema.recordingBugReports.recordingId,
                  ),
                  lte(schema.recordings.expiresAt, new Date().toISOString()),
                ),
              ),
          ),
        ),
      )
      .limit(50);
    const legacyRecordings = new Set([
      ...legacyDiagnostics.map((row) => row.recordingId),
      ...legacyReports.map((row) => row.recordingId),
    ]);
    const legacyBlobByRecording = new Map(
      legacyDiagnostics.map((row) => [row.recordingId, row.blobJson]),
    );
    for (const recordingId of legacyRecordings)
      await db.transaction(async (tx) => {
        const blobJson = legacyBlobByRecording.get(recordingId);
        if (blobJson)
          await tx
            .insert(schema.recordingDiagnosticCleanup)
            .values({
              contextId: `legacy-app-activity:${recordingId}`,
              blobJson,
            })
            .onConflictDoNothing();
        await tx
          .delete(schema.recordingBrowserDiagnostics)
          .where(
            eq(schema.recordingBrowserDiagnostics.recordingId, recordingId),
          );
        await tx
          .delete(schema.recordingBugReports)
          .where(eq(schema.recordingBugReports.recordingId, recordingId));
      });
    const jobs = await db
      .select()
      .from(schema.recordingDiagnosticCleanup)
      .where(
        lte(
          schema.recordingDiagnosticCleanup.nextAttemptAt,
          new Date().toISOString(),
        ),
      )
      .orderBy(
        asc(schema.recordingDiagnosticCleanup.attempts),
        asc(schema.recordingDiagnosticCleanup.createdAt),
      )
      .limit(50);
    let deleted = 0;
    for (const job of jobs) {
      if (!(await renewLease(lease, 55_000))) break;
      const active = (
        await db
          .select({ id: contexts.id })
          .from(contexts)
          .where(
            and(
              eq(contexts.id, job.contextId),
              isNull(contexts.removedAt),
              gt(contexts.expiresAt, new Date().toISOString()),
            ),
          )
          .limit(1)
      )
        .values()
        .next().value;
      if (active) {
        await db
          .delete(schema.recordingDiagnosticCleanup)
          .where(
            eq(schema.recordingDiagnosticCleanup.contextId, job.contextId),
          );
        continue;
      }
      try {
        const result = await deletePrivateBlob(
          JSON.parse(job.blobJson) as PrivateBlobHandle,
        );
        if (!result.deleted && result.reason !== "not_found")
          throw new Error(result.reason ?? "provider_refused");
        await db
          .delete(schema.recordingDiagnosticCleanup)
          .where(
            eq(schema.recordingDiagnosticCleanup.contextId, job.contextId),
          );
        deleted++;
      } catch {
        const attempts = job.attempts + 1;
        const delayMs = Math.min(
          6 * 60 * 60_000,
          30_000 * 2 ** Math.min(attempts, 10),
        );
        await db
          .update(schema.recordingDiagnosticCleanup)
          .set({
            attempts,
            lastError: "provider_delete_failed",
            nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
          })
          .where(
            eq(schema.recordingDiagnosticCleanup.contextId, job.contextId),
          );
      }
    }
    return {
      expired: expired.length,
      deleted,
      pending: await countPending(),
    };
  } finally {
    await releaseLease(lease);
  }
}
