import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import type { AgentMcpAppPayload } from "../../mcp-client/app-result.js";
import { useT } from "../i18n.js";
import { McpAppRenderer } from "../mcp-apps/McpAppRenderer.js";
import { useActionQuery } from "../use-action.js";

type ChartPoint = { label: string; value: number };
type DesignToken = { label: string; value: string };
type TableColumn = { source: string | number; label: string };

export type OutputPreviewModel =
  | { kind: "text"; text: string }
  | { kind: "chart"; title?: string; unit?: string; data: ChartPoint[] }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "image"; src: string; alt: string }
  | {
      kind: "design";
      title?: string;
      summary?: string;
      imageUrl?: string;
      previewUrl?: string;
      tokens: DesignToken[];
    };

const MAX_STRING_LENGTH = 600;
const MAX_ANSWER_LENGTH = 20_000;
const MAX_COLUMNS = 8;
const MAX_ROWS = 24;
const MAX_MARKDOWN_LINES = MAX_ROWS * 2 + 2;
const DESIGN_HOST_ORIGIN = "https://design.agent-native.com";
const BETA_DESIGN_HOST_ORIGIN = "https://beta.design.agent-native.com";
const DESIGN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const REBINDING_DNS_SUFFIXES = [
  "nip.io",
  "sslip.io",
  "xip.io",
  "localtest.me",
  "lvh.me",
  "vcap.me",
];
const MAX_ACTIVE_COMPACT_FRAMES = 6;
let activeCompactFrames = 0;
const compactFrameQueue: Array<() => void> = [];

function reserveCompactFrame(onReserve: () => void): () => void {
  let active = false;
  let released = false;
  const grant = () => {
    if (released) return;
    active = true;
    activeCompactFrames += 1;
    onReserve();
  };

  if (activeCompactFrames < MAX_ACTIVE_COMPACT_FRAMES) grant();
  else compactFrameQueue.push(grant);

  return () => {
    if (released) return;
    released = true;
    if (!active) return;
    active = false;
    activeCompactFrames -= 1;
    while (
      activeCompactFrames < MAX_ACTIVE_COMPACT_FRAMES &&
      compactFrameQueue.length > 0
    ) {
      compactFrameQueue.shift()?.();
    }
  };
}

