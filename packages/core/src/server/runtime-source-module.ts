
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
