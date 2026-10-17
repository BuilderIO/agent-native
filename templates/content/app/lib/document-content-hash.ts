// The server's `contentHash` for a body. Null where the browser has no Web
// Crypto digest (an origin that is not secure), so a caller can tell a body it
// could not name from one it did.
export async function documentContentHash(
  content: string,
): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(content),
  );
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}
