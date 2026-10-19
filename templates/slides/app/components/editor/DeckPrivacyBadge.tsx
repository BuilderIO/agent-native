import { useT } from "@agent-native/core/client/i18n";
import { IconLock, IconUsersGroup, IconWorld } from "@tabler/icons-react";

import type { Deck } from "@/context/DeckContext";

const PRIVACY = {
  private: { Icon: IconLock, labelKey: "editorToolbar.privacyPrivate" },
  org: { Icon: IconUsersGroup, labelKey: "editorToolbar.privacyOrg" },
  public: { Icon: IconWorld, labelKey: "editorToolbar.privacyPublic" },
} as const;

// A deck whose visibility is not known yet shows no badge: "Private" would
// claim a privacy the editor has not confirmed.
export function DeckPrivacyBadge({
  visibility,
}: {
  visibility: Deck["visibility"];
}) {
  const t = useT();
  if (!visibility || !(visibility in PRIVACY)) return null;
  const { Icon, labelKey } = PRIVACY[visibility];
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground max-sm:hidden">
      <Icon className="size-2.5" aria-hidden="true" />
      {t(labelKey)}
    </span>
  );
}
