/**
 * Attach product bug-report metadata to a recording.
 *
 * The recording itself remains the shareable/access-controlled resource. This
 * action stores only redacted context that helps support and agents reproduce
 * the issue alongside the captured video, transcript, and browser diagnostics.
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { redactBrowserDiagnosticString } from "../shared/browser-diagnostics.js";
import { BUG_REPORT_SEVERITIES } from "../shared/bug-report.js";

const REDACTION_VERSION = 1;
const MAX_METADATA_JSON_LENGTH = 12_000;

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function redactString(value: string, maxLength: number): string {
  return truncate(
    redactBrowserDiagnosticString(value, { redactQueryValues: true }),
    maxLength,
  );
}

function sanitizeOptional(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return redactString(trimmed, maxLength);
}

function sanitizeUrl(value: string | null | undefined): string | null {
  const redacted = sanitizeOptional(value, 8_000);
  if (!redacted) return null;
  try {
    const parsed = new URL(redacted);
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    for (const key of Array.from(parsed.searchParams.keys())) {
      parsed.searchParams.set(key, "<redacted>");
    }
    return truncate(parsed.toString(), 1_000);
  } catch {
    return truncate(redacted, 1_000);
  }
}

function sanitizeMetadata(value: Record<string, unknown> | undefined): string {
  if (!value) return "{}";
  const json = JSON.stringify(value);
  const redacted = redactBrowserDiagnosticString(json, {
    redactQueryValues: true,
  });
  return truncate(redacted, MAX_METADATA_JSON_LENGTH);
}

const metadataSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .describe("Host-app metadata such as route name, feature flags, or build id");

export default defineAction({
  description:
    "Attach redacted host-app bug-report metadata to a Clips recording. UI/internal use for the embedded bug-report flow.",
  agentTool: false,
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    projectId: z.string().max(120).nullish(),
    title: z.string().max(500).nullish(),
    description: z.string().max(5_000).nullish(),
    severity: z.enum(BUG_REPORT_SEVERITIES).default("normal"),
    sourceUrl: z.string().max(8_000).nullish(),
    pageTitle: z.string().max(500).nullish(),
    appVersion: z.string().max(120).nullish(),
    environment: z.string().max(120).nullish(),
    reporterEmail: z.string().max(320).nullish(),
    reporterName: z.string().max(200).nullish(),
    reporterId: z.string().max(200).nullish(),
    metadata: metadataSchema,
  }),
  run: async (args) => {
    const access = await assertAccess("recording", args.recordingId, "editor");
    const rec = access.resource as any;
    const db = getDb();
    const now = new Date().toISOString();
    const description = sanitizeOptional(args.description, 5_000) ?? "";
    const title = sanitizeOptional(args.title, 500);
    const metadataJson = sanitizeMetadata(args.metadata);

    const values = {
      recordingId: args.recordingId,
      ownerEmail: rec.ownerEmail,
      organizationId: rec.organizationId,
      orgId: rec.orgId,
      projectId: sanitizeOptional(args.projectId, 120),
      title,
      description,
      severity: args.severity,
      sourceUrl: sanitizeUrl(args.sourceUrl),
      pageTitle: sanitizeOptional(args.pageTitle, 500),
      appVersion: sanitizeOptional(args.appVersion, 120),
      environment: sanitizeOptional(args.environment, 120),
      reporterEmail: sanitizeOptional(args.reporterEmail, 320),
      reporterName: sanitizeOptional(args.reporterName, 200),
      reporterId: sanitizeOptional(args.reporterId, 200),
      metadataJson,
      submittedAt: now,
      updatedAt: now,
    };

    const [existing] = await db
      .select({ recordingId: schema.recordingBugReports.recordingId })
      .from(schema.recordingBugReports)
      .where(eq(schema.recordingBugReports.recordingId, args.recordingId))
      .limit(1);

    if (existing) {
      await db
        .update(schema.recordingBugReports)
        .set(values)
        .where(eq(schema.recordingBugReports.recordingId, args.recordingId));
    } else {
      await db.insert(schema.recordingBugReports).values({
        ...values,
        createdAt: now,
      });
    }

    const recordingPatch: Record<string, string> = { updatedAt: now };
    if (title) {
      recordingPatch.title = title;
      recordingPatch.titleSource = "context";
    }
    if (description) {
      recordingPatch.description = description;
    }
    if (Object.keys(recordingPatch).length > 1) {
      await db
        .update(schema.recordings)
        .set(recordingPatch)
        .where(eq(schema.recordings.id, args.recordingId));
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      recordingId: args.recordingId,
      status: "saved" as const,
      redactionVersion: REDACTION_VERSION,
      bugReport: {
        projectId: values.projectId,
        title,
        severity: args.severity,
        sourceUrl: values.sourceUrl,
        pageTitle: values.pageTitle,
        appVersion: values.appVersion,
        environment: values.environment,
        submittedAt: now,
      },
    };
  },
});