function ReviewPreviewFrame({
  url,
  artifactAppId,
  artifactId,
  previewLabel,
  compact,
  renderContent,
  kind,
}: {
  url?: string;
  artifactAppId?: "design" | "slides";
  artifactId?: string;
  previewLabel: string;
  compact: boolean;
  renderContent?: ReactNode;
  kind: "artifact" | "design" | "analytics-dashboard";
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const [mounted, setMounted] = useState(!compact);
  const [loaded, setLoaded] = useState(false);
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const designQuery = useActionQuery<Record<string, unknown>>(
    "get-design",
    { id: artifactId ?? "", includeFileContent: false },
    {
      enabled: mounted && artifactAppId === "design" && Boolean(artifactId),
      staleTime: 5 * 60_000,
    },
  );
  const designFiles = Array.isArray(designQuery.data?.files)
    ? designQuery.data.files.filter((file): file is Record<string, unknown> =>
        isRecord(file),
      )
    : [];
  const designFile =
    designFiles.find(
      (file) =>
        typeof file.filename === "string" &&
        file.filename.toLowerCase() === "index.html",
    ) ??
    designFiles.find(
      (file) =>
        (typeof file.filename === "string" &&
          file.filename.toLowerCase().endsWith(".html")) ||
        (typeof file.fileType === "string" &&
          file.fileType.toLowerCase().includes("html")),
    );
  const designFileId =
    typeof designFile?.id === "string" ? designFile.id : undefined;
  const designFileQuery = useActionQuery<Record<string, unknown>>(
    "get-design",
    {
      id: artifactId ?? "",
      fileId: designFileId ?? "",
      includeFileContent: true,
    },
    {
      enabled:
        mounted &&
        artifactAppId === "design" &&
        Boolean(artifactId && designFileId),
      staleTime: 5 * 60_000,
    },
  );
  const deckQuery = useActionQuery<Record<string, unknown>>(
    "get-deck",
    { id: artifactId ?? "", compact: "true" },
    {
      enabled: mounted && artifactAppId === "slides" && Boolean(artifactId),
      staleTime: 5 * 60_000,
    },
  );
  const deckMetadataSlides = Array.isArray(deckQuery.data?.slides)
    ? deckQuery.data.slides.filter((slide): slide is Record<string, unknown> =>
        isRecord(slide),
      )
    : [];
  const firstSlideId =
    compact && typeof deckMetadataSlides[0]?.id === "string"
      ? deckMetadataSlides[0].id
      : undefined;
  const defaultSlideId =
    typeof deckMetadataSlides[0]?.id === "string"
      ? deckMetadataSlides[0].id
      : undefined;
  const activeSlideId = compact
    ? firstSlideId
    : (deckMetadataSlides.find((slide) => slide.id === selectedSlideId)?.id ??
      defaultSlideId);
  const selectedSlideQuery = useActionQuery<Record<string, unknown>>(
    "get-deck",
    {
      id: artifactId ?? "",
      slideId: activeSlideId ?? "",
      compact: "false",
    },
    {
      enabled: mounted && artifactAppId === "slides" && Boolean(activeSlideId),
      staleTime: 5 * 60_000,
    },
  );
  const designFileContents = Array.isArray(designFileQuery.data?.files)
    ? designFileQuery.data.files.filter(
        (file): file is Record<string, unknown> => isRecord(file),
      )
    : [];
  const slideData = selectedSlideQuery.data;
  const slides = Array.isArray(slideData?.slides)
    ? slideData.slides.filter((slide): slide is Record<string, unknown> =>
        isRecord(slide),
      )
    : [];
  const artifactHtml =
    artifactAppId === "design"
      ? designFileContents[0]?.content
      : slides[0]?.content;
  const srcDoc =
    typeof artifactHtml === "string" && artifactHtml.trim()
      ? artifactHtml
      : undefined;
  const artifactError =
    artifactAppId === "design"
      ? designQuery.isError || designFileQuery.isError
      : deckQuery.isError || selectedSlideQuery.isError;
  const artifactLoaded =
    artifactAppId === "design"
      ? designQuery.isSuccess && (!designFileId || designFileQuery.isSuccess)
      : deckQuery.isSuccess && (!activeSlideId || selectedSlideQuery.isSuccess);
  const unavailable =
    artifactAppId && (artifactError || (artifactLoaded && !srcDoc));

  useEffect(() => {
    if (!compact) return;
    const container = containerRef.current;
    if (!container) return;
    if (typeof IntersectionObserver === "undefined") {
      releaseRef.current = reserveCompactFrame(() => setMounted(true));
      return () => {
        releaseRef.current?.();
        releaseRef.current = null;
      };
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !releaseRef.current) {
          releaseRef.current = reserveCompactFrame(() => setMounted(true));
        } else if (!entry?.isIntersecting && releaseRef.current) {
          releaseRef.current();
          releaseRef.current = null;
          setMounted(false);
          setLoaded(false);
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(container);
    return () => {
      observer.disconnect();
      releaseRef.current?.();
      releaseRef.current = null;
    };
  }, [compact]);

  useEffect(() => setLoaded(false), [url, srcDoc]);

  useEffect(() => setSelectedSlideId(null), [artifactId]);

  const dataKind =
    kind === "analytics-dashboard"
      ? compact
        ? "analytics-dashboard-thumbnail"
        : "analytics-dashboard"
      : compact
        ? `${kind}-iframe-thumbnail`
        : `${kind}-iframe`;
  const showSlideStrip =
    !compact && artifactAppId === "slides" && deckMetadataSlides.length > 1;
  return (
    <div
      ref={containerRef}
      aria-label={previewLabel}
      className={
        compact
          ? "relative size-full overflow-hidden bg-background"
          : "relative aspect-[16/10] w-full max-w-full overflow-hidden bg-background"
      }
      data-preview-kind={dataKind}
      data-preview-state={
        renderContent !== undefined
          ? mounted
            ? "ready"
            : "loading"
          : unavailable
            ? "unavailable"
            : artifactAppId && !srcDoc
              ? "loading"
              : "ready"
      }
      role={showSlideStrip ? "group" : "img"}
    >
      {renderContent !== undefined ? (
        mounted ? (
          renderContent
        ) : (
          <div className="absolute inset-0 animate-pulse bg-muted" />
        )
      ) : (
        <>
          {showSlideStrip && (
            <div
              aria-label={previewLabel}
              className="absolute inset-x-0 top-0 z-10 flex gap-1 overflow-x-auto border-b border-border bg-background/95 p-1"
              data-review-slide-strip
              role="group"
            >
              {deckMetadataSlides.map((slide, index) => {
                const slideId =
                  typeof slide.id === "string" ? slide.id : undefined;
                if (!slideId) return null;
                const label =
                  typeof slide.title === "string" && slide.title.trim()
                    ? slide.title
                    : `${previewLabel} ${index + 1}`;
                return (
                  <button
                    key={slideId}
                    type="button"
                    aria-label={label}
                    aria-pressed={activeSlideId === slideId}
                    onClick={() => setSelectedSlideId(slideId)}
                    className="size-8 shrink-0 rounded border border-border text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground"
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
          )}
          {!loaded && (
            <div
              className={
                unavailable
                  ? "absolute inset-0 flex items-center justify-center bg-muted px-3 text-center text-xs text-muted-foreground"
                  : "absolute inset-0 animate-pulse bg-muted"
              }
              role={unavailable ? "status" : undefined}
            >
              {unavailable ? t("observability.reviewPreviewUnavailable") : null}
            </div>
          )}
          {mounted && (!artifactAppId || srcDoc) && (
            <iframe
              aria-hidden="true"
              className={
                compact
                  ? "pointer-events-none absolute left-0 top-0 h-[600%] w-[600%] origin-top-left scale-[0.166667] border-0"
                  : showSlideStrip
                    ? "absolute inset-x-0 bottom-0 top-10 border-0"
                    : "absolute inset-0 size-full border-0"
              }
              loading="lazy"
              onLoad={() => setLoaded(true)}
              referrerPolicy="no-referrer"
              sandbox="allow-scripts"
              {...(artifactAppId ? { srcDoc } : { src: url })}
              tabIndex={-1}
              title={previewLabel}
            />
          )}
        </>
      )}
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, MAX_STRING_LENGTH) : undefined;
}

function tableCell(value: unknown): string {
  if (typeof value === "string") return value.slice(0, MAX_STRING_LENGTH);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).slice(0, MAX_STRING_LENGTH);
  }
  if (value && typeof value === "object") return "[…]";
  return "";
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "localhost.localdomain" ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".lan") ||
    normalized.includes(":")
  ) {
    return true;
  }

  if (
    REBINDING_DNS_SUFFIXES.some(
      (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
    )
  ) {
    return true;
  }

  const labels = normalized.split(".");
  return labels.some((_, index) =>
    isPrivateIpv4(labels.slice(index, index + 4).join(".")),
  );
}

function safeImageUrl(value: unknown): string | undefined {
  const candidate = boundedString(value);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol === "https:" && !isPrivateHost(url.hostname)) {
      return url.toString();
    }
    // coercion-ok: invalid image URLs are an explicit typed absence.
  } catch {
    return undefined;
  }
  return undefined;
}

function safeDesignPreviewUrl(
  value: unknown,
  baseOrigin?: string,
): string | undefined {
  const candidate = boundedString(value);
  if (!candidate || candidate.startsWith("//")) return undefined;
  try {
    const baseUrl = baseOrigin ? new URL(baseOrigin) : undefined;
    const url = new URL(candidate, baseUrl);
    const sameOrigin = baseUrl?.origin === url.origin;
    if (
      url.username ||
      url.password ||
      (url.origin !== DESIGN_HOST_ORIGIN &&
        url.origin !== BETA_DESIGN_HOST_ORIGIN &&
        !sameOrigin)
    ) {
      return undefined;
    }
    const match = url.pathname.match(
      /^\/design\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/,
    );
    if (!match || !DESIGN_ID_PATTERN.test(match[1])) return undefined;
    return new URL(`/present/${match[1]}?reviewEmbed=1`, url.origin).toString();
    // coercion-ok: malformed untrusted design URLs are intentionally rejected.
  } catch {
    return undefined;
  }
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .slice(0, MAX_COLUMNS)
    .map((cell) => cell.trim().slice(0, MAX_STRING_LENGTH));
}

function parseMarkdownTable(answer: string): OutputPreviewModel | undefined {
  const lines = answer
    .split(/\r?\n/, MAX_MARKDOWN_LINES)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = splitTableRow(lines[index]);
    const separator = splitTableRow(lines[index + 1]);
    if (
      header.length < 2 ||
      separator.length !== header.length ||
      !separator.every((cell) => /^:?-{3,}:?$/.test(cell))
    ) {
      continue;
    }

    const rows: string[][] = [];
    for (
      let rowIndex = index + 2;
      rowIndex < lines.length && rows.length < MAX_ROWS;
      rowIndex += 1
    ) {
      if (!lines[rowIndex].includes("|")) break;
      const row = splitTableRow(lines[rowIndex]);
      if (row.length !== header.length) break;
      rows.push(row);
    }
    if (rows.length > 0) return { kind: "table", headers: header, rows };
  }
  return undefined;
}

