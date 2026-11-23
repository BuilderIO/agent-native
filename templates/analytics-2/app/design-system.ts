import { defineDesignSystem } from "@agent-native/toolkit/design-system";

export const designSystem = defineDesignSystem({ name: "analytics-2" });

export function useAppDesignSystem() {
  return designSystem;
}
