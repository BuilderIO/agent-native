const QUOTE_PATTERNS = [/\n*(— On .+? wrote:\n)/, /\n*(— Forwarded message —\n)/];

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
  return (signature ?? "").trim();
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
