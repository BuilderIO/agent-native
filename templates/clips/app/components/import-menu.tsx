import { useT } from "@agent-native/core/client/i18n";
import { IconChevronDown, IconLink, IconUpload } from "@tabler/icons-react";
import { useState } from "react";

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
import { ImportLoomDialog } from "@/components/library/import-loom-dialog";
import { useUploadVideoPicker } from "@/hooks/use-upload-video-picker";
import { cn } from "@/lib/utils";

type MenuSide = "top" | "right" | "bottom" | "left";
type MenuAlign = "start" | "center" | "end";

export interface ImportMenuProps {
  uploadHref?: string;
  onUpload?: () => void;
  spaceId?: string | null;
  folderId?: string | null;
  /** Where "Record instead" / "Upload video" links inside the Loom dialog go. */
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

  if (!uploadHref && !onUpload) return null;

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
      ) : (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      )}
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
        <DropdownMenuItem
          onSelect={() => {
            // Let the dropdown close (and its close animation finish) before
            // opening the dialog — preventing default here would leave the
            // menu open behind the dialog instead of dismissing it.
            setTimeout(() => setLoomDialogOpen(true), 0);
          }}
        >
          <IconLink />
          {t("preRecord.importLoom")}
        </DropdownMenuItem>
      </DropdownMenuContent>
      {input}
      <ImportLoomDialog
        open={loomDialogOpen}
        onOpenChange={setLoomDialogOpen}
        spaceId={spaceId}
        folderId={folderId}
        recordHref={recordHref}
      />
    </DropdownMenu>
  );
}
