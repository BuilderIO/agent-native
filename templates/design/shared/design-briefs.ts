import { composerWebsiteUrlSchema } from "@agent-native/core/shared";
import { z } from "zod";

/**
 * A Content page a design was started from, kept in `designs.data.briefs`.
 * Only the page's id and link are stored: the design can be shared more widely
 * than the page, so its title is read per viewer, under their Content access.
 */
export const designBriefSchema = z.object({
  source: z.literal("content"),
  id: z.string().trim().min(1).max(200),
  url: composerWebsiteUrlSchema,
});
export const DESIGN_BRIEF_LIMIT = 5;
export const designBriefsSchema = z
  .array(designBriefSchema)
  .max(DESIGN_BRIEF_LIMIT);

export type DesignBrief = z.infer<typeof designBriefSchema>;

/**
 * The first valid briefs in serialized or parsed design data, up to the limit;
 * drops anything else. The editor reads each one from Content, so stored data
 * never asks for more pages than a create could record.
 */
export function designBriefsFromData(data: unknown): DesignBrief[] {
  let parsed = data;
  if (typeof data === "string") {
    try {
      parsed = JSON.parse(data);
      // coercion-ok: unreadable design data names no brief; the file menu only omits its "Built from" links.
    } catch {
      return [];
    }
  }
  const briefs = (parsed as { briefs?: unknown } | null | undefined)?.briefs;
  if (!Array.isArray(briefs)) return [];
  return briefs
    .flatMap((brief) => {
      const result = designBriefSchema.safeParse(brief);
      return result.success ? [result.data] : [];
    })
    .slice(0, DESIGN_BRIEF_LIMIT);
}
