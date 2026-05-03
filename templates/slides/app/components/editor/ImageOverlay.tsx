import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  IconPhoto,
  IconFolderOpen,
  IconUpload,
  IconSearch,
  IconMaximize,
  IconMinimize,
  IconGlobe,
} from "@tabler/icons-react";

interface ImageOverlayProps {
  anchorRect: DOMRect;
  objectFit: "cover" | "contain";
  onGenerate: () => void;
  onLibrary: () => void;
  onUpload: () => void;
  onSearch: () => void;
  onLogo: () => void;
  onToggleObjectFit: () => void;
  onClose: () => void;
}

export default function ImageOverlay({
  anchorRect,
  objectFit,
  onGenerate,
  onLibrary,
  onUpload,
  onSearch,
  onLogo,
  onToggleObjectFit,
  onClose,
}: ImageOverlayProps) {
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
        Asset Library
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
          onSearch();
          onClose();
        }}
        className="image-overlay-btn"
      >
        <IconSearch className="w-3.5 h-3.5 text-muted-foreground" />
        Search
      </button>
      <button
        onClick={() => {
          onLogo();
          onClose();
        }}
        className="image-overlay-btn"
      >
        <IconGlobe className="w-3.5 h-3.5 text-muted-foreground" />
        Logo
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
    </div>,
    document.body,
  );
}
