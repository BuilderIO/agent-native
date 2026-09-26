const FIGMA_FILE_KEY_RE = /^[A-Za-z0-9_-]{8,}$/;
const FILE_PATH_SEGMENTS = ["design", "file", "proto"] as const;

function isFigmaHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "figma.com" || normalized.endsWith(".figma.com");
}

export interface ParsedFigmaUrl {
  fileKey: string | null;
  nodeId: string | null;
  isBranch: boolean;
}

function candidateFileKey(value: string): string | null {
  return FIGMA_FILE_KEY_RE.test(value) ? value : null;
}

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

function normalizeNodeIdToken(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (/^I?\d+:\d+$/.test(trimmed)) return trimmed;
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

export function parseFigmaUrl(input: string | undefined): ParsedFigmaUrl {
  const fileKey = parseFigmaFileKey(input);
  const nodeId = parseFigmaNodeId(input);
  return { fileKey, nodeId, isBranch: isFigmaBranchUrl(input) };
}
