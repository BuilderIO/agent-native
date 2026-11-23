import { defineDesignSystem } from "@agent-native/toolkit/design-system";
import { useSkinPreference } from "@agent-native/toolkit/design-system/skin-preference";

import { designSystem } from "../../design-system.js";
import { referenceParts } from "./parts";
import { referenceTheme } from "./theme";

export { referenceDesignSystem } from "./definition";

const runtimeDesignSystem = defineDesignSystem({
  ...designSystem,
  theme: referenceTheme,
  parts: referenceParts,
});
const SKINS = ["reference", "house"] as const;

export function useAppDesignSystem() {
  const skin = useSkinPreference(SKINS, "reference");
  return skin === "house" ? designSystem : runtimeDesignSystem;
}
