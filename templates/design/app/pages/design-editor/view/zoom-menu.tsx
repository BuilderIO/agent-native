import { IconChevronDown } from "@tabler/icons-react";

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
import type { EditorModes } from "../domains/use-editor-modes";
import type { EditorScreenRendering } from "../domains/use-editor-screen-rendering";

export function renderZoomMenu({
  editorCore,
  editorActiveScreenAndGeometry,
  editorCanvasAndScreens,
  editorModes,
  editorScreenRendering,
  controlId,
}: {
  editorCore: EditorCore;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorCanvasAndScreens: EditorCanvasAndScreens;
  editorModes: EditorModes;
  editorScreenRendering: EditorScreenRendering;
  controlId: "toolbar" | "inspector" | "topbar";
}) {
  const { t, shortcut } = editorCore;
  const { handleZoomIn, handleZoomOut, setZoom } =
    editorActiveScreenAndGeometry;
  const { handleZoomToFit } = editorCanvasAndScreens;
  const { suppressOverviewPopForExplicitZoomRef } = editorModes;
  const {
    openZoomControl,
    setZoomInputValue,
    zoomLabel,
    setOpenZoomControl,
    zoomInputValue,
    commitZoomInput,
  } = editorScreenRendering;

  return (
    <DropdownMenu
      open={openZoomControl === controlId}
      onOpenChange={(open) => {
        if (open) {
          setZoomInputValue(zoomLabel);
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
          <Input
            autoFocus
            value={zoomInputValue}
            onChange={(event) => setZoomInputValue(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                commitZoomInput();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setZoomInputValue(zoomLabel);
                setOpenZoomControl(null);
              }
            }}
            className="h-7 rounded-[5px] border-[var(--design-editor-accent-color)] bg-[var(--design-editor-control-bg)] px-2 text-[12px] font-medium tabular-nums text-foreground shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
            aria-label={"Zoom percentage" /* i18n-ignore zoom field */}
          />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleZoomIn}
          className="h-6 px-2 py-0 text-[12px]"
        >
          <span className="flex-1">{"Zoom in" /* i18n-ignore */}</span>
          <DropdownMenuShortcut className="tracking-normal">
            {shortcut("$mod+=")}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleZoomOut}
          className="h-6 px-2 py-0 text-[12px]"
        >
          <span className="flex-1">{"Zoom out" /* i18n-ignore */}</span>
          <DropdownMenuShortcut className="tracking-normal">
            {shortcut("$mod+-")}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleZoomToFit}
          className="h-6 px-2 py-0 text-[12px]"
        >
          <span className="flex-1">{"Zoom to fit" /* i18n-ignore */}</span>
          <DropdownMenuShortcut className="tracking-normal">
            {shortcut("shift+1")}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        {[50, 100, 200].map((preset) => (
          <DropdownMenuItem
            key={preset}
            onClick={() => {
              suppressOverviewPopForExplicitZoomRef.current = true;
              setZoom(preset);
            }}
            className="h-6 px-2 py-0 text-[12px]"
          >
            <span className="flex-1">
              {"Zoom to " /* i18n-ignore */}
              {preset}%
            </span>
            {preset === 100 ? (
              <DropdownMenuShortcut className="tracking-normal">
                {shortcut("$mod+0")}
              </DropdownMenuShortcut>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
