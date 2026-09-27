import * as LaunchDarkly from "@launchdarkly/node-server-sdk";

import { getAppConfig } from "../app-config/index.js";

const CLIENT_KEY = Symbol.for("@agent-native/core/launchdarkly.client");
const INIT_KEY = Symbol.for("@agent-native/core/launchdarkly.init");

interface GlobalWithLaunchDarkly {
  [CLIENT_KEY]?: LaunchDarkly.LDClient;
  [INIT_KEY]?: Promise<LaunchDarkly.LDClient | null>;
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

export async function closeLaunchDarklyClient(): Promise<void> {
  const state = globalState();
  const client = state[CLIENT_KEY];
  if (client) {
    await client.close();
  }
  delete state[CLIENT_KEY];
  delete state[INIT_KEY];
}
