import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  isSlackTimestamp,
  readWorkflowSlackThread,
  resolveFactorySlackWorkspace,
} from "../server/connectors/slack-workflow.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  assertResultWithinLimit,
  requireWorkflowActionCaller,
} from "../server/lib/workflow-action-support.js";
import { createSlackWorkflowClient } from "../server/triage/slack-client.js";

const slackTimestamp = z
  .string()
  .trim()
  .refine(isSlackTimestamp, "use a Slack timestamp such as 1700000000.000100");

export default defineAction({
  description:
    "Read one whole Slack thread, with each message's reactions, for a workflow. Pass oldest to get only messages after that Slack timestamp. A thread that cannot be paged to the end is an error, never a short result. Output is bounded: when truncated is true, pass nextOldest as oldest to read the rest.",
  schema: z.object({
    factoryId: factoryIdSchema.optional(),
    channel: z
      .string()
      .trim()
      .regex(/^[CGD][A-Z0-9]{2,}$/, "use a Slack channel id such as C0123ABCD"),
    threadTs: slackTimestamp,
    oldest: slackTimestamp.optional(),
  }),
  http: false,
  mcpTool: false,
  readOnly: true,
  run: async (
    { factoryId: requestedFactoryId, channel, threadTs, oldest },
    context,
  ) => {
    const caller = await requireWorkflowActionCaller(context, {
      factoryId: requestedFactoryId,
    });
    const workspace = await resolveFactorySlackWorkspace(
      context,
      caller,
      caller.factoryId,
    );
    const slack = createSlackWorkflowClient({
      ownerEmail: caller.userEmail,
      orgId: caller.orgId,
    });
    const thread = await readWorkflowSlackThread(slack, {
      workspace,
      channel,
      threadTs,
      oldest,
    });
    return assertResultWithinLimit("read-slack-thread", {
      ok: true as const,
      coverage: "complete" as const,
      ...thread,
    });
  },
});
