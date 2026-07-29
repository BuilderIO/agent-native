import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs

const MAX_CONTEXT_CHARS = 14_000;
const MAX_PATTERNS = 6;
const MAX_SLIDE_HTML_CHARS = 2_000;

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

export function pickLayoutPatterns(
  slides: ReferenceSlide[],
  limit = MAX_PATTERNS,
): Array<{ layout: string; slide: ReferenceSlide }> {
  const patterns: Array<{ layout: string; slide: ReferenceSlide }> = [];
  const seenLayouts = new Set<string>();
  for (const slide of slides) {
    if (patterns.length >= limit) break;
    const layout = slide.layout ?? "unknown";
    if (seenLayouts.has(layout)) continue;
    seenLayouts.add(layout);
    patterns.push({ layout, slide });
  }
  return patterns;
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
    "## Reference Deck — Visual Language",
    `The user picked "${title}" (deck id: ${id}) as a style reference.`,
    "",
    "This is a pattern library, NOT an outline. It shows how this deck's visual language renders a kind of content — how a heading is set, how supporting text sits under it, how a split or a callout is balanced.",
    "",
    "How to use it:",
    "- Plan the new deck from the user's request first. Decide the story, the slide count, and the order before you look at these patterns.",
    "- Then, for each slide you have decided to write, reach for the pattern that fits that content. Skip patterns that fit nothing.",
    "- Use a pattern once, many times, or not at all. Frequency and sequence come from the new content, never from the reference.",
    "- Do not reproduce the reference deck's slide order, slide count, or section structure.",
    "- When no pattern fits, compose a new slide from the same type scale, spacing, color, and markup conventions instead of forcing content into the nearest pattern.",
    "- Take no wording, data, imagery, or subject matter from the reference deck.",
    "",
    `Aspect ratio: ${aspectRatio ?? "16:9 (default)"}`,
    designSystemId
      ? `Linked design system id: ${designSystemId}`
      : "No design system linked to the reference deck.",
  ];

  const patterns = pickLayoutPatterns(slides);
  if (patterns.length > 0) {
    lines.push(
      "",
      "### Patterns",
      "Each block below is one worked example of a layout. Match its HTML structure, class usage, and inline style conventions; replace every word of its content.",
    );
    for (const { layout, slide } of patterns) {
      lines.push(
        "",
        `#### Pattern: ${layout}`,
        "```html",
        truncate(slide.content ?? "", MAX_SLIDE_HTML_CHARS),
        "```",
      );
    }
  }

  lines.push(
    "",
    `These are samples, not the full deck. Call \`get-deck --id ${id}\` if you need to see how this deck handles a case the patterns above do not cover.`,
  );

  return truncate(lines.join("\n"), MAX_CONTEXT_CHARS);
}

export default defineAction({
  description:
    "Get an existing deck's visual language as a reusable pattern library so a new deck can be written in the same style. " +
    "Returns one worked HTML example per layout as `agentContext`, deliberately without the deck's slide order — the new deck's structure comes from its own content. " +
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
