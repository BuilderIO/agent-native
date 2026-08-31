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
 * A design-relevant precedent answers every intake topic the same way
 * `designPrecedentDirectives` already treats it (clone and adapt, don't
 * re-ask) - but only when the user explicitly picked that context.
 * `loadCreativeContextPrecedent`'s own contract is "nothing here guesses at
 * a context the user did not choose"; a Default-context fallback is exactly
 * that kind of guess; the Default context can hold any number of unrelated
 * approved designs, and treating one as this request's precedent risks
 * having the agent clone the wrong prior work. So an unpicked (Default)
 * match never covers a topic on its own - only published Brand DNA
 * (palette/voice, not a whole prior artifact) is safe to apply implicitly.
 */
export function computeIntakeTopicCoverage(input: {
  precedent: CreativeContextPrecedent;
  precedentExplicitlyPicked: boolean;
  brandDna: BrandDnaLike | null;
}): IntakeTopicCoverage {
  const designPrecedent =
    input.precedentExplicitlyPicked &&
    hasDesignRelevantPrecedent(input.precedent);
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

interface CreativeContextListEntry {
  id: string;
  kind: string;
  brandProfileId?: string | null;
}

interface ListCreativeContextsResult {
  contexts?: CreativeContextListEntry[];
}

interface ContextsListLookup {
  contexts: CreativeContextListEntry[] | null;
  error: string | null;
}

/**
 * Single list call backing both the Default-context fallback and resolving
 * which brand profile a context is actually linked to - a context's own
 * `brandProfileId`, not "whichever profile the account most recently
 * touched" (see `computeIntakeTopicCoverage`'s companion fix below).
 */
async function loadContextsList(): Promise<ContextsListLookup> {
  try {
    const result = (await callAction(
      "list-creative-contexts",
      { limit: 50 },
      { method: "GET" },
    )) as ListCreativeContextsResult | undefined;
    return { contexts: result?.contexts ?? [], error: null };
  } catch (error) {
    return {
      contexts: null,
      error:
        error instanceof Error
          ? error.message
          : "unknown context lookup failure",
    };
  }
}

interface GetBrandProfileResult {
  dna?: { status?: string; payload?: BrandDnaLike | null } | null;
}

interface BrandDnaLookup {
  status: "ok" | "unavailable";
  dna: BrandDnaLike | null;
  reason?: string;
}

/**
 * `profileId` scopes this to the brand profile the resolved context is
 * actually linked to; omitting it falls back to "the account's most
 * recently updated profile", which can be a different brand entirely when
 * more than one profile exists.
 */
async function loadPublishedBrandDna(
  profileId: string | null,
): Promise<BrandDnaLookup> {
  try {
    const result = (await callAction(
      "get-brand-profile",
      profileId ? { profileId } : {},
      { method: "GET" },
    )) as GetBrandProfileResult | undefined;
    if (result?.dna?.status !== "published") return { status: "ok", dna: null };
    return { status: "ok", dna: result.dna.payload ?? null };
  } catch (error) {
    return {
      status: "unavailable",
      dna: null,
      reason:
        error instanceof Error
          ? error.message
          : "unknown brand profile lookup failure",
    };
  }
}

export interface IntakeContextResult {
  coverage: IntakeTopicCoverage;
  precedent: CreativeContextPrecedent;
  contextId: string | null;
  /** True only when the context was explicitly selected by the user, not auto-resolved to Default. */
  explicitContext: boolean;
  /**
   * True only when a lookup itself failed (context service down, network
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
  explicitContext: false,
  unavailable: false,
};

/**
 * Loads the real per-topic Creative Context coverage for the intake-question
 * decision, run before questions are asked rather than the too-late
 * generation-time lookup. When nothing was explicitly picked, this falls
 * back to the Default context for Brand DNA purposes only -
 * `loadCreativeContextPrecedent(null)` alone never looks anything up, which
 * left every unpicked-but-configured Default context invisible to this
 * decision - but never treats a Default-context design as an explicit
 * precedent (see `computeIntakeTopicCoverage`).
 */
export async function loadIntakeContext(
  state: Pick<
    CreativeContextApplicationState,
    "contextMode" | "selectedContextId" | "pinnedPackId"
  >,
): Promise<IntakeContextResult> {
  if (state.contextMode === "off") return OFF_RESULT;

  // A pinned pack outranks `selectedContextId` in the real retrieval ladder
  // (see the creative-context skill), but a pack's members carry only
  // itemId/itemVersionId - not the kind/artifactKey membership data this
  // preflight needs to tell a design snapshot from a text reference apart.
  // Falling through to Default context here would silently substitute a
  // different, unpinned context; abstaining and asking the full question
  // set is the safer failure mode than guessing wrong.
  if (state.pinnedPackId) {
    return {
      coverage: NO_COVERAGE,
      precedent: { status: "none" },
      contextId: null,
      explicitContext: false,
      unavailable: false,
    };
  }

  const explicitContextId = state.selectedContextId?.trim() || null;
  const { contexts, error: listError } = await loadContextsList();

  let targetContextId = explicitContextId;
  let precedent: CreativeContextPrecedent;
  if (explicitContextId) {
    precedent = await loadCreativeContextPrecedent(explicitContextId);
  } else if (listError) {
    precedent = {
      status: "unavailable",
      contextId: "unresolved-default-context",
      reason: listError,
    };
  } else {
    targetContextId =
      contexts?.find((context) => context.kind === "default")?.id ?? null;
    precedent = await loadCreativeContextPrecedent(targetContextId);
  }

  const targetContext =
    contexts?.find((context) => context.id === targetContextId) ?? null;
  const brandDnaLookup = await loadPublishedBrandDna(
    targetContext?.brandProfileId ?? null,
  );

  const unavailable =
    precedent.status === "unavailable" ||
    brandDnaLookup.status === "unavailable";
  return {
    coverage: computeIntakeTopicCoverage({
      precedent,
      precedentExplicitlyPicked: Boolean(explicitContextId),
      brandDna: brandDnaLookup.dna,
    }),
    precedent,
    contextId:
      precedent.status === "none" ? null : (precedent.contextId ?? null),
    explicitContext: Boolean(explicitContextId),
    unavailable,
    unavailableReason:
      precedent.status === "unavailable"
        ? precedent.reason
        : brandDnaLookup.reason,
  };
}

/**
 * Wraps `loadIntakeContext` around a fallible app-state read. A rejected
 * `readCreativeContextState()` must not throw out of the caller's submit
 * flow (it would abort generation entirely on a transient state-read
 * failure); it degrades to the same explicit "unavailable" result a failed
 * Creative Context lookup produces.
 */
export async function loadIntakeContextFromAppState(
  readState: () => Promise<
    Pick<
      CreativeContextApplicationState,
      "contextMode" | "selectedContextId" | "pinnedPackId"
    >
  >,
): Promise<IntakeContextResult> {
  let state;
  try {
    state = await readState();
  } catch (error) {
    return {
      coverage: NO_COVERAGE,
      precedent: {
        status: "unavailable",
        contextId: "unresolved-context-state",
        reason:
          error instanceof Error
            ? error.message
            : "unknown context state read failure",
      },
      contextId: null,
      explicitContext: false,
      unavailable: true,
      unavailableReason:
        error instanceof Error
          ? error.message
          : "unknown context state read failure",
    };
  }
  return loadIntakeContext(state);
}
