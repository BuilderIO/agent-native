import { callAction } from "@agent-native/core/client/hooks";
import { GUIDED_QUESTIONS_SUBMITTED_EVENT } from "@agent-native/toolkit/app/chat/agentkit-chat";
import {
  DESIGN_GENERATION_ATTEMPT_QUERY_PARAM,
  isDesignGenerationAttemptId,
} from "@shared/generation-provenance";
import { promptLengthBucket } from "@shared/prompt-length-bucket";
import { useEffect, useMemo, useRef } from "react";

import {
  readAgentRunStatus,
  type AgentRunStatusRead,
} from "@/lib/agent-run-status";
import {
  SYSTEM_CONTEXT_KEY,
  TEMPLATE_CONTEXT_KEY,
} from "@/lib/composer-context";
import {
  runWhenTabVisible,
  trackDesignRelay,
} from "@/lib/design-relay-tracking";
import { generationOutputFiles } from "@/lib/pending-generation";

export type DesignPromptSource =
  | "composer"
  | "suggestion_chip"
  | "home_suggestion";

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
  readyViewChecksInFlight.clear();
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
const DESIGN_READY_VIEW_PROPAGATION_WINDOW_MS = 30_000;
const DESIGN_READY_RECEIPT_ATTEMPTS = 3;
const DESIGN_READY_RECEIPT_RETRY_MS = 1500;
type CompletedAgentRun = Extract<AgentRunStatusRead, { ok: true }>;
type TrackedAgentRun = {
  threadId: string;
  designId?: string;
  ending: boolean;
  completed?: CompletedAgentRun;
  completedAt?: number;
  receiptAttempts?: number;
};

const readyViewChecksInFlight = new Map<string, symbol>();

/**
 * Whether the server reports this exact run as completed. The chat's own
 * "stopped running" signal says `run.completed` for every ending, so it cannot
 * tell success from an error, an abort or a truncation. The run-state route
 * also reports a truncated run as `completed` for older clients; only the
 * terminal reason `done` marks a run that actually finished.
 */
async function completedRunStatus(
  threadId: string,
  runId: string,
): Promise<CompletedAgentRun | null> {
  for (let attempt = 0; attempt < RUN_STATUS_ATTEMPTS; attempt += 1) {
    const run = await readAgentRunStatus(threadId, runId);
    if (run.ok && !run.active) {
      if (run.status !== "completed") return null;
      if (run.terminalReason) return run.terminalReason === "done" ? run : null;
      // The reason is written just after the status; read again.
    }
    if (attempt < RUN_STATUS_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, RUN_STATUS_RETRY_MS));
    }
  }
  return null;
}

