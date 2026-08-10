import { useT } from "@agent-native/core/client/i18n";
import { IconChevronDown, IconLink, IconUpload } from "@tabler/icons-react";
import { Link } from "react-router";

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
import { cn } from "@/lib/utils";

type MenuSide = "top" | "right" | "bottom" | "left";
type MenuAlign = "start" | "center" | "end";

export interface ImportMenuProps {
  uploadHref?: string;
  onUpload?: () => void;
  importLoomHref?: string;
  className?: string;
  disabled?: boolean;
  iconOnly?: boolean;
  menuAlign?: MenuAlign;
  menuSide?: MenuSide;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
}

export function ImportMenu({
  uploadHref,
  onUpload,
  importLoomHref,
  className,
  disabled,
  iconOnly = false,
  menuAlign = "center",
  menuSide,
  size = iconOnly ? "icon" : "default",
  variant = "outline",
}: ImportMenuProps) {
  const t = useT();

  if (!uploadHref && !onUpload && !importLoomHref) return null;

  const trigger = (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={disabled}
      aria-label={t("preRecord.import")}
      className={cn(!iconOnly && "gap-2", className)}
    >
      <IconUpload />
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
          <DropdownMenuItem asChild>
            <Link to={uploadHref}>
              <IconUpload />
              {t("preRecord.uploadVideo")}
            </Link>
          </DropdownMenuItem>
        ) : onUpload ? (
          <DropdownMenuItem onSelect={onUpload}>
            <IconUpload />
            {t("preRecord.uploadVideo")}
          </DropdownMenuItem>
        ) : null}
        {importLoomHref ? (
          <DropdownMenuItem asChild>
            <Link to={importLoomHref}>
              <IconLink />
              {t("preRecord.importLoom")}
            </Link>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
