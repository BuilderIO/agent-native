import { useT } from "@agent-native/core/client/i18n";
import {
  VisibilityBadge as ToolkitVisibilityBadge,
  type VisibilityBadgeLabels,
  type VisibilityBadgeProps as ToolkitVisibilityBadgeProps,
} from "@agent-native/toolkit/sharing";

export type { VisibilityBadgeLabels };

export type VisibilityBadgeProps = Omit<
  ToolkitVisibilityBadgeProps,
  "labels"
> & {
  labels?: Partial<VisibilityBadgeLabels>;
};

export function useVisibilityBadgeLabels(): VisibilityBadgeLabels {
  const t = useT();
  return {
    private: t("agentChat.share.private", { defaultValue: "Private" }),
    org: t("agentChat.share.organization", { defaultValue: "Organization" }),
    public: t("agentChat.share.public", { defaultValue: "Public" }),
  };
}

/** Always passes catalog labels, so the pure English fallback never shows. */
export function VisibilityBadge({ labels, ...props }: VisibilityBadgeProps) {
  const defaults = useVisibilityBadgeLabels();
  return (
    <ToolkitVisibilityBadge {...props} labels={{ ...defaults, ...labels }} />
  );
}
