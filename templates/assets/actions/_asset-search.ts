import { z } from "zod";

import { parseJson } from "../server/lib/json.js";

type SearchableAsset = {
  title?: string | null;
  description?: string | null;
  altText?: string | null;
  prompt?: string | null;
  mimeType?: string | null;
  role?: string | null;
  status?: string | null;
  metadata?: string | null;
};

export const includeCandidatesSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean().default(false));

export function shouldIncludeAssetInLibraryResults(
  asset: { role?: string | null; status?: string | null },
  includeCandidates = false,
) {
  if (includeCandidates) return true;
  return !(asset.role === "generated" && asset.status === "candidate");
}

export function assetMatchesSearch(
  asset: SearchableAsset,
  normalizedQuery: string | undefined,
  category?: string,
) {
  const metadata = parseJson<Record<string, unknown>>(asset.metadata, {});
  if (category && metadata.category !== category) return false;
  if (!normalizedQuery) return true;
  const searchable = [
    asset.title,
    asset.description,
    asset.altText,
    asset.prompt,
    asset.mimeType,
    asset.role,
    asset.status,
    metadata.category,
    metadata.description,
    metadata.originalName,
    metadata.prompt,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .toLowerCase();
  return searchable.includes(normalizedQuery);
}
