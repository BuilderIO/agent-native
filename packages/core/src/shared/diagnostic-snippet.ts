/**
 * Fences a block of echoed user/app content (e.g. file excerpts quoted back
 * into a tool-error message) so downstream text scanners never mistake it
 * for a real signal. production-agent's permanent-precondition classifier
 * matches broad, column-0-anchored phrases ("no authenticated user", "code:
 * permanent_precondition", ...) against tool-result text to decide whether a
 * turn should stop instead of retry. A candidate snippet quoted from a
 * user's own file can coincidentally contain such a phrase (or, once
 * multi-line, push a later line to column 0), which must never be treated as
 * a classifier signal — it is data being shown to the model, not a system
 * diagnostic. Wrap any such echoed content with `wrapDiagnosticSnippet`
 * before appending it to a tool error; the classifier is expected to call
 * `stripDiagnosticSnippets` before matching (wired up by another change).
 */

export const DIAGNOSTIC_SNIPPET_OPEN = "<<<diagnostic-snippet";
export const DIAGNOSTIC_SNIPPET_CLOSE = ">>>end-diagnostic-snippet";

/** Indents every line of `text` by 4 spaces and fences it between the
 * diagnostic-snippet markers. */
export function wrapDiagnosticSnippet(text: string): string {
  const indented = text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  return `${DIAGNOSTIC_SNIPPET_OPEN}\n${indented}\n${DIAGNOSTIC_SNIPPET_CLOSE}`;
}

/** Removes every `wrapDiagnosticSnippet` block from `text`, non-greedy and
 * spanning newlines. The close marker only counts as a whole line at column
 * 0: `wrapDiagnosticSnippet` indents every content line, so an echoed
 * snippet that itself contains the close marker cannot terminate the fence
 * early and leak the rest of the snippet to the classifiers. An unmatched open marker
 * (a truncated message) removes through the end of the text rather than
 * leaving a dangling fence. */
export function stripDiagnosticSnippets(text: string): string {
  const withoutPairs = text.replace(
    /<<<diagnostic-snippet[\s\S]*?^>>>end-diagnostic-snippet$/gm,
    "",
  );
  return withoutPairs.replace(/<<<diagnostic-snippet[\s\S]*$/, "");
}
