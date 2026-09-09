/**
 * Shared Figma URL / node-id parsing helpers.
 *
 * Figma file URLs come in a few shapes:
 *   https://www.figma.com/design/<fileKey>/<name>
 *   https://www.figma.com/file/<fileKey>/<name>            (legacy)
 *   https://www.figma.com/proto/<fileKey>/<name>            (prototype share link)
 *   https://www.figma.com/design/<fileKey>/<name>/branch/<branchKey>/<name>
 *
 * The branch shape is the important gotcha: a branch is a *separate* file for
 * REST API purposes. `/v1/files/:fileKey` etc. must be called with the
 * **branch key**, not the parent file key that appears earlier in the path —
 * calling with the parent key silently returns the parent file's content,
 * not the branch the user is actually looking at. See
 * https://developers.figma.com/docs/rest-api/ (branches share the same file
 * shape as regular files once you have the branch's own key).
 *
 * `node-id` is carried as a query param and Figma writes it with dashes
 * (`1-2`) even though the REST API's node ids use colons (`1:2`). Grouped /
 * instance-swap node ids can look like `1:2;3:4` — only the plain
 * `<number>-<number>` shape needs dash-to-colon conversion; anything already
 * containing a colon is passed through untouched.
 */

const FIGMA_FILE_KEY_RE = /^[A-Za-z0-9_-]{8,}$/;
const FILE_PATH_SEGMENTS = ["design", "file", "proto"] as const;

function isFigmaHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "figma.com" || normalized.endsWith(".figma.com");
}

export interface ParsedFigmaUrl {
  /** Effective file key to use for REST API calls (branch key when present). */
  fileKey: string | null;
  /** Node id in REST API colon form (e.g. "1:2"), or null when absent. */
  nodeId: string | null;
  /** True when the URL pointed at a branch and fileKey is that branch's key. */
  isBranch: boolean;
}

function candidateFileKey(value: string): string | null {
  return FIGMA_FILE_KEY_RE.test(value) ? value : null;
}

/**
 * Extract the effective Figma file key from a raw file key or a Figma URL.
 * Resolves `/branch/:branchKey/` to the branch key when present, since a
 * branch is a distinct file from the REST API's point of view.
 */
export function parseFigmaFileKey(input: string | undefined): string | null {
  const value = input?.trim();
  if (!value) return null;

  const direct = candidateFileKey(value);
  if (direct) return direct;

  try {
    const url = new URL(value);
    if (!isFigmaHostname(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);

    const branchIndex = parts.indexOf("branch");
    if (branchIndex >= 0) {
      const branchKey = candidateFileKey(parts[branchIndex + 1] ?? "");
      if (branchKey) return branchKey;
    }

    for (const segment of FILE_PATH_SEGMENTS) {
      const index = parts.indexOf(segment);
      if (index >= 0) {
        const key = candidateFileKey(parts[index + 1] ?? "");
        if (key) return key;
      }
    }
  } catch {
    return null;
  }

  return null;
}

/** True when the given file URL points at a branch (not the main file). */
export function isFigmaBranchUrl(input: string | undefined): boolean {
  const value = input?.trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    if (!isFigmaHostname(url.hostname)) return false;
    return url.pathname.split("/").filter(Boolean).includes("branch");
  } catch {
    return false;
  }
}

/**
 * Normalize a raw node-id-ish string to the REST API's colon form. Accepts:
 *   "1:2"          -> "1:2"        (already normalized)
 *   "1-2"          -> "1:2"        (dash form, as seen in `node-id` query params)
 *   "1-2;3-4"      -> "1:2;3:4"    (instance-swap grouped ids)
 *   "I1:2;3:4"     -> "I1:2;3:4"   (already normalized, leading instance marker)
 */
function normalizeNodeIdToken(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  // Already colon form (optionally prefixed with "I" for instance overrides).
  if (/^I?\d+:\d+$/.test(trimmed)) return trimmed;
  // Dash form -> colon form.
  if (/^I?\d+-\d+$/.test(trimmed)) return trimmed.replace("-", ":");
  return null;
}

function normalizeNodeId(raw: string): string | null {
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();
  const parts = decoded
    .split(";")
    .map((part) => normalizeNodeIdToken(part))
    .filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(";") : null;
}

/**
 * Extract a Figma node id from a `node-id` query param or a raw id string,
 * converting Figma's URL dash form (`1-2`) to the REST API's colon form
 * (`1:2`).
 */
export function parseFigmaNodeId(input: string | undefined): string | null {
  const value = input?.trim();
  if (!value) return null;

  const direct = normalizeNodeId(value);
  if (direct) return direct;

  try {
    const url = new URL(value);
    if (!isFigmaHostname(url.hostname)) return null;
    const nodeParam = url.searchParams.get("node-id");
    if (nodeParam) return normalizeNodeId(nodeParam);
  } catch {
    return null;
  }

  return null;
}

/** Parse a Figma URL (or bare file key) into its effective file key and node id. */
export function parseFigmaUrl(input: string | undefined): ParsedFigmaUrl {
  const fileKey = parseFigmaFileKey(input);
  const nodeId = parseFigmaNodeId(input);
  return { fileKey, nodeId, isBranch: isFigmaBranchUrl(input) };
}
