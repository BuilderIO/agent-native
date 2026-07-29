const CHROME_EXTENSION_ID = /^[a-p]{32}$/;
const MAX_BROWSER_EXTENSION_IDS = 64;

export function resolveAllowedBrowserExtensionIds(
  configIds: readonly string[] = [],
  envValue = process.env.AGENT_NATIVE_BROWSER_EXTENSION_IDS,
): Set<string> {
  const ids = [...configIds, ...(envValue?.split(",") ?? [])]
    .map((value) => value.trim())
    .filter(Boolean);
  const invalid = ids.find((value) => !CHROME_EXTENSION_ID.test(value));
  if (invalid) {
    throw new Error(
      "Browser extension allowlist contains an invalid Chrome extension id.",
    );
  }
  const uniqueIds = new Set(ids);
  if (uniqueIds.size > MAX_BROWSER_EXTENSION_IDS) {
    throw new Error(
      `Browser extension allowlist cannot exceed ${MAX_BROWSER_EXTENSION_IDS} ids.`,
    );
  }
  return uniqueIds;
}

function isLoopbackOrigin(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

export function isBrowserExtensionIdAllowed(options: {
  extensionId: string;
  configIds?: readonly string[];
  envValue?: string;
  nodeEnv?: string;
  requestOrigin?: string;
}): boolean {
  if (!CHROME_EXTENSION_ID.test(options.extensionId)) return false;
  const configured = resolveAllowedBrowserExtensionIds(
    options.configIds,
    options.envValue,
  );
  if (configured.has(options.extensionId)) return true;

  return (
    options.nodeEnv !== "production" && isLoopbackOrigin(options.requestOrigin)
  );
}
