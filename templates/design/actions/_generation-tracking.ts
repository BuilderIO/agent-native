import { randomUUID } from "node:crypto";

import type { TrackingSource } from "@agent-native/core/tracking";

import {
  type DesignGenerationPath,
  trackDesign,
  trackingErrorType,
} from "../server/lib/design-tracking.js";
import { promptLengthBucket } from "../shared/prompt-length-bucket.js";

export interface GenerationAttemptStart {
  designId: string;
  generationPath: DesignGenerationPath;
  prompt: unknown;
  /** Omit when the action cannot know it without extra I/O. */
  hasReferenceDesignSystem?: boolean;
  /** Sent on the started event and on the terminal event. */
  properties?: Record<string, unknown>;
}

export interface GenerationAttempt {
  readonly id: string;
  /** Call once the caller's access to the design is verified. */
  start: (start: GenerationAttemptStart) => void;
  /** Live count of files this attempt has committed so far. */
  savedFileCount: () => number;
  /** Properties known only later in the run, sent on the terminal event. */
  addProperties: (properties: Record<string, unknown>) => void;
  /** Marks the saved files as only part of what was requested. */
  markPartial: () => void;
}

/**
 * One call of a Design generation action is one attempt. Nothing is recorded
 * until the handler calls `attempt.start()`; after that, exactly one of
 * `generation_completed` (at least one file saved, or `outcome: "unknown"`
 * when the count could not be read) or `generation_failed` (the handler
 * threw, or saved nothing) follows. A failure is recorded and
 * the original error rethrown unchanged.
 */
export function withGenerationAttempt<
  I,
  C extends TrackingSource | undefined,
  R,
>(
  handler: (input: I, context: C, attempt: GenerationAttempt) => Promise<R>,
): (input: I, context: C) => Promise<R> {
  return async (input, context) => {
    // Not nanoid: actions mint their file and set ids from it, and the attempt
    // id must not shift that sequence.
    const id = randomUUID();
    // A holder, not a `let`: `start` assigns it from inside a closure, which
    // control-flow narrowing cannot see.
    const started: { base: Record<string, unknown> | null } = { base: null };
    let terminalProperties: Record<string, unknown> = {};
    let partial = false;
    const attempt: GenerationAttempt = {
      id,
      start: (start) => {
        if (started.base) return;
        const base = {
          output_id: start.designId,
          output_type: "design",
          generation_attempt_id: id,
          generation_path: start.generationPath,
        };
        started.base = base;
        terminalProperties = { ...start.properties, ...terminalProperties };
        trackDesign(
          "generation_started",
          {
            ...start.properties,
            ...base,
            prompt_length_bucket: promptLengthBucket(start.prompt),
            ...(start.hasReferenceDesignSystem === undefined
              ? {}
              : {
                  has_reference_design_system: start.hasReferenceDesignSystem,
                }),
          },
          context,
        );
      },
      savedFileCount: () => 0,
      addProperties: (properties) => {
        terminalProperties = { ...terminalProperties, ...properties };
      },
      markPartial: () => {
        partial = true;
      },
    };
    // `null` means the count could not be read, which is not "nothing saved".
    const filesSaved = (): number | null => {
      try {
        return attempt.savedFileCount();
      } catch {
        // coercion-ok: an unreadable count is reported as unknown, never as zero.
        return null;
      }
    };

    let result: R;
    try {
      result = await handler(input, context, attempt);
    } catch (error) {
      const base = started.base;
      if (base) {
        // Inside its own guard: reading the error must never replace it.
        try {
          const saved = filesSaved();
          trackDesign(
            "generation_failed",
            {
              ...terminalProperties,
              ...base,
              error_type: trackingErrorType(error),
              ...(saved === null ? {} : { files_saved: saved }),
            },
            context,
          );
        } catch {
          // coercion-ok: losing the failure event must not change the error the caller sees.
        }
      }
      throw error;
    }

    const base = started.base;
    if (!base) return result;
    const fileCount = filesSaved();
    trackDesign(
      fileCount === 0 ? "generation_failed" : "generation_completed",
      {
        ...terminalProperties,
        ...base,
        ...(fileCount === null
          ? { outcome: "unknown" }
          : fileCount > 0
            ? {
                outcome: partial ? "partial" : "completed",
                file_count: fileCount,
              }
            : { error_type: "no_files_saved", files_saved: 0 }),
      },
      context,
    );
    return result;
  };
}
