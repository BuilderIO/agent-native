import { useT } from "@agent-native/core/client/i18n";

import { LibraryGrid } from "@/components/library/library-grid";
import { ScreenshotPrimaryAction } from "@/components/library/library-primary-actions";
import enMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enMessages.navigation.screenshots }];
}

/**
 * The same library, narrowed to screenshots.
 *
 * Screenshots are ordinary recordings, so they keep appearing in the main
 * library alongside clips; this view exists for when you want only the stills.
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
