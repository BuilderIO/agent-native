import { getRequestHeader, getRequestURL, type H3Event } from "h3";

const MIRROR_FETCH_HEADER = "x-agent-native-md-mirror";

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

  const staticUrl = new URL(`/${relativePath}`, getRequestURL(event));
  let response: Response;
  try {
    response = await fetch(staticUrl, {
      headers: { accept: "text/markdown", [MIRROR_FETCH_HEADER]: "1" },
      signal: AbortSignal.timeout(MIRROR_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      kind: "unreadable",
      reason: `mirror fetch failed for /${relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (response.status === 404) return { kind: "absent" };
  if (!response.ok) {
    return {
      kind: "unreadable",
      reason: `mirror fetch for /${relativePath} returned ${response.status}`,
    };
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/markdown")) return { kind: "absent" };

  try {
    return { kind: "found", content: await response.text() };
  } catch (error) {
    return {
      kind: "unreadable",
      reason: `mirror body unreadable for /${relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
