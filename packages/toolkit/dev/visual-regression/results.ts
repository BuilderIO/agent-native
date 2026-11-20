export const APPEARANCES = ["light", "dark"] as const;

export type Appearance = (typeof APPEARANCES)[number];

/**
 * What happened to one story's screenshot in one appearance. `recorded` is a
 * new baseline taken on purpose; `new` is a story the baseline does not have.
 */
export type Outcome =
  | "matched"
  | "recorded"
  | "changed"
  | "new"
  | "unstable"
  | "skipped";

export interface ShotResult {
  storyId: string;
  appearance: Appearance;
  /** The screenshot's path under the baseline and diff directories, without `.png`. */
  file: string;
  outcome: Outcome;
  message?: string;
}

/**
 * `components-button--playground` in dark is `components-button/playground/dark`:
 * one folder per component, and no `--`, which Vitest collapses in file names.
 */
export function shotFile(storyId: string, appearance: Appearance): string {
  const [component, story] = storyId.split("--");
  if (!component || !story) {
    throw new Error(`Story id ${storyId} is not <component>--<story>`);
  }
  return `${component}/${story}/${appearance}`;
}

const MATCHER_OUTCOMES: readonly (readonly [string, Outcome])[] = [
  ["Screenshot does not match the stored reference", "changed"],
  ["No existing reference screenshot found", "new"],
  ["Could not capture a stable screenshot", "unstable"],
];

/** The visual outcome a matcher error reports, or null for any other error. */
export function outcomeFromError(error: unknown): Outcome | null {
  const message = error instanceof Error ? error.message : String(error);
  for (const [text, outcome] of MATCHER_OUTCOMES) {
    if (message.includes(text)) return outcome;
  }
  return null;
}
