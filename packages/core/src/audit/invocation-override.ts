import type { AuditOverride } from "./attribution.js";

// Keyed by the exact context object one invocation was given, never carried
// on it: a spread or copy of that context, which is what a child it calls
// gets, has no override, and no request input can set one.
const invocationOverrides = new WeakMap<
  object,
  { entry: object; override: AuditOverride }
>();

/**
 * Binds `override` to the invocation of `entry` that receives `ctx`. Only
 * `executeApprovedA2AToolCall` calls this.
 */
export function bindAuditOverride(
  ctx: object,
  entry: object,
  override: AuditOverride,
): void {
  invocationOverrides.set(ctx, { entry, override });
}

export function boundAuditOverride(
  ctx: object,
): { entry: object; override: AuditOverride } | undefined {
  return invocationOverrides.get(ctx);
}
