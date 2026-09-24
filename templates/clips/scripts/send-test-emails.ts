/**
 * One-off: send the two new Clips transactional emails to a real inbox so the
 * rendering can be eyeballed in a mail client. Sample data only — this never
 * touches the job queue or real recordings.
 *
 *   pnpm script send-test-emails --to someone@example.com
 */

import { getEmailProvider, isEmailConfigured } from "@agent-native/core/server";

import { sendClipsTransactionalEmail } from "../server/lib/transactional-email-templates.js";

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

export default async function main(args: string[]): Promise<void> {
  const to = argValue(args, "to");
  if (!to) throw new Error("--to <email> is required");

  if (!(await isEmailConfigured())) {
    throw new Error(
      "No email provider configured; set SENDGRID_API_KEY or RESEND_API_KEY.",
    );
  }
  console.log(`Provider: ${await getEmailProvider()}`);

  await sendClipsTransactionalEmail({
    kind: "first-agent-view",
    to,
    recordingId: "demo-agent-view",
    title: "Deploy walkthrough",
    agentName: "Claude",
  });
  console.log(`Sent first-agent-view to ${to}`);

  await sendClipsTransactionalEmail({
    kind: "monthly-recap",
    to,
    month: "2026-07",
    humanViews: 9,
    agentSessions: 4,
    topClip: {
      recordingId: "demo-recap-top",
      title: "Deploy walkthrough",
      thumbnailUrl: null,
      durationMs: 252_000,
      recordedAt: "2026-07-12T00:00:00.000Z",
      humanViews: 9,
      agentSessions: 4,
    },
    copy: {
      heroLine: "9 people watched your clip. 4 agents read it.",
      agentBreakdown: "3 from Claude · 1 from ChatGPT",
      completionNote: "71% average completion · most stopped at 4:12",
    },
  });
  console.log(`Sent monthly-recap to ${to}`);
}
