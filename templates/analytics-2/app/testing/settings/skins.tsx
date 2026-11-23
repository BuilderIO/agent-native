import {
  compareSettingsSnapshots,
  type SettingsBehaviorWitness,
  type SettingsSkinChoice,
  snapshotSettings,
  type SettingsSnapshotEntry,
} from "@agent-native/toolkit/app/settings/rows/snapshot";
import type { DesignSystemDefinition } from "@agent-native/toolkit/design-system";
import type { ReactNode } from "react";
import { expect } from "vitest";

import { designSystem } from "@/design-system";
export interface Mounted {
  container: HTMLDivElement;
  render: (ui: ReactNode) => void;
  unmount: () => void;
}

export interface SkinEvidence {
  skinChoices: SettingsSkinChoice[];
  witnesses: SettingsBehaviorWitness[];
}
export interface ChromeOperation {
  rid: string;
  key: string | null;
  operationRid: string;
  operationKey: string | null;
}

export interface SkinCase {
  /** Sets the mocked data; runs before each of the two renders. */
  arrange: () => void;
  ui: () => ReactNode;
  /** Brings the mounted panel to the state, the same way in both skins. */
  drive?: (mounted: Mounted) => void | Promise<void>;
  /** Read the whole document, for a state with a dialog open. */
  document?: boolean;
  expose?: (mounted: Mounted) => Promise<ChromeOperation[] | void>;
  evidence?: (
    mounted: Mounted,
    entries: SettingsSnapshotEntry[],
    skin: "reference" | "house",
  ) => Promise<SkinEvidence | undefined>;
}

export function createSkinHarness({
  referenceDesignSystem,
  mount,
}: {
  referenceDesignSystem: DesignSystemDefinition;
  mount: (ui: ReactNode, skin: DesignSystemDefinition) => Mounted;
}) {
  async function snapshotCase(
    skin: DesignSystemDefinition,
    { arrange, ui, drive, expose, evidence, document: wholeDocument }: SkinCase,
  ): Promise<{
    entries: SettingsSnapshotEntry[];
    evidence: SkinEvidence;
  }> {
    arrange();
    const mounted = mount(ui(), skin);
    try {
      await drive?.(mounted);
      const chrome = (await expose?.(mounted)) ?? [];
      const rendered = snapshotSettings(
        wholeDocument || expose ? document.body : mounted.container,
      );
      const observed = (await evidence?.(
        mounted,
        rendered,
        skin === referenceDesignSystem ? "reference" : "house",
      )) ?? {
        skinChoices: [],
        witnesses: [],
      };
      for (const mapping of chrome) {
        expect(
          rendered.some(
            (entry) => entry.rid === mapping.rid && entry.key === mapping.key,
          ),
        ).toBe(true);
        expect(
          rendered.some(
            (entry) =>
              entry.rid === mapping.operationRid &&
              entry.key === mapping.operationKey,
          ),
        ).toBe(true);
        expect(
          observed.skinChoices.some(
            (choice) =>
              choice.rid === mapping.operationRid &&
              choice.key === mapping.operationKey,
          ),
        ).toBe(true);
        expect(
          observed.witnesses.some(
            (witness) =>
              witness.rid === mapping.operationRid &&
              witness.key === mapping.operationKey,
          ),
        ).toBe(true);
      }
      // Exposed operation rows own the comparison; their separately exercised openers are skin chrome.
      const entries = rendered.filter(
        (entry) =>
          !chrome.some(
            (mapping) => entry.rid === mapping.rid && entry.key === mapping.key,
          ),
      );
      return { entries, evidence: observed };
    } finally {
      mounted.unmount();
      document.body.innerHTML = "";
    }
  }

  /** The semantic differences between the two skins for one state; `[]` means none. */
  async function skinDifferences(test: SkinCase): Promise<string[]> {
    const reference = await snapshotCase(referenceDesignSystem, test);
    const house = await snapshotCase(designSystem, test);
    expect(house.evidence.skinChoices).toEqual(reference.evidence.skinChoices);
    const result = compareSettingsSnapshots(reference.entries, house.entries, {
      skinChoices: reference.evidence.skinChoices,
      referenceWitnesses: reference.evidence.witnesses,
      houseWitnesses: house.evidence.witnesses,
    });
    expect(result.skinChoices).toEqual(reference.evidence.skinChoices ?? []);
    return result.differences;
  }

  return { skinDifferences };
}
