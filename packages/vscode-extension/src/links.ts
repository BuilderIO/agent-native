export const DEFAULT_APP_URL = "https://dispatch.agent-native.com";
export const VSCODE_OPEN_AUTHORITY = "builderio.agent-native";

export function normalizeOpenUrl(input: string | undefined): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (
    parsed.protocol === "vscode:" &&
    parsed.hostname.toLowerCase() === VSCODE_OPEN_AUTHORITY
  ) {
    return normalizeOpenUrl(parsed.searchParams.get("url") ?? undefined);
  }

  if (parsed.protocol === "agentnative:" && parsed.hostname === "open") {
    return normalizeOpenUrl(
      parsed.searchParams.get("webUrl") ??
        parsed.searchParams.get("url") ??
        undefined,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  parsed.hash = "";
  return parsed.toString();
}

export function buildVsCodeOpenUri(url: string): string {
  const sp = new URLSearchParams();
  sp.set("url", url);
  return `vscode://${VSCODE_OPEN_AUTHORITY}/open?${sp.toString()}`;
}

export function titleForUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname) return `Agent Native: ${parsed.hostname}`;
  } catch {}
  return "Agent Native";
}
