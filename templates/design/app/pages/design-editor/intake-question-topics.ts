import { callAction } from "@agent-native/core/client/hooks";
import type { CreativeContextApplicationState } from "@agent-native/creative-context/client";

import {
  loadCreativeContextPrecedent,
  type CreativeContextPrecedent,
} from "./creative-context-precedent";

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

function hasDesignRelevantPrecedent(precedent: CreativeContextPrecedent) {
  return (
    precedent.status === "strong" &&
    precedent.matches.some((match) => Boolean(match.designResourceId))
  );
}

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
  explicitContext: boolean;
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

export async function loadIntakeContext(
  state: Pick<
    CreativeContextApplicationState,
    "contextMode" | "selectedContextId" | "pinnedPackId"
  >,
): Promise<IntakeContextResult> {
  if (state.contextMode === "off") return OFF_RESULT;

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

export async function loadIntakeContextFromAppState(
  readState: () => Promise<
    Pick<
      CreativeContextApplicationState,
      "contextMode" | "selectedContextId" | "pinnedPackId"
    >
  >,
  creativeContextEnabled: boolean,
): Promise<IntakeContextResult> {
  if (!creativeContextEnabled) return OFF_RESULT;

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
