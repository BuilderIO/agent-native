import { useT } from "@agent-native/core/client/i18n";
import { useMemo } from "react";

import {
  lazyGroups,
  type NamespaceKey,
  type Translate,
} from "@/lib/typed-translate";

type PickerKey = NamespaceKey<"providerPicker">;

/** Every string the provider pickers show, read from the `providerPicker.*` catalog keys. */
export function createPickerStrings(t: Translate<PickerKey>) {
  return lazyGroups({
    choose: () => ({
      channels: t("providerPicker.choose.channels"),
      repositories: t("providerPicker.choose.repositories"),
      organizations: t("providerPicker.choose.organizations"),
      projects: t("providerPicker.choose.projects"),
    }),
    search: () => t("providerPicker.search"),
    useTyped: () => (value: string) => t("providerPicker.useTyped", { value }),
    noMatches: () => t("providerPicker.noMatches"),
    loadMore: () => t("providerPicker.loadMore"),
    retry: () => t("providerPicker.retry"),
    changeOrganization: () => t("providerPicker.changeOrganization"),
    tag: () => ({
      private: t("providerPicker.tag.private"),
      bot_not_member: t("providerPicker.tag.botNotMember"),
      archived: t("providerPicker.tag.archived"),
    }),
    error: () => ({
      notConnected: (provider: string) =>
        t("providerPicker.error.notConnected", { provider }),
      refused: (provider: string) =>
        t("providerPicker.error.refused", { provider }),
      missingScope: (provider: string, scope: string) =>
        t("providerPicker.error.missingScope", { provider, scope }),
      rateLimited: (provider: string) =>
        t("providerPicker.error.rateLimited", { provider }),
      unreadable: (provider: string) =>
        t("providerPicker.error.unreadable", { provider }),
    }),
  });
}

export function usePickerStrings() {
  const t = useT();
  return useMemo(() => createPickerStrings(t), [t]);
}
