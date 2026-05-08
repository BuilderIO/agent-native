const QUOTE_PATTERNS = [
  /\n*(— On .+? wrote:\n)/,
  /\n*(— Forwarded message —\n)/,
];

function splitQuotedContent(body: string): [string, string] {
  for (const pattern of QUOTE_PATTERNS) {
    const match = body.match(pattern);
    if (match?.index !== undefined) {
      return [body.slice(0, match.index), body.slice(match.index)];
    }
  }
  return [body, ""];
}

export function normalizeSignature(signature?: string | null): string {
  return stripSignatureImages(signature ?? "").trim();
}

export function stripSignatureImages(signature: string): string {
  return signature
    .replace(
      /\[!\[[\s\S]*?\]\((?:https?:\/\/|data:image\/)[^)]*\)\]\([^)]*\)/gi,
      "",
    )
    .replace(/!\[[\s\S]*?\]\((?:https?:\/\/|data:image\/)[^)]*\)/gi, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function appendSignatureToBody(
  body: string,
  signature?: string | null,
): string {
  const normalizedSignature = normalizeSignature(signature);
  if (!normalizedSignature) return body;
  if (body.includes(normalizedSignature)) return body;

  const [editable, quoted] = splitQuotedContent(body);
  const editableWithSignature = editable.trimEnd()
    ? `${editable.trimEnd()}\n\n${normalizedSignature}`
    : normalizedSignature;

  if (!quoted) return editableWithSignature;
  return `${editableWithSignature}\n\n${quoted.trimStart()}`;
}
