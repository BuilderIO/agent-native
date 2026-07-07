import { IconPhotoPlus, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export interface ImageFillBackgroundStyles {
  backgroundImage: string;
  backgroundSize?: string;
  backgroundRepeat?: string;
  backgroundPosition?: string;
}

const FIT_MODES: Array<{ mode: ImageFitMode; label: string }> = [
  { mode: "fill", label: "Fill" }, // i18n-ignore image fit mode
  { mode: "fit", label: "Fit" }, // i18n-ignore image fit mode
  { mode: "crop", label: "Crop" }, // i18n-ignore image fit mode
  { mode: "tile", label: "Tile" }, // i18n-ignore image fit mode
];

// ─── CSS serialization ─────────────────────────────────────────────────────────

/**
 * Escape a URL for embedding inside a double-quoted CSS url("...") token.
 * Only `"` and `\` are CSS-significant inside a double-quoted string; newlines
 * must also be stripped. Everything else (parens, commas, single-quotes, etc.)
 * is safe inside double quotes, so we leave it alone to keep the URL intact.
 */
function escapeForQuotedUrl(url: string): string {
  return url.replace(/\\/g, "\\\\").replace(/"/g, "%22").replace(/\r?\n/g, "");
}

const CHECKER_A = "#d4d4d4";
const CHECKERBOARD_IMAGE = `linear-gradient(45deg, ${CHECKER_A} 25%, transparent 25%), linear-gradient(-45deg, ${CHECKER_A} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${CHECKER_A} 75%), linear-gradient(-45deg, transparent 75%, ${CHECKER_A} 75%)`;
const FIT_MARKER_RE =
  /\/\*\s*agent-native-image-fit:(fill|fit|crop|tile)\s*\*\//i;

function imageFitMarker(fit: ImageFitMode): string {
  return `/* agent-native-image-fit:${fit} */`;
}

/**
 * Build the CSS `background` shorthand for an image fill.
 * Maps the design editor's fit semantics onto background-size / background-repeat:
 *  - Fill → cover, no-repeat
 *  - Fit  → contain, no-repeat
 *  - Crop → cover, no-repeat (cropped to the box; identical CSS to Fill but
 *           kept distinct so the selection round-trips)
 *  - Tile → auto, repeat
 */
export function imageFillToCss(value: ImageFillValue): string {
  const url = value.url.trim();
  if (!url) return "transparent";
  const safeUrl = escapeForQuotedUrl(url);
  const image = `url("${safeUrl}")`;
  switch (value.fit) {
    case "fit":
      return `${image} center / contain no-repeat ${imageFitMarker("fit")}`;
    case "tile":
      return `${image} top left / auto repeat ${imageFitMarker("tile")}`;
    case "crop":
      return `${image} center / cover no-repeat ${imageFitMarker("crop")}`;
    case "fill":
    default:
      return `${image} center / cover no-repeat ${imageFitMarker("fill")}`;
  }
}

export function imageFillToBackgroundStyles(
  value: ImageFillValue,
): Record<
  | "backgroundImage"
  | "backgroundSize"
  | "backgroundRepeat"
  | "backgroundPosition",
  string
> {
  const url = value.url.trim();
  if (!url) {
    return {
      backgroundImage: "none",
      backgroundSize: "auto",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
    };
  }
  const safeUrl = escapeForQuotedUrl(url);
  const backgroundImage = `url("${safeUrl}") ${imageFitMarker(value.fit)}`;
  switch (value.fit) {
    case "fit":
      return {
        backgroundImage,
        backgroundSize: "contain",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
      };
    case "tile":
      return {
        backgroundImage,
        backgroundSize: "auto",
        backgroundRepeat: "repeat",
        backgroundPosition: "top left",
      };
    case "crop":
      return {
        backgroundImage,
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
      };
    case "fill":
    default:
      return {
        backgroundImage,
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
      };
  }
}

// Matches url() in three forms:
//   group 1 — double-quoted:  url("...anything...")
//   group 2 — single-quoted:  url('...anything...')
//   group 3 — unquoted:       url(...no-parens-or-quotes...)
const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*?))\s*\)/i;

function normalizeCssLayer(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function firstCssLayer(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) return trimmed.slice(0, index).trim();
  }
  return trimmed;
}

function isStartBackgroundPosition(position: string): boolean {
  if (!position) return false;
  const normalized = position
    .replace(/\s+/g, " ")
    .replace(/\b0(?:\.0+)?(?:px|em|rem|%)\b/g, "0")
    .trim();
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 1) {
    return tokens[0] === "0" || tokens[0] === "top" || tokens[0] === "left";
  }
  const horizontal = tokens[0];
  const vertical = tokens[1];
  return (
    (horizontal === "left" || horizontal === "0") &&
    (vertical === "top" || vertical === "0")
  );
}

