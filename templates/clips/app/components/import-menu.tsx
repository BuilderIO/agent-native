import { useT } from "@agent-native/core/client/i18n";
import {
  IconCamera,
  IconChevronDown,
  IconLink,
  IconUpload,
} from "@tabler/icons-react";
import { useState } from "react";

import { ImportLoomDialog } from "@/components/library/import-loom-dialog";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUploadVideoPicker } from "@/hooks/use-upload-video-picker";
import { cn } from "@/lib/utils";

type MenuSide = "top" | "right" | "bottom" | "left";
type MenuAlign = "start" | "center" | "end";

export interface ImportMenuProps {
  uploadHref?: string;
  onUpload?: () => void;
  /**
   * Take a screenshot. A handler rather than an href because the browser's
   * screen picker has to open from the click, not after a navigation.
   */
  onScreenshot?: () => void;
  screenshotPending?: boolean;
  importLoomHref?: string;
  spaceId?: string | null;
  folderId?: string | null;
  recordHref?: string;
  className?: string;
  disabled?: boolean;
  iconOnly?: boolean;
  triggerIcon?: "upload" | "chevron";
  menuAlign?: MenuAlign;
  menuSide?: MenuSide;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
}

export function ImportMenu({
  uploadHref,
  onUpload,
  onScreenshot,
  screenshotPending = false,
  importLoomHref,
  spaceId,
  folderId,
  recordHref,
  className,
  disabled,
  iconOnly = false,
  triggerIcon = "upload",
  menuAlign = "center",
  menuSide,
  size = iconOnly ? "icon" : "default",
  variant = "outline",
}: ImportMenuProps) {
  const t = useT();
  const { input, openUploadPicker } = useUploadVideoPicker();
  const [loomDialogOpen, setLoomDialogOpen] = useState(false);

  if (!uploadHref && !onUpload && !onScreenshot && !importLoomHref) return null;

  const trigger = (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={disabled}
      aria-label={t("preRecord.import")}
      className={cn(!iconOnly && "gap-2", className)}
    >
      {triggerIcon === "chevron" ? <IconChevronDown /> : <IconUpload />}
      {!iconOnly ? (
        <>
          {t("preRecord.import")}
          <IconChevronDown />
        </>
      ) : null}
    </Button>
  );

  return (
    <>
      <DropdownMenu>
        {iconOnly ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side={menuSide ?? "right"}>
              {t("preRecord.import")}
            </TooltipContent>
          </Tooltip>
        ) : null}
        {!iconOnly ? (
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        ) : null}
        <DropdownMenuContent align={menuAlign} side={menuSide} className="w-56">
          {uploadHref ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                openUploadPicker(uploadHref);
              }}
            >
              <IconUpload />
              {t("preRecord.uploadVideo")}
            </DropdownMenuItem>
          ) : onUpload ? (
            <DropdownMenuItem onSelect={onUpload}>
              <IconUpload />
              {t("preRecord.uploadVideo")}
            </DropdownMenuItem>
          ) : null}
          {onScreenshot ? (
            <DropdownMenuItem
              disabled={screenshotPending}
              onSelect={(event) => {
                // Keep the click's transient activation: closing the menu first
                // would cost the screen picker its user gesture.
                event.preventDefault();
                onScreenshot();
              }}
            >
              <IconCamera />
              {t("preRecord.takeScreenshot")}
            </DropdownMenuItem>
          ) : null}
          {importLoomHref ? (
            <DropdownMenuItem
              onSelect={() => {
                setTimeout(() => setLoomDialogOpen(true), 0);
              }}
            >
              <IconLink />
              {t("preRecord.importLoom")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
        {input}
      </DropdownMenu>
      {importLoomHref ? (
        <ImportLoomDialog
          open={loomDialogOpen}
          onOpenChange={setLoomDialogOpen}
          spaceId={spaceId}
          folderId={folderId}
          recordHref={recordHref}
        />
      ) : null}
    </>
  );
}
