import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getGeminiApiKey } from "../server/lib/generation.js";
import { nowIso, parseJson, stringifyJson } from "../server/lib/json.js";
import { getObject } from "../server/lib/storage.js";
import { getAssetOrThrow, serializeAsset } from "./_helpers.js";

const MAX_INLINE_MEDIA_BYTES = 20 * 1024 * 1024;

export default defineAction({
  description:
    "Generate searchable description and alt text for an uploaded or generated image/video asset, then save it on the asset.",
  schema: z.object({
    id: z.string(),
    overwrite: z.coerce.boolean().default(false),
  }),
  run: async ({ id, overwrite }) => {
    const asset = await getAssetOrThrow(id);
    await assertAccess("asset-library", asset.libraryId, "editor");
    if (!overwrite && (asset.description || asset.altText)) {
      return serializeAsset(asset);
    }
    // Cost guard: this downloads media and calls Gemini, so default to cached
    // descriptions unless the caller explicitly passes overwrite=true.
    const bytes = await getObject(asset.objectKey);
    if (bytes.byteLength > MAX_INLINE_MEDIA_BYTES) {
      throw new Error(
        "Asset is too large for inline description generation. Add a description manually or use a shorter proxy clip.",
      );
    }
    const apiKey = await getGeminiApiKey();
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: [
                    "Describe this digital asset for a searchable DAM.",
                    "Return compact JSON with keys title, altText, description, and keywords.",
                    "Keep altText under 160 characters. Use neutral factual language.",
                  ].join("\n"),
                },
                {
                  inlineData: {
                    mimeType: asset.mimeType,
                    data: bytes.toString("base64"),
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(90_000),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Gemini asset description failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : "."}`,
      );
    }
    const body = (await response.json()) as any;
    const text = body?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part.text)
      .filter(Boolean)
      .join("\n");
    const parsed = parseJson<{
      title?: string;
      altText?: string;
      description?: string;
      keywords?: string[];
    }>(text || "{}", {});
    const metadata = parseJson<Record<string, unknown>>(asset.metadata, {});
    metadata.description = parsed.description ?? parsed.altText ?? null;
    metadata.keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.filter((keyword) => typeof keyword === "string")
      : [];
    const updates = {
      title: asset.title || parsed.title || null,
      description: parsed.description ?? parsed.altText ?? asset.description,
      altText: parsed.altText ?? parsed.description ?? asset.altText,
      metadata: stringifyJson(metadata),
      updatedAt: nowIso(),
    };
    await getDb()
      .update(schema.assets)
      .set(updates)
      .where(eq(schema.assets.id, id));
    return serializeAsset({ ...asset, ...updates });
  },
});
