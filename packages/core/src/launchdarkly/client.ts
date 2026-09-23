/**
 * Lazily-initialized LaunchDarkly server-side SDK client.
 *
 * Importing this module never contacts LaunchDarkly — only calling
 * `getLaunchDarklyClient()` does, and only once per process thanks to the
 * cached init promise below. That keeps LaunchDarkly out of the cold-start
 * path for apps that never read a flag (see the `performance` skill: no
 * network handshake at module load or plugin init).
 */
import * as LaunchDarkly from "@launchdarkly/node-server-sdk";

import { getAppConfig } from "../app-config/index.js";

const CLIENT_KEY = Symbol.for("@agent-native/core/launchdarkly.client");
const INIT_KEY = Symbol.for("@agent-native/core/launchdarkly.init");

// globalThis-cached, matching the tracking registry's pattern, so multiple
// ESM graph instances (dev-mode Vite + Nitro, symlinked workspace packages)
// share the same client instead of each opening its own streaming connection.
interface GlobalWithLaunchDarkly {
  [CLIENT_KEY]?: LaunchDarkly.LDClient;
  [INIT_KEY]?: Promise<LaunchDarkly.LDClient | null>;
}

function globalState(): GlobalWithLaunchDarkly {
  return globalThis as unknown as GlobalWithLaunchDarkly;
}

const INIT_TIMEOUT_MS = 5_000;

/**
 * `waitForInitialization()`'s options shape has changed across SDK major
 * versions (`{ timeout }` vs `{ timeoutSeconds }`), so this races it against a
 * plain timer instead of depending on either spelling — LaunchDarkly's own
 * Node.js SDK docs recommend the same `Promise.race` approach.
 */
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

/**
 * Returns the shared LaunchDarkly client once it has connected, or `null`
 * when LaunchDarkly is not configured (`LAUNCHDARKLY_SDK_KEY` unset) or fails
 * to initialize within {@link INIT_TIMEOUT_SECONDS}.
 *
 * Callers must treat `null` exactly like "flag not found" and fall back to
 * their own default — never throw, and never let this become an availability
 * dependency for the caller.
 */
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
  state[INIT_KEY] = withTimeout(client.waitForInitialization(), INIT_TIMEOUT_MS)
    .then(() => client)
    .catch((error: unknown) => {
      console.warn(
        `[launchdarkly] client failed to initialize within ${INIT_TIMEOUT_MS}ms; flags will evaluate to their caller-supplied default until the next process start.`,
        error,
      );
      return null;
    });
  return state[INIT_KEY];
}

/**
 * Closes the shared client and clears the cached instance so the next call to
 * `getLaunchDarklyClient()` reconnects from scratch. Test-only — production
 * code has no reason to tear this down mid-process.
 */
export async function closeLaunchDarklyClient(): Promise<void> {
  const state = globalState();
  const client = state[CLIENT_KEY];
  if (client) {
    await client.close();
  }
  delete state[CLIENT_KEY];
  delete state[INIT_KEY];
}
