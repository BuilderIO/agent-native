export interface ParsedDataUrl {
  mediaType: string;
  data: string;
  isBase64: boolean;
}

export interface ParsedBase64DataUrl {
  mediaType: string;
  data: string;
}

const MIME_TYPE_RE = /^[^/\s;,]+\/[^/\s;,]+$/;
const MIME_PARAMETER_NAME_RE = /^[!#$%&'*+.^_`|~0-9a-z-]+$/i;

function splitHeaderParameters(header: string): string[] | null {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < header.length; index += 1) {
    const char = header[index];
    if (quoted && escaped) {
      escaped = false;
      continue;
    }
    if (quoted && char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ";" && !quoted) {
      parts.push(header.slice(start, index));
      start = index + 1;
    }
  }

  if (quoted || escaped) return null;
  parts.push(header.slice(start));
  return parts;
}

function findDataSeparator(value: string): number {
  let quoted = false;
  let escaped = false;

  for (let index = 5; index < value.length; index += 1) {
    const char = value[index];
    if (quoted && escaped) {
      escaped = false;
      continue;
    }
    if (quoted && char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) return index;
  }

  return -1;
}

export function parseDataUrl(value: string): ParsedDataUrl | null {
  if (value.slice(0, 5).toLowerCase() !== "data:") return null;
  const comma = findDataSeparator(value);
  if (comma < 0) return null;

  const parts = splitHeaderParameters(value.slice(5, comma));
  const mediaType = parts?.shift()?.trim().toLowerCase();
  if (!parts || !mediaType || !MIME_TYPE_RE.test(mediaType)) return null;

  const isBase64 = parts.at(-1)?.trim().toLowerCase() === "base64";
  if (isBase64) parts.pop();
  if (
    parts.some((parameter) => {
      const equals = parameter.indexOf("=");
      return (
        equals <= 0 ||
        !MIME_PARAMETER_NAME_RE.test(parameter.slice(0, equals).trim())
      );
    })
  ) {
    return null;
  }

  const data = value.slice(comma + 1);
  if (!data) return null;
  return { mediaType, data, isBase64 };
}

export function parseBase64DataUrl(value: string): ParsedBase64DataUrl | null {
  const parsed = parseDataUrl(value);
  return parsed?.isBase64
    ? { mediaType: parsed.mediaType, data: parsed.data }
    : null;
}
