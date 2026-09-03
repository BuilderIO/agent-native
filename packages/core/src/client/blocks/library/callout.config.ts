import { z } from "zod";

import { markdown } from "../schema-form/introspect.js";
import type { BlockMdxConfig } from "../types.js";

/**
 * Pure (React-free) part of the shared `callout` block: its data schema and MDX
 * round-trip config. Lives in core so BOTH apps' server/shared registries
 * (`plan-block-registry.ts`, `nfm-registry.ts`) and the client spec
 * (`callout.tsx`) consume one definition. Keeping it React-free means importing
 * it into a server module never pulls React into the Nitro/SSR bundle.
 *
 * The MDX `tag` + attribute/children shape MUST match the legacy
 * `<Callout tone>…body…</Callout>` encoding so stored `.mdx` round-trips
 * byte-compatibly (the block originated in the plan template before moving here).
 */

export type CalloutTone = "info" | "decision" | "risk" | "warning" | "success";

export interface CalloutData {
  tone?: CalloutTone;
  /** Markdown body. Tagged `markdown()` so the auto-editor edits it inline. */
  body: string;
}

export const CALLOUT_TONES: CalloutTone[] = [
  "info",
  "decision",
  "risk",
  "warning",
  "success",
];

export const calloutSchema = z.object({
  tone: z
    .enum(["info", "decision", "risk", "warning", "success"])
    .optional() as z.ZodType<CalloutTone | undefined>,
  // `markdown()` tags the field so `SchemaBlockEditor` renders it with the
  // shared rich-markdown editor (inline, Notion-style) instead of a textarea.
  body: markdown(z.string().trim().min(1).max(10_000)) as z.ZodType<string>,
}) as unknown as z.ZodType<CalloutData>;

/**
 * MDX config: `tone` is an attribute, `body` is MDX children — exactly the
 * legacy `<Callout id … tone>\n\n{body}\n\n</Callout>` form. `toAttrs` returns
 * only `tone` (body is `childrenField`, excluded from attributes); `fromAttrs`
 * reads `tone` and uses the stringified prose children as `body`.
 */
export const calloutMdx: BlockMdxConfig<CalloutData> = {
  tag: "Callout",
  childrenField: "body",
  toAttrs: (data) => ({ tone: data.tone }),
  fromAttrs: (attrs, children) => ({
    tone: attrs.string("tone") as CalloutTone | undefined,
    body: children,
  }),
};
