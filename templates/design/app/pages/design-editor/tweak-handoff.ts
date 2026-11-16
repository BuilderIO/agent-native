import type { TweakDefinition } from "@shared/api";
import { isSafeCssVarName } from "@shared/resolve-tweaks";
import type { TweakSelections } from "@shared/resolve-tweaks";

export interface TweakHandoffChange {
  id: string;
  label: string;
  oldValue: string | number | boolean;
  newValue: string | number | boolean;
  cssVar?: string;
}

function getSelectionValue(
  selections: TweakSelections,
  key: string,
): string | number | boolean | undefined {
  if (!Object.prototype.hasOwnProperty.call(selections, key)) return undefined;
  return selections[key];
}

export function getTweakHandoffChanges(args: {
  tweaks: TweakDefinition[];
  before: TweakSelections;
  after: TweakSelections;
}): TweakHandoffChange[] {
  const declared = args.tweaks.flatMap((tweak) => {
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
  const declaredVars = new Set(
    args.tweaks.flatMap((tweak) => (tweak.cssVar ? [tweak.cssVar] : [])),
  );
  const direct = Object.entries(args.after).flatMap(([cssVar, newValue]) => {
    if (!isSafeCssVarName(cssVar) || declaredVars.has(cssVar)) return [];
    const oldValue = getSelectionValue(args.before, cssVar);
    if (oldValue !== undefined && Object.is(oldValue, newValue)) return [];
    return [
      {
        id: cssVar,
        label: cssVar,
        oldValue: oldValue ?? "(source default)",
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
