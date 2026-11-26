import { isAgentCaller } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";

import { agentLabelFromUserAgent } from "./agent-views.js";

export type RecordingMadeBy = "person" | "agent";

export const RECORDING_MADE_BY = ["person", "agent"] as const;

const PERSON_CALLERS: ReadonlySet<string> = new Set([
  "frontend",
  "http",
  "mcp-widget",
  "mcp-widget-write",
]);

const MAX_AGENT_NAME_CHARS = 80;

const PERSON_STARTED = Symbol("clips.recording.personStarted");

export function personStartedContext<T extends ActionRunContext>(ctx: T): T {
  return Object.assign({ ...ctx }, { [PERSON_STARTED]: true });
}

export function recordingMadeBy(
  ctx: Pick<ActionRunContext, "caller" | "mcpClient"> | undefined,
): { madeBy: RecordingMadeBy | null; madeByAgent: string | null } {
  if (ctx && (ctx as { [PERSON_STARTED]?: true })[PERSON_STARTED]) {
    return { madeBy: "person", madeByAgent: null };
  }
  if (isAgentCaller(ctx)) {
    return { madeBy: "agent", madeByAgent: agentName(ctx) };
  }
  if (ctx?.caller && PERSON_CALLERS.has(ctx.caller)) {
    return { madeBy: "person", madeByAgent: null };
  }
  return { madeBy: null, madeByAgent: null };
}

function agentName(
  ctx: Pick<ActionRunContext, "mcpClient"> | undefined,
): string | null {
  const clientName = ctx?.mcpClient?.name?.trim();
  if (clientName) {
    return (
      agentLabelFromUserAgent(clientName) ??
      clientName.slice(0, MAX_AGENT_NAME_CHARS)
    );
  }
  const userAgent = ctx?.mcpClient?.userAgent?.trim();
  return userAgent ? agentLabelFromUserAgent(userAgent) : null;
}
