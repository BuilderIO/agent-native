import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { putPrivateBlob } from "@agent-native/core/private-blob";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  APP_ACTIVITY_BLOB_PURPOSE,
  deleteAppActivityBlob,
} from "../server/lib/app-activity.js";
import {
  MAX_APP_ACTIVITY_BYTES,
  MAX_APP_ACTIVITY_COVERAGE_WINDOWS,
  MAX_APP_ACTIVITY_EVENTS,
  MAX_APP_ACTIVITY_PENDING,
  sanitizeAppActivity,
  summarizeAppActivity,
} from "../shared/app-activity.js";
import { BROWSER_DIAGNOSTIC_LOOKBACK_MS } from "../shared/browser-diagnostics.js";

const windowSchema = z.object({
  fromElapsedMs: z.number().finite().min(-BROWSER_DIAGNOSTIC_LOOKBACK_MS),
  toElapsedMs: z.number().finite(),
});

export default defineAction({
  description:
    "Save the redacted app activity (actions, state changes, navigation, errors) that the Clips extension read from an agent-native app during a recording. UI/internal use only.",
  agentTool: false,
  maxBodyBytes: 2 * MAX_APP_ACTIVITY_BYTES,
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    app: z.string().max(1_000),
    build: z.string().max(1_000),
    coverage: z.array(windowSchema).max(MAX_APP_ACTIVITY_COVERAGE_WINDOWS),
    dropped: z.number().int().nonnegative(),
    events: z.array(z.unknown()).max(MAX_APP_ACTIVITY_EVENTS),
    watched: z.record(z.string(), z.unknown()),
    pending: z.array(z.unknown()).max(MAX_APP_ACTIVITY_PENDING),
  }),
  run: async ({ recordingId, ...input }) => {
    const access = await assertAccess("recording", recordingId, "editor");
    const rec = access.resource as { ownerEmail: string };
    const db = getDb();
    const [row] = await db
      .select({
        blobJson: schema.recordingBrowserDiagnostics.appActivityBlobJson,
      })
      .from(schema.recordingBrowserDiagnostics)
      .where(eq(schema.recordingBrowserDiagnostics.recordingId, recordingId))
      .limit(1);
    if (!row) {
      fail(
        "Save this recording's browser diagnostics before its app activity.",
        {
          errorCode: "diagnostics_missing",
          statusCode: 409,
        },
      );
    }

    const activity = sanitizeAppActivity(input);
    const handle = await putPrivateBlob({
      data: new TextEncoder().encode(JSON.stringify(activity)),
      filename: `${recordingId}-app-activity.json`,
      mimeType: "application/json",
      ownerEmail: rec.ownerEmail,
      metadata: { purpose: APP_ACTIVITY_BLOB_PURPOSE, recordingId },
    });
    if (!handle) {
      fail(
        "No object storage is connected, so the app activity was not saved. Use Builder.io (free) or configure S3-compatible storage in Settings → File uploads.",
        { errorCode: "storage_not_configured", statusCode: 409 },
      );
    }

    const summary = summarizeAppActivity(activity);
    await db
      .update(schema.recordingBrowserDiagnostics)
      .set({
        appActivitySummaryJson: JSON.stringify(summary),
        appActivityBlobJson: JSON.stringify(handle),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.recordingBrowserDiagnostics.recordingId, recordingId));
    const replacedBlobCleanup = row.blobJson
      ? await deleteAppActivityBlob(row.blobJson, recordingId)
      : null;

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      recordingId,
      status: "saved" as const,
      summary,
      replacedBlobCleanup,
    };
  },
});
