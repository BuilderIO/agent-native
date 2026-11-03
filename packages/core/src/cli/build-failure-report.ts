import { KnownCliError } from "./telemetry-sanitize.js";

export interface BuildStepFailureInput {
  label: string;
  exitCode: number;
  signal: string | null;
  template?: string;
}

/**
 * The error and context for a build step that exited non-zero. The message
 * names only the step: the template is a tag, so one failing step is one issue
 * instead of one per template. The step's output stays on the machine, because
 * build logs hold paths, project names and secrets.
 */
export function buildStepFailureReport(input: BuildStepFailureInput): {
  error: Error;
  tags: Record<string, string>;
  extra: Record<string, unknown>;
} {
  return {
    error: new KnownCliError(`Build step "${input.label}" failed`),
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
