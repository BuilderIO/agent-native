import { nanoid } from "nanoid";

import { DEFAULT_GENERATION_PRESET_SEEDS } from "../../shared/generation-presets.js";
import { schema } from "../db/index.js";
import { stringifyJson } from "./json.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InsertDb = {
  insert: (table: any) => {
    values: (value: Record<string, unknown>) => Promise<unknown>;
  };
};

export async function seedDefaultGenerationPresets({
  db,
  libraryId,
  now,
}: {
  db: InsertDb;
  libraryId: string;
  now: string;
}) {
  let sortOrder = 0;
  for (const preset of DEFAULT_GENERATION_PRESET_SEEDS) {
    await db.insert(schema.assetGenerationPresets).values({
      id: nanoid(),
      libraryId,
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
