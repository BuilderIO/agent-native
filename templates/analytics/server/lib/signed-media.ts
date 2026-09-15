import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_SIGNED_SVG_BYTES = 512 * 1024;

function mediaSigningSecret(): string {
  return (
    process.env.A2A_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    process.env.SECRETS_ENCRYPTION_KEY ||
    ""
  );
}

function sign(filename: string, payload: string): string | null {
  const secret = mediaSigningSecret();
  if (!secret) return null;
  return createHmac("sha256", secret)
    .update(`${filename}.${payload}`)
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function looksLikeGeneratedSvg(svg: string): boolean {
  const lower = svg.toLowerCase();
  return (
    lower.trimStart().startsWith("<svg") &&
    !lower.includes("<script") &&
    !/\son[a-z]+\s*=/.test(lower)
  );
}

export function signedSvgMediaUrl(
  filename: string,
  svg: string,
): string | null {
  const bytes = Buffer.byteLength(svg, "utf8");
  if (!looksLikeGeneratedSvg(svg) || bytes > MAX_SIGNED_SVG_BYTES) return null;
  const payload = Buffer.from(svg, "utf8").toString("base64url");
  const signature = sign(filename, payload);
  if (!signature) return null;
  const params = new URLSearchParams({
    svg: payload,
    sig: signature,
    v: String(Date.now()),
  });
  return `/api/media/${encodeURIComponent(filename)}?${params.toString()}`;
}

export function mediaFilenameFromPath(pathOrUrl: string): string {
  const pathname = pathOrUrl.split("?")[0] || "";
  const marker = "/api/media/";
  const markerIndex = pathname.indexOf(marker);
  const encoded =
    markerIndex >= 0 ? pathname.slice(markerIndex + marker.length) : pathname;

  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

export function readSignedSvgMediaPayload(
  filename: string,
  payload: unknown,
  signature: unknown,
): string | null {
  if (typeof payload !== "string" || typeof signature !== "string") {
    return null;
  }
  const expected = sign(filename, payload);
  if (!expected || !safeEqual(expected, signature)) return null;
  const svg = Buffer.from(payload, "base64url").toString("utf8");
  if (
    Buffer.byteLength(svg, "utf8") > MAX_SIGNED_SVG_BYTES ||
    !looksLikeGeneratedSvg(svg)
  ) {
    return null;
  }
  return svg;
}
