import { createContext, useContext, type ComponentType } from "react";

import type { SettingsSectionsProps } from "./schema.js";

/**
 * Replaces the markup of every `SettingsSections` below it. The renderer gets
 * the resolved sections and owns look only: values, writes, visibility and
 * disabled state stay in the row model, so a renderer must tag rows with
 * `settingsTags` and write through each row's binding.
 */
export type SettingsSectionsRenderer = ComponentType<SettingsSectionsProps>;

const SettingsSectionsRendererContext =
  createContext<SettingsSectionsRenderer | null>(null);

export const SettingsSectionsRendererProvider =
  SettingsSectionsRendererContext.Provider;

export function useSettingsSectionsRenderer(): SettingsSectionsRenderer | null {
  return useContext(SettingsSectionsRendererContext);
}
