import { defineAction } from "@agent-native/core/action";

import { currentExecutionActor } from "../server/model/notebook-execution/service.js";
import { listPublishedAppScheduleRecipients } from "../server/model/published-app-schedules.js";
import {
  scheduleRecipientsInput,
  scheduleRecipientsOutput,
} from "../shared/published-app-schedules.js";

const MAX_DIRECTORY_PAGES = 8;

export default defineAction({
  description:
    "Find workspace members eligible to receive notifications for this published app.",
  schema: scheduleRecipientsInput,
  outputSchema: scheduleRecipientsOutput,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  persistInBrowser: false,
  readOnly: true,
  http: { method: "GET" },
  run: async (input, context) => {
    const actor = await currentExecutionActor(context?.caller ?? "unknown");
    const members: { memberId: string; email: string; name: string }[] = [];
    let cursor = input.cursor;
    let nextCursor: string | null = null;
    for (let scan = 0; scan < MAX_DIRECTORY_PAGES; scan += 1) {
      const page = await listPublishedAppScheduleRecipients(actor, {
        ...input,
        cursor,
      });
      members.push(...page.members);
      nextCursor = page.nextCursor;
      if (members.length >= input.limit || !nextCursor) break;
      cursor = nextCursor;
    }
    if (members.length > input.limit) {
      members.length = input.limit;
      nextCursor = members[input.limit - 1]?.memberId ?? null;
    }
    return {
      members: members.map((member) => ({
        ...member,
        name: member.name.trim() || member.email,
      })),
      nextCursor,
    };
  },
});
