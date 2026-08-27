import { callAction } from "@agent-native/core/client/hooks";
import type { CreativeContextApplicationState } from "@agent-native/creative-context/client";

import {
  loadCreativeContextPrecedent,
  type CreativeContextPrecedent,
} from "./creative-context-precedent";

/**
 * The five topics `designIntakeQuestionDirectives` has always asked about, as
 * prose. Formalized here so a topic can be individually covered/skipped
 * instead of the previous all-or-nothing `shouldSkipQuestions` boolean.
 */
export const INTAKE_QUESTION_TOPICS = [
  "formFactor",
  "aesthetic",
  "features",
  "interactions",
  "variants",
] as const;

export type IntakeQuestionTopic = (typeof INTAKE_QUESTION_TOPICS)[number];

export const INTAKE_QUESTION_TOPIC_LABELS: Record<IntakeQuestionTopic, string> =
  {
    formFactor: "form factor",
    aesthetic: "aesthetic direction",
    features: "important features/content",
    interactions: "special interactions/polish",
    variants: "whether to explore variations",
  };

export type IntakeTopicCoverage = Record<IntakeQuestionTopic, boolean>;

const NO_COVERAGE: IntakeTopicCoverage = {
  formFactor: false,
  aesthetic: false,
  features: false,
  interactions: false,
  variants: false,
};

interface BrandDnaLike {
  visual?: Record<string, unknown> | null;
  voice?: Record<string, unknown> | null;
}

function hasContent(value: Record<string, unknown> | null | undefined) {
  return Boolean(value) && Object.keys(value as object).length > 0;
}

/**
 * A text-only member (a doc, a spec) has no bearing on what this design
 * should look or behave like; only a governed design snapshot does. Gating
 * on `designResourceId` (not merely "some active membership exists") is what
 * stops an irrelevant context member from suppressing every question.
 */
function hasDesignRelevantPrecedent(precedent: CreativeContextPrecedent) {
  return (
    precedent.status === "strong" &&
    precedent.matches.some((match) => Boolean(match.designResourceId))
  );
}

/**
 * A design-relevant precedent is a complete prior artifact: it answers every
 * intake topic the same way `designPrecedentDirectives` already treats it
 * (clone and adapt, don't re-ask). Brand DNA is narrower - it only carries
 * palette/typography/voice, so it answers the aesthetic topic and nothing
 * about form factor, feature scope, interactions, or whether to explore
 * variants (those are product-shape decisions brand identity can't answer).
 */
export function computeIntakeTopicCoverage(input: {
  precedent: CreativeContextPrecedent;
  brandDna: BrandDnaLike | null;
}): IntakeTopicCoverage {
  const designPrecedent = hasDesignRelevantPrecedent(input.precedent);
  const brandCoversAesthetic =
    hasContent(input.brandDna?.visual) || hasContent(input.brandDna?.voice);
  return {
    formFactor: designPrecedent,
    aesthetic: designPrecedent || brandCoversAesthetic,
    features: designPrecedent,
    interactions: designPrecedent,
    variants: designPrecedent,
  };
}

export function coveredIntakeTopics(
  coverage: IntakeTopicCoverage,
): IntakeQuestionTopic[] {
  return INTAKE_QUESTION_TOPICS.filter((topic) => coverage[topic]);
}

export function uncoveredIntakeTopics(
  coverage: IntakeTopicCoverage,
): IntakeQuestionTopic[] {
  return INTAKE_QUESTION_TOPICS.filter((topic) => !coverage[topic]);
}

export function allIntakeTopicsCovered(coverage: IntakeTopicCoverage) {
  return INTAKE_QUESTION_TOPICS.every((topic) => coverage[topic]);
}

interface ListCreativeContextsResult {
  contexts?: { id: string; kind: string }[];
}

async function resolveDefaultContextId(): Promise<string | null> {
  const result = (await callAction(
    "list-creative-contexts",
    { limit: 50 },
    { method: "GET" },
  )) as ListCreativeContextsResult | undefined;
  return (
    result?.contexts?.find((context) => context.kind === "default")?.id ?? null
  );
}

interface GetBrandProfileResult {
  dna?: { status?: string; payload?: BrandDnaLike | null } | null;
}

async function loadPublishedBrandDna(): Promise<BrandDnaLike | null> {
  try {
    const result = (await callAction(
      "get-brand-profile",
      {},
      { method: "GET" },
    )) as GetBrandProfileResult | undefined;
    if (result?.dna?.status !== "published") return null;
    return result.dna.payload ?? null;
  } catch {
    // coercion-ok: Brand DNA is a supplementary signal on top of Creative
    // Context; the "unavailable" state that must stay distinguishable from
    // "absent" is the precedent lookup's, not this optional one, so a
    // failure here degrades to "no brand signal" rather than propagating.
    return null;
  }
}

export interface IntakeContextResult {
  coverage: IntakeTopicCoverage;
  precedent: CreativeContextPrecedent;
  contextId: string | null;
  /**
   * True only when the lookup itself failed (context service down, network
   * error) - distinct from `coverage` being all-false because no context
   * exists. Callers must surface this rather than silently running the full
   * questionnaire as if nothing had ever been saved.
   */
  unavailable: boolean;
  unavailableReason?: string;
}

const OFF_RESULT: IntakeContextResult = {
  coverage: NO_COVERAGE,
  precedent: { status: "none" },
  contextId: null,
  unavailable: false,
};

/**
 * Loads the real per-topic Creative Context coverage for the intake-question
 * decision, run before questions are asked rather than the too-late
 * generation-time lookup. When nothing was explicitly picked, this falls
 * back to the Default context - `loadCreativeContextPrecedent(null)` alone
 * never looks anything up, which left every unpicked-but-configured Default
 * context invisible to this decision.
 */
export async function loadIntakeContext(
  state: Pick<
    CreativeContextApplicationState,
    "contextMode" | "selectedContextId"
  >,
): Promise<IntakeContextResult> {
  if (state.contextMode === "off") return OFF_RESULT;

  const explicit = state.selectedContextId?.trim() || null;
  let precedent: CreativeContextPrecedent;
  if (explicit) {
    precedent = await loadCreativeContextPrecedent(explicit);
  } else {
    try {
      const defaultContextId = await resolveDefaultContextId();
      precedent = await loadCreativeContextPrecedent(defaultContextId);
    } catch (error) {
      precedent = {
        status: "unavailable",
        contextId: "unresolved-default-context",
        reason:
          error instanceof Error
            ? error.message
            : "unknown context lookup failure",
      };
    }
  }

  const brandDna = await loadPublishedBrandDna();
  return {
    coverage: computeIntakeTopicCoverage({ precedent, brandDna }),
    precedent,
    contextId:
      precedent.status === "none" ? null : (precedent.contextId ?? null),
    unavailable: precedent.status === "unavailable",
    unavailableReason:
      precedent.status === "unavailable" ? precedent.reason : undefined,
  };
}
