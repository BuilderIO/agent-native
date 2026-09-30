import { getAppConfig } from "../app-config/index.js";
import { loadOptionalPeer } from "../shared/optional-peer.js";
import type { LaunchDarklyContext } from "./context.js";

interface LaunchDarklyClient {
  waitForInitialization(): Promise<unknown>;
  close(): Promise<void>;
  variation<T>(
    flagKey: string,
    context: LaunchDarklyContext,
    fallback: T,
  ): Promise<T>;
  boolVariation(
    flagKey: string,
    context: LaunchDarklyContext,
    fallback: boolean,
  ): Promise<boolean>;
  allFlagsState(
    context: LaunchDarklyContext,
  ):
    | { valid: boolean; allValues(): Record<string, unknown> }
    | Promise<{ valid: boolean; allValues(): Record<string, unknown> }>;
}

const CLIENT_KEY = Symbol.for("@agent-native/core/launchdarkly.client");
const INIT_KEY = Symbol.for("@agent-native/core/launchdarkly.init");
const LAUNCH_DARKLY_PACKAGE_ID = "@launchdarkly/node-server-sdk";

interface GlobalWithLaunchDarkly {
  [CLIENT_KEY]?: LaunchDarklyClient;
  [INIT_KEY]?: Promise<LaunchDarklyClient | null>;
}

function globalState(): GlobalWithLaunchDarkly {
  return globalThis as unknown as GlobalWithLaunchDarkly;
}

const INIT_TIMEOUT_MS = 5_000;

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

export function getLaunchDarklyClient(): Promise<LaunchDarklyClient | null> {
  const state = globalState();
  if (state[INIT_KEY]) return state[INIT_KEY];

  const { sdkKey } = getAppConfig().launchDarkly;
  if (!sdkKey) {
    const resolved = Promise.resolve(null);
    state[INIT_KEY] = resolved;
    return resolved;
  }

  const pending = (async () => {
    const { init } = await loadOptionalPeer(
      LAUNCH_DARKLY_PACKAGE_ID,
      () => import(/* @vite-ignore */ LAUNCH_DARKLY_PACKAGE_ID),
    );
    const client = init(sdkKey) as unknown as LaunchDarklyClient;
    state[CLIENT_KEY] = client;

    withTimeout(client.waitForInitialization(), INIT_TIMEOUT_MS).catch(
      (error: unknown) => {
        console.warn(
          `[launchdarkly] client did not confirm initialization within ${INIT_TIMEOUT_MS}ms; evaluating against callers' defaults until it connects.`,
          error,
        );
      },
    );
    return client;
  })();
  state[INIT_KEY] = pending;
  return pending;
}

export async function closeLaunchDarklyClient(): Promise<void> {
  const state = globalState();
  const client = state[CLIENT_KEY];
  if (client) {
    await client.close();
  }
  delete state[CLIENT_KEY];
  delete state[INIT_KEY];
}