/**
 * `design_ready_viewed`: the owner has the design open with its screens when
 * an agent run on it completes.
 *
 * The server resolves a known run to the latest run in its turn, so event
 * joins use the terminal run id and turn id when a continuation wrote screens.
 * An unfinished run is never reported as ready. A page opened from a
 * `generate-design` link reports that link's attempt once when it loads.
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
  const hasGenerationOutput = generationOutputFiles(files).length > 0;
  const latest = useRef({ designId, isOwner, designLoaded, files });
  latest.current = { designId, isOwner, designLoaded, files };
  const runsRef = useRef(new Map<string, TrackedAgentRun>());
  const cancelSendsRef = useRef(new Set<() => void>());
  const receiptRetryTimersRef = useRef(new Map<string, number>());
  const lifecycleRef = useRef(0);
  const attemptDeadlinesRef = useRef(new Map<string, number>());
  const resolvedAttemptsRef = useRef(new Set<string>());

  const send = useRef((callback: () => void) => {
    // runWhenTabVisible calls back synchronously when the tab is visible, so
    // the cancel handle may not exist yet when the send runs.
    let sent = false;
    const cancel = runWhenTabVisible(() => {
      sent = true;
      callback();
    });
    if (!sent) cancelSendsRef.current.add(cancel);
  }).current;
  const flushCompletedRunsRef = useRef<() => void>(() => {});
  flushCompletedRunsRef.current = () => {
    const current = latest.current;
    if (!current.designId || !current.designLoaded) return;
    const lifecycle = lifecycleRef.current;
    const screenCount = generationOutputFiles(current.files).length;
    const clearReceiptRetry = (turnId: string) => {
      const timer = receiptRetryTimersRef.current.get(turnId);
      if (timer !== undefined) window.clearTimeout(timer);
      receiptRetryTimersRef.current.delete(turnId);
    };
    const discardRun = (runId: string, run: TrackedAgentRun) => {
      runsRef.current.delete(runId);
      if (run.completed?.turnId) clearReceiptRetry(run.completed.turnId);
    };
    const retryReceipt = (turnId: string) => {
      if (document.visibilityState !== "visible") return;
      if (receiptRetryTimersRef.current.has(turnId)) return;
      const timer = window.setTimeout(() => {
        receiptRetryTimersRef.current.delete(turnId);
        flushCompletedRunsRef.current();
      }, DESIGN_READY_RECEIPT_RETRY_MS);
      receiptRetryTimersRef.current.set(turnId, timer);
    };

    for (const [runId, run] of runsRef.current) {
      if (
        run.designId &&
        current.designId &&
        current.designId !== run.designId
      ) {
        discardRun(runId, run);
        continue;
      }
      if (!run.completed) continue;
      if (!current.isOwner) {
        discardRun(runId, run);
        continue;
      }
      if (
        run.completedAt !== undefined &&
        Date.now() - run.completedAt >= DESIGN_READY_VIEW_PROPAGATION_WINDOW_MS
      ) {
        discardRun(runId, run);
        continue;
      }
      if (screenCount === 0) continue;

      const designId = run.designId ?? current.designId;
      if (!designId) {
        discardRun(runId, run);
        continue;
      }
      const terminalRunId = run.completed.runId ?? runId;
      const turnId = run.completed.turnId;
      if (!turnId) {
        discardRun(runId, run);
        continue;
      }
      const turnKey = turnId;
      if (reportedReadyViewRuns.has(turnKey)) {
        discardRun(runId, run);
        continue;
      }
      if (readyViewChecksInFlight.has(turnKey)) continue;
      send(() => {
        if (
          reportedReadyViewRuns.has(turnKey) ||
          readyViewChecksInFlight.has(turnKey)
        ) {
          return;
        }
        if (
          run.completedAt !== undefined &&
          Date.now() - run.completedAt >=
            DESIGN_READY_VIEW_PROPAGATION_WINDOW_MS
        ) {
          discardRun(runId, run);
          return;
        }
        const ready = latest.current;
        if (ready.designId !== designId || !ready.isOwner) {
          discardRun(runId, run);
          return;
        }
        if (
          document.visibilityState !== "visible" ||
          !ready.designLoaded ||
          generationOutputFiles(ready.files).length === 0
        ) {
          return;
        }
        const checkToken = Symbol(turnKey);
        readyViewChecksInFlight.set(turnKey, checkToken);
        const attempt = (run.receiptAttempts ?? 0) + 1;
        run.receiptAttempts = attempt;
        void callAction(
          "get-design-generation-output",
          {
            designId,
            runId: terminalRunId,
            turnId,
          },
          { method: "GET", uiOnly: true },
        )
          .then((result) => {
            if (
              lifecycleRef.current !== lifecycle ||
              runsRef.current.get(runId) !== run
            ) {
              return;
            }
            if (result.status === "no_output") {
              discardRun(runId, run);
              return;
            }
            if (result.status !== "has_output") {
              if (attempt < DESIGN_READY_RECEIPT_ATTEMPTS) {
                retryReceipt(turnKey);
              } else {
                discardRun(runId, run);
              }
              return;
            }
            run.receiptAttempts = 0;
            const visible = latest.current;
            if (visible.designId !== designId || !visible.isOwner) {
              discardRun(runId, run);
              return;
            }
            const currentScreenCount = generationOutputFiles(
              visible.files,
            ).length;
            if (document.visibilityState !== "visible") return;
            if (!visible.designLoaded || currentScreenCount === 0) {
              retryReceipt(turnKey);
              return;
            }
            window.dispatchEvent(
              new CustomEvent("design:verified-generation-ready", {
                detail: { designId, runId: terminalRunId, turnId },
              }),
            );
            trackDesignRelay("design_ready_viewed", {
              output_id: designId,
              output_type: "design",
              run_id: terminalRunId,
              turn_id: turnId,
              screen_count: currentScreenCount,
              is_owner: true,
            });
            reportedReadyViewRuns.add(turnKey);
            discardRun(runId, run);
          })
          .catch(() => {
            if (
              lifecycleRef.current !== lifecycle ||
              runsRef.current.get(runId) !== run
            ) {
              return;
            }
            if (attempt < DESIGN_READY_RECEIPT_ATTEMPTS) {
              retryReceipt(turnKey);
            } else {
              discardRun(runId, run);
            }
          })
          .finally(() => {
            if (readyViewChecksInFlight.get(turnKey) === checkToken) {
              readyViewChecksInFlight.delete(turnKey);
            }
          });
      });
    }
  };

  useEffect(() => {
    // Keep starts that arrive before the first generated design has loaded.
    const runs = runsRef.current;
    const cancelSends = cancelSendsRef.current;
    const lifecycle = lifecycleRef.current + 1;
    lifecycleRef.current = lifecycle;
    let disposed = false;
    const isDisposed = () => disposed;
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
          if (!run) {
            // A later run supersedes a waiting completion so its first screen is not attributed backward.
            for (const [previousRunId, previousRun] of runs) {
              const sameOutput = latest.current.designId
                ? !previousRun.designId ||
                  previousRun.designId === latest.current.designId
                : previousRun.threadId === threadId;
              if (previousRun.completed && sameOutput) {
                runs.delete(previousRunId);
              }
            }
            runs.set(runId, {
              threadId,
              ...(latest.current.designId
                ? { designId: latest.current.designId }
                : {}),
              ending: false,
            });
          }
          return;
        }
        if (detail?.isRunning !== false || !run || run.ending) return;
        run.ending = true;
        void completedRunStatus(run.threadId, runId)
          .then(async (completed) => {
            if (disposed) return;
            if (!completed) {
              runs.delete(runId);
              return;
            }
            const designId = run.designId ?? latest.current.designId;
            if (!designId) {
              runs.delete(runId);
              return;
            }
            if (isDisposed() || runs.get(runId) !== run) return;
            run.designId = designId;
            run.completed = completed;
            run.completedAt = Date.now();
            flushCompletedRunsRef.current();
          })
          .catch(() => {
            // coercion-ok: an unconfirmed run is never reported.
            runs.delete(runId);
          });
      } catch {
        // coercion-ok: a failed analytics read must never affect the editor.
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        flushCompletedRunsRef.current();
      }
    };
    window.addEventListener(AGENT_CHAT_RUNNING_EVENT, onRunning);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      if (lifecycleRef.current === lifecycle) lifecycleRef.current += 1;
      window.removeEventListener(AGENT_CHAT_RUNNING_EVENT, onRunning);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      for (const cancel of cancelSends) cancel();
      cancelSends.clear();
      for (const timer of receiptRetryTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      receiptRetryTimersRef.current.clear();
    };
  }, [send]);

  useEffect(() => {
    if (!designId || !designLoaded) return;
    for (const run of runsRef.current.values()) {
      if (!run.designId) run.designId = designId;
    }
  }, [designId, designLoaded]);

  useEffect(() => {
    flushCompletedRunsRef.current();
  }, [designId, designLoaded, files, isOwner]);

  useEffect(() => {
    if (
      !designId ||
      !designLoaded ||
      !isOwner ||
      !urlAttemptId ||
      !hasGenerationOutput
    )
      return;
    let cancelled = false;
    const isCancelled = () => cancelled;
    let timer: number | undefined;
    let cancelVisible: (() => void) | undefined;
    let checks = 0;
    let loggedError = false;
    const key = `${designId}:${urlAttemptId}`;
    if (resolvedAttemptsRef.current.has(key)) return;
    const deadline =
      attemptDeadlinesRef.current.get(key) ?? Date.now() + 10 * 60 * 1000;
    attemptDeadlinesRef.current.set(key, deadline);
    const resolveAttempt = async () => {
      if (isCancelled() || Date.now() >= deadline) return;
      try {
        const { status, result } = await callAction<{
          status: "missing" | "pending" | "ready" | "unavailable" | "terminal";
          result: { runId: string; turnId: string } | null;
        }>(
          "resolve-design-generation-attempt" as never,
          { designId, attemptId: urlAttemptId } as never,
          { method: "GET", uiOnly: true },
        );
        if (isCancelled() || Date.now() >= deadline) return;
        if (
          status === "missing" ||
          status === "unavailable" ||
          status === "terminal"
        ) {
          resolvedAttemptsRef.current.add(key);
          return;
        }
        if (status === "ready" && result) {
          cancelVisible = runWhenTabVisible(() => {
            if (isCancelled()) return;
            resolvedAttemptsRef.current.add(key);
            window.dispatchEvent(
              new CustomEvent("design:verified-generation-ready", {
                detail: { designId, ...result },
              }),
            );
          });
          return;
        }
      } catch (error) {
        if (!loggedError) {
          console.warn("Could not resolve generation attempt", error);
          loggedError = true;
        }
      }
      if (!isCancelled() && Date.now() < deadline) {
        checks += 1;
        timer = window.setTimeout(
          () => {
            void resolveAttempt();
          },
          Math.min(
            2000 * 2 ** Math.min(checks - 1, 3),
            15000,
            deadline - Date.now(),
          ),
        );
      }
    };
    void resolveAttempt();
    return () => {
      cancelled = true;
      cancelVisible?.();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [designId, designLoaded, hasGenerationOutput, isOwner, urlAttemptId]);

  useEffect(() => {
    try {
      if (!designId || !designLoaded || !isOwner || !urlAttemptId) return;
      // A link's attempt is consumed by its first report, so later in-page
      // runs are never attributed to it.
      if (sentReadyViewAttempts.has(urlAttemptId)) return;
      const screenCount = generationOutputFiles(files).length;
      if (screenCount === 0) return;
      sentReadyViewAttempts.add(urlAttemptId);
      send(() =>
        trackDesignRelay("design_ready_viewed", {
          output_id: designId,
          output_type: "design",
          screen_count: screenCount,
          is_owner: true,
          generation_attempt_id: urlAttemptId,
        }),
      );
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