function parseStructuredPreview(
  value: unknown,
  baseOrigin?: string,
): OutputPreviewModel | undefined {
  if (!isRecord(value)) return undefined;
  const type = boundedString(value.type)?.toLowerCase();

  if (type === "chart") {
    const source = Array.isArray(value.data)
      ? value.data
      : Array.isArray(value.values)
        ? value.values
        : [];
    const data = source.slice(0, MAX_ROWS).flatMap((point) => {
      if (!isRecord(point)) return [];
      const label = boundedString(point.label);
      const numericValue =
        typeof point.value === "number"
          ? point.value
          : typeof point.value === "string"
            ? Number(point.value)
            : Number.NaN;
      return label && Number.isFinite(numericValue) && numericValue >= 0
        ? [{ label, value: numericValue }]
        : [];
    });
    if (data.length > 0) {
      return {
        kind: "chart",
        title: boundedString(value.title),
        unit: boundedString(value.unit),
        data,
      };
    }
  }

  if (type === "table") {
    const sourceRows = Array.isArray(value.rows) ? value.rows : [];
    const objectRows = sourceRows.filter(isRecord);
    const inferredHeaders = objectRows[0]
      ? Object.keys(objectRows[0])
          .flatMap((key) => {
            const label = boundedString(key);
            return label ? [{ key, label }] : [];
          })
          .slice(0, MAX_COLUMNS)
      : [];
    const columns: TableColumn[] = Array.isArray(value.headers)
      ? value.headers
          .flatMap((header, index) => {
            const text = boundedString(header);
            return text ? [{ source: index, label: text }] : [];
          })
          .slice(0, MAX_COLUMNS)
      : inferredHeaders.map(({ key, label }) => ({ source: key, label }));
    const resolvedColumns = columns.map((column) => {
      if (typeof column.source !== "number" || !objectRows[0]) {
        return column;
      }
      const rawKeys = Object.keys(objectRows[0]);
      const source = Object.prototype.hasOwnProperty.call(
        objectRows[0],
        column.label,
      )
        ? column.label
        : (rawKeys[column.source] ?? column.source);
      return { ...column, source };
    });
    const headers = resolvedColumns.map(({ label }) => label);
    const rows = sourceRows.slice(0, MAX_ROWS).flatMap((row) => {
      if (Array.isArray(row)) {
        return [
          resolvedColumns.map(({ source }) => tableCell(row[Number(source)])),
        ];
      }
      if (isRecord(row) && headers.length > 0) {
        return [resolvedColumns.map(({ source }) => tableCell(row[source]))];
      }
      return [];
    });
    if (headers.length > 0 && rows.length > 0) {
      return { kind: "table", headers, rows };
    }
  }

  if (type === "image") {
    const src = safeImageUrl(value.src ?? value.url);
    if (src) {
      return {
        kind: "image",
        src,
        alt: boundedString(value.alt) ?? "Agent output image",
      };
    }
  }

  if (type === "design") {
    const imageUrl = safeImageUrl(value.imageUrl ?? value.image);
    const previewUrl = safeDesignPreviewUrl(
      value.url ?? value.urlPath ?? value.designUrl,
      baseOrigin,
    );
    const tokens = Array.isArray(value.tokens)
      ? value.tokens.slice(0, MAX_COLUMNS).flatMap((token) => {
          if (!isRecord(token)) return [];
          const label = boundedString(token.label);
          const tokenValue = boundedString(token.value);
          return label && tokenValue ? [{ label, value: tokenValue }] : [];
        })
      : [];
    const title = boundedString(value.title);
    const summary = boundedString(value.summary);
    if (imageUrl || previewUrl || tokens.length > 0 || title || summary) {
      return { kind: "design", title, summary, imageUrl, previewUrl, tokens };
    }
  }

  return undefined;
}

