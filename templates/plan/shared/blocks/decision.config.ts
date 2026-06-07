import type { BlockMdxConfig } from "@agent-native/core/blocks/server";
import { decisionDataSchema, type PlanDecisionBlock } from "../plan-content.js";

/**
 * Pure (React-free) part of the decision block. Keeps the historical
 * `<Decision question options />` MDX shape while letting the browser registry
 * provide a direct inline editor for the question and option cards.
 */

export type DecisionData = PlanDecisionBlock["data"];

export const decisionSchema =
  decisionDataSchema as unknown as import("zod").ZodType<DecisionData>;

export const decisionMdx: BlockMdxConfig<DecisionData> = {
  tag: "Decision",
  toAttrs: (data) => ({
    question: data.question,
    options: data.options,
  }),
  fromAttrs: (attrs) => ({
    question: attrs.string("question") ?? "Decision",
    options: attrs.array("options") ?? [],
  }),
};
