import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { DEFAULT_GENERATION_PRESET_SEEDS } from "../../shared/generation-presets.js";
import { schema } from "../db/index.js";
import { stringifyJson } from "./json.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InsertDb = any;

export async function ensureDefaultTemplates({
  db,
  ownerEmail,
  orgId,
  now,
}: {
  db: InsertDb;
  ownerEmail: string;
  orgId: string | null | undefined;
  now: string;
}) {
  const existing = await db
    .select({ settings: schema.assetTemplates.settings })
    .from(schema.assetTemplates)
    .where(
      and(
        eq(schema.assetTemplates.ownerEmail, ownerEmail),
        orgId
          ? eq(schema.assetTemplates.orgId, orgId)
          : isNull(schema.assetTemplates.orgId),
      ),
    );
  const existingSeedIds = new Set(
    existing.flatMap((row: { settings?: string | null }) => {
      const settings = JSON.parse(row.settings ?? "{}") as { seedId?: unknown };
      return typeof settings.seedId === "string" ? [settings.seedId] : [];
    }),
  );
  let sortOrder = 0;
  for (const preset of DEFAULT_GENERATION_PRESET_SEEDS) {
    if (existingSeedIds.has(preset.seedId)) continue;
    await db.insert(schema.assetTemplates).values({
      id: nanoid(),
      libraryId: null,
      collectionId: null,
      title: preset.title,
      description: preset.description,
      category: preset.category,
      mediaType: "image",
      promptTemplate: preset.promptTemplate,
      aspectRatio: preset.aspectRatio,
      imageSize: preset.imageSize,
      model: preset.model,
      textPolicy: preset.textPolicy,
      referencePolicy: preset.referencePolicy,
      settings: stringifyJson({
        ...preset.settings,
        seedId: preset.seedId,
        source: "default-generation-preset",
      }),
      sortOrder,
      ownerEmail,
      orgId: orgId ?? null,
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    sortOrder += 10;
  }
}

export function applyPromptTemplate(
  template: string | null | undefined,
  prompt: string,
) {
  const trimmed = prompt.trim();
  const source = template?.trim();
  if (!source) return trimmed;
  if (source.includes("{{prompt}}") || source.includes("{{topic}}")) {
    return source
      .split("{{prompt}}")
      .join(trimmed)
      .split("{{topic}}")
      .join(trimmed);
  }
  return `${source}\n\nUser request:\n${trimmed}`;
}
