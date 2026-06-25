import { useT } from "@agent-native/core/client";

import { LibraryGrid } from "@/components/library/library-grid";
import enMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enMessages.clipsFinalRaw.archivePageTitle }];
}

export default function ArchiveRoute() {
  const t = useT();
  return (
    <LibraryGrid
      view="archive"
      emptyKind="archive"
      title={t("navigation.archive")}
    />
  );
}
