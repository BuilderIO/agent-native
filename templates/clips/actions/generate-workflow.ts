/**
 * Delegate: generate a structured workflow document from a recording.
 *
 * Kinds:
 *   - pr     — pull request description / summary
 *   - sop    — standard operating procedure
 *   - ticket — a bug/issue ticket
 *   - email  — a ready-to-send email
 *
 * The agent composes the document and stores it in application_state under
 * `clips-workflow-<recordingId>` so the UI can pick it up and display it.
 *
 * Usage:
 *   pnpm action generate-workflow --recordingId=<id> --kind=pr
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";

const KIND_PROMPTS = {
  pr: `Compose a pull-request description. Include:
- **Summary** (2–3 bullets)
- **Changes** (bulleted list from the recording)
- **Test plan** (how to verify)
Output GitHub-flavored markdown.`,
  sop: `Compose a Standard Operating Procedure (SOP). Include:
- **Purpose**
- **Prerequisites**
- **Steps** (numbered, with any commands/URLs called out)
- **Troubleshooting** (optional)
Output markdown.`,
  ticket: `Compose a bug/issue ticket. Include:
- **Title** (one line)
- **Steps to reproduce** (numbered)
- **Expected behavior**
- **Actual behavior**
- **Severity**
Output markdown.`,
  email: `Compose an email summarizing the recording. Include:
- Subject line (prefix with "Subject: ")
- Greeting
- Summary paragraph
- Next steps / action items
Keep it concise, warm, and professional.`,
} as const;

export default defineAction({
  description:
    "Ask the agent to generate a structured workflow doc (pr/sop/ticket/email) from this recording's transcript. The agent writes the result to clips-workflow-<recordingId> in application_state.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    kind: z.enum(["pr", "sop", "ticket", "email"]).describe("Workflow kind"),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "viewer");

    const db = getDb();
    const [rec] = await db
      .select()
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId))
      .limit(1);
    if (!rec) throw new Error(`Recording not found: ${args.recordingId}`);

    const [transcript] = await db
      .select()
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
      .limit(1);

    const stateKey = `clips-workflow-${args.recordingId}`;

    // Seed the output state with a "generating" placeholder so the UI can show
    // a loading state immediately.
    await writeAppState(stateKey, {
      kind: args.kind,
      status: "generating",
      recordingId: args.recordingId,
      requestedAt: new Date().toISOString(),
    } as any);

    const request = {
      kind: "generate-workflow" as const,
      workflowKind: args.kind,
      recordingId: args.recordingId,
      requestedAt: new Date().toISOString(),
      recordingTitle: rec.title,
      recordingDescription: rec.description,
      transcriptStatus: transcript?.status ?? "pending",
      transcriptText: transcript?.fullText ?? "",
      stateKey,
      instructions: KIND_PROMPTS[args.kind],
      message:
        `Generate a ${args.kind.toUpperCase()} workflow document from recording ${args.recordingId} ` +
        `(title: "${rec.title}"). Read the transcript from this request's context. ` +
        `${KIND_PROMPTS[args.kind]} ` +
        `Then write the final markdown to application_state key "${stateKey}" as ` +
        `\`{ kind: "${args.kind}", status: "ready", content: "...", recordingId: "${args.recordingId}" }\`.`,
    };

    await writeAppState(`clips-ai-request-${args.recordingId}`, request as any);
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Delegation queued: generate-workflow (${args.kind}) for ${args.recordingId}`,
    );
    return {
      queued: true,
      recordingId: args.recordingId,
      kind: args.kind,
      stateKey,
    };
  },
});
