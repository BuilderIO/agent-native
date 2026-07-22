/**
 * POST /api/ai-summary-email
 *
 * Triggered from the "Summarize with AI" CTA in the share notification email.
 * The recipient's browser posts the recordingId + a short-lived, recipient-
 * scoped token (minted in server/db/index.ts's `getSecondaryCta` hook) when
 * `/r/:recordingId?ai=summarize&token=...` loads. Public endpoint — the
 * token, not a session, is what proves the caller may trigger this send.
 *
 * Generates a transcript summary and emails it to the recipient, threaded
 * into the original share notification via In-Reply-To/References. Single-
 * use per recipient per recording: claimed atomically via
 * `recording_viewers.ai_summary_emailed_at`.
 */

import { getDbExec } from "@agent-native/core/db";
import { getAppProductionUrl } from "@agent-native/core/server/app-url";
import { readBodyWithSizeLimit } from "@agent-native/core/server/h3-helpers";
import { verifyShortLivedToken } from "@agent-native/core/server/short-lived-token";
import { isEmailConfigured, sendEmail } from "@agent-native/core/server/email";
import { renderEmail } from "@agent-native/core/server/email-template";
import { shareNotificationMessageId } from "@agent-native/core/sharing/actions/share-resource";
import { and, eq } from "drizzle-orm";
import { defineEventHandler, setResponseStatus } from "h3";

import cleanupTranscript from "../../../actions/cleanup-transcript.js";
import { aiSummaryTokenResourceId, CLIPS_EMAIL_FROM, getDb, schema } from "../../db/index.js";
import { nanoid } from "../../lib/recordings.js";

interface AiSummaryEmailBody {
  recordingId?: string;
  token?: string;
}

const MAX_BODY_BYTES = 4 * 1024;

export default defineEventHandler(async (event) => {
  let body: AiSummaryEmailBody | null;
  try {
    body = await readBodyWithSizeLimit<AiSummaryEmailBody>(
      event,
      MAX_BODY_BYTES,
    );
  } catch {
    setResponseStatus(event, 400);
    return { ok: false, error: "invalid_body" };
  }

  const recordingId =
    typeof body?.recordingId === "string" ? body.recordingId.trim() : "";
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!recordingId || !token) {
    setResponseStatus(event, 400);
    return { ok: false, error: "missing_fields" };
  }

  const verified = verifyShortLivedToken(
    token,
    aiSummaryTokenResourceId(recordingId),
  );
  if (!verified.ok || !verified.viewerEmail) {
    setResponseStatus(event, 403);
    return { ok: false, error: "invalid_token" };
  }
  const viewerEmail = verified.viewerEmail.trim().toLowerCase();

  if (!(await isEmailConfigured())) {
    setResponseStatus(event, 409);
    return { ok: false, error: "email_not_configured" };
  }

  const db = getDb();
  const [recording] = await db
    .select()
    .from(schema.recordings)
    .where(eq(schema.recordings.id, recordingId))
    .limit(1);
  if (!recording || recording.status !== "ready") {
    setResponseStatus(event, 404);
    return { ok: false, error: "recording_not_ready" };
  }

  const viewerKey = viewerEmail;
  let [viewer] = await db
    .select({
      id: schema.recordingViewers.id,
      aiSummaryEmailedAt: schema.recordingViewers.aiSummaryEmailedAt,
    })
    .from(schema.recordingViewers)
    .where(
      and(
        eq(schema.recordingViewers.recordingId, recordingId),
        eq(schema.recordingViewers.viewerKey, viewerKey),
      ),
    )
    .limit(1);

  if (!viewer) {
    const now = new Date().toISOString();
    await db
      .insert(schema.recordingViewers)
      .values({
        id: nanoid(),
        recordingId,
        viewerKey,
        viewerEmail,
        viewerName: viewerEmail.split("@")[0],
        firstViewedAt: now,
        lastViewedAt: now,
        totalWatchMs: 0,
        completedPct: 0,
        countedView: false,
        ctaClicked: false,
      })
      .onConflictDoNothing();
    [viewer] = await db
      .select({
        id: schema.recordingViewers.id,
        aiSummaryEmailedAt: schema.recordingViewers.aiSummaryEmailedAt,
      })
      .from(schema.recordingViewers)
      .where(
        and(
          eq(schema.recordingViewers.recordingId, recordingId),
          eq(schema.recordingViewers.viewerKey, viewerKey),
        ),
      )
      .limit(1);
  }

  if (!viewer) {
    setResponseStatus(event, 500);
    return { ok: false, error: "viewer_resolution_failed" };
  }

  if (viewer.aiSummaryEmailedAt) {
    return { ok: true, alreadySent: true };
  }

  const claimedAt = new Date().toISOString();
  const claim = await getDbExec().execute({
    sql: `UPDATE recording_viewers SET ai_summary_emailed_at = ? WHERE id = ? AND ai_summary_emailed_at IS NULL`,
    args: [claimedAt, viewer.id],
  });
  if (claim.rowsAffected !== 1) {
    return { ok: true, alreadySent: true };
  }

  const [transcript] = await db
    .select({
      status: schema.recordingTranscripts.status,
      fullText: schema.recordingTranscripts.fullText,
    })
    .from(schema.recordingTranscripts)
    .where(eq(schema.recordingTranscripts.recordingId, recordingId))
    .limit(1);

  const transcriptText = transcript?.fullText?.trim() ?? "";
  if (!transcriptText) {
    return { ok: false, error: "transcript_not_ready" };
  }

  try {
    const summary = await cleanupTranscript.run({
      transcript: transcriptText,
      task: "summary",
      context: `Clip title: ${recording.title}`,
    });
    const summaryMd = summary.summaryMd?.trim();
    if (!summaryMd) {
      return { ok: false, error: "summary_empty" };
    }

    const appUrl = getAppProductionUrl().replace(/\/+$/, "");
    const recordingUrl = `${appUrl}/r/${recordingId}`;
    const appName =
      process.env.APP_NAME || process.env.VITE_APP_NAME || "Agent Native";
    const originalSubject = `${recording.ownerEmail} shared "${recording.title}" with you on ${appName}`;
    const subject = `Re: ${originalSubject}`;
    const messageId = shareNotificationMessageId(
      "recording",
      recordingId,
      viewerEmail,
    );
    const replyMessageId = `<ai-summary-${recordingId}-${claimedAt}@agent-native.com>`;

    const { html, text } = renderEmail({
      preheader: `Here's the summary for "${recording.title}"`,
      heading: `Summary: ${recording.title}`,
      paragraphs: [
        escapeHtml(summaryMd).replace(/\n+/g, "<br />"),
      ],
      cta: { label: "Watch the recording", url: recordingUrl },
      footer: `Generated automatically from the transcript of "${escapeHtml(recording.title)}".`,
    });

    await sendEmail({
      to: viewerEmail,
      subject,
      html,
      text,
      from: CLIPS_EMAIL_FROM,
      replyTo: recording.ownerEmail,
      messageId: replyMessageId,
      inReplyTo: messageId,
      references: messageId,
    });

    return { ok: true, sent: true };
  } catch (err) {
    console.error("[ai-summary-email] failed to generate/send summary:", err);
    return { ok: false, error: "internal_error" };
  }
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
