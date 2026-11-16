import type { TweakHandoffChange } from "./tweak-handoff";

export interface ApplyHandoffInput {
  remote?: { trusted: true; prompt: string; revision?: number };
  localVisualEdits: Array<{ id: string; prompt: string }>;
  localTweakChanges: TweakHandoffChange[];
  fullApp: { enabled: boolean; designId?: string };
}

export interface ApplyHandoff {
  prompt: string;
  includes: {
    remote: boolean;
    visualEditIds: string[];
    tweakIds: string[];
  };
}

export function composeApplyHandoff(input: ApplyHandoffInput): ApplyHandoff {
  const localVisualPrompt = input.localVisualEdits
    .map((edit) => edit.prompt)
    .filter(Boolean)
    .join("\n\n");
  const tweakPrompt = formatTweakChanges(
    input.localTweakChanges,
    input.fullApp.designId,
  );
  const sections = [
    input.fullApp.enabled
      ? [
          `This is a full-app design${input.fullApp.designId ? ` (designId "${input.fullApp.designId}")` : ""}: its screens run from a Builder branch container.`,
          "Apply these edits by calling send-builder-message with the designId and a prompt that describes every edit below precisely. It delegates to Builder and returns when the change is done.",
          "If this handoff has a revision, pass it as visualEditRevision so the handoff clears once the change lands.",
          "Do not use apply-visual-edit, localhost source tools or write consent. Those only exist for connected localhost apps.",
        ].join("\n")
      : "",
    input.remote?.prompt ?? "",
    localVisualPrompt,
    tweakPrompt,
  ].filter(Boolean);
  return {
    prompt: sections.join("\n\n"),
    includes: {
      remote: Boolean(input.remote),
      visualEditIds: input.localVisualEdits.map((edit) => edit.id),
      tweakIds: input.localTweakChanges.map((change) => change.id),
    },
  };
}

function formatTweakChanges(
  changes: TweakHandoffChange[],
  designId?: string,
): string {
  if (!changes.length) return "";
  const values = changes
    .map(
      (change) =>
        `- ${change.label} (id: \`${change.id}\`): ${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)}${change.cssVar ? `; CSS variable: \`${change.cssVar}\`` : ""}`,
    )
    .join("\n");
  return [
    `Apply the remix board changes${designId ? ` from Design ${designId}` : ""} to source code and verify the running page.`,
    "Locate the source files that define or consume the changed CSS variables; update their defaults without changing unrelated styles.",
    "Changed tweaks:",
    values,
    `After source verification, call acknowledge-visual-edit-pending with { designId: ${JSON.stringify(designId ?? "<design-id>")}, appliedTweaks: [${changes.map((change) => `{ id: ${JSON.stringify(change.id)}, value: ${JSON.stringify(change.newValue)} }`).join(", ")}] }. Include only tweak ids and values confirmed in source; omit any tweak that was not applied.`,
  ].join("\n\n");
}
