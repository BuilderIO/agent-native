import { useT } from "@agent-native/core/client/i18n";
import {
  IconPhoto,
  IconFolderOpen,
  IconUpload,
  IconDownload,
  IconMaximize,
  IconMinimize,
} from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const menuWidth = 180;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left: number;
  let top: number;

  if (vw < 640) {
    left = Math.max(8, (vw - menuWidth) / 2);
    top = Math.min(anchorRect.bottom + 8, vh - 260);
  } else {
    left = anchorRect.left - menuWidth - 8;
    top = anchorRect.top + anchorRect.height / 2 - 100;
    if (left < 8) left = 8;
  }
  top = Math.max(8, Math.min(top, vh - 220));

  return createPortal(
    <div
      ref={menuRef}
      className="image-overlay-menu"
      style={{ top, left, width: menuWidth }}
    >
      <button
        onClick={() => {
          onGenerate();
          onClose();
        }}
        className="image-overlay-btn"
      >
        <IconPhoto className="w-3.5 h-3.5 text-[#609FF8]" />
        Generate
      </button>
      <button
        onClick={() => {
          onLibrary();
          onClose();
        }}
        className="image-overlay-btn"
      >
        <IconFolderOpen className="w-3.5 h-3.5 text-[#00E5FF]" />
        {t("editorToolbar.assetLibrary")}
      </button>
      <button
        onClick={() => {
          onUpload();
          onClose();
        }}
        className="image-overlay-btn"
      >
        <IconUpload className="w-3.5 h-3.5 text-muted-foreground" />
        Upload
      </button>
      <button
        onClick={() => {
          onDownload();
          onClose();
        }}
        className="image-overlay-btn"
        disabled={!src}
      >
        <IconDownload className="w-3.5 h-3.5 text-muted-foreground" />
        Download
      </button>
      <div className="mx-1.5 border-t border-border" />
      <button onClick={onToggleObjectFit} className="image-overlay-btn">
        {objectFit === "cover" ? (
          <IconMinimize className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <IconMaximize className="w-3.5 h-3.5 text-muted-foreground" />
        )}
        Fit: {objectFit === "cover" ? "Cover" : "Contain"}
      </button>
      {objectFit === "cover" && (
        <label className="image-overlay-position">
          <span>{t("styleInspector.position")}</span>
          <select
            aria-label={t("styleInspector.position")}
            value={objectPosition}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (
                IMAGE_OBJECT_POSITION_VALUES.includes(
                  value as ImageObjectPosition,
                )
              ) {
                onChangeObjectPosition(value as ImageObjectPosition);
              }
            }}
          >
            <option value="left top">
              {t("styleInspector.top")} {t("styleInspector.left")}
            </option>
            <option value="center top">
              {t("styleInspector.top")} {t("styleInspector.center")}
            </option>
            <option value="right top">
              {t("styleInspector.top")} {t("styleInspector.right")}
            </option>
            <option value="left center">{t("styleInspector.left")}</option>
            <option value="center center">{t("styleInspector.center")}</option>
            <option value="right center">{t("styleInspector.right")}</option>
            <option value="left bottom">
              {t("styleInspector.bottom")} {t("styleInspector.left")}
            </option>
            <option value="center bottom">
              {t("styleInspector.bottom")} {t("styleInspector.center")}
            </option>
            <option value="right bottom">
              {t("styleInspector.bottom")} {t("styleInspector.right")}
            </option>
          </select>
        </label>
      )}
    </div>,
    document.body,
  );
}
