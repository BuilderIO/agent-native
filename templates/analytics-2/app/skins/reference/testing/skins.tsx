import {
  diffSettingsSnapshots,
  snapshotSettings,
  type SettingsSnapshotEntry,
} from "@agent-native/toolkit/app/settings/rows/snapshot";
import type { DesignSystemDefinition } from "@agent-native/toolkit/design-system";
import type { ReactNode } from "react";

import { designSystem } from "@/design-system";
import { referenceDesignSystem } from "@/skins/reference/design-system";

import { mount, type Mounted } from "./mount";

export const SKINS: readonly (readonly [string, DesignSystemDefinition])[] = [
  ["reference", referenceDesignSystem],
  ["house", designSystem],
];

export interface SkinCase {
  /** Sets the mocked data; runs before each of the two renders. */
  arrange: () => void;
  ui: () => ReactNode;
  /** Brings the mounted panel to the state, the same way in both skins. */
  drive?: (mounted: Mounted) => void | Promise<void>;
  /** Read the whole document, for a state with a dialog open. */
  document?: boolean;
}

async function snapshotCase(
  skin: DesignSystemDefinition,
  { arrange, ui, drive, document: wholeDocument }: SkinCase,
): Promise<SettingsSnapshotEntry[]> {
  arrange();
  const mounted = mount(ui(), skin);
  try {
    await drive?.(mounted);
    return snapshotSettings(wholeDocument ? document.body : mounted.container);
  } finally {
    mounted.unmount();
    document.body.innerHTML = "";
  }
}

/** The semantic differences between the two skins for one state; `[]` means none. */
export async function skinDifferences(test: SkinCase): Promise<string[]> {
  const reference = await snapshotCase(referenceDesignSystem, test);
  const house = await snapshotCase(designSystem, test);
  return diffSettingsSnapshots(reference, house);
}

function interactive(tagged: Element): HTMLElement {
  const target = tagged.matches("button, input, textarea, a")
    ? tagged
    : tagged.querySelector("button, input, textarea, a");
  if (!target) {
    throw new Error(`nothing to operate in ${tagged.getAttribute("data-rid")}`);
  }
  return target as HTMLElement;
}

/** A tagged element by row id and part, and by entity key for a collection item. */
export function tagged(
  root: ParentNode,
  rid: string,
  part: string,
  key?: string,
): Element {
  const selector =
    `[data-rid="${rid}"][data-part="${part}"]` +
    (key === undefined ? "" : `[data-rid-key="${key}"]`);
  const found = root.querySelector(selector);
  if (!found) throw new Error(`no element for ${selector}`);
  return found;
}

/** The control of a row: the tagged element itself, or the first button, input or link inside it. */
export function rowControl(root: ParentNode, rid: string): HTMLElement {
  return interactive(tagged(root, rid, "settings.row.control"));
}

/** The control of any other tagged part, found the same way. */
export function partControl(
  root: ParentNode,
  rid: string,
  part: string,
  key?: string,
): HTMLElement {
  return interactive(tagged(root, rid, part, key));
}
