import { IconPhotoPlus, IconX } from "@tabler/icons-react";
import { useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ImageFitMode = "fill" | "fit" | "crop" | "tile";

export interface ImageFillValue {
  url: string;
  fit: ImageFitMode;
}

const FIT_MODES: Array<{ mode: ImageFitMode; label: string }> = [
  { mode: "fill", label: "Fill" }, // i18n-ignore image fit mode
  { mode: "fit", label: "Fit" }, // i18n-ignore image fit mode
  { mode: "crop", label: "Crop" }, // i18n-ignore image fit mode
  { mode: "tile", label: "Tile" }, // i18n-ignore image fit mode
];

// ─── CSS serialization ─────────────────────────────────────────────────────────

const CHECKER_A = "#d4d4d4";
const CHECKERBOARD_IMAGE = `linear-gradient(45deg, ${CHECKER_A} 25%, transparent 25%), linear-gradient(-45deg, ${CHECKER_A} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${CHECKER_A} 75%), linear-gradient(-45deg, transparent 75%, ${CHECKER_A} 75%)`;

/**
 * Build the CSS `background` shorthand for an image fill.
 * Maps Figma's fit semantics onto background-size / background-repeat:
 *  - Fill → cover, no-repeat
 *  - Fit  → contain, no-repeat
 *  - Crop → cover, no-repeat (cropped to the box; identical CSS to Fill but
 *           kept distinct so the selection round-trips)
 *  - Tile → auto, repeat
 */
export function imageFillToCss(value: ImageFillValue): string {
  const url = value.url.trim();
  if (!url) return "transparent";
  const safeUrl = url.replace(/["')]/g, encodeURIComponent);
  const image = `url("${safeUrl}")`;
  switch (value.fit) {
    case "fit":
      return `${image} center / contain no-repeat`;
    case "tile":
      return `${image} top left / auto repeat`;
    case "crop":
    case "fill":
    default:
      return `${image} center / cover no-repeat`;
  }
}

const URL_RE = /url\((['"]?)([^'")]+)\1\)/i;

/** Extract the URL + fit mode from a CSS background value, if present. */
export function parseImageFillCss(value: string): ImageFillValue | null {
  const match = value.match(URL_RE);
  if (!match) return null;
  const url = match[2];
  let fit: ImageFitMode = "fill";
  if (/contain/i.test(value)) fit = "fit";
  else if (/repeat(?!\s+no)/i.test(value) && !/no-repeat/i.test(value))
    fit = "tile";
  else if (/cover/i.test(value)) fit = "fill";
  return { url, fit };
}

// ─── Component ─────────────────────────────────────────────────────────────────

export interface ImageFillControlsProps {
  value: ImageFillValue;
  onChange: (value: ImageFillValue) => void;
  disabled?: boolean;
  className?: string;
}

export function ImageFillControls({
  value,
  onChange,
  disabled = false,
  className,
}: ImageFillControlsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [urlDraft, setUrlDraft] = useState(value.url);

  const commitUrl = () => {
    onChange({ ...value, url: urlDraft.trim() });
  };

  const handleFilePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (dataUrl) {
        setUrlDraft(dataUrl);
        onChange({ ...value, url: dataUrl });
      }
    };
    reader.readAsDataURL(file);
    // Allow re-selecting the same file later.
    event.target.value = "";
  };

  const previewLabel = value.url
    ? value.url.startsWith("data:")
      ? "Uploaded image" /* i18n-ignore */
      : value.url
    : "No image selected"; /* i18n-ignore */

  return (
    <div className={cn("space-y-2 px-3 pt-2 pb-1", className)}>
      {/* ── Preview / drop target ─────────────────────────────────────────── */}
      <div
        className="relative h-24 w-full overflow-hidden rounded-md border border-border/60"
        style={{
          backgroundImage: value.url
            ? `url("${value.url}")`
            : CHECKERBOARD_IMAGE,
          backgroundSize: value.url
            ? value.fit === "fit"
              ? "contain"
              : value.fit === "tile"
                ? "auto"
                : "cover"
            : "8px 8px, 8px 8px, 8px 8px, 8px 8px",
          backgroundRepeat: value.fit === "tile" ? "repeat" : "no-repeat",
          backgroundPosition: "center",
        }}
      >
        {!value.url && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground">
            <IconPhotoPlus className="size-5" />
            <span className="text-[10px]">
              {"Upload or paste a URL" /* i18n-ignore */}
            </span>
          </div>
        )}
        {value.url && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={"Remove image" /* i18n-ignore */}
                disabled={disabled}
                onClick={() => {
                  setUrlDraft("");
                  onChange({ ...value, url: "" });
                }}
                className="absolute right-1 top-1 flex size-5 items-center justify-center rounded bg-black/50 text-white hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <IconX className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{"Remove image" /* i18n-ignore */}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* ── URL input + upload ────────────────────────────────────────────── */}
      <div className="flex items-center gap-1">
        <Input
          value={urlDraft}
          disabled={disabled}
          placeholder={"Image URL" /* i18n-ignore */}
          aria-label={"Image URL" /* i18n-ignore */}
          spellCheck={false}
          className="h-6 min-w-0 flex-1 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2 text-[11px]"
          onChange={(event) => setUrlDraft(event.target.value)}
          onBlur={commitUrl}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitUrl();
              event.currentTarget.blur();
            }
          }}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={"Upload image" /* i18n-ignore */}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-muted-foreground hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                disabled && "pointer-events-none opacity-40",
              )}
            >
              <IconPhotoPlus className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{"Upload image" /* i18n-ignore */}</TooltipContent>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFilePick}
        />
      </div>

      <p
        className="truncate text-[10px] text-muted-foreground"
        title={previewLabel}
      >
        {previewLabel}
      </p>

      {/* ── Fit mode segmented control ────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-px rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] p-0.5">
        {FIT_MODES.map(({ mode, label }) => {
          const isActive = value.fit === mode;
          return (
            <button
              key={mode}
              type="button"
              disabled={disabled}
              aria-pressed={isActive}
              onClick={() => onChange({ ...value, fit: mode })}
              className={cn(
                "h-5 rounded-sm text-[11px] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "bg-popover text-foreground shadow-[inset_0_0_0_1px_var(--design-editor-control-border)]"
                  : "text-muted-foreground hover:text-foreground",
                disabled && "pointer-events-none opacity-40",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
