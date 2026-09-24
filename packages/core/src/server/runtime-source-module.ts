/**
 * Importing an app's own source module from the framework.
 *
 * The installed CLI runs `dist/` under plain Node, where a `.ts` file is
 * `ERR_UNKNOWN_FILE_EXTENSION` unless jiti picks it up. Action discovery needs
 * this, and so does anything else that loads app source outside the `tsx`
 * entry point — so it lives here rather than inside discovery, which pulls a
 * large server graph that a CLI bootstrap has no reason to load.
 */

import { pathToFileURL } from "node:url";

function shouldRetryWithJiti(filePath: string, err: unknown): boolean {
  if (!filePath.endsWith(".ts")) return false;
  const candidate = err as { code?: unknown; message?: unknown } | undefined;
  if (candidate?.code === "ERR_UNKNOWN_FILE_EXTENSION") return true;
  return /Unknown file extension ".ts"/.test(String(candidate?.message ?? ""));
}

export async function importRuntimeSourceModule(
  filePath: string,
): Promise<Record<string, any>> {
  try {
    return await import(/* @vite-ignore */ pathToFileURL(filePath).href);
  } catch (err) {
    if (!shouldRetryWithJiti(filePath, err)) throw err;

    const { createJiti } = await import("jiti");
    const jiti = createJiti(pathToFileURL(filePath).href, {
      interopDefault: true,
    });
    return (await jiti.import(filePath)) as Record<string, any>;
  }
}
