import {
  handoffRecordSlot,
  sameHandoffRecordValue,
  type VisualEditHandoffRecord,
} from "@shared/visual-edit-handoff";

import type { TweakHandoffChange } from "./tweak-handoff";

export type { VisualEditHandoffRecord };

export interface ApplyHandoffInput {
  /** The durable handoff row, when the editor applies it. */
  remote?: { revision?: number; records: VisualEditHandoffRecord[] };
  /** This editor's pending changes. */
  local: VisualEditHandoffRecord[];
  fullApp: { enabled: boolean; designId?: string };
}

export interface ApplyHandoff {
  prompt: string;
  /** Every record the prompt delivers, local and remote. */
  records: VisualEditHandoffRecord[];
  remote: boolean;
}

export function styleHandoffRecord(
  key: string,
  prompt: string,
): VisualEditHandoffRecord {
  return { kind: "style", key, value: promptDigest(prompt), prompt };
}

export function tweakHandoffRecord(
  change: TweakHandoffChange,
): VisualEditHandoffRecord {
  return {
    kind: "tweak",
    key: change.id,
    value: change.newValue,
    prompt: `- ${change.label} (id: \`${change.id}\`): ${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)}${change.cssVar ? `; CSS variable: \`${change.cssVar}\`` : ""}`,
  };
}

export function isSameHandoffRecord(
  a: VisualEditHandoffRecord,
  b: VisualEditHandoffRecord,
): boolean {
  return (
    a.kind === b.kind &&
    a.key === b.key &&
    sameHandoffRecordValue(a.value, b.value)
  );
}

/** The local records a delivered handoff carried, matched by key and value. */
export function deliveredLocalRecords(
  handoff: ApplyHandoff,
  local: VisualEditHandoffRecord[],
): VisualEditHandoffRecord[] {
  return local.filter((record) =>
    handoff.records.some((delivered) => isSameHandoffRecord(delivered, record)),
  );
}

export function getDurableApplyHandoff(handoff: ApplyHandoff) {
  return handoff.records.length > 0
    ? {
        pendingEditCount: handoff.records.length,
        prompt: handoff.prompt,
        records: handoff.records,
      }
    : null;
}

/**
 * One record per change: a local record replaces the remote record in the same
 * slot, because the local value is the newer one. Each record brings its own
 * prompt, so the composed text always describes exactly `records`.
 */
export function composeApplyHandoff(input: ApplyHandoffInput): ApplyHandoff {
  const localSlots = new Set(input.local.map(handoffRecordSlot));
  const records = [
    ...(input.remote?.records ?? []).filter(
      (record) => !localSlots.has(handoffRecordSlot(record)),
    ),
    ...input.local,
  ];
  const tweaks = records.filter((record) => record.kind === "tweak");
  const revision = input.remote?.revision;
  const sections = [
    input.fullApp.enabled
      ? [
          `This is a full-app design${input.fullApp.designId ? ` (designId "${input.fullApp.designId}")` : ""}: its screens run from a Builder branch container.`,
          "Apply these edits by calling send-builder-message with the designId and a prompt that describes every edit below precisely. It delegates to Builder and returns when the change is done.",
          "If this handoff has a revision, pass it as visualEditRevision so the handoff clears once the change lands.",
          "Do not use apply-visual-edit, localhost source tools or write consent. Those only exist for connected localhost apps.",
        ].join("\n")
      : "",
    ...records
      .filter((record) => record.kind === "style")
      .map((record) => record.prompt),
    formatTweakSection(
      tweaks,
      input.fullApp.designId,
      revision,
      input.fullApp.enabled,
    ),
    input.remote && revision !== undefined && tweaks.length === 0
      ? `After applying and verifying these source changes, acknowledge only revision ${revision} with acknowledge-visual-edit-pending, then call get-visual-edit-pending again to verify it cleared.`
      : "",
  ].filter(Boolean);
  return {
    prompt: sections.join("\n\n"),
    records,
    remote: Boolean(input.remote),
  };
}

function formatTweakSection(
  tweaks: VisualEditHandoffRecord[],
  designId?: string,
  revision?: number,
  fullAppRouting = false,
): string {
  if (!tweaks.length) return "";
  const useBuilderRouting = fullAppRouting && Boolean(designId);
  return [
    useBuilderRouting
      ? `Include these remix board tweaks in the send-builder-message prompt for Design ${designId}. Do not use localhost source tools.`
      : "Apply the remix board changes to source code and verify the running page.",
    ...(useBuilderRouting
      ? []
      : [
          "Locate the source files that define or consume the changed CSS variables; update their defaults without changing unrelated styles.",
        ]),
    "Changed tweaks:",
    tweaks.map((record) => record.prompt).join("\n"),
    `After source verification, call acknowledge-visual-edit-pending with { designId: ${JSON.stringify(designId ?? "<design-id>")}, ${revision === undefined ? "revision: <exact-handoff-revision>, " : `revision: ${revision}, `}appliedTweaks: [${tweaks.map((record) => `{ id: ${JSON.stringify(record.key)}, value: ${JSON.stringify(record.value)} }`).join(", ")}] }. Include only tweak ids and values confirmed in source; omit any tweak that was not applied.`,
  ].join("\n\n");
}

function promptDigest(prompt: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < prompt.length; index += 1) {
    hash ^= prompt.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prompt.length}:${(hash >>> 0).toString(16)}`;
}
