import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";

import { normalizedBuilderAssetUrl } from "./migrate-historical-icon-urls.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Builder's Admin API lists assets in the Space selected by the private key. */
export async function verifyBuilderSpaceAssetUrl(
  url: string,
  authorization: { authorization: string; source: "legacy" | "oauth" },
  fetcher: Fetch = fetch,
): Promise<"owned" | "unmatched" | "ambiguous"> {
  const normalized = normalizedBuilderAssetUrl(url);
  if (!normalized) return "ambiguous";
  // Builder documents Admin API authentication with a Space private key. Its
  // OAuth asset-write grant does not establish Admin API Space ownership.
  if (authorization.source !== "legacy")
    throw new Error(
      "Builder Admin asset listing requires a Space private key; OAuth ownership verification is unsupported",
    );
  const response = await fetcher("https://cdn.builder.io/api/v2/admin", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: authorization.authorization,
      "Content-Type": "application/json",
      "x-cdn-host": "cdn.builder.io",
    },
    body: JSON.stringify({
      query:
        "query HistoricalIconOwnership($input: QueryAssetsInput!) { assets(input: $input) { id url } }",
      variables: { input: { query: { url: { $eq: normalized } }, limit: 3 } },
    }),
  });
  if (!response.ok)
    throw new Error(`Builder Admin asset listing failed (${response.status})`);
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== "object" ||
    !("data" in result) ||
    !result.data ||
    typeof result.data !== "object" ||
    !("assets" in result.data) ||
    !Array.isArray(result.data.assets) ||
    ("errors" in result &&
      Array.isArray(result.errors) &&
      result.errors.length > 0)
  ) {
    throw new Error("Builder Admin asset listing returned an invalid response");
  }
  const assets = result.data.assets;
  if (assets.length > 1) return "ambiguous";
  if (assets.length === 0) return "unmatched";
  const asset: unknown = assets[0];
  if (
    !asset ||
    typeof asset !== "object" ||
    !("id" in asset) ||
    typeof asset.id !== "string" ||
    !asset.id ||
    !("url" in asset) ||
    typeof asset.url !== "string"
  )
    return "ambiguous";
  return normalizedBuilderAssetUrl(asset.url) === normalized
    ? "owned"
    : "ambiguous";
}

export async function fetchBoundedBuilderImage(
  url: string,
  fetcher: Fetch = (input, init) =>
    ssrfSafeFetch(input, init, { maxRedirects: 0 }),
): Promise<{ data: Uint8Array; mimeType: string }> {
  if (normalizedBuilderAssetUrl(url) !== url)
    throw new Error("Builder image URL is not canonical");
  const response = await fetcher(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Builder image fetch failed (${response.status})`);
  const mimeType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    !mimeType ||
    !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(
      mimeType,
    )
  )
    throw new Error("Builder asset has an unsupported image MIME type");
  const advertisedSize = response.headers.get("content-length");
  if (advertisedSize && Number(advertisedSize) > MAX_IMAGE_BYTES)
    throw new Error("Builder image exceeds 5 MiB");
  if (!response.body) throw new Error("Builder image has no response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_IMAGE_BYTES)
        throw new Error("Builder image exceeds 5 MiB");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (size === 0) throw new Error("Builder image is empty");
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { data, mimeType };
}
