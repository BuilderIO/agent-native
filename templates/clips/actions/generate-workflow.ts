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
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { withFullVideoAiInstructions } from "../shared/clips-ai-prefs.js";
import { readIncludeFullVideoInAi } from "./lib/clips-ai-prefs.js";

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

// Actions for the same recording can arrive concurrently when the player and
// agent both retry a request. Keep the read-check-write/enqueue sequence
// single-flight within this runtime so only one request can claim generation.
const workflowGenerationLocks = new Set<string>();

export default defineAction({
  description:
    "Ask the agent to generate a structured workflow doc (pr/sop/ticket/email) from this recording's transcript (and the full video when Include full video is enabled). The agent writes the result to clips-workflow-<recordingId> in application_state.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    kind: z.enum(["pr", "sop", "ticket", "email"]).describe("Workflow kind"),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "viewer");

    const stateKey = `clips-workflow-${args.recordingId}`;
    if (workflowGenerationLocks.has(stateKey)) {
      return {
        queued: false,
        duplicate: true,
        recordingId: args.recordingId,
        kind: args.kind,
        stateKey,
      };
    }
    workflowGenerationLocks.add(stateKey);

    try {
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

      const includeFullVideoInAi = await readIncludeFullVideoInAi();

      const existing = await readAppState(stateKey).catch(() => null);
      if (existing?.status === "generating") {
        const requestedAt = Date.parse(String(existing.requestedAt ?? ""));
        const isRecent =
          !Number.isFinite(requestedAt) ||
          Date.now() - requestedAt < 10 * 60_000;
        if (isRecent) {
          return {
            queued: false,
            duplicate: true,
            recordingId: args.recordingId,
            kind: existing.kind ?? args.kind,
            stateKey,
          };
        }
      }

      // Seed the output state with a "generating" placeholder so the UI can show
      // a loading state immediately.
      await writeAppState(stateKey, {
        kind: args.kind,
        status: "generating",
        recordingId: args.recordingId,
        requestedAt: new Date().toISOString(),
      } as any);

      const baseMessage =
        `Generate a ${args.kind.toUpperCase()} workflow document from recording ${args.recordingId} ` +
        `(title: "${rec.title}"). Read the transcript from this request's context. ` +
        `${KIND_PROMPTS[args.kind]} ` +
        `Then write the final markdown to application_state key "${stateKey}" as ` +
        `\`{ kind: "${args.kind}", status: "ready", content: "...", recordingId: "${args.recordingId}" }\`. ` +
        `Finish by replying in chat with the same generated markdown so the user can read it immediately.`;

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
        includeFullVideoInAi,
        message: withFullVideoAiInstructions(
          baseMessage,
          args.recordingId,
          includeFullVideoInAi,
        ),
      };

      await writeAppState(
        `clips-ai-request-${args.recordingId}`,
        request as any,
      );
      await writeAppState("refresh-signal", { ts: Date.now() });

      console.log(
        `Delegation queued: generate-workflow (${args.kind}) for ${args.recordingId}`,
      );
      return {
        queued: true,
        recordingId: args.recordingId,
        kind: args.kind,
        stateKey,
        includeFullVideoInAi,
      };
    } finally {
      workflowGenerationLocks.delete(stateKey);
    }
  },
});
