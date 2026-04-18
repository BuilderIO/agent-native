/**
 * Server-side context — the package's view of the world.
 *
 * Actions and server logic call `getSchedulingContext()` to get handles to
 * the DB, provider registry, current user, and configuration. The consumer
 * wires this up at app startup via `setSchedulingContext()`.
 */
import type { GetDbFn, SchedulingSchema } from "./db-types.js";

export interface SchedulingContext {
  getDb: GetDbFn;
  schema: SchedulingSchema;
  /** How the consumer resolves the current user's email (typically from request ctx). */
  getCurrentUserEmail: () => string | undefined;
  /** How the consumer resolves the current user's org id (if multi-tenant). */
  getCurrentOrgId?: () => string | undefined;
  /** Default brand/timezone/week-start for a user (from settings). */
  getUserPreferences?: (email: string) => Promise<{
    timezone?: string;
    weekStartsOn?: 0 | 1;
    brandColor?: string;
    darkBrandColor?: string;
  }>;
  /** Base public URL, e.g. "https://sched.example.com" — used in emails + ICS. */
  publicBaseUrl?: string;
}

let ctx: SchedulingContext | null = null;

export function setSchedulingContext(c: SchedulingContext): void {
  ctx = c;
}

export function getSchedulingContext(): SchedulingContext {
  if (!ctx)
    throw new Error(
      "@agent-native/scheduling: context not initialized. Call setSchedulingContext(...) at startup.",
    );
  return ctx;
}
