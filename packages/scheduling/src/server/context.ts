/**
 * Server-side context — the package's view of the world.
 *
 * Actions and server logic call `getSchedulingContext()` to get handles to
 * the DB, provider registry, current user, and configuration. The consumer
 * wires this up at app startup via `setSchedulingContext()`.
 *
 * The context is pinned on `globalThis` under a symbol key so Vite SSR +
 * Nitro can safely end up with two module instances (e.g. source via
 * workspace linking vs. dist/) and still share state. Same pattern core uses
 * for the secrets registry.
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

const CTX_KEY = Symbol.for("@agent-native/scheduling.context");
interface GlobalWithCtx {
  [CTX_KEY]?: SchedulingContext;
}

export function setSchedulingContext(c: SchedulingContext): void {
  (globalThis as unknown as GlobalWithCtx)[CTX_KEY] = c;
}

export function getSchedulingContext(): SchedulingContext {
  const ctx = (globalThis as unknown as GlobalWithCtx)[CTX_KEY];
  if (!ctx)
    throw new Error(
      "@agent-native/scheduling: context not initialized. Call setSchedulingContext(...) at startup.",
    );
  return ctx;
}
