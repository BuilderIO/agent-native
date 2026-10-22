import { useT } from "@agent-native/core/client/i18n";
import { FeedbackButton } from "@agent-native/toolkit/app/feedback";
import { openCommandMenu } from "@agent-native/toolkit/app/shared";
import { IconArrowLeft, IconSearch } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { SlideCanvasCommands } from "./SlideEditor";

const DOCS_URL = "https://www.agent-native.com/docs/";

export interface AppMenuProps {
  widgetEmbed: boolean;
  canEdit: boolean;
  exportMenu: ReactNode;
  importing: boolean;
  onImportFile: () => void;
  onDuplicateDeck?: () => void;
  onDownloadBackup?: () => void;
  onShowHistory: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canvasCommandsRef?: { current: SlideCanvasCommands | null };
  onDuplicateSlides?: () => void;
  onDeleteSlides?: () => void;
  onPreviousSlide?: () => void;
  onNextSlide?: () => void;
}

function AgentNativeMenuMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="-5 -5 145 88"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M29.0771 77.8838H2.5L18.9 48.9L43.2 6.6C44 5.2 45.9 5.2 46.7 6.6L69.1 44.2C69.9 45.5 69 46.7305 67.5 46.7305H48.3C47.6 46.7305 46.9 47.1 46.6 47.7L30.8 76.9C30.45 77.5 29.8 77.8838 29.0771 77.8838Z"
        stroke="currentColor"
        strokeWidth="10.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M105.927 0H132.5C134 0 134.9 1.6 134.15 2.9L91.5 76.9C91.15 77.5 90.5 77.8853 89.8 77.8853H63.8C62.3 77.8853 61.4 76.3 62.15 75L104.2 1C104.55 0.38 105.2 0 105.927 0Z"
        stroke="currentColor"
        strokeWidth="10.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AppMenu({
  widgetEmbed,
  canEdit,
  exportMenu,
  importing,
  onImportFile,
  onDuplicateDeck,
  onDownloadBackup,
  onShowHistory,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  canvasCommandsRef,
  onDuplicateSlides,
  onDeleteSlides,
  onPreviousSlide,
  onNextSlide,
}: AppMenuProps) {
  const t = useT();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const openFeedbackOnCloseRef = useRef(false);
  const commandKey =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
      ? "⌘K"
      : "Ctrl K";
  // Read while open: the menu re-renders on open, so these reflect the canvas
  // at the moment the user looks at them.
  const canvas = open ? canvasCommandsRef?.current : null;
  const hasObjectSelection = canvas?.hasObjectSelection() ?? false;
  const canDuplicateSelection =
    canEdit && (hasObjectSelection || Boolean(onDuplicateSlides));
  const canDeleteSelection =
    canEdit && (hasObjectSelection || Boolean(onDeleteSlides));
  const itemClass = "cursor-pointer";

  return (
    <div className="relative flex shrink-0">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 cursor-pointer rounded-md text-foreground hover:bg-accent"
            aria-label={t("appMenu.label")}
          >
            <AgentNativeMenuMark className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[220px]"
          onCloseAutoFocus={(event) => {
            if (!openFeedbackOnCloseRef.current) return;
            // Focus returning to the trigger would read as an outside
            // interaction and dismiss the popover the moment it opens.
            event.preventDefault();
            openFeedbackOnCloseRef.current = false;
            setFeedbackOpen(true);
          }}
        >
          <DropdownMenuItem className={itemClass} onSelect={openCommandMenu}>
            <IconSearch className="size-4" />
            {t("appMenu.actions")}
            <DropdownMenuShortcut>{commandKey}</DropdownMenuShortcut>
          </DropdownMenuItem>
          {!widgetEmbed && (
            <DropdownMenuItem asChild className={itemClass}>
              <Link to="/home">
                <IconArrowLeft className="size-4" />
                {t("appMenu.backToDashboard")}
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {!widgetEmbed && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={itemClass}>
                {t("appMenu.file")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                <DropdownMenuItem
                  className={itemClass}
                  disabled={!onDuplicateDeck}
                  onSelect={onDuplicateDeck}
                >
                  {t("editorExport.duplicateDeck")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className={itemClass}
                  disabled={importing}
                  onSelect={onImportFile}
                >
                  {importing
                    ? t("editorToolbar.importing")
                    : t("appMenu.importFile")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {exportMenu}
                <DropdownMenuItem
                  className={itemClass}
                  disabled={!onDownloadBackup}
                  onSelect={onDownloadBackup}
                >
                  {t("appMenu.saveLocalCopy")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={itemClass}
                  onSelect={onShowHistory}
                >
                  {t("appMenu.versionHistory")}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={itemClass}>
              {t("appMenu.edit")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              <DropdownMenuItem
                className={itemClass}
                disabled={!onUndo || !canUndo}
                onSelect={onUndo}
              >
                {t("editorToolbar.undo")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className={itemClass}
                disabled={!onRedo || !canRedo}
                onSelect={onRedo}
              >
                {t("editorToolbar.redo")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={itemClass}
                disabled={!canDuplicateSelection}
                onSelect={() => {
                  if (hasObjectSelection) canvas?.duplicateObjects();
                  else onDuplicateSlides?.();
                }}
              >
                {t("appMenu.duplicateSelection")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className={`${itemClass} text-destructive focus:text-destructive`}
                disabled={!canDeleteSelection}
                onSelect={() => {
                  if (hasObjectSelection) canvas?.deleteObjects();
                  else onDeleteSlides?.();
                }}
              >
                {t("appMenu.deleteSelection")}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={itemClass}>
              {t("appMenu.view")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              <DropdownMenuItem
                className={itemClass}
                disabled={!canvas?.canZoomIn}
                onSelect={canvas?.zoomIn}
              >
                {t("appMenu.zoomIn")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className={itemClass}
                disabled={!canvas?.canZoomOut}
                onSelect={canvas?.zoomOut}
              >
                {t("appMenu.zoomOut")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={itemClass}
                disabled={!onPreviousSlide}
                onSelect={onPreviousSlide}
              >
                {t("appMenu.previousSlide")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className={itemClass}
                disabled={!onNextSlide}
                onSelect={onNextSlide}
              >
                {t("appMenu.nextSlide")}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={itemClass}>
              {t("appMenu.preferences")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className={itemClass}>
                  {t("appMenu.appearance")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48">
                  <DropdownMenuRadioGroup
                    value={theme ?? "system"}
                    onValueChange={setTheme}
                  >
                    <DropdownMenuRadioItem
                      value="light"
                      indicator="check"
                      className={itemClass}
                    >
                      {t("appMenu.themeLight")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      value="dark"
                      indicator="check"
                      className={itemClass}
                    >
                      {t("appMenu.themeDark")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      value="system"
                      indicator="check"
                      className={itemClass}
                    >
                      {t("appMenu.themeSystem")}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {!widgetEmbed && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={itemClass}>
                {t("appMenu.help")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                <DropdownMenuItem asChild className={itemClass}>
                  <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
                    {t("appMenu.documentation")}
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className={itemClass}>
                  <Link to="/settings/whats-new">{t("appMenu.whatsNew")}</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className={itemClass}
                  onSelect={() => {
                    openFeedbackOnCloseRef.current = true;
                  }}
                >
                  {t("appMenu.sendFeedback")}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {!widgetEmbed && (
        <FeedbackButton
          open={feedbackOpen}
          onOpenChange={setFeedbackOpen}
          side="bottom"
          align="start"
          trigger={
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-0"
            />
          }
        />
      )}
    </div>
  );
}
