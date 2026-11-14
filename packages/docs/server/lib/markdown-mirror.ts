import { getAppProductionUrl } from "@agent-native/core/server";
import { getRequestHeader, type H3Event } from "h3";
import inventory from "virtual:docs-markdown-inventory";

const knownAssets = inventory === null ? null : new Set(inventory);

const MIRROR_FETCH_HEADER = "x-agent-native-md-mirror";

// Docs is not a first-party template, so without this the unconfigured
// production fallback is localhost and every markdown request 502s.
const DOCS_PUBLIC_ORIGIN = "https://www.agent-native.com";

const MIRROR_FETCH_TIMEOUT_MS = 5000;

export type MarkdownMirrorResult =
  | { kind: "found"; content: string }
  | { kind: "absent" }
  | { kind: "unreadable"; reason: string };

export function isMarkdownMirrorFetch(event: H3Event): boolean {
  return getRequestHeader(event, MIRROR_FETCH_HEADER) === "1";
}

export async function fetchMarkdownMirror(
  relativePath: string,
  event: H3Event,
): Promise<MarkdownMirrorResult> {
  if (isMarkdownMirrorFetch(event)) return { kind: "absent" };
  const assetPath = relativePath.replace(/^\/+/, "");
  const isKnownAsset = knownAssets?.has(assetPath) ?? false;
  if (
    relativePath.endsWith(".md") &&
    !relativePath.includes("%") &&
    knownAssets &&
    !isKnownAsset
  ) {
    return { kind: "absent" };
  }

  const staticUrl = new URL(
    getAppProductionUrl(undefined, { fallback: DOCS_PUBLIC_ORIGIN }),
  );
  staticUrl.pathname = `/${assetPath}`;
  staticUrl.search = "";
  let response: Response;
  try {
    response = await fetch(staticUrl, {
      headers: { accept: "text/markdown", [MIRROR_FETCH_HEADER]: "1" },
      signal: AbortSignal.timeout(MIRROR_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      kind: "unreadable",
      reason: `mirror fetch failed for /${assetPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (response.status === 404 && !isKnownAsset) return { kind: "absent" };
  if (!response.ok) {
    return {
      kind: "unreadable",
      reason: `mirror fetch for /${assetPath} returned ${response.status}`,
    };
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/markdown")) {
    if (!isKnownAsset) return { kind: "absent" };
    return {
      kind: "unreadable",
      reason: `mirror fetch for /${assetPath} returned ${contentType || "missing content-type"} instead of text/markdown`,
    };
  }

  try {
    return { kind: "found", content: await response.text() };
  } catch (error) {
    return {
      kind: "unreadable",
      reason: `mirror body unreadable for /${assetPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
