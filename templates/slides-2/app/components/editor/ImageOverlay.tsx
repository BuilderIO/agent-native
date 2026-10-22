import { useT } from "@agent-native/core/client/i18n";
import {
  IconPhoto,
  IconFolderOpen,
  IconUpload,
  IconDownload,
  IconMaximize,
  IconMinimize,
} from "@tabler/icons-react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IMAGE_OBJECT_POSITION_VALUES,
  type ImageObjectPosition,
} from "@/lib/slide-image-replacement";

interface ImageOverlayProps {
  anchorRect: DOMRect;
  src: string;
  objectFit: "cover" | "contain";
  objectPosition: ImageObjectPosition;
  onGenerate: () => void;
  onLibrary: () => void;
  onUpload: () => void;
  onDownload: () => void;
  onToggleObjectFit: () => void;
  onChangeObjectPosition: (objectPosition: ImageObjectPosition) => void;
  onClose: () => void;
}

export default function ImageOverlay({
  anchorRect,
  src,
  objectFit,
  objectPosition,
  onGenerate,
  onLibrary,
  onUpload,
  onDownload,
  onToggleObjectFit,
  onChangeObjectPosition,
  onClose,
}: ImageOverlayProps) {
  const t = useT();
  const [menuElement, setMenuElement] = useState<HTMLDivElement | null>(null);
  const [menuHeight, setMenuHeight] = useState(0);
  const closedRef = useRef(false);
  const isPlaceholder = src.startsWith("placeholder:");

  useLayoutEffect(() => {
    const height = menuElement?.getBoundingClientRect().height;
    if (height && height !== menuHeight) setMenuHeight(height);
  }, [anchorRect, isPlaceholder, menuElement, menuHeight, objectFit]);

  const menuWidth = 180;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const isMobile = vw < 640;
  let left: number;
  let top: number;

  if (isMobile) {
    left = Math.max(8, (vw - menuWidth) / 2);
    top = anchorRect.bottom + 8;
  } else {
    left = anchorRect.left - menuWidth - 8;
    top = anchorRect.top + anchorRect.height / 2 - 100;
    if (left < 8) left = 8;
  }
  const maxTop = Math.max(8, vh - (menuHeight || 220) - 8);
  top = Math.max(8, Math.min(top, maxTop));

  const closeMenu = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose();
  };

  const positionOptions: Array<{ value: ImageObjectPosition; label: string }> =
    [
      {
        value: "left top",
        label: `${t("styleInspector.top")} ${t("styleInspector.left")}`,
      },
      {
        value: "center top",
        label: `${t("styleInspector.top")} ${t("styleInspector.center")}`,
      },
      {
        value: "right top",
        label: `${t("styleInspector.top")} ${t("styleInspector.right")}`,
      },
      { value: "left center", label: t("styleInspector.left") },
      { value: "center center", label: t("styleInspector.center") },
      { value: "right center", label: t("styleInspector.right") },
      {
        value: "left bottom",
        label: `${t("styleInspector.bottom")} ${t("styleInspector.left")}`,
      },
      {
        value: "center bottom",
        label: `${t("styleInspector.bottom")} ${t("styleInspector.center")}`,
      },
      {
        value: "right bottom",
        label: `${t("styleInspector.bottom")} ${t("styleInspector.right")}`,
      },
    ];

  const triggerLeft = isMobile ? left : left - 9;
  const triggerTop = isMobile ? top - 9 : top;

  return createPortal(
    <DropdownMenu
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) closeMenu();
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          style={{
            position: "fixed",
            top: triggerTop,
            left: triggerLeft,
            width: 1,
            height: 1,
            padding: 0,
            border: 0,
            opacity: 0,
            pointerEvents: "none",
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={setMenuElement}
        side={isMobile ? "bottom" : "right"}
        align="start"
        sideOffset={8}
        avoidCollisions={false}
        className="image-overlay-menu w-[180px] min-w-0"
        style={{ overflow: "visible" }}
      >
        <div className="flex max-h-[calc(100vh_-_28px)] flex-col gap-0.5 overflow-y-auto">
          <DropdownMenuItem
            className="gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-popover-foreground/80"
            onSelect={() => {
              onGenerate();
              closeMenu();
            }}
          >
            <IconPhoto className="size-3.5 text-primary" aria-hidden="true" />
            {t("raw.generate")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-popover-foreground/80"
            onSelect={() => {
              onLibrary();
              closeMenu();
            }}
          >
            <IconFolderOpen
              className="size-3.5 text-primary"
              aria-hidden="true"
            />
            {t("editorToolbar.assetLibrary")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-popover-foreground/80"
            onSelect={() => {
              onUpload();
              closeMenu();
            }}
          >
            <IconUpload
              className="size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            {t("raw.upload")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-popover-foreground/80"
            disabled={!src}
            onSelect={() => {
              onDownload();
              closeMenu();
            }}
          >
            <IconDownload
              className="size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            {t("raw.download")}
          </DropdownMenuItem>
          {!isPlaceholder && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-popover-foreground/80"
                onSelect={(event) => {
                  event.preventDefault();
                  onToggleObjectFit();
                }}
              >
                {objectFit === "cover" ? (
                  <IconMinimize
                    className="size-3.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                ) : (
                  <IconMaximize
                    className="size-3.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                {objectFit === "cover"
                  ? t("raw.fitCover")
                  : t("raw.fitContain")}
              </DropdownMenuItem>
              {objectFit === "cover" && (
                <div className="flex min-w-0 items-center gap-2 rounded-sm px-3.5 py-2 text-[13px] font-medium text-popover-foreground/80 hover:bg-accent focus-within:bg-accent">
                  <span className="shrink-0">
                    {t("styleInspector.position")}
                  </span>
                  <Select
                    value={objectPosition}
                    onValueChange={(value) => {
                      if (
                        IMAGE_OBJECT_POSITION_VALUES.includes(
                          value as ImageObjectPosition,
                        )
                      ) {
                        onChangeObjectPosition(value as ImageObjectPosition);
                      }
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      aria-label={t("styleInspector.position")}
                      className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 py-0 text-[13px] shadow-none focus:ring-0 focus:ring-offset-0"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent container={menuElement}>
                      {positionOptions.map(({ value, label }) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>,
    document.body,
  );
}
