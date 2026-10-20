import { useT } from "@agent-native/core/client/i18n";

import { LibraryGrid } from "@/components/library/library-grid";
import { ScreenshotPrimaryAction } from "@/components/library/library-primary-actions";
import enMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enMessages.navigation.screenshots }];
}

/**
 * The library's screenshots that are not filed anywhere.
 *
 * The main Library lists clips only. A screenshot filed in a folder or a
 * space is listed there instead, alongside the clips in it.
 */
export default function ScreenshotsRoute() {
  const t = useT();
  return (
    <LibraryGrid
      view="library"
      kind="image"
      emptyKind="library"
      title={t("navigation.screenshots")}
      extraActions={<ScreenshotPrimaryAction />}
    />
  );
}
