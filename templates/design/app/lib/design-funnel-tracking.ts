import { GUIDED_QUESTIONS_SUBMITTED_EVENT } from "@agent-native/toolkit/app/chat/agentkit-chat";
import {
  DESIGN_GENERATION_ATTEMPT_QUERY_PARAM,
  isDesignGenerationAttemptId,
} from "@shared/generation-provenance";
import { promptLengthBucket } from "@shared/prompt-length-bucket";
import { useEffect, useMemo, useRef } from "react";

import { readAgentRunStatus } from "@/lib/agent-run-status";
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
    // Not `source`: the browser relay sets `source: "client"` on every event.
    prompt_source: source,
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

const sentReadyViewAttempts = new Set<string>();
// Per page, not per hook: the editor can mount this hook more than once, and
// each instance hears the same run signals.
const reportedReadyViewRuns = new Set<string>();

/** Test-only: forget which runs and attempts this page already reported. */
export function resetDesignReadyViewsForTest(): void {
  sentReadyViewAttempts.clear();
  reportedReadyViewRuns.clear();
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

const AGENT_CHAT_RUNNING_EVENT = "agentNative.chatRunning";
const RUN_STATUS_ATTEMPTS = 3;
const RUN_STATUS_RETRY_MS = 1500;

/**
 * Whether the server reports this exact run as completed. The chat's own
 * "stopped running" signal says `run.completed` for every ending, so it cannot
 * tell success from an error, an abort or a truncation. The run-state route
 * also reports a truncated run as `completed` for older clients; only the
 * terminal reason `done` marks a run that actually finished.
 */
async function runCompleted(threadId: string, runId: string): Promise<boolean> {
  for (let attempt = 0; attempt < RUN_STATUS_ATTEMPTS; attempt += 1) {
    const run = await readAgentRunStatus(threadId);
    if (!run.ok || (run.runId && run.runId !== runId)) return false;
    if (!run.active) {
      if (run.status !== "completed") return false;
      if (run.terminalReason) return run.terminalReason === "done";
      // The reason is written just after the status; read again.
    }
    await new Promise((resolve) => setTimeout(resolve, RUN_STATUS_RETRY_MS));
  }
  return false;
}

/**
 * `design_ready_viewed`: the owner has the design open with its screens when
 * an agent run on it completes.
 *
 * Every agent run in the page announces itself with its run id, whoever
 * started it (the home prompt, the editor, or a chat message), and counts once
 * the server reports that exact run completed; an errored, aborted or
 * truncated run never does. Whether the run produced output is the server's
 * record, not the browser's: the event carries `run_id`, which
 * `generation_completed` and `design_edited` also carry, so the warehouse
 * keeps the runs that wrote screens. A page opened from a `generate-design`
 * link reports that link's attempt once when it loads already finished.
 */
export function useDesignReadyViewTracking({
  designId,
  isOwner,
  designLoaded,
  files,
}: {
  designId: string | undefined;
  isOwner: boolean;
  designLoaded: boolean;
  files: readonly ReadyViewFile[];
}): void {
  // The editor stays mounted across in-app navigation, so the attempt id is
  // read per design and per URL rather than once: an id from one link must
  // never be reported against another design, or hide a newer link's id.
  const search = typeof window === "undefined" ? "" : window.location.search;
  const urlAttemptId = useMemo(
    () => (designId ? readUrlGenerationAttemptId() : null),
    [designId, search],
  );
  const latest = useRef({ designId, isOwner, designLoaded, files });
  latest.current = { designId, isOwner, designLoaded, files };
  const cancelSendsRef = useRef(new Set<() => void>());

  const send = useRef((properties: Record<string, unknown>) => {
    // runWhenTabVisible calls back synchronously when the tab is visible, so
    // the cancel handle may not exist yet when the send runs.
    let sent = false;
    const cancel = runWhenTabVisible(() => {
      sent = true;
      trackDesignRelay("design_ready_viewed", properties);
    });
    if (!sent) cancelSendsRef.current.add(cancel);
  }).current;

  useEffect(() => {
    // Runs seen starting while this design was open, by run id. A run is
    // confirmed at most once.
    const runs = new Map<string, { threadId: string; ending: boolean }>();
    const cancelSends = cancelSendsRef.current;
    let disposed = false;
    const onRunning = (event: Event) => {
      try {
        const detail = (event as CustomEvent).detail as {
          isRunning?: unknown;
          runId?: unknown;
          threadId?: unknown;
          tabId?: unknown;
        } | null;
        const runId = typeof detail?.runId === "string" ? detail.runId : "";
        const threadId =
          typeof detail?.threadId === "string"
            ? detail.threadId
            : typeof detail?.tabId === "string"
              ? detail.tabId
              : "";
        if (!runId || !threadId) return;
        const run = runs.get(runId);
        if (detail?.isRunning === true) {
          if (!run && latest.current.designLoaded) {
            runs.set(runId, { threadId, ending: false });
          }
          return;
        }
        if (detail?.isRunning !== false || !run || run.ending) return;
        run.ending = true;
        void runCompleted(run.threadId, runId)
          .then((completed) => {
            if (disposed || !completed) return;
            const { designId, isOwner, files } = latest.current;
            const screenCount = generationOutputFiles(files).length;
            if (!designId || !isOwner || screenCount === 0) return;
            if (reportedReadyViewRuns.has(runId)) return;
            reportedReadyViewRuns.add(runId);
            send({
              output_id: designId,
              output_type: "design",
              screen_count: screenCount,
              is_owner: true,
              run_id: runId,
            });
          })
          .catch(() => {
            // coercion-ok: an unconfirmed run is never reported.
          });
      } catch {
        // coercion-ok: a failed analytics read must never affect the editor.
      }
    };
    window.addEventListener(AGENT_CHAT_RUNNING_EVENT, onRunning);
    return () => {
      disposed = true;
      window.removeEventListener(AGENT_CHAT_RUNNING_EVENT, onRunning);
      for (const cancel of cancelSends) cancel();
      cancelSends.clear();
    };
  }, [designId, send]);

  useEffect(() => {
    try {
      if (!designId || !designLoaded || !isOwner || !urlAttemptId) return;
      // A link's attempt is consumed by its first report, so later in-page
      // runs are never attributed to it.
      if (sentReadyViewAttempts.has(urlAttemptId)) return;
      const screenCount = generationOutputFiles(files).length;
      if (screenCount === 0) return;
      sentReadyViewAttempts.add(urlAttemptId);
      send({
        output_id: designId,
        output_type: "design",
        screen_count: screenCount,
        is_owner: true,
        generation_attempt_id: urlAttemptId,
      });
    } catch {
      // coercion-ok: a failed analytics send must never affect the editor.
    }
  }, [designId, designLoaded, files, isOwner, send, urlAttemptId]);
}

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
