import type { TweakDefinition } from "@shared/api";
import {
  isDirectCssVarSelectionKey,
  resolveTweaksToCssVars,
} from "@shared/resolve-tweaks";
import type { TweakSelections } from "@shared/resolve-tweaks";

export interface TweakHandoffChange {
  id: string;
  label: string;
  oldValue: string | number | boolean;
  newValue: string | number | boolean;
  cssVar?: string;
}

/**
 * The delta between the source baseline and the board, in the terms the
 * preview renders: a direct CSS-variable selection overrides the declared
 * tweak that writes the same variable, so that variable's change is reported
 * once, from its effective value, and the shadowed tweak is not.
 */
export function getTweakHandoffChanges(args: {
  tweaks: TweakDefinition[];
  before: TweakSelections;
  after: TweakSelections;
}): TweakHandoffChange[] {
  const isDirect = (key: string) =>
    isDirectCssVarSelectionKey(key) &&
    Object.prototype.hasOwnProperty.call(args.after, key);
  const declared = args.tweaks.flatMap((tweak) => {
    if (tweak.cssVar && isDirect(tweak.cssVar)) return [];
    const oldValue = args.before[tweak.id] ?? tweak.defaultValue;
    const newValue = args.after[tweak.id] ?? tweak.defaultValue;
    if (Object.is(oldValue, newValue)) return [];
    return [
      {
        id: tweak.id,
        label: tweak.label,
        oldValue,
        newValue,
        ...(tweak.cssVar ? { cssVar: tweak.cssVar } : {}),
      },
    ];
  });
  const beforeVars = new Map(
    Object.entries(resolveTweaksToCssVars(args.tweaks, args.before)),
  );
  const afterVars = new Map(
    Object.entries(resolveTweaksToCssVars(args.tweaks, args.after)),
  );
  const direct = Object.keys(args.after).flatMap((cssVar) => {
    const newValue = afterVars.get(cssVar);
    if (!isDirect(cssVar) || newValue === undefined) return [];
    const oldValue = beforeVars.get(cssVar) ?? "(source default)";
    if (oldValue === newValue) return [];
    return [
      {
        id: cssVar,
        label: cssVar,
        oldValue,
        newValue,
        cssVar,
      },
    ];
  });
  return [...declared, ...direct];
}

export function formatTweakHandoffPrompt(args: {
  designId: string;
  changes: TweakHandoffChange[];
  sourceFiles: string[];
}): string | undefined {
  if (args.changes.length === 0) return undefined;
  const targets = args.sourceFiles.length
    ? args.sourceFiles.map((file) => `- ${file}`).join("\n")
    : "- Locate the source files that define or consume these CSS variables.";
  const values = args.changes
    .map(
      (change) =>
        `- ${change.label} (id: \`${change.id}\`): ${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)}${change.cssVar ? `; CSS variable: \`${change.cssVar}\`` : ""}`,
    )
    .join("\n");
  return [
    `Apply the remix board changes from Design ${args.designId} to the source code.`,
    "Update the source defaults so the implementation starts with the new values, while preserving the editor's current preview.",
    "Changed tweaks:",
    values,
    "Likely source files:",
    targets,
    "Find the corresponding CSS custom properties or style declarations, update their defaults, and verify the running page matches the board. Do not change unrelated styles.",
  ].join("\n\n");
}
