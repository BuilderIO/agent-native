import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const name = "clips-temporary-key-transfer";
const dir = path.join(root, ".netlify", "functions-internal", name);
mkdirSync(dir, { recursive: true });
writeFileSync(
  path.join(dir, `${name}.mjs`),
  `
import { constants, publicEncrypt, verify } from "node:crypto";

export default async function handler(request) {
  const publicKey = process.env.CLIPS_TRANSFER_PUBLIC_KEY;
  const expiresAt = Number(process.env.CLIPS_TRANSFER_EXPIRES_AT_MS);
  const secret = process.env.BETTER_AUTH_SECRET;
  if (request.method !== "POST" || !publicKey || !secret || !Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return new Response(null, { status: 404 });
  }
  const timestamp = request.headers.get("x-transfer-time") || "";
  const signature = request.headers.get("x-transfer-signature") || "";
  const at = Number(timestamp);
  if (!Number.isFinite(at) || Math.abs(Date.now() - at) > 60000 || signature.length > 1024 || !/^[A-Za-z0-9+/=]+$/.test(signature)) {
    return new Response(null, { status: 403 });
  }
  try {
    if (!verify("sha256", Buffer.from("clips-transfer:" + timestamp), publicKey, Buffer.from(signature, "base64"))) {
      return new Response(null, { status: 403 });
    }
    const sealed = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(secret));
    return new Response(sealed, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store" } });
  } catch {
    return new Response(null, { status: 500 });
  }
}
`,
);
