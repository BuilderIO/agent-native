// Importing this module never contacts LaunchDarkly — only calling
// `getLaunchDarklyClient()` does. Keeps LaunchDarkly out of the cold-start
// path (see the `performance` skill: no network handshake at module load).
import * as LaunchDarkly from "@launchdarkly/node-server-sdk";

import { getAppConfig } from "../app-config/index.js";

const CLIENT_KEY = Symbol.for("@agent-native/core/launchdarkly.client");
const INIT_KEY = Symbol.for("@agent-native/core/launchdarkly.init");

// globalThis-cached so multiple ESM graph instances (dev-mode Vite + Nitro,
// symlinked workspace packages) share one client instead of each opening its
// own streaming connection.
interface GlobalWithLaunchDarkly {
  [CLIENT_KEY]?: LaunchDarkly.LDClient;
  [INIT_KEY]?: Promise<LaunchDarkly.LDClient | null>;
}

function globalState(): GlobalWithLaunchDarkly {
  return globalThis as unknown as GlobalWithLaunchDarkly;
}

const INIT_TIMEOUT_MS = 5_000;

// `waitForInitialization()`'s options shape has changed across SDK major
// versions (`{ timeout }` vs `{ timeoutSeconds }`), so this races it against a
// plain timer instead of depending on either spelling — LaunchDarkly's own
// Node.js SDK docs recommend the same `Promise.race` approach.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${ms}ms`)),
      ms,
    );
    if (timer.unref) timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// Callers must treat `null` exactly like "flag not found" and fall back to
// their own default — never throw, and never let this become an
// availability dependency for the caller.
export function getLaunchDarklyClient(): Promise<LaunchDarkly.LDClient | null> {
  const state = globalState();
  if (state[INIT_KEY]) return state[INIT_KEY];

  const { sdkKey } = getAppConfig().launchDarkly;
  if (!sdkKey) {
    const resolved = Promise.resolve(null);
    state[INIT_KEY] = resolved;
    return resolved;
  }

  const client = LaunchDarkly.init(sdkKey);
  state[CLIENT_KEY] = client;

  // `variation()`/`boolVariation()` already answer with the caller's default
  // before the client finishes initializing, so callers never need to block
  // on `waitForInitialization()` here — doing so would add up to
  // INIT_TIMEOUT_MS of latency to the very first flag read in the process.
  // This only logs a slow first connection; it never changes what an
  // evaluation call returns.
  withTimeout(client.waitForInitialization(), INIT_TIMEOUT_MS).catch(
    (error: unknown) => {
      console.warn(
        `[launchdarkly] client did not confirm initialization within ${INIT_TIMEOUT_MS}ms; evaluating against callers' defaults until it connects.`,
        error,
      );
    },
  );

  const resolved = Promise.resolve(client);
  state[INIT_KEY] = resolved;
  return resolved;
}

// Test-only — production code has no reason to tear this down mid-process.
export async function closeLaunchDarklyClient(): Promise<void> {
  const state = globalState();
  const client = state[CLIENT_KEY];
  if (client) {
    await client.close();
  }
  delete state[CLIENT_KEY];
  delete state[INIT_KEY];
}
