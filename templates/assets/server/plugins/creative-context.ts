import { createHash } from "node:crypto";

import { registerOnboardingStep } from "@agent-native/core/onboarding";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import {
  registerNativeResourceCaptureAdapter,
  readCreativeContextMedia,
  setupCreativeContext,
  type CreativeContextProjectionAdapters,
} from "@agent-native/creative-context/server";
import { getCreativeContextItem } from "@agent-native/creative-context/store";
import { listContextSources } from "@agent-native/creative-context/store";
import type { ContextMedia } from "@agent-native/creative-context/types";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "../db/index.js";
import { createAssetFromBuffer } from "../lib/assets.js";
import { nativeAssetCreativeContextAdapter } from "../lib/native-creative-context.js";
import { seedDefaultGenerationPresets } from "../lib/generation-presets.js";
import { nowIso, parseJson, stringifyJson } from "../lib/json.js";

const IMPORT_LIBRARY_TITLE = "Creative context imports";

async function ensureImportLibrary() {
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) throw new Error("no authenticated user");
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.assetLibraries)
    .where(
      and(
        eq(schema.assetLibraries.ownerEmail, ownerEmail),
        eq(schema.assetLibraries.title, IMPORT_LIBRARY_TITLE),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const now = nowIso();
  const row = {
    id: nanoid(),
    title: IMPORT_LIBRARY_TITLE,
    description:
      "Reference media projected from governed Creative Context sources.",
    customInstructions: "",
    styleBrief: "{}",
    settings: stringifyJson({ sourceType: "brand-import" }),
    ownerEmail,
    orgId: getRequestOrgId(),
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(schema.assetLibraries).values(row);
  await seedDefaultGenerationPresets({ db, libraryId: row.id, now });
  return row;
}

function projectedAssetId(ownerEmail: string, dedupeKey: string) {
  return `cc-${createHash("sha256")
    .update(`${ownerEmail}:${dedupeKey}`)
    .digest("hex")
    .slice(0, 24)}`;
}

async function projectMedia(input: {
  sourceId: string;
  itemId: string;
  itemVersionId: string;
  media: ContextMedia;
  sourceType: "brand-import";
  dedupeKey: string;
}) {
  if (input.media.kind !== "image" && input.media.kind !== "video") return null;
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) throw new Error("no authenticated user");
  const id = projectedAssetId(ownerEmail, input.dedupeKey);
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.assets)
    .where(eq(schema.assets.id, id))
    .limit(1);
  if (existing) return existing;
  const [library, detail, loaded] = await Promise.all([
    ensureImportLibrary(),
    getCreativeContextItem(input.itemId, input.itemVersionId),
    readCreativeContextMedia({
      mediaId: input.media.id,
      itemId: input.itemId,
      itemVersionId: input.itemVersionId,
    }),
  ]);
  if (!detail) throw new Error("Creative context item is not accessible");
  return createAssetFromBuffer({
    id,
    libraryId: library.id,
    buffer: Buffer.from(loaded.data),
    mimeType: loaded.mimeType,
    role: input.media.kind === "video" ? "video_reference" : "style_reference",
    status: "reference",
    title: detail.item.title,
    description: input.media.caption ?? input.media.altText,
    altText: input.media.altText,
    metadata: {
      sourceType: input.sourceType,
      contentHash: input.media.contentHash,
      creativeContext: {
        sourceId: input.sourceId,
        itemId: input.itemId,
        itemVersionId: input.itemVersionId,
        mediaId: input.media.id,
        dedupeKey: input.dedupeKey,
      },
    },
  });
}

const projections: CreativeContextProjectionAdapters = {
  media: {
    project: async (input) => {
      await projectMedia(input);
    },
  },
  canonicalLogo: {
    apply: async ({ itemId, itemVersionId, payload }) => {
      const mediaId =
        typeof payload.mediaId === "string" ? payload.mediaId : undefined;
      if (!mediaId) {
        throw new Error("Canonical-logo confirmation requires payload.mediaId");
      }
      const detail = await getCreativeContextItem(itemId, itemVersionId);
      const media = detail?.media.find((candidate) => candidate.id === mediaId);
      if (!detail || !media || media.kind !== "image") {
        throw new Error("Canonical-logo media is not accessible");
      }
      const ownerEmail = getRequestUserEmail();
      if (!ownerEmail) throw new Error("no authenticated user");
      const dedupeKey = `${media.id}:${itemVersionId}`;
      const asset = await projectMedia({
        sourceId: detail.item.sourceId,
        itemId,
        itemVersionId,
        media,
        sourceType: "brand-import",
        dedupeKey,
      });
      if (!asset)
        throw new Error("Canonical-logo media could not be projected");
      await getDb()
        .update(schema.assets)
        .set({
          role: "logo_reference",
          metadata: stringifyJson({
            ...parseJson<Record<string, unknown>>(asset.metadata, {}),
            sourceType: "brand-import",
            contentHash: media.contentHash,
            canonicalLogo: true,
            creativeContext: {
              sourceId: detail.item.sourceId,
              itemId,
              itemVersionId,
              mediaId,
              dedupeKey,
            },
          }),
          updatedAt: nowIso(),
        })
        .where(eq(schema.assets.id, asset.id));
      await getDb()
        .update(schema.assetLibraries)
        .set({ canonicalLogoAssetId: asset.id, updatedAt: nowIso() })
        .where(eq(schema.assetLibraries.id, asset.libraryId));
    },
  },
};

registerOnboardingStep({
  id: "creative-context-library",
  order: 18,
  required: false,
  title: "Connect your creative library",
  description:
    "Connect prior work and reference sources so agents can reuse approved creative context.",
  methods: [
    {
      id: "library",
      kind: "link",
      primary: true,
      label: "Open Library",
      payload: { url: "/agent#library", external: false },
    },
  ],
  isComplete: async () => {
    try {
      const result = await listContextSources({ limit: 1 });
      return result.sources.length > 0;
    } catch {
      return false;
    }
  },
});

registerNativeResourceCaptureAdapter(nativeAssetCreativeContextAdapter);

export default setupCreativeContext({ appId: "assets", projections });
