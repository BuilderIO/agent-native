// Concrete "ship a compact first version, then refine incrementally" guidance
// keyed by the large-payload action the model was cut off while preparing.
// A run cut off before the tool starts tends to reassemble the same oversized
// payload on every continuation; pointing the model at the incremental path is
// what breaks that loop.
export function incrementalActionGuidance(tool: string): string | undefined {
  switch (tool) {
    case "create-extension":
    case "update-extension":
      return "create a compact working v1 with `create-extension`, then use focused `update-extension` edits for refinements";
    case "generate-design":
    case "update-design":
      return 'if an existing design file or snapshot is already in history, especially after a Design variant pick, stop retrying `generate-design`: call `get-design-snapshot` for the selected file, then call `edit-design` once on that same `fileId` (`mode: "replace-file"` for a compact full-file replacement, or search/replace for smaller edits). Use `generate-design` only for a brand-new compact first file when no target file exists yet';
    case "edit-design":
      return "retry with a smaller `edit-design` payload: prefer a handful of exact search/replace edits against the already-snapshotted file, and avoid `replacementContent` for a huge full-file rewrite. If a selected variant needs expansion, upgrade the highest-value visible sections first, save once, and summarize any remaining refinements";
    case "present-design-variants":
      return 'call `present-design-variants` with concise labels, descriptions, accent colors, and feature bullets; omit large `content` HTML when needed so the action can render compact representative screens. After the user picks a direction, delete unchosen screens, snapshot the selected `fileId`, and refine that same file with `edit-design` (`mode: "replace-file"` for placeholder expansion). Do not call `generate-design` after the variant pick';
    case "create-visual-plan":
    case "create-ui-plan":
    case "create-plan-design":
    case "create-prototype-plan":
      return "create the plan with its core sections or first screen, then expand it with `update-visual-plan`/`patch-visual-plan-source` follow-up edits";
    case "update-visual-plan":
    case "patch-visual-plan-source":
      return "apply smaller, targeted `patch-visual-plan-source` edits rather than rewriting the whole plan in one call";
    case "update-dashboard":
      return "save a small dashboard first, then add panels one at a time with `update-dashboard` incremental `ops` edits instead of authoring the whole config in one call";
    default:
      return undefined;
  }
}

export function actionPreparationContinuationNote(tool: string): string {
  const guidance = incrementalActionGuidance(tool);
  return guidance
    ? `\n\nThe previous run was cut off while preparing the \`${tool}\` action input before the action could finish. Avoid spending another whole run assembling one large tool payload - ${guidance}.`
    : `\n\nThe previous run was cut off while preparing the \`${tool}\` action input before the action could finish. Avoid re-assembling one large tool payload: produce a compact first result you can finish in a single run, then refine it with smaller follow-up edits.`;
}
