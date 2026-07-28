import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs

const MAX_CONTEXT_CHARS = 12_000;
const MAX_EXEMPLAR_SLIDES = 3;
const MAX_SLIDE_HTML_CHARS = 2_500;
const MAX_TEXT_PREVIEW_CHARS = 90;

interface ReferenceSlide {
  id?: string;
  content?: string;
  notes?: string;
  layout?: string;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars).trimEnd()}\n[truncated]`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#x?[0-9a-f]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * First slide plus the first occurrence of each additional layout. A deck's
 * typographic idiom repeats per layout, so one sample of each teaches more
 * markup per token than the first N slides in order.
 */
export function pickExemplarSlides(
  slides: ReferenceSlide[],
  limit = MAX_EXEMPLAR_SLIDES,
): Array<{ slide: ReferenceSlide; slideNumber: number }> {
  const picked: Array<{ slide: ReferenceSlide; slideNumber: number }> = [];
  const seenLayouts = new Set<string>();
  for (const [index, slide] of slides.entries()) {
    if (picked.length >= limit) break;
    const layout = slide.layout ?? "unknown";
    if (index !== 0 && seenLayouts.has(layout)) continue;
    seenLayouts.add(layout);
    picked.push({ slide, slideNumber: index + 1 });
  }
  return picked;
}

export function buildReferenceDeckContext({
  id,
  title,
  aspectRatio,
  designSystemId,
  slides,
}: {
  id: string;
  title: string;
  aspectRatio: string | null;
  designSystemId: string | null;
  slides: ReferenceSlide[];
}): string {
  const lines: string[] = [
    "## Reference Deck",
    `The user picked "${title}" (deck id: ${id}) as the reference deck for this generation.`,
    "Imitate its structure and styling — slide progression, layout choices, heading/subheading hierarchy, type scale, spacing, and markup idiom.",
    "Do NOT copy its subject matter, wording, or data. The new deck's content comes from the user's request only.",
    "",
    `Slide count: ${slides.length}`,
    `Aspect ratio: ${aspectRatio ?? "16:9 (default)"}`,
    designSystemId
      ? `Linked design system id: ${designSystemId}`
      : "No design system linked to the reference deck.",
  ];

  if (slides.length > 0) {
    lines.push("", "Slide progression:");
    for (const [index, slide] of slides.entries()) {
      const preview = stripHtml(slide.content ?? "").slice(
        0,
        MAX_TEXT_PREVIEW_CHARS,
      );
      lines.push(
        `${index + 1}. [${slide.layout ?? "unknown"}] ${preview || "(no text)"}`,
      );
    }
  }

  const exemplars = pickExemplarSlides(slides);
  if (exemplars.length > 0) {
    lines.push(
      "",
      "Exemplar slide markup — match this HTML structure, class usage, and inline style conventions:",
    );
    for (const { slide, slideNumber } of exemplars) {
      lines.push(
        "",
        `### Slide ${slideNumber} — layout: ${slide.layout ?? "unknown"}`,
        "```html",
        truncate(slide.content ?? "", MAX_SLIDE_HTML_CHARS),
        "```",
      );
    }
  }

  lines.push(
    "",
    `Only a sample of the reference deck is included above. Call \`get-deck --id ${id}\` for any other slide's full HTML when you hit a layout the exemplars do not cover.`,
  );

  return truncate(lines.join("\n"), MAX_CONTEXT_CHARS);
}

export default defineAction({
  description:
    "Get a compact style/structure briefing for an existing deck so a new deck can be generated in its image. " +
    "Returns the slide progression, layouts, and exemplar slide HTML as `agentContext`. " +
    "Use `get-deck` when you need a specific slide's full content instead.",
  schema: z.object({
    id: z.string().describe("Deck ID to use as the reference"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ id }) => {
    const access = await resolveAccess("deck", id);
    if (!access) {
      throw Object.assign(new Error("Deck not found"), { statusCode: 404 });
    }

    const row = access.resource;
    const data = JSON.parse(row.data);
    const slides: ReferenceSlide[] = Array.isArray(data?.slides)
      ? data.slides
      : [];
    const title = row.title || data?.title || "Untitled Deck";

    return {
      id: row.id,
      title,
      slideCount: slides.length,
      aspectRatio: data?.aspectRatio ?? null,
      designSystemId: row.designSystemId ?? null,
      agentContext: buildReferenceDeckContext({
        id: row.id,
        title,
        aspectRatio: data?.aspectRatio ?? null,
        designSystemId: row.designSystemId ?? null,
        slides,
      }),
    };
  },
});
