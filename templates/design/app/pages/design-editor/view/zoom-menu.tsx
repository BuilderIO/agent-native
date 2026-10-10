import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { EditorActiveScreenAndGeometry } from "../domains/use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "../domains/use-editor-canvas-and-screens";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorLayoutAndStructure } from "../domains/use-editor-layout-and-structure";
import type { EditorModes } from "../domains/use-editor-modes";
import type { EditorScreenRendering } from "../domains/use-editor-screen-rendering";

const ZOOM_MENU_ROW_CLASS = "h-6 px-2 py-0 text-[12px]";

function ZoomMenuRow({
  label,
  checked,
  shortcut,
  disabled,
  onSelect,
}: {
  label: ReactNode;
  checked?: boolean;
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      onClick={onSelect}
      disabled={disabled}
      className={ZOOM_MENU_ROW_CLASS}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {checked ? <IconCheck className="size-3.5" /> : null}
      </span>
      <span className="flex-1">{label}</span>
      {shortcut ? (
        <DropdownMenuShortcut className="tracking-normal">
          {shortcut}
        </DropdownMenuShortcut>
      ) : null}
    </DropdownMenuItem>
  );
}

export function renderZoomMenu({
  editorCore,
  editorActiveScreenAndGeometry,
  editorCanvasAndScreens,
  editorLayoutAndStructure,
  editorModes,
  editorScreenRendering,
  controlId,
}: {
  editorCore: EditorCore;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorCanvasAndScreens: EditorCanvasAndScreens;
  editorLayoutAndStructure: EditorLayoutAndStructure;
  editorModes: EditorModes;
  editorScreenRendering: EditorScreenRendering;
  controlId: "toolbar" | "inspector" | "topbar";
}) {
  const { t, shortcut, viewMode } = editorCore;
  const { handleZoomIn, handleZoomOut, setZoom } =
    editorActiveScreenAndGeometry;
  const { handleZoomToFit } = editorCanvasAndScreens;
  const { suppressOverviewPopForExplicitZoomRef } = editorModes;
  const {
    viewSettings: {
      pixelGrid,
      snapToPixelGrid,
      rulers,
      multiplayerCursors,
      commentsHidden,
    },
    toggleViewSetting,
    handleToggleComments,
  } = editorLayoutAndStructure;
  const {
    openZoomControl,
    setZoomInputValue,
    zoomLabel,
    zoomInputDigits,
    setOpenZoomControl,
    zoomInputValue,
    commitZoomInput,
  } = editorScreenRendering;

  return (
    <DropdownMenu
      open={openZoomControl === controlId}
      onOpenChange={(open) => {
        if (open) {
          setZoomInputValue(zoomInputDigits);
          setOpenZoomControl(controlId);
          return;
        }
        setOpenZoomControl((current) =>
          current === controlId ? null : current,
        );
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 cursor-pointer tabular-nums text-muted-foreground hover:text-foreground",
                controlId === "topbar"
                  ? "gap-1 rounded-md border border-border px-2 text-xs font-normal text-foreground"
                  : "gap-0.5 px-1 text-[10px]",
              )}
            >
              {zoomLabel}
              <IconChevronDown
                className={cn(
                  "opacity-60",
                  controlId === "topbar" ? "size-3" : "size-2.5",
                )}
              />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("designEditor.zoom")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="design-editor-app-menu-content w-52 rounded-lg bg-[var(--design-editor-panel-bg)] p-1"
      >
        <div className="px-1 pb-1 pt-0.5">
          <div className="flex h-7 items-center rounded-[5px] border border-[var(--design-editor-accent-color)] bg-[var(--design-editor-control-bg)] px-2 text-[12px] font-medium tabular-nums text-foreground focus-within:ring-1 focus-within:ring-[var(--design-editor-accent-color)]">
            <Input
              autoFocus
              inputMode="numeric"
              value={zoomInputValue}
              onChange={(event) =>
                setZoomInputValue(
                  event.target.value.split(/[.,]/)[0].replace(/\D/g, ""),
                )
              }
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitZoomInput();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setZoomInputValue(zoomInputDigits);
                  setOpenZoomControl(null);
                }
              }}
              style={{ width: `${Math.max(zoomInputValue.length, 1)}ch` }}
              className="h-auto min-w-0 rounded-none border-0 bg-transparent p-0 text-[12px] font-medium shadow-none focus-visible:ring-0"
              aria-label={"Zoom percentage" /* i18n-ignore zoom field */}
            />
            <span aria-hidden="true">%</span>
          </div>
        </div>
        <DropdownMenuSeparator />
        <ZoomMenuRow
          label={"Zoom in" /* i18n-ignore */}
          shortcut={shortcut("$mod+=")}
          onSelect={handleZoomIn}
        />
        <ZoomMenuRow
          label={"Zoom out" /* i18n-ignore */}
          shortcut={shortcut("$mod+-")}
          onSelect={handleZoomOut}
        />
        <ZoomMenuRow
          label={"Zoom to fit" /* i18n-ignore */}
          shortcut={shortcut("shift+1")}
          onSelect={handleZoomToFit}
        />
        {[50, 100, 200].map((preset) => (
          <ZoomMenuRow
            key={preset}
            label={
              <>
                {"Zoom to " /* i18n-ignore */}
                {preset}%
              </>
            }
            shortcut={preset === 100 ? shortcut("$mod+0") : undefined}
            onSelect={() => {
              suppressOverviewPopForExplicitZoomRef.current = true;
              setZoom(preset);
            }}
          />
        ))}
        <DropdownMenuSeparator />
        <ZoomMenuRow
          label={"Pixel grid" /* i18n-ignore */}
          checked={pixelGrid}
          onSelect={() => toggleViewSetting("pixelGrid")}
        />
        <ZoomMenuRow
          label={"Snap to pixel grid" /* i18n-ignore */}
          checked={snapToPixelGrid}
          disabled={viewMode !== "overview"}
          onSelect={() => toggleViewSetting("snapToPixelGrid")}
        />
        <ZoomMenuRow
          label={"Rulers" /* i18n-ignore */}
          checked={rulers}
          disabled={viewMode !== "overview"}
          onSelect={() => toggleViewSetting("rulers")}
        />
        <ZoomMenuRow
          label={"Multiplayer cursors" /* i18n-ignore */}
          checked={multiplayerCursors}
          disabled={viewMode === "overview"}
          onSelect={() => toggleViewSetting("multiplayerCursors")}
        />
        <DropdownMenuSeparator />
        <ZoomMenuRow
          label={"Comments" /* i18n-ignore */}
          checked={!commentsHidden}
          shortcut={shortcut("shift+c")}
          onSelect={handleToggleComments}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
