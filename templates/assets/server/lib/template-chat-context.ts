import type { AgentChatReference } from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import { and, inArray } from "drizzle-orm";

import { accessibleTemplateFilter } from "../../actions/_template-access.js";
import type { StyleBrief } from "../../shared/api.js";
import { getDb, schema } from "../db/index.js";
import { parseJson } from "./json.js";
import { normalizePresetReferences } from "./preset-references.js";

const TEMPLATE_REF_TYPES = new Set(["template", "preset"]);

type TemplateRow = typeof schema.assetTemplates.$inferSelect;
type LibraryRow = typeof schema.assetLibraries.$inferSelect;

/**
 * When a user tags one or more templates (or a legacy `@preset` mention),
 * embed each template's aesthetics and creative philosophy into the model-facing
 * message so the agent internalizes the brief before it generates. The user's
 * visible message is untouched — only the message the model reads is augmented.
 */
export async function prepareTemplateChatContext(args: {
  message: string;
  references: AgentChatReference[];
}): Promise<{ message?: string } | void> {
  const templateIds = Array.from(
    new Set(
      (args.references ?? [])
        .filter((ref) => TEMPLATE_REF_TYPES.has(ref.refType ?? "") && ref.refId)
        .map((ref) => ref.refId as string),
    ),
  );
  if (!templateIds.length) return;

  const db = getDb();
  const templateAccess = await accessibleTemplateFilter();
  const templates = (await db
    .select()
    .from(schema.assetTemplates)
    .where(
      and(inArray(schema.assetTemplates.id, templateIds), templateAccess),
    )) as TemplateRow[];
  if (!templates.length) return;

  const libraryIds = Array.from(
    new Set(
      templates
        .map((template) => template.libraryId)
        .filter((libraryId): libraryId is string => Boolean(libraryId)),
    ),
  );
  const libraries = libraryIds.length
    ? ((await db
        .select()
        .from(schema.assetLibraries)
        .where(
          and(
            inArray(schema.assetLibraries.id, libraryIds),
            accessFilter(schema.assetLibraries, schema.assetLibraryShares),
          ),
        )) as LibraryRow[])
    : [];
  const libraryById = new Map(
    libraries.map((library) => [library.id, library]),
  );

  const blocks = templates.map((template) =>
    describeTemplate(template, libraryById.get(template.libraryId ?? "")),
  );

  const context = [
    "<tagged-templates>",
    "The user tagged the template(s) below. Before generating anything, study each template's aesthetics and creative philosophy and let it drive your composition, mood, lighting, styling, and subject choices. Treat the template as the creative brief, not just a set of output dimensions.",
    "",
    blocks.join("\n\n"),
    "",
    "When you call generate-image or generate-image-batch, pass the matching templateId so its saved format, model, tier, logo setting, and prompt template apply automatically — do not restate aspect ratio, size, model, or tier as ad-hoc args. Keep your own prompt focused on the specific subject the user asked for, expressed through the template's philosophy above.",
    "</tagged-templates>",
  ].join("\n");

  return { message: `${args.message}\n\n${context}` };
}

function describeTemplate(template: TemplateRow, library?: LibraryRow): string {
  const settings = parseJson<{
    tier?: string;
    includeLogo?: boolean;
    presetReferences?: unknown;
  }>(template.settings, {});
  const presetReferences = normalizePresetReferences(settings.presetReferences);
  const style = library
    ? parseJson<StyleBrief>(library.styleBrief, {})
    : ({} as StyleBrief);

  const lines = [
    `Template "${template.title}" (id: ${template.id})`,
    library ? `- Brand kit: ${library.title}` : "",
    template.description ? `- Intent: ${template.description}` : "",
    template.category ? `- Deliverable type: ${template.category}` : "",
    template.promptTemplate
      ? `- Prompt philosophy / template: ${template.promptTemplate}`
      : "",
    template.textPolicy ? `- Text policy: ${template.textPolicy}` : "",
    `- Output: ${template.aspectRatio}, ${template.imageSize}, model ${template.model}${
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
