import { trackingIdentityProperties } from "../observability/tracking-identity.js";
import type { CaptureErrorContext } from "../server/capture-error.js";
import { stripSqlParams } from "../shared/error-noise.js";
import {
  boundedText,
  exceptionParts,
  safeTags,
  safeValue,
} from "./redaction.js";
import { track } from "./registry.js";

export type TrackingExceptionLevel =
  | "fatal"
  | "error"
  | "warning"
  | "info"
  | "debug";

export interface TrackingExceptionContext extends CaptureErrorContext {
  handled?: boolean;
  level?: TrackingExceptionLevel;
  release?: string;
  environment?: string;
  runtime?: "node" | "cli";
  source?: "server" | "cli";
  userId?: string;
  orgId?: string;
}

export function captureException(
  error: unknown,
  context: TrackingExceptionContext = {},
): void {
  try {
    const raw = exceptionParts(error);
    // A database error's bound parameters ride on the message and stack; they
    // must not reach the tracker, where they become the issue title and culprit.
    const parts = {
      ...raw,
      message: stripSqlParams(raw.message),
      ...(raw.stack ? { stack: stripSqlParams(raw.stack) } : {}),
    };
    const tags = safeTags({
      ...context.tags,
      ...(context.route ? { route: context.route } : {}),
      ...(context.method ? { method: context.method } : {}),
      ...(context.userAgent ? { userAgent: context.userAgent } : {}),
    });
    const extra = safeValue({
      ...context.extra,
      ...(context.contexts ? { contexts: context.contexts } : {}),
    });
    track(
      "$exception",
      {
        ...trackingIdentityProperties(),
        exceptionType: parts.type,
        exceptionMessage: parts.message,
        ...(parts.stack ? { exceptionStack: parts.stack } : {}),
        handled: context.handled ?? true,
        level: context.level ?? "error",
        occurredAt: new Date().toISOString(),
        runtime: context.runtime ?? "node",
        source: context.source ?? "server",
        ...(context.route ? { url: boundedText(context.route, 500) } : {}),
        ...(context.release
          ? { release: boundedText(context.release, 200) }
          : {}),
        ...(context.environment
          ? { environment: boundedText(context.environment, 100) }
          : {}),
        ...(context.orgId ? { orgId: boundedText(context.orgId, 200) } : {}),
        ...(context.aiTraceId
          ? { $ai_trace_id: boundedText(context.aiTraceId, 200) }
          : {}),
        ...(Object.keys(tags).length ? { exceptionTags: tags } : {}),
        ...(extra && typeof extra === "object"
          ? { exceptionExtra: extra }
          : {}),
      },
      context.userId ? { userId: context.userId } : undefined,
    );
  } catch {
    // Error reporting must never mask the original failure.
  }
}
