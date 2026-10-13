import { randomUUID } from "node:crypto";

import { defineAction } from "@agent-native/core/action";
import {
  compareAndSetManyAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { withFullVideoAiInstructions } from "../shared/clips-ai-prefs.js";
import { WorkflowKindSchema } from "../shared/workflow.js";
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

const workflowGenerationLocks = new Set<string>();

function isRecentGeneration(state: Record<string, unknown> | null): boolean {
  if (state?.status !== "generating") return false;
  const requestedAt = Date.parse(
    typeof state.requestedAt === "string" ? state.requestedAt : "",
  );
  return (
    !Number.isFinite(requestedAt) || Date.now() - requestedAt < 10 * 60_000
  );
}

export default defineAction({
  description:
    "Ask the agent to generate a structured workflow doc (pr/sop/ticket/email) from this recording's transcript (and the full video when Include full video is enabled). The agent saves the result with complete-workflow.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    kind: WorkflowKindSchema.describe("Workflow kind"),
    openInChat: z
      .boolean()
      .optional()
      .describe("Open the user-visible agent chat for this request"),
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

      const existing = await readAppState(stateKey);
      if (isRecentGeneration(existing)) {
        return {
          queued: false,
          duplicate: true,
          recordingId: args.recordingId,
          kind: existing?.kind ?? args.kind,
          stateKey,
        };
      }

      const requestKey = `clips-ai-request-${args.recordingId}`;
      const existingRequest = await readAppState(requestKey);
      const requestedAt = new Date().toISOString();
      const requestId = randomUUID();
      const workflowState = {
        kind: args.kind,
        status: "generating",
        recordingId: args.recordingId,
        requestedAt,
        requestId,
      };

      const baseMessage =
        `Generate a ${args.kind.toUpperCase()} workflow document from recording ${args.recordingId} ` +
        `(title: "${rec.title}"). Read the transcript from this request's context. ` +
        `${KIND_PROMPTS[args.kind]} ` +
        `Then call complete-workflow with recordingId "${args.recordingId}", ` +
        `the exact requestedAt and requestId "${requestId}" from this request's context, ` +
        `and the final markdown. ` +
        `Do not report completion unless that action returns saved: true. ` +
        `Finish by replying in chat with the same generated markdown.`;

      const request = {
        kind: "generate-workflow" as const,
        workflowKind: args.kind,
        recordingId: args.recordingId,
        requestedAt,
        requestId,
        recordingTitle: rec.title,
        recordingDescription: rec.description,
        transcriptStatus: transcript?.status ?? "pending",
        transcriptText: transcript?.fullText ?? "",
        stateKey,
        instructions: KIND_PROMPTS[args.kind],
        includeFullVideoInAi,
        openInChat: args.openInChat === true,
        message: withFullVideoAiInstructions(
          baseMessage,
          args.recordingId,
          includeFullVideoInAi,
        ),
      };

      const claimed = await compareAndSetManyAppState([
        {
          key: stateKey,
          expectedValue: existing,
          nextValue: workflowState,
        },
        {
          key: requestKey,
          expectedValue: existingRequest,
          nextValue: request,
        },
      ]);
      if (!claimed) {
        const current = await readAppState(stateKey);
        if (isRecentGeneration(current)) {
          return {
            queued: false,
            duplicate: true,
            recordingId: args.recordingId,
            kind: current?.kind ?? args.kind,
            stateKey,
          };
        }
        return {
          queued: false,
          duplicate: false,
          retry: true,
          reason: "claim-contended",
          recordingId: args.recordingId,
          kind: args.kind,
          stateKey,
        };
      }

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
