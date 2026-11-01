import { useT } from "@agent-native/core/client/i18n";
import { useLabState } from "@agent-native/core/client/labs";
import { CLIPS_SCREENSHOTS } from "@shared/labs";
import { Navigate } from "react-router";

import { LibraryGrid } from "@/components/library/library-grid";
import { ScreenshotPrimaryAction } from "@/components/library/library-primary-actions";
import { Button } from "@/components/ui/button";
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
  const lab = useLabState(CLIPS_SCREENSHOTS.key);
  if (lab.isLoading) return null;
  if (lab.isError) {
    return (
      <div role="alert" className="flex flex-col items-center gap-4 py-20">
        <p>{t("sharePage.somethingWentWrong")}</p>
        <Button onClick={lab.refetch}>{t("libraryGrid.retry")}</Button>
      </div>
    );
  }
  if (!lab.isSuccess) return null;
  if (!lab.enabled) return <Navigate replace to="/library" />;
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
