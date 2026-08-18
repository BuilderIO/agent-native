import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { getRequestContext } from "@agent-native/core/server/request-context";

const cachedAssets = new Map<string, Promise<unknown | undefined>>();

function localAssetPaths(filename: string): string[] {
  const roots = [
    join(import.meta.dirname, "../public"),
    join(process.cwd(), "public"),
    join(process.cwd(), "dist"),
    join(process.cwd(), "dist/client"),
    join(process.cwd(), "dist/server/public"),
    join(process.cwd(), "build/client"),
    join(process.cwd(), ".output/public"),
  ];
  return roots.map((root) => join(root, filename));
}

function publicAssetUrl(filename: string): string | undefined {
  const origin = getRequestContext()?.requestOrigin;
  if (!origin) return undefined;

  const configuredBasePath =
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "";
  const basePath = configuredBasePath.trim().replace(/^\/+|\/+$/g, "");
  const pathname = `/${basePath ? `${basePath}/` : ""}${filename}`;
  return new URL(pathname, origin).toString();
}

async function loadPublicJsonAsset<T>(
  filename: string,
): Promise<T | undefined> {
  for (const filePath of localAssetPaths(filename)) {
    try {
      return JSON.parse(await readFile(filePath, "utf-8")) as T;
    } catch {
      // Try the next known build output location.
    }
  }

  const url = publicAssetUrl(filename);
  if (!url) return undefined;

  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return undefined;
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

export function readPublicJsonAsset<T>(
  filename: string,
): Promise<T | undefined> {
  const cached = cachedAssets.get(filename);
  if (cached) return cached as Promise<T | undefined>;

  const promise = loadPublicJsonAsset<T>(filename).then((asset) => {
    if (asset === undefined) cachedAssets.delete(filename);
    return asset;
  });
  cachedAssets.set(filename, promise);
  return promise;
}
