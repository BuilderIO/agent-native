import { createContext, useContext, type ComponentType } from "react";

import { useWholePart } from "../../../design-system/whole-parts.js";
import type { SettingsSectionsProps } from "./schema.js";

/**
 * Replaces the markup of every `SettingsSections` below it, ahead of the
 * design system's `settings` whole part. The renderer gets
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
  const provided = useContext(SettingsSectionsRendererContext);
  const whole = useWholePart("settings");
  return provided ?? whole ?? null;
}
