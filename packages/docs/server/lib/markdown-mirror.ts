import { getRequestHeader, getRequestURL, type H3Event } from "h3";

/**
 * Marks the origin fetch this module makes for a markdown mirror.
 *
 * The Nitro function owns `/*`, so fetching `/<path>.md` from inside the
 * function lands back on the same handler. Without this marker that handler
 * fetches again, and again: measured on www.agent-native.com, every `.md`
 * twin and every `Accept: text/markdown` request returned 502 after ~40s (the
 * platform's synchronous-function wall) with no `cache-status`, so nothing was
 * stored and each retry paid the full 40s while holding a container.
 */
const MIRROR_FETCH_HEADER = "x-agent-native-md-mirror";

const MIRROR_FETCH_TIMEOUT_MS = 5000;

/**
 * A mirror that is absent and a mirror that could not be read are different
 * answers. Absent means "no markdown for this URL" — a `.md` path 404s and a
 * negotiated HTML page falls through to SSR. Unreadable means the lookup
 * itself failed, and collapsing it into absent would serve an HTML page to a
 * markdown request as though that were the correct response.
 */
export type MarkdownMirrorResult =
  | { kind: "found"; content: string }
  | { kind: "absent" }
  | { kind: "unreadable"; reason: string };

/** True when this request IS the mirror fetch, so it must not fetch again. */
export function isMarkdownMirrorFetch(event: H3Event): boolean {
  return getRequestHeader(event, MIRROR_FETCH_HEADER) === "1";
}

/**
 * Read a markdown mirror from the deployment's static output.
 *
 * Netlify publishes the mirrors as static files but does not mount the publish
 * directory beside every serverless function, so a function that cannot see
 * the file reads it back over the CDN. That request is marked, and a marked
 * request never fetches again — it reports the mirror absent and lets the
 * caller answer 404.
 */
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
  // A non-markdown body here means the URL resolved to the HTML page rather
  // than its mirror, which is an absent mirror, not a broken one.
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
