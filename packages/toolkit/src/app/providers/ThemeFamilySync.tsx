import { useThemeFamily } from "@agent-native/core/client/ui";
import { useLayoutEffect } from "react";

import { THEME_FAMILY_PENDING_ATTRIBUTE } from "./theme-family-prepaint.js";

export default function ThemeFamilySync() {
  const { status } = useThemeFamily();

  useLayoutEffect(() => {
    if (status !== "loading") {
      document.documentElement.removeAttribute(THEME_FAMILY_PENDING_ATTRIBUTE);
    }
  }, [status]);

  return null;
}
