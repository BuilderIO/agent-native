import type { ActionRunContext } from "../action.js";
import {
  AGENT_NATIVE_ACTION_EVENTS,
  normalizeTrackingDimension,
} from "../shared/analytics-events.js";
import { track } from "./registry.js";

const IGNORED_ACTION_NAMES = new Set(["refresh-list"]);
const IGNORED_ACTION_PATTERN =
  /(application-state|app-state|set-state|view-screen|navigate|poll)/i;

function shouldTrackAction(ctx: ActionRunContext | undefined): boolean {
  const actionName = ctx?.actionName?.trim();
  return Boolean(
    actionName &&
    !IGNORED_ACTION_NAMES.has(actionName) &&
    !IGNORED_ACTION_PATTERN.test(actionName),
  );
}

function actionProperties(
  ctx: ActionRunContext,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const appName = normalizeTrackingDimension(ctx.appId) ?? "framework";
  return {
    app_name: appName,
    ...(ctx.appId ? { template_name: appName } : {}),
    action_name: ctx.actionName!.trim(),
    action_source: ctx.caller,
    action_kind: "write",
    ...(ctx.userEmail ? { user_email: ctx.userEmail } : {}),
    ...(ctx.orgId ? { workspace_id: ctx.orgId } : {}),
    ...(ctx.threadId ? { thread_id: ctx.threadId } : {}),
    ...(ctx.runId ? { run_id: ctx.runId } : {}),
    ...(ctx.turnId ? { turn_id: ctx.turnId } : {}),
    ...extra,
  };
}

function outputId(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return undefined;
  }
  const record = result as Record<string, unknown>;
  for (const key of [
    "output_id",
    "outputId",
    "id",
    "recordingId",
    "planId",
    "deckId",
    "documentId",
    "formId",
  ]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function errorType(error: unknown): string {
  if (error instanceof Error && error.name.trim()) return error.name.trim();
  return typeof error;
}

export function wrapRunWithActionTracking(
  run: (args: any, ctx?: ActionRunContext) => any,
  readOnly: boolean | undefined,
): (args: any, ctx?: ActionRunContext) => Promise<any> {
  if (readOnly === true) return run;

  return async function trackedRun(args: any, ctx?: ActionRunContext) {
    if (!ctx || !shouldTrackAction(ctx)) return run(args, ctx);

    const startedAt = Date.now();
    track(AGENT_NATIVE_ACTION_EVENTS.started, actionProperties(ctx), ctx);
    try {
      const result = await run(args, ctx);
      const id = outputId(result);
      track(
        AGENT_NATIVE_ACTION_EVENTS.completed,
        actionProperties(ctx, {
          success: true,
          duration_ms: Date.now() - startedAt,
          ...(id ? { output_id: id } : {}),
        }),
        ctx,
      );
      return result;
    } catch (error) {
      track(
        AGENT_NATIVE_ACTION_EVENTS.failed,
        actionProperties(ctx, {
          success: false,
          duration_ms: Date.now() - startedAt,
          failure_type: errorType(error),
        }),
        ctx,
      );
      throw error;
    }
  };
}
