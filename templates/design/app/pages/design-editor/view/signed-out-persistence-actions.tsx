import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

import type { EditorCore } from "../domains/use-editor-core";
import type { EditorFilesAndSaving } from "../domains/use-editor-files-and-saving";
import { buildSignInHrefForDesignIntent } from "../editor-helpers";

export function renderSignedOutPersistenceActions({
  editorCore,
  editorFilesAndSaving,
  signInToShareHref,
}: {
  editorCore: EditorCore;
  editorFilesAndSaving: EditorFilesAndSaving;
  signInToShareHref: string;
}) {
  const { t } = editorCore;
  const { hasLocalhostScreens } = editorFilesAndSaving;

  const signInToSaveHref = buildSignInHrefForDesignIntent("save");

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            variant="secondary"
            size="sm"
            className="min-w-0 shrink cursor-pointer gap-1.5 rounded-md bg-[var(--design-editor-panel-raised-bg)] text-sm shadow-none"
            aria-label={t("designEditor.signUpToSave")}
          >
            <a href={signInToSaveHref}>
              <span className="truncate">{t("designEditor.signUpToSave")}</span>
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("designEditor.signUpToSave")}</TooltipContent>
      </Tooltip>
      {hasLocalhostScreens ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="default"
              size="sm"
              className="cursor-pointer gap-1.5 rounded-md !border-[var(--design-editor-accent-color)] !bg-[var(--design-editor-accent-color)] text-sm !text-[var(--design-editor-accent-contrast-color)] shadow-none hover:!border-[var(--design-editor-accent-hover-color)] hover:!bg-[var(--design-editor-accent-hover-color)] hover:!text-[var(--design-editor-accent-contrast-color)] focus-visible:ring-[var(--design-editor-accent-color)]"
              aria-label={t("designEditor.share")}
            >
              {t("designEditor.share")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-2">
            <Button
              asChild
              variant="link"
              size="sm"
              className="h-auto whitespace-normal px-1 text-left"
            >
              <a href={signInToShareHref}>
                {t("designEditor.signUpToShareLiveCanvas")}
              </a>
            </Button>
          </PopoverContent>
        </Popover>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              variant="default"
              size="sm"
              className="cursor-pointer gap-1.5 rounded-md !border-[var(--design-editor-accent-color)] !bg-[var(--design-editor-accent-color)] text-sm !text-[var(--design-editor-accent-contrast-color)] shadow-none hover:!border-[var(--design-editor-accent-hover-color)] hover:!bg-[var(--design-editor-accent-hover-color)] hover:!text-[var(--design-editor-accent-contrast-color)] focus-visible:ring-[var(--design-editor-accent-color)]"
              aria-label={t("designEditor.share")}
            >
              <a href={signInToShareHref}>
                <span>{t("designEditor.share")}</span>
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("designEditor.signUpToShare")}</TooltipContent>
        </Tooltip>
      )}
    </>
  );
}
