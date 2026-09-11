/**
 * Pure guard extracted from format-on-open.ts so it stays unit-testable
 * without pulling in `../store` / `../model-registry` (and transitively
 * `monaco-editor`, which requires a full browser environment and can't load
 * under vitest's default node/jsdom setup) — same split used by
 * status-bar-lang.ts for StatusBar.tsx.
 */

/**
 * Decide whether a completed background format result is still safe to
 * apply. `snapshotContent` is the buffer content that was actually sent to
 * Prettier; formatting runs asynchronously (dynamic plugin imports + async
 * format), so by the time the result comes back the user may have already
 * started editing the live model. Applying the formatted text in that case
 * would silently discard their in-progress edits, so we bail unless the
 * model's current value still matches the snapshot that was formatted.
 */
export function shouldApplyFormatResult(
  currentModelValue: string,
  snapshotContent: string,
  formatted: string,
): boolean {
  if (formatted === snapshotContent) return false;
  return currentModelValue === snapshotContent;
}
