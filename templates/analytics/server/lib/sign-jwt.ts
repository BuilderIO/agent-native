// RS256 JWT signing via Web Crypto — works on Node and Cloudflare Workers.
// Node's `crypto.sign` is not implemented by unenv on Workers, so we use
// SubtleCrypto directly. Service account `private_key` fields from GCP are
// PKCS#8 PEM, which importKey accepts directly after we strip the armor.

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlEncodeString(value: string): string {
  return base64UrlEncode(new TextEncoder().encode(value));
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function importRs256Key(privateKeyPem: string): Promise<CryptoKey> {
  let cached = keyCache.get(privateKeyPem);
  if (!cached) {
    cached = crypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8(privateKeyPem) as BufferSource,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    keyCache.set(privateKeyPem, cached);
  }
  return cached;
}

export async function signRs256Jwt(
  payload: Record<string, unknown>,
  privateKeyPem: string,
): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const signingInput =
    base64UrlEncodeString(JSON.stringify(header)) +
    "." +
    base64UrlEncodeString(JSON.stringify(payload));

  const key = await importRs256Key(privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput) as BufferSource,
  );

  return signingInput + "." + base64UrlEncode(new Uint8Array(signature));
}
