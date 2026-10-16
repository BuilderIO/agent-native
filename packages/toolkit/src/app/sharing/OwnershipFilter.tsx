import { useT } from "@agent-native/core/client/i18n";
import {
  OwnershipFilter as ToolkitOwnershipFilter,
  type OwnershipFilterLabels,
  type OwnershipFilterProps as ToolkitOwnershipFilterProps,
} from "@agent-native/toolkit/sharing";

export type { OwnershipFilterLabels };

export type OwnershipFilterProps = Omit<
  ToolkitOwnershipFilterProps,
  "labels"
> & {
  labels?: Partial<OwnershipFilterLabels>;
};

export function useOwnershipFilterLabels(): OwnershipFilterLabels {
  const t = useT();
  return {
    all: t("agentChat.share.ownedByAnyone", {
      defaultValue: "Owned by anyone",
    }),
    mine: t("agentChat.share.ownedByMe", { defaultValue: "Owned by me" }),
    shared: t("agentChat.share.sharedWithMe", {
      defaultValue: "Shared with me",
    }),
  };
}

export function OwnershipFilter({ labels, ...props }: OwnershipFilterProps) {
  const defaults = useOwnershipFilterLabels();
  return (
    <ToolkitOwnershipFilter {...props} labels={{ ...defaults, ...labels }} />
  );
}
