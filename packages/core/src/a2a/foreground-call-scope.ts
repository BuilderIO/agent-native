import { getAsyncLocalStorageCtor } from "../shared/optional-node-builtins.js";

// Kept free of server imports: `defineAction` reads this from the browser bundle.
type ForegroundCall = { active: boolean; expiresAt: number };

const ScopeStorage = getAsyncLocalStorageCtor();
const foregroundCall = ScopeStorage
  ? new ScopeStorage<ForegroundCall | undefined>()
  : undefined;

/**
 * True inside an incoming A2A action call that a call hook admitted as
 * foreground work, until the call settles or its admission expires.
 */
export function isA2AForegroundCall(): boolean {
  const call = foregroundCall?.getStore();
  return call !== undefined && call.active && Date.now() < call.expiresAt;
}

export async function runAsA2AForegroundCall<T>(
  expiresAt: number,
  work: () => Promise<T>,
): Promise<T> {
  if (!foregroundCall) return work();
  const call: ForegroundCall = { active: true, expiresAt };
  return foregroundCall.run(call, async () => {
    try {
      return await work();
    } finally {
      call.active = false;
    }
  });
}