export function parseOutputPreview(
  answer: string,
  baseOrigin = typeof window === "undefined"
    ? undefined
    : window.location.origin,
): OutputPreviewModel {
  const text = answer.trim();
  if (!text) return { kind: "text", text: "-" };
  if (text.length > MAX_ANSWER_LENGTH) {
    return { kind: "text", text: `${text.slice(0, MAX_ANSWER_LENGTH)}…` };
  }

  const jsonText = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const structured = parseStructuredPreview(JSON.parse(jsonText), baseOrigin);
    if (structured) return structured;
    // coercion-ok: non-JSON answers intentionally use the text fallback.
  } catch {
    // Plain text and Markdown outputs are expected and remain the fallback.
  }

  const imageMatch = text.match(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/i);
  const imageUrl = imageMatch ? safeImageUrl(imageMatch[2]) : undefined;
  if (imageUrl) {
    return {
      kind: "image",
      src: imageUrl,
      alt: imageMatch?.[1] || "Agent output image",
    };
  }

  return parseMarkdownTable(text) ?? { kind: "text", text };
}

export function OutputPreview({
  answer,
  previewLabel,
  inlineApp,
  compact = false,
  maxAppHeight,
  artifactPreviewUrl,
  artifactPreviewIsImage = false,
  artifactPreviewAppId,
  artifactPreviewId,
  artifactPreviewContent,
  artifactOnly = false,
}: {
  answer: string;
  previewLabel: string;
  inlineApp?: AgentMcpAppPayload;
  compact?: boolean;
  maxAppHeight?: number;
  artifactPreviewUrl?: string;
  artifactPreviewIsImage?: boolean;
  artifactPreviewAppId?: "design" | "slides" | "analytics";
  artifactPreviewId?: string;
  artifactPreviewContent?: ReactNode;
  artifactOnly?: boolean;
}) {
  const preview = parseOutputPreview(answer);
  if (artifactPreviewUrl && artifactPreviewIsImage) {
    return (
      <img
        src={artifactPreviewUrl}
        alt={previewLabel}
        className={
          compact
            ? "size-full object-cover"
            : "max-h-[min(70dvh,45rem)] max-w-full object-contain"
        }
        data-preview-kind={
          compact ? "artifact-image-thumbnail" : "artifact-image"
        }
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }
  if (artifactPreviewContent !== undefined) {
    return (
      <ReviewPreviewFrame
        artifactId={artifactPreviewId}
        previewLabel={previewLabel}
        compact={compact}
        renderContent={artifactPreviewContent}
        kind="analytics-dashboard"
      />
    );
  }
  if (artifactPreviewAppId === "design" && artifactPreviewId) {
    return (
      <ReviewPreviewFrame
        artifactAppId="design"
        artifactId={artifactPreviewId}
        previewLabel={previewLabel}
        compact={compact}
        kind="design"
      />
    );
  }
  if (
    artifactPreviewAppId === "slides" &&
    artifactPreviewId &&
    artifactPreviewUrl
  ) {
    return (
      <ReviewPreviewFrame
        artifactAppId="slides"
        artifactId={artifactPreviewId}
        previewLabel={previewLabel}
        compact={compact}
        kind="artifact"
      />
    );
  }

  if (inlineApp && !compact) {
    return (
      <McpAppRenderer
        app={inlineApp}
        readOnly
        className="min-w-0"
        maxHeight={maxAppHeight}
      />
    );
  }

  const contentClassName = "text-sm text-foreground";

  if (preview.kind === "chart") {
    const maxValue = Math.max(...preview.data.map((point) => point.value), 1);
    const chartSummary = preview.data
      .map((point) => `${point.label}: ${point.value}${preview.unit ?? ""}`)
      .join(", ");
    if (compact) {
      return (
        <div
          aria-label={`${preview.title ?? previewLabel}: ${chartSummary}`}
          className="flex size-full items-end gap-1 overflow-hidden p-2"
          data-preview-kind="chart-thumbnail"
          role="img"
        >
          {preview.data.slice(0, 8).map((point) => (
            <span
              key={`${point.label}-${point.value}`}
              className="min-w-0 flex-1 rounded-sm bg-primary/75"
              style={
                {
                  height: `${Math.max(10, (point.value / maxValue) * 100)}%`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      );
    }
    return (
      <div
        aria-label={`${preview.title ?? previewLabel}: ${chartSummary}`}
        className={contentClassName}
        data-preview-kind="chart"
        role="img"
      >
        {preview.title && (
          <div className="mb-3 font-medium text-foreground">
            {preview.title}
          </div>
        )}
        <div className="space-y-3">
          {preview.data.map((point) => {
            const width = `${Math.max(0, (point.value / maxValue) * 100)}%`;
            return (
              <div key={`${point.label}-${point.value}`} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate">{point.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {point.value}
                    {preview.unit ?? ""}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width } as CSSProperties}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (preview.kind === "table") {
    if (compact) {
      return (
        <div
          aria-label={previewLabel}
          className="size-full overflow-hidden p-1.5"
          data-preview-kind="table-thumbnail"
          role="img"
        >
          <table className="w-full table-fixed text-left text-[9px] leading-3">
            <caption className="sr-only">{previewLabel}</caption>
            <thead className="text-muted-foreground">
              <tr>
                {preview.headers.slice(0, 3).map((header) => (
                  <th key={header} className="truncate px-1 py-0.5 font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.slice(0, 3).map((row, rowIndex) => (
                <tr
                  key={`${rowIndex}-${row.join("|")}`}
                  className="border-t border-border/70"
                >
                  {row.slice(0, 3).map((cell, cellIndex) => (
                    <td
                      key={`${cellIndex}-${cell}`}
                      className="truncate px-1 py-0.5"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return (
      <div
        aria-label={previewLabel}
        className="overflow-x-auto text-sm text-foreground"
        data-preview-kind="table"
        role="region"
      >
        <table className="w-full min-w-[28rem] text-left text-xs">
          <caption className="sr-only">{previewLabel}</caption>
          <thead className="text-muted-foreground">
            <tr>
              {preview.headers.map((header) => (
                <th key={header} className="px-3 py-2 font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, rowIndex) => (
              <tr
                key={`${rowIndex}-${row.join("|")}`}
                className="border-t border-border/70"
              >
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${cellIndex}-${cell}`}
                    className="px-3 py-2 align-top"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (preview.kind === "image") {
    return (
      <figure data-preview-kind="image">
        <img
          src={preview.src}
          alt={preview.alt}
          className={
            compact
              ? "size-full object-cover"
              : "max-h-[min(70dvh,45rem)] max-w-full rounded object-contain"
          }
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      </figure>
    );
  }

  if (preview.kind === "design") {
    if (artifactOnly && !preview.imageUrl) return null;
    if (compact && preview.imageUrl) {
      return (
        <img
          src={preview.imageUrl}
          alt={preview.title ?? previewLabel}
          className="size-full object-cover"
          data-preview-kind="design-thumbnail"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      );
    }
    if (compact) {
      return null;
    }
    return (
      <div className={contentClassName} data-preview-kind="design">
        {preview.imageUrl && (
          <img
            src={preview.imageUrl}
            alt={preview.title ?? previewLabel}
            className="mb-3 max-h-72 w-full rounded object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        )}
        {preview.title && <div className="font-medium">{preview.title}</div>}
        {preview.summary && (
          <p className="mt-1 text-xs text-muted-foreground">
            {preview.summary}
          </p>
        )}
        {preview.tokens.length > 0 && (
          <dl className="mt-3 divide-y divide-border/70">
            {preview.tokens.map((token) => (
              <div
                key={`${token.label}-${token.value}`}
                className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 first:pt-0"
              >
                <dt className="text-xs text-muted-foreground">{token.label}</dt>
                <dd className="text-xs">{token.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    );
  }

  if (compact || (artifactOnly && preview.kind === "text")) return null;

  return (
    <p
      className={
        compact
          ? "line-clamp-4 size-full overflow-hidden break-words p-2 text-[10px] leading-3 text-foreground"
          : "whitespace-pre-wrap break-words text-sm text-foreground"
      }
      data-preview-kind="text"
    >
      {preview.text}
    </p>
  );
}
