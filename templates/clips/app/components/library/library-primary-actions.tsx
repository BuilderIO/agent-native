import { useT } from "@agent-native/core/client/i18n";
import { IconCamera, IconVideoPlus } from "@tabler/icons-react";
import { NavLink } from "react-router";

import { ImportMenu } from "@/components/import-menu";
import { useScreenshotCapture } from "@/hooks/use-screenshot-capture";

import {
  buildLibraryActionHrefs,
  type LibraryActionScope,
} from "./library-action-hrefs";
import { PageHeaderActionGroup, PageHeaderPrimaryAction } from "./page-header";

type LibraryPrimaryActionsProps = LibraryActionScope;

/**
 * The Screenshots view's own header action.
 *
 * Capturing is a browser gesture, not a navigation, so this is a button rather
 * than the library's link-to-/record — and the Screenshots list would
 * otherwise be the one page with no way to add to it.
 */
export function ScreenshotPrimaryAction({
  folderId,
  spaceId,
}: LibraryPrimaryActionsProps) {
  const t = useT();
  const {
    captureScreenshot,
    isCapturing,
    overlay: screenshotOverlay,
  } = useScreenshotCapture({ folderId, spaceId });

  return (
    <PageHeaderActionGroup>
      <PageHeaderPrimaryAction
        onClick={captureScreenshot}
        disabled={isCapturing}
        aria-label={t("preRecord.takeScreenshot")}
      >
        <IconCamera />
        <span className="hidden sm:inline">
          {t("preRecord.takeScreenshot")}
        </span>
      </PageHeaderPrimaryAction>
      {screenshotOverlay}
    </PageHeaderActionGroup>
  );
}

export function LibraryPrimaryActions({
  folderId,
  spaceId,
}: LibraryPrimaryActionsProps) {
  const t = useT();
  const { recordHref, uploadHref, importLoomHref } = buildLibraryActionHrefs({
    folderId,
    spaceId,
  });
  // Screenshots land wherever the library is currently pointed, exactly like
  // a recording started from here.
  const {
    captureScreenshot,
    isCapturing,
    overlay: screenshotOverlay,
  } = useScreenshotCapture({
    folderId,
    spaceId,
  });

  return (
    <PageHeaderActionGroup>
      <PageHeaderPrimaryAction asChild>
        <NavLink to={recordHref} aria-label={t("navigation.newRecording")}>
          <IconVideoPlus />
          <span className="hidden sm:inline">
            {t("navigation.newRecording")}
          </span>
        </NavLink>
      </PageHeaderPrimaryAction>
      <ImportMenu
        uploadHref={uploadHref}
        onScreenshot={captureScreenshot}
        screenshotPending={isCapturing}
        importLoomHref={importLoomHref}
        spaceId={spaceId}
        folderId={folderId}
        recordHref={recordHref}
        iconOnly
        triggerIcon="chevron"
        size="sm"
        variant="default"
        className="w-8 self-stretch border-s border-primary-foreground/20 px-0 shadow-none"
        menuSide="bottom"
        menuAlign="end"
      />
      {screenshotOverlay}
    </PageHeaderActionGroup>
  );
}
