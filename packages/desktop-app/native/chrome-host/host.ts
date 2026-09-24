import type { Readable, Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import { readNativeHostConfig, type NativeHostConfig } from "./config";
import { encodeNativeMessage, NativeMessageDecoder } from "./framing";

type NativeHostPumpOptions = {
  input: Readable;
  output: Writable;
  config?: NativeHostConfig;
  fetch?: typeof fetch;
  signal?: AbortSignal;
};

export async function runNativeHostPump(
  options: NativeHostPumpOptions,
): Promise<void> {
  const config = options.config ?? (await readNativeHostConfig());
  const fetchImpl = options.fetch ?? fetch;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const decoder = new NativeMessageDecoder();
  let posts = Promise.resolve();

  options.input.on("data", (chunk: Buffer) => {
    try {
      for (const message of decoder.push(Buffer.from(chunk))) {
        posts = posts
          .catch(() => undefined)
          .then(() =>
            postMessage(fetchImpl, config, message, controller.signal),
          );
      }
    } catch (error) {
      controller.abort(error);
    }
  });
  options.input.once("end", () => {
    try {
      decoder.finish();
    } finally {
      controller.abort();
    }
  });
  options.input.once("error", (error) => controller.abort(error));

  let backoffMs = 250;
  try {
    while (!controller.signal.aborted) {
      try {
        const response = await fetchImpl(`${config.baseUrl}/v1/commands`, {
          headers: authorization(config),
          signal: controller.signal,
        });
        if (response.status === 204) continue;
        if (!response.ok)
          throw new Error(`Desktop bridge returned HTTP ${response.status}.`);
        const frame = encodeNativeMessage(await response.json());
        if (!options.output.write(frame)) {
          await new Promise<void>((resolve, reject) => {
            options.output.once("drain", resolve);
            options.output.once("error", reject);
          });
        }
        backoffMs = 250;
      } catch (error) {
        if (controller.signal.aborted) break;
        await delay(backoffMs, undefined, { signal: controller.signal }).catch(
          () => undefined,
        );
        backoffMs = Math.min(backoffMs * 2, 5_000);
      }
    }
  } finally {
    options.signal?.removeEventListener("abort", abort);
    await posts.catch(() => undefined);
  }
}

async function postMessage(
  fetchImpl: typeof fetch,
  config: NativeHostConfig,
  message: unknown,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetchImpl(`${config.baseUrl}/v1/messages`, {
    method: "POST",
    headers: { ...authorization(config), "content-type": "application/json" },
    body: JSON.stringify(message),
    signal,
  });
  if (!response.ok)
    throw new Error(
      `Desktop bridge rejected a native message with HTTP ${response.status}.`,
    );
}

function authorization(config: NativeHostConfig): Record<string, string> {
  return { authorization: `Bearer ${config.bearerToken}` };
}
