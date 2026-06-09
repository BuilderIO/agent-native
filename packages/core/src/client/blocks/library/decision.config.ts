import { z } from "zod";
import type { BlockMdxConfig } from "../types.js";

/**
 * Pure (React-free) part of the shared `decision` block: its data schema and MDX
 * round-trip config. Lives in core so BOTH apps' server/shared registries and
 * the client spec (`decision.tsx`) consume one definition. Keeping it React-free
 * means importing it into a server module never pulls React into the Nitro/SSR
 * bundle.
 *
 * The MDX `tag` + `question`/`options` attribute shape MUST match the legacy
 * `<Decision question options />` encoding so stored `.mdx` round-trips
 * byte-compatibly (the block originated in the plan template before moving here).
 */

export interface DecisionOption {
  id: string;
  label: string;
  detail?: string;
  /**
   * Authored recommendation only. A reviewer's actual selection does NOT live
   * here — responses belong in comments / events, never in the canonical
   * document body.
   */
  recommended?: boolean;
}

export interface DecisionData {
  question: string;
  options: DecisionOption[];
}

const decisionIdSchema = z.string().trim().min(1).max(120);

export const decisionSchema = z.object({
  question: z.string().trim().min(1).max(500),
  options: z
    .array(
      z.object({
        id: decisionIdSchema,
        label: z.string().trim().min(1).max(200),
        detail: z.string().trim().max(800).optional(),
        recommended: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(20),
}) as unknown as z.ZodType<DecisionData>;

/**
 * MDX config: `question` and `options` are both attributes — exactly the legacy
 * `<Decision question options />` form. `toAttrs` writes them in their historical
 * order; `fromAttrs` tolerates missing attributes with the same `?? "Decision"` /
 * `?? []` defaults the plan template used.
 */
export const decisionMdx: BlockMdxConfig<DecisionData> = {
  tag: "Decision",
  toAttrs: (data) => ({
    question: data.question,
    options: data.options,
  }),
  fromAttrs: (attrs) => ({
    question: attrs.string("question") ?? "Decision",
    options: attrs.array<DecisionOption>("options") ?? [],
  }),
};
