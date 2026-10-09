export type WaitUntil = (promise: Promise<unknown>) => void;

// h3 holds the Response until the response hook settles, so every millisecond
// spent here is added to each reply on a platform without waitUntil.
export const BACKGROUND_DEADLINE_MS = 250;

const NETLIFY_CONTEXT_STORE_KEY = Symbol.for(
  "@netlify/functions/request-context-store",
);

type NetlifyContextStore = {
  getStore?: () => { context?: { waitUntil?: unknown } } | undefined;
};

/**
 * The platform's waitUntil for this request. Nitro's Netlify entry drops the
 * function context, but the runtime still keeps it in the AsyncLocalStorage
 * that `getContext()` from `@netlify/functions` reads, under this global symbol.
 */
export function platformWaitUntil(req?: unknown): WaitUntil | undefined {
  const own = (req as { waitUntil?: unknown } | undefined)?.waitUntil;
  if (typeof own === "function") return own.bind(req) as WaitUntil;
  const store = (globalThis as Record<symbol, unknown>)[
    NETLIFY_CONTEXT_STORE_KEY
  ] as NetlifyContextStore | undefined;
  const netlifyContext = store?.getStore?.()?.context;
  if (typeof netlifyContext?.waitUntil === "function") {
    return netlifyContext.waitUntil.bind(netlifyContext) as WaitUntil;
  }
  return undefined;
}

/**
 * Keeps work alive past the response without holding it: handed to the
 * platform when it has waitUntil, otherwise awaited for at most
 * BACKGROUND_DEADLINE_MS. Work still running after the deadline keeps running
 * in this process, but a freeze can cut it short.
 */
export async function runInBackground(
  work: Promise<unknown>,
  waitUntil: WaitUntil | undefined,
): Promise<void> {
  if (waitUntil) {
    waitUntil(work);
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, BACKGROUND_DEADLINE_MS);
    timer.unref?.();
  });
  try {
    await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
