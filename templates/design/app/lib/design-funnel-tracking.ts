import {
  DESIGN_GENERATION_ATTEMPT_QUERY_PARAM,
  isDesignGenerationAttemptId,
} from "@shared/generation-provenance";
import { promptLengthBucket } from "@shared/prompt-length-bucket";
import { useEffect, useMemo, useRef } from "react";

import {
  SYSTEM_CONTEXT_KEY,
  TEMPLATE_CONTEXT_KEY,
} from "@/lib/composer-context";
import {
  runWhenTabVisible,
  trackDesignRelay,
} from "@/lib/design-relay-tracking";
import { generationOutputFiles } from "@/lib/pending-generation";

export type DesignPromptSource = "composer" | "suggestion_chip";

export type DesignPromptReferenceType =
  | "template"
  | "design_system"
  | "figma"
  | "url"
  | "design"
  | "slides"
  | "integration"
  | "image"
  | "file";

const HOME_REFERENCE_KEY_PREFIX = "design-home-reference:";
const HOME_REFERENCE_TYPES: Record<string, DesignPromptReferenceType> = {
  design: "design",
  slides: "slides",
  figma: "figma",
  website: "url",
  integration: "integration",
};

export function designPromptReferenceTypes({
  contextItems,
  files,
  templateSelected,
  designSystemId,
}: {
  contextItems?: readonly { key: string }[];
  files?: readonly { type?: string }[];
  templateSelected: boolean;
  designSystemId?: string | null;
}): DesignPromptReferenceType[] {
  const types = new Set<DesignPromptReferenceType>();
  if (templateSelected) types.add("template");
  if (designSystemId) types.add("design_system");
  for (const item of contextItems ?? []) {
    if (item.key === TEMPLATE_CONTEXT_KEY) types.add("template");
    else if (item.key === SYSTEM_CONTEXT_KEY) types.add("design_system");
    else if (item.key.startsWith(HOME_REFERENCE_KEY_PREFIX)) {
      const source = item.key
        .slice(HOME_REFERENCE_KEY_PREFIX.length)
        .split(":", 1)[0];
      const type = source ? HOME_REFERENCE_TYPES[source] : undefined;
      if (type) types.add(type);
    }
  }
  for (const file of files ?? []) {
    types.add(file.type?.startsWith("image/") ? "image" : "file");
  }
  return [...types].sort();
}

export function trackDesignPromptSubmitted({
  outputId,
  source,
  prompt,
  referenceTypes,
  startMode,
}: {
  outputId: string;
  source: DesignPromptSource;
  prompt: string;
  referenceTypes: DesignPromptReferenceType[];
  startMode: string;
}): void {
  trackDesignRelay("design_prompt_submitted", {
    output_id: outputId,
    output_type: "design",
    source,
    has_text: prompt.trim().length > 0,
    prompt_length_bucket: promptLengthBucket(prompt),
    reference_types: referenceTypes,
    reference_count: referenceTypes.length,
    start_mode: startMode,
  });
}

type ReadyViewFile = {
  id: string;
  filename?: string;
  fileType?: string;
  content: string;
  updatedAt?: string | null;
};

function outputFileSignatures(
  files: readonly ReadyViewFile[],
): Map<string, string> {
  return new Map(
    generationOutputFiles(files).map((file) => [
      file.id,
      `${file.updatedAt ?? ""}:${file.content.length}`,
    ]),
  );
}

const sentReadyViewAttempts = new Set<string>();

/** Test-only: forget which generation attempts this page already reported. */
export function resetDesignReadyViewsForTest(): void {
  sentReadyViewAttempts.clear();
}

function readUrlGenerationAttemptId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const ids = new URLSearchParams(window.location.search).getAll(
      DESIGN_GENERATION_ATTEMPT_QUERY_PARAM,
    );
    return ids.length === 1 && isDesignGenerationAttemptId(ids[0])
      ? ids[0]
      : null;
  } catch {
    // coercion-ok: an unreadable URL only means no attempt id to join on.
    return null;
  }
}

/**
 * `design_ready_viewed`: the owner is looking at a finished generation that
 * left at least one renderable screen.
 *
 * A generation is one span of `generationActive` (a pending home-prompt
 * generation or an editor-tracked agent run). It counts as finished when that
 * span ends without a user stop and changed the design's output files; a span
 * that wrote nothing, or ended in a stop, is not a ready view. A page opened
 * from a `generate-design` link carries that run's attempt id and reports it
 * once when it loads already finished.
 */
