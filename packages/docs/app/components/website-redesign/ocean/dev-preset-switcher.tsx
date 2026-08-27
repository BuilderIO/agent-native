// DEV-ONLY. Temporary A/B switcher for the hero ocean presets.
//
// To remove: delete this file, drop the <OceanPresetSwitcher /> from
// site-header.tsx and the useOceanPreset() call from hero-background.tsx, then
// delete setOceanPreset/currentOceanPreset from tuning.ts. Nothing else
// references it.
import { useCallback, useSyncExternalStore } from "react";

import { Select } from "../ds/select";
import {
  currentOceanPreset,
  OCEAN_PRESET_NAMES,
  setOceanPreset,
  type OceanPresetName,
} from "./tuning";

const listeners = new Set<() => void>();
let preset: OceanPresetName = currentOceanPreset();
// Bumped on every switch and used as the background's React key, so the ocean
// remounts and rebuilds its graph against the newly swapped tuning table.
let generation = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot() {
  return `${preset}:${generation}`;
}

function serverSnapshot() {
  return `${currentOceanPreset()}:0`;
}

/** Returns the active preset plus a key that changes on every switch. */
export function useOceanPreset(): {
  preset: OceanPresetName;
  remountKey: string;
} {
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [name] = value.split(":");
  return { preset: name as OceanPresetName, remountKey: value };
}

export function OceanPresetSwitcher() {
  const { preset: active } = useOceanPreset();

  const onChange = useCallback((next: OceanPresetName) => {
    setOceanPreset(next);
    preset = next;
    generation += 1;
    for (const listener of listeners) listener();
  }, []);

  if (!import.meta.env.DEV) return null;

  return (
    <div
      className="hidden w-[132px] lg:block"
      data-testid="ocean-preset-switcher"
    >
      <Select
        options={OCEAN_PRESET_NAMES.map((name) => ({
          label: `Ocean ${name.toUpperCase()}`,
          value: name,
        }))}
        value={active}
        onChange={onChange}
      />
    </div>
  );
}
