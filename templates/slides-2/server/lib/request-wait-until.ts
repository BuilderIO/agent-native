import type { H3Event } from "h3";

type WaitUntil = (promise: Promise<unknown>) => void;

const NETLIFY_CONTEXT_STORE_KEY = Symbol.for(
  "@netlify/functions/request-context-store",
);

/**
 * Keeps a serverless invocation alive for background work after the response
 * without delaying it. Mirrors core's response-hook resolution (not exported):
 * Nitro's Netlify entry drops `event.req.waitUntil`, but the Netlify runtime
 * still exposes the function context through this global AsyncLocalStorage.
 */
export function requestWaitUntil(event: H3Event): WaitUntil | undefined {
  const req = event.req as { waitUntil?: unknown } | undefined;
  if (typeof req?.waitUntil === "function") {
    return req.waitUntil.bind(req) as WaitUntil;
  }
  const store = (globalThis as Record<symbol, unknown>)[
    NETLIFY_CONTEXT_STORE_KEY
  ] as
    | { getStore?: () => { context?: { waitUntil?: unknown } } | undefined }
    | undefined;
  const context = store?.getStore?.()?.context;
  if (typeof context?.waitUntil === "function") {
    return context.waitUntil.bind(context) as WaitUntil;
  }
  return undefined;
}
