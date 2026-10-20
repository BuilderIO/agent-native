import { z } from "zod";

import { markdown } from "../schema-form/introspect.js";
import type { BlockMdxConfig } from "../types.js";

export type CalloutTone = "info" | "decision" | "risk" | "warning" | "success";

export interface CalloutData {
  tone?: CalloutTone;
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
  body: markdown(z.string().trim().min(1).max(10_000)) as z.ZodType<string>,
}) as unknown as z.ZodType<CalloutData>;

export const calloutMdx: BlockMdxConfig<CalloutData> = {
  tag: "Callout",
  childrenField: "body",
  toAttrs: (data) => ({ tone: data.tone }),
  fromAttrs: (attrs, children) => ({
    tone: attrs.string("tone") as CalloutTone | undefined,
    body: children,
  }),
};
