import type { useT } from "@agent-native/core/client/i18n";
import type { AppOpenActionLabels } from "@agent-native/toolkit/app/chat/chat-first/app-open-actions";

export {
  AppOpenActions,
  type AppOpenActionLabels,
  type AppOpenActionMenuItem,
} from "@agent-native/toolkit/app/chat/chat-first/app-open-actions";

/** Dispatch's localized labels for an app row's Open actions. */
export function appOpenActionLabels(
  t: ReturnType<typeof useT>,
  name: string,
): Partial<AppOpenActionLabels> {
  return {
    openApp: t("dispatch.pages.openApp", { defaultValue: "Open" }),
    openAppAccessible: t("dispatch.pages.chatFirstOpenApp", { name }),
    openInNewTab: t("dispatch.pages.chatFirstOpenInNewTab"),
    moreOptions: t("extensions.optionsFor", { name }),
  };
}
