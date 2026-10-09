import { IconChevronDown } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { EditorActiveScreenAndGeometry } from "../domains/use-editor-active-screen-and-geometry";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorExportAndHandoff } from "../domains/use-editor-export-and-handoff";
import type { EditorFilesAndSaving } from "../domains/use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "../domains/use-editor-generation-and-access";
import type { EditorLayerActions } from "../domains/use-editor-layer-actions";
import { ExportMenuItems } from "./export-submenu-content";
import { PublishWaitlistPanel } from "./publish-waitlist-control";

export function ShareExportMenu({
  editorCore,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
  editorExportAndHandoff,
  editorLayerActions,
  className,
}: {
  editorCore: EditorCore;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorExportAndHandoff: EditorExportAndHandoff;
  editorLayerActions: EditorLayerActions;
  className?: string;
}) {
  const { t } = editorCore;
  const { setPublishWaitlistError } = editorLayerActions;
  const [publishOpen, setPublishOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            aria-label={t("designEditor.export")}
            className={cn("w-6 min-w-0 px-0", className)}
          >
            <IconChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="design-editor-app-menu-content w-52"
        >
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
            {t("designEditor.export")}
          </DropdownMenuLabel>
          <ExportMenuItems
            editorCore={editorCore}
            editorGenerationAndAccess={editorGenerationAndAccess}
            editorFilesAndSaving={editorFilesAndSaving}
            editorActiveScreenAndGeometry={editorActiveScreenAndGeometry}
            editorExportAndHandoff={editorExportAndHandoff}
            alwaysShowPdf
          />
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setPublishWaitlistError(null);
              setPublishOpen(true);
            }}
          >
            {t("designEditor.publishApp")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogTitle className="sr-only">
            {t("designEditor.publishApp")}
          </DialogTitle>
          <PublishWaitlistPanel
            editorCore={editorCore}
            editorLayerActions={editorLayerActions}
            onClose={() => setPublishOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
