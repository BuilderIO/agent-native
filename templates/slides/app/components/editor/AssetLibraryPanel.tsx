import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { IconUpload, IconTrash, IconLoader2, IconX } from "@tabler/icons-react";
import { appBasePath } from "@agent-native/core/client";

interface Asset {
  url: string;
  filename: string;
  size: number;
  createdAt: string;
}

interface AssetLibraryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectAsset?: (url: string) => void;
  anchorRef?: React.RefObject<HTMLButtonElement | null>;
}

export default function AssetLibraryPanel({
  open,
  onOpenChange,
  onSelectAsset,
  anchorRef,
}: AssetLibraryPanelProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open, onOpenChange]);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${appBasePath()}/api/assets`);
      if (res.ok) setAssets(await res.json());
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchAssets();
  }, [open, fetchAssets]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        await fetch(`${appBasePath()}/api/assets/upload`, {
          method: "POST",
          body: form,
        });
      }
      await fetchAssets();
    } catch {
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDelete = async (filename: string) => {
    try {
      await fetch(
        `${appBasePath()}/api/assets/${encodeURIComponent(filename)}`,
        {
          method: "DELETE",
        },
      );
      setAssets((prev) => prev.filter((a) => a.filename !== filename));
    } catch {}
  };

  const handleSelect = (url: string) => {
    onSelectAsset?.(url);
    onOpenChange(false);
  };

  if (!open) return null;

  let style: React.CSSProperties = {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: 9999,
  };

  if (anchorRef?.current) {
    const rect = anchorRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    if (vw < 640) {
      style = {
        position: "fixed",
        top: rect.bottom + 8,
        left: 12,
        right: 12,
        zIndex: 9999,
      };
    } else {
      style = {
        position: "fixed",
        top: rect.bottom + 8,
        right: Math.max(8, vw - rect.right),
        zIndex: 9999,
      };
    }
  }

  return createPortal(
    <div
      ref={panelRef}
      style={style}
      className="w-[min(20rem,calc(100vw-24px))] max-h-[420px] bg-popover border border-border rounded-xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
    >
      <div className="px-4 pt-3 pb-2 flex items-center justify-between flex-shrink-0">
        <h3 className="text-sm font-semibold text-foreground">Asset Library</h3>
        <button
          onClick={() => onOpenChange(false)}
          className="text-muted-foreground/70 hover:text-muted-foreground transition-colors"
          aria-label="Close"
        >
          <IconX className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 pb-4 space-y-3 overflow-y-auto flex-1">
        {/* Upload */}
        <label className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg border border-dashed border-border hover:border-[#609FF8]/40 hover:bg-accent cursor-pointer transition-all">
          {uploading ? (
            <IconLoader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
          ) : (
            <IconUpload className="w-3.5 h-3.5 text-muted-foreground" />
          )}
          <span className="text-xs text-muted-foreground">
            {uploading ? "Uploading..." : "Upload images"}
          </span>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleUpload}
            className="hidden"
            disabled={uploading}
          />
        </label>

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <IconLoader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          </div>
        ) : assets.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-xs">
            No assets yet.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {assets.map((asset) => (
              <div
                key={asset.filename}
                className="group relative aspect-square rounded-md overflow-hidden border border-border bg-muted"
              >
                <button
                  onClick={
                    onSelectAsset ? () => handleSelect(asset.url) : undefined
                  }
                  className={`w-full h-full ${onSelectAsset ? "cursor-pointer hover:ring-2 hover:ring-[#609FF8]/50" : "cursor-default"}`}
                >
                  <img
                    src={asset.url}
                    alt={asset.filename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(asset.filename);
                  }}
                  className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/70 text-white/70 hover:text-red-400 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label={`Delete ${asset.filename}`}
                >
                  <IconTrash className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