function inferFitFromBackgroundStyles(
  styles: ImageFillBackgroundStyles,
): ImageFitMode | null {
  const size = normalizeCssLayer(firstCssLayer(styles.backgroundSize));
  const repeat = normalizeCssLayer(firstCssLayer(styles.backgroundRepeat));
  const position = normalizeCssLayer(firstCssLayer(styles.backgroundPosition));

  if (size === "contain") return "fit";
  if (repeat === "repeat" || repeat === "repeat-x" || repeat === "repeat-y") {
    return "tile";
  }
  if (size === "auto" && repeat === "repeat") return "tile";
  if (
    isStartBackgroundPosition(position) &&
    (repeat === "repeat" || size === "auto")
  ) {
    return "tile";
  }
  if (size === "cover") return "fill";
  return null;
}

/** Extract the URL + fit mode from CSS background input, if present. */
export function parseImageFillCss(value: string): ImageFillValue | null;
export function parseImageFillCss(
  value: ImageFillBackgroundStyles,
): ImageFillValue | null;
export function parseImageFillCss(
  value: string | ImageFillBackgroundStyles,
): ImageFillValue | null {
  const styles = typeof value === "string" ? { backgroundImage: value } : value;
  const match = styles.backgroundImage.match(URL_RE);
  if (!match) return null;
  const url = (match[1] ?? match[2] ?? match[3] ?? "").trim();
  const marker = styles.backgroundImage.match(FIT_MARKER_RE)?.[1] as
    | ImageFitMode
    | undefined;
  if (marker) return { url, fit: marker };
  const inferredFit = inferFitFromBackgroundStyles(styles);
  if (inferredFit) return { url, fit: inferredFit };
  // Heuristic fallback when no marker comment is present (e.g. CSS pasted from
  // DevTools or Figma inspect). Note: "crop" and "fill" produce identical CSS
  // (center / cover no-repeat), so external CSS without the marker comment will
  // always parse as "fill". Crop mode is only recoverable via the proprietary
  // agent-native-image-fit marker written by imageFillToCss.
  let fit: ImageFitMode = "fill";
  const backgroundImage = styles.backgroundImage;
  if (/contain/i.test(backgroundImage)) fit = "fit";
  else if (
    /repeat(?!\s+no)/i.test(backgroundImage) &&
    !/no-repeat/i.test(backgroundImage)
  )
    fit = "tile";
  else if (/cover/i.test(backgroundImage)) fit = "fill";
  return { url, fit };
}

export function mergeImageFitDraft(
  value: ImageFillValue,
  urlDraft: string,
  fit: ImageFitMode,
): ImageFillValue {
  return { ...value, url: urlDraft.trim(), fit };
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
  const urlDraftRef = useRef(value.url);
  // Guard re-syncing the draft from an external value change while the field
  // is focused (mirrors ScrubInput's `focused` pattern): without this, an
  // incoming prop update while the user is mid-typing a URL — e.g. a
  // selection-driven re-render, or another control committing a sibling
  // style in the same patch — clobbers their in-progress keystrokes.
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (focused) return;
    urlDraftRef.current = value.url;
    setUrlDraft(value.url);
  }, [focused, value.url]);

  const commitUrl = () => {
    onChange({ ...value, url: urlDraftRef.current.trim() });
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

  return (
    <div className={cn("space-y-1.5 px-3 pt-2 pb-2", className)}>
      {/* ── Preview / drop target ─────────────────────────────────────────── */}
      <div
        className="relative h-24 w-full overflow-hidden rounded-md border border-border/60"
        style={{
          backgroundImage: value.url
            ? `url("${escapeForQuotedUrl(value.url.trim())}")`
            : CHECKERBOARD_IMAGE,
          backgroundSize: value.url
            ? value.fit === "fit"
              ? "contain"
              : value.fit === "tile"
                ? "auto"
                : "cover"
            : "8px 8px, 8px 8px, 8px 8px, 8px 8px",
          backgroundRepeat: value.fit === "tile" ? "repeat" : "no-repeat",
          backgroundPosition: value.fit === "tile" ? "top left" : "center",
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
          className="h-6 min-w-0 flex-1 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2 !text-[11px] md:!text-[11px]"
          onChange={(event) => {
            urlDraftRef.current = event.target.value;
            setUrlDraft(event.target.value);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commitUrl();
          }}
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

      {/* ── Fit mode dropdown ─────────────────────────────────────────────── */}
      <Select
        value={value.fit}
        onValueChange={(v) =>
          onChange(
            mergeImageFitDraft(value, urlDraftRef.current, v as ImageFitMode),
          )
        }
        disabled={disabled}
      >
        <SelectTrigger
          aria-label={"Fill" /* i18n-ignore image fit selector */}
          className="h-6 w-full rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2 !text-[11px] shadow-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-3 [&>svg]:shrink-0"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="!text-[11px]">
          {FIT_MODES.map(({ mode, label }) => (
            <SelectItem key={mode} value={mode} className="!text-[11px]">
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
