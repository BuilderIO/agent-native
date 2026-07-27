import type { AgentChatReference } from "@agent-native/core/server";
import { inArray } from "drizzle-orm";

import type { StyleBrief } from "../../shared/api.js";
import { getDb, schema } from "../db/index.js";
import { parseJson } from "./json.js";
import { normalizePresetReferences } from "./preset-references.js";

const PRESET_REF_TYPE = "preset";

type PresetRow = typeof schema.assetGenerationPresets.$inferSelect;
type LibraryRow = typeof schema.assetLibraries.$inferSelect;

/**
 * When a user tags one or more generation presets with an `@preset` mention,
 * embed each preset's aesthetics and creative philosophy into the model-facing
 * message so the agent internalizes the brief before it generates. The user's
 * visible message is untouched — only the message the model reads is augmented.
 */
export async function preparePresetChatContext(args: {
  message: string;
  references: AgentChatReference[];
}): Promise<{ message?: string } | void> {
  const presetIds = Array.from(
    new Set(
      (args.references ?? [])
        .filter((ref) => ref.refType === PRESET_REF_TYPE && ref.refId)
        .map((ref) => ref.refId as string),
    ),
  );
  if (!presetIds.length) return;

  const db = getDb();
  const presets = (await db
    .select()
    .from(schema.assetGenerationPresets)
    .where(
      inArray(schema.assetGenerationPresets.id, presetIds),
    )) as PresetRow[];
  if (!presets.length) return;

  const libraryIds = Array.from(
    new Set(presets.map((preset) => preset.libraryId)),
  );
  const libraries = (await db
    .select()
    .from(schema.assetLibraries)
    .where(inArray(schema.assetLibraries.id, libraryIds))) as LibraryRow[];
  const libraryById = new Map(
    libraries.map((library) => [library.id, library]),
  );

  const blocks = presets.map((preset) =>
    describePreset(preset, libraryById.get(preset.libraryId)),
  );

  const context = [
    "<tagged-generation-presets>",
    "The user tagged the generation preset(s) below. Before generating anything, study each preset's aesthetics and creative philosophy and let it drive your composition, mood, lighting, styling, and subject choices. Treat the preset as the creative brief, not just a set of output dimensions.",
    "",
    blocks.join("\n\n"),
    "",
    "When you call generate-image or generate-image-batch, pass the matching presetId so its saved format, model, tier, logo setting, and prompt template apply automatically — do not restate aspect ratio, size, model, or tier as ad-hoc args. Keep your own prompt focused on the specific subject the user asked for, expressed through the preset's philosophy above.",
    "</tagged-generation-presets>",
  ].join("\n");

  return { message: `${args.message}\n\n${context}` };
}

function describePreset(preset: PresetRow, library?: LibraryRow): string {
  const settings = parseJson<{
    tier?: string;
    includeLogo?: boolean;
    presetReferences?: unknown;
  }>(preset.settings, {});
  const presetReferences = normalizePresetReferences(settings.presetReferences);
  const style = library
    ? parseJson<StyleBrief>(library.styleBrief, {})
    : ({} as StyleBrief);

  const lines = [
    `Preset "${preset.title}" (id: ${preset.id})`,
    library ? `- Brand kit: ${library.title}` : "",
    preset.description ? `- Intent: ${preset.description}` : "",
    preset.category ? `- Deliverable type: ${preset.category}` : "",
    preset.promptTemplate
      ? `- Prompt philosophy / template: ${preset.promptTemplate}`
      : "",
    preset.textPolicy ? `- Text policy: ${preset.textPolicy}` : "",
    `- Output: ${preset.aspectRatio}, ${preset.imageSize}, model ${preset.model}${
      settings.tier ? `, ${settings.tier} tier` : ""
    }`,
    settings.includeLogo === true
      ? "- Brand logo: the library's canonical logo is composited onto the result; leave a clean upper-right area and do not draw a logo yourself."
      : "",
  ];

  const aesthetics = [
    style.description ? `overall: ${style.description}` : "",
    style.mood ? `mood: ${style.mood}` : "",
    style.palette?.length ? `palette: ${style.palette.join(", ")}` : "",
    style.medium ? `medium: ${style.medium}` : "",
    style.composition ? `composition: ${style.composition}` : "",
    style.lighting ? `lighting: ${style.lighting}` : "",
    style.texture ? `texture: ${style.texture}` : "",
    style.subjectMatter ? `subject matter: ${style.subjectMatter}` : "",
    style.typographyPolicy ? `typography: ${style.typographyPolicy}` : "",
  ].filter(Boolean);
  if (aesthetics.length) {
    lines.push(`- Brand aesthetics: ${aesthetics.join("; ")}.`);
  }
  if (style.doNot?.length) {
    lines.push(`- Avoid: ${style.doNot.join("; ")}.`);
  }
  for (const entry of presetReferences) {
    lines.push(
      `- Reference "${entry.label}" (id: ${entry.id}): role ${entry.role}, ${entry.variable ? "variable" : "fixed"}${entry.required ? ", required" : ""}, ${entry.assetIds.length ? `${entry.assetIds.length} pinned image(s)` : "no images yet"}.${entry.description ? ` ${entry.description}` : ""}`,
    );
  }
  if (presetReferences.some((entry) => entry.variable)) {
    lines.push(
      "- Before generating, collect images for required variable references (from the user's attachments or the library) and pass presetReferenceFills to generate-image / generate-image-batch. Fixed references attach automatically.",
    );
  }
  const customInstructions = library?.customInstructions?.trim();
  if (customInstructions) {
    lines.push(`- Brand custom instructions: ${customInstructions}`);
  }

  return lines.filter(Boolean).join("\n");
}
