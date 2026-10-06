import type { GetDbFn, SchedulingSchema } from "./db-types.js";

export interface SchedulingContext {
  getDb: GetDbFn;
  schema: SchedulingSchema;
  getCurrentUserEmail: () => string | undefined;
  getCurrentOrgId?: () => string | undefined;
  getUserPreferences?: (email: string) => Promise<{
    timezone?: string;
    weekStartsOn?: 0 | 1;
    brandColor?: string;
    darkBrandColor?: string;
  }>;
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
