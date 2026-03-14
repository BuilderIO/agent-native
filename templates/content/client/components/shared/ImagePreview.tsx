import { Download, Copy, Check } from "lucide-react";
import { useState } from "react";

interface ImagePreviewProps {
  filePath: string;
  projectSlug: string;
}

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];

export function isImagePath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function ImagePreview({ filePath }: ImagePreviewProps) {
  const [copied, setCopied] = useState(false);
  const imageUrl = `/api/shared/asset?path=${encodeURIComponent(filePath)}`;
  const fileName = filePath.split("/").pop() || filePath;

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(window.location.origin + imageUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = fileName;
    a.click();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-foreground truncate">
            {fileName}
          </span>
          <span className="text-xs text-muted-foreground">
            {filePath.split("/").slice(0, -1).join(" / ")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopyUrl}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md hover:bg-accent transition-colors text-muted-foreground"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy URL"}
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md hover:bg-accent transition-colors text-muted-foreground"
          >
            <Download size={13} />
            Download
          </button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-8 overflow-auto bg-neutral-950/50">
        <img
          src={imageUrl}
          alt={fileName}
          className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
        />
      </div>
    </div>
  );
}
