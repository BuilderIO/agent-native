import { useT } from "@agent-native/core/client/i18n";

import { LibraryGrid } from "@/components/library/library-grid";
import enMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enMessages.clipsFinalRaw.fromContentPageTitle }];
}

export default function FromContentRoute() {
  const t = useT();
  return (
    <LibraryGrid
      view="from-content"
      emptyKind="fromContent"
      title={t("navigation.fromContent")}
    />
  );
}
