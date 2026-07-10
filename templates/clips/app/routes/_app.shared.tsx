import { useT } from "@agent-native/core/client";

import { LibraryGrid } from "@/components/library/library-grid";
import enMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: `${enMessages.navigation.sharedWithMe} · Clips` }];
}

export default function SharedWithMeRoute() {
  const t = useT();

  return (
    <LibraryGrid
      view="shared"
      emptyKind="shared"
      title={t("navigation.sharedWithMe")}
    />
  );
}