export function useDesignReadyViewTracking({
  designId,
  isOwner,
  designLoaded,
  generationActive,
  files,
  stopCountRef,
}: {
  designId: string | undefined;
  isOwner: boolean;
  designLoaded: boolean;
  generationActive: boolean;
  files: readonly ReadyViewFile[];
  /** Incremented whenever the user stops a generation. */
  stopCountRef: { readonly current: number };
}): void {
  // The editor stays mounted across in-app navigation, so the attempt id is
  // read for each design rather than once: an id from one design's link must
  // never be reported against the next design opened in the same page.
  const urlAttemptId = useMemo(
    () => (designId ? readUrlGenerationAttemptId() : null),
    [designId],
  );
  const episodeRef = useRef<{
    designId: string;
    baseline: Map<string, string>;
    stopCount: number;
  } | null>(null);
  const cancelPendingRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      cancelPendingRef.current?.();
      cancelPendingRef.current = null;
    },
    [designId],
  );

  useEffect(() => {
    try {
      if (!designId || !designLoaded) return;
      const episode =
        episodeRef.current?.designId === designId ? episodeRef.current : null;
      if (generationActive) {
        if (!episode) {
          episodeRef.current = {
            designId,
            baseline: outputFileSignatures(files),
            stopCount: stopCountRef.current,
          };
        }
        return;
      }

      // A URL attempt id names the run that produced the design the page
      // opened on. It is consumed by its first report, so later in-page
      // generations are not attributed to it.
      const generationAttemptId =
        urlAttemptId && !sentReadyViewAttempts.has(urlAttemptId)
          ? urlAttemptId
          : null;
      if (episode) {
        episodeRef.current = null;
        if (episode.stopCount !== stopCountRef.current) return;
        const current = outputFileSignatures(files);
        const changed = [...current].some(
          ([fileId, signature]) => episode.baseline.get(fileId) !== signature,
        );
        if (!changed) return;
      } else if (!generationAttemptId) {
        return;
      }

      const screenCount = generationOutputFiles(files).length;
      if (!isOwner || screenCount === 0) return;
      if (generationAttemptId) sentReadyViewAttempts.add(generationAttemptId);
      const properties = {
        output_id: designId,
        output_type: "design",
        screen_count: screenCount,
        is_owner: true,
        ...(generationAttemptId
          ? { generation_attempt_id: generationAttemptId }
          : {}),
      };
      cancelPendingRef.current?.();
      cancelPendingRef.current = runWhenTabVisible(() => {
        cancelPendingRef.current = null;
        trackDesignRelay("design_ready_viewed", properties);
      });
    } catch {
      // coercion-ok: a failed analytics send must never affect the editor.
    }
  }, [
    designId,
    designLoaded,
    files,
    generationActive,
    isOwner,
    stopCountRef,
    urlAttemptId,
  ]);
}

/**
 * Toolkit's `GUIDED_QUESTIONS_SUBMITTED_EVENT`, dispatched by the shared
 * guided-questions flow on every human submit delivered to the agent.
 */
export const GUIDED_QUESTIONS_SUBMITTED_EVENT =
  "agentNative.guidedQuestionsSubmitted";

const VARIANT_SET_PATTERN = /\bfrom variant set ([A-Za-z0-9_-]+)\./;
const VARIANT_DESIGN_PATTERN = /\bwith designId ([A-Za-z0-9_-]+)\b/;

type GuidedSubmitDetail = {
  questions?: readonly {
    id?: unknown;
    options?: readonly { value?: unknown }[];
  }[];
  answers?: Record<string, unknown>;
};

/**
 * Reads a `present-design-variants` "Pick a direction" submit: its single
 * `variant` question whose options name the variant set. Any other guided
 * question returns null.
 */
export function variantPickFromGuidedSubmit(detail: unknown): {
  variantCount: number;
  pickedIndex: number;
  variantSetId?: string;
  designId?: string;
} | null {
  if (!detail || typeof detail !== "object") return null;
  const { questions, answers } = detail as GuidedSubmitDetail;
  const question = questions?.find((candidate) => candidate.id === "variant");
  const options = question?.options ?? [];
  const values = options.map((option) =>
    typeof option.value === "string" ? option.value : "",
  );
  if (!values.some((value) => VARIANT_SET_PATTERN.test(value))) return null;
  const answer = answers?.variant;
  const pickedIndex = typeof answer === "string" ? values.indexOf(answer) : -1;
  if (pickedIndex < 0) return null;
  const variantSetId = VARIANT_SET_PATTERN.exec(values[pickedIndex])?.[1];
  const designId = VARIANT_DESIGN_PATTERN.exec(values[pickedIndex])?.[1];
  return {
    variantCount: values.length,
    pickedIndex,
    ...(variantSetId ? { variantSetId } : {}),
    ...(designId ? { designId } : {}),
  };
}

/**
 * `design_variant_picked`: one per human "Pick a direction" submit. Mounted at
 * the app root, because a pick can be answered from the chat page or while the
 * editor shows another design; the design comes from the picked option.
 */
export function useDesignVariantPickTracking() {
  useEffect(() => {
    const handler = (event: Event) => {
      try {
        const pick = variantPickFromGuidedSubmit((event as CustomEvent).detail);
        if (!pick?.designId) return;
        trackDesignRelay("design_variant_picked", {
          output_id: pick.designId,
          output_type: "design",
          variant_count: pick.variantCount,
          picked_index: pick.pickedIndex,
          ...(pick.variantSetId ? { variant_set_id: pick.variantSetId } : {}),
        });
      } catch {
        // coercion-ok: a failed analytics send must never affect the submit.
      }
    };
    window.addEventListener(GUIDED_QUESTIONS_SUBMITTED_EVENT, handler);
    return () =>
      window.removeEventListener(GUIDED_QUESTIONS_SUBMITTED_EVENT, handler);
  }, []);
}
