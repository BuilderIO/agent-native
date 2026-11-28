import { constants } from "node:os";

import { KnownCliError } from "./telemetry-sanitize.js";

export interface BuildStepFailureInput {
  label: string;
  exitCode: number;
  signal: string | null;
  template?: string;
}

/**
 * The error and context for a build step that exited non-zero. The message
 * names only the step: the template is a tag, so failures group across templates.
 * The step's output stays on the machine, because
 * build logs hold paths, project names and secrets.
 */
export function buildStepFailureReport(input: BuildStepFailureInput): {
  error: Error;
  fingerprint: string[];
  tags: Record<string, string>;
  extra: Record<string, unknown>;
} {
  return {
    error: new KnownCliError(
      input.signal
        ? `Build step "${input.label}" killed by ${input.signal}`
        : `Build step "${input.label}" failed`,
    ),
    fingerprint: [
      "build-step",
      input.label,
      input.signal ? "signal" : "failed",
      ...(input.signal && Object.hasOwn(constants.signals, input.signal)
        ? [input.signal]
        : []),
    ],
    tags: {
      source: "build-step",
      buildStep: input.label,
      ...(input.template ? { template: input.template } : {}),
    },
    extra: {
      exitCode: input.exitCode,
      signal: input.signal,
    },
  };
}
