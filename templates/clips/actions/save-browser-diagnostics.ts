/**
 * Save redacted browser diagnostics captured during a recording session.
 *
 * Called by the recorder UI after stop/finalize. Diagnostics are intentionally
 * bounded and body/header-free: console text plus method/path/status/duration
 * for fetch/XHR requests.
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nanoid } from "../server/lib/recordings.js";
import {
  MAX_BROWSER_DIAGNOSTIC_CONSOLE_LOGS,
  MAX_BROWSER_DIAGNOSTIC_MESSAGE_LENGTH,
  MAX_BROWSER_DIAGNOSTIC_NETWORK_REQUESTS,
  MAX_BROWSER_DIAGNOSTIC_URL_LENGTH,
  redactBrowserDiagnosticString,
  summarizeBrowserDiagnostics,
  type BrowserDiagnosticConsoleLevel,
} from "../shared/browser-diagnostics.js";

const REDACTION_VERSION = 2;

const consoleLevelSchema = z.enum(["debug", "log", "info", "warn", "error"]);

const consoleLogSchema = z.object({
  timestampMs: z.number().finite().nonnegative(),
  elapsedMs: z.number().finite().nonnegative(),
  level: consoleLevelSchema.default("log"),
  message: z.string().max(20_000),
  stack: z.string().max(20_000).optional(),
});

const networkRequestSchema = z.object({
  timestampMs: z.number().finite().nonnegative(),
  elapsedMs: z.number().finite().nonnegative(),
  type: z.enum(["fetch", "xhr"]).default("fetch"),
  method: z.string().max(24).default("GET"),
  url: z.string().max(8_000),
  status: z.number().int().min(100).max(599).optional(),
  statusText: z.string().max(500).optional(),
  ok: z.boolean().optional(),
  durationMs: z.number().finite().nonnegative(),
  error: z.string().max(20_000).optional(),
});

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function redactString(value: string): string {
  return redactBrowserDiagnosticString(value);
}

function redactUrlString(value: string): string {
  return redactBrowserDiagnosticString(value, { redactQueryValues: true });
}

function sanitizeUrl(raw: string): string {
  const redacted = redactUrlString(raw);
  try {
    const parsed = new URL(redacted, "https://clips.local");
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    const params = new URLSearchParams();
    for (const key of parsed.searchParams.keys()) {
      params.set(key, "<redacted>");
    }
    parsed.search = params.toString();
    const serialized =
      parsed.origin === "https://clips.local"
        ? `${parsed.pathname}${parsed.search}`
        : parsed.toString();
    return truncate(serialized, MAX_BROWSER_DIAGNOSTIC_URL_LENGTH);
  } catch {
    return truncate(redacted, MAX_BROWSER_DIAGNOSTIC_URL_LENGTH);
  }
}

function sanitizeIso(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

function sanitizeConsoleLog(entry: z.infer<typeof consoleLogSchema>): {
  timestampMs: number;
  elapsedMs: number;
  level: BrowserDiagnosticConsoleLevel;
  message: string;
  stack?: string;
} {
  const stack = entry.stack
    ? truncate(redactString(entry.stack), MAX_BROWSER_DIAGNOSTIC_MESSAGE_LENGTH)
    : "";
  return {
    timestampMs: Math.round(entry.timestampMs),
    elapsedMs: Math.round(entry.elapsedMs),
    level: entry.level,
    message: truncate(
      redactString(entry.message),
      MAX_BROWSER_DIAGNOSTIC_MESSAGE_LENGTH,
    ),
    ...(stack ? { stack } : {}),
  };
}

function sanitizeNetworkRequest(entry: z.infer<typeof networkRequestSchema>) {
  const statusText = entry.statusText
    ? truncate(redactString(entry.statusText), 120)
    : "";
  const error = entry.error
    ? truncate(redactString(entry.error), MAX_BROWSER_DIAGNOSTIC_MESSAGE_LENGTH)
    : "";
  return {
    timestampMs: Math.round(entry.timestampMs),
    elapsedMs: Math.round(entry.elapsedMs),
    type: entry.type,
    method: truncate(entry.method.toUpperCase(), 24),
    url: sanitizeUrl(entry.url),
    ...(typeof entry.status === "number" ? { status: entry.status } : {}),
    ...(statusText ? { statusText } : {}),
    ...(typeof entry.ok === "boolean" ? { ok: entry.ok } : {}),
    durationMs: Math.round(entry.durationMs),
    ...(error ? { error } : {}),
  };
}

export default defineAction({
  description:
    "Save redacted console and network diagnostics captured during a Clips recording session. UI/internal use only.",
  agentTool: false,
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    sessionId: z.string().min(1).max(120).optional(),
    source: z
      .enum(["browser-recorder", "desktop", "extension"])
      .default("browser-recorder"),
    phase: z.string().min(1).max(80).default("recording"),
    pageUrl: z.string().max(8_000).nullish(),
    userAgent: z.string().max(2_000).nullish(),
    startedAt: z.string().optional(),
    endedAt: z.string().optional(),
    consoleLogs: z
      .array(consoleLogSchema)
      .max(MAX_BROWSER_DIAGNOSTIC_CONSOLE_LOGS)
      .default([]),
    networkRequests: z
      .array(networkRequestSchema)
      .max(MAX_BROWSER_DIAGNOSTIC_NETWORK_REQUESTS)
      .default([]),
  }),
  run: async (args) => {
    const access = await assertAccess("recording", args.recordingId, "editor");
    const rec = access.resource as any;
    const db = getDb();
    const now = new Date().toISOString();
    const endedAt = sanitizeIso(args.endedAt, now);
    const startedAt = sanitizeIso(args.startedAt, endedAt);
    const consoleLogs = args.consoleLogs
      .slice(-MAX_BROWSER_DIAGNOSTIC_CONSOLE_LOGS)
      .map(sanitizeConsoleLog);
    const networkRequests = args.networkRequests
      .slice(-MAX_BROWSER_DIAGNOSTIC_NETWORK_REQUESTS)
      .map(sanitizeNetworkRequest);
    const summary = summarizeBrowserDiagnostics({
      consoleLogs,
      networkRequests,
      endedAt,
    });
    const values = {
      recordingId: args.recordingId,
      ownerEmail: rec.ownerEmail,
      organizationId: rec.organizationId,
      orgId: rec.orgId,
      sessionId: args.sessionId ?? nanoid(),
      source: args.source,
      phase: truncate(redactString(args.phase), 80),
      pageUrl: args.pageUrl ? sanitizeUrl(args.pageUrl) : null,
      userAgent: args.userAgent
        ? truncate(redactString(args.userAgent), 2_000)
        : null,
      startedAt,
      endedAt,
      consoleLogsJson: JSON.stringify(consoleLogs),
      networkRequestsJson: JSON.stringify(networkRequests),
      redactionVersion: REDACTION_VERSION,
      updatedAt: now,
    };

    const [existing] = await db
      .select({ recordingId: schema.recordingBrowserDiagnostics.recordingId })
      .from(schema.recordingBrowserDiagnostics)
      .where(
        eq(schema.recordingBrowserDiagnostics.recordingId, args.recordingId),
      )
      .limit(1);

    if (existing) {
      await db
        .update(schema.recordingBrowserDiagnostics)
        .set(values)
        .where(
          eq(schema.recordingBrowserDiagnostics.recordingId, args.recordingId),
        );
    } else {
      await db.insert(schema.recordingBrowserDiagnostics).values({
        ...values,
        createdAt: now,
      });
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      recordingId: args.recordingId,
      status: "saved" as const,
      summary,
    };
  },
});
